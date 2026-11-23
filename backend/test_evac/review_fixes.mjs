// 2026-10-26 검토 지적 고친 것 시험 — 가상 자료만
import { Miniflare } from "miniflare";
import { sign } from "hono/jwt";
import assert from "node:assert/strict";
const SECRET = "s", KEY = "k", HOOK = "h";
const mf = new Miniflare({ modules: true, scriptPath: "test_evac/out.mjs", compatibilityDate: "2024-09-23", d1Databases: ["DB"], kvNamespaces: ["LOCATION_KV"],
  bindings: { JWT_SECRET: SECRET, EVAC_INGEST_KEY: KEY, TELEGRAM_BOT_TOKEN: "T", TELEGRAM_BOT_NAME: "b", TELEGRAM_WEBHOOK_SECRET: HOOK },
  outboundService: async () => new Response('{"ok":true,"result":{"message_id":1}}', { headers: { "Content-Type": "application/json" } }) });
const db = await mf.getD1Database("DB"), kv = await mf.getKVNamespace("LOCATION_KV");
const tok = async (sub, role = "responder") => "Bearer " + await sign({ sub, role, name: sub }, SECRET, "HS256");
const ADMIN = await tok("adm", "admin");
const call = async (m, p, b, h = {}) => { const r = await mf.dispatchFetch("http://x" + p, { method: m, headers: { "Content-Type": "application/json", ...h }, body: b === undefined ? undefined : (typeof b === "string" ? b : JSON.stringify(b)) }); const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; } return { code: r.status, j }; };
const ok = (name) => console.log("  ✓", name);
await call("GET", "/api/evac/board", undefined, { Authorization: ADMIN });
const HS = [["G1","green",36.3501,128.7001],["G2","green",36.3502,128.7002],["G3","green",36.3503,128.7003],["G4","green",36.3504,128.7004]];
for (const [id, g, la, lo] of HS) { await db.prepare("INSERT INTO onda_users (id,name,role) VALUES (?,?,'responder')").bind(id, id).run();
  await db.prepare("INSERT INTO onda_responders (user_id,grade,status,available) VALUES (?,?,'approved',1)").bind(id, g).run(); await kv.put(`loc:${id}`, `${la},${lo}`); }
