import { Hono } from "hono";
import type { Env } from "../types";
import { ensureAllTables } from "../utils/db";
import { requireAdmin } from "../utils/auth";

const app = new Hono<{ Bindings: Env }>();

// GET /api/admin/responders/pending — 승인 대기 출동자
app.get("/api/admin/responders/pending", requireAdmin(), async (c) => {
  await ensureAllTables(c.env.DB);
  const result = await c.env.DB.prepare(
    `SELECT r.*, u.name, u.phone, u.email, u.profile_image
     FROM onda_responders r JOIN onda_users u ON u.id = r.user_id
     WHERE r.status = 'pending' ORDER BY r.created_at DESC`
  ).bind().all();
  return c.json({ responders: result.results });
});

// PATCH /api/admin/responders/:id/approve — 출동자 승인
app.patch("/api/admin/responders/:id/approve", requireAdmin(), async (c) => {
  await ensureAllTables(c.env.DB);
  const id = c.req.param("id");
  await c.env.DB.prepare("UPDATE onda_responders SET status = 'approved' WHERE user_id = ?").bind(id).run();
  return c.json({ ok: true });
});

// PATCH /api/admin/responders/:id/suspend — 출동자 정지
app.patch("/api/admin/responders/:id/suspend", requireAdmin(), async (c) => {
  await ensureAllTables(c.env.DB);
  const id = c.req.param("id");
  await c.env.DB.prepare("UPDATE onda_responders SET status = 'suspended', available = 0 WHERE user_id = ?").bind(id).run();
  return c.json({ ok: true });
});

// GET /api/admin/requests — 전체 요청 (페이지네이션)
app.get("/api/admin/requests", requireAdmin(), async (c) => {
  await ensureAllTables(c.env.DB);
  const page = parseInt(c.req.query("page") || "1");
  const limit = Math.min(parseInt(c.req.query("limit") || "20"), 50);
  const offset = (page - 1) * limit;

  const result = await c.env.DB.prepare(
    `SELECT r.*, u.name as requester_name
     FROM onda_requests r LEFT JOIN onda_users u ON u.id = r.requester_id
     ORDER BY r.created_at DESC LIMIT ? OFFSET ?`
  ).bind(limit, offset).all();

  const total = await c.env.DB.prepare("SELECT COUNT(*) as cnt FROM onda_requests").first<{ cnt: number }>();

  return c.json({ requests: result.results, total: total?.cnt || 0, page, limit });
});

// GET /api/admin/settlements/pending — 정산 대기
app.get("/api/admin/settlements/pending", requireAdmin(), async (c) => {
  await ensureAllTables(c.env.DB);
  const result = await c.env.DB.prepare(
    `SELECT s.*, u.name as responder_name, u.phone as responder_phone
     FROM onda_settlements s JOIN onda_users u ON u.id = s.responder_id
     WHERE s.status = 'pending' ORDER BY s.created_at DESC`
  ).bind().all();
  return c.json({ settlements: result.results });
});

// PATCH /api/admin/settlements/:id/pay — 정산 처리
app.patch("/api/admin/settlements/:id/pay", requireAdmin(), async (c) => {
  await ensureAllTables(c.env.DB);
  const id = c.req.param("id");
  const now = new Date().toISOString();
  await c.env.DB.prepare("UPDATE onda_settlements SET status = 'paid', paid_at = ? WHERE id = ?").bind(now, id).run();
  return c.json({ ok: true });
});

// GET /api/admin/stats — 통계
app.get("/api/admin/stats", requireAdmin(), async (c) => {
  await ensureAllTables(c.env.DB);
  const today = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);

  const [users, responders, pendingResp, requestsToday, matchesToday] = await Promise.all([
    c.env.DB.prepare("SELECT COUNT(*) as cnt FROM onda_users").first<{ cnt: number }>(),
    c.env.DB.prepare("SELECT COUNT(*) as cnt FROM onda_responders WHERE status = 'approved'").first<{ cnt: number }>(),
    c.env.DB.prepare("SELECT COUNT(*) as cnt FROM onda_responders WHERE status = 'pending'").first<{ cnt: number }>(),
    c.env.DB.prepare("SELECT COUNT(*) as cnt FROM onda_requests WHERE created_at >= ?").bind(today).first<{ cnt: number }>(),
    c.env.DB.prepare("SELECT COUNT(*) as cnt FROM onda_matches WHERE status = 'completed' AND completed_at >= ?").bind(today).first<{ cnt: number }>(),
  ]);

  return c.json({
    totalUsers: users?.cnt || 0,
    approvedResponders: responders?.cnt || 0,
    pendingResponders: pendingResp?.cnt || 0,
    requestsToday: requestsToday?.cnt || 0,
    completedToday: matchesToday?.cnt || 0,
  });
});

export { app as adminRoutes };
