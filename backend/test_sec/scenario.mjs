// 온다 보안·전 과정 시험 — 공격(엿보기·위조·악용)이 막히는지 + 웹 앱 요청이 «한 분씩 차례로» 끝까지 가는지
import { Miniflare } from "miniflare";
import { sign } from "hono/jwt";
import assert from "node:assert/strict";
const JWT = "test-secret", HI = "hi-secret", PADDLE = "paddle-secret";
const mf = new Miniflare({ modules: true, scriptPath: "test_sec/out.mjs", compatibilityDate: "2024-09-23",
  d1Databases: ["DB"], kvNamespaces: ["LOCATION_KV"], r2Buckets: ["CERT_BUCKET"],
  bindings: { JWT_SECRET: JWT, FRONTEND_URL: "https://onda.test", HI_ONDA_SECRET: HI, PADDLE_WEBHOOK_SECRET: PADDLE, KAKAO_CLIENT_ID: "kakao-test" } });
const db = await mf.getD1Database("DB"), kv = await mf.getKVNamespace("LOCATION_KV");
const now = () => Math.floor(Date.now() / 1000);
const tok = async (sub, role, type = "access") => "Bearer " + await sign({ sub, role, name: sub, type, iat: now(), exp: now() + 3600 }, JWT, "HS256");
const api = async (method, path, body, auth, headers = {}) => { const r = await mf.dispatchFetch("https://api.test" + path, { method, redirect: "manual",
  headers: { "content-type": "application/json", ...(auth ? { Authorization: auth } : {}), ...headers }, body: body === undefined ? undefined : (typeof body === "string" ? body : JSON.stringify(body)) });
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; } return { code: r.status, j, h: r.headers }; };
const enc = new TextEncoder();
const hex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
const hmac = async (k, m) => hex(await crypto.subtle.sign("HMAC", await crypto.subtle.importKey("raw", enc.encode(k), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]), enc.encode(m)));
const signedHdr = async (body) => { const ts = String(now()); return { "x-hi-ts": ts, "x-hi-sig": await hmac(HI, ts + "." + hex(await crypto.subtle.digest("SHA-256", enc.encode(body)))) }; };
const tick = async () => (await mf.getWorker()).scheduled({ cron: "* * * * *" });
const step = (s) => console.log("✔", s);
const q1 = (sql, ...a) => db.prepare(sql).bind(...a).first();

// 사람: 요청자 R, 도우미 H1(가장 가까움)·H2·H3, 엿보는 X, 관리자
await api("GET", "/health");
await (await mf.getWorker()).scheduled({ cron: "* * * * *" });   // 표 만들기
const P = { R: "req_가상순자", H1: "h_가상하나", H2: "h_가상두리", H3: "h_가상세찌", X: "x_엿보기" };
for (const [k, id] of Object.entries(P)) await db.prepare("INSERT INTO onda_users (id, name, role, region) VALUES (?, ?, ?, 'KR')").bind(id, k, k.startsWith("H") ? "responder" : "requester").run();
const near = { H1: [35.8701, 128.6001], H2: [35.8705, 128.6008], H3: [35.8720, 128.6020] };
for (const h of ["H1", "H2", "H3"]) {
  await db.prepare("INSERT INTO onda_responders (user_id, grade, status, available) VALUES (?, 'green', 'approved', 1)").bind(P[h]).run();
  await kv.put(`loc:${P[h]}`, near[h].join(","));
}
const T = {}; for (const [k, id] of Object.entries(P)) T[k] = await tok(id, k.startsWith("H") ? "responder" : "requester");
const ADMIN = await tok("admin1", "admin");

