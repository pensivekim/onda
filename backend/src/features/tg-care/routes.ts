// 온다 텔레그램판 — 입구들
//  POST /api/tg/tongro            알림 통로가 넘겨주는 것(방 연결·버튼·말·위치) — 통로 서명 확인
//  POST /api/tg/webapp-login      미니 앱(텔레그램 안의 온다 화면) 로그인 → 온다 토큰
//  POST /api/tg/link/me           로그인한 사람(도우미 등)이 자기 텔레그램 묶기 링크
//  POST /api/tg/elders            [도우미] 첫 방문 어르신 등록 → 어르신 QR 링크
//  POST /api/tg/elders/:id/family-link  [도우미·관리자] 가족 QR 링크
//  GET  /api/tg/elders/mine       [도우미] 내가 등록한 어르신
//  POST /api/tg/helpers/invite    [관리자] 새 도우미를 텔레그램으로 초대(가입 대기 → 기존 관리자 승인)
//  POST /api/tg/ops/link          [관리자] 상황실 단체방 묶기 링크
//  GET  /api/tg/me                미니 앱: 내 역할·어르신·진행 중 출동
//  POST /api/tg/hi-alert          말벗(hi-backend) → 보호자가 아무도 확인 안 한 경보를 온다 출동으로 (서명 HI_ONDA_SECRET)
import { Hono } from "hono";
import { ensureAllTables } from "../../utils/db";
import { requireAuth, requireAdmin, getUser, signToken } from "../../utils/auth";
import { responderRoutes } from "../../routes/responderRoutes";
import { verifyTongro } from "./tongro";
import {
  type TgEnv, tg, ensureTgCareTables, roomOf, opsRoom, personByRoom, mask, userName, familyRooms, opsRooms,
  sendMany, KB_ELDER, KB_FAMILY, KB_HELPER, TXT, webappUrl,
} from "./core";
import { createTgRequest, restartQueue, syncStatus, markEmergency, onHelperLocation, offerNext } from "./dispatch";
import { evacTongroButtons, STATUS_KO as EVAC_SAID } from "../evac-dispatch/telegram";
/** 다올(이웃대피) 출동인지 — 그러면 대피용 버튼·문구 */
async function isEvac(db: D1Database, requestId: string) {
  try { return !!(await db.prepare("SELECT 1 AS x FROM onda_evac_tasks WHERE request_id = ? LIMIT 1").bind(requestId).first()); } catch { return false; }
}

const app = new Hono<{ Bindings: TgEnv }>();
/** 같은 서명은 한 번만 (가로채 다시 보내기 막기). 서명 유효 5분보다 길게 10분 기억 */
async function firstTime(env: TgEnv, sig: string | undefined): Promise<boolean> {
  if (!sig) return false;
  const k = `tgsig:${sig.slice(0, 64)}`;
  if (await env.LOCATION_KV.get(k)) return false;
  await env.LOCATION_KV.put(k, "1", { expirationTtl: 600 });
  return true;
}
async function ready(db: D1Database) { await ensureAllTables(db); await ensureTgCareTables(db); }
const notConfigured = (c: any) => c.json({ error: "telegram (alim-tongro) not configured" }, 503);

async function addPerson(db: D1Database, room: string, userId: string | null, kind: string) {
  await db.prepare("INSERT OR IGNORE INTO onda_tgc_people (room_key, user_id, kind) VALUES (?, ?, ?)").bind(room, userId, kind).run();
}

// ───────────── 링크 만들기 ─────────────
app.post("/api/tg/link/me", requireAuth(), async (c) => {
  const t = tg(c.env); if (!t) return notConfigured(c);
  await ready(c.env.DB);
  const u = getUser(c);
  const isHelper = !!(await c.env.DB.prepare("SELECT 1 FROM onda_responders WHERE user_id = ?").bind(u.id).first());
  await addPerson(c.env.DB, roomOf(u.id), u.id, isHelper ? "helper" : "member");
  const { url } = await t.startLink(roomOf(u.id), 1);
  return c.json({ ok: true, url, kind: isHelper ? "helper" : "member" });
});

