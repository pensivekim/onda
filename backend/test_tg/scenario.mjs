// 온다 텔레그램판 전체 시험 — 첫 방문 등록 → 가족 QR → 도와주세요 → 차례 출동(거절·시간 지남 → 다음 분) → 수락 → 실시간 위치 → 도착·위급(119)·마침 → 미니 앱 로그인
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
  bindings: { JWT_SECRET: JWT, FRONTEND_URL: "https://onda.test", TONGRO_BASE: "https://tongro.test", TONGRO_SECRET: svc.secret, TG_OFFER_SECONDS: "20", HI_ONDA_SECRET: "hi-test-secret" },
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

// 상황실 단체방
const ops = await api("POST", "/api/tg/ops/link", { name: "reh-gasang" }, ADMIN);
await start(ops.j.url, -3000, "가상군 상황실", "group", 99);
assert.ok(lastText(-3000).includes("상황실 방으로 연결")); step("상황실 단체방 연결");
// 실제 상황실(예행 아님)도 하나 — 가상 어르신 일은 여기로 가면 안 된다 (목표 2 예행 2026-11-23)
const opsReal = await api("POST", "/api/tg/ops/link", { name: "real" }, ADMIN);
await start(opsReal.j.url, -3100, "실제 상황실", "group", 98);

// 도우미 3명: 텔레그램 초대 → 승인 → 출동 받기 켜기 → 위치
const H = {};
for (const [name, chat, lat, lng] of [["가상하나", 2001, 35.8710, 128.6010], ["가상두리", 2002, 35.8702, 128.6002], ["가상세찌", 2003, 35.8800, 128.6100]]) {
  const r = await api("POST", "/api/tg/helpers/invite", { name }, ADMIN);
  assert.equal(r.j.status, "pending");
  await start(r.j.url, chat, name);
  await say(chat, "🟢 출동 받기 켜기"); assert.ok(lastText(chat).includes("승인 전"));
  await db.prepare("UPDATE onda_responders SET status='approved' WHERE user_id=?").bind(r.j.helperId).run();
  await say(chat, "🟢 출동 받기 켜기"); assert.ok(lastText(chat).includes("켰습니다"));
  await loc(chat, lat, lng);
  H[name] = { id: r.j.helperId, chat };
}
assert.ok(to(2001).some((x) => x.body.reply_markup?.keyboard)); assert.ok(tgLog.some((x) => x.method === "setChatMenuButton" && x.body.chat_id === 2001));
step("도우미 3명 텔레그램 가입·승인·대기·위치");

// 개인 링크를 단체방에서 열면 거절
const bad = await api("POST", "/api/tg/link/me", {}, await tok("gun_admin", "admin"));
await start(bad.j.url, -4444, "엉뚱한 단체방", "group", 1234);
assert.ok(lastText(-4444).includes("1:1")); step("개인 링크를 단체방에서 열면 거절");

// 첫 방문: 가상하나 도우미가 어르신 등록 → 어르신 휴대폰 QR
const H1 = await tok(H["가상하나"].id, "responder");
const el = await api("POST", "/api/tg/elders", { name: "가상순자", address: "가상시 가상동 1-1", lat: 35.8705, lng: 128.6005 }, H1);
assert.equal(el.code, 200);
assert.equal((await api("POST", "/api/tg/elders", { name: "x" }, await tok("nobody", "requester"))).code, 403);
await start(el.j.url, 4001, "가상순자");
const kb = to(4001).find((x) => x.body.reply_markup?.keyboard).body.reply_markup.keyboard.flat().map((b) => b.text);
assert.deepEqual(kb, ["🆘 도와주세요", "📍 내 위치 보내기", "👨‍👩‍👧 가족 묶기"]);
assert.ok(lastText(2001).includes("가○○ 어르신 텔레그램이 연결"));
step("첫 방문 등록 → 어르신 QR 연결 → 큰 단추 3개 · 담당 도우미에게 알림");

