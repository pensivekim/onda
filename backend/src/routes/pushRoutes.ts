import { Hono } from "hono";
import type { Env } from "../types";
import { requireAuth, getUser } from "../utils/auth";
import { saveSubscription, getSubscription } from "../utils/webpush";

const app = new Hono<{ Bindings: Env }>();

// POST /api/push/subscribe — 푸시 구독 등록
app.post("/api/push/subscribe", requireAuth(), async (c) => {
  const user = getUser(c);
  const body = await c.req.json<{ subscription: { endpoint: string; keys: { p256dh: string; auth: string } } }>();
  if (!body.subscription?.endpoint) return c.json({ error: "subscription required" }, 400);
  await saveSubscription(c.env.DB, user.id, body.subscription);
  return c.json({ ok: true });
});

// GET /api/push/vapid-key — VAPID public key 반환
app.get("/api/push/vapid-key", (c) => {
  return c.json({ publicKey: c.env.VAPID_PUBLIC_KEY || "" });
});

// POST /api/push/send — 특정 사용자에게 푸시 발송 (admin or system)
app.post("/api/push/send", async (c) => {
  const body = await c.req.json<{ userId: string; title: string; body: string; url?: string; urgent?: boolean }>();
  if (!body.userId || !body.title) return c.json({ error: "userId and title required" }, 400);

  const sub = await getSubscription(c.env.DB, body.userId);
  if (!sub) return c.json({ error: "No subscription found" }, 404);

  // Send push
  try {
    const res = await fetch(sub.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", "TTL": "86400" },
      body: JSON.stringify({ title: body.title, body: body.body, url: body.url, urgent: body.urgent }),
    });
    return c.json({ ok: true, sent: res.ok });
  } catch {
    return c.json({ ok: false, error: "Push failed" }, 500);
  }
});

export { app as pushRoutes };
