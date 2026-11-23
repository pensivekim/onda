// 예행 입구 점검 — 준비 하나 만들고 답을 보이고 바로 치움 (열쇠는 보이지 않음)
import { readFileSync } from "node:fs"; import { homedir } from "node:os"; import { join } from "node:path";
const k = readFileSync(join(homedir(), ".cf-tokens", "onda_reh.token"), "utf8").trim();
const B = "https://onda-backend.pensive-kim.workers.dev";
const r = await fetch(B + "/api/tg/rehearse/setup", { method: "POST", headers: { authorization: "Bearer " + k, "content-type": "application/json" }, body: JSON.stringify({ helpers: ["가상하나"], ops: "reh-diag" }) });
const t = await r.text(); console.log("SETUP", r.status, t.replace(/https:\/\/t\.me\/\S+?"/g, 'LINK"').slice(0, 400));
const c = await fetch(B + "/api/tg/rehearse/clear", { method: "POST", headers: { authorization: "Bearer " + k } });
console.log("CLEAR", c.status, (await c.text()).slice(0, 400));