/** 첫 방문: 도우미가 어르신을 등록하고, 어르신 휴대폰으로 QR 을 찍게 한다(텔레그램은 도우미가 설치·가입을 도와 드림) */
app.post("/api/tg/elders", requireAuth(), async (c) => {
  const t = tg(c.env); if (!t) return notConfigured(c);
  await ready(c.env.DB);
  const u = getUser(c);
  const ok = u.role === "admin" || await c.env.DB.prepare("SELECT 1 FROM onda_responders WHERE user_id = ? AND status = 'approved'").bind(u.id).first();
  if (!ok) return c.json({ error: "승인된 도우미만 등록할 수 있습니다" }, 403);
  const b = await c.req.json<{ name?: string; address?: string; lat?: number; lng?: number; notes?: string; hi_code?: string }>();
  if (!b.name?.trim()) return c.json({ error: "name required" }, 400);
  const elderId = crypto.randomUUID();
  await c.env.DB.prepare("INSERT INTO onda_users (id, name, role, address, lat, lng, region) VALUES (?, ?, 'requester', ?, ?, ?, 'KR')")
    .bind(elderId, b.name.trim().slice(0, 40), (b.address || "").slice(0, 200), Number(b.lat) || 0, Number(b.lng) || 0).run();
  await c.env.DB.prepare("INSERT INTO onda_tgc_elders (elder_id, enrolled_by, notes) VALUES (?, ?, ?)").bind(elderId, u.id, (b.notes || "").slice(0, 500)).run();
  await addPerson(c.env.DB, roomOf(elderId), elderId, "elder");
  const hiCode = (b.hi_code || "").trim().toUpperCase();
  if (/^[A-Z0-9]{4,16}$/.test(hiCode))   // 말벗을 쓰시는 분이면 말벗 기기 코드로 묶어 둔다
    await c.env.DB.prepare("INSERT OR REPLACE INTO onda_tgc_hi_link (hi_code, elder_id) VALUES (?, ?)").bind(hiCode, elderId).run();
  const { url } = await t.startLink(roomOf(elderId), 6);
  return c.json({ ok: true, elderId, url, expires_hours: 6 });
});

async function familyLink(env: TgEnv, elderId: string, relation: string) {
  const t = tg(env)!;
  const famId = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO onda_users (id, name, role, region) VALUES (?, ?, 'requester', 'KR')").bind(famId, "가족(연결 전)").run();
  await env.DB.prepare("INSERT INTO onda_tgc_family (elder_id, family_id, relation) VALUES (?, ?, ?)").bind(elderId, famId, relation.slice(0, 20)).run();
  await addPerson(env.DB, roomOf(famId), famId, "family");
  return (await t.startLink(roomOf(famId), 72)).url as string;
}
app.post("/api/tg/elders/:id/family-link", requireAuth(), async (c) => {
  if (!tg(c.env)) return notConfigured(c);
  await ready(c.env.DB);
  const u = getUser(c); const elderId = c.req.param("id") || "";
  const e = await c.env.DB.prepare("SELECT enrolled_by FROM onda_tgc_elders WHERE elder_id = ?").bind(elderId).first<{ enrolled_by: string }>();
  if (!e || (u.role !== "admin" && e.enrolled_by !== u.id)) return c.json({ error: "not found" }, 404);
  const b = await c.req.json<{ relation?: string }>().catch(() => ({} as { relation?: string }));
  return c.json({ ok: true, url: await familyLink(c.env, elderId, b.relation || "가족"), expires_hours: 72 });
});

app.get("/api/tg/elders/mine", requireAuth(), async (c) => {
  await ready(c.env.DB);
  const u = getUser(c);
  const r = await c.env.DB.prepare(
    `SELECT e.elder_id, u.name, u.address, p.linked,
            (SELECT COUNT(*) FROM onda_tgc_family f JOIN onda_tgc_people fp ON fp.user_id = f.family_id AND fp.linked = 1 WHERE f.elder_id = e.elder_id) AS family
       FROM onda_tgc_elders e JOIN onda_users u ON u.id = e.elder_id LEFT JOIN onda_tgc_people p ON p.room_key = 'u:' || e.elder_id
      WHERE e.enrolled_by = ? ORDER BY e.created_at DESC LIMIT 100`).bind(u.id).all();
  return c.json({ elders: r.results });
});

