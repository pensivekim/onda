import { safeEqual } from "../../utils/signed";
// 이웃대피 1단계: 마을재난예보 → 온다 «대피 출동» 입구 (격리 신규 라우트)
// - 기존 파일(matchRoutes·responderRoutes·detect-dispatch·db.ts)은 고치지 않는다. 새 표 3개만 IF NOT EXISTS 로 만든다.
// - 도우미는 기존 앱 흐름(수락→이동중→도착→돌봄중→완료)을 그대로 쓴다. «완료» = 대피소 도착. 정산·지자체 대납도 기존 흐름.
// - 대피명령 권한은 시장·군수에게 있다 → 예보가 와도 자동 출동하지 않고, 군청(관리자)이 «대피 시작»을 눌러야 출동 제안이 나간다.
//   예보 단계에서는 담당 도우미에게 «사전 점검» 알림만 간다(행안부 대피도우미 지침의 사전 예찰과 같은 일).
// index.ts 마운트는 1줄(app.route("/", evacRoutes)) — 대표 보고·승인 후 반영. 비밀값 EVAC_INGEST_KEY 필요.

import { Hono } from "hono";
import type { Env } from "../../types";
import { ensureAllTables } from "../../utils/db";
import { requireAdmin } from "../../utils/auth";
import { notifyHelper, type TgEnv } from "./telegram";
import {
  normalizeRow, parseForecastCsv, isDispatchCandidate, alertKey, deadlineIso, alertStage, type ForecastRow,
} from "./forecast";
import {
  planForAlert, deriveTaskStatus, summarize, type EvacPerson, type HelperState, type Mobility, type TaskStatus,
} from "./plan";
import type { Grade } from "../detect-dispatch/grade";

type Bindings = TgEnv & { EVAC_INGEST_KEY?: string };
/** 예행 전용 가상 읍면동 코드 — 실제 행정 코드(10자리)와 겹치지 않음 */
export const REH_EMD = "9999990";

const app = new Hono<{ Bindings: Bindings }>();

const MOBILITY = new Set<Mobility>(["walk", "assist", "wheelchair", "bed"]);
const MOB_KO: Record<Mobility, string> = { walk: "혼자 걸음", assist: "부축 필요", wheelchair: "휠체어", bed: "와상" };
/** 군청 밖(도우미 알림·요청 설명)에는 성만: «김○○». 실명은 군청 상황판에서만. (2026-10-26 검토 반영) */
/** 2026-10-27T18:00:00+09:00 → «10월 27일 18:00» */
export function koDeadline(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso || "");
  return m ? `${Number(m[2])}월 ${Number(m[3])}일 ${m[4]}:${m[5]}` : iso;
}
export function maskName(name: string): string {
  const n = (name || "").trim();
  return n ? `${n[0]}○○` : "○○○";
}

