// 온다 텔레그램판 예행(목표 2, 2026-11-23 Claude) — 실서버에서 가상 사람으로 처음부터 끝까지 돌려 보고 지운다
//  POST /api/tg/rehearse/setup  {helpers:["가상…"], ops:"reh-…"}  가상 도우미(승인됨)·예행 상황실 링크
//  POST /api/tg/rehearse/clear  가상 사람과 그 사람들의 요청·출동·정산·기록을 모두 지움
// 열쇠: TG_REH_TOKEN(비밀값, 사무실 PC .cf-tokens 에만). 없으면 404. 이름이 «가상»으로 시작하는 사람만 만들고 지운다.
// 가상 어르신 일은 가상 도우미·예행 상황실(ops:reh…)에만 가고, 실제 사람 일에는 가상 도우미가 끼지 않는다(dispatch.ts·core.ts·evacRoutes.ts).
import { Hono } from "hono";
import { ensureAllTables } from "../../utils/db";
import { type TgEnv, tg, ensureTgCareTables, roomOf, opsRoom, REH_OPS_PREFIX } from "./core";
import { signToken } from "../../utils/auth";
import { evacRoutes, REH_EMD } from "../evac-dispatch/evacRoutes";

const app = new Hono<{ Bindings: TgEnv }>();
const enc = new TextEncoder();
async function okKey(env: TgEnv, h: string | undefined) {
  if (!env.TG_REH_TOKEN || env.TG_REH_TOKEN.length < 32 || !h?.startsWith("Bearer ")) return false;
  const [a, b] = await Promise.all([h.slice(7), env.TG_REH_TOKEN].map((x) => crypto.subtle.digest("SHA-256", enc.encode(x))));
  const x = new Uint8Array(a), y = new Uint8Array(b); let r = 0; for (let i = 0; i < x.length; i++) r |= x[i] ^ y[i]; return r === 0;
}
async function rehTable(db: D1Database) {
  await db.prepare("CREATE TABLE IF NOT EXISTS onda_tgc_rehearsal (user_id TEXT PRIMARY KEY, created_at TEXT DEFAULT (datetime('now')))").run();
}

app.post("/api/tg/rehearse/setup", async (c) => {
  if (!(await okKey(c.env, c.req.header("authorization")))) return c.json({ error: "not found" }, 404);
  const t = tg(c.env); if (!t) return c.json({ error: "telegram not configured" }, 503);
  await ensureAllTables(c.env.DB); await ensureTgCareTables(c.env.DB); await rehTable(c.env.DB);
  const b = await c.req.json<{ helpers?: string[]; ops?: string }>().catch(() => ({} as any));
  const names = (b.helpers || []).map((x: string) => String(x).trim().slice(0, 40));
  if (!names.length || names.length > 5 || !names.every((n: string) => n.startsWith("가상"))) return c.json({ error: "도우미 이름은 «가상»으로 시작, 1~5명" }, 400);
  const opsName = String(b.ops || "reh-main").replace(/[^\w.-]/g, "").slice(0, 40);
  if (!opsRoom(opsName).startsWith(REH_OPS_PREFIX)) return c.json({ error: "예행 상황실 이름은 reh 로 시작" }, 400);
  await c.env.DB.prepare("INSERT OR IGNORE INTO onda_tgc_people (room_key, user_id, kind) VALUES (?, NULL, 'ops')").bind(opsRoom(opsName)).run();
  const ops = await t.startLink(opsRoom(opsName), 6);
  const helpers = [];
  for (const n of names) {
    const id = crypto.randomUUID();
    await c.env.DB.prepare("INSERT INTO onda_users (id, name, role, phone, region) VALUES (?, ?, 'responder', '', 'KR')").bind(id, n).run();
    await c.env.DB.prepare("INSERT INTO onda_responders (user_id, grade, status, available) VALUES (?, 'green', 'approved', 0)").bind(id).run();
    await c.env.DB.prepare("INSERT OR IGNORE INTO onda_tgc_people (room_key, user_id, kind) VALUES (?, ?, 'helper')").bind(roomOf(id), id).run();
    await c.env.DB.prepare("INSERT OR IGNORE INTO onda_tgc_rehearsal (user_id) VALUES (?)").bind(id).run();
    const { url } = await t.startLink(roomOf(id), 6);
    helpers.push({ id, name: n, url });
  }
  return c.json({ ok: true, ops: { room: opsRoom(opsName), url: ops.url }, helpers });
});