app.post("/api/tg/helpers/invite", requireAdmin(), async (c) => {
  const t = tg(c.env); if (!t) return notConfigured(c);
  await ready(c.env.DB);
  const b = await c.req.json<{ name?: string; grade?: string; phone?: string }>();
  if (!b.name?.trim()) return c.json({ error: "name required" }, 400);
  const id = crypto.randomUUID();
  const grade = b.grade === "orange" || b.grade === "red" ? b.grade : "green";
  await c.env.DB.prepare("INSERT INTO onda_users (id, name, role, phone, region) VALUES (?, ?, 'responder', ?, 'KR')").bind(id, b.name.trim().slice(0, 40), b.phone || "").run();
  // 기존 가입과 같이 «대기» — 관리자 화면 승인 탭에서 승인해야 출동 부탁을 받는다
  await c.env.DB.prepare("INSERT INTO onda_responders (user_id, grade, status) VALUES (?, ?, 'pending')").bind(id, grade).run();
  await addPerson(c.env.DB, roomOf(id), id, "helper");
  const { url } = await t.startLink(roomOf(id), 72);
  return c.json({ ok: true, helperId: id, url, status: "pending" });
});

app.post("/api/tg/ops/link", requireAdmin(), async (c) => {
  const t = tg(c.env); if (!t) return notConfigured(c);
  await ready(c.env.DB);
  const b = await c.req.json<{ name?: string }>().catch(() => ({} as { name?: string }));
  const name = (b.name || "main").replace(/[^\w.-]/g, "").slice(0, 40) || "main";
  await addPerson(c.env.DB, opsRoom(name), null, "ops");
  const { url } = await t.startLink(opsRoom(name), 72);
  return c.json({ ok: true, url, room: opsRoom(name), note: "상황실 단체방에 봇을 넣고 이 링크를 단체방에서 열어 주세요" });
});

// ───────────── 미니 앱 로그인 ─────────────
app.post("/api/tg/webapp-login", async (c) => {
  const t = tg(c.env); if (!t) return notConfigured(c);
  await ready(c.env.DB);
  const { initData } = await c.req.json<{ initData?: string }>();
  let v: any;
  try { v = await t.webappVerify(initData || ""); } catch { return c.json({ error: "텔레그램 확인 실패" }, 401); }
  const room = (v.rooms as string[]).find((r) => r.startsWith("u:"));
  const p = room ? await personByRoom(c.env.DB, room) : null;
  if (!p?.user_id) return c.json({ error: "온다와 연결되지 않은 텔레그램입니다" }, 404);
  const user = await c.env.DB.prepare("SELECT id, name, role FROM onda_users WHERE id = ?").bind(p.user_id).first<{ id: string; name: string; role: string }>();
  if (!user) return c.json({ error: "no user" }, 404);
  const now = Math.floor(Date.now() / 1000);
  const token = await signToken({ sub: user.id, name: user.name, role: user.role, type: "access", via: "telegram", iat: now, exp: now + 86400 }, c.env.JWT_SECRET);
  const refreshToken = await signToken({ sub: user.id, name: user.name, role: user.role, type: "refresh", iat: now, exp: now + 86400 * 30 }, c.env.JWT_SECRET);
  return c.json({ ok: true, token, refreshToken, user, kind: p.kind });
});

app.get("/api/tg/me", requireAuth(), async (c) => {
  await ready(c.env.DB);
  const u = getUser(c);
  const p = await personByRoom(c.env.DB, roomOf(u.id));
  let elderIds: string[] = [];
  if (p?.kind === "elder") elderIds = [u.id];
  else if (p?.kind === "family")
    elderIds = (await c.env.DB.prepare("SELECT elder_id FROM onda_tgc_family WHERE family_id = ?").bind(u.id).all<{ elder_id: string }>()).results.map((x) => x.elder_id);
  const active = [];
  for (const id of elderIds) {
    const d = await c.env.DB.prepare("SELECT request_id, state, notified, emergency, created_at FROM onda_tgc_dispatch WHERE elder_id = ? ORDER BY created_at DESC LIMIT 1").bind(id).first();
    active.push({ elderId: id, name: await userName(c.env.DB, id), last: d || null });
  }
  return c.json({ kind: p?.kind || null, linked: !!p?.linked, elders: active });
});