export async function ensureEvacTables(db: D1Database): Promise<void> {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS onda_evac_people (
      id TEXT PRIMARY KEY,
      contract_id TEXT,
      beneficiary_id TEXT,
      emd_code TEXT NOT NULL,
      name TEXT NOT NULL,
      mobility TEXT DEFAULT 'walk',
      address TEXT,
      lat REAL,
      lng REAL,
      helper_id TEXT,
      notes TEXT,
      status TEXT DEFAULT 'active',
      created_at TEXT DEFAULT (datetime('now'))
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS onda_evac_alerts (
      id TEXT PRIMARY KEY,
      target_day TEXT NOT NULL,
      hazard TEXT NOT NULL,
      emd_code TEXT NOT NULL,
      sido TEXT, sgg TEXT, emd TEXT,
      run TEXT, level TEXT, already INTEGER DEFAULT 0, rank INTEGER, n INTEGER,
      pop INTEGER, a65 INTEGER, a80 INTEGER,
      deadline_at TEXT,
      shelter_name TEXT, shelter_lat REAL, shelter_lon REAL, shelter_km REAL,
      stage TEXT DEFAULT 'watch',
      status TEXT DEFAULT 'open',
      issued_at TEXT,
      started_at TEXT, started_by TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS onda_evac_tasks (
      id TEXT PRIMARY KEY,
      alert_id TEXT NOT NULL,
      person_id TEXT NOT NULL,
      slot INTEGER DEFAULT 1,
      grade TEXT DEFAULT 'green',
      request_id TEXT,
      flag TEXT DEFAULT 'none',
      note TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(alert_id, person_id, slot)
    )`),
  ]);
  for (const sql of [
    "CREATE INDEX IF NOT EXISTS idx_evac_people_emd ON onda_evac_people(emd_code, status)",
    "CREATE INDEX IF NOT EXISTS idx_evac_alerts_day ON onda_evac_alerts(target_day, status)",
    "CREATE INDEX IF NOT EXISTS idx_evac_tasks_alert ON onda_evac_tasks(alert_id)",
  ]) { try { await db.prepare(sql).run(); } catch { /* 이미 있음 */ } }
}

async function ready(db: D1Database) {
  await ensureAllTables(db);
  await ensureEvacTables(db);
}

// ───────────────────────────── 1) 예보 받기 ─────────────────────────────
// POST /api/evac/forecast  (헤더 X-Evac-Key)
//   본문: text/csv (내일위험_YYYYMMDD.csv 그대로) 또는 JSON {rows:[...]}
//   후보 줄만 경보로 만들고, 그 읍면동 명단의 분마다 대피 칸(task)을 «계획» 상태로 만든다.
app.post("/api/evac/forecast", async (c) => {
  const key = c.env.EVAC_INGEST_KEY;
  if (!key) return c.json({ error: "EVAC_INGEST_KEY not set" }, 503);
  if (!safeEqual(c.req.header("X-Evac-Key") || "", key)) return c.json({ error: "forbidden" }, 403);
  await ready(c.env.DB);

  const ctype = c.req.header("Content-Type") || "";
  let rows: ForecastRow[];
  if (ctype.includes("text/csv") || ctype.includes("text/plain")) rows = parseForecastCsv(await c.req.text());
  else {
    const body = await c.req.json<{ rows?: Record<string, unknown>[] }>();
    rows = (body.rows || []).map(normalizeRow);
  }
  const cands = rows.filter(isDispatchCandidate).filter((r) => r.emd_code && r.target_day && r.hazard);

  let alertsNew = 0, alertsUpdated = 0, tasksNew = 0, watchNotices = 0;
  const touched: string[] = [];
  for (const r of cands) {
    const id = alertKey(r);
    const stage = alertStage(r);
    const prev = await c.env.DB.prepare("SELECT id, stage, status FROM onda_evac_alerts WHERE id = ?").bind(id)
      .first<{ id: string; stage: string; status: string }>();
    if (!prev) {
      await c.env.DB.prepare(
        `INSERT OR IGNORE INTO onda_evac_alerts (id, target_day, hazard, emd_code, sido, sgg, emd, run, level, already, rank, n,
           pop, a65, a80, deadline_at, shelter_name, shelter_lat, shelter_lon, shelter_km, stage, issued_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      ).bind(id, r.target_day, r.hazard, r.emd_code, r.sido, r.sgg, r.emd, r.run, r.level, r.already, r.rank, r.n,
             r.pop, r.a65, r.a80, deadlineIso(r), r.shelter_name, r.shelter_lat, r.shelter_lon, r.shelter_km,
             stage, r.issued_at).run();
      alertsNew++;
    } else {
      // 새벽판이 오면 갱신. 단계는 올라가기만(watch → evacuate_now), 이미 «대피 시작»한 경보는 상태 유지.
      const nextStage = prev.stage === "evacuate_now" ? "evacuate_now" : stage;
      await c.env.DB.prepare(
        `UPDATE onda_evac_alerts SET run=?, level=?, already=?, rank=?, n=?, pop=?, a65=?, a80=?,
           shelter_name=COALESCE(NULLIF(?, ''), shelter_name), shelter_lat=COALESCE(?, shelter_lat),
           shelter_lon=COALESCE(?, shelter_lon), shelter_km=COALESCE(?, shelter_km),
           stage=?, issued_at=?, updated_at=datetime('now') WHERE id=?`
      ).bind(r.run, r.level, r.already, r.rank, r.n, r.pop, r.a65, r.a80, r.shelter_name, r.shelter_lat,
             r.shelter_lon, r.shelter_km, nextStage, r.issued_at, id).run();
      alertsUpdated++;
    }
    touched.push(id);

    // 그 읍면동 명단 → 대피 칸(와상은 2칸)
    const people = await c.env.DB.prepare(
      "SELECT id, name, mobility, helper_id FROM onda_evac_people WHERE emd_code = ? AND status = 'active'"
    ).bind(r.emd_code).all<{ id: string; name: string; mobility: Mobility; helper_id: string | null }>();
    for (const p of people.results) {
      const slots = p.mobility === "bed" ? 2 : 1;
      for (let s = 1; s <= slots; s++) {
        const res = await c.env.DB.prepare(
          "INSERT OR IGNORE INTO onda_evac_tasks (id, alert_id, person_id, slot, grade) VALUES (?, ?, ?, ?, ?)"
        ).bind(crypto.randomUUID(), id, p.id, s, p.mobility === "wheelchair" || p.mobility === "bed" ? "orange" : "green").run();
        if (res.meta.changes) tasksNew++;
      }
      // 새 경보일 때만 담당 도우미에게 사전 점검 알림(같은 예보로 두 번 보내지 않음)
      if (!prev && p.helper_id) {
        await notifyHelper(c.env.DB, c.env, p.helper_id,
          `[사전 점검] ${r.target_day} ${r.hazard} — ${r.emd}`,
          `${maskName(p.name)} 어르신(${MOB_KO[p.mobility] || p.mobility}) 댁 주변 대피길·배수로를 미리 살펴 주세요. 대피 마감 ${r.deadline}` +
          (r.shelter_name ? `, 대피소 ${r.shelter_name}` : ""),
          "evac_watch", false);
        watchNotices++;
      }
    }
  }
  return c.json({ ok: true, rows: rows.length, candidates: cands.length, alertsNew, alertsUpdated, tasksNew, watchNotices, alerts: touched });
});

