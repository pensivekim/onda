// 온다 시연(2026-11-26 Claude, 대표 «한번 시연으로 감동을 안겨줄 수 있도록») — 휴대폰 앞 라이터 불꽃 → 보호자 텔레그램 → 온다 도우미 출동
//  POST /api/tg/demo/setup   [TG_REH_TOKEN] 시연 어르신·가족 링크·시연 도우미(승인됨) 링크·시연 열쇠(한 번만 보여 줌)
//  POST /api/tg/demo/alarm   [시연 열쇠] 시연 어르신에게 «불꽃 감지» → 가족 알림 + 위급 출동 (기존 출동 줄 그대로)
//  GET  /api/tg/demo/status  [시연 열쇠] 진행 상태(좌표 없이, 거리만 50m 단위)
//  POST /api/tg/demo/reset   [시연 열쇠] 지금 시연 건 마치기(다시 해 보기)
//  POST /api/tg/demo/clear   [TG_REH_TOKEN] 시연 사람·요청·기록 모두 지우기
//  POST /api/tg/shadow       [시연 열쇠] 말벗 낙상 «그림자 모드»(경보 없이 기록만) — 시각·판정 이름·속도만 받음(사진·영상·위치 없음) (2026-11-28)
//  GET  /api/tg/shadow/sum   [TG_REH_TOKEN] 그림자 기록 최근 7일
// 실제 어르신·도우미와 섞이지 않게: 시연 사람은 이름이 «가상»(기존 예행 구분 그대로)이고 지역을 'XD' 로 둔다
//  → 실제 어르신(KR) 일에 시연 도우미가 끼지 않고, 예행 가상 어르신(KR) 일에도 시연 도우미(실제 휴대폰)가 끼지 않는다.
// 실제 말벗 경보 길(hi-alert)·출동 코드(dispatch.ts)는 고치지 않았다.
import { Hono } from "hono";
import { ensureAllTables } from "../../utils/db";
import { type TgEnv, tg, ensureTgCareTables, roomOf, mask, familyRooms, sendMany } from "./core";
import { createTgRequest, markEmergency } from "./dispatch";