// ── 보안 ──
assert.equal((await api("POST", "/api/dispatch/webhook", { event_type: "fall", lat: 35.87, lng: 128.6 })).code, 403);
assert.equal((await api("POST", "/api/detect/dispatch", { event_type: "fall", lat: 35.87, lng: 128.6 })).code, 403);
step("서명 없는 자동 출동(말벗·감지) 거절");
const pd = JSON.stringify({ event_type: "transaction.completed", data: { id: "txn_1", custom_data: { onda_user_id: P.X, charge_amount: "9999999" } } });
assert.equal((await api("POST", "/api/wallet/paddle-webhook", pd)).code, 401);
const pts = String(now()); const psig = await hmac(PADDLE, `${pts}:${pd}`);
assert.equal((await api("POST", "/api/wallet/paddle-webhook", pd, null, { "paddle-signature": `ts=${pts};h1=${psig}` })).code, 200);
assert.equal((await api("POST", "/api/wallet/paddle-webhook", pd, null, { "paddle-signature": `ts=${pts};h1=${psig}` })).code, 200);
assert.equal((await q1("SELECT balance FROM onda_wallets WHERE user_id = ?", P.X)).balance, 9999999, "같은 거래는 한 번만");
await db.prepare("DELETE FROM onda_wallets WHERE user_id = ?").bind(P.X).run();
step("서명 없는 결제 확인 거절 · 같은 거래 두 번 충전 안 됨");
assert.equal((await api("GET", "/api/requests/my", undefined, await tok(P.R, "requester", "refresh"))).code, 401);
step("30일짜리 새로고침 열쇠로는 못 들어옴");
const ka = await api("GET", "/api/auth/kakao");
assert.equal(ka.code, 302); assert.match(ka.h.get("location"), /state=[a-f0-9]{32}/); assert.match(ka.h.get("set-cookie") || "", /onda_oauth_state=/);
const kc = await api("GET", "/api/auth/kakao/callback?code=abc&state=" + "0".repeat(32));
assert.match(kc.h.get("location"), /error=state/);
step("소셜 로그인 위조 막기(state)");

// ── 웹 앱 요청 → 한 분씩 차례 ──
await db.prepare("INSERT INTO onda_wallets (user_id, balance) VALUES (?, 50000)").bind(P.R).run();
const cr = await api("POST", "/api/dispatch/create", { type: "elder", address: "가상시 가상동 1-1", lat: 35.8700, lng: 128.6000, urgency: "urgent", description: "넘어지셨어요", source: "evac_forecast", region: "JP", gradeRequired: "zzz" }, T.R);
assert.equal(cr.code, 200); assert.equal(cr.j.candidateCount, 3);
const rq = await q1("SELECT source, region, grade_required FROM onda_requests WHERE id = ?", cr.j.requestId);
assert.deepEqual({ ...rq }, { source: "manual", region: "KR", grade_required: "green" }, "출처·나라·등급은 꾸밀 수 없음");
const offered = async () => (await db.prepare("SELECT responder_id FROM onda_matches WHERE request_id = ? AND status = 'offered'").bind(cr.j.requestId).all()).results.map((r) => r.responder_id);
assert.deepEqual(await offered(), [P.H1], "가장 가까운 한 분께만");
const again = await api("POST", "/api/dispatch/create", { type: "elder", lat: 35.87, lng: 128.6 }, T.R);
assert.equal(again.j.existing, true, "두 번 눌러도 새 출동 안 생김");
step("웹 앱 요청 → 가장 가까운 한 분께만 · 출처/나라/등급 꾸미기 막음 · 중복 요청 막음");

// 엿보기 막힘
for (const p of [`/api/dispatch/${cr.j.requestId}/status`, `/api/dispatch/${cr.j.requestId}/responder-location`, `/api/requests/${cr.j.requestId}`])
  assert.ok([403, 404].includes((await api("GET", p, undefined, T.X)).code), p);
assert.equal((await api("GET", `/api/dispatch/${cr.j.requestId}/status`, undefined, T.R)).code, 200);
step("남의 요청 상세·도우미 위치 엿보기 막힘");

