// 실서버 예행 — 사무실 PC 에서: node test_tg/rehearse_live.mjs  (2026-11-23 Claude, 목표 2)
// 열쇠는 %USERPROFILE%\.cf-tokens 에서만 읽고 화면·파일에 내지 않는다. 끝나면 성공·실패와 상관없이 가상 사람을 지운다.
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { rehearse, cleanup } from "./rehearse_drive.mjs";
const T = join(homedir(), ".cf-tokens");
const rd = (f) => readFileSync(join(T, f), "utf8").trim();
const env = {
  onda: "https://onda-backend.pensive-kim.workers.dev", tongro: "https://alim-tongro.ansimservice.workers.dev",
  tongroAdmin: JSON.parse(rd("alim-tongro.json")).adminToken, rehToken: rd("onda_reh.token"), botToken: rd("onda_bot.token"),
};
if (process.env.ONDA_BASE) env.onda = process.env.ONDA_BASE;
const out = [];
const log = (s) => { console.log(s); out.push(s); };
const t0 = Date.now();
let res = null, err = null;
try { res = await rehearse({ ...env, log }); } catch (e) { err = String(e.message || e); log(err); }
const cl = await cleanup(env);
log(`치우기: 온다 ${JSON.stringify(cl.onda)} · 통로 ${JSON.stringify(cl.tongro)}`);
log(`${err ? "예행 멈춤" : "예행 끝"} · ${res ? res.steps.length : "?"}단계 · 예행 기록 ${res ? res.sent : "?"}건 · ${Math.round((Date.now() - t0) / 1000)}초 [사무실 PC 실측 ${new Date().toISOString()}]`);
writeFileSync(join(process.cwd(), "..", "텔레그램판", "예행_결과.txt"), out.join("\r\n"), "utf8");
process.exit(err ? 1 : 0);