// ───────────────────────────── 2) 대피 시작 (군청) ─────────────────────────────
// POST /api/evac/alerts/:id/start — 아직 도우미가 정해지지 않은 칸마다 출동 요청 + 제안.
//   같은 경보에 다시 누르면 «응답 없음» 칸만 다시 제안한다(다시 배정).
app.post("/api/evac/alerts/:id/start", requireAdmin(), async (c) => {
  await ready(c.env.DB);
  const alertId = decodeURIComponent(c.req.param("id") || "");
  const admin = (c as any).get("user") as { id: string };
  const alert = await c.env.DB.prepare("SELECT * FROM onda_evac_alerts WHERE id = ?").bind(alertId).first<any>();
  if (!alert) return c.json({ error: "alert not found" }, 404);

  const tasks = await loadTasks(c.env.DB, alertId);
  const open = tasks.filter((t) => t.status === "planned" || t.status === "no_answer");
  if (!open.length) return c.json({ ok: true, offered: 0, note: "no open tasks" });

  // 도우미 상태(승인·대기 중) + 마지막 위치
  const resp = await c.env.DB.prepare(
    // 예행(2026-11-23·24): «가상» 도우미는 실제 대피 부탁에서 빼고, 예행 읍면동(9999990)은 «가상» 도우미에게만
    "SELECT r.user_id, r.grade FROM onda_responders r JOIN onda_users u ON u.id = r.user_id WHERE r.status = 'approved' AND r.available = 1 AND (CASE WHEN u.name LIKE '가상%' THEN 1 ELSE 0 END) = ?"
  ).bind(alert.emd_code === REH_EMD ? 1 : 0).all<{ user_id: string; grade: Grade }>();
  const helpers: HelperState[] = [];
  for (const r of resp.results) {
    const loc = await c.env.LOCATION_KV.get(`loc:${r.user_id}`);
    const [lat, lng] = loc ? loc.split(",").map(Number) : [null, null];
    helpers.push({ user_id: r.user_id, grade: r.grade, lat: lat ?? null, lng: lng ?? null, available: true });
  }
  // 이 경보에서 제안을 받고 있거나(답 전) 이미 맡은 도우미는 뺀다 — 한 사람이 두 집에 겹치지 않게 (2026-10-26 검토 반영)
  const live = await c.env.DB.prepare(
    `SELECT DISTINCT m.responder_id FROM onda_matches m JOIN onda_evac_tasks t ON t.request_id = m.request_id
      WHERE t.alert_id = ? AND m.status IN ('offered','accepted','moving','arrived','in_progress')`
  ).bind(alertId).all<{ responder_id: string }>();
  const busy = new Set<string>(live.results.map((x) => x.responder_id));
  // 그 칸을 이미 거절했거나 응답 없이 만료된 도우미는 같은 칸에 다시 부르지 않는다
  const declinedByTask = new Map<string, Set<string>>();
  for (const t of open) {
    if (!t.request_id) continue;
    const d = await c.env.DB.prepare(
      "SELECT responder_id FROM onda_matches WHERE request_id = ? AND status IN ('rejected','expired','cancelled')"
    ).bind(t.request_id).all<{ responder_id: string }>();
    declinedByTask.set(t.id, new Set(d.results.map((x) => x.responder_id)));
  }

  // 사람 단위로 계획(와상 2칸은 한 사람으로 묶어 2+여유 명 제안 후 칸에 나눔)
  const personIds = [...new Set(open.map((t) => t.person_id))];
  const people: EvacPerson[] = [];
  for (const pid of personIds) {
    const p = await c.env.DB.prepare("SELECT * FROM onda_evac_people WHERE id = ?").bind(pid).first<any>();
    if (p) people.push({ id: p.id, emd_code: p.emd_code, name: p.name, mobility: p.mobility, lat: p.lat, lng: p.lng, helper_id: p.helper_id });
  }
  // 사람 단위로 거절한 도우미를 모아 그 사람 계획에서만 뺀다
  const declinedByPerson = new Map<string, Set<string>>();
  for (const t of open) {
    const s0 = declinedByPerson.get(t.person_id) || new Set<string>();
    (declinedByTask.get(t.id) || new Set()).forEach((u) => s0.add(u));
    declinedByPerson.set(t.person_id, s0);
  }
  const plans = planForAlert(people, helpers, { busy, exclude: declinedByPerson });

  const urgency = alert.stage === "evacuate_now" ? "emergency" : "urgent";
  let offered = 0, shortfall = 0;
  for (const plan of plans) {
    const person = people.find((p) => p.id === plan.person_id)!;
    const myOpen = open.filter((t) => t.person_id === plan.person_id).sort((a, b) => a.slot - b.slot);
    if (plan.shortfall) shortfall++;
    // 칸마다 제안 나누기: 칸 k 는 offers[k], offers[k+slots], ... (와상 2칸이 같은 사람에게 중복 제안되지 않게)
    for (let k = 0; k < myOpen.length; k++) {
      const t = myOpen[k];
      const mine = plan.offers.filter((_, i) => i % myOpen.length === k);
      let requestId = t.request_id;
      if (!requestId) {
        requestId = crypto.randomUUID();
        // 칸을 먼저 잡는다 — «대피 시작»이 동시에 두 번 눌려도 한 칸에 요청이 하나만 생기게 (2026-10-26 검토 반영)
        const claim = await c.env.DB.prepare("UPDATE onda_evac_tasks SET request_id = ? WHERE id = ? AND request_id IS NULL")
          .bind(requestId, t.id).run();
        if (!claim.meta.changes) continue;
        const desc = `[다올 대피] ${alert.hazard} ${alert.sgg} ${alert.emd} — ${maskName(person.name)} 어르신(${MOB_KO[person.mobility]})` +
          ` → ${alert.shelter_name || "지정 대피소"} / 마감 ${koDeadline(alert.deadline_at)}` + (myOpen.length > 1 ? ` (${t.slot}/${myOpen.length}번째 도우미)` : "");
        await c.env.DB.prepare(
          `INSERT INTO onda_requests (id, requester_id, type, address, lat, lng, description, grade_required, source, urgency)
           VALUES (?, ?, 'elder', ?, ?, ?, ?, ?, 'evac_forecast', ?)`
        ).bind(requestId, await requesterFor(c.env.DB, person.id), "", person.lat, person.lng, desc, plan.grade, urgency).run();
      } else {
        await c.env.DB.prepare("UPDATE onda_requests SET status = 'pending' WHERE id = ? AND status = 'cancelled'").bind(requestId).run();
      }
      for (const o of mine) {
        const matchId = crypto.randomUUID();
        await c.env.DB.prepare("INSERT INTO onda_matches (id, request_id, responder_id, status) VALUES (?, ?, ?, 'offered')")
          .bind(matchId, requestId, o.user_id).run();
        await notifyHelper(c.env.DB, c.env, o.user_id,
          `[대피 출동] ${alert.emd} ${alert.hazard}${o.preferred ? " — 담당 어르신" : ""}`,
          `${maskName(person.name)} 어르신(${MOB_KO[person.mobility]})을 모셔 주세요.\n대피소: ${alert.shelter_name || "지정 대피소"}` +
          (o.km != null ? `\n댁까지 ${o.km}km` : "") + "\n먼저 누르신 분이 맡습니다.",
          "evac_dispatch", true, matchId);
        offered++;
      }
    }
  }
  await c.env.DB.prepare(
    "UPDATE onda_evac_alerts SET status = 'started', started_at = COALESCE(started_at, datetime('now')), started_by = COALESCE(started_by, ?), updated_at = datetime('now') WHERE id = ?"
  ).bind(admin?.id || "admin", alertId).run();
  await c.env.DB.prepare(
    "INSERT INTO onda_admin_logs (admin_id, action, target_type, target_id, memo) VALUES (?, 'evac_start', 'evac_alert', ?, ?)"
  ).bind(admin?.id || "admin", alertId, JSON.stringify({ people: people.length, offered, shortfall })).run();

  return c.json({ ok: true, people: people.length, offered, shortfall });
});

