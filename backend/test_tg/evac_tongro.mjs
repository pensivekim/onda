// 다올(이웃대피) 도우미 알림을 온다 봇(알림 통로)으로 보내는 시험 (2026-11-23) — 원래 머리말: 온다 텔레그램판 전체 시험 — 첫 방문 등록 → 가족 QR → 도와주세요 → 차례 출동(거절·시간 지남 → 다음 분) → 수락 → 실시간 위치 → 도착·위급(119)·마침 → 미니 앱 로그인
// 실제 온다 백엔드(새 index.ts 포함)를 Miniflare 로, 실제 알림 통로를 Node 로 함께 띄운다. 텔레그램만 가짜.
import { Miniflare } from "miniflare";
import { sign } from "hono/jwt";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
const TDIR = process.env.TONGRO_DIR || "/home/claude/w/tongro";
const { default: tongroWorker } = await import(pathToFileURL(TDIR + "/src/index.js"));
const { makeDB } = await import(pathToFileURL(TDIR + "/test/d1shim.js"));
const { webhookSecret } = await import(pathToFileURL(TDIR + "/src/util.js"));

const JWT = "test-secret", MASTER = "c".repeat(64), BOT = "4242:FAKE_ONDA";
const tgLog = [], allLog = []; let mid = 1000, uid = 0;
const tEnv = { DB: makeDB(), MASTER_KEY: MASTER, ADMIN_TOKEN: "ADM", PUBLIC_BASE: "https://tongro.test" };
let mf;
// 바깥으로 나가는 모든 요청: 텔레그램 → 가짜, 통로 → Node 통로, 온다(통로가 넘김) → Miniflare
async function route(req) {
  const u = new URL(req.url);
  if (u.hostname === "api.telegram.org") {
    const method = u.pathname.split("/").pop(); const body = JSON.parse(await req.text() || "{}");
    tgLog.push({ method, body }); allLog.push({ method, body });
    if (method === "getMe") return Response.json({ ok: true, result: { username: "onda_care_test_bot" } });
    return Response.json({ ok: true, result: { message_id: ++mid } });
  }
  if (u.hostname === "tongro.test") return tongroWorker.fetch(req, tEnv);
  if (u.hostname === "onda.test") return mf.dispatchFetch(req.url, { method: req.method, headers: Object.fromEntries(req.headers), body: await req.text() });
  throw new Error("예상 못 한 주소 " + req.url);
}
globalThis.fetch = (url, init) => route(new Request(url, init));

const adm = (p, b) => tongroWorker.fetch(new Request("https://tongro.test" + p, { method: "POST", headers: { authorization: "Bearer ADM", "content-type": "application/json" }, body: JSON.stringify(b) }), tEnv).then(r => r.json());
await adm("/admin/bots", { bot_id: "onda", token: BOT });
const svc = await adm("/admin/services", { service_id: "onda", name: "온다", bot_id: "onda", callback_url: "https://onda.test/api/tg/tongro", forward_messages: true });

mf = new Miniflare({ modules: true, scriptPath: "test_tg/out.mjs", compatibilityDate: "2024-09-23",
  d1Databases: ["DB"], kvNamespaces: ["LOCATION_KV"], r2Buckets: ["CERT_BUCKET"],
  bindings: { JWT_SECRET: JWT, FRONTEND_URL: "https://onda.test", TONGRO_BASE: "https://tongro.test", TONGRO_SECRET: svc.secret, TG_OFFER_SECONDS: "20", HI_ONDA_SECRET: "hi-test-secret", EVAC_INGEST_KEY: "evac-key" },
  outboundService: route });