export const DEMO_REGION = "XD";
const app = new Hono<{ Bindings: TgEnv }>();
const enc = new TextEncoder();
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
const sha = async (s: string) => hex(await crypto.subtle.digest("SHA-256", enc.encode(s)));
function same(a: string, b: string) { if (a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; }
async function adminKey(env: TgEnv, h: string | undefined) {
  if (!env.TG_REH_TOKEN || env.TG_REH_TOKEN.length < 32 || !h?.startsWith("Bearer ")) return false;
  return same(await sha(h.slice(7)), await sha(env.TG_REH_TOKEN));
}
async function tables(db: D1Database) {
  await ensureAllTables(db); await ensureTgCareTables(db);
  await db.prepare(`CREATE TABLE IF NOT EXISTS onda_tgc_demo (
    user_id TEXT PRIMARY KEY, kind TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now')))`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS onda_tgc_demo_cfg (
    id INTEGER PRIMARY KEY CHECK (id = 1), key_sha TEXT NOT NULL, elder_id TEXT NOT NULL, expires_at INTEGER NOT NULL)`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS onda_tgc_shadow (
    id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT DEFAULT (datetime('now')), ev TEXT NOT NULL, judge TEXT, ms INTEGER, fps REAL, n INTEGER, dev TEXT)`).run();
}
/** 시연 열쇠 확인 → 시연 어르신 id (기한 지나면 닫힘) */
async function demoElder(env: TgEnv, key: string | undefined): Promise<string | null> {
  if (!key || key.length < 32 || key.length > 128) return null;
  await tables(env.DB);
  const cfg = await env.DB.prepare("SELECT key_sha, elder_id, expires_at FROM onda_tgc_demo_cfg WHERE id = 1").first<{ key_sha: string; elder_id: string; expires_at: number }>();
  if (!cfg || cfg.expires_at < Date.now() / 1000) return null;
  return same(await sha(key), cfg.key_sha) ? cfg.elder_id : null;
}
const isDemoName = (n: unknown) => typeof n === "string" && n.trim().startsWith("가상") && n.trim().length <= 40;

app.post("/api/tg/demo/setup", async (c) => {
  if (!(await adminKey(c.env, c.req.header("authorization")))) return c.json({ error: "not found" }, 404);
  const t = tg(c.env); if (!t) return c.json({ error: "telegram not configured" }, 503);
  const db = c.env.DB; await tables(db);
  if (await db.prepare("SELECT 1 FROM onda_tgc_demo LIMIT 1").first()) return c.json({ error: "이미 시연 준비가 있습니다 — clear 먼저" }, 409);
  const b = await c.req.json<any>().catch(() => ({}));
  const elder = b.elder || {}; const helpers: string[] = Array.isArray(b.helpers) ? b.helpers : [];
  const families: string[] = Array.isArray(b.family) ? b.family : ["가족"];
  if (!isDemoName(elder.name)) return c.json({ error: "어르신 이름은 «가상»으로 시작" }, 400);
  if (!helpers.length || helpers.length > 12 || !helpers.every(isDemoName)) return c.json({ error: "도우미 이름은 «가상»으로 시작, 1~12명" }, 400);
  if (!families.length || families.length > 3) return c.json({ error: "가족 1~3" }, 400);
  const hours = Math.min(Math.max(Number(b.hours) || 72, 1), 24 * 14);
  const mk = async (name: string, role: string, extra: { address?: string; lat?: number; lng?: number } = {}) => {
    const id = crypto.randomUUID();
    await db.prepare("INSERT INTO onda_users (id, name, role, phone, address, lat, lng, region) VALUES (?, ?, ?, '', ?, ?, ?, ?)")
      .bind(id, name.trim().slice(0, 40), role, (extra.address || "").slice(0, 200), Number(extra.lat) || 0, Number(extra.lng) || 0, DEMO_REGION).run();
    return id;
  };
  const out: any = { helpers: [], family: [] };
  const hIds: string[] = [];
  for (const n of helpers) {
    const id = await mk(n, "responder");
    await db.prepare("INSERT INTO onda_responders (user_id, grade, status, available) VALUES (?, 'green', 'approved', 0)").bind(id).run();
    await db.prepare("INSERT OR IGNORE INTO onda_tgc_people (room_key, user_id, kind) VALUES (?, ?, 'helper')").bind(roomOf(id), id).run();
    await db.prepare("INSERT INTO onda_tgc_demo (user_id, kind) VALUES (?, 'helper')").bind(id).run();
    hIds.push(id);
    out.helpers.push({ name: n.trim(), url: (await t.startLink(roomOf(id), Math.min(hours, 72))).url });
  }
  const elderId = await mk(elder.name, "requester", elder);
  await db.prepare("INSERT INTO onda_tgc_elders (elder_id, enrolled_by, notes) VALUES (?, ?, '시연')").bind(elderId, hIds[0]).run();
  await db.prepare("INSERT OR IGNORE INTO onda_tgc_people (room_key, user_id, kind) VALUES (?, ?, 'elder')").bind(roomOf(elderId), elderId).run();
  await db.prepare("INSERT INTO onda_tgc_demo (user_id, kind) VALUES (?, 'elder')").bind(elderId).run();
  for (const rel of families) {
    const famId = await mk("가상 가족", "requester");
    await db.prepare("INSERT INTO onda_tgc_family (elder_id, family_id, relation) VALUES (?, ?, ?)").bind(elderId, famId, String(rel).slice(0, 20)).run();
    await db.prepare("INSERT OR IGNORE INTO onda_tgc_people (room_key, user_id, kind) VALUES (?, ?, 'family')").bind(roomOf(famId), famId).run();
    await db.prepare("INSERT INTO onda_tgc_demo (user_id, kind) VALUES (?, 'family')").bind(famId).run();
    out.family.push({ relation: String(rel).slice(0, 20), url: (await t.startLink(roomOf(famId), Math.min(hours, 72))).url });
  }
  const key = hex(crypto.getRandomValues(new Uint8Array(24)).buffer);
  await db.prepare("INSERT OR REPLACE INTO onda_tgc_demo_cfg (id, key_sha, elder_id, expires_at) VALUES (1, ?, ?, ?)")
    .bind(await sha(key), elderId, Math.floor(Date.now() / 1000) + hours * 3600).run();
  return c.json({ ok: true, key, hours, ...out });
});

const FIRE_TEXT = "🔥 말벗이 어르신 댁에서 «불꽃»을 감지했습니다. 가까운 온다 도우미를 바로 부릅니다. (시연)";
const FALL_TEXT = "🆘 말벗이 어르신 댁에서 «넘어짐»을 감지했습니다. 가까운 온다 도우미를 바로 부릅니다. (시연)";   // ?kind=fall (낙상 지킴 시연, 11-27)
app.post("/api/tg/demo/alarm", async (c) => {
  const elderId = await demoElder(c.env, c.req.header("x-demo-key"));
  if (!elderId) return c.json({ error: "not found" }, 404);
  if (!tg(c.env)) return c.json({ error: "telegram not configured" }, 503);
  const k = "demo:alarm";   // 한 번 울린 뒤 20초는 다시 안 울림(같은 불꽃이 여러 번 잡혀도 한 건)
  if (await c.env.LOCATION_KV.get(k)) return c.json({ ok: true, again: true });
  await c.env.LOCATION_KV.put(k, "1", { expirationTtl: 60 });
  // 시연 도우미는 평소 «쉬는 중»(다른 예행에 안 끼게) — 시연 경보 때만 «대기»로
  await c.env.DB.prepare("UPDATE onda_responders SET available = 1 WHERE user_id IN (SELECT user_id FROM onda_tgc_demo WHERE kind = 'helper')").run();
  // 휴대폰 화면이 바로 다음 단계로 넘어가게 답을 먼저 주고, 알림·출동은 뒤에서(가족 «불꽃» 알림 → 출동 줄 → 위급 알림 순)
  const n = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM onda_tgc_demo WHERE kind = 'helper'").first<{ n: number }>();
  const text = c.req.query("kind") === "fall" ? FALL_TEXT : FIRE_TEXT;
  const work = (async () => {
    await sendMany(tg(c.env), c.env.DB, await familyRooms(c.env.DB, elderId), text);
    const r = await createTgRequest(c.env, elderId, "hi_system", true);
    if (!r.existing) await markEmergency(c.env, r.requestId, "hi_system");
  })().catch((e) => console.error("[demo] alarm", String(e).slice(0, 200)));
  try { c.executionCtx.waitUntil(work); } catch { await work; }
  return c.json({ ok: true, existing: false, queued: n?.n || 0 });
});

app.get("/api/tg/demo/status", async (c) => {
  const elderId = await demoElder(c.env, c.req.header("x-demo-key"));
  if (!elderId) return c.json({ error: "not found" }, 404);
  const db = c.env.DB;
  const helpers = await db.prepare(
    `SELECT COUNT(*) AS n, SUM(CASE WHEN p.linked = 1 THEN 1 ELSE 0 END) AS linked FROM onda_tgc_demo d
       LEFT JOIN onda_tgc_people p ON p.room_key = 'u:' || d.user_id WHERE d.kind = 'helper'`).first<{ n: number; linked: number }>();
  const family = await db.prepare(
    `SELECT COUNT(*) AS n FROM onda_tgc_demo d JOIN onda_tgc_people p ON p.room_key = 'u:' || d.user_id AND p.linked = 1 WHERE d.kind = 'family'`).first<{ n: number }>();
  const d = await db.prepare(
    `SELECT d.request_id, d.state, d.queue, d.idx, d.created_at, r.status AS req_status FROM onda_tgc_dispatch d
       LEFT JOIN onda_requests r ON r.id = d.request_id WHERE d.elder_id = ? ORDER BY d.created_at DESC LIMIT 1`).bind(elderId).first<any>();
  let now: any = null;
  if (d && d.state !== "cancelled" && d.req_status !== "cancelled") {
    const m = await db.prepare(
      `SELECT m.responder_id, m.status, m.accepted_at, m.arrived_at, m.started_at, m.completed_at, u.name FROM onda_matches m
         JOIN onda_users u ON u.id = m.responder_id WHERE m.request_id = ? AND m.status IN ('accepted','moving','arrived','in_progress','completed') LIMIT 1`)
      .bind(d.request_id).first<any>();
    let meters: number | null = null;
    if (m) {
      const home = await db.prepare("SELECT lat, lng FROM onda_users WHERE id = ?").bind(elderId).first<{ lat: number; lng: number }>();
      const loc = await c.env.LOCATION_KV.get(`loc:${m.responder_id}`);
      if (loc && home?.lat && home?.lng) {
        const [la, lo] = loc.split(",").map(Number);
        const dy = (la - home.lat) * 111320, dx = (lo - home.lng) * 111320 * Math.cos(home.lat * Math.PI / 180);
        meters = Math.round(Math.hypot(dx, dy) / 50) * 50;
      }
    }
    let queue = 0; try { queue = JSON.parse(d.queue || "[]").length; } catch {}
    now = { state: d.state, startedAt: d.created_at, asked: Math.min(d.idx || 0, queue), queue,
      match: m ? { status: m.status, helper: mask(m.name), acceptedAt: m.accepted_at, arrivedAt: m.arrived_at, startedAt: m.started_at, completedAt: m.completed_at, meters } : null };
  }
  return c.json({ ok: true, helpers: { n: helpers?.n || 0, linked: helpers?.linked || 0 }, family: family?.n || 0, now });
});

app.post("/api/tg/demo/reset", async (c) => {
  const elderId = await demoElder(c.env, c.req.header("x-demo-key"));
  if (!elderId) return c.json({ error: "not found" }, 404);
  const db = c.env.DB;
  const live = (await db.prepare("SELECT request_id FROM onda_tgc_dispatch WHERE elder_id = ? AND state NOT IN ('done','cancelled')").bind(elderId).all<{ request_id: string }>()).results;
  for (const { request_id } of live) {
    await db.prepare("UPDATE onda_tgc_dispatch SET state = 'cancelled' WHERE request_id = ?").bind(request_id).run();
    await db.prepare("UPDATE onda_requests SET status = 'cancelled' WHERE id = ?").bind(request_id).run();
    await db.prepare("UPDATE onda_matches SET status = 'cancelled' WHERE request_id = ? AND status NOT IN ('completed','rejected','expired')").bind(request_id).run();
  }
  await db.prepare("UPDATE onda_responders SET available = 0 WHERE user_id IN (SELECT user_id FROM onda_tgc_demo WHERE kind = 'helper')").run();
  await c.env.LOCATION_KV.delete("demo:alarm");
  if (live.length) {
    const rooms = (await db.prepare("SELECT 'u:' || user_id AS r FROM onda_tgc_demo WHERE kind IN ('helper','family')").all<{ r: string }>()).results.map((x) => x.r);
    await sendMany(tg(c.env), db, rooms, "🙏 시연 한 회를 마쳤습니다. 함께해 주셔서 고맙습니다.");
  }
  return c.json({ ok: true, closed: live.length });
});

app.post("/api/tg/demo/clear", async (c) => {
  if (!(await adminKey(c.env, c.req.header("authorization")))) return c.json({ error: "not found" }, 404);
  const db = c.env.DB; await tables(db);
  const people = (await db.prepare("SELECT d.user_id AS v FROM onda_tgc_demo d JOIN onda_users u ON u.id = d.user_id WHERE u.name LIKE '가상%' AND u.region = ?").bind(DEMO_REGION).all<{ v: string }>()).results.map((r) => r.v);
  const ph = (n: number) => Array(n).fill("?").join(",");
  const removed: Record<string, number> = {};
  if (people.length) {
    const reqs = (await db.prepare(`SELECT id AS v FROM onda_requests WHERE requester_id IN (${ph(people.length)})
      UNION SELECT request_id AS v FROM onda_tgc_dispatch WHERE elder_id IN (${ph(people.length)})`).bind(...people, ...people).all<{ v: string }>()).results.map((r) => r.v);
    const matches = reqs.length ? (await db.prepare(`SELECT id AS v FROM onda_matches WHERE request_id IN (${ph(reqs.length)})`).bind(...reqs).all<{ v: string }>()).results.map((r) => r.v) : [];
    const del = async (table: string, column: string, ids: string[]) => {
      for (let i = 0; i < ids.length; i += 50) {
        const part = ids.slice(i, i + 50);
        const n = (await db.prepare(`DELETE FROM ${table} WHERE ${column} IN (${ph(part.length)})`).bind(...part).run()).meta?.changes ?? 0;
        if (n) removed[table] = (removed[table] || 0) + n;
      }
    };
    const PERSON = ["user_id", "requester_id", "responder_id", "elder_id", "family_id", "enrolled_by", "asked_by", "reviewer_id", "reviewee_id", "sender_id", "target_id", "reporter_id", "helper_id"];
    const tablesAll = (await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'onda_%'").all<{ name: string }>()).results.map((r) => r.name);
    for (const table of tablesAll) {
      if (!/^onda_[a-z_]+$/.test(table) || table === "onda_tgc_demo") continue;
      const cols = (await db.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>()).results.map((r) => r.name);
      for (const cn of cols) {
        if (cn === "match_id" && matches.length) await del(table, cn, matches);
        if (cn === "request_id" && reqs.length) await del(table, cn, reqs);
        if (PERSON.includes(cn)) await del(table, cn, people);
      }
    }
    if (matches.length) await del("onda_matches", "id", matches);
    if (reqs.length) await del("onda_requests", "id", reqs);
    await del("onda_tgc_people", "room_key", people.map(roomOf));
    await del("onda_users", "id", people);
    for (const id of people) { try { await c.env.LOCATION_KV.delete(`loc:${id}`); } catch {} }
  }
  await db.prepare("DELETE FROM onda_tgc_demo").run();
  await db.prepare("DELETE FROM onda_tgc_demo_cfg").run();
  return c.json({ ok: true, people: people.length, removed });
});

// 연결이 끝나지 않은 시연 가족·도우미에게 같은 자리로 새 연결 링크(사람은 그대로) — 2026-11-26 대표 연결이 온다에 안 잡힌 일
app.post("/api/tg/demo/relink", async (c) => {
  if (!(await adminKey(c.env, c.req.header("authorization")))) return c.json({ error: "not found" }, 404);
  const t = tg(c.env); if (!t) return c.json({ error: "telegram not configured" }, 503);
  const db = c.env.DB; await tables(db);
  const b = await c.req.json<any>().catch(() => ({}));
  const kind = b.kind === "helper" ? "helper" : "family";
  const rows = (await db.prepare(`SELECT d.user_id FROM onda_tgc_demo d LEFT JOIN onda_tgc_people p ON p.room_key = 'u:' || d.user_id
    WHERE d.kind = ? AND COALESCE(p.linked, 0) = 0`).bind(kind).all<{ user_id: string }>()).results;
  const out = [];
  for (const r of rows) out.push({ url: (await t.startLink(roomOf(r.user_id), 72)).url });
  return c.json({ ok: true, kind, links: out });
});

app.onError((e, c) => c.json({ error: "demo error" }, 500));
export { app as tgDemoRoutes };

// ── 말벗 낙상 그림자 모드 기록 (2026-11-28, 대표 «진행해» 14:44) ──
// 대표 시험 휴대폰(시연 열쇠가 저장된 기기)에서만 말벗 화면이 보냄. 받는 것: 무슨 일(fall=넘어짐으로 봄 · beat=한 시간 처리 요약), 판정 이름, 한 장 처리 시간, 1초 장수, 장수, 기기 이름 앞 24자.
const SHADOW_EV = new Set(["fall", "beat", "start"]);
app.post("/api/tg/shadow", async (c) => {
  const elderId = await demoElder(c.env, c.req.header("x-demo-key"));
  if (!elderId) return c.json({ error: "not found" }, 404);
  const b = await c.req.json<any>().catch(() => ({}));
  const ev = String(b.ev || ""); if (!SHADOW_EV.has(ev)) return c.json({ error: "bad ev" }, 400);
  const num = (v: unknown, hi: number) => { const x = Number(v); return Number.isFinite(x) && x >= 0 && x <= hi ? x : null; };
  const judge = typeof b.judge === "string" ? b.judge.replace(/[^a-z_]/g, "").slice(0, 12) : null;
  const dev = typeof b.dev === "string" ? b.dev.replace(/[^\w .;()\-\/]/g, "").slice(0, 24) : null;
  const k = "shadow:rl:" + new Date().toISOString().slice(0, 13);   // 한 시간에 120건까지만(잘못 돌아도 쌓이지 않게)
  const cnt = Number((await c.env.LOCATION_KV.get(k)) || 0); if (cnt >= 120) return c.json({ ok: true, dropped: true });
  await c.env.LOCATION_KV.put(k, String(cnt + 1), { expirationTtl: 7200 });
  await c.env.DB.prepare("INSERT INTO onda_tgc_shadow (ev, judge, ms, fps, n, dev) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(ev, judge, num(b.ms, 60000), num(b.fps, 60), num(b.n, 1e7), dev).run();
  return c.json({ ok: true });
});
app.get("/api/tg/shadow/sum", async (c) => {
  if (!(await adminKey(c.env, c.req.header("authorization")))) return c.json({ error: "not found" }, 404);
  await tables(c.env.DB);
  const rows = (await c.env.DB.prepare("SELECT at, ev, judge, ms, fps, n, dev FROM onda_tgc_shadow WHERE at >= datetime('now', '-7 days') ORDER BY id DESC LIMIT 500").all()).results;
  return c.json({ ok: true, rows });
});
