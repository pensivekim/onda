import { Hono } from "hono";
import type { Env } from "../types";
import { ensureAllTables } from "../utils/db";
import { requireAuth, getUser } from "../utils/auth";
import { haversine } from "../utils/geo";
import { getRegion } from "../utils/regions";
import { callLLM } from "../utils/llm";
import { TRIAGE_SYSTEM_PROMPT, parseTriageResult } from "../utils/triage";

const app = new Hono<{ Bindings: Env }>();

// POST /api/triage — AI 상황 판단 (등급 추천)
app.post("/api/triage", requireAuth(), async (c) => {
  const body = await c.req.json<{ description: string }>();
  if (!body.description?.trim()) return c.json({ error: "description required" }, 400);

  try {
    const llmOutput = await callLLM(c.env as any, TRIAGE_SYSTEM_PROMPT, body.description.trim(), 256);
    const result = parseTriageResult(llmOutput);
    return c.json({ ok: true, ...result });
  } catch (e) {
    console.error("[Triage] LLM error:", (e as Error).message);
    // Fallback: conservative
    return c.json({
      ok: true,
      grade: "orange",
      urgency: "urgent",
      reason: "AI unavailable — professional care recommended as precaution",
      call119: false,
      advice: "If the person is unresponsive, call 119 immediately",
    });
  }
});

// POST /api/dispatch/create — 요청 생성 + 매칭 시작
app.post("/api/dispatch/create", requireAuth(), async (c) => {
  await ensureAllTables(c.env.DB);
  const user = getUser(c);
  const body = await c.req.json<{
    type?: string; address?: string; lat?: number; lng?: number;
    description?: string; urgency?: string; source?: string; region?: string;
  }>();

  const reqLat = body.lat || 0;
  const reqLng = body.lng || 0;
  const requestId = crypto.randomUUID();

  // Determine region from user profile or body
  const userRow = await c.env.DB.prepare("SELECT region FROM onda_users WHERE id = ?").bind(user.id).first<{ region: string }>();
  const region = body.region || userRow?.region || 'KR';
  const regionConfig = getRegion(region);

  // 1. Create request with region
  await c.env.DB.prepare(
    `INSERT INTO onda_requests (id, requester_id, type, address, lat, lng, description, urgency, source, region)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    requestId, user.id, body.type || "child", body.address || "",
    reqLat, reqLng, body.description || "", body.urgency || "normal", body.source || "manual", region
  ).run();

  // 2. Find available responders nearby — same region only
  const gradeFilter = "";
  const approvedResponders = await c.env.DB.prepare(
    `SELECT r.user_id, r.grade FROM onda_responders r
     JOIN onda_users u ON u.id = r.user_id
     WHERE r.status = 'approved' AND r.available = 1 AND u.region = ? ${gradeFilter}`
  ).bind(region).all<{ user_id: string; grade: string }>();

  let candidateCount = 0;
  for (const r of approvedResponders.results) {
    const locStr = await c.env.LOCATION_KV.get(`loc:${r.user_id}`);
    if (!locStr) continue;

    const [lat, lng] = locStr.split(",").map(Number);
    const dist = haversine(reqLat, reqLng, lat, lng);

    if (dist <= regionConfig.matchRadiusKm) {
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

// POST /api/dispatch/webhook — hi.genomic.cc webhook (자동 출동 요청 + 매칭)
app.post("/api/dispatch/webhook", async (c) => {
  await ensureAllTables(c.env.DB);
  const body = await c.req.json<{
    event_type: string; facility_id: string;
    lat?: number; lng?: number; address?: string; detail?: string;
    phone?: string; facility_name?: string;
  }>();

  // Log webhook
  await c.env.DB.prepare(
    "INSERT INTO onda_admin_logs (admin_id, action, target_type, target_id, memo) VALUES ('system', 'hi_webhook', ?, ?, ?)"
  ).bind(body.event_type, body.facility_id, JSON.stringify(body)).run();

  // Auto-create request from hi event
  const typeMap: Record<string, string> = { fall: "elder", fire: "other", intrusion: "other", wander: "elder", sound: "other" };
  const urgencyMap: Record<string, string> = { fall: "emergency", fire: "emergency", intrusion: "urgent", wander: "urgent", sound: "normal" };
  const reqLat = body.lat || 0;
  const reqLng = body.lng || 0;
  const requestId = crypto.randomUUID();
  const description = `[hi.genomic.cc] ${body.facility_name || body.facility_id} - ${body.event_type}: ${body.detail || "AI auto-detected"}`;

  await c.env.DB.prepare(
    `INSERT INTO onda_requests (id, requester_id, type, address, lat, lng, description, urgency, source)
     VALUES (?, 'hi_system', ?, ?, ?, ?, ?, ?, 'hi_webhook')`
  ).bind(requestId, typeMap[body.event_type] || "other", body.address || "", reqLat, reqLng, description, urgencyMap[body.event_type] || "urgent").run();

  // Auto-match: find nearby responders and create offers
  let candidateCount = 0;
  if (reqLat !== 0 && reqLng !== 0) {
    const gradeNeeded = (body.event_type === 'fall') ? 'orange' : 'green';
    const gradeFilter = gradeNeeded === 'orange' ? "AND grade IN ('orange','red')" : "";
    const responders = await c.env.DB.prepare(
      `SELECT user_id FROM onda_responders WHERE status = 'approved' AND available = 1 ${gradeFilter}`
    ).bind().all<{ user_id: string }>();

    for (const r of responders.results) {
      const locStr = await c.env.LOCATION_KV.get(`loc:${r.user_id}`);
      if (!locStr) continue;
      const [lat, lng] = locStr.split(",").map(Number);
      if (haversine(reqLat, reqLng, lat, lng) <= MATCH_RADIUS_KM) {
        await c.env.DB.prepare(
          "INSERT INTO onda_matches (id, request_id, responder_id, status) VALUES (?, ?, ?, 'offered')"
        ).bind(crypto.randomUUID(), requestId, r.user_id).run();
        candidateCount++;
      }
    }
  }

  return c.json({ ok: true, requestId, candidateCount, urgency: urgencyMap[body.event_type] || "urgent" });
});

export { app as matchRoutes };