// ───────────── 말벗(hi.genomic.cc) 경보 → 온다 출동 ─────────────
// 말벗은 보호자 텔레그램(@Lumi_ansim_bot)으로 먼저 알리고, 아무도 «확인»하지 않아 보호자 차례가 끝나면 여기로 넘긴다
// (hi-backend notify/dispatch.ts 의 ONDA_DISPATCH_ENABLED 자리). 서명 = HMAC(HI_ONDA_SECRET, ts + '.' + sha256(본문)), 머리말 x-hi-ts·x-hi-sig
const HI_URGENT = new Set(["fall", "fire", "sos", "unconscious", "no_motion"]);
app.post("/api/tg/hi-alert", async (c) => {
  if (!c.env.HI_ONDA_SECRET || !tg(c.env)) return notConfigured(c);
  const body = await c.req.text();
  const ev = await verifyTongro(body, c.req.header("x-hi-ts"), c.req.header("x-hi-sig"), c.env.HI_ONDA_SECRET);
  if (!ev) return c.json({ error: "forbidden" }, 403);
  if (!(await firstTime(c.env, c.req.header("x-hi-sig")))) return c.json({ error: "duplicate" }, 409);
  await ready(c.env.DB);
  const code = String(ev.code || "").trim().toUpperCase();
  const link = await c.env.DB.prepare("SELECT elder_id FROM onda_tgc_hi_link WHERE hi_code = ?").bind(code).first<{ elder_id: string }>();
  if (!link) return c.json({ ok: false, reason: "온다에 등록되지 않은 말벗 어르신" }, 404);
  const type = String(ev.type || "alert").slice(0, 20);
  const emergency = HI_URGENT.has(type);
  const r = await createTgRequest(c.env, link.elder_id, "hi_system", emergency);
  if (!r.existing) {
    const t = tg(c.env)!;
    const KO: Record<string, string> = { fall: "쓰러짐", fire: "화재", sos: "도움 요청", unconscious: "의식 없음", no_motion: "오래 움직임 없음" };
    await sendMany(t, c.env.DB, await familyRooms(c.env.DB, link.elder_id),
      `🔔 말벗이 «${KO[type] || type}»을(를) 감지했는데 확인한 보호자가 없어 가까운 온다 도우미를 부릅니다.`);
    if (emergency) await markEmergency(c.env, r.requestId, "hi_system");
  }
  return c.json({ ok: true, requestId: r.requestId, existing: r.existing, queued: r.queued });
});

// ───────────── 알림 통로가 넘겨주는 것 ─────────────
app.post("/api/tg/tongro", async (c) => {
  if (!c.env.TONGRO_SECRET) return c.json({ error: "not configured" }, 503);
  const body = await c.req.text();
  const ev = await verifyTongro(body, c.req.header("x-tongro-ts"), c.req.header("x-tongro-sig"), c.env.TONGRO_SECRET);
  if (!ev) return c.json({ error: "forbidden" }, 403);
  if (!(await firstTime(c.env, c.req.header("x-tongro-sig")))) return c.json({ toast: "이미 처리했습니다" });
  await ready(c.env.DB);
  switch (ev.type) {
    case "room_linked": return c.json(await onLinked(c.env, ev));
    case "button": {
      // 알림 통로는 8초 안에 답을 받아야 버튼을 바꿔 준다 — 오래 걸리는 알림 보내기는 답 뒤로 미룬다(2026-11-24 예행 7회차에서 찾음)
      const later = (p: Promise<unknown>) => { const q = p.catch((e) => console.error("[tg-care] later:", e)); try { c.executionCtx.waitUntil(q); } catch { return q; } return Promise.resolve(); };
      return c.json(await onButton(c.env, ev, later));
    }
    case "message": await onText(c.env, ev); return c.json({});
    case "location": await onLocation(c.env, ev); return c.json({});
    default: return c.json({});
  }
});

