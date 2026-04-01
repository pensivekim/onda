import { Hono } from "hono";
import type { Env } from "../types";
import { ensureAllTables } from "../utils/db";
import { requireAuth, getUser } from "../utils/auth";

const app = new Hono<{ Bindings: Env }>();

// POST /api/requests — 긴급 돌봄 요청 생성
app.post("/api/requests", requireAuth(), async (c) => {
  await ensureAllTables(c.env.DB);
  const user = getUser(c);
  const body = await c.req.json<{
    type?: string; address?: string; lat?: number; lng?: number;
    description?: string; urgency?: string;
  }>();

  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO onda_requests (id, requester_id, type, address, lat, lng, description, urgency)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, user.id, body.type || "child", body.address || "", body.lat || 0, body.lng || 0, body.description || "", body.urgency || "normal").run();

  return c.json({ ok: true, request: { id, status: "pending", type: body.type } });
});

// GET /api/requests/my — 내 요청 히스토리
app.get("/api/requests/my", requireAuth(), async (c) => {
  await ensureAllTables(c.env.DB);
  const user = getUser(c);
  const result = await c.env.DB.prepare(
    "SELECT * FROM onda_requests WHERE requester_id = ? ORDER BY created_at DESC LIMIT 20"
  ).bind(user.id).all();
  return c.json({ requests: result.results });
});

// GET /api/requests/:id — 요청 상세
app.get("/api/requests/:id", requireAuth(), async (c) => {
  await ensureAllTables(c.env.DB);
  const user = getUser(c);
  const id = c.req.param("id");
  const request = await c.env.DB.prepare("SELECT * FROM onda_requests WHERE id = ?").bind(id).first();
  if (!request) return c.json({ error: "Not found" }, 404);
  if (request.requester_id !== user.id && user.role !== "admin") return c.json({ error: "Forbidden" }, 403);
  return c.json({ request });
});

// DELETE /api/requests/:id — 요청 취소
app.delete("/api/requests/:id", requireAuth(), async (c) => {
  await ensureAllTables(c.env.DB);
  const user = getUser(c);
  const id = c.req.param("id");
  const request = await c.env.DB.prepare("SELECT requester_id, status FROM onda_requests WHERE id = ?").bind(id).first<{ requester_id: string; status: string }>();
  if (!request) return c.json({ error: "Not found" }, 404);
  if (request.requester_id !== user.id) return c.json({ error: "Forbidden" }, 403);
  if (request.status !== "pending") return c.json({ error: "Cannot cancel non-pending request" }, 400);

  await c.env.DB.prepare("UPDATE onda_requests SET status = 'cancelled' WHERE id = ?").bind(id).run();
  return c.json({ ok: true });
});

// ===== User Address Management =====

// GET /api/users/profile — 내 프로필 (주소 포함)
app.get("/api/users/profile", requireAuth(), async (c) => {
  await ensureAllTables(c.env.DB);
  const user = getUser(c);
  const profile = await c.env.DB.prepare("SELECT id, name, phone, email, address, lat, lng, region, lang FROM onda_users WHERE id = ?").bind(user.id).first();
  return c.json({ profile });
});

// PATCH /api/users/address — 주소 등록/수정
app.patch("/api/users/address", requireAuth(), async (c) => {
  await ensureAllTables(c.env.DB);
  const user = getUser(c);
  const body = await c.req.json<{ address: string; lat?: number; lng?: number }>();
  if (!body.address) return c.json({ error: "address required" }, 400);

  await c.env.DB.prepare("UPDATE onda_users SET address = ?, lat = ?, lng = ? WHERE id = ?")
    .bind(body.address, body.lat || 0, body.lng || 0, user.id).run();

  return c.json({ ok: true });
});

// PATCH /api/users/region — 지역 변경
app.patch("/api/users/region", requireAuth(), async (c) => {
  await ensureAllTables(c.env.DB);
  const user = getUser(c);
  const { region } = await c.req.json<{ region: string }>();
  if (!region) return c.json({ error: "region required" }, 400);
  await c.env.DB.prepare("UPDATE onda_users SET region = ? WHERE id = ?").bind(region, user.id).run();
  return c.json({ ok: true });
});

export { app as requestRoutes };