// ───────────────────────────── 3) 현장 표시 (군청) ─────────────────────────────
// POST /api/evac/tasks/:id/flag  {flag: 'unreachable'|'handed_over'|'none', note?}
//   도우미가 «못 모심»을 알렸거나, 군청이 119·읍면사무소로 넘겼을 때.
app.post("/api/evac/tasks/:id/flag", requireAdmin(), async (c) => {
  await ready(c.env.DB);
  const body = await c.req.json<{ flag: string; note?: string }>();
  if (!["unreachable", "handed_over", "none"].includes(body.flag)) return c.json({ error: "bad flag" }, 400);
  const r = await c.env.DB.prepare("UPDATE onda_evac_tasks SET flag = ?, note = ? WHERE id = ?")
    .bind(body.flag, body.note || null, c.req.param("id") || "").run();
  return c.json({ ok: !!r.meta.changes });
});

// ───────────────────────────── 4) 상황판 (군청) ─────────────────────────────
// GET /api/evac/board?day=YYYY-MM-DD — 경보마다 명단 대비 완료·이동 중·남은 분
app.get("/api/evac/board", requireAdmin(), async (c) => {
  await ready(c.env.DB);
  const day = c.req.query("day");
  const alerts = await c.env.DB.prepare(
    day ? "SELECT * FROM onda_evac_alerts WHERE target_day = ? ORDER BY (stage = 'evacuate_now') DESC, a80 DESC"
        : "SELECT * FROM onda_evac_alerts WHERE status != 'closed' ORDER BY target_day DESC, (stage = 'evacuate_now') DESC, a80 DESC LIMIT 50"
  ).bind(...(day ? [day] : [])).all<any>();
  const out = [];
  for (const a of alerts.results) {
    const tasks = await loadTasks(c.env.DB, a.id);
    // 사람 단위 상태: 와상 2칸은 둘 다 대피소 도착이어야 «완료»
    const byPerson = new Map<string, TaskStatus[]>();
    tasks.forEach((t) => byPerson.set(t.person_id, [...(byPerson.get(t.person_id) || []), t.status]));
    const personStatus: TaskStatus[] = [...byPerson.values()].map(worstStatus);
    out.push({
      id: a.id, target_day: a.target_day, hazard: a.hazard, sgg: a.sgg, emd: a.emd, level: a.level,
      stage: a.stage, status: a.status, deadline_at: a.deadline_at, shelter_name: a.shelter_name,
      a65: a.a65, a80: a.a80,
      summary: summarize(personStatus),
      remaining: tasks.filter((t) => t.status !== "at_shelter").map((t) => ({
        task_id: t.id, person: t.person_name, mobility: t.mobility, slot: t.slot, status: t.status,
        helper_id: t.helper_id, helper_name: t.helper_name, note: t.note,
      })),
      moving: tasks.filter((t) => t.status === "accepted" || t.status === "arrived").map((t) => ({
        task_id: t.id, person: t.person_name, mobility: t.mobility, status: t.status, helper_name: t.helper_name,
      })),
    });
  }
  return c.json({ ok: true, alerts: out });
});