const db = await mf.getD1Database("DB");
const tok = async (sub, role) => "Bearer " + await sign({ sub, role, name: sub }, JWT, "HS256");
const ADMIN = await tok("gun_admin", "admin");
const api = async (method, path, body, auth) => { const r = await mf.dispatchFetch("https://onda.test" + path, { method,
  headers: { "content-type": "application/json", ...(auth ? { Authorization: auth } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; } return { code: r.status, j }; };
const hook = async (upd) => tongroWorker.fetch(new Request("https://tongro.test/tg/onda", { method: "POST",
  headers: { "x-telegram-bot-api-secret-token": await webhookSecret(MASTER, "onda") }, body: JSON.stringify({ update_id: ++uid, ...upd }) }), tEnv);
const start = (url, chat, name, type = "private", from = chat) => hook({ message: { message_id: ++mid, chat: { id: chat, type, title: type === "private" ? undefined : name }, from: { id: from, first_name: name }, text: "/start " + url.split("start=")[1] } });
const say = (chat, text) => hook({ message: { message_id: ++mid, chat: { id: chat, type: "private" }, from: { id: chat, first_name: "가상" }, text } });
const loc = (chat, lat, lng, edited = false, message_id = 77) => hook({ [edited ? "edited_message" : "message"]: { message_id, chat: { id: chat }, from: { id: chat }, location: { latitude: lat, longitude: lng, live_period: 3600 } } });
const to = (chat) => tgLog.filter((x) => String(x.body.chat_id) === String(chat));
const lastText = (chat) => to(chat).filter((x) => x.body.text && x.body.text !== "✅ 연결 완료").at(-1)?.body.text || "";
const findBtn = (chat, label) => { for (const x of [...allLog.filter((x) => String(x.body.chat_id) === String(chat))].reverse()) for (const b of (x.body.reply_markup?.inline_keyboard || []).flat()) if (b.text.includes(label)) return { b, message_id: x.method === "editMessageText" ? x.body.message_id : null, x }; return null; };
// 누른 버튼의 메시지 번호: 보낸 순서대로 받은 message_id 를 다시 찾는다
const sentIds = new Map();
const realSend = route;
const press = async (chat, label) => {
  const f = findBtn(chat, label); assert.ok(f, `${chat} 에 «${label}» 버튼 없음`);
  const row = await tEnv.DB.prepare("SELECT m.message_id FROM buttons b JOIN messages m ON m.ref=b.ref WHERE b.btn_id=?").bind(f.b.callback_data.slice(2)).first();
  return hook({ callback_query: { id: "q" + uid, data: f.b.callback_data, from: { id: chat > 0 ? chat : 99, first_name: "가상누름" }, message: { message_id: Number(row?.message_id || 0), chat: { id: chat }, text: "(원문)" } } });
};
const tick = async () => (await mf.getWorker()).scheduled({ cron: "* * * * *" });
const step = (s) => console.log("✔", s);


// 도우미 1명: 온다 봇으로 묶기
const r0 = await api("POST", "/api/tg/helpers/invite", { name: "시험하나" }, ADMIN);
await start(r0.j.url, 2001, "시험하나");
await db.prepare("UPDATE onda_responders SET status='approved', available=1 WHERE user_id=?").bind(r0.j.helperId).run();
await loc(2001, 35.8710, 128.6010);
const HID = r0.j.helperId;
step("도우미가 온다 봇에 묶임");

// 다올: 대피 명단·예보·대피 시작 → 도우미에게 온다 봇으로 출동 부탁
await api("GET", "/api/evac/board", undefined, ADMIN);
await api("POST", "/api/evac/people", { emd_code: "9999901", name: "가상A", mobility: "walk", lat: 35.871, lng: 128.601, helper_id: HID }, ADMIN);
const head = "issued_at,target_day,run,hazard,emd_code,sido,sgg,emd,rank,n,level,already,pop,a65,a80,deadline,shelter_name,shelter_lat,shelter_lon,shelter_km";
const fr = await mf.dispatchFetch("https://onda.test/api/evac/forecast", { method: "POST", headers: { "content-type": "text/csv", "X-Evac-Key": "evac-key" },
  body: head + "\n2026-10-26T11:40+09:00,2026-10-27,전날판,큰비,9999901,대구,가상구,가상동,40,3482,상위5%,0,2100,980,310,18:00,가상동 경로당,,," });
assert.equal(fr.status, 200);
tgLog.length = 0; allLog.length = 0;
const st = await api("POST", `/api/evac/alerts/${encodeURIComponent("2026-10-27|큰비|9999901")}/start`, {}, ADMIN);
assert.equal(st.code, 200, JSON.stringify(st.j));
const got = to(2001).find((x) => x.method === "sendMessage" && (x.body.reply_markup?.inline_keyboard || []).flat().some((b) => b.text.includes("제가 가겠습니다")));
assert.ok(got, "도우미가 온다 봇으로 대피 출동 부탁을 받음: " + JSON.stringify(to(2001).map((x) => x.body.text)));
step("대피 출동 부탁이 온다 봇(통로)으로 감 — 다올 전용 봇 없이");

// 버튼: 수락 → 출발 → 도착 → «모실 수 없어요»
await press(2001, "제가 가겠습니다");
let m = await db.prepare("SELECT id, status FROM onda_matches WHERE responder_id = ? ORDER BY created_at DESC").bind(HID).first();
assert.equal(m.status, "accepted");
assert.ok(findBtn(2001, "출발했어요"), "대피용 다음 버튼");
await press(2001, "출발했어요"); await press(2001, "댁에 도착했어요");
assert.equal((await db.prepare("SELECT status FROM onda_matches WHERE id=?").bind(m.id).first()).status, "arrived");
await press(2001, "모실 수 없어요");
const task = await db.prepare("SELECT flag FROM onda_evac_tasks WHERE request_id = (SELECT request_id FROM onda_matches WHERE id = ?)").bind(m.id).first();
assert.equal(task.flag, "unreachable");
step("온다 봇 버튼으로 수락·출발·도착·«모실 수 없어요»까지 기록됨");

console.log("\n다올 → 온다 봇 시험 통과");
await mf.dispose();
