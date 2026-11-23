// 이웃대피 2단계 시험 — 텔레그램 버튼으로 출동 끝까지. 텔레그램 서버는 가짜(바깥으로 안 나감).
import { Miniflare } from "miniflare";
import { sign } from "hono/jwt";
import assert from "node:assert/strict";
const SECRET = "test-secret", KEY = "evac-key", HOOK = "hook-secret";
const sent = [];
const mf = new Miniflare({ modules: true, scriptPath: "test_evac/out.mjs", compatibilityDate: "2024-09-23",
  d1Databases: ["DB"], kvNamespaces: ["LOCATION_KV"],
  bindings: { JWT_SECRET: SECRET, EVAC_INGEST_KEY: KEY, TELEGRAM_BOT_TOKEN: "TEST", TELEGRAM_BOT_NAME: "genomic_test_bot", TELEGRAM_WEBHOOK_SECRET: HOOK },
  outboundService: async (req) => { const u = new URL(req.url); const body = await req.json().catch(() => ({}));
    sent.push({ method: u.pathname.split("/").pop(), body }); return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { headers: { "Content-Type": "application/json" } }); } });
const db = await mf.getD1Database("DB"), kv = await mf.getKVNamespace("LOCATION_KV");
const tok = async (sub, role) => "Bearer " + await sign({ sub, role, name: sub }, SECRET, "HS256");
const ADMIN = await tok("gun_admin", "admin");
const call = async (method, path, body, headers = {}) => { const r = await mf.dispatchFetch("http://x" + path, { method,
  headers: { "Content-Type": "application/json", ...headers }, body: body === undefined ? undefined : (typeof body === "string" ? body : JSON.stringify(body)) });
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; } return { code: r.status, j }; };
const hook = (u) => call("POST", "/api/evac/telegram/webhook", u, { "X-Telegram-Bot-Api-Secret-Token": HOOK });
const tap = (chat, data, mid = 7) => hook({ callback_query: { id: "cb" + Math.random(), data, from: { id: chat }, message: { message_id: mid, chat: { id: chat }, text: "[대피 출동]" } } });
const bugs = new Set();

await call("GET", "/api/evac/board", undefined, { Authorization: ADMIN });
for (const [id, g, la, lo] of [["H1", "green", 36.3505, 128.7003], ["H2", "green", 36.3520, 128.7010]]) {
  await db.prepare("INSERT INTO onda_users (id, name, role) VALUES (?, ?, 'responder')").bind(id, id).run();
  await db.prepare("INSERT INTO onda_responders (user_id, grade, status, available) VALUES (?, ?, 'approved', 1)").bind(id, g).run();
  await kv.put(`loc:${id}`, `${la},${lo}`);
}
// 연결: 앱에서 링크 받기 → 텔레그램 /start
for (const [id, chat] of [["H1", 1001], ["H2", 1002]]) {
  const l = await call("POST", "/api/evac/telegram/link", {}, { Authorization: await tok(id, "responder") });
  assert.ok(l.j.url.startsWith("https://t.me/genomic_test_bot?start="));
  const code = l.j.url.split("start=")[1];
  const r = await hook({ message: { text: `/start ${code}`, chat: { id: chat } } }); assert.equal(r.j.linked, id);
}
assert.equal((await hook({ message: { text: "/start 틀린코드", chat: { id: 9 } } })).j.ok, true); // 만료 안내만
assert.equal((await call("POST", "/api/evac/telegram/webhook", {}, { "X-Telegram-Bot-Api-Secret-Token": "no" })).code, 403);
console.log("연결 2명 완료");

await call("POST", "/api/evac/people", { emd_code: "9999901", name: "가상A", mobility: "walk", lat: 36.35, lng: 128.70, helper_id: "H1" }, { Authorization: ADMIN });
const head = "issued_at,target_day,run,hazard,emd_code,sido,sgg,emd,rank,n,level,already,pop,a65,a80,deadline,shelter_name,shelter_lat,shelter_lon,shelter_km";
await call("POST", "/api/evac/forecast", head + "\n2026-10-26T11:40+09:00,2026-10-27,전날판,큰비,9999901,경북,가상군,가상면,40,3482,상위5%,0,2100,980,310,18:00,가상면 경로당,,,",
  { "Content-Type": "text/csv", "X-Evac-Key": KEY });
