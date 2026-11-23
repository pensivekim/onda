import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env } from "./types";
import { authRoutes } from "./routes/authRoutes";
import { requestRoutes } from "./routes/requestRoutes";
import { responderRoutes } from "./routes/responderRoutes";
import { matchRoutes } from "./routes/matchRoutes";
import { adminRoutes } from "./routes/adminRoutes";
import { pushRoutes } from "./routes/pushRoutes";
import { walletRoutes } from "./routes/walletRoutes";
import { detectDispatchRoutes } from "./features/detect-dispatch/dispatchRoute";
import { evacRoutes } from "./features/evac-dispatch/evacRoutes";
import { evacTelegramRoutes } from "./features/evac-dispatch/telegram";
import { tgCareRoutes, tgCareTick } from "./features/tg-care/routes"; // 온다 텔레그램판 (2026-11-22)
import { tgRehearseRoutes } from "./features/tg-care/rehearse"; // 예행(가상 사람) 준비·치우기 (2026-11-23)
import { ensureAllTables } from "./utils/db";

const app = new Hono<{ Bindings: Env }>();

// CORS
app.use("*", cors({
  origin: ["https://onda.genomic.cc", "http://localhost:5173", "http://localhost:3000"],
  allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization"],
}));

// Error handler
app.onError((err, c) => {
  if (err.message?.includes("JSON") || err.message?.includes("Unexpected")) {
    return c.json({ error: "Invalid JSON" }, 400);
  }
  console.error("Error:", err.message);
  return c.json({ error: "Internal server error" }, 500);
});

// Routes
app.route("/", authRoutes);
app.route("/", requestRoutes);
app.route("/", responderRoutes);
app.route("/", matchRoutes);
app.route("/", adminRoutes);
app.route("/", pushRoutes);
app.route("/", walletRoutes);
app.route("/", detectDispatchRoutes);
app.route("/", evacRoutes);          // 이웃대피: 예보→대피 출동 (2026-10-26 대표 승인 «고쳐라»)
app.route("/", evacTelegramRoutes);  // 이웃대피: 도우미 텔레그램 버튼
app.route("/", tgCareRoutes);        // 온다 텔레그램판: 어르신·가족·도우미·상황실 (알림 통로 경유)
app.route("/", tgRehearseRoutes);    // 예행 — TG_REH_TOKEN 없으면 닫힘

// Health
app.get("/health", (c) => c.json({ status: "ok", service: "onda-backend", timestamp: new Date().toISOString() }));

// Match timeout: expire offered matches — 60s normally, 5 min for 이웃대피(evac_forecast) offers.
// 2026-10-26 대표 «5분으로 늘려라»: 고령 도우미(이·통장)에게 60초는 짧음.
// Also compare with SQLite datetime() on both sides: created_at is 'YYYY-MM-DD HH:MM:SS' while the old
// ISO cutoff ('...T...Z') sorted after any same-day value, so offers expired at the next tick regardless of age.
async function expireStaleOffers(db: D1Database): Promise<number> {
  const stale = await db.prepare(
    `SELECT m.id, m.request_id, m.responder_id FROM onda_matches m
       LEFT JOIN onda_requests r ON r.id = m.request_id
      WHERE m.status = 'offered'
        -- 2026-11-23: 차례 출동(한 분씩) 요청은 그 엔진이 시간을 잰다 — 여기서 건드리면 차례가 끊김
        AND NOT EXISTS (SELECT 1 FROM onda_tgc_dispatch d WHERE d.request_id = m.request_id)
        AND datetime(m.created_at) < CASE WHEN r.source = 'evac_forecast'
                                          THEN datetime('now', '-5 minutes')
                                          ELSE datetime('now', '-60 seconds') END`
  ).bind().all<{ id: string; request_id: string; responder_id: string }>();

  if (!stale.results.length) return 0;

  for (const m of stale.results) {
    await db.prepare("UPDATE onda_matches SET status = 'expired' WHERE id = ?").bind(m.id).run();
    // Notify responder
    await db.prepare(
      "INSERT INTO onda_notifications (user_id, type, title, body) VALUES (?, 'match_expired', ?, ?)"
    ).bind(m.responder_id, "Match expired", "A care request has expired due to timeout.").run();
  }

  // Check if any request has ALL matches expired → notify requester
  const requestIds = [...new Set(stale.results.map(m => m.request_id))];
  for (const reqId of requestIds) {
    const active = await db.prepare(
      "SELECT COUNT(*) as cnt FROM onda_matches WHERE request_id = ? AND status NOT IN ('expired','rejected','cancelled')"
    ).bind(reqId).first<{ cnt: number }>();
    if (!active?.cnt) {
      // All offers expired for this request
      const req = await db.prepare("SELECT requester_id, source FROM onda_requests WHERE id = ?").bind(reqId).first<{ requester_id: string; source: string }>();
      // 다올 대피 출동은 군청 상황판이 «다시 배정»으로 처리 — 어르신 계정에 알림을 보내지 않음 (2026-10-26)
      if (req && req.source !== "evac_forecast") {
        await db.prepare("UPDATE onda_requests SET status = 'cancelled' WHERE id = ? AND status = 'pending'").bind(reqId).run();
        await db.prepare(
          "INSERT INTO onda_notifications (user_id, type, title, body) VALUES (?, 'no_match', ?, ?)"
        ).bind(req.requester_id, "No helpers available", "No helpers were available nearby. Please try again.").run();
      }
    }
  }

  return stale.results.length;
}

export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil((async () => {
      try {
        await ensureAllTables(env.DB);
        // 차례 출동(안 받으면 다음 분) — 웹 앱·텔레그램·말벗 모두. 표(onda_tgc_dispatch)도 여기서 만든다
        try { await tgCareTick(env as any); } catch (e) { console.error('[Cron] tg-care:', e); }
        const expired = await expireStaleOffers(env.DB);
        if (expired > 0) console.log(`[Cron] Expired ${expired} stale match offers`);
      } catch (e) {
        console.error('[Cron] Error:', e);
      }
    })());
  },
};
