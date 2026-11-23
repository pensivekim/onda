// 온다 텔레그램판 — 차례 출동: 가까운 도우미 한 분께 부탁 → 안 받으시면(거절·시간 지남) 다음 분.
// 수락·상태는 기존 흐름(responderRoutes) 그대로 부른다 → 정산·지자체 대납 규칙이 한곳에만 있다.
import { haversine } from "../../utils/geo";
import { getRegion } from "../../utils/regions";
import {
  type TgEnv, tg, roomOf, mask, ensureTgCareTables, userName, familyRooms, opsRooms, isLinked, sendMany, offerSeconds, TXT,
} from "./core";
import type { Tongro } from "./tongro";

const ACTIVE = ["accepted", "moving", "arrived", "in_progress"];
const MAX_QUEUE = 8;

type Dispatch = {
  request_id: string; elder_id: string; asked_by: string | null; queue: string; idx: number; state: string;
  cur_match: string | null; offer_ref: string | null; offered_at: number | null; notified: string | null;
  emergency: number; live_refs: string | null; live_at: number;
};
const now = () => Math.floor(Date.now() / 1000);
const getD = (db: D1Database, reqId: string) => db.prepare("SELECT * FROM onda_tgc_dispatch WHERE request_id = ?").bind(reqId).first<Dispatch>();

/**
 * 부탁할 차례 (2026-11-23: 텔레그램판·웹 앱·말벗·감지 장치 모두 이 하나)
 * 대상: 승인·대기 중·같은 나라·필요 등급 이상. 위치가 반경 안이면 가까운 순, 위치를 모르면 텔레그램으로 닿는 분만 뒤에.
 * 1) 그 어르신을 등록한 담당 도우미 먼저 2) 가까운 순 3) 위치 모름.
 */
export async function buildQueue(env: TgEnv, o: { excludeId: string; lat: number; lng: number; region?: string; grade?: string; enrolledBy?: string | null; elderId?: string })
  : Promise<{ id: string; km: number | null }[]> {
  const grades = o.grade === "red" ? ["red"] : o.grade === "orange" ? ["orange", "red"] : ["green", "orange", "red"];
  // 예행(2026-11-23): «가상» 어르신은 «가상» 도우미에게만, 실제 어르신은 실제 도우미에게만
  const reh = o.elderId ? (await userName(env.DB, o.elderId)).startsWith("가상") : false;
  const r = await env.DB.prepare(
    `SELECT r.user_id, (SELECT p.linked FROM onda_tgc_people p WHERE p.user_id = r.user_id AND p.kind = 'helper') AS tg
       FROM onda_responders r JOIN onda_users u ON u.id = r.user_id
      WHERE r.status = 'approved' AND r.available = 1 AND r.user_id != ? AND COALESCE(u.region, 'KR') = ?
        AND r.grade IN (${grades.map(() => "?").join(",")})
        AND (CASE WHEN u.name LIKE '가상%' THEN 1 ELSE 0 END) = ?`).bind(o.excludeId, o.region || "KR", ...grades, reh ? 1 : 0).all<{ user_id: string; tg: number | null }>();
  const radius = getRegion(o.region || "KR").matchRadiusKm || 3;
  const out: { id: string; km: number | null; pref: number }[] = [];
  for (const { user_id, tg: linked } of r.results) {
    const loc = await env.LOCATION_KV.get(`loc:${user_id}`);
    let km: number | null = null;
    if (loc && o.lat && o.lng) { const [la, lo] = loc.split(",").map(Number); km = Math.round(haversine(o.lat, o.lng, la, lo) * 10) / 10; }
    const mine = user_id === o.enrolledBy;
    if (km != null && km > radius * 2 && !mine) continue;          // 너무 먼 분은 빼고(반경 두 배까지는 차례 뒤로)
    if (km == null && !linked && !mine) continue;                    // 위치도 모르고 연락도 못 하는 분은 빼기
    out.push({ id: user_id, km, pref: mine ? 0 : km != null && km <= radius ? 1 : 2 });
  }
  out.sort((a, b) => a.pref - b.pref || (a.km ?? 1e9) - (b.km ?? 1e9));
  return out.slice(0, MAX_QUEUE).map(({ id, km }) => ({ id, km }));
}