async function onLinked(env: TgEnv, ev: any): Promise<{ text?: string }> {
  let p = await personByRoom(env.DB, ev.room);
  // 상황실 방은 알림 통로 관리 화면에서 «방 연결 링크»(제품 onda, 방 이름 ops:<이름>)로 만들어도 된다
  if (!p && /^ops:[\w.-]{1,40}$/.test(String(ev.room))) { await addPerson(env.DB, ev.room, null, "ops"); p = await personByRoom(env.DB, ev.room); }
  if (!p) return { text: "연결할 수 없는 링크입니다." };
  // 개인 방(u:)은 1:1 대화방에서만 — 단체방이면 방 안 누구나 그 사람 행세를 할 수 있다(다올 검토와 같은 규칙)
  if (p.kind !== "ops" && String(ev.chat_id) !== String(ev.from?.id)) return { text: "이 링크는 봇과 1:1 대화에서 열어 주세요." };
  await env.DB.prepare("UPDATE onda_tgc_people SET linked = 1, tg_name = ?, linked_at = datetime('now') WHERE room_key = ?").bind(ev.from?.name || null, ev.room).run();
  const t = tg(env)!;
  // 인사 + 큰 단추판을 먼저 보내고(통로가 연결 직후 «✅» 를 덧붙임), 메뉴 단추를 미니 앱으로
  const greet = async (text: string, keyboard?: any) => {
    try { await t.send({ room: ev.room, text, ...(keyboard ? { keyboard } : {}) }); } catch {}
    if (p.kind !== "ops") { try { await t.menu(ev.room, "온다 열기", webappUrl(env)); } catch {} }
    return { text: "✅ 연결 완료" };
  };
  if (p.kind === "elder") {
    const enr = await env.DB.prepare("SELECT enrolled_by FROM onda_tgc_elders WHERE elder_id = ?").bind(p.user_id).first<{ enrolled_by: string }>();
    await sendMany(t, env.DB, enr ? [roomOf(enr.enrolled_by)] : [], `✅ ${mask(await userName(env.DB, p.user_id))} 어르신 텔레그램이 연결되었습니다. 이제 가족 QR 을 보여 드리세요.`);
    return greet("온다에 연결되었습니다. 🙏\n도움이 필요하면 아래 «🆘 도와주세요» 를 누르세요. 가까운 도우미가 갑니다.", KB_ELDER(env));
  }
  if (p.kind === "family") {
    if (ev.from?.name) await env.DB.prepare("UPDATE onda_users SET name = ? WHERE id = ? AND name = '가족(연결 전)'").bind(String(ev.from.name).slice(0, 40), p.user_id).run();
    const f = await env.DB.prepare("SELECT elder_id FROM onda_tgc_family WHERE family_id = ?").bind(p.user_id).first<{ elder_id: string }>();
    const en = f ? mask(await userName(env.DB, f.elder_id)) : "";
    if (f) {
      // 가족 링크가 엉뚱한 사람 손에 가도 바로 알 수 있게: 텔레그램 이름을 어르신·담당 도우미에게 알림
      const enr = await env.DB.prepare("SELECT enrolled_by FROM onda_tgc_elders WHERE elder_id = ?").bind(f.elder_id).first<{ enrolled_by: string }>();
      const nm = String(ev.from?.name || "이름 없음").slice(0, 40);
      await sendMany(t, env.DB, [roomOf(f.elder_id)], `👨‍👩‍👧 가족 «${nm}» 님이 연결되었습니다. 모르는 분이면 담당 도우미에게 알려 주세요.`);
      if (enr) await sendMany(t, env.DB, [roomOf(enr.enrolled_by)], `👨‍👩‍👧 ${en} 어르신 가족으로 «${nm}» 님이 연결되었습니다. 모르는 분이면 상황실에 알려 주세요.`);
    }
    return greet(`${en} 어르신 가족으로 연결되었습니다. 도우미 출동·도착·마침을 여기로 알려 드립니다.\n어르신께 도움이 필요하면 아래 단추를 누르세요.`, KB_FAMILY(env));
  }
  if (p.kind === "helper")
    return greet("온다 도우미로 연결되었습니다. 출동 부탁이 오면 여기로 알려 드립니다.\n받으실 수 있을 때 «🟢 출동 받기 켜기» 를 눌러 주세요.", KB_HELPER(env));
  if (p.kind === "ops") return greet("온다 상황실 방으로 연결되었습니다. 출동 부탁·수락·도착·마침·위급을 여기로 알립니다.");
  return greet("온다에 연결되었습니다.");
}

