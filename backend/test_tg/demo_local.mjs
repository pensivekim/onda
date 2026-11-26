// 시연 입구(demo.ts) 로컬 시험 — Miniflare 온다 + Node 알림 통로, 텔레그램은 가짜로 받아 적기만 (2026-11-26 Claude)
// 확인: 열쇠 없으면 닫힘 · 불꽃 경보 → 가족 알림 → 시연 도우미에게만 부탁 · 실제 도우미/상황실/예행 가상과 안 섞임 · 다시 하기 · 치우기
import { Miniflare } from "miniflare";
import { sign } from "hono/jwt";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
const TDIR = process.env.TONGRO_DIR || "/home/claude/w/tongro";
const { default: tongroWorker } = await import(pathToFileURL(TDIR + "/src/index.js"));
const { makeDB } = await import(pathToFileURL(TDIR + "/test/d1shim.js"));
const { webhookSecret } = await import(pathToFileURL(TDIR + "/src/util.js"));
const MASTER = "d".repeat(64), BOT = "4242:FAKE_ONDA", REH = "r".repeat(40);
const sent = [];
const tEnv = { DB: makeDB(), MASTER_KEY: MASTER, ADMIN_TOKEN: "ADM", PUBLIC_BASE: "https://tongro.test" };
let mf;
async function route(req) {
  const u = new URL(req.url);
  if (u.hostname === "api.telegram.org") { const method = u.pathname.split("/").pop(); const body = JSON.parse(await req.text() || "{}"); sent.push({ method, body });
    if (method === "getMe") return Response.json({ ok: true, result: { username: "onda_test_bot" } }); return Response.json({ ok: true, result: { message_id: 1000 + sent.length } }); }
  if (u.hostname === "tongro.test") return tongroWorker.fetch(req, tEnv);
  if (u.hostname === "onda.test") return mf.dispatchFetch(req.url, { method: req.method, headers: Object.fromEntries(req.headers), body: req.method === "GET" ? undefined : await req.text() });
  throw new Error("예상 못 한 주소 " + req.url);
}
globalThis.fetch = (url, init) => route(new Request(url, init));
const adm = (p, b) => tongroWorker.fetch(new Request("https://tongro.test" + p, { method: "POST", headers: { authorization: "Bearer ADM", "content-type": "application/json" }, body: JSON.stringify(b) }), tEnv).then(r => r.json());
await adm("/admin/bots", { bot_id: "onda", token: BOT });
const svc = await adm("/admin/services", { service_id: "onda", name: "온다", bot_id: "onda", callback_url: "https://onda.test/api/tg/tongro", forward_messages: true });
mf = new Miniflare({ modules: true, scriptPath: "test_tg/out.mjs", compatibilityDate: "2024-09-23", compatibilityFlags: ["nodejs_compat"],
  d1Databases: ["DB"], kvNamespaces: ["LOCATION_KV"], r2Buckets: ["CERT_BUCKET"],
  bindings: { JWT_SECRET: "jwt", FRONTEND_URL: "https://onda.test", TONGRO_BASE: "https://tongro.test", TONGRO_SECRET: svc.secret, TG_OFFER_SECONDS: "20", TG_REH_TOKEN: REH, HI_ONDA_SECRET: "hi-test-secret" },
  outboundService: route });
