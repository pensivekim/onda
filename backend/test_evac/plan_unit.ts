import assert from "node:assert/strict";
import { planForAlert, summarize, deriveTaskStatus } from "../src/features/evac-dispatch/plan";
import { parseForecastCsv, isDispatchCandidate } from "../src/features/evac-dispatch/forecast";
// 오렌지 1명뿐 → 와상(더 무거움)이 먼저 받고, 휠체어·와상 모두 «모자람» 표시
const H = [{ user_id: "O1", grade: "orange" as const, lat: 36.351, lng: 128.702, available: true },
           { user_id: "G1", grade: "green" as const, lat: 36.351, lng: 128.701, available: true }];
const P = [{ id: "B", emd_code: "x", name: "B", mobility: "wheelchair" as const, lat: 36.35, lng: 128.70 },
           { id: "C", emd_code: "x", name: "C", mobility: "bed" as const, lat: 36.35, lng: 128.70 }];
const pl = planForAlert(P, H);
assert.equal(pl[0].person_id, "C"); assert.deepEqual(pl[0].offers.map(o => o.user_id).slice(0, 1), ["O1"]);
assert.equal(pl[0].shortfall, true); assert.equal(pl[1].shortfall, true);
// 그린 담당 도우미가 휠체어 분 담당이면 «동행»으로 제안되지만 등급은 채우지 못함
const pl2 = planForAlert([{ ...P[0], helper_id: "G1" }], H);
assert.deepEqual(pl2[0].offers.map(o => o.user_id), ["G1", "O1"]); assert.equal(pl2[0].shortfall, false);
// 상태 매핑
assert.equal(deriveTaskStatus(["expired", "completed"]), "at_shelter");
assert.equal(deriveTaskStatus(["expired"]), "no_answer");
assert.equal(deriveTaskStatus([], "none", true), "planned");
assert.equal(summarize(["at_shelter", "accepted", "no_answer", "handed_over"]).done_pct, 25);
// CSV: 따옴표 안 쉼표, 후보 규칙
const rows = parseForecastCsv('target_day,hazard,emd_code,emd,level,already,shelter_name\n2026-10-27,큰비,1,"가,나",기준넘음,1,\n2026-10-27,큰비,2,다,기준넘음,0,');
assert.equal(rows[0].emd, "가,나"); assert.equal(isDispatchCandidate(rows[0]), true); assert.equal(isDispatchCandidate(rows[1]), false);
console.log("단위 시험 통과");
// 담당 도우미는 다른 어르신이 먼저 가져가지 않음(로컬 검토에서 찾은 것)
{
  const H2 = [{ user_id: "H1", grade: "green" as const, lat: 36.3505, lng: 128.7003, available: true },
              { user_id: "H4", grade: "green" as const, lat: 36.3540, lng: 128.7030, available: true }];
  const P2 = [{ id: "E", emd_code: "x", name: "E", mobility: "walk" as const, lat: 36.3490, lng: 128.7015 },
              { id: "A", emd_code: "x", name: "A", mobility: "walk" as const, lat: 36.3500, lng: 128.7000, helper_id: "H1" }];
  const pl3 = planForAlert(P2, H2, { extraOffers: 0 });
  assert.equal(pl3.find(p => p.person_id === "A")!.offers[0].user_id, "H1");
  assert.ok(!pl3.find(p => p.person_id === "E")!.offers.some(o => o.user_id === "H1"));
  console.log("담당 도우미 먼저 떼어 두기 통과");
}
