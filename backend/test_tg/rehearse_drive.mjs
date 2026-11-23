// 온다 텔레그램판 예행 — 가상 사람으로 «등록 → 출동 요청 → 수락 → 위치 → 완료 → 가족 알림»을 처음부터 끝까지 (2026-11-23 Claude, 목표 2)
// 실서버(rehearse_live.mjs)와 시험(rehearse_local.mjs)이 같은 이 순서를 쓴다.
// 가상 번호(990000000xxx)만 쓰므로 텔레그램으로는 아무것도 나가지 않고 알림 통로의 «예행 기록»에만 남는다. 끝나면 지운다.
const enc = new TextEncoder();
const hex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
async function initData(botToken, user) {
  const p = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), query_id: "AAREH", user: JSON.stringify(user) });
  const dcs = [...p.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join("\n");
  const k1 = await crypto.subtle.importKey("raw", enc.encode("WebAppData"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sec = await crypto.subtle.sign("HMAC", k1, enc.encode(botToken));
  const k2 = await crypto.subtle.importKey("raw", sec, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  p.set("hash", hex(await crypto.subtle.sign("HMAC", k2, enc.encode(dcs)))); return p.toString();
}
export const IDS = { ops: -990000000001, opsFrom: 990000000099, h1: 990000000011, h2: 990000000012, elder: 990000000021, fam: 990000000031 };

export async function rehearse({ onda, tongro, tongroAdmin, rehToken, botToken, fetchImpl = fetch, wait = (ms) => new Promise((r) => setTimeout(r, ms)), log = console.log }) {
  const steps = [];
  const ok = (cond, msg) => { if (!cond) throw new Error("✖ " + msg); };
  const step = (s) => { steps.push(s); log("✔ " + s); };
  const j = async (r) => { const t = await r.text(); try { return { code: r.status, j: JSON.parse(t) } } catch { return { code: r.status, j: t } } };
  const ondaApi = (method, path, body, auth) => fetchImpl(onda + path, { method, headers: { "content-type": "application/json", ...(auth ? { authorization: auth } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }).then(j);
  const tAdmin = (method, path, body) => fetchImpl(tongro + path, { method, headers: { authorization: "Bearer " + tongroAdmin, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }).then(j);
  let uid = 0, mid = 0;
  const inject = async (update) => { const r = await tAdmin("POST", "/admin/rehearse", { bot_id: "onda", update }); ok(r.code === 200, "넣기 실패 " + JSON.stringify(r.j)); await wait(300); };
  const start = (url, chat, name, type = "private", from = chat) => inject({ message: { message_id: ++mid, chat: { id: chat, type, title: type === "private" ? undefined : name }, from: { id: from, first_name: name }, text: "/start " + url.split("start=")[1] } });
  const say = (chat, text) => inject({ message: { message_id: ++mid, chat: { id: chat, type: "private" }, from: { id: chat, first_name: "가상" }, text } });
  const loc = (chat, lat, lng, edited = false) => inject({ [edited ? "edited_message" : "message"]: { message_id: 77, chat: { id: chat }, from: { id: chat }, location: { latitude: lat, longitude: lng, live_period: 3600 } } });
  let rows = [];
  const pull = async () => { const after = rows.length ? rows.at(-1).id : 0; const r = await tAdmin("GET", "/admin/rehearse/log?after=" + after); ok(r.code === 200, "기록 읽기 실패"); rows.push(...r.j.rows.map((x) => ({ ...x, b: JSON.parse(x.body) }))); };
  const to = async (chat) => { await pull(); return rows.filter((x) => String(x.chat_id) === String(chat)); };
  const texts = async (chat) => (await to(chat)).map((x) => x.b.text || "").filter(Boolean);
  const has = async (chat, s, tries = 6) => { for (let i = 0; i < tries; i++) { if ((await texts(chat)).some((t) => t.includes(s))) return true; if (i < tries - 1) await wait(700); } return false; };
  const press = async (chat, label, tries = 8) => {
    for (let i = 0; i < tries; i++) {   // 버튼 글이 응답 뒤에 늦게 오는 때가 있어 조금 기다리며 다시 본다(2026-11-24 7회차)
      const hit = (await to(chat)).some((x) => (x.b.reply_markup?.inline_keyboard || []).flat().some((b) => b.text.includes(label)));
      if (hit) break;
      await wait(700);
    }
    const list = (await to(chat)).reverse();
    for (const x of list) for (const b of (x.b.reply_markup?.inline_keyboard || []).flat())
      if (b.text.includes(label) && b.callback_data) {
        const msgId = x.method === "editMessageText" ? x.b.message_id : 900000 + Number(x.id);
        return inject({ callback_query: { id: "reh" + (++uid) + "-" + Date.now(), data: b.callback_data, from: { id: chat > 0 ? chat : IDS.opsFrom, first_name: "가상누름" }, message: { message_id: msgId, chat: { id: chat }, text: "(원문)" } } });
      }
    throw new Error(`✖ ${chat} 에 «${label}» 버튼 없음`);
  };
  const R = "Bearer " + rehToken;

  // 0 준비: 가상 도우미 2명(승인됨) · 예행 상황실
  const su = await ondaApi("POST", "/api/tg/rehearse/setup", { helpers: ["가상하나", "가상두리"], ops: "reh-main" }, R);
  ok(su.code === 200, "예행 준비 실패 " + JSON.stringify(su.j));
  await start(su.j.ops.url, IDS.ops, "가상 상황실", "group", IDS.opsFrom);
  ok(await has(IDS.ops, "상황실 방으로 연결"), "상황실 연결 인사 없음");
  const [hA, hB] = su.j.helpers;
  for (const [h, chat, lat, lng] of [[hA, IDS.h1, 35.8710, 128.6010], [hB, IDS.h2, 35.8702, 128.6002]]) {
    await start(h.url, chat, h.name);
    await say(chat, "🟢 출동 받기 켜기"); ok(await has(chat, "켰습니다"), h.name + " 출동 받기 켜기 안 됨");
    await loc(chat, lat, lng);
  }
  step("가상 도우미 2명 텔레그램 연결·출동 받기 켜기·위치 · 예행 상황실 연결");

  // 1 등록: 도우미가 미니 앱으로 로그인 → 첫 방문 어르신 등록 → 어르신 QR 연결
  const li = await ondaApi("POST", "/api/tg/webapp-login", { initData: await initData(botToken, { id: IDS.h1, first_name: "가상하나" }) });
  ok(li.code === 200 && li.j.token, "미니 앱 로그인 실패 " + JSON.stringify(li.j));
  const H1 = "Bearer " + li.j.token;
  const el = await ondaApi("POST", "/api/tg/elders", { name: "가상순자", address: "가상시 가상동 1-1", lat: 35.8705, lng: 128.6005 }, H1);
  ok(el.code === 200, "어르신 등록 실패 " + JSON.stringify(el.j));
  await start(el.j.url, IDS.elder, "가상순자");
  const kb = (await to(IDS.elder)).find((x) => x.b.reply_markup?.keyboard)?.b.reply_markup.keyboard.flat().map((b) => b.text) || [];
  ok(kb.includes("🆘 도와주세요"), "어르신 큰 단추 없음");
  ok(await has(IDS.h1, "어르신 텔레그램이 연결"), "담당 도우미에게 연결 알림 없음");
  step("미니 앱 로그인 → 첫 방문 어르신 등록 → 어르신 텔레그램 연결(큰 단추)");

  // 2 가족 연결
  const fq = await ondaApi("POST", `/api/tg/elders/${el.j.elderId}/family-link`, { relation: "딸" }, H1);
  ok(fq.code === 200, "가족 링크 실패");
  await start(fq.j.url, IDS.fam, "가상딸");
  ok(await has(IDS.fam, "어르신 가족으로 연결"), "가족 연결 인사 없음");
  ok(await has(IDS.elder, "«가상딸» 님이 연결"), "어르신에게 가족 연결 알림 없음");
  step("가족 연결 → 어르신·담당 도우미에게 알림");

  // 3 출동 요청: 어르신 «도와주세요» → 위급 아님 → 담당 도우미에게 먼저
  await say(IDS.elder, "🆘 도와주세요");
  await press(IDS.elder, "아니요");
  ok(await has(IDS.h1, "1번째"), "담당 도우미에게 먼저 안 감");
  ok(await has(IDS.ops, "출동 부탁"), "예행 상황실 알림 없음");
  step("어르신 «도와주세요» → 담당 도우미에게 먼저 부탁 · 예행 상황실 알림");

  // 4 수락
  await press(IDS.h1, "제가 가겠습니다");
  ok(await has(IDS.fam, "부탁을 받았습니다"), "가족 수락 알림 없음");
  ok(await has(IDS.elder, "도우미가 갑니다"), "어르신 수락 알림 없음");
  ok(await has(IDS.h1, "가상시 가상동 1-1"), "수락한 도우미에게 주소 없음");
  ok(!(await has(IDS.h2, "가상시 가상동", 1)), "다른 도우미에게 주소가 감");
  step("수락 → 가족·어르신·상황실 알림, 주소는 수락한 분에게만");

  // 5 위치
  await loc(IDS.h1, 35.876, 128.606);
  let map = false; for (let i = 0; i < 6 && !map; i++) { map = (await to(IDS.fam)).some((x) => x.method === "sendLocation"); if (!map) await wait(700); }
  ok(map, "가족 지도 없음");
  step("도우미 실시간 위치 → 가족 지도");

  // 6 완료
  await press(IDS.h1, "출발했어요"); ok(await has(IDS.fam, "출발"), "출발 알림 없음");
  await press(IDS.h1, "도착했어요"); ok(await has(IDS.elder, "문을 열어"), "도착 알림 없음");
  await press(IDS.h1, "돌봄 시작");
  await press(IDS.h1, "마쳤어요");
  ok(await has(IDS.fam, "마쳤습니다"), "가족 마침 알림 없음");
  step("출발 → 도착 → 돌봄 → 마침 → 가족 알림");

  // 7 가족 미니 앱에서 결과 보기
  const fl = await ondaApi("POST", "/api/tg/webapp-login", { initData: await initData(botToken, { id: IDS.fam, first_name: "가상딸" }) });
  ok(fl.code === 200, "가족 미니 앱 로그인 실패");
  const me = await ondaApi("GET", "/api/tg/me", undefined, "Bearer " + fl.j.token);
  ok(me.j.kind === "family" && me.j.elders?.[0]?.last, "가족 화면에 출동 기록 없음");
  step(`가족 미니 앱 → 출동 기록 보임 (상태 ${me.j.elders[0].last.state})`);

  // 8 어려운 길: 가족 «위급» → 119 안내 · 상황실 위급 → 담당이 «못 갑니다» → 다음 분 수락 → 마침
  await say(IDS.fam, "🆘 어르신께 출동 부탁");
  await press(IDS.fam, "위급");
  ok(await has(IDS.fam, "119"), "가족에게 119 안내 없음");
  ok(await has(IDS.ops, "위급"), "예행 상황실 위급 알림 없음");
  ok(await has(IDS.h1, "1번째"), "위급 출동이 담당 도우미에게 안 감");
  await press(IDS.h1, "못 갑니다");
  ok(await has(IDS.h2, "2번째"), "거절 뒤 다음 도우미에게 안 감");
  await press(IDS.h2, "제가 가겠습니다");
  ok(await has(IDS.fam, "가상두리") || await has(IDS.fam, "부탁을 받았습니다"), "두 번째 수락 가족 알림 없음");
  await press(IDS.h2, "출발했어요"); await press(IDS.h2, "도착했어요"); await press(IDS.h2, "돌봄 시작"); await press(IDS.h2, "마쳤어요");
  ok((await texts(IDS.fam)).filter((t) => t.includes("마쳤습니다")).length >= 2, "두 번째 마침 알림 없음");
  step("가족 «위급» → 119 안내·상황실 위급 → 담당 «못 갑니다» → 다음 분 수락 → 마침");

  await pull();
  const chats = [...new Set(rows.map((x) => x.chat_id))];
  return { steps, sent: rows.length, chats };
}

/** 치우기 — 실패해도 둘 다 시도 */
export async function cleanup({ onda, tongro, tongroAdmin, rehToken, fetchImpl = fetch }) {
  const a = await fetchImpl(onda + "/api/tg/rehearse/clear", { method: "POST", headers: { authorization: "Bearer " + rehToken } }).then((r) => r.json()).catch((e) => ({ error: String(e) }));
  const b = await fetchImpl(tongro + "/admin/rehearse/clear", { method: "POST", headers: { authorization: "Bearer " + tongroAdmin, "content-type": "application/json" }, body: "{}" }).then((r) => r.json()).catch((e) => ({ error: String(e) }));
  return { onda: a, tongro: b };
}
