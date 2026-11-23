// 이웃대피 1단계 시험 — 가상 마을(가상 읍면동 코드 9999901), 가상 사람·도우미. 실제 개인정보 없음.
import { Miniflare } from "miniflare";
import { sign } from "hono/jwt";
import assert from "node:assert/strict";
const SECRET = "test-secret", KEY = "evac-key";
const mf = new Miniflare({ modules: true, scriptPath: "test_evac/out.mjs", compatibilityDate: "2024-09-23",
  d1Databases: ["DB"], kvNamespaces: ["LOCATION_KV"], bindings: { JWT_SECRET: SECRET, EVAC_INGEST_KEY: KEY } });
const db = await mf.getD1Database("DB"), kv = await mf.getKVNamespace("LOCATION_KV");
const tok = async (sub, role) => "Bearer " + await sign({ sub, role, name: sub }, SECRET, "HS256");
const ADMIN = await tok("gun_admin", "admin");
const call = async (method, path, body, auth, ctype = "application/json") => {
  const r = await mf.dispatchFetch("http://x" + path, { method, headers: { "Content-Type": ctype, ...(auth ? { Authorization: auth } : {}), "X-Evac-Key": KEY },
    body: body === undefined ? undefined : (typeof body === "string" ? body : JSON.stringify(body)) });
  return { code: r.status, j: await r.json() };
};
const log = (...a) => console.log(...a);
const bugs = new Set();

// 첫 호출로 표 만들기
assert.equal((await call("GET", "/api/evac/board", undefined, ADMIN)).code, 200);
// 도우미: 가상 마을 중심 36.3500,128.7000 둘레
const H = [ ["H1","green",36.3505,128.7003], ["H2","green",36.3520,128.7010], ["O1","orange",36.3510,128.7020],
            ["O2","orange",36.3530,128.6990], ["O3","orange",36.3490,128.7030], ["O4","orange",36.4220,128.7000] /* 약 8km, 반경 밖 */ ];
for (const [id, g, la, lo] of H) {
  await db.prepare("INSERT INTO onda_users (id, name, role) VALUES (?, ?, 'responder')").bind(id, id).run();
  await db.prepare("INSERT INTO onda_responders (user_id, grade, status, available) VALUES (?, ?, 'approved', 1)").bind(id, g).run();
  await kv.put(`loc:${id}`, `${la},${lo}`);
}
// 지자체 계약(가상군, 예산 100만원) + 수혜자 계정(가상A)
await db.prepare("INSERT INTO onda_gov_contracts (id, gov_name, region, budget) VALUES ('G1','가상군','KR',1000000)").run();
await db.prepare("INSERT INTO onda_users (id, name, role) VALUES ('U_A','가상A','requester')").run();
await db.prepare("INSERT INTO onda_gov_beneficiaries (id, contract_id, user_id, name) VALUES ('BEN_A','G1','U_A','가상A')").run();
// 명단: 걸음(담당 H1) · 휠체어 · 와상
const P = [ { name: "가상A", mobility: "walk", lat: 36.3500, lng: 128.7000, helper_id: "H1", beneficiary_id: "BEN_A", contract_id: "G1" },
            { name: "가상B", mobility: "wheelchair", lat: 36.3502, lng: 128.7008 },
            { name: "가상C", mobility: "bed", lat: 36.3498, lng: 128.7012 } ];
for (const p of P) assert.equal((await call("POST", "/api/evac/people", { emd_code: "9999901", ...p }, ADMIN)).j.ok, true);

// 1) 예보 CSV (약속 형식 v1 칸 그대로). 2번째 줄은 «기준넘음» → 후보 아님
const head = "issued_at,target_day,run,hazard,emd_code,sido,sgg,emd,rank,n,level,already,pop,a65,a80,deadline,shelter_name,shelter_lat,shelter_lon,shelter_km";
const csv = "﻿" + head + "\n" +
  "2026-10-26T11:40+09:00,2026-10-27,전날판,산불,9999901,경북,가상군,가상면,40,3482,상위5%,0,2100,980,310,18:00,가상면 경로당,36.3550,128.7050,0.7\n" +
  "2026-10-26T11:40+09:00,2026-10-27,전날판,강풍,9999902,경북,가상군,다른면,900,3482,기준넘음,0,1500,600,200,18:00,,,,\n";
let r = await call("POST", "/api/evac/forecast", csv, null, "text/csv");
log("예보1", r.j); assert.equal(r.j.candidates, 1); assert.equal(r.j.tasksNew, 4 /* A1 B1 C2 */); assert.equal(r.j.watchNotices, 1);
const n1 = await db.prepare("SELECT title FROM onda_notifications WHERE user_id='H1' AND type='evac_watch'").all();
log("사전점검 알림", n1.results.map(x => x.title));
// 같은 예보 다시 → 중복 없음
r = await call("POST", "/api/evac/forecast", csv, null, "text/csv");
assert.equal(r.j.tasksNew, 0); assert.equal(r.j.watchNotices, 0); assert.equal(r.j.alertsUpdated, 1);
// 열쇠 틀리면 거절
const bad = await mf.dispatchFetch("http://x/api/evac/forecast", { method: "POST", headers: { "X-Evac-Key": "no", "Content-Type": "text/csv" }, body: csv });
assert.equal(bad.status, 403);

// 2) 상황판: 시작 전 = 3명 모두 대기
const alertId = "2026-10-27|산불|9999901";
r = await call("GET", "/api/evac/board?day=2026-10-27", undefined, ADMIN);
log("시작 전", r.j.alerts[0].summary); assert.equal(r.j.alerts[0].summary.total, 3); assert.equal(r.j.alerts[0].summary.waiting, 3);

