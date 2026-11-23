import { safeEqual } from "../../utils/signed";
// 이웃대피 2단계: 도우미 텔레그램 출동 알림 (격리 신규)
// - 이·통장 등 고령 도우미도 쓰게: 글은 짧고 크게, 누를 것은 한 번에 버튼 한두 개.
// - 버튼을 누르면 «기존 온다 출동 흐름»(responderRoutes 의 수락·상태 입구)을 그대로 부른다 → 정산·대납 규칙이 한 곳에만 있다.
// - 봇 열쇠가 없거나 도우미가 연결 안 했으면 조용히 건너뛰고 기존 앱 알림만 간다(앱 알림은 항상 같이 감).
// 필요한 비밀값: TELEGRAM_BOT_TOKEN, TELEGRAM_BOT_NAME(@ 없이), TELEGRAM_WEBHOOK_SECRET

import { Hono } from "hono";
import type { Env } from "../../types";
import { ensureAllTables } from "../../utils/db";
import { requireAuth, getUser, signToken } from "../../utils/auth";
import { sendNotification } from "../../utils/webpush";
import { responderRoutes } from "../../routes/responderRoutes";
import { tg as tongroOf, roomOf, isLinked } from "../tg-care/core";

export type TgEnv = Env & { TELEGRAM_BOT_TOKEN?: string; TELEGRAM_BOT_NAME?: string; TELEGRAM_WEBHOOK_SECRET?: string };
type Btn = { text: string; callback_data: string };

const app = new Hono<{ Bindings: TgEnv }>();

export async function ensureTgTables(db: D1Database) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS onda_tg_links (
    user_id TEXT PRIMARY KEY,
    chat_id TEXT NOT NULL,
    linked_at TEXT DEFAULT (datetime('now'))
  )`).run();
}

async function tgApi(env: TgEnv, method: string, body: unknown): Promise<any> {
  if (!env.TELEGRAM_BOT_TOKEN) return null;
  try {
    const r = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    return await r.json();
  } catch { return null; }
}

/** 출동 단계별 버튼 — 기존 match 상태 이름(responderRoutes) 그대로. */
export function buttonsFor(matchId: string, status: string): Btn[][] {
  switch (status) {
    case "offered": return [[{ text: "✅ 제가 가겠습니다", callback_data: `a:${matchId}` }], [{ text: "못 갑니다", callback_data: `x:${matchId}` }]];
    case "accepted": return [[{ text: "🚶 출발했어요", callback_data: `s:${matchId}:moving` }]];
    case "moving": return [[{ text: "🏠 댁에 도착했어요", callback_data: `s:${matchId}:arrived` }]];
    case "arrived": return [[{ text: "👵 모시고 출발해요", callback_data: `s:${matchId}:in_progress` }], [{ text: "⚠️ 모실 수 없어요", callback_data: `u:${matchId}` }]];
    case "in_progress": return [[{ text: "🏫 대피소에 도착했어요", callback_data: `s:${matchId}:completed` }]];
    default: return [];
  }
}

/** 같은 버튼을 알림 통로 모양({text, data})으로 */
export const evacTongroButtons = (matchId: string, status: string) =>
  buttonsFor(matchId, status).map((row) => row.map((b) => ({ text: b.text, data: b.callback_data })));

export const STATUS_KO: Record<string, string> = {
  accepted: "수락하셨습니다. 출발하시면 아래 버튼을 눌러 주세요.",
  moving: "가는 중으로 표시했습니다. 도착하시면 눌러 주세요.",
  arrived: "도착으로 표시했습니다. 어르신을 모시고 출발하시면 눌러 주세요.",
  in_progress: "모시고 가는 중입니다. 대피소에 닿으면 눌러 주세요.",
  completed: "대피 완료로 기록했습니다. 고맙습니다. 🙏",
  rejected: "알겠습니다. 다른 분께 부탁드리겠습니다.",
  unreachable: "군청에 알렸습니다. 혼자 무리하지 마시고 119 에 연락해 주세요.",
  taken: "다른 도우미가 먼저 맡았습니다. 고맙습니다.",
};

/**
 * 도우미에게 알림: 기존 앱 알림은 항상, 텔레그램은 연결된 경우만.
 * matchId 를 주면 그 출동의 버튼을 붙인다.
 */
export async function notifyHelper(db: D1Database, env: TgEnv, userId: string, title: string, body: string,
                                   type: string, urgent: boolean, matchId?: string): Promise<boolean> {
  await sendNotification(db, userId, title, body, type, urgent);
  // 2026-11-23: 다올 전용 봇 대신 «온다 봇»(알림 통로)으로 — 봇 열쇠는 통로 한곳에만. 버튼은 온다 텔레그램판 버튼 처리기가 받는다
  if (!env.TELEGRAM_BOT_TOKEN) {
    const t = tongroOf(env as any);
    if (!t || !(await isLinked(db, roomOf(userId)).catch(() => false))) return false;
    try {
      const r = await t.send({ room: roomOf(userId), text: `${title}\n\n${body}`,
        ...(matchId ? { buttons: evacTongroButtons(matchId, "offered") } : {}) });
      return !!r?.ok || !!r?.ref;
    } catch { return false; }
  }
  await ensureTgTables(db);
  const link = await db.prepare("SELECT chat_id FROM onda_tg_links WHERE user_id = ?").bind(userId).first<{ chat_id: string }>();
  if (!link) return false;
  const res = await tgApi(env, "sendMessage", {
    chat_id: link.chat_id,
    text: `${title}\n\n${body}`,
    ...(matchId ? { reply_markup: { inline_keyboard: buttonsFor(matchId, "offered") } } : {}),
  });
  return !!res?.ok;
}

// ── 연결: 앱에서 «텔레그램으로 받기» → 1회용 링크(10분) ──
app.post("/api/evac/telegram/link", requireAuth(), async (c) => {
  if (!c.env.TELEGRAM_BOT_NAME) {
    // 2026-11-23: 온다 봇(알림 통로)으로 묶는다 — 온다 텔레그램판과 같은 방(u:사용자)
    const t = tongroOf(c.env as any);
    if (!t) return c.json({ error: "telegram not configured" }, 503);
    const u = getUser(c);
    await c.env.DB.prepare("INSERT OR IGNORE INTO onda_tgc_people (room_key, user_id, kind) VALUES (?, ?, 'helper')").bind(roomOf(u.id), u.id).run().catch(() => {});
    const { url } = await t.startLink(roomOf(u.id), 1);
    return c.json({ ok: true, url });
  }
  const user = getUser(c);
  const code = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  await c.env.LOCATION_KV.put(`tglink:${code}`, user.id, { expirationTtl: 600 });
  return c.json({ ok: true, url: `https://t.me/${c.env.TELEGRAM_BOT_NAME}?start=${code}` });
});