// 가족 묶기: 어르신이 단추 → 링크 → 가족이 염
await say(4001, "👨‍👩‍👧 가족 묶기");
const famUrl = lastText(4001).match(/https:\/\/t\.me\/\S+/)[0];
await start(famUrl, 5001, "가상딸");
assert.ok(lastText(4001).includes("«가상딸» 님이 연결")); assert.ok(lastText(2001).includes("«가상딸»")); assert.ok(to(5001).some((x) => x.body.text?.includes("가○○ 어르신 가족")));
// 도우미 화면용 QR 링크도
const fq = await api("POST", `/api/tg/elders/${el.j.elderId}/family-link`, { relation: "아들" }, H1);
await start(fq.j.url, 5002, "가상아들");
const mine = await api("GET", "/api/tg/elders/mine", undefined, H1);
assert.equal(mine.j.elders[0].family, 2); assert.equal(mine.j.elders[0].linked, 1);
step("가족 2명 연결(어르신 단추 링크·도우미 화면 QR)");

// 도와주세요 → 위급 아님 → 담당(가상하나)에게 먼저
tgLog.length = 0;
await say(4001, "🆘 도와주세요");
assert.ok(lastText(4001).includes("숨쉬기"));
await press(4001, "아니요");
assert.ok(lastText(2001).includes("1번째"), "담당 도우미가 먼저");
assert.ok(!to(2002).some((x) => x.body.text?.includes("부탁")), "한꺼번에 안 보냄");
assert.ok(lastText(-3000).includes("출동 부탁 — 가○○ (어르신 · 본인 요청)"));
assert.ok(!to(-3100).some((x) => x.body.text?.includes("출동 부탁")), "가상 어르신 일이 실제 상황실로 가면 안 됨");
step("도와주세요 → 담당 도우미 한 분께만 먼저 부탁, 상황실 알림(예행 상황실에만)");
// 같은 어르신이 또 누르면 새 건을 만들지 않음
await say(4001, "🆘 도와주세요"); await press(4001, "아니요");
assert.equal((await db.prepare("SELECT COUNT(*) n FROM onda_tgc_dispatch").first()).n, 1);

// 담당이 «못 갑니다» → 바로 다음(가까운 가상두리)
await press(2001, "못 갑니다");
assert.ok(lastText(2002).includes("2번째")); step("거절 → 바로 다음 가까운 분");

// 가상두리가 답 없음 → 시간 지남(예약 작업) → 가상세찌. 기존 60초 만료와 겹쳐도 차례가 끊기지 않는지(제안 시각을 2분 전으로)
await db.prepare("UPDATE onda_tgc_dispatch SET offered_at = offered_at - 120").run();
await db.prepare("UPDATE onda_matches SET created_at = datetime('now','-2 minutes') WHERE status='offered'").run();
await tick();
assert.ok(tgLog.some((x) => x.method === "editMessageText" && x.body.chat_id === "2002" && x.body.text.includes("시간이 지나")));
assert.ok(lastText(2003).includes("3번째"));
const req = await db.prepare("SELECT status FROM onda_requests WHERE source='tg_care'").first();
assert.equal(req.status, "pending", "기존 만료가 요청을 취소하지 않음");
step("답 없음 → 예약 작업이 다음 분께(기존 60초 만료와 부딪치지 않음)");

// 가상두리가 늦게 옛 버튼 → 지난 부탁
await press(2002, "제가 가겠습니다");
assert.ok(/지난|기록할 수 없는/.test(tgLog.filter((x) => x.method === "answerCallbackQuery").at(-1).body.text)); step("시간 지난 옛 부탁 버튼은 눌러도 안 됨");
// 가상세찌 수락
tgLog.length = 0;
await press(2003, "제가 가겠습니다");
assert.ok(to(5001).some((x) => x.body.text?.includes("가○○님이 부탁을 받았습니다")));
assert.ok(to(5002).some((x) => x.body.text?.includes("부탁을 받았습니다")));
assert.ok(to(4001).some((x) => x.body.text?.includes("도우미가 갑니다")));
assert.ok(to(2003).some((x) => x.body.text?.includes("가상시 가상동 1-1")), "수락한 분에게만 주소");
assert.ok(!to(2002).some((x) => x.body.text?.includes("가상시 가상동")), "다른 도우미는 주소 모름");
assert.ok(to(2003).some((x) => x.method === "sendLocation"));
step("수락 → 가족 2명·어르신·상황실 알림, 주소·지도는 수락한 분에게만");