const watch = sent.filter(s => s.method === "sendMessage" && s.body.chat_id === "1001");
assert.ok(watch.some(s => s.body.text.includes("[사전 점검]"))); console.log("사전 점검 텔레그램:", watch[0].body.text.split("\n")[0]);

sent.length = 0;
await call("POST", `/api/evac/alerts/${encodeURIComponent("2026-10-27|큰비|9999901")}/start`, {}, { Authorization: ADMIN });
const toH1 = sent.find(s => s.method === "sendMessage" && s.body.chat_id === "1001");
const toH2 = sent.find(s => s.method === "sendMessage" && s.body.chat_id === "1002");
assert.ok(toH1 && toH2, "두 도우미 모두 텔레그램 받음");
const midH1 = toH1.body.reply_markup.inline_keyboard[0][0].callback_data.split(":")[1];
const midH2 = toH2.body.reply_markup.inline_keyboard[0][0].callback_data.split(":")[1];
console.log("출동 텔레그램:", toH1.body.text.replace(/\n+/g, " / "), "| 버튼:", toH1.body.reply_markup.inline_keyboard.flat().map(b => b.text).join(", "));

// H1 이 수락 → H2 가 늦게 누르면 «다른 분이 맡음»
let r = await tap(1001, `a:${midH1}`); assert.equal(r.j.result, "accepted"); assert.equal(r.j.status, "accepted");
r = await tap(1002, `a:${midH2}`); assert.equal(r.j.result, "taken");
// 남의 출동 버튼은 못 누름
r = await tap(1002, `s:${midH1}:moving`); assert.equal(r.j.result, undefined);
assert.equal((await db.prepare("SELECT status FROM onda_matches WHERE id=?").bind(midH1).first()).status, "accepted");
for (const s of ["moving", "arrived", "in_progress", "completed"]) {
  r = await tap(1001, `s:${midH1}:${s}`);
  if (s === "completed" && r.code !== 200) bugs.add("완료 " + r.code);
  assert.equal(r.j.status, s, `${s} 기록`);
}
const edits = sent.filter(s => s.method === "editMessageText" && s.body.chat_id === "1001").map(s => s.body.reply_markup.inline_keyboard.flat().map(b => b.text).join("/") || "(버튼 없음)");
console.log("단계별 다음 버튼:", edits.join(" → "));
const b = await call("GET", "/api/evac/board?day=2026-10-27", undefined, { Authorization: ADMIN });
console.log("상황판:", b.j.alerts[0].summary); assert.equal(b.j.alerts[0].summary.done, 1);


// «모실 수 없어요» — 둘째 마을, H2 가 도착했지만 못 모심 → 상황판 «못 감»
await call("POST", "/api/evac/people", { emd_code: "9999903", name: "가상D", mobility: "assist", lat: 36.352, lng: 128.701, helper_id: "H2" }, { Authorization: ADMIN });
await call("POST", "/api/evac/forecast", head + "\n2026-10-26T11:40+09:00,2026-10-27,전날판,큰비,9999903,경북,가상군,셋째면,41,3482,상위10%,0,900,400,120,18:00,,,,",
  { "Content-Type": "text/csv", "X-Evac-Key": KEY });
sent.length = 0;
await call("POST", `/api/evac/alerts/${encodeURIComponent("2026-10-27|큰비|9999903")}/start`, {}, { Authorization: ADMIN });
const toH2b = sent.find(s => s.method === "sendMessage" && s.body.chat_id === "1002");
const midD = toH2b.body.reply_markup.inline_keyboard[0][0].callback_data.split(":")[1];
await tap(1002, `a:${midD}`); await tap(1002, `s:${midD}:moving`); await tap(1002, `s:${midD}:arrived`);
r = await tap(1002, `u:${midD}`); assert.equal(r.j.result, "unreachable");
const b2 = await call("GET", "/api/evac/board?day=2026-10-27", undefined, { Authorization: ADMIN });
const d = b2.j.alerts.find(a => a.emd === "셋째면"); console.log("못 모심 뒤:", d.summary, d.remaining[0].status, d.remaining[0].note);
assert.equal(d.summary.failed, 1);

// 텔레그램 열쇠가 없으면 조용히 건너뜀은 scenario.mjs(열쇠 없음)에서 확인됨
console.log("\n텔레그램 시험 통과", bugs.size ? "· 기존 버그 그대로: " + [...bugs].join(", ") : "");
await mf.dispose();
