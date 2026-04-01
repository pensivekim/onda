import { Hono } from "hono";
import type { Env } from "../types";
import { ensureAllTables } from "../utils/db";
import { requireAuth, getUser } from "../utils/auth";

const app = new Hono<{ Bindings: Env }>();

// POST /api/responders/register — 출동자 가입
app.post("/api/responders/register", requireAuth(), async (c) => {
  await ensureAllTables(c.env.DB);
  const user = getUser(c);
  const body = await c.req.json<{ bio?: string; phone?: string }>();

  // Update user role
  await c.env.DB.prepare("UPDATE onda_users SET role = 'responder', phone = ? WHERE id = ?")
    .bind(body.phone || "", user.id).run();

  // Create responder profile
  await c.env.DB.prepare(
    "INSERT INTO onda_responders (user_id, bio) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET bio = ?"
  ).bind(user.id, body.bio || "", body.bio || "").run();

  return c.json({ ok: true, status: "pending" });
});

// POST /api/responders/upload-cert — 자격증 사진 업로드 (R2)
app.post("/api/responders/upload-cert", requireAuth(), async (c) => {
  const user = getUser(c);
  const formData = await c.req.formData();
  const file = formData.get("file") as File;
  if (!file) return c.json({ error: "file required" }, 400);

  const ext = file.name.split(".").pop() || "jpg";
  const key = `certs/${user.id}_${Date.now()}.${ext}`;
  await c.env.CERT_BUCKET.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });

  const url = `https://onda-certs.r2.dev/${key}`;
  await c.env.DB.prepare("UPDATE onda_responders SET cert_photo_url = ? WHERE user_id = ?").bind(url, user.id).run();

  return c.json({ ok: true, url });
});

// PATCH /api/responders/available — 대기 ON/OFF
app.patch("/api/responders/available", requireAuth(), async (c) => {
  await ensureAllTables(c.env.DB);
  const user = getUser(c);
  const { available } = await c.req.json<{ available: number }>();
  await c.env.DB.prepare("UPDATE onda_responders SET available = ? WHERE user_id = ?").bind(available ? 1 : 0, user.id).run();
  return c.json({ ok: true, available: available ? 1 : 0 });
});

// PATCH /api/responders/location — 위치 업데이트 (KV TTL 30초)
app.patch("/api/responders/location", requireAuth(), async (c) => {
  const user = getUser(c);
  const { lat, lng } = await c.req.json<{ lat: number; lng: number }>();
  await c.env.LOCATION_KV.put(`loc:${user.id}`, `${lat},${lng}`, { expirationTtl: 30 });
  return c.json({ ok: true });
});

// GET /api/responders/me — 내 출동자 프로필
app.get("/api/responders/me", requireAuth(), async (c) => {
  await ensureAllTables(c.env.DB);
  const user = getUser(c);
  const responder = await c.env.DB.prepare("SELECT * FROM onda_responders WHERE user_id = ?").bind(user.id).first();
  if (!responder) return c.json({ error: "Not a responder" }, 404);
  return c.json({ responder });
});

// POST /api/matches/:id/accept — 요청 수락
app.post("/api/matches/:id/accept", requireAuth(), async (c) => {
  await ensureAllTables(c.env.DB);
  const user = getUser(c);
  const matchId = c.req.param("id");

  const match = await c.env.DB.prepare("SELECT * FROM onda_matches WHERE id = ? AND responder_id = ?").bind(matchId, user.id).first();
  if (!match) return c.json({ error: "Match not found" }, 404);

  const now = new Date().toISOString();
  await c.env.DB.prepare("UPDATE onda_matches SET status = 'accepted', accepted_at = ? WHERE id = ?").bind(now, matchId).run();
  await c.env.DB.prepare("UPDATE onda_requests SET status = 'matched' WHERE id = ?").bind(match.request_id).run();
  // Cancel other offers for same request
  await c.env.DB.prepare("UPDATE onda_matches SET status = 'cancelled' WHERE request_id = ? AND id != ? AND status = 'offered'")
    .bind(match.request_id, matchId).run();

  return c.json({ ok: true, status: "accepted" });
});

// POST /api/matches/:id/reject — 요청 거절
app.post("/api/matches/:id/reject", requireAuth(), async (c) => {
  await ensureAllTables(c.env.DB);
  const user = getUser(c);
  const matchId = c.req.param("id");
  await c.env.DB.prepare("UPDATE onda_matches SET status = 'rejected' WHERE id = ? AND responder_id = ?").bind(matchId, user.id).run();
  return c.json({ ok: true });
});

// PATCH /api/matches/:id/status — 상태 업데이트 (이동중→도착→돌봄중→완료)
app.patch("/api/matches/:id/status", requireAuth(), async (c) => {
  await ensureAllTables(c.env.DB);
  const user = getUser(c);
  const matchId = c.req.param("id");
  const { status } = await c.req.json<{ status: string }>();

  const validStatuses = ["moving", "arrived", "in_progress", "completed"];
  if (!validStatuses.includes(status)) return c.json({ error: "Invalid status" }, 400);

  const match = await c.env.DB.prepare("SELECT * FROM onda_matches WHERE id = ? AND responder_id = ?")
    .bind(matchId, user.id).first<Record<string, unknown>>();
  if (!match) return c.json({ error: "Match not found" }, 404);

  const now = new Date().toISOString();
  const updates: string[] = [`status = '${status}'`];

  if (status === "moving") updates.push(`arrived_at = NULL`);
  if (status === "arrived") updates.push(`arrived_at = '${now}'`);
  if (status === "in_progress") updates.push(`started_at = '${now}'`);
  if (status === "completed") {
    updates.push(`completed_at = '${now}'`);
    // Calculate duration and amount
    const startedAt = match.started_at as string;
    if (startedAt) {
      const mins = Math.max(1, Math.round((Date.now() - new Date(startedAt).getTime()) / 60000));
      const amount = Math.round((mins / 60) * 25000); // 그린 시급 25,000원
      updates.push(`duration_min = ${mins}`, `amount = ${amount}`);

      // Create settlement
      const fee = Math.round(amount * 0.15); // 15% 수수료
      await c.env.DB.prepare(
        "INSERT INTO onda_settlements (id, match_id, responder_id, amount, fee, net_amount) VALUES (?, ?, ?, ?, ?, ?)"
      ).bind(crypto.randomUUID(), matchId, user.id, amount, fee, amount - fee).run();
    }
    // Update request status
    await c.env.DB.prepare("UPDATE onda_requests SET status = 'completed' WHERE id = ?").bind(match.request_id).run();
    // Update responder stats
    await c.env.DB.prepare("UPDATE onda_responders SET total_done = total_done + 1 WHERE user_id = ?").bind(user.id).run();
  }

  await c.env.DB.prepare(`UPDATE onda_matches SET ${updates.join(", ")} WHERE id = ?`).bind(matchId).run();
  return c.json({ ok: true, status });
});

// GET /api/settlements/my — 내 정산 내역
app.get("/api/settlements/my", requireAuth(), async (c) => {
  await ensureAllTables(c.env.DB);
  const user = getUser(c);
  const result = await c.env.DB.prepare(
    "SELECT * FROM onda_settlements WHERE responder_id = ? ORDER BY created_at DESC LIMIT 30"
  ).bind(user.id).all();
  return c.json({ settlements: result.results });
});

export { app as responderRoutes };