async function onText(env: TgEnv, ev: any) {
  const p = await personByRoom(env.DB, ev.room);
  if (!p?.linked || !p.user_id) return;
  const t = tg(env)!;
  const text = String(ev.text || "").trim();
  if (p.kind === "elder" && text.includes("도와주세요")) {
    await t.send({ room: ev.room, text: TXT.sosAsk, buttons: [[{ text: "예 — 많이 위급해요", data: `sos:${p.user_id}:y` }], [{ text: "아니요 — 도우미를 불러 주세요", data: `sos:${p.user_id}:n` }]] });
  } else if (p.kind === "elder" && text.includes("가족 묶기")) {
    const url = await familyLink(env, p.user_id, "가족");
    await t.send({ room: ev.room, text: `아래 링크를 가족에게 보내 주세요. (3일 안에 한 번만 쓸 수 있습니다)\n${url}` });
  } else if (p.kind === "family" && text.includes("출동 부탁")) {
    const els = (await env.DB.prepare("SELECT elder_id FROM onda_tgc_family WHERE family_id = ?").bind(p.user_id).all<{ elder_id: string }>()).results;
    if (!els.length) { await t.send({ room: ev.room, text: "연결된 어르신이 없습니다." }); return; }
    const rows = [];
    for (const e of els) {
      const n = await userName(env.DB, e.elder_id);
      rows.push([{ text: `${n} 어르신 — 위급(119)`, data: `sos:${e.elder_id}:y` }], [{ text: `${n} 어르신 — 도우미 부탁`, data: `sos:${e.elder_id}:n` }]);
    }
    await t.send({ room: ev.room, text: "어느 어르신께 보낼까요? 숨쉬기 힘들거나 쓰러지셨으면 «위급» 을 누르세요.", buttons: rows });
  } else if (p.kind === "helper" && (text.includes("켜기") || text.includes("끄기"))) {
    const on = text.includes("켜기") ? 1 : 0;
    const st = await env.DB.prepare("SELECT status FROM onda_responders WHERE user_id = ?").bind(p.user_id).first<{ status: string }>();
    if (st?.status !== "approved") { await t.send({ room: ev.room, text: "아직 관리자 승인 전입니다. 승인되면 알려 드립니다." }); return; }
    await env.DB.prepare("UPDATE onda_responders SET available = ? WHERE user_id = ?").bind(on, p.user_id).run();
    await t.send({ room: ev.room, text: on ? `🟢 출동 받기를 켰습니다.\n${TXT.liveHow}` : "⚪ 출동 받기를 껐습니다." });
  }
}

async function onLocation(env: TgEnv, ev: any) {
  const p = await personByRoom(env.DB, ev.room);
  if (!p?.linked || !p.user_id) return;
  const lat = Number(ev.lat), lng = Number(ev.lng);
  if (p.kind === "helper") await onHelperLocation(env, p.user_id, lat, lng);
  else if (p.kind === "elder" && !ev.edited) {
    await env.DB.prepare("UPDATE onda_users SET lat = ?, lng = ? WHERE id = ?").bind(lat, lng, p.user_id).run();
    await tg(env)!.send({ room: ev.room, text: "📍 위치를 받았습니다. 도우미가 이 위치로 갑니다." }).catch(() => {});
  }
}

const HELPER_NEXT: Record<string, { text: string; data: string }[][]> = {
  accepted: [[{ text: "🚶 출발했어요", data: "moving" }]],
  moving: [[{ text: "🏠 도착했어요", data: "arrived" }]],
  arrived: [[{ text: "🤝 돌봄 시작", data: "in_progress" }], [{ text: "🚑 위급해요(119)", data: "e" }]],
  in_progress: [[{ text: "✅ 돌봄 마쳤어요", data: "completed" }], [{ text: "🚑 위급해요(119)", data: "e" }]],
};
const helperButtons = (mid: string, st: string) =>
  (HELPER_NEXT[st] || []).map((row) => row.map((b) => ({ text: b.text, data: b.data === "e" ? `e:${mid}` : `s:${mid}:${b.data}` })));
