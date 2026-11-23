// 다올 로컬 전체 검토 v2 — 실제 온다 백엔드(wrangler dev, 로컬 D1) + 실제 화면. 가상면·가상 인물만.
// 흐름: 예보 접수 → 군청 대피 시작 → 이웃 도우미 앱으로 수락·방문·대피 → 상황실 → 119 연계 → 결과 보고서
import { createRequire } from "module"; const { chromium } = createRequire(import.meta.url)("playwright");
import { sign } from "hono/jwt";
const API = "http://localhost:8787", WEB = "http://localhost:5173", SECRET = "local-review-secret";
const tok = async (sub, role, name) => await sign({ sub, role, name: name || sub, exp: Math.floor(Date.now()/1000) + 86400 }, SECRET, "HS256");
const ADMIN = await tok("gun_admin", "admin", "○○군 안전총괄과");
const call = async (m, p, b, t, h = {}) => { const r = await fetch(API + p, { method: m, headers: { "Content-Type": "application/json", ...(t ? { Authorization: "Bearer " + t } : {}), ...h }, body: b === undefined ? undefined : (typeof b === "string" ? b : JSON.stringify(b)) }); const x = await r.text(); try { return JSON.parse(x); } catch { return { status: r.status, text: x.slice(0, 200) }; } };
const log = (...a) => console.log(...a); const wait = (ms) => new Promise(r => setTimeout(r, ms));
const NAMES = { H1: "이장 김○○", H2: "주민 이○○", H3: "자율방재단 강○○", H4: "주민 정○○", O1: "요양보호사 박○○", O2: "생활지원사 최○○", O3: "요양보호사 한○○" };
const loc = { H1: [36.3505,128.7003], H2: [36.3520,128.7010], H3: [36.3480,128.6990], H4: [36.3540,128.7030], O1: [36.3510,128.7020], O2: [36.3530,128.6985], O3: [36.3495,128.7035] };
const setLoc = async () => { for (const [id, [lat, lng]] of Object.entries(loc)) await call("PATCH", "/api/responders/location", { lat, lng }, await tok(id, "responder", NAMES[id])); };
await setLoc();
const P = [["가상A","walk",36.3500,128.7000,"H1","BEN_A"],["가상B","wheelchair",36.3502,128.7008],["가상C","bed",36.3498,128.7012],["가상D","assist",36.3510,128.6995,"H3"],["가상E","walk",36.3490,128.7015],["가상F","assist",36.3525,128.7005]];
for (const [name, mobility, lat, lng, helper_id, beneficiary_id] of P) await call("POST", "/api/evac/people", { emd_code: "9999901", name, mobility, lat, lng, helper_id, beneficiary_id, contract_id: beneficiary_id ? "G1" : undefined }, ADMIN);
const head = "issued_at,target_day,run,hazard,emd_code,sido,sgg,emd,rank,n,level,already,pop,a65,a80,deadline,shelter_name,shelter_lat,shelter_lon,shelter_km";
log("1 예보 접수", JSON.stringify(await call("POST", "/api/evac/forecast", head + "\n2026-10-26T11:40+09:00,2026-10-26,새벽판,산불,9999901,경북,○○군,가상면,12,3482,상위5%,1,2100,980,310,18:00,가상면 경로당,36.355,128.705,0.7", null, { "Content-Type": "text/csv", "X-Evac-Key": "local-evac-key" })));

const b = await chromium.launch({ args: ["--lang=ko-KR"] });
const HIDE_TEST_BANNER = () => { document.addEventListener("DOMContentLoaded", () => { const st = document.createElement("style"); st.textContent = "#tb{display:none!important}"; document.head.appendChild(st); }); }; // 화면 캡처용: 위쪽 «테스트 중» 띠 숨김
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir: "vid", size: { width: 1440, height: 900 } }, locale: "ko-KR", timezoneId: "Asia/Seoul" });
await ctx.addInitScript((t) => localStorage.setItem("onda_token", t), ADMIN); await ctx.addInitScript(HIDE_TEST_BANNER);
const p = await ctx.newPage(); p.on("dialog", d => d.accept()); const errs = []; p.on("pageerror", e => errs.push(e.message));
await p.goto(WEB + "/admin/evac"); await p.waitForTimeout(3000); await p.screenshot({ path: "다올_화면_01_상황실_경보접수.png", fullPage: true });
await p.getByRole("button", { name: "대피 시작" }).click(); await p.waitForTimeout(3000); await p.screenshot({ path: "다올_화면_02_상황실_대피시작.png", fullPage: true });
log("2 대피 시작(군청 버튼)");

// 도우미 앱 화면(휴대폰)
const phone = async (id, file) => { const c = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: "ko-KR", timezoneId: "Asia/Seoul" });
  await c.addInitScript((t) => { localStorage.setItem("onda_token", t); localStorage.setItem("onda_lang", "ko"); }, await tok(id, "responder", NAMES[id])); await c.addInitScript(HIDE_TEST_BANNER);
  const hp = await c.newPage(); await hp.goto(WEB + "/responder"); await hp.waitForTimeout(3500); await hp.screenshot({ path: file }); return { c, hp }; };