// 실시간 위치: 도우미가 켜면 가족에게 지도, 움직이면 옮김
tgLog.length = 0;
await loc(2003, 35.876, 128.606);
const live = tgLog.filter((x) => x.method === "sendLocation");
assert.deepEqual(live.map((x) => String(x.body.chat_id)).sort(), ["5001", "5002"]); assert.equal(live[0].body.live_period, 3600);
await db.prepare("UPDATE onda_tgc_dispatch SET live_at = live_at - 60").run();
await loc(2003, 35.873, 128.603, true);
assert.equal(tgLog.filter((x) => x.method === "editMessageLiveLocation").length, 2);
await loc(2003, 35.872, 128.602, true);   // 15초 안 → 건너뜀
assert.equal(tgLog.filter((x) => x.method === "editMessageLiveLocation").length, 2);
step("실시간 위치 → 가족 지도(갱신 15초 간격)");

// 출발 → 도착 → 위급(119) → 돌봄 → 마침
await press(2003, "출발했어요"); assert.ok(lastText(5001).includes("출발"));
await press(2003, "도착했어요"); assert.ok(lastText(4001).includes("문을 열어"));
await press(2003, "위급해요");
assert.ok(lastText(2003).includes("119")); assert.ok(lastText(5001).includes("위급")); assert.ok(lastText(-3000).includes("위급"));
await press(2003, "돌봄 시작");
await db.prepare("UPDATE onda_matches SET started_at = ? WHERE status='in_progress'").bind(new Date(Date.now() - 30 * 60000).toISOString()).run();
tgLog.length = 0;
await press(2003, "마쳤어요");
assert.ok(lastText(5001).includes("마쳤습니다")); assert.ok(tgLog.some((x) => x.method === "stopMessageLiveLocation"));
const st = await db.prepare("SELECT amount FROM onda_settlements").first();
assert.ok(st && st.amount > 0, "기존 흐름의 정산이 그대로 생김");
step(`도착·위급 119 안내·마침 → 정산(기존 흐름) ${st.amount}원 [가상 30분]`);
await tick();   // 다시 돌아도 같은 알림을 두 번 보내지 않음
assert.equal(tgLog.filter((x) => String(x.body.chat_id) === "5001" && x.body.text?.includes("마쳤습니다")).length, 1);

// 남의 출동 버튼 흉내(통로 서명으로 직접) → 거절
const forged = JSON.stringify({ type: "button", data: "s:nope:moving", room: "u:" + H["가상두리"].id, chat_id: "2002", from: { id: 2002 } });
const forgedRes = await api("POST", "/api/tg/tongro", JSON.parse(forged));
assert.equal(forgedRes.code, 403, "서명 없는 넘김은 거절");
step("서명 없는 넘김 거절");

// 모두 못 받으면 → 상황실 «다시 부탁하기»
tgLog.length = 0;
await say(5001, "🆘 어르신께 출동 부탁"); await press(5001, "도우미 부탁");
assert.ok(lastText(4001).includes("가족이 도우미를 불렀습니다"));
for (const c of [2001, 2002, 2003]) { const f = findBtn(c, "못 갑니다"); if (f) await press(c, "못 갑니다"); }
assert.ok(lastText(-3000).includes("모두 못 받으셨습니다")); assert.ok(lastText(5001).includes("찾고 있습니다"));
await press(-3000, "다시 부탁하기");
assert.ok(lastText(-3000).includes("다시 부탁") || tgLog.some((x) => x.method === "editMessageText" && x.body.text?.includes("다시 부탁")));
step("모두 거절 → 상황실 알림 → «다시 부탁하기»");

// 가족이 «위급» → 119 안내
tgLog.length = 0;
await db.prepare("UPDATE onda_tgc_dispatch SET state='cancelled'").run();
await say(5002, "🆘 어르신께 출동 부탁"); await press(5002, "위급");
const has = (c, t) => to(c).some((x) => x.body.text?.includes(t));
assert.ok(has(5002, "119 에 전화")); assert.ok(has(-3000, "위급")); assert.ok(has(5001, "위급")); assert.ok(!has(5002, "가족 — 119") );
step("가족 «위급» → 119 안내 + 다른 가족·상황실 알림 + 도우미 출동");