const db = await mf.getD1Database("DB");
const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
const ADMIN = "Bearer " + await sign({ sub: "adm", role: "admin", name: "adm" }, "jwt", "HS256");
const call = (m, p, b, h = {}) => mf.dispatchFetch("https://onda.test" + p, { method: m, headers: { "content-type": "application/json", ...h }, body: b ? JSON.stringify(b) : undefined });
const J = async (r) => ({ code: r.status, j: await r.json().catch(() => null), h: r.headers });
let mid = 0;
const hook = async (upd) => { await tongroWorker.fetch(new Request("https://tongro.test/tg/onda", { method: "POST", headers: { "x-telegram-bot-api-secret-token": await webhookSecret(MASTER, "onda") }, body: JSON.stringify({ update_id: Math.floor(Math.random() * 1e9), ...upd }) }), tEnv); await wait(150); };
const start = (url, chat) => hook({ message: { message_id: ++mid, chat: { id: chat, type: chat < 0 ? "group" : "private", title: "방" }, from: { id: Math.abs(chat) }, text: "/start " + url.split("start=")[1] } });
const to = (chat) => sent.filter((x) => String(x.body.chat_id) === String(chat));
const textsTo = (chat) => to(chat).map((x) => x.body.text || "");
const press = async (chat, label) => {
  for (let i = sent.length - 1; i >= 0; i--) { const x = sent[i]; if (String(x.body.chat_id) !== String(chat)) continue;
    for (const b of (x.body.reply_markup?.inline_keyboard || []).flat())
      if (b.text.includes(label) && b.callback_data) return hook({ callback_query: { id: "q" + (++mid), data: b.callback_data, from: { id: chat }, message: { message_id: x.method === "editMessageText" ? x.body.message_id : 1001 + i, chat: { id: chat }, text: "(원문)" } } }); }
  throw new Error(`✖ ${chat} 에 «${label}» 버튼 없음`);
};

// 실제 사람: 실제 상황실 · 실제 도우미(출동 받기 켬, 시연 어르신 바로 옆)
const opsR = await J(await call("POST", "/api/tg/ops/link", { name: "main" }, { authorization: ADMIN }));
await start(opsR.j.url, -100777);
const hr = await J(await call("POST", "/api/tg/helpers/invite", { name: "실제도우미" }, { authorization: ADMIN }));
await start(hr.j.url, 888);
await db.prepare("UPDATE onda_responders SET status='approved' WHERE user_id=?").bind(hr.j.helperId).run();
await hook({ message: { message_id: ++mid, chat: { id: 888, type: "private" }, from: { id: 888 }, text: "🟢 출동 받기 켜기" } });
await hook({ message: { message_id: ++mid, chat: { id: 888 }, from: { id: 888 }, location: { latitude: 35.8706, longitude: 128.6006 } } });
// 예행용 가상 도우미(실제 예행 준비 입구) — 시연 경보가 이분에게도 가면 안 된다
const rs = await J(await call("POST", "/api/tg/rehearse/setup", { helpers: ["가상예행"], ops: "reh-main" }, { authorization: "Bearer " + REH }));
assert.equal(rs.code, 200, JSON.stringify(rs.j));
await start(rs.j.helpers[0].url, 777001);
await db.prepare("UPDATE onda_responders SET available=1 WHERE user_id=?").bind(rs.j.helpers[0].id).run();

// 1 열쇠 없으면 닫힘
assert.equal((await call("POST", "/api/tg/demo/setup", {}, { authorization: "Bearer wrong" })).status, 404);
assert.equal((await call("POST", "/api/tg/demo/alarm", {}, { "x-demo-key": "x".repeat(48) })).status, 404);
assert.equal((await call("GET", "/api/tg/demo/status")).status, 404);
assert.equal((await J(await call("POST", "/api/tg/demo/setup", { elder: { name: "실제" }, helpers: ["가상A"] }, { authorization: "Bearer " + REH }))).code, 400);
console.log("✔ 열쇠 없으면 닫힘 · «가상» 아닌 이름 거절");

// 2 준비
const su = await J(await call("POST", "/api/tg/demo/setup", {
  elder: { name: "가상 김순자", address: "대구 서구 시연로 1", lat: 35.8710, lng: 128.5600 },
  helpers: ["가상 협회1", "가상 협회2"], family: ["딸"], hours: 48 }, { authorization: "Bearer " + REH }));
