import { Hono } from "hono";
import type { Env } from "../types";
import { ensureAllTables } from "../utils/db";
import { requireAuth, getUser } from "../utils/auth";
import { haversine } from "../utils/geo";

const app = new Hono<{ Bindings: Env }>();

const MATCH_RADIUS_KM = 3;

// POST /api/dispatch/create — 요청 생성 + 매칭 시작
app.post("/api/dispatch/create", requireAuth(), async (c) => {
  await ensureAllTables(c.env.DB);
  const user = getUser(c);
  const body = await c.req.json<{
    type?: string; address?: string; lat?: number; lng?: number;
    description?: string; urgency?: string; source?: string;
  }>();

  const reqLat = body.lat || 0;
  const reqLng = body.lng || 0;
  const requestId = crypto.randomUUID();

  // 1. Create request
  await c.env.DB.prepare(
    `INSERT INTO onda_requests (id, requester_id, type, address, lat, lng, description, urgency, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    requestId, user.id, body.type || "child", body.address || "",
    reqLat, reqLng, body.description || "", body.urgency || "normal", body.source || "manual"
  ).run();

  // 2. Find available responders nearby (KV location scan)
  const approvedResponders = await c.env.DB.prepare(
    "SELECT user_id FROM onda_responders WHERE status = 'approved' AND available = 1"
  ).bind().all<{ user_id: string }>();

  let candidateCount = 0;
  for (const r of approvedResponders.results) {
    const locStr = await c.env.LOCATION_KV.get(`loc:${r.user_id}`);
    if (!locStr) continue;

    const [lat, lng] = locStr.split(",").map(Number);
    const dist = haversine(reqLat, reqLng, lat, lng);

    if (dist <= MATCH_RADIUS_KM) {
      const matchId = crypto.randomUUID();
      await c.env.DB.prepare(
        "INSERT INTO onda_matches (id, request_id, responder_id, status) VALUES (?, ?, ?, 'offered')"
      ).bind(matchId, requestId, r.user_id).run();

      // TODO: Send push notification to responder
      candidateCount++;
    }
  }

  return c.json({ ok: true, requestId, candidateCount });
});

// GET /api/dispatch/:requestId/status — 매칭 상태 조회
app.get("/api/dispatch/:requestId/status", requireAuth(), async (c) => {
  await ensureAllTables(c.env.DB);
  const requestId = c.req.param("requestId");

  const request = await c.env.DB.prepare("SELECT * FROM onda_requests WHERE id = ?").bind(requestId).first();
  if (!request) return c.json({ error: "Request not found" }, 404);

  const matches = await c.env.DB.prepare(
    `SELECT m.*, u.name as responder_name, r.grade, r.rating, r.total_done
     FROM onda_matches m
     JOIN onda_users u ON u.id = m.responder_id
     JOIN onda_responders r ON r.user_id = m.responder_id
     WHERE m.request_id = ?
     ORDER BY m.created_at`
  ).bind(requestId).all();

  const activeMatch = matches.results.find((m: any) =>
    ["accepted", "moving", "arrived", "in_progress", "completed"].includes(m.status as string)
  );

  return c.json({ request, matches: matches.results, activeMatch: activeMatch || null });
});

// POST /api/dispatch/webhook — hi.genomic.cc webhook (Phase 2)
app.post("/api/dispatch/webhook", async (c) => {
  await ensureAllTables(c.env.DB);
  const body = await c.req.json<{
    event_type: string; facility_id: string;
    lat?: number; lng?: number; address?: string; detail?: string;
  }>();

  // Log webhook
  await c.env.DB.prepare(
    "INSERT INTO onda_admin_logs (admin_id, action, target_type, target_id, memo) VALUES ('system', 'hi_webhook', ?, ?, ?)"
  ).bind(body.event_type, body.facility_id, JSON.stringify(body)).run();

  // Auto-create request from hi event
  const typeMap: Record<string, string> = { fall: "elder", fire: "other", intrusion: "other", wander: "elder" };
  const requestId = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO onda_requests (id, requester_id, type, address, lat, lng, description, urgency, source)
     VALUES (?, 'hi_system', ?, ?, ?, ?, ?, 'emergency', 'hi_webhook')`
  ).bind(requestId, typeMap[body.event_type] || "other", body.address || "", body.lat || 0, body.lng || 0, `[hi.genomic.cc] ${body.event_type}: ${body.detail || ""}`).run();

  return c.json({ ok: true, requestId });
});

export { app as matchRoutes };