// ───────────────────────────── 4-1) 대피 결과 보고 (군청) ─────────────────────────────
// GET /api/evac/alerts/:id/report — 군청이 군수·도에 올릴 «대피 결과 보고» 자료.
//   경보 정보 · 시각(경보 접수→대피 시작→첫 수락→마지막 대피소 도착) · 어르신별 결과(도우미·도착 시각) · 못 모신 분과 조치 · 출동 비용.
//   재난안전법 «사전 지원 방안» 이행 기록으로 그대로 보관할 수 있게 한다. (2026-10-26 대표 «보고까지 전과정»)
app.get("/api/evac/alerts/:id/report", requireAdmin(), async (c) => {
  await ready(c.env.DB);
  const alertId = decodeURIComponent(c.req.param("id") || "");
  const a = await c.env.DB.prepare("SELECT * FROM onda_evac_alerts WHERE id = ?").bind(alertId).first<any>();
  if (!a) return c.json({ error: "alert not found" }, 404);
  const rows = await c.env.DB.prepare(
    `SELECT t.id AS task_id, t.slot, t.flag, t.note, t.request_id, p.name, p.mobility, p.address
       FROM onda_evac_tasks t LEFT JOIN onda_evac_people p ON p.id = t.person_id
      WHERE t.alert_id = ? ORDER BY p.name, t.slot`
  ).bind(alertId).all<any>();
  const people: any[] = [];
  let firstAccept: string | null = null, lastShelter: string | null = null, cost = 0;
  for (const r of rows.results) {
    let m: any = null;
    if (r.request_id) {
      m = await c.env.DB.prepare(
        `SELECT m.id, m.status, m.accepted_at, m.arrived_at, m.started_at, m.completed_at, m.duration_min, u.name AS helper_name, rs.grade
           FROM onda_matches m LEFT JOIN onda_users u ON u.id = m.responder_id LEFT JOIN onda_responders rs ON rs.user_id = m.responder_id
          WHERE m.request_id = ? AND m.status IN ('accepted','moving','arrived','in_progress','completed')
          ORDER BY m.accepted_at LIMIT 1`
      ).bind(r.request_id).first<any>();
      if (m?.id) {
        const st = await c.env.DB.prepare("SELECT amount FROM onda_settlements WHERE match_id = ?").bind(m.id).first<{ amount: number }>();
        cost += st?.amount || 0;
      }
    }
    if (m?.accepted_at && (!firstAccept || m.accepted_at < firstAccept)) firstAccept = m.accepted_at;
    if (m?.completed_at && (!lastShelter || m.completed_at > lastShelter)) lastShelter = m.completed_at;
    const result = r.flag === "handed_over" ? "119·읍면사무소 연계" : r.flag === "unreachable" ? "못 모심"
      : m?.status === "completed" ? "대피 완료" : m ? "진행 중" : "미배정";
    people.push({
      name: r.name, mobility: MOB_KO[r.mobility as Mobility] || r.mobility, slot: r.slot, result,
      helper: m?.helper_name || null, grade: m?.grade || null,
      accepted_at: m?.accepted_at || null, arrived_at: m?.arrived_at || null, sheltered_at: m?.completed_at || null,
      note: r.note || null,
    });
  }
  // 사람 단위로 묶어 센다(와상 2칸은 둘 다 완료여야 완료)
  const byName = new Map<string, string[]>();
  people.forEach((p) => byName.set(p.name, [...(byName.get(p.name) || []), p.result]));
  const personResults = [...byName.values()].map((rs) =>
    rs.every((x) => x === "대피 완료") ? "대피 완료" : rs.find((x) => x === "못 모심" || x === "119·읍면사무소 연계") || "진행 중");
  const count = (k: string) => personResults.filter((x) => x === k).length;
  return c.json({
    ok: true,
    alert: {
      id: a.id, target_day: a.target_day, hazard: a.hazard, sido: a.sido, sgg: a.sgg, emd: a.emd, level: a.level,
      stage: a.stage, shelter_name: a.shelter_name, a65: a.a65, a80: a.a80, deadline_at: a.deadline_at,
      received_at: a.created_at, started_at: a.started_at, started_by: a.started_by,
    },
    timeline: { received_at: a.created_at, started_at: a.started_at, first_accept_at: firstAccept, last_shelter_at: lastShelter },
    totals: { people: personResults.length, done: count("대피 완료"), handed_over: count("119·읍면사무소 연계"),
              unreachable: count("못 모심"), in_progress: count("진행 중"), helpers: new Set(people.map((p) => p.helper).filter(Boolean)).size,
              cost_krw: cost },
    people,
    generated_at: new Date().toISOString(),
  });
});