const m1 = await q1("SELECT id FROM onda_matches WHERE request_id = ? AND responder_id = ?", cr.j.requestId, P.H1);
assert.equal((await api("POST", `/api/matches/${m1.id}/reject`, {}, T.H1)).code, 200);
assert.deepEqual(await offered(), [P.H2], "거절하면 바로 다음 분");
step("앱에서 거절 → 바로 다음 분께");
// H2 무응답 → 예약 작업 (앱만 쓰는 분은 90초)
await db.prepare("UPDATE onda_tgc_dispatch SET offered_at = offered_at - 200 WHERE request_id = ?").bind(cr.j.requestId).run();
await db.prepare("UPDATE onda_matches SET created_at = datetime('now','-5 minutes') WHERE request_id = ? AND status = 'offered'").bind(cr.j.requestId).run();
await tick();
assert.deepEqual(await offered(), [P.H3]); assert.equal((await q1("SELECT status FROM onda_requests WHERE id = ?", cr.j.requestId)).status, "pending");
step("답 없음 → 예약 작업이 다음 분께 (기존 60초 만료가 요청을 취소하지 않음)");
const m3 = await q1("SELECT id FROM onda_matches WHERE request_id = ? AND responder_id = ?", cr.j.requestId, P.H3);
const m2 = await q1("SELECT id FROM onda_matches WHERE request_id = ? AND responder_id = ?", cr.j.requestId, P.H2);
assert.equal((await api("POST", `/api/matches/${m2.id}/accept`, {}, T.H2)).code, 409, "시간 지난 제안은 수락 안 됨");
assert.equal((await api("POST", `/api/matches/${m3.id}/accept`, {}, T.H3)).code, 200);
assert.equal((await api("POST", `/api/matches/${m3.id}/reject`, {}, T.H3)).code, 409, "수락 뒤 거절로 멈추게 못 함");
for (const st of ["moving", "arrived", "in_progress"]) assert.equal((await api("PATCH", `/api/matches/${m3.id}/status`, { status: st }, T.H3)).code, 200);
step("H3 수락 → 출발 → 도착 → 돌봄 (수락 뒤 거절 막힘)");

// 채팅·후기·민원 엿보기/악용
await api("POST", `/api/chat/${m3.id}`, { content: "가는 중입니다" }, T.H3);
assert.equal((await api("GET", `/api/chat/${m3.id}?after=0`, undefined, T.X)).code, 404);
assert.equal((await api("GET", `/api/chat/${m3.id}?after=0`, undefined, T.R)).j.messages.length, 1);
step("남의 채팅 엿보기 막힘");

// 돌봄 30분 → 마침 (후원사가 있으면 후원사만 냄 — 지갑 그대로)
await db.prepare("INSERT INTO onda_sponsors (id, company_name, budget, spent, target_types, status) VALUES ('sp1', '가상 후원사', 100000, 0, 'child,elder', 'active')").run();
await db.prepare("UPDATE onda_matches SET started_at = ? WHERE id = ?").bind(new Date(Date.now() - 30 * 60000).toISOString(), m3.id).run();
assert.equal((await api("PATCH", `/api/matches/${m3.id}/status`, { status: "completed" }, T.H3)).code, 200);
assert.equal((await api("PATCH", `/api/matches/${m3.id}/status`, { status: "completed" }, T.H3)).code, 409, "두 번 마침 안 됨");
const st1 = await q1("SELECT COUNT(*) n, MAX(status) s FROM onda_settlements WHERE match_id = ?", m3.id);
assert.equal(st1.n, 1); assert.equal(st1.s, "sponsor_covered");
assert.equal((await q1("SELECT balance FROM onda_wallets WHERE user_id = ?", P.R)).balance, 50000, "후원사가 내면 지갑에서 안 빠짐(이중 결제 막음)");
step(`마침 → 정산 1건, 후원사만 냄(지갑 그대로) · 두 번 마침 막힘 [가상 30분, ${(await q1("SELECT amount FROM onda_matches WHERE id = ?", m3.id)).amount}원]`);