const { c: oc, hp: ohp } = await phone("O1", "다올_화면_03_도우미앱_출동부탁.png");

// 이웃 도우미들이 기존 앱 입구로: 수락 → 이동 → 도착 → 모시고 출발 → 대피소 도착 (가상F 는 아무도 안 받음)
const step = async (id, upto) => { const t = await tok(id, "responder", NAMES[id]); const o = await call("GET", "/api/matches/offered", undefined, t);
  const m = (o.matches || []).find(x => x.status === "offered" && !String(x.description).includes("가○○ 어르신(부축 필요)") || (x.status === "offered" && !x.description.includes("면 — 가○○ 어르신(부축")));
  const mm = (o.matches || []).find(x => x.status === "offered"); if (!mm) return null;
  if (mm.description.includes("(부축 필요)") && id !== "H3") return null; // 가상F(부축, 담당 없음)는 일부러 비워 둠 → 119 연계 장면
  await call("POST", `/api/matches/${mm.id}/accept`, {}, t);
  for (const s of ["moving", "arrived", "in_progress", "completed"].slice(0, upto)) { await call("PATCH", `/api/matches/${mm.id}/status`, { status: s }, t); await wait(700); }
  return mm.id; };
log("3 방문·대피", JSON.stringify({ H1: !!(await step("H1", 1)), O1: !!(await step("O1", 2)), H3: !!(await step("H3", 1)) }));
await p.waitForTimeout(11000); await p.screenshot({ path: "다올_화면_04_상황실_방문중.png", fullPage: true });
// 도우미 앱 진행 화면
await ohp.reload(); await ohp.waitForTimeout(2500);
// 나머지 진행
for (const id of ["H1","O1","H3"]) { const t = await tok(id, "responder", NAMES[id]); const o = await call("GET", "/api/matches/offered", undefined, t);
  for (const m of (o.matches || []).filter(x => x.status !== "offered")) { const order = ["accepted","moving","arrived","in_progress","completed"]; let i = order.indexOf(m.status);
    while (i < 4) { i++; await call("PATCH", `/api/matches/${m.id}/status`, { status: order[i] }, t); await wait(500); } } }
for (const id of ["O2","O3","H2","H4"]) await step(id, 4);
await setLoc();
await p.waitForTimeout(11000); await p.screenshot({ path: "다올_화면_05_상황실_대부분완료.png", fullPage: true });
// 남은 분: 다시 배정 버튼이 있으면 한 번, 그다음 119 연계
const re = p.getByRole("button", { name: /다시 배정/ }); if (await re.count()) { await re.first().click(); await p.waitForTimeout(3000); }
const bd = await call("GET", "/api/evac/board?day=2026-10-26", undefined, ADMIN);
const left = bd.alerts[0].remaining; log("4 남은 분", left.map(r => `${r.person}#${r.slot}:${r.status}`).join(" | "));
for (const r of left) await call("POST", `/api/evac/tasks/${r.task_id}/flag`, { flag: "handed_over", note: "이웃 응답 없음 → 119·읍면사무소 차량으로 대피" }, ADMIN);
await p.waitForTimeout(11000); await p.screenshot({ path: "다올_화면_06_상황실_전원조치.png", fullPage: true });
log("5 상황판", JSON.stringify((await call("GET", "/api/evac/board?day=2026-10-26", undefined, ADMIN)).alerts[0].summary));
// 결과 보고서
await p.getByRole("link", { name: "결과 보고서" }).first().click(); await p.waitForTimeout(3500);
await p.screenshot({ path: "다올_화면_07_결과보고서.png", fullPage: true });
const rp = await call("GET", `/api/evac/alerts/${encodeURIComponent("2026-10-26|산불|9999901")}/report`, undefined, ADMIN);
log("6 보고", JSON.stringify(rp.totals), JSON.stringify(rp.timeline));
await p.emulateMedia({ media: "print" }); await p.pdf({ path: "다올_대피결과보고_예시.pdf", format: "A4", printBackground: true }); await p.emulateMedia({ media: "screen" });
await p.mouse.wheel(0, 900); await p.waitForTimeout(2000);
// 휴대폰 상황실
const mc = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: "ko-KR", timezoneId: "Asia/Seoul" }); await mc.addInitScript((t) => localStorage.setItem("onda_token", t), ADMIN); await mc.addInitScript(HIDE_TEST_BANNER);
const mp = await mc.newPage(); await mp.goto(WEB + "/admin/evac"); await mp.waitForTimeout(3000); await mp.screenshot({ path: "다올_화면_08_상황실_휴대폰.png" });
log("화면 오류", errs.length ? errs : "없음");
await ctx.close(); await oc.close(); await mc.close(); await b.close();