// ───────────────────────────── 5) 명단 등록 (군청) ─────────────────────────────
// POST /api/evac/people {emd_code, name, mobility, lat, lng, helper_id?, contract_id?, beneficiary_id?, address?, notes?}
app.post("/api/evac/people", requireAdmin(), async (c) => {
  await ready(c.env.DB);
  const b = await c.req.json<any>();
  if (!b.emd_code || !b.name) return c.json({ error: "emd_code and name required" }, 400);
  const mobility: Mobility = MOBILITY.has(b.mobility) ? b.mobility : "assist"; // 모르면 부축 필요로(보수적)
  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO onda_evac_people (id, contract_id, beneficiary_id, emd_code, name, mobility, address, lat, lng, helper_id, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, b.contract_id || null, b.beneficiary_id || null, String(b.emd_code), b.name, mobility, b.address || "",
         Number(b.lat) || 0, Number(b.lng) || 0, b.helper_id || null, b.notes || "").run();
  return c.json({ ok: true, id, mobility });
});

// GET /api/evac/people?emd_code=
app.get("/api/evac/people", requireAdmin(), async (c) => {
  await ready(c.env.DB);
  const emd = c.req.query("emd_code");
  const r = await c.env.DB.prepare(
    emd ? "SELECT * FROM onda_evac_people WHERE emd_code = ? AND status = 'active'" : "SELECT * FROM onda_evac_people WHERE status = 'active' LIMIT 500"
  ).bind(...(emd ? [emd] : [])).all();
  return c.json({ ok: true, people: r.results });
});

