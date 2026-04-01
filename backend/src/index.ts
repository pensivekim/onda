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

// Health
app.get("/health", (c) => c.json({ status: "ok", service: "onda-backend", timestamp: new Date().toISOString() }));

// 60-second match timeout: expire offered matches older than 60s
async function expireStaleOffers(db: D1Database): Promise<number> {
  const cutoff = new Date(Date.now() - 60000).toISOString();
  const stale = await db.prepare(
    "SELECT id, request_id, responder_id FROM onda_matches WHERE status = 'offered' AND created_at < ?"
  ).bind(cutoff).all<{ id: string; request_id: string; responder_id: string }>();

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
      const req = await db.prepare("SELECT requester_id FROM onda_requests WHERE id = ?").bind(reqId).first<{ requester_id: string }>();
      if (req) {
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
        const expired = await expireStaleOffers(env.DB);
        if (expired > 0) console.log(`[Cron] Expired ${expired} stale match offers`);
      } catch (e) {
        console.error('[Cron] Error:', e);
      }
    })());
  },
};