assert.equal((await api("POST", "/api/reviews", { matchId: m3.id, rating: 1 }, T.X)).code, 404);
assert.equal((await api("GET", `/api/reviews/${m3.id}`, undefined, T.X)).code, 404);
assert.equal((await api("POST", "/api/reviews", { matchId: m3.id, rating: 5, comment: "고맙습니다" }, T.R)).code, 200);
step("남이 후기 쓰기·보기 막힘, 요청자 후기 됨");
assert.equal((await api("POST", "/api/complaints", { targetId: P.H3, reason: "x" }, T.X)).code, 400);
assert.equal((await api("POST", "/api/complaints", { matchId: m3.id, targetId: P.H3, reason: "x" }, T.X)).code, 404);
assert.equal((await api("POST", "/api/complaints", { matchId: m3.id, targetId: P.H1, reason: "x" }, T.R)).code, 404, "출동 상대가 아니면 안 됨");
assert.equal((await api("POST", "/api/complaints", { matchId: m3.id, targetId: P.H3, reason: "늦음" }, T.R)).code, 200);
assert.equal((await api("POST", "/api/complaints", { matchId: m3.id, targetId: P.H3, reason: "또" }, T.R)).code, 409);
assert.equal((await q1("SELECT status FROM onda_responders WHERE user_id = ?", P.H3)).status, "approved", "한 사람이 여러 번 넣어 정지시키기 막음");
step("민원 악용(아무나·여러 번 → 자동 정지) 막힘");

// 지갑으로 내기 + 취소
await db.prepare("UPDATE onda_sponsors SET status = 'paused'").run();
const c2 = await api("POST", "/api/dispatch/create", { type: "child", lat: 35.87, lng: 128.6, urgency: "normal" }, T.R);
assert.equal((await api("DELETE", `/api/requests/${c2.j.requestId}`, undefined, T.R)).code, 200);
assert.equal((await q1("SELECT COUNT(*) n FROM onda_matches WHERE request_id = ? AND status = 'offered'", c2.j.requestId)).n, 0);
assert.equal((await q1("SELECT state FROM onda_tgc_dispatch WHERE request_id = ?", c2.j.requestId)).state, "cancelled");
step("부탁 취소 → 차례 멈춤·제안 닫힘");

// 말벗 서명 출동
const hb = JSON.stringify({ event_type: "fall", lat: 35.8702, lng: 128.6003, facility_id: "가상시설", phone: "010-0000-0000" });
const hr = await api("POST", "/api/dispatch/webhook", hb, null, await signedHdr(hb));
assert.equal(hr.code, 200);
const log = await q1("SELECT memo FROM onda_admin_logs WHERE action = 'hi_webhook' ORDER BY id DESC");
assert.ok(!String(log.memo).includes("010-"), "전화번호를 기록에 남기지 않음");
const hdr2 = await signedHdr(hb); await api("POST", "/api/dispatch/webhook", hb, null, hdr2);
assert.equal((await api("POST", "/api/dispatch/webhook", hb, null, hdr2)).code, 403, "같은 서명 다시 보내기 막힘");
step("말벗 서명 출동 됨 · 전화번호 기록 안 함 · 다시 보내기 막힘");

// 알림 읽음은 내 것만
await db.prepare("INSERT INTO onda_notifications (user_id, title) VALUES (?, 'r')").bind(P.R).run();
const nid = (await q1("SELECT MAX(id) id FROM onda_notifications WHERE user_id = ?", P.R)).id;
await api("POST", "/api/notifications/read", { ids: [nid] }, T.X);
assert.equal((await q1("SELECT read FROM onda_notifications WHERE id = ?", nid)).read, 0);
step("남의 알림 읽음 처리 막힘");
// 비밀번호 맞히기 막기
{ const rr = await api("POST", "/api/auth/register", { email: "gaeseong@test.invalid", password: "correct-horse-123", name: "가상" }); assert.equal(rr.code, 200, JSON.stringify(rr.j)); }
for (let i = 0; i < 8; i++) assert.equal((await api("POST", "/api/auth/login", { email: "gaeseong@test.invalid", password: "틀린" + i })).code, 401);
assert.equal((await api("POST", "/api/auth/login", { email: "gaeseong@test.invalid", password: "correct-horse-123" })).code, 429, "8번 틀리면 맞는 비밀번호도 잠시 막힘");
assert.equal((await api("POST", "/api/auth/register", { email: "naseong@test.invalid", password: "correct-horse-456", name: "가상2" })).code, 200);
assert.equal((await api("POST", "/api/auth/login", { email: "naseong@test.invalid", password: "correct-horse-456" })).code, 200);
step("비밀번호 8번 틀리면 15분 잠금 · 다른 계정은 그대로");
console.log("\n온다 보안·전 과정 시험 모두 통과");
await mf.dispose();