// ───────────────────────────── 내부 ─────────────────────────────
/**
 * 출동 요청의 «요청자»: 명단에 지자체 수혜자(onda_gov_beneficiaries)가 이어져 있으면 그 수혜자 계정으로 —
 * 그래야 기존 «완료» 흐름의 지자체 대납(onda_gov_contracts.spent)이 그대로 돈다. 없으면 evac_system.
 */
async function requesterFor(db: D1Database, personId: string): Promise<string> {
  const r = await db.prepare(
    `SELECT b.user_id FROM onda_evac_people p JOIN onda_gov_beneficiaries b ON b.id = p.beneficiary_id
      WHERE p.id = ? AND b.status = 'active'`
  ).bind(personId).first<{ user_id: string }>();
  return r?.user_id || "evac_system";
}

interface TaskView {
  id: string; person_id: string; slot: number; request_id: string | null; flag: string; note: string | null;
  person_name: string; mobility: Mobility; status: TaskStatus; helper_id: string | null; helper_name: string | null;
}

async function loadTasks(db: D1Database, alertId: string): Promise<TaskView[]> {
  const rows = await db.prepare(
    `SELECT t.id, t.person_id, t.slot, t.request_id, t.flag, t.note, p.name AS person_name, p.mobility
       FROM onda_evac_tasks t LEFT JOIN onda_evac_people p ON p.id = t.person_id
      WHERE t.alert_id = ? ORDER BY p.mobility, t.person_id, t.slot`
  ).bind(alertId).all<any>();
  const out: TaskView[] = [];
  for (const t of rows.results) {
    let statuses: string[] = [];
    let helper: string | null = null;
    if (t.request_id) {
      const m = await db.prepare("SELECT responder_id, status FROM onda_matches WHERE request_id = ?")
        .bind(t.request_id).all<{ responder_id: string; status: string }>();
      statuses = m.results.map((x) => x.status);
      helper = m.results.find((x) => !["offered", "expired", "rejected", "cancelled"].includes(x.status))?.responder_id || null;
    }
    const helperName = helper
      ? (await db.prepare("SELECT name FROM onda_users WHERE id = ?").bind(helper).first<{ name: string }>())?.name || null
      : null;
    out.push({
      id: t.id, person_id: t.person_id, slot: t.slot, request_id: t.request_id, flag: t.flag, note: t.note,
      person_name: t.person_name, mobility: t.mobility, helper_id: helper, helper_name: helperName,
      status: deriveTaskStatus(statuses, (t.flag || "none") as any, !t.request_id),
    });
  }
  return out;
}

