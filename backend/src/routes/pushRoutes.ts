import { Hono } from "hono";
import type { Env } from "../types";
import { requireAuth, getUser } from "../utils/auth";
import { getUnreadNotifications, markNotificationsRead } from "../utils/webpush";
import { ensureAllTables } from "../utils/db";

const app = new Hono<{ Bindings: Env }>();

// GET /api/notifications/pending — 미읽은 알림 (클라이언트 폴링)
app.get("/api/notifications/pending", requireAuth(), async (c) => {
  await ensureAllTables(c.env.DB);
  const user = getUser(c);
  const notifications = await getUnreadNotifications(c.env.DB, user.id);
  return c.json({ notifications });
});

// POST /api/notifications/read — 알림 읽음 처리
app.post("/api/notifications/read", requireAuth(), async (c) => {
  await ensureAllTables(c.env.DB);
  const { ids } = await c.req.json<{ ids: number[] }>();
  if (!ids?.length) return c.json({ error: "ids required" }, 400);
  await markNotificationsRead(c.env.DB, ids);
  return c.json({ ok: true });
});

// GET /api/notifications/history — 알림 히스토리
app.get("/api/notifications/history", requireAuth(), async (c) => {
  await ensureAllTables(c.env.DB);
  const user = getUser(c);
  const result = await c.env.DB.prepare(
    "SELECT * FROM onda_notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 30"
  ).bind(user.id).all();
  return c.json({ notifications: result.results });
});

export { app as pushRoutes };
