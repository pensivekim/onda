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
export const IDS = { ops: -990000000001, opsFrom: 990000000099, h1: 990000000011, h2: 990000000012, elder: 990000000021, elder2: 990000000022, fam: 990000000031 };

export async function rehearse({ onda, tongro, tongroAdmin, rehToken, botToken, hiSecret, tick, fetchImpl = fetch, wait = (ms) => new Promise((r) => setTimeout(r, ms)), log = console.log }) {
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
  // 이 표시(mark) 뒤에 새로 온 글만 본다 — 앞 단계의 같은 글을 새 글로 잘못 보던 것(2026-11-24 실서버 예행에서 찾음)
  const mark = async () => { await pull(); return rows.length ? rows.at(-1).id : 0; };
  const hasAfter = async (m, chat, s, tries = 10) => { for (let i = 0; i < tries; i++) { if ((await to(chat)).some((x) => x.id > m && (x.b.text || "").includes(s))) return true; if (i < tries - 1) await wait(700); } return false; };
  const press = async (chat, label, tries = 16, after = 0) => {   // 16×0.7초 — 서버가 6.5초 뒤 늦게 버튼을 고쳐 붙이는 때까지 기다림(2026-11-27 13:35 «마쳤어요» 못 찾음)
    for (let i = 0; i < tries; i++) {   // 버튼 글이 응답 뒤에 늦게 오는 때가 있어 조금 기다리며 다시 본다(2026-11-24 7회차)
      const hit = (await to(chat)).some((x) => x.id > after && (x.b.reply_markup?.inline_keyboard || []).flat().some((b) => b.text.includes(label)));
      if (hit) break;
      await wait(700);
    }
    const list = (await to(chat)).filter((x) => x.id > after).reverse();
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
  // 6-2 어려운 길(2026-11-24 더함): 도착한 도우미가 «위급해요» → 도우미 119 안내 · 가족·상황실 위급 알림 → 그대로 돌봄 이어감
  const m6 = await mark();
  await press(IDS.h1, "위급해요");
  ok(await hasAfter(m6, IDS.h1, "1 1 9"), "도우미 위급: 도우미 119 안내 없음");
  ok(await hasAfter(m6, IDS.fam, "위급"), "도우미 위급: 가족 위급 알림 없음");
  ok(await hasAfter(m6, IDS.ops, "위급"), "도우미 위급: 상황실 위급 알림 없음");
  ok(!(await hasAfter(m6, IDS.h2, "위급", 1)), "도우미 위급: 다른 도우미에게 위급 알림이 감");
  await press(IDS.h1, "돌봄 시작");
  await press(IDS.h1, "마쳤어요");
  ok(await has(IDS.fam, "마쳤습니다"), "가족 마침 알림 없음");
  step("출발 → 도착 → (도우미 «위급해요» → 119 안내·가족·상황실) → 돌봄 → 마침 → 가족 알림");

  // 7 가족 미니 앱에서 결과 보기
  const fl = await ondaApi("POST", "/api/tg/webapp-login", { initData: await initData(botToken, { id: IDS.fam, first_name: "가상딸" }) });
  ok(fl.code === 200, "가족 미니 앱 로그인 실패");
  const me = await ondaApi("GET", "/api/tg/me", undefined, "Bearer " + fl.j.token);
  ok(me.j.kind === "family" && me.j.elders?.[0]?.last, "가족 화면에 출동 기록 없음");
  const nw = await ondaApi("GET", `/api/tg/elders/${el.j.elderId}/now`, undefined, "Bearer " + fl.j.token);
  ok(nw.code === 200 && nw.j.now === null && nw.j.past?.[0]?.match?.status === "completed", "가족 미니 앱 지난 기록에 마침 없음 " + JSON.stringify(nw.j).slice(0, 200));
  const nx = await ondaApi("GET", `/api/tg/elders/${el.j.elderId}/now`, undefined, R);
  ok(nx.code === 401 || nx.code === 404, "남이 어르신 화면을 봄");
  step(`가족 미니 앱 → 출동 기록 보임 (상태 ${me.j.elders[0].last.state}) · 지난 기록 마침`);

  // 8 어려운 길: 가족 «위급» → 119 안내 · 상황실 위급 → 담당이 «못 갑니다» → 다음 분 수락 → 마침
  const m8 = await mark();
  await say(IDS.fam, "🆘 어르신께 출동 부탁");
  await press(IDS.fam, "위급", 8, m8);
  ok(await hasAfter(m8, IDS.fam, "119"), "가족에게 119 안내 없음");
  ok(await hasAfter(m8, IDS.ops, "위급"), "예행 상황실 위급 알림 없음");
  ok(await hasAfter(m8, IDS.h1, "1번째"), "위급 출동이 담당 도우미에게 안 감");
  await press(IDS.h1, "못 갑니다", 8, m8);
  ok(await hasAfter(m8, IDS.h2, "2번째"), "거절 뒤 다음 도우미에게 안 감");
  await press(IDS.h2, "제가 가겠습니다", 8, m8);
  ok(await has(IDS.fam, "가상두리") || await has(IDS.fam, "부탁을 받았습니다"), "두 번째 수락 가족 알림 없음");
  await press(IDS.h2, "출발했어요"); await press(IDS.h2, "도착했어요"); await press(IDS.h2, "돌봄 시작"); await press(IDS.h2, "마쳤어요");
  ok((await texts(IDS.fam)).filter((t) => t.includes("마쳤습니다")).length >= 2, "두 번째 마침 알림 없음");
  step("가족 «위급» → 119 안내·상황실 위급 → 담당 «못 갑니다» → 다음 분 수락 → 마침");

  // 8-2 어려운 길: 아무도 못 받음 → 상황실 «직접 연락» + 어르신·가족 «상황실이 연락» → 상황실 «다시 부탁하기» (2026-11-24 더함)
  {
    const mx = await mark();
    await say(IDS.elder, "🆘 도와주세요");
    await press(IDS.elder, "아니요", 8, mx);
    ok(await hasAfter(mx, IDS.h1, "1번째"), "아무도 길: 담당 도우미에게 안 감");
    // 담당은 아무것도 안 누름 → 부탁 시간(실서버 50초)이 지나고 매분 예약 작업이 다음 분께 넘긴다
    if (tick) await tick();
    ok(await hasAfter(mx, IDS.h2, "2번째", tick ? 10 : 220), "시간 지남 길: 다음 도우미에게 안 넘어감");
    ok((await to(IDS.h1)).some((x) => x.id > mx && (x.b.text || "").includes("시간이 지나")), "시간 지남 길: 담당 도우미 부탁 글이 안 닫힘");
    await press(IDS.h2, "못 갑니다", 8, mx);
    ok(await hasAfter(mx, IDS.ops, "모두 못 받으셨습니다"), "아무도 길: 상황실 «직접 연락» 알림 없음");
    ok(await hasAfter(mx, IDS.fam, "상황실에서 곧 연락"), "아무도 길: 가족 안내 없음");
    ok(await hasAfter(mx, IDS.elder, "119"), "아무도 길: 어르신 119 안내 없음");
    const my = await mark();
    await press(IDS.ops, "다시 부탁하기", 8, mx);
    ok(await hasAfter(my, IDS.ops, "다시 부탁") || await hasAfter(my, IDS.ops, "모두 못 받으셨습니다"), "아무도 길: «다시 부탁하기» 반응 없음");
    step("담당 시간 지남 → 다음 분 «못 갑니다» → 아무도 없음 → 상황실 직접 연락·가족·어르신 안내 → 상황실 «다시 부탁하기»");
  }

  // 9 다올(이웃대피): 가상 읍면동 예보 → 담당 도우미 사전 점검 → 대피 시작 → 수락·방문·모시고 출발·대피소 도착
  {
    const pr = await ondaApi("POST", "/api/tg/rehearse/evac", { stage: "prep", helperId: hB.id }, R);
    ok(pr.code === 200 && pr.j.ok, "다올 예보 넣기 실패 " + JSON.stringify(pr.j));
    ok(await has(IDS.h2, "사전 점검"), "담당 도우미 사전 점검 알림 없음");
    const m9 = await mark();
    const sr = await ondaApi("POST", "/api/tg/rehearse/evac", { stage: "start" }, R);
    ok(sr.code === 200 && sr.j.ok, "대피 시작 실패 " + JSON.stringify(sr.j));
    ok(await hasAfter(m9, IDS.h2, "대피"), "도우미 대피 출동 부탁 없음");
    await press(IDS.h2, "제가 가겠습니다", 8, m9);
    await press(IDS.h2, "출발했어요", 8, m9); await press(IDS.h2, "댁에 도착했어요"); await press(IDS.h2, "모시고 출발해요"); await press(IDS.h2, "대피소에 도착했어요");
    ok((await to(IDS.h2)).some((x) => (x.b.text || "").includes("대피 완료")), "대피 완료 기록 안내 없음");
    step("다올: 가상 읍면동 예보 → 사전 점검 → 대피 시작 → 수락·방문·모시고 출발·대피소 도착");
  }

  // 9 말벗 다리: 말벗 기기 코드로 묶인 가상 어르신 → 말벗 «쓰러짐» 경보(보호자 무응답) → 온다 위급 차례 출동
  if (hiSecret) {
    const el2 = await ondaApi("POST", "/api/tg/elders", { name: "가상말순", address: "가상시 나동 3", lat: 35.871, lng: 128.601, hi_code: "REHX01" }, H1);
    ok(el2.code === 200, "말벗 어르신 등록 실패");
    await start(el2.j.url, IDS.elder2, "가상말순");
    const body = JSON.stringify({ code: "REHX01", type: "fall", alert_key: "reh|fall|" + Date.now() });
    const ts = String(Math.floor(Date.now() / 1000));
    const k = await crypto.subtle.importKey("raw", enc.encode(hiSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const sig = hex(await crypto.subtle.sign("HMAC", k, enc.encode(ts + "." + hex(await crypto.subtle.digest("SHA-256", enc.encode(body))))));
    const bad = await fetchImpl(onda + "/api/tg/hi-alert", { method: "POST", body, headers: { "content-type": "application/json", "x-hi-ts": ts, "x-hi-sig": "0".repeat(64) } });
    ok(bad.status === 403, "서명 틀린 말벗 경보가 통과함");
    const hr = await j(await fetchImpl(onda + "/api/tg/hi-alert", { method: "POST", body, headers: { "content-type": "application/json", "x-hi-ts": ts, "x-hi-sig": sig } }));
    ok(hr.code === 200 && hr.j.ok && !hr.j.existing, "말벗 경보 실패 " + JSON.stringify(hr.j));
    ok(await has(IDS.ops, "말벗 감지"), "예행 상황실 «말벗 감지» 없음");
    ok((await texts(IDS.h1)).some((t) => t.includes("[위급]") && t.includes("가○○")) || (await texts(IDS.h2)).some((t) => t.includes("[위급]")), "도우미에게 위급 출동 부탁 없음");
    step("말벗 «쓰러짐» 경보 → 서명 확인 → 온다 위급 차례 출동 · 상황실 «말벗 감지»");
  }

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