// 3) 대피 시작(군청)
r = await call("POST", `/api/evac/alerts/${encodeURIComponent(alertId)}/start`, {}, ADMIN);
log("대피 시작", r.j);
const offers = (await db.prepare(`SELECT t.person_id, p.name, t.slot, m.responder_id, m.id mid FROM onda_evac_tasks t JOIN onda_evac_people p ON p.id=t.person_id
  JOIN onda_matches m ON m.request_id=t.request_id ORDER BY p.name, t.slot`).all()).results;
const by = {}; offers.forEach(o => (by[`${o.name}#${o.slot}`] ||= []).push(o.responder_id));
log("제안", by);
assert.ok(by["가상A#1"].includes("H1"), "담당 도우미 먼저");
assert.ok(by["가상B#1"].every(h => h.startsWith("O")), "휠체어는 오렌지만");
assert.ok(!Object.values(by).flat().includes("O4"), "반경 밖 제외");
const cAll = [...by["가상C#1"], ...by["가상C#2"]]; assert.equal(new Set(cAll).size, cAll.length, "와상 두 칸 중복 제안 없음");
const allOffered = Object.values(by).flat(); assert.equal(new Set(allOffered).size, allOffered.length, "한 도우미가 두 집에 중복 제안 안 됨");

// 4) 도우미가 기존 앱 흐름으로 처리: A(H1) 대피소 도착까지, B 수락, C 1칸 도착
const mid = (name, slot, who) => offers.find(o => o.name === name && o.slot === slot && o.responder_id === who).mid;
const step = async (m, who, sts) => { await call("POST", `/api/matches/${m}/accept`, {}, await tok(who, "responder"));
  for (const s of sts) {
    const r = await mf.dispatchFetch(`http://x/api/matches/${m}/status`, { method: "PATCH", headers: { "Content-Type": "application/json", Authorization: await tok(who, "responder") }, body: JSON.stringify({ status: s }) });
    // ※ 기존 온다 버그: «완료»에서 amount 변수 범위 오류로 500(상태는 DB에 저장됨). 고치지 않고 보고만 함 → 완료만 500 허용
    if (s === "completed") { if (r.status !== 200) bugs.add(`완료 버튼 ${r.status}`); } else assert.equal(r.status, 200);
  } };
await step(mid("가상A", 1, "H1"), "H1", ["moving", "arrived", "in_progress", "completed"]);
await step(mid("가상B", 1, by["가상B#1"][0]), by["가상B#1"][0], ["moving"]);
await step(mid("가상C", 1, by["가상C#1"][0]), by["가상C#1"][0], ["moving", "arrived", "in_progress", "completed"]);
r = await call("GET", "/api/evac/board?day=2026-10-27", undefined, ADMIN);
const s = r.j.alerts[0].summary; log("진행 중", s, r.j.alerts[0].remaining.map(x => `${x.person}#${x.slot}:${x.status}`));
assert.equal(s.done, 1); assert.equal(s.moving, 1); assert.equal(s.waiting, 1); // C는 2칸 중 1칸만 끝남, 남은 칸은 이웃 찾는 중 → 대기로 셈

// 지자체 대납: 완료 버튼 정상(200) + 가상A 출동 비용이 계약 사용액에 잡힘
assert.equal(bugs.size, 0, "완료 버튼 오류 없어야 함(고친 뒤)");
const g = await db.prepare("SELECT spent, used_requests_month FROM onda_gov_contracts WHERE id='G1'").first();
const st1 = await db.prepare("SELECT s.status, s.amount FROM onda_settlements s JOIN onda_matches m ON m.id=s.match_id WHERE m.responder_id='H1'").first();
log("지자체 대납", g, st1); assert.equal(g.used_requests_month, 1); assert.equal(st1.status, "gov_covered");

// 5) C 2번째 칸 제안이 모두 만료(60초) → «응답 없음» → 다시 시작하면 그 칸만 다시 제안
await db.prepare(`UPDATE onda_matches SET status='expired' WHERE status='offered'`).run();
r = await call("GET", "/api/evac/board?day=2026-10-27", undefined, ADMIN);
log("만료 뒤", r.j.alerts[0].summary); assert.equal(r.j.alerts[0].summary.needs_reoffer, 1);
r = await call("POST", `/api/evac/alerts/${encodeURIComponent(alertId)}/start`, {}, ADMIN);
log("다시 배정", r.j); assert.ok(r.j.offered >= 1);

// 6) 새벽판(already=1)이 오면 «바로 대피» 단계로 올라감
const csv2 = head + "\n2026-10-27T05:10+09:00,2026-10-27,새벽판,산불,9999901,경북,가상군,가상면,12,3482,상위5%,1,2100,980,310,18:00,,,,\n";
r = await call("POST", "/api/evac/forecast", csv2, null, "text/csv"); assert.equal(r.j.alertsUpdated, 1);
const st = await db.prepare("SELECT stage, shelter_name FROM onda_evac_alerts WHERE id=?").bind(alertId).first();
log("새벽판 뒤", st); assert.equal(st.stage, "evacuate_now"); assert.equal(st.shelter_name, "가상면 경로당", "빈 대피소 칸이 기존 값을 지우지 않음");
log("\n모든 시험 통과", bugs.size ? "· 발견한 기존 버그: " + [...bugs].join(", ") : "");
await mf.dispose();