assert.equal(su.code, 200, JSON.stringify(su.j));
const KEY = su.j.key; assert.ok(/^[0-9a-f]{48}$/.test(KEY));
assert.equal((await call("POST", "/api/tg/demo/setup", { elder: { name: "가상 x" }, helpers: ["가상y"] }, { authorization: "Bearer " + REH })).status, 409);
const FAM = 111, H1 = 201, H2 = 202;
await start(su.j.family[0].url, FAM); await start(su.j.helpers[0].url, H1); await start(su.j.helpers[1].url, H2);
const K = { "x-demo-key": KEY };
let st = await J(await call("GET", "/api/tg/demo/status", undefined, K));
assert.deepEqual([st.j.helpers.n, st.j.helpers.linked, st.j.family, st.j.now], [2, 2, 1, null], JSON.stringify(st.j));
assert.equal((await db.prepare("SELECT COUNT(*) n FROM onda_responders r JOIN onda_tgc_demo d ON d.user_id=r.user_id WHERE r.available=1").first()).n, 0, "시연 도우미는 평소 쉬는 중이어야");
console.log("✔ 준비: 가족 1·도우미 2 연결, 시연 도우미 평소 «쉬는 중»");

// 3 CORS: 말벗 화면은 시연 입구만
const pre = await call("OPTIONS", "/api/tg/demo/alarm", undefined, { origin: "https://hi.genomic.cc", "access-control-request-method": "POST", "access-control-request-headers": "x-demo-key" });
assert.equal(pre.headers.get("access-control-allow-origin"), "https://hi.genomic.cc");
assert.match(pre.headers.get("access-control-allow-headers") || "", /X-Demo-Key/i);
const pre2 = await call("OPTIONS", "/api/tg/rehearse/clear", undefined, { origin: "https://hi.genomic.cc", "access-control-request-method": "POST" });
assert.notEqual(pre2.headers.get("access-control-allow-origin"), "https://hi.genomic.cc");
const pre3 = await call("OPTIONS", "/api/tg/demo/setup", undefined, { origin: "https://hi.genomic.cc", "access-control-request-method": "POST" });
assert.notEqual(pre3.headers.get("access-control-allow-origin"), "https://hi.genomic.cc");
const pre4 = await call("OPTIONS", "/api/tg/me", undefined, { origin: "https://onda.genomic.cc", "access-control-request-method": "GET" });
assert.equal(pre4.headers.get("access-control-allow-origin"), "https://onda.genomic.cc");
const pre5 = await call("OPTIONS", "/api/tg/demo/alarm", undefined, { origin: "https://evil.example", "access-control-request-method": "POST" });
assert.notEqual(pre5.headers.get("access-control-allow-origin"), "https://evil.example");
console.log("✔ CORS: hi.genomic.cc 는 시연 alarm·status·reset 만, 온다 화면은 그대로, 남의 주소 막힘");

// 4 불꽃 경보
const before = sent.length;
const al = await J(await call("POST", "/api/tg/demo/alarm", {}, K));
assert.equal(al.code, 200, JSON.stringify(al.j)); assert.equal(al.j.existing, false); assert.equal(al.j.queued, 2);
await wait(300);
assert.ok(textsTo(FAM).some((t) => t.includes("불꽃")), "가족 불꽃 알림 없음");
assert.ok(textsTo(H1).some((t) => t.includes("긴급 돌봄 부탁")), "시연 도우미1 부탁 없음");
const leak = sent.slice(before).filter((x) => ["888", "-100777", "777001"].includes(String(x.body.chat_id)));
assert.equal(leak.length, 0, "실제/예행 사람에게 감: " + JSON.stringify(leak.slice(0, 2)));
const again = await J(await call("POST", "/api/tg/demo/alarm", {}, K));
assert.equal(again.j.again, true, "20초 안 두 번째 경보는 한 건으로");
st = await J(await call("GET", "/api/tg/demo/status", undefined, K));
assert.equal(st.j.now.state, "offering"); assert.equal(st.j.now.queue, 2);
assert.ok(!JSON.stringify(st.j).match(/lat|lng|주소|시연로|김순자/), "상태 답에 위치·이름이 섞임 " + JSON.stringify(st.j));
console.log("✔ 불꽃 경보 → 가족 «불꽃» 알림 → 시연 도우미에게 위급 부탁 · 실제 도우미/상황실/예행 가상 0건 · 상태는 좌표·이름 없음");