// 미니 앱 로그인 (가족)
const enc = new TextEncoder();
const p = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: 5001, first_name: "가상딸" }) });
const dcs = [...p.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join("\n");
const k1 = await crypto.subtle.importKey("raw", enc.encode("WebAppData"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
const k2 = await crypto.subtle.importKey("raw", await crypto.subtle.sign("HMAC", k1, enc.encode(BOT)), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
p.set("hash", [...new Uint8Array(await crypto.subtle.sign("HMAC", k2, enc.encode(dcs)))].map((x) => x.toString(16).padStart(2, "0")).join(""));
const li = await api("POST", "/api/tg/webapp-login", { initData: p.toString() });
assert.equal(li.code, 200); assert.equal(li.j.kind, "family");
const me = await api("GET", "/api/tg/me", undefined, "Bearer " + li.j.token);
assert.equal(me.j.elders[0].name, "가상순자");
assert.equal((await api("POST", "/api/tg/webapp-login", { initData: p.toString().replace("5001", "5009") })).code, 401);
step("미니 앱 로그인(텔레그램 확인은 통로가) → 온다 화면 토큰");

// 말벗 경보 다리: 말벗 기기 코드로 묶인 어르신 → 보호자가 아무도 확인 안 하면 온다 차례 출동
const el2 = await api("POST", "/api/tg/elders", { name: "가상말순", address: "가상시 나동 3", lat: 35.871, lng: 128.601, hi_code: "hi7788" }, H1);
await start(el2.j.url, 4002, "가상말순");
const hiSign = async (obj) => { const body = JSON.stringify(obj); const ts = String(Math.floor(Date.now() / 1000));
  const h = async (k, m) => [...new Uint8Array(await crypto.subtle.sign("HMAC", await crypto.subtle.importKey("raw", enc.encode(k), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]), enc.encode(m)))].map((x) => x.toString(16).padStart(2, "0")).join("");
  const sha = [...new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(body)))].map((x) => x.toString(16).padStart(2, "0")).join("");
  return mf.dispatchFetch("https://onda.test/api/tg/hi-alert", { method: "POST", body, headers: { "content-type": "application/json", "x-hi-ts": ts, "x-hi-sig": await h("hi-test-secret", ts + "." + sha) } }); };
assert.equal((await api("POST", "/api/tg/hi-alert", { code: "HI7788", type: "fall" })).code, 403, "서명 없으면 거절");
assert.equal((await hiSign({ code: "NOPE99", type: "fall" })).status, 404);
for (const c of [2001, 2002, 2003]) await say(c, "🟢 출동 받기 켜기");
await db.prepare("UPDATE onda_matches SET status='completed' WHERE status IN ('offered','accepted','moving','arrived','in_progress')").run();
const hr = await (await hiSign({ code: "HI7788", type: "fall", alert_key: "e9|fall|1" })).json();
assert.equal(hr.ok, true); assert.equal(hr.existing, false);
assert.ok(has(-3000, "말벗 감지")); assert.ok(to(2001).some((x) => x.body.text?.includes("[위급]") && x.body.text?.includes("가○○")));
step("말벗 쓰러짐 경보(보호자 무응답) → 온다 위급 차례 출동 · 상황실 «말벗 감지»");
{ // 같은 서명 다시 보내기 → 거절
  const body = JSON.stringify({ code: "HI7788", type: "fall" }); const ts = String(Math.floor(Date.now() / 1000));
  const h = async (k, m) => [...new Uint8Array(await crypto.subtle.sign("HMAC", await crypto.subtle.importKey("raw", enc.encode(k), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]), enc.encode(m)))].map((x) => x.toString(16).padStart(2, "0")).join("");
  const sha = [...new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(body)))].map((x) => x.toString(16).padStart(2, "0")).join("");
  const hd = { "content-type": "application/json", "x-hi-ts": ts, "x-hi-sig": await h("hi-test-secret", ts + "." + sha) };
  const a1 = await mf.dispatchFetch("https://onda.test/api/tg/hi-alert", { method: "POST", body, headers: hd });
  const a2 = await mf.dispatchFetch("https://onda.test/api/tg/hi-alert", { method: "POST", body, headers: hd });
  assert.equal(a1.status, 200); assert.equal(a2.status, 409); step("같은 서명 다시 보내기 → 거절");
}

// 통로 장부: 온다 봇 열쇠는 온다 쪽에 없음
assert.ok(!JSON.stringify(await (await mf.dispatchFetch("https://onda.test/health")).json()).includes("FAKE"));
console.log("\n온다 텔레그램판 시험 모두 통과");
await mf.dispose();
