// 예행 순서(rehearse_drive.mjs)를 Miniflare 온다 + Node 알림 통로로 시험 — 텔레그램으로는 아무것도 안 나가야 하고, 치우면 가상 사람이 남지 않아야 한다
import { Miniflare } from "miniflare";
import { sign } from "hono/jwt";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { rehearse, cleanup } from "./rehearse_drive.mjs";
const TDIR = process.env.TONGRO_DIR || "/home/claude/w/tongro";
const { default: tongroWorker } = await import(pathToFileURL(TDIR + "/src/index.js"));
const { makeDB } = await import(pathToFileURL(TDIR + "/test/d1shim.js"));
const { webhookSecret } = await import(pathToFileURL(TDIR + "/src/util.js"));
const MASTER = "d".repeat(64), BOT = "4242:FAKE_ONDA", REH = "r".repeat(40);
const real = [];
const tEnv = { DB: makeDB(), MASTER_KEY: MASTER, ADMIN_TOKEN: "ADM", PUBLIC_BASE: "https://tongro.test" };
let mf;
async function route(req) {
  const u = new URL(req.url);
  if (u.hostname === "api.telegram.org") { const method = u.pathname.split("/").pop(); real.push({ method, body: JSON.parse(await req.text() || "{}") });
    if (method === "getMe") return Response.json({ ok: true, result: { username: "onda_test_bot" } }); return Response.json({ ok: true, result: { message_id: 1 } }); }
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
  bindings: { JWT_SECRET: "jwt", FRONTEND_URL: "https://onda.test", TONGRO_BASE: "https://tongro.test", TONGRO_SECRET: svc.secret, TG_OFFER_SECONDS: "20", TG_REH_TOKEN: REH },
  outboundService: route });
const db = await mf.getD1Database("DB");
const env = { onda: "https://onda.test", tongro: "https://tongro.test", tongroAdmin: "ADM", rehToken: REH, botToken: BOT, wait: async () => {}, log: () => {} };

// 실제 사람(실제 상황실·실제 도우미)도 함께 있다 — 예행이 이들에게 닿으면 안 된다
const ADMIN = "Bearer " + await sign({ sub: "adm", role: "admin", name: "adm" }, "jwt", "HS256");
const call = (m, p, b, a) => mf.dispatchFetch("https://onda.test" + p, { method: m, headers: { "content-type": "application/json", ...(a ? { authorization: a } : {}) }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json());
const hook = async (upd) => tongroWorker.fetch(new Request("https://tongro.test/tg/onda", { method: "POST", headers: { "x-telegram-bot-api-secret-token": await webhookSecret(MASTER, "onda") }, body: JSON.stringify({ update_id: Math.floor(Math.random() * 1e9), ...upd }) }), tEnv);
const opsR = await call("POST", "/api/tg/ops/link", { name: "main" }, ADMIN);
await hook({ message: { message_id: 1, chat: { id: -100777, type: "group", title: "실제 상황실" }, from: { id: 777 }, text: "/start " + opsR.url.split("start=")[1] } });
const hr = await call("POST", "/api/tg/helpers/invite", { name: "실제도우미" }, ADMIN);
await hook({ message: { message_id: 2, chat: { id: 888, type: "private" }, from: { id: 888 }, text: "/start " + hr.url.split("start=")[1] } });
await db.prepare("UPDATE onda_responders SET status='approved' WHERE user_id=?").bind(hr.helperId).run();
await hook({ message: { message_id: 3, chat: { id: 888, type: "private" }, from: { id: 888 }, text: "🟢 출동 받기 켜기" } });
await hook({ message: { message_id: 4, chat: { id: 888 }, from: { id: 888 }, location: { latitude: 35.8706, longitude: 128.6006 } } });   // 가상 어르신 바로 옆
real.length = 0;

// 예행 열쇠 없으면 닫힘
assert.equal((await mf.dispatchFetch("https://onda.test/api/tg/rehearse/setup", { method: "POST", headers: { authorization: "Bearer wrong" }, body: "{}" })).status, 404);
assert.equal((await mf.dispatchFetch("https://onda.test/api/tg/rehearse/setup", { method: "POST", headers: { authorization: "Bearer " + REH, "content-type": "application/json" }, body: JSON.stringify({ helpers: ["실제사람"] }) })).status, 400);

const res = await rehearse(env);
assert.equal(real.filter((x) => !["setWebhook", "getMe"].includes(x.method)).length, 0, "예행 중 텔레그램으로 나간 것: " + JSON.stringify(real.slice(0, 3)));
assert.ok(res.chats.filter((c) => c !== "").every((c) => Math.abs(Number(c)) >= 990000000000), "가상 번호에만");
console.log(`✔ 예행 ${res.steps.length}단계 · 예행 기록 ${res.sent}건 · 실제 상황실·실제 도우미에게 0건`);

const before = (await db.prepare("SELECT COUNT(*) AS n FROM onda_users WHERE name NOT LIKE '가상%'").first()).n;
const cl = await cleanup(env);
assert.ok(cl.onda.ok && cl.tongro.ok, JSON.stringify(cl));
assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM onda_users WHERE name LIKE '가상%'").first()).n, 0, "가상 사람 남음");
assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM onda_users WHERE name NOT LIKE '가상%'").first()).n, before, "실제 사람이 지워짐");
assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM onda_requests").first()).n, 0);
assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM onda_matches").first()).n, 0);
assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM onda_settlements").first()).n, 0);
assert.ok(await db.prepare("SELECT 1 FROM onda_tgc_people WHERE room_key='ops:main'").first(), "실제 상황실 남음");
const left = (await tEnv.DB.prepare("SELECT chat_id FROM rooms").all()).results.map((r) => r.chat_id);
assert.ok(left.every((c) => Math.abs(Number(c)) < 990000000000), "통로에 가상 방 남음");
console.log("✔ 치우기: 가상 사람·요청·출동·정산·통로 방 0, 실제 사람·실제 상황실 그대로", JSON.stringify(cl.onda.removed));
await mf.dispose();
console.log("\n예행 시험 모두 통과");