// 5 수락 → 출발 → 도착
await press(H1, "제가 가겠습니다"); await wait(800);
if (!textsTo(FAM).some((t) => t.includes("부탁을 받았습니다"))) { console.log("H1:", JSON.stringify(to(H1).slice(-3).map(x=>[x.method,(x.body.text||"").slice(0,80)]))); console.log("FAM:", textsTo(FAM)); console.log((await db.prepare("SELECT status FROM onda_matches").all()).results, (await db.prepare("SELECT state,notified FROM onda_tgc_dispatch").all()).results); }
assert.ok(textsTo(FAM).some((t) => t.includes("부탁을 받았습니다")), "가족 수락 알림 없음");
st = await J(await call("GET", "/api/tg/demo/status", undefined, K));
assert.equal(st.j.now.match.status, "accepted"); assert.equal(st.j.now.match.helper, "가○○");
await hook({ message: { message_id: 77, chat: { id: H1 }, from: { id: H1 }, location: { latitude: 35.8719, longitude: 128.5600, live_period: 3600 } } });
await press(H1, "출발했어요"); await wait(300);
st = await J(await call("GET", "/api/tg/demo/status", undefined, K));
assert.equal(st.j.now.match.status, "moving"); assert.equal(st.j.now.match.meters, 100, JSON.stringify(st.j.now.match));
await press(H1, "도착했어요"); await wait(300);
st = await J(await call("GET", "/api/tg/demo/status", undefined, K));
assert.equal(st.j.now.match.status, "arrived");
assert.ok(textsTo(FAM).some((t) => t.includes("도착했습니다")), "가족 도착 알림 없음");
console.log("✔ 수락 → 출발(거리 100m) → 도착, 가족 알림 차례대로");

// 6 다시 하기
const rr = await J(await call("POST", "/api/tg/demo/reset", {}, K));
assert.equal(rr.j.closed, 1);
st = await J(await call("GET", "/api/tg/demo/status", undefined, K));
assert.equal(st.j.now, null);
assert.equal((await db.prepare("SELECT COUNT(*) n FROM onda_responders r JOIN onda_tgc_demo d ON d.user_id=r.user_id WHERE r.available=1").first()).n, 0);
const al2 = await J(await call("POST", "/api/tg/demo/alarm", {}, K));
assert.equal(al2.j.existing, false, "다시 하기 뒤 새 건이어야");
await call("POST", "/api/tg/demo/reset", {}, K);
console.log("✔ 다시 하기: 지난 건 닫고 새 경보는 새 건");

// 7 예행이 시연 사람을 지우지 않고, 시연 치우기는 시연 사람만
const cl0 = await J(await call("POST", "/api/tg/rehearse/clear", {}, { authorization: "Bearer " + REH }));
assert.equal(cl0.code, 200);
assert.equal((await db.prepare("SELECT COUNT(*) n FROM onda_tgc_demo").first()).n, 4, "예행 치우기가 시연 사람을 지움");
const realN = (await db.prepare("SELECT COUNT(*) n FROM onda_users WHERE name NOT LIKE '가상%'").first()).n;
const cl = await J(await call("POST", "/api/tg/demo/clear", {}, { authorization: "Bearer " + REH }));
assert.equal(cl.j.people, 4, JSON.stringify(cl.j));
assert.equal((await db.prepare("SELECT COUNT(*) n FROM onda_users WHERE region='XD'").first()).n, 0);
assert.equal((await db.prepare("SELECT COUNT(*) n FROM onda_requests").first()).n, 0);
assert.equal((await db.prepare("SELECT COUNT(*) n FROM onda_matches").first()).n, 0);
assert.equal((await db.prepare("SELECT COUNT(*) n FROM onda_users WHERE name NOT LIKE '가상%'").first()).n, realN, "실제 사람이 지워짐");
assert.equal((await call("GET", "/api/tg/demo/status", undefined, K)).status, 404, "치운 뒤 열쇠 닫힘");
console.log("✔ 예행 치우기는 시연 사람을 안 건드림 · 시연 치우기 뒤 시연 사람·요청·출동 0, 실제 사람 그대로, 열쇠 닫힘");
await mf.dispose();
console.log("\n시연 입구 시험 모두 통과");