/** 이미 만든 요청에 차례 출동을 붙인다 — 모든 입구가 여기로 */
export async function startDispatch(env: TgEnv, requestId: string, o: { elderId: string; askedBy: string; emergency: boolean; who?: string }) {
  await ensureTgCareTables(env.DB);
  const rq = await env.DB.prepare("SELECT lat, lng, region, grade_required FROM onda_requests WHERE id = ?").bind(requestId)
    .first<{ lat: number; lng: number; region: string; grade_required: string }>();
  if (!rq) throw new Error("no request");
  const enrolled = await env.DB.prepare("SELECT enrolled_by FROM onda_tgc_elders WHERE elder_id = ?").bind(o.elderId).first<{ enrolled_by: string }>();
  const queue = await buildQueue(env, { excludeId: o.askedBy, lat: rq.lat || 0, lng: rq.lng || 0, region: rq.region, grade: rq.grade_required, enrolledBy: enrolled?.enrolled_by || null, elderId: o.elderId });
  await env.DB.prepare("INSERT OR IGNORE INTO onda_tgc_dispatch (request_id, elder_id, asked_by, queue, emergency) VALUES (?, ?, ?, ?, ?)")
    .bind(requestId, o.elderId, o.askedBy, JSON.stringify(queue), o.emergency ? 1 : 0).run();
  const name = mask(await userName(env.DB, o.elderId));
  await sendMany(tg(env), env.DB, await opsRooms(env.DB, o.elderId),
    `[온다] ${o.emergency ? "🚨 위급 " : ""}출동 부탁 — ${name} (${o.who || "요청"}) · 부탁할 도우미 ${queue.length}명`);
  await offerNext(env, requestId);
  return queue.length;
}