const ORDER: TaskStatus[] = ["unreachable", "handed_over", "no_answer", "planned", "offered", "accepted", "arrived", "at_shelter"];
/**
 * 여러 칸(와상 2명)의 상태 → 그 사람의 상태.
 * 모두 대피소 도착이면 완료, 하나라도 못 모심·넘김이면 그것, 하나라도 가는 중·모시는 중이면 «이동 중», 나머지는 가장 뒤처진 상태.
 * (2026-10-26 로컬 검토: 와상 어르신 한 칸이 도착했는데 «이동 중 0»으로 보이던 것 고침)
 */
export function worstStatus(s: TaskStatus[]): TaskStatus {
  if (s.every((x) => x === "at_shelter")) return "at_shelter";
  const failed = s.find((x) => x === "unreachable" || x === "handed_over");
  if (failed) return failed;
  if (s.includes("arrived")) return "arrived";
  if (s.includes("accepted")) return "accepted";
  // 한 칸만 끝나고 남은 칸이 아직 사람을 못 찾았으면 남은 칸 상태(대기·응답 없음)로 — «다시 배정»에 잡히게
  return s.filter((x) => x !== "at_shelter").reduce((w, x) => (ORDER.indexOf(x) < ORDER.indexOf(w) ? x : w), "at_shelter" as TaskStatus);
}

export { app as evacRoutes };