await db.prepare("INSERT INTO onda_gov_contracts (id,gov_name,region,budget) VALUES ('C1','가상군','KR',1000000)").run();
await db.prepare("INSERT INTO onda_users (id,name,role) VALUES ('UA','가상A','requester')").run();
await db.prepare("INSERT INTO onda_gov_beneficiaries (id,contract_id,user_id,name) VALUES ('BA','C1','UA','가상A')").run();
await db.prepare("INSERT INTO onda_wallets (user_id,balance) VALUES ('UA',100000)").run().catch(()=>{});
await call("POST", "/api/evac/people", { emd_code: "9", name: "가상A", mobility: "walk", lat: 36.35, lng: 128.70, beneficiary_id: "BA" }, { Authorization: ADMIN });
await call("POST", "/api/evac/people", { emd_code: "9", name: "가상B", mobility: "walk", lat: 36.35, lng: 128.70 }, { Authorization: ADMIN });
const head = "issued_at,target_day,run,hazard,emd_code,sido,sgg,emd,rank,n,level,already,pop,a65,a80,deadline,shelter_name,shelter_lat,shelter_lon,shelter_km";
const csv = (day, emd, lvl = "상위5%", ex = "") => head + `\n2026-10-26T11:40+09:00,${day},전날판,산불,${emd},경북,가상군,면${emd},1,3482,${lvl},0,100,50,10,18:00,${ex},,,`;
// 날짜 형식 틀린 줄 버림
let r = await call("POST", "/api/evac/forecast", csv("20261027", "9"), { "Content-Type": "text/csv", "X-Evac-Key": KEY }); assert.equal(r.j.candidates, 0); ok("날짜 형식 틀린 줄 버림");
// 동시 예보 두 번 → 500 없음
const [a1, a2] = await Promise.all([1, 2].map(() => call("POST", "/api/evac/forecast", csv("2026-10-27", "9"), { "Content-Type": "text/csv", "X-Evac-Key": KEY })));
assert.equal(a1.code, 200); assert.equal(a2.code, 200); ok("예보 동시 두 번 → 오류 없음");
const AID = encodeURIComponent("2026-10-27|산불|9");
// 대피 시작 동시 두 번 → 칸마다 요청 하나
await Promise.all([1, 2].map(() => call("POST", `/api/evac/alerts/${AID}/start`, {}, { Authorization: ADMIN })));
const reqs = (await db.prepare("SELECT COUNT(*) c FROM onda_requests WHERE source='evac_forecast'").first()).c;
const tasks = (await db.prepare("SELECT COUNT(*) c FROM onda_evac_tasks").first()).c;
assert.equal(reqs, tasks); ok(`대피 시작 동시 두 번 → 요청 ${reqs}개 = 칸 ${tasks}개`);
const offers = (await db.prepare("SELECT responder_id FROM onda_matches WHERE status='offered'").all()).results.map(x => x.responder_id);
assert.equal(new Set(offers).size, offers.length); ok("한 도우미가 두 집에 겹쳐 제안 안 됨: " + offers.join(","));
// 동시에 두 사람이 같은 요청 수락 → 한 사람만
const tA = await db.prepare("SELECT t.request_id FROM onda_evac_tasks t JOIN onda_evac_people p ON p.id=t.person_id WHERE p.name='가상A'").first();
const mA = (await db.prepare("SELECT id, responder_id FROM onda_matches WHERE request_id=?").bind(tA.request_id).all()).results;
assert.ok(mA.length >= 2, "가상A 제안 2명 이상");
const res = await Promise.all(mA.slice(0, 2).map(async m => call("POST", `/api/matches/${m.id}/accept`, {}, { Authorization: await tok(m.responder_id) })));
const accepted = (await db.prepare("SELECT COUNT(*) c FROM onda_matches WHERE request_id=? AND status='accepted'").bind(tA.request_id).first()).c;
assert.equal(accepted, 1); ok(`동시 수락 → 1명만 (응답 ${res.map(x => x.code).join(",")})`);
const winner = (await db.prepare("SELECT id, responder_id FROM onda_matches WHERE request_id=? AND status='accepted'").bind(tA.request_id).first());
const loser = mA.slice(0, 2).find(m => m.id !== winner.id);
// 취소된 제안으로 «완료» 못 누름
r = await call("PATCH", `/api/matches/${loser.id}/status`, { status: "completed" }, { Authorization: await tok(loser.responder_id) });
assert.equal(r.code, 409); ok("취소된 제안으로 완료 → 409");
// 순서 건너뛰기 못 함
r = await call("PATCH", `/api/matches/${winner.id}/status`, { status: "completed" }, { Authorization: await tok(winner.responder_id) });
assert.equal(r.code, 409); ok("수락에서 바로 완료 → 409");
// 남의 출동 상세 못 봄
r = await call("GET", `/api/matches/${winner.id}`, undefined, { Authorization: await tok("G4") }); assert.equal(r.code, 404);
r = await call("GET", `/api/matches/${winner.id}`, undefined, { Authorization: await tok(winner.responder_id) }); assert.equal(r.code, 200); ok("출동 상세는 본인·관리자만");
r = await call("GET", "/api/matches/offered", undefined, { Authorization: await tok(winner.responder_id) }); assert.ok(Array.isArray(r.j.matches)); ok("도우미 목록 입구(/api/matches/offered) 정상 — 전에는 404");
// 끝까지 → 지자체 대납, 지갑 차감 없음
for (const s of ["moving", "arrived", "in_progress", "completed"]) { r = await call("PATCH", `/api/matches/${winner.id}/status`, { status: s }, { Authorization: await tok(winner.responder_id) }); assert.equal(r.code, 200, s); }
const w = await db.prepare("SELECT balance FROM onda_wallets WHERE user_id='UA'").first().catch(() => null);
const st = await db.prepare("SELECT status FROM onda_settlements WHERE match_id=?").bind(winner.id).first();
assert.equal(st.status, "gov_covered"); if (w) assert.equal(w.balance, 100000); ok(`지자체 대납(gov_covered), 어르신 지갑 그대로 ${w ? w.balance : "(지갑 없음)"}`);
// 거절한 도우미는 같은 칸에 다시 안 부름
const tB = await db.prepare("SELECT t.request_id FROM onda_evac_tasks t JOIN onda_evac_people p ON p.id=t.person_id WHERE p.name='가상B'").first();
const mB = (await db.prepare("SELECT id, responder_id FROM onda_matches WHERE request_id=? AND status='offered'").bind(tB.request_id).all()).results;
for (const m of mB) await call("POST", `/api/matches/${m.id}/reject`, {}, { Authorization: await tok(m.responder_id) });
await call("POST", `/api/evac/alerts/${AID}/start`, {}, { Authorization: ADMIN });
const again = (await db.prepare("SELECT responder_id FROM onda_matches WHERE request_id=? AND status='offered'").bind(tB.request_id).all()).results.map(x => x.responder_id);
assert.ok(again.every(x => !mB.map(m => m.responder_id).includes(x))); ok(`거절한 도우미(${mB.map(m=>m.responder_id)}) 빼고 다시 배정 → ${again.join(",") || "(남은 사람 없음)"}`);
// 텔레그램: 단체방 연결 거절, 도착 전 «못 모심» 거절
const l = await call("POST", "/api/evac/telegram/link", {}, { Authorization: await tok("G4") }); const code = l.j.url.split("start=")[1];
r = await call("POST", "/api/evac/telegram/webhook", { message: { text: `/start ${code}`, chat: { id: -100, type: "group" }, from: { id: 44 } } }, { "X-Telegram-Bot-Api-Secret-Token": HOOK });
assert.equal(r.j.linked, undefined); ok("단체방에서는 연결 안 됨");
r = await call("POST", "/api/evac/telegram/webhook", { message: { text: `/start ${code}`, chat: { id: 44, type: "private" }, from: { id: 44 } } }, { "X-Telegram-Bot-Api-Secret-Token": HOOK });
assert.equal(r.j.linked, "G4");
const g4 = await db.prepare("SELECT id FROM onda_matches WHERE responder_id='G4' AND status='offered'").first();
if (g4) { r = await call("POST", "/api/evac/telegram/webhook", { callback_query: { id: "x", data: `u:${g4.id}`, from: { id: 44 }, message: { message_id: 1, chat: { id: 44 } } } }, { "X-Telegram-Bot-Api-Secret-Token": HOOK });
  const fl = await db.prepare("SELECT flag FROM onda_evac_tasks WHERE request_id=(SELECT request_id FROM onda_matches WHERE id=?)").bind(g4.id).first();
  assert.equal(fl.flag, "none"); ok("도착 전 «못 모심» 버튼 안 먹음"); }
