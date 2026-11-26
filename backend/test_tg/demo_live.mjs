// 시연 입구 실서버 예행 — 사무실 PC 에서: node test_tg/demo_live.mjs  (2026-11-26 Claude)
// 가상 번호(99000000004x)만 쓰므로 텔레그램으로는 아무것도 나가지 않고 알림 통로의 «예행 기록»에만 남는다.
// 열쇠는 %USERPROFILE%\.cf-tokens 에서만 읽고 화면·파일에 내지 않는다. 끝나면 성공·실패와 상관없이 시연·가상 사람을 지운다.
// 주의: 실제 시연 준비가 이미 있으면(409) 손대지 않고 멈춘다.
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { cleanup } from "./rehearse_drive.mjs";
const T = join(homedir(), ".cf-tokens");
const rd = (f) => readFileSync(join(T, f), "utf8").trim();
const env = { onda: process.env.ONDA_BASE || "https://onda-backend.pensive-kim.workers.dev", tongro: "https://alim-tongro.ansimservice.workers.dev",
  tongroAdmin: JSON.parse(rd("alim-tongro.json")).adminToken, rehToken: rd("onda_reh.token") };
const ID = { fam: 990000000041, h1: 990000000042, h2: 990000000043 };
const out = []; const log = (s) => { console.log(s); out.push(s); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (c, m) => { if (!c) throw new Error("✖ " + m); };
const j = async (r) => { const t = await r.text(); try { return { code: r.status, j: JSON.parse(t), h: r.headers } } catch { return { code: r.status, j: t, h: r.headers } } };
const R = "Bearer " + env.rehToken;
const onda = (m, p, b, h = {}) => fetch(env.onda + p, { method: m, headers: { "content-type": "application/json", ...h }, body: b === undefined ? undefined : JSON.stringify(b) }).then(j);
const tAdmin = (m, p, b) => fetch(env.tongro + p, { method: m, headers: { authorization: "Bearer " + env.tongroAdmin, "content-type": "application/json" }, body: b ? JSON.stringify(b) : undefined }).then(j);
let mid = 0, uid = 0, rows = [];
const inject = async (update) => { const r = await tAdmin("POST", "/admin/rehearse", { bot_id: "onda", update }); ok(r.code === 200, "넣기 실패 " + r.code); await wait(300); };
const start = (url, chat) => inject({ message: { message_id: ++mid, chat: { id: chat, type: "private" }, from: { id: chat, first_name: "가상" }, text: "/start " + url.split("start=")[1] } });
const pull = async () => { const after = rows.length ? rows.at(-1).id : 0; const r = await tAdmin("GET", "/admin/rehearse/log?after=" + after); ok(r.code === 200, "기록 읽기 실패"); rows.push(...r.j.rows.map((x) => ({ ...x, b: JSON.parse(x.body) }))); };
const to = async (chat) => { await pull(); return rows.filter((x) => String(x.chat_id) === String(chat)); };
const has = async (chat, s, tries = 10) => { for (let i = 0; i < tries; i++) { if ((await to(chat)).some((x) => (x.b.text || "").includes(s))) return true; await wait(700); } return false; };
const press = async (chat, label) => {
  for (let i = 0; i < 10; i++) {
    const list = (await to(chat)).reverse();
    for (const x of list) for (const b of (x.b.reply_markup?.inline_keyboard || []).flat())
      if (b.text.includes(label) && b.callback_data) {
        const msgId = x.method === "editMessageText" ? x.b.message_id : 900000 + Number(x.id);
        return inject({ callback_query: { id: "reh" + (++uid) + "-" + Date.now(), data: b.callback_data, from: { id: chat, first_name: "가상누름" }, message: { message_id: msgId, chat: { id: chat }, text: "(원문)" } } });
      }
    await wait(700);
  }
  throw new Error(`✖ ${chat} 에 «${label}» 버튼 없음`);
};
const t0 = Date.now(); let err = null, made = false;
try {
  ok((await onda("POST", "/api/tg/demo/setup", {}, { authorization: "Bearer wrong" })).code === 404, "틀린 열쇠가 열림");
  const su = await onda("POST", "/api/tg/demo/setup", { elder: { name: "가상 예행어르신", address: "가상시 가상동 1-1", lat: 35.8710, lng: 128.5600 },
    helpers: ["가상 예행도우미1", "가상 예행도우미2"], family: ["딸"], hours: 1 }, { authorization: R });
  if (su.code === 409) throw new Error("실제 시연 준비가 있어 예행을 건너뜀(그대로 둠)");
  ok(su.code === 200, "준비 실패 " + su.code); made = true;
  const K = { "x-demo-key": su.j.key };
  await start(su.j.family[0].url, ID.fam); await start(su.j.helpers[0].url, ID.h1); await start(su.j.helpers[1].url, ID.h2);
  let st = await onda("GET", "/api/tg/demo/status", undefined, K);
  ok(st.j.family === 1 && st.j.helpers.linked === 2, "연결 수 " + JSON.stringify(st.j));
  log("✔ 준비: 가족 1·도우미 2 연결");
  const pre = await fetch(env.onda + "/api/tg/demo/alarm", { method: "OPTIONS", headers: { origin: "https://hi.genomic.cc", "access-control-request-method": "POST", "access-control-request-headers": "x-demo-key" } });
  ok(pre.headers.get("access-control-allow-origin") === "https://hi.genomic.cc", "말벗 화면 허용 안 됨");
  const pre2 = await fetch(env.onda + "/api/tg/demo/setup", { method: "OPTIONS", headers: { origin: "https://hi.genomic.cc", "access-control-request-method": "POST" } });
  ok(pre2.headers.get("access-control-allow-origin") !== "https://hi.genomic.cc", "준비 입구가 말벗 화면에 열림");
  log("✔ CORS: 말벗 화면은 시연 입구만");
  const ta = Date.now();
  const al = await onda("POST", "/api/tg/demo/alarm", {}, K);
  ok(al.code === 200 && al.j.queued === 2, "경보 " + JSON.stringify(al.j));
  ok(await has(ID.fam, "불꽃"), "가족 불꽃 알림 없음");
  ok(await has(ID.h1, "긴급 돌봄 부탁") || await has(ID.h2, "긴급 돌봄 부탁"), "도우미 부탁 없음");
  log(`✔ 경보 → 가족 «불꽃» 알림 · 도우미 부탁 (${Date.now() - ta}ms)`);
  const who = (await to(ID.h1)).some((x) => (x.b.text || "").includes("긴급 돌봄 부탁")) ? ID.h1 : ID.h2;
  await press(who, "제가 가겠습니다"); ok(await has(ID.fam, "부탁을 받았습니다"), "가족 수락 알림 없음");
  await press(who, "출발했어요"); ok(await has(ID.fam, "출발"), "출발 알림 없음");
  await press(who, "도착했어요"); ok(await has(ID.fam, "도착했습니다"), "도착 알림 없음");
  st = await onda("GET", "/api/tg/demo/status", undefined, K);
  ok(st.j.now?.match?.status === "arrived", "상태 " + JSON.stringify(st.j.now));
  ok(!/lat|lng|가상시|예행어르신/.test(JSON.stringify(st.j)), "상태에 위치·이름");
  log(`✔ 수락 → 출발 → 도착 · 가족 알림 · 상태 «arrived» (경보부터 ${Math.round((Date.now() - ta) / 1000)}초)`);
  const rr = await onda("POST", "/api/tg/demo/reset", {}, K); ok(rr.j.closed === 1, "다시 하기 " + JSON.stringify(rr.j));
  log("✔ 다시 하기");
} catch (e) { err = String(e.message || e); log(err); }
if (made) { const c = await onda("POST", "/api/tg/demo/clear", {}, { authorization: R }); log("시연 치우기: " + JSON.stringify(c.j)); }
const cl = await cleanup(env);
log(`통로 치우기: ${JSON.stringify(cl.tongro)}`);
log(`${err ? "시연 예행 멈춤" : "시연 예행 끝"} · ${Math.round((Date.now() - t0) / 1000)}초 [사무실 PC 실측 ${new Date().toISOString()}]`);
writeFileSync(join(process.cwd(), "..", "텔레그램판", "시연예행_결과.txt"), out.join("\r\n"), "utf8");
process.exit(err ? 1 : 0);