// ── 텔레그램이 부르는 입구 ──
app.post("/api/evac/telegram/webhook", async (c) => {
  const secret = c.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret || !safeEqual(c.req.header("X-Telegram-Bot-Api-Secret-Token") || "", secret)) return c.json({ error: "forbidden" }, 403);
  await ensureAllTables(c.env.DB);
  await ensureTgTables(c.env.DB);
  const u = await c.req.json<any>();

  // 1) /start <code> — 연결
  const msg = u.message;
  if (msg?.text?.startsWith("/start")) {
    // 1:1 대화방에서만 연결 — 단체방이면 방 안 누구나 그 도우미 행세를 할 수 있음 (2026-10-26 검토 반영)
    if (msg.chat?.type && msg.chat.type !== "private") {
      await tgApi(c.env, "sendMessage", { chat_id: msg.chat.id, text: "봇과 1:1 대화에서만 연결할 수 있습니다." });
      return c.json({ ok: true });
    }
    const code = msg.text.split(" ")[1] || "";
    const userId = code ? await c.env.LOCATION_KV.get(`tglink:${code}`) : null;
    if (!userId) {
      await tgApi(c.env, "sendMessage", { chat_id: msg.chat.id, text: "연결 링크가 만료됐습니다. 온다 앱에서 «텔레그램으로 받기»를 다시 눌러 주세요." });
      return c.json({ ok: true });
    }
    await c.env.DB.prepare(
      "INSERT INTO onda_tg_links (user_id, chat_id) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET chat_id = excluded.chat_id, linked_at = datetime('now')"
    ).bind(userId, String(msg.chat.id)).run();
    await c.env.LOCATION_KV.delete(`tglink:${code}`);
    await tgApi(c.env, "sendMessage", { chat_id: msg.chat.id, text: "연결되었습니다. 대피 출동 부탁이 오면 여기로 알려 드립니다." });
    return c.json({ ok: true, linked: userId });
  }

  // 2) 버튼
  const cq = u.callback_query;
  if (!cq?.data) return c.json({ ok: true });
  const chatId = String(cq.message?.chat?.id ?? cq.from?.id ?? "");
  // 계정은 «버튼을 누른 사람» 번호로 찾는다(1:1 대화방은 방 번호 = 사람 번호)
  const link = await c.env.DB.prepare("SELECT user_id FROM onda_tg_links WHERE chat_id = ?").bind(String(cq.from?.id ?? "")).first<{ user_id: string }>();
  const answer = async (text: string) => tgApi(c.env, "answerCallbackQuery", { callback_query_id: cq.id, text });
  if (!link) { await answer("연결되지 않은 계정입니다"); return c.json({ ok: true }); }

  const [kind, matchId, status] = String(cq.data).split(":");
  const m = await c.env.DB.prepare("SELECT id, status, request_id FROM onda_matches WHERE id = ? AND responder_id = ?")
    .bind(matchId, link.user_id).first<{ id: string; status: string; request_id: string }>();
  if (!m) { await answer("이 출동을 찾을 수 없습니다"); return c.json({ ok: true }); }

  const token = await signToken({ sub: link.user_id, role: "responder", name: "" }, c.env.JWT_SECRET);
  const callExisting = (path: string, method: string, body?: unknown) =>
    responderRoutes.request(path, {
      method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }, c.env);

  let result: string;
  if (kind === "a") {
    // 이미 다른 사람이 맡았으면(내 제안이 취소됨) 수락하지 않는다
    if (m.status !== "offered") result = "taken";
    else { await callExisting(`/api/matches/${matchId}/accept`, "POST", {}); result = "accepted"; }
  } else if (kind === "x") {
    await callExisting(`/api/matches/${matchId}/reject`, "POST", {}); result = "rejected";
  } else if (kind === "s" && ["moving", "arrived", "in_progress", "completed"].includes(status)) {
    await callExisting(`/api/matches/${matchId}/status`, "PATCH", { status });
    result = status;
  } else if (kind === "u") {
    // 도착했거나 모시고 가는 중일 때만 «못 모심»을 받는다 (2026-10-26 검토 반영)
    if (!["arrived", "in_progress"].includes(m.status)) { await answer("지금은 누를 수 없는 버튼입니다"); return c.json({ ok: true }); }
    await c.env.DB.prepare("UPDATE onda_evac_tasks SET flag = 'unreachable', note = 'helper: 모실 수 없음(텔레그램)' WHERE request_id = ?")
      .bind(m.request_id).run();
    await c.env.DB.prepare(
      "INSERT INTO onda_admin_logs (admin_id, action, target_type, target_id, memo) VALUES ('system', 'evac_unreachable', 'match', ?, ?)"
    ).bind(matchId, link.user_id).run();
    result = "unreachable";
  } else { await answer("알 수 없는 버튼"); return c.json({ ok: true }); }

  // 기존 흐름의 응답 코드가 아니라 «DB 에 실제로 남은 상태»를 기준으로 다음 버튼을 고른다
  const after = await c.env.DB.prepare("SELECT status FROM onda_matches WHERE id = ?").bind(matchId).first<{ status: string }>();
  const now = result === "unreachable" || result === "taken" || result === "rejected" ? "" : after?.status || "";
  const ok = result === "unreachable" || result === "taken" || result === "rejected" || now === result;
  await answer(ok ? "기록했습니다" : "다시 눌러 주세요");
  if (cq.message?.message_id) {
    await tgApi(c.env, "editMessageText", {
      chat_id: chatId, message_id: cq.message.message_id,
      text: `${cq.message.text || ""}\n\n▶ ${ok ? STATUS_KO[result] : "기록되지 않았습니다. 다시 눌러 주세요."}`,
      reply_markup: { inline_keyboard: ok && now ? buttonsFor(matchId, now) : ok ? [] : buttonsFor(matchId, after?.status || "offered") },
    });
  }
  return c.json({ ok, result, status: after?.status });
});

export { app as evacTelegramRoutes };