/** 어르신 출동 부탁 만들기(텔레그램). 이미 진행 중이면 그 건을 돌려준다. */
export async function createTgRequest(env: TgEnv, elderId: string, askedBy: string, emergency: boolean): Promise<{ requestId: string; existing: boolean; queued: number }> {
  const live = await env.DB.prepare(
    "SELECT request_id FROM onda_tgc_dispatch WHERE elder_id = ? AND state IN ('offering','exhausted','accepted') LIMIT 1").bind(elderId).first<{ request_id: string }>();
  if (live) {
    if (emergency) await markEmergency(env, live.request_id, askedBy);
    return { requestId: live.request_id, existing: true, queued: 0 };
  }
  const e = await env.DB.prepare("SELECT id, name, address, lat, lng, region FROM onda_users WHERE id = ?").bind(elderId)
    .first<{ id: string; name: string; address: string; lat: number; lng: number; region: string }>();
  if (!e) throw new Error("no elder");
  const requestId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO onda_requests (id, requester_id, type, address, lat, lng, description, urgency, source, region, grade_required)
     VALUES (?, ?, 'elder', ?, ?, ?, ?, ?, 'tg_care', ?, 'green')`
  ).bind(requestId, elderId, e.address || "", e.lat || 0, e.lng || 0, `[온다 텔레그램] ${mask(e.name)} 어르신 긴급 돌봄`,
         emergency ? "emergency" : "urgent", e.region || "KR").run();
  const who = askedBy === elderId ? "본인 요청" : askedBy === "hi_system" ? "말벗 감지" : "가족 요청";
  const queued = await startDispatch(env, requestId, { elderId, askedBy, emergency, who: `어르신 · ${who}` });
  return { requestId, existing: false, queued };
}

/** 이 도우미에게 몇 초 기다릴까 — 텔레그램으로 닿으면 짧게, 앱만 쓰면 앱을 열 시간을 더 */
async function waitFor(env: TgEnv, helperId: string) {
  return (await isLinked(env.DB, roomOf(helperId))) ? offerSeconds(env) : Math.max(offerSeconds(env), Number(env.TG_OFFER_SECONDS_WEB) || 90);
}

/** 다음 도우미에게 부탁. 남은 분이 없으면 «찾는 중» 으로 상황실·가족·요청자에게 알림. */
export async function offerNext(env: TgEnv, requestId: string): Promise<string | null> {
  const t = tg(env);
  const d = await getD(env.DB, requestId);
  if (!d || !["offering", "exhausted"].includes(d.state)) return null;
  const req = await env.DB.prepare("SELECT status, type, urgency, requester_id FROM onda_requests WHERE id = ?").bind(requestId)
    .first<{ status: string; type: string; urgency: string; requester_id: string }>();
  if (!req || req.status === "cancelled" || req.status === "completed") return null;
  const queue: { id: string; km: number | null }[] = JSON.parse(d.queue || "[]");
  const name = mask(await userName(env.DB, d.elder_id));
  let idx = d.idx;
  while (idx < queue.length) {
    const h = queue[idx++];
    // 그사이 다른 출동을 맡았거나 대기를 끈 분·이미 이 건을 거절한 분은 건너뜀
    const ok = await env.DB.prepare(
      `SELECT 1 FROM onda_responders r WHERE r.user_id = ? AND r.status = 'approved' AND r.available = 1
         AND NOT EXISTS (SELECT 1 FROM onda_matches m WHERE m.responder_id = r.user_id AND m.status IN ('accepted','moving','arrived','in_progress'))
         AND NOT EXISTS (SELECT 1 FROM onda_matches m WHERE m.responder_id = r.user_id AND m.request_id = ?)`
    ).bind(h.id, requestId).first();
    if (!ok) continue;
    // 동시에 두 곳(버튼·앱·예약 작업)이 «다음 분»을 부르면 한 곳만 — 차례 번호를 먼저 잡는다
    const claim = await env.DB.prepare("UPDATE onda_tgc_dispatch SET idx = ? WHERE request_id = ? AND idx = ? AND state IN ('offering','exhausted')")
      .bind(idx, requestId, d.idx).run();
    if (!claim.meta.changes) return null;
    d.idx = idx;
    const secs = await waitFor(env, h.id);
    const matchId = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO onda_matches (id, request_id, responder_id, status) VALUES (?, ?, ?, 'offered')").bind(matchId, requestId, h.id).run();
    // 앱(웹) 알림 — 도우미 화면이 이 목록을 읽어 «수락/거절»을 띄운다
    await env.DB.prepare("INSERT INTO onda_notifications (user_id, type, title, body) VALUES (?, 'match_offer', ?, ?)")
      .bind(h.id, d.emergency ? "🚨 긴급 돌봄 부탁" : "긴급 돌봄 부탁", `${name}${h.km != null ? ` · 약 ${h.km}km` : ""} · ${secs}초 안에 답해 주세요`).run();
    let ref: string | null = null;
    if (t && (await isLinked(env.DB, roomOf(h.id)))) {
      try {
        const r = await t.send({ room: roomOf(h.id),
          text: `${d.emergency ? "🚨 [위급] " : "🔔 "}긴급 돌봄 부탁 (${idx}번째로 부탁드립니다)\n${name}` +
            (h.km != null ? ` · 댁까지 약 ${h.km}km` : "") + `\n${secs}초 안에 답이 없으면 다음 분께 넘어갑니다.` +
            (d.emergency ? "\n위급 상황이라 119 안내도 함께 나갔습니다." : ""),
          buttons: [[{ text: "✅ 제가 가겠습니다", data: `a:${matchId}` }], [{ text: "못 갑니다", data: `x:${matchId}` }]] });
        ref = r.ref || null;
      } catch { /* 보내기 실패 — 시간 지나면 다음 분 */ }
    }
    await env.DB.prepare("UPDATE onda_tgc_dispatch SET idx = ?, state = 'offering', cur_match = ?, offer_ref = ?, offered_at = ?, offer_s = ? WHERE request_id = ?")
      .bind(idx, matchId, ref, now(), secs, requestId).run();
    return matchId;
  }
  // 남은 분 없음
  await env.DB.prepare("UPDATE onda_tgc_dispatch SET idx = ?, state = 'exhausted', cur_match = NULL, offer_ref = NULL WHERE request_id = ?").bind(idx, requestId).run();
  if (d.state !== "exhausted") {
    await sendMany(t, env.DB, await opsRooms(env.DB, d.elder_id), `[온다] ⚠️ ${name} — 부탁드린 도우미가 모두 못 받으셨습니다. 직접 연락이 필요합니다.`,
      { buttons: [[{ text: "🔁 다시 부탁하기", data: `r:${requestId}` }]] });
    await sendMany(t, env.DB, [roomOf(d.elder_id), ...(await familyRooms(env.DB, d.elder_id))],
      "가까운 도우미를 찾고 있습니다. 상황실에서 곧 연락드립니다.\n위급하시면 바로 119 에 전화하세요.");
    if (req.requester_id && !/^(hi_system|detect_system)$/.test(req.requester_id))
      await env.DB.prepare("INSERT INTO onda_notifications (user_id, type, title, body) VALUES (?, 'no_match', ?, ?)")
        .bind(req.requester_id, "도우미를 찾는 중", "가까운 도우미가 지금 바로 받지 못했습니다. 상황실이 이어서 찾습니다. 위급하면 119.").run();
    await env.DB.prepare("INSERT INTO onda_admin_logs (admin_id, action, target_type, target_id, memo) VALUES ('system', 'dispatch_exhausted', 'request', ?, ?)")
      .bind(requestId, String(queue.length)).run();
  }
  return null;
}

/** 상황실 «다시 부탁하기»: 차례를 새로 만든다(그사이 대기 켠 분 포함, 이미 거절한 분은 offerNext 가 건너뜀) */
export async function restartQueue(env: TgEnv, requestId: string) {
  const d = await getD(env.DB, requestId);
  if (!d || d.state !== "exhausted") return false;
  const rq = await env.DB.prepare("SELECT lat, lng, region, grade_required FROM onda_requests WHERE id = ?").bind(requestId)
    .first<{ lat: number; lng: number; region: string; grade_required: string }>();
  const enrolled = await env.DB.prepare("SELECT enrolled_by FROM onda_tgc_elders WHERE elder_id = ?").bind(d.elder_id).first<{ enrolled_by: string }>();
  const q = await buildQueue(env, { excludeId: d.asked_by || d.elder_id, lat: rq?.lat || 0, lng: rq?.lng || 0, region: rq?.region, grade: rq?.grade_required, enrolledBy: enrolled?.enrolled_by || null, elderId: d.elder_id });
  await env.DB.prepare("UPDATE onda_tgc_dispatch SET queue = ?, idx = 0, state = 'offering' WHERE request_id = ?").bind(JSON.stringify(q), requestId).run();
  await offerNext(env, requestId);
  return true;
}

/** 지금 부탁한 분이 거절·시간 지남 → 그 부탁 글을 닫고 다음 분 */
export async function moveOn(env: TgEnv, requestId: string, why: "rejected" | "expired") {
  const d = await getD(env.DB, requestId);
  if (!d || d.state !== "offering") return;
  if (d.cur_match && why === "expired")
    await env.DB.prepare("UPDATE onda_matches SET status = 'expired' WHERE id = ? AND status = 'offered'").bind(d.cur_match).run();
  const t = tg(env);
  if (t && d.offer_ref && why === "expired") { try { await t.edit({ ref: d.offer_ref, text: "⏱ 시간이 지나 다음 분께 넘어갔습니다. 다음에 부탁드리겠습니다.", buttons: null }); } catch {} }
  await offerNext(env, requestId);
}

const STATUS_FAMILY: Record<string, (h: string) => string> = {
  accepted: (h) => `✅ 도우미 ${h}님이 부탁을 받았습니다. 곧 출발합니다.`,
  moving: (h) => `🚶 도우미 ${h}님이 출발했습니다. 오는 길은 아래 지도에서 보실 수 있습니다.`,
  arrived: (h) => `🏠 도우미 ${h}님이 어르신 댁에 도착했습니다.`,
  in_progress: (h) => `🤝 도우미 ${h}님이 돌봄을 시작했습니다.`,
  completed: (h) => `🙏 도우미 ${h}님이 돌봄을 마쳤습니다.`,
};
const STATUS_ELDER: Record<string, string> = {
  accepted: "✅ 도우미가 갑니다. 조금만 기다려 주세요.",
  arrived: "🏠 도우미가 도착했습니다. 문을 열어 주세요.",
  completed: "🙏 오늘 돌봄을 마쳤습니다. 필요하시면 언제든 «🆘 도와주세요» 를 누르세요.",
};

/**
 * 기존 출동 상태(onda_matches)를 읽어 가족·어르신·상황실에 알린다. 텔레그램 버튼이든 웹 앱이든 어디서 바꿨든 여기서 한 번만 알림.
 * 버튼을 누른 직후와 매분 예약 작업에서 부른다.
 */
export async function syncStatus(env: TgEnv, requestId: string) {
  const d = await getD(env.DB, requestId);
  if (!d || d.state === "done" || d.state === "cancelled") return;
  const m = await env.DB.prepare(
    `SELECT id, responder_id, status, duration_min FROM onda_matches WHERE request_id = ? AND status IN ('accepted','moving','arrived','in_progress','completed')
      ORDER BY accepted_at LIMIT 1`).bind(requestId).first<{ id: string; responder_id: string; status: string; duration_min: number | null }>();
  const t = tg(env);
  if (!m) {
    // 수락 전: 지금 부탁한 분이 웹 앱에서 거절했거나 시간이 지났으면 다음 분
    if (d.state === "offering" && d.cur_match) {
      const cur = await env.DB.prepare("SELECT status FROM onda_matches WHERE id = ?").bind(d.cur_match).first<{ status: string }>();
      if (cur && ["rejected", "expired", "cancelled"].includes(cur.status)) await offerNext(env, requestId);
      else if (cur?.status === "offered" && d.offered_at && now() - d.offered_at >= ((d as any).offer_s || offerSeconds(env))) await moveOn(env, requestId, "expired");
    }
    return;
  }
  if (m.status === d.notified) return;
  const helper = mask(await userName(env.DB, m.responder_id));
  const elderName = mask(await userName(env.DB, d.elder_id));
  if (d.state !== "accepted" && m.status !== "completed")
    await env.DB.prepare("UPDATE onda_tgc_dispatch SET state = 'accepted', cur_match = ? WHERE request_id = ?").bind(m.id, requestId).run();
  // 먼저 «알렸다» 표시 — 동시에 두 번 불려도 한 번만 알림
  const claim = await env.DB.prepare("UPDATE onda_tgc_dispatch SET notified = ? WHERE request_id = ? AND (notified IS NULL OR notified != ?)")
    .bind(m.status, requestId, m.status).run();
  if (!claim.meta.changes) return;
  const fam = await familyRooms(env.DB, d.elder_id);
  const fmsg = STATUS_FAMILY[m.status]?.(helper) + (m.status === "completed" && m.duration_min ? ` (${m.duration_min}분)` : "");
  await sendMany(t, env.DB, fam, fmsg);
  if (STATUS_ELDER[m.status]) await sendMany(t, env.DB, [roomOf(d.elder_id)], STATUS_ELDER[m.status]);
  await sendMany(t, env.DB, await opsRooms(env.DB, d.elder_id), `[온다] ${elderName} 어르신 — ${fmsg}`);
  if (m.status === "completed") {
    await env.DB.prepare("UPDATE onda_tgc_dispatch SET state = 'done' WHERE request_id = ?").bind(requestId).run();
    if (t) for (const ref of Object.values(JSON.parse(d.live_refs || "{}") as Record<string, string>)) { try { await t.stopLocation(ref); } catch {} }
  }
}

/** 위급: 출동 건을 위급으로 올리고 가족·상황실에 «119 안내» 를 알린다 */
export async function markEmergency(env: TgEnv, requestId: string, byUserId: string) {
  const d = await getD(env.DB, requestId);
  if (!d) return;
  await env.DB.prepare("UPDATE onda_tgc_dispatch SET emergency = 1 WHERE request_id = ?").bind(requestId).run();
  await env.DB.prepare("UPDATE onda_requests SET urgency = 'emergency' WHERE id = ?").bind(requestId).run();
  const who = byUserId === d.elder_id ? "어르신 본인" : byUserId === "hi_system" ? "말벗 감지로 가족" : mask(await userName(env.DB, byUserId)) + "님";
  const name = mask(await userName(env.DB, d.elder_id));
  const t = tg(env);
  const msg = `🚨 ${name} 어르신 위급 — ${who}께 119 전화를 안내했습니다.`;
  await sendMany(t, env.DB, (await familyRooms(env.DB, d.elder_id)).filter((r) => r !== roomOf(byUserId)), msg);
  await sendMany(t, env.DB, await opsRooms(env.DB, d.elder_id), `[온다] ${msg}`);
  await env.DB.prepare("INSERT INTO onda_admin_logs (admin_id, action, target_type, target_id, memo) VALUES ('system', 'tg_emergency', 'request', ?, ?)")
    .bind(requestId, byUserId).run();
}

/** 도우미 위치가 들어오면: 위치 저장(기존 KV 규칙) + 출동 중이면 가족에게 실시간 지도 (15초에 한 번만 옮김) */
export async function onHelperLocation(env: TgEnv, helperId: string, lat: number, lng: number) {
  await env.LOCATION_KV.put(`loc:${helperId}`, `${lat},${lng}`, { expirationTtl: 300 });
  const d = await env.DB.prepare(
    `SELECT d.* FROM onda_tgc_dispatch d JOIN onda_matches m ON m.id = d.cur_match
      WHERE m.responder_id = ? AND m.status IN ('accepted','moving','arrived','in_progress') AND d.state = 'accepted' LIMIT 1`).bind(helperId).first<Dispatch>();
  const t = tg(env);
  if (!d || !t) return;
  if (now() - (d.live_at || 0) < 15) return;
  const refs: Record<string, string> = JSON.parse(d.live_refs || "{}");
  const rooms = [roomOf(d.elder_id), ...(await familyRooms(env.DB, d.elder_id))];
  for (const room of rooms) {
    try {
      if (refs[room]) await t.editLocation(refs[room], lat, lng);
      else if (room !== roomOf(d.elder_id)) {   // 어르신 방에는 지도를 띄우지 않는다(헷갈리지 않게) — 가족만
        const r = await t.sendLocation(room, lat, lng, 3600);
        if (r.ref) refs[room] = r.ref;
      }
    } catch { /* 다음 갱신 때 다시 */ }
  }
  await env.DB.prepare("UPDATE onda_tgc_dispatch SET live_refs = ?, live_at = ? WHERE request_id = ?").bind(JSON.stringify(refs), now(), d.request_id).run();
}

/** 매분 예약 작업: 시간 지난 부탁은 다음 분께, 웹 앱에서 바뀐 상태는 가족에게. 기존 만료(60초)보다 먼저 돌아야 한다. */
export async function tgCareTick(env: TgEnv): Promise<{ moved: number; synced: number }> {
  // 2026-11-23: 웹 앱 출동도 이 차례로 돌므로 텔레그램 설정과 상관없이 돈다
  await ensureTgCareTables(env.DB);
  const stale = await env.DB.prepare(
    `SELECT d.request_id FROM onda_tgc_dispatch d JOIN onda_matches m ON m.id = d.cur_match
      WHERE d.state = 'offering' AND m.status = 'offered' AND d.offered_at + COALESCE(d.offer_s, ?) <= ?`).bind(offerSeconds(env), now()).all<{ request_id: string }>();
  for (const s of stale.results) await moveOn(env, s.request_id, "expired");
  const act = await env.DB.prepare("SELECT request_id FROM onda_tgc_dispatch WHERE state IN ('offering','accepted')").all<{ request_id: string }>();
  for (const a of act.results) await syncStatus(env, a.request_id);
  return { moved: stale.results.length, synced: act.results.length };
}

/** 도우미가 앱(웹)이나 텔레그램에서 수락·거절·상태를 바꾼 직후 — 차례 출동 요청이면 바로 다음 일을 한다 (2026-11-23) */
export async function afterResponderAction(env: TgEnv, matchId: string) {
  const m = await env.DB.prepare("SELECT request_id, status FROM onda_matches WHERE id = ?").bind(matchId).first<{ request_id: string; status: string }>();
  if (!m) return;
  const d = await getD(env.DB, m.request_id);
  if (!d) return;
  if (m.status === "rejected" && d.state === "offering" && d.cur_match === matchId) {
    await env.DB.prepare("UPDATE onda_tgc_dispatch SET cur_match = NULL WHERE request_id = ? AND cur_match = ?").bind(m.request_id, matchId).run();
    await offerNext(env, m.request_id);
  } else await syncStatus(env, m.request_id);
}

export const _test = { ACTIVE };
export type { Tongro };