// 다올(이웃대피) 예행 — 가상 읍면동 9999990 에 가상 어르신 한 분, 예보, 대피 시작. 기존 다올 입구를 안에서 그대로 부른다
//  POST /api/tg/rehearse/evac {stage:"prep", helperId} → 명단·예보(담당 도우미 사전 점검 알림) / {stage:"start"} → 대피 시작(출동 부탁)
app.post("/api/tg/rehearse/evac", async (c) => {
  if (!(await okKey(c.env, c.req.header("authorization")))) return c.json({ error: "not found" }, 404);
  const env = c.env as any;
  const b = await c.req.json<{ stage?: string; helperId?: string }>().catch(() => ({} as any));
  const helper = b.helperId ? await c.env.DB.prepare("SELECT u.name FROM onda_tgc_rehearsal r JOIN onda_users u ON u.id = r.user_id WHERE r.user_id = ?").bind(b.helperId).first<{ name: string }>() : null;
  const now = Math.floor(Date.now() / 1000);
  const adm = await signToken({ sub: "reh_admin", role: "admin", name: "예행", type: "access", iat: now, exp: now + 60 }, c.env.JWT_SECRET);   // 안에서만 쓰는 1분짜리
  const call = (path: string, init: RequestInit) => evacRoutes.request(path, init, c.env);
  const day = new Date(Date.now() + 9 * 3600e3 + 86400e3).toISOString().slice(0, 10);
  const alertId = `${day}|큰비|${REH_EMD}`;
  if (b.stage === "prep") {
    if (!helper?.name?.startsWith("가상")) return c.json({ error: "예행 도우미만" }, 400);
    const p = await call("/api/evac/people", { method: "POST", headers: { Authorization: `Bearer ${adm}`, "Content-Type": "application/json" },
      body: JSON.stringify({ emd_code: REH_EMD, name: "가상대피", mobility: "walk", lat: 35.871, lng: 128.601, helper_id: b.helperId }) });
    if (!p.ok) return c.json({ error: "명단 실패 " + p.status }, 500);
    if (!env.EVAC_INGEST_KEY) return c.json({ error: "EVAC_INGEST_KEY 없음" }, 503);
    const head = "issued_at,target_day,run,hazard,emd_code,sido,sgg,emd,rank,n,level,already,pop,a65,a80,deadline,shelter_name,shelter_lat,shelter_lon,shelter_km";
    const f = await call("/api/evac/forecast", { method: "POST", headers: { "Content-Type": "text/csv", "X-Evac-Key": env.EVAC_INGEST_KEY },
      body: `${head}\n${new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 16)}+09:00,${day},전날판,큰비,${REH_EMD},가상시,가상구,가상동,40,3482,상위5%,0,2100,980,310,18:00,가상동 경로당,,,` });
    return c.json({ ok: f.ok, alertId, forecast: await f.json().catch(() => null) });
  }
  if (b.stage === "start") {
    const r = await call(`/api/evac/alerts/${encodeURIComponent(alertId)}/start`, { method: "POST", headers: { Authorization: `Bearer ${adm}`, "Content-Type": "application/json" }, body: "{}" });
    return c.json({ ok: r.ok, alertId, start: await r.json().catch(() => null) });
  }
  return c.json({ error: "stage = prep | start" }, 400);
});

// 지울 때 볼 칸 — 사람 번호·요청 번호가 들어가는 칸 이름
const PERSON_COLS = ["user_id", "requester_id", "responder_id", "elder_id", "family_id", "enrolled_by", "asked_by", "reviewer_id", "reviewee_id", "sender_id", "target_id", "reporter_id", "helper_id"];
const REQ_COLS = ["request_id"];
const MATCH_COLS = ["match_id"];