const HELPER_SAID: Record<string, string> = {
  accepted: "✅ 맡아 주셔서 고맙습니다. 출발하시면 눌러 주세요.",
  moving: "🚶 가는 중으로 적었습니다. 도착하시면 눌러 주세요.",
  arrived: "🏠 도착으로 적었습니다.",
  in_progress: "🤝 돌봄 중입니다. 마치시면 눌러 주세요.",
  completed: "🙏 마침으로 적었습니다. 고맙습니다.",
};

/** 버튼 눌림. 돌려주는 값으로 통로가 그 메시지를 고친다 {toast, append, buttons} */
async function onButton(env: TgEnv, ev: any, later: (p: Promise<unknown>) => Promise<unknown> = (p) => p): Promise<Record<string, unknown>> {
  const data = String(ev.data || "");
  const [kind, a, b] = data.split(":");
  const t = tg(env)!;
  const p = await personByRoom(env.DB, ev.room);
  if (!p?.linked) return { toast: "연결되지 않은 방입니다" };

  if (kind === "r") {                                   // 상황실: 다시 부탁하기
    if (p.kind !== "ops") return { toast: "상황실만 누를 수 있습니다" };
    const ok = await restartQueue(env, a);
    return ok ? { toast: "다시 부탁합니다", append: `▶ ${ev.from?.name || "상황실"} — 다시 부탁`, buttons: null } : { toast: "이미 진행 중입니다", buttons: null };
  }
  if (kind === "sos") {                                 // 어르신·가족: 위급 여부
    const elderId = a;
    const allowed = (p.kind === "elder" && p.user_id === elderId) ||
      (p.kind === "family" && await env.DB.prepare("SELECT 1 FROM onda_tgc_family WHERE elder_id = ? AND family_id = ?").bind(elderId, p.user_id).first());
    if (!allowed) return { toast: "누를 수 없는 버튼입니다" };
    const emergency = b === "y";
    if (emergency) await t.send({ room: ev.room, text: TXT.call119 }).catch(() => {});   // 119 안내는 먼저, 바로
    const r = await createTgRequest(env, elderId, p.user_id, emergency, later, emergency);
    const elderRoom = roomOf(elderId);
    if (p.kind === "family" && !r.existing) await sendMany(t, env.DB, [elderRoom], "👨‍👩‍👧 가족이 도우미를 불렀습니다. 곧 연락드립니다.");
    return { toast: r.existing ? "이미 도우미를 부르고 있습니다" : "도우미를 부릅니다",
             append: r.existing ? "▶ 이미 부르고 있습니다. 조금만 기다려 주세요." : "▶ 가까운 도우미를 부르고 있습니다. 조금만 기다려 주세요.", buttons: null };
  }
  // 이하 도우미 버튼: 이 방 주인 = 그 출동의 도우미여야 함
  if (p.kind !== "helper") return { toast: "누를 수 없는 버튼입니다" };
  const matchId = a;
  const m = await env.DB.prepare("SELECT id, status, request_id FROM onda_matches WHERE id = ? AND responder_id = ?").bind(matchId, p.user_id)
    .first<{ id: string; status: string; request_id: string }>();
  if (!m) return { toast: "이 출동을 찾을 수 없습니다", buttons: null };
  const evac = await isEvac(env.DB, m.request_id);
  const btns = (st: string) => evac ? evacTongroButtons(matchId, st) : helperButtons(matchId, st);
  const said = (st: string) => evac ? (EVAC_SAID[st] || HELPER_SAID[st]) : HELPER_SAID[st];
  if (kind === "u") {   // 다올: 도착했거나 모시고 가는 중에만 «모실 수 없어요»
    if (!evac || !["arrived", "in_progress"].includes(m.status)) return { toast: "지금은 누를 수 없는 버튼입니다" };
    await env.DB.prepare("UPDATE onda_evac_tasks SET flag = 'unreachable', note = 'helper: 모실 수 없음(텔레그램)' WHERE request_id = ?").bind(m.request_id).run();
    await env.DB.prepare("INSERT INTO onda_admin_logs (admin_id, action, target_type, target_id, memo) VALUES ('system', 'evac_unreachable', 'match', ?, ?)").bind(matchId, p.user_id).run();
    return { toast: "기록했습니다", append: `▶ ${EVAC_SAID.unreachable}`, buttons: null };
  }
  const token = await signToken({ sub: p.user_id, role: "responder", name: "", type: "access", exp: Math.floor(Date.now() / 1000) + 60 }, env.JWT_SECRET);   // 안에서만 쓰는 1분짜리
  const callExisting = (path: string, method: string, body?: unknown) => responderRoutes.request(path, {
    method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body) }, env);

  if (kind === "a") {
    if (m.status !== "offered") return { toast: "이미 지난 부탁입니다", append: "▶ 다른 분이 맡았거나 시간이 지났습니다.", buttons: null };
    const r = await callExisting(`/api/matches/${matchId}/accept`, "POST", {});
    if (r.status === 409) return { toast: "다른 분이 먼저 맡았습니다", append: "▶ 다른 분이 먼저 맡았습니다. 고맙습니다.", buttons: null };
    if (!r.ok) return { toast: "다시 눌러 주세요" };
    await env.DB.prepare("UPDATE onda_tgc_dispatch SET state = 'accepted', cur_match = ? WHERE request_id = ?").bind(matchId, m.request_id).run();
    await later((async () => {
      await syncStatus(env, m.request_id);
      // 수락한 분에게만 주소·지도
      const e = await env.DB.prepare("SELECT u.name, u.address, u.lat, u.lng FROM onda_requests r JOIN onda_users u ON u.id = r.requester_id WHERE r.id = ?")
        .bind(m.request_id).first<{ name: string; address: string; lat: number; lng: number }>();
      const d = await env.DB.prepare("SELECT emergency FROM onda_tgc_dispatch WHERE request_id = ?").bind(m.request_id).first<{ emergency: number }>();
      try {
        await t.send({ room: ev.room, text: `📍 ${e?.name || ""} 어르신 댁: ${e?.address || "(지도 참고)"}` + (d?.emergency ? `\n\n${TXT.helper119}` : "") + `\n\n${TXT.liveHow}` });
        if (e?.lat && e?.lng) await t.sendLocation(ev.room, e.lat, e.lng);
      } catch {}
    })());
    return { toast: "맡으셨습니다", append: `▶ ${said("accepted")}`, buttons: btns("accepted") };
  }
  if (kind === "x") {
    if (m.status !== "offered") return { toast: "이미 지난 부탁입니다", buttons: null };
    await callExisting(`/api/matches/${matchId}/reject`, "POST", {});   // 거절 입구가 바로 다음 분께 넘김(afterResponderAction)
    return { toast: "다음 분께 부탁합니다", append: "▶ 알겠습니다. 다음 분께 부탁드리겠습니다.", buttons: null };
  }
  if (kind === "s" && ["moving", "arrived", "in_progress", "completed"].includes(b)) {
    const r = await callExisting(`/api/matches/${matchId}/status`, "PATCH", { status: b });
    const after = (await env.DB.prepare("SELECT status FROM onda_matches WHERE id = ?").bind(matchId).first<{ status: string }>())?.status || m.status;
    if (!r.ok || after !== b) return { toast: "기록되지 않았습니다", buttons: btns(after) };
    await later(syncStatus(env, m.request_id));
    return { toast: "적었습니다", append: `▶ ${said(b)}`, buttons: b === "completed" ? null : btns(b) };
  }
  if (kind === "e") {
    if (!["accepted", "moving", "arrived", "in_progress"].includes(m.status)) return { toast: "지금은 누를 수 없습니다" };
    await later((async () => { await t.send({ room: ev.room, text: TXT.helper119 }).catch(() => {}); await markEmergency(env, m.request_id, p.user_id); })());
    return { toast: "119 안내를 보냈습니다" };
  }
  return { toast: "알 수 없는 버튼" };
}

export { app as tgCareRoutes };
export { tgCareTick } from "./dispatch";