// 상황판 정렬: 바로 대피가 위
await call("POST", "/api/evac/forecast", head + "\n2026-10-27T05:00+09:00,2026-10-27,새벽판,큰비,8,경북,가상군,면8,1,3482,상위5%,1,100,50,1,18:00,,,,", { "Content-Type": "text/csv", "X-Evac-Key": KEY });
const bd = await call("GET", "/api/evac/board?day=2026-10-27", undefined, { Authorization: ADMIN });
assert.equal(bd.j.alerts[0].stage, "evacuate_now"); ok("상황판: «바로 대피» 경보가 맨 위");
// 이름 가리기
const desc = (await db.prepare("SELECT description FROM onda_requests WHERE source='evac_forecast' LIMIT 1").first()).description;
assert.ok(!desc.includes("가상A") && !desc.includes("가상B")); ok("요청 설명에 실명 없음: " + desc.slice(0, 40));
// 대피 결과 보고: 가상A 대피 완료·출동비 정산이 보고서에 잡힘
const rp = await call("GET", `/api/evac/alerts/${AID}/report`, undefined, { Authorization: ADMIN });
assert.equal(rp.code, 200); assert.equal(rp.j.totals.people, 2); assert.equal(rp.j.totals.done, 1); assert.ok(rp.j.totals.cost_krw > 0);
assert.ok(rp.j.timeline.started_at && rp.j.timeline.first_accept_at && rp.j.timeline.last_shelter_at);
const ra = rp.j.people.find(x => x.name === "가상A"); assert.equal(ra.result, "대피 완료"); assert.ok(ra.helper);
ok(`대피 결과 보고: 대상 ${rp.j.totals.people}명 · 완료 ${rp.j.totals.done}명 · 출동비 ${rp.j.totals.cost_krw}원`);
r = await call("GET", `/api/evac/alerts/${AID}/report`, undefined, { Authorization: await tok("G1") }); assert.equal(r.code, 403); ok("보고서는 관리자만");
console.log("\n검토 지적 시험 모두 통과"); await mf.dispose();