app.post("/api/tg/rehearse/clear", async (c) => {
  if (!(await okKey(c.env, c.req.header("authorization")))) return c.json({ error: "not found" }, 404);
  const db = c.env.DB;
  await ensureAllTables(db); await ensureTgCareTables(db); await rehTable(db);
  const col = async (sql: string, ...a: unknown[]) => (await db.prepare(sql).bind(...a).all<{ v: string }>()).results.map((r) => r.v);
  // 1) 예행으로 만든 도우미(이름 «가상»만) 2) 그 도우미가 등록한 가상 어르신 3) 그 어르신의 가족
  const helpers = await col("SELECT r.user_id AS v FROM onda_tgc_rehearsal r JOIN onda_users u ON u.id = r.user_id WHERE u.name LIKE '가상%'");
  const ph = (n: number) => Array(n).fill("?").join(",");
  const elders = helpers.length ? await col(`SELECT e.elder_id AS v FROM onda_tgc_elders e JOIN onda_users u ON u.id = e.elder_id WHERE u.name LIKE '가상%' AND e.enrolled_by IN (${ph(helpers.length)})`, ...helpers) : [];
  const family = elders.length ? await col(`SELECT family_id AS v FROM onda_tgc_family WHERE elder_id IN (${ph(elders.length)})`, ...elders) : [];
  const people = [...new Set([...helpers, ...elders, ...family])];
  if (!people.length) {
    try { await db.prepare("DELETE FROM onda_evac_tasks WHERE alert_id IN (SELECT id FROM onda_evac_alerts WHERE emd_code = ?)").bind(REH_EMD).run(); await db.prepare("DELETE FROM onda_evac_alerts WHERE emd_code = ?").bind(REH_EMD).run(); await db.prepare("DELETE FROM onda_evac_people WHERE emd_code = ?").bind(REH_EMD).run(); } catch {}
    const o = await db.prepare(`DELETE FROM onda_tgc_people WHERE room_key LIKE '${REH_OPS_PREFIX}%'`).run();
    return c.json({ ok: true, people: 0, ops: o.meta?.changes ?? 0 });
  }
  let reqs = await col(`SELECT id AS v FROM onda_requests WHERE requester_id IN (${ph(people.length)})
    UNION SELECT request_id AS v FROM onda_tgc_dispatch WHERE elder_id IN (${ph(people.length)})`, ...people, ...people);
  // 다올 예행(가상 읍면동) 대피 요청·칸·명단·경보
  let evac: string[] = [];
  try {
    evac = await col(`SELECT t.request_id AS v FROM onda_evac_tasks t JOIN onda_evac_alerts a ON a.id = t.alert_id WHERE a.emd_code = ? AND t.request_id IS NOT NULL`, REH_EMD);
    reqs = [...new Set([...reqs, ...evac])];
  } catch {}
  const matches = reqs.length ? await col(`SELECT id AS v FROM onda_matches WHERE request_id IN (${ph(reqs.length)})`, ...reqs) : [];
  const tables = (await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'onda_%'").all<{ name: string }>()).results.map((r) => r.name);
  const removed: Record<string, number> = {};
  const del = async (table: string, column: string, ids: string[]) => {
    for (let i = 0; i < ids.length; i += 50) {
      const part = ids.slice(i, i + 50);
      const r = await db.prepare(`DELETE FROM ${table} WHERE ${column} IN (${ph(part.length)})`).bind(...part).run();
      const n = r.meta?.changes ?? 0; if (n) removed[table] = (removed[table] || 0) + n;
    }
  };
  for (const table of tables) {
    if (!/^onda_[a-z_]+$/.test(table)) continue;
    const cols = (await db.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>()).results.map((r) => r.name);
    for (const cn of cols) {
      if (MATCH_COLS.includes(cn) && matches.length) await del(table, cn, matches);
      if (REQ_COLS.includes(cn) && reqs.length) await del(table, cn, reqs);
      if (PERSON_COLS.includes(cn)) await del(table, cn, people);
    }
  }
  if (matches.length) await del("onda_matches", "id", matches);
  if (reqs.length) await del("onda_requests", "id", reqs);
  await del("onda_tgc_people", "room_key", people.map(roomOf));
  const o = await db.prepare(`DELETE FROM onda_tgc_people WHERE room_key LIKE '${REH_OPS_PREFIX}%'`).run();
  removed.ops_rooms = o.meta?.changes ?? 0;
  try {
    const t1 = await db.prepare("DELETE FROM onda_evac_tasks WHERE alert_id IN (SELECT id FROM onda_evac_alerts WHERE emd_code = ?)").bind(REH_EMD).run();
    const t2 = await db.prepare("DELETE FROM onda_evac_alerts WHERE emd_code = ?").bind(REH_EMD).run();
    const t3 = await db.prepare("DELETE FROM onda_evac_people WHERE emd_code = ?").bind(REH_EMD).run();
    removed.evac = (t1.meta?.changes ?? 0) + (t2.meta?.changes ?? 0) + (t3.meta?.changes ?? 0);
  } catch {}
  await del("onda_users", "id", people);
  for (const id of people) { try { await c.env.LOCATION_KV.delete(`loc:${id}`); } catch {} }
  return c.json({ ok: true, people: people.length, requests: reqs.length, matches: matches.length, removed });
});

// 예행 입구에서 난 오류는 열쇠 가진 쪽에만 이유를 돌려준다(고치기 쉽게)
app.onError((e, c) => c.json({ error: String((e as Error)?.message || e).slice(0, 300) }, 500));

export { app as tgRehearseRoutes };
