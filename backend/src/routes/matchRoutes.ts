import { Hono } from "hono";
import type { Env } from "../types";
import { ensureAllTables } from "../utils/db";
import { requireAuth, getUser } from "../utils/auth";
import { verifySigned } from "../utils/signed";
import { startDispatch } from "../features/tg-care/dispatch";
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

// POST /api/dispatch/create — 요청 생성 + 차례 출동 시작
// 2026-11-23: 근처 도우미 «모두에게 한꺼번에» → 가까운 분부터 «한 분씩, 안 받으면 다음» (텔레그램판과 같은 엔진)
//             출처(source)·나라·등급을 사용자가 마음대로 넣지 못하게 정해진 값만
const TYPES = new Set(["child", "elder", "disabled", "other"]);
const URG = new Set(["normal", "urgent", "emergency"]);
app.post("/api/dispatch/create", requireAuth(), async (c) => {
  await ensureAllTables(c.env.DB);
  const user = getUser(c);
  const body = await c.req.json<{
    type?: string; address?: string; lat?: number; lng?: number;
    description?: string; urgency?: string; region?: string; gradeRequired?: string;
  }>();
  const reqLat = Number(body.lat) || 0;
  const reqLng = Number(body.lng) || 0;
  if (Math.abs(reqLat) > 90 || Math.abs(reqLng) > 180) return c.json({ error: "invalid location" }, 400);
  // 같은 사람이 이미 진행 중인 부탁이 있으면 그것을 돌려줌(두 번 눌러 도우미 둘이 오지 않게)
  const live = await c.env.DB.prepare(
    "SELECT id FROM onda_requests WHERE requester_id = ? AND status IN ('pending','matched') AND datetime(created_at) > datetime('now','-3 hours') LIMIT 1"
  ).bind(user.id).first<{ id: string }>();
  if (live) return c.json({ ok: true, requestId: live.id, existing: true, candidateCount: 0 });
  const userRow = await c.env.DB.prepare("SELECT region FROM onda_users WHERE id = ?").bind(user.id).first<{ region: string }>();
  const region = getRegion(userRow?.region || "KR").code;   // 나라는 계정 기록에서만
  const gradeRequired = body.gradeRequired === "red" || body.gradeRequired === "orange" ? body.gradeRequired : "green";
  const type = TYPES.has(String(body.type)) ? String(body.type) : "child";
  const urgency = URG.has(String(body.urgency)) ? String(body.urgency) : "normal";
  const requestId = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO onda_requests (id, requester_id, type, address, lat, lng, description, urgency, source, region, grade_required)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'manual', ?, ?)`
  ).bind(requestId, user.id, type, String(body.address || "").slice(0, 200), reqLat, reqLng,
         String(body.description || "").slice(0, 1000), urgency, region, gradeRequired).run();
  const candidateCount = await startDispatch(c.env as any, requestId, { elderId: user.id, askedBy: user.id, emergency: urgency === "emergency", who: "앱 요청" });
  return c.json({ ok: true, requestId, candidateCount });
});

// GET /api/dispatch/:requestId/status — 매칭 상태 조회
app.get("/api/dispatch/:requestId/status", requireAuth(), async (c) => {
  await ensureAllTables(c.env.DB);
  const requestId = c.req.param("requestId");
  const request = await c.env.DB.prepare("SELECT * FROM onda_requests WHERE id = ?").bind(requestId).first<Record<string, unknown>>();
  if (!request) return c.json({ error: "Request not found" }, 404);
  // 2026-11-23: 요청한 사람·관리자만 (전에는 로그인한 누구나 남의 주소·사정을 봄)
  const viewer = getUser(c);
  if (request.requester_id !== viewer.id && viewer.role !== "admin") return c.json({ error: "Request not found" }, 404);

  const matches = await c.env.DB.prepare(
    `SELECT m.id, m.status, m.accepted_at, m.arrived_at, m.started_at, m.completed_at, m.duration_min, m.amount, m.created_at,
            u.name as responder_name, r.grade, r.rating, r.total_done
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

// POST /api/dispatch/webhook — 말벗(hi.genomic.cc) 자동 출동
// 2026-11-23 보안: 전에는 열쇠 확인 없이 열려 있어 아무나 아무 주소로 출동을 만들 수 있었다 → 서명(HI_ONDA_SECRET) 필수, 차례 출동
app.post("/api/dispatch/webhook", async (c) => {
  const raw = await c.req.text();
  const body = await verifySigned(raw, c.req.header("x-hi-ts"), c.req.header("x-hi-sig"), c.env.HI_ONDA_SECRET, c.env.LOCATION_KV);
  if (!body) return c.json({ error: "forbidden" }, 403);
  await ensureAllTables(c.env.DB);
  const typeMap: Record<string, string> = { fall: "elder", fire: "other", intrusion: "other", wander: "elder", sound: "other" };
  const urgencyMap: Record<string, string> = { fall: "emergency", fire: "emergency", intrusion: "urgent", wander: "urgent", sound: "normal" };
  const ev = String(body.event_type || "");
  const reqLat = Number(body.lat) || 0, reqLng = Number(body.lng) || 0;
  if (!reqLat || !reqLng) return c.json({ error: "lat/lng required" }, 400);
  const requestId = crypto.randomUUID();
  const description = `[hi.genomic.cc] ${String(body.facility_name || body.facility_id || "").slice(0, 60)} - ${ev}: ${String(body.detail || "AI auto-detected").slice(0, 200)}`;
  await c.env.DB.prepare("INSERT INTO onda_admin_logs (admin_id, action, target_type, target_id, memo) VALUES ('system', 'hi_webhook', ?, ?, ?)")
    .bind(ev, String(body.facility_id || ""), requestId).run();   // 전화번호 등 원문은 남기지 않음
  await c.env.DB.prepare(
    `INSERT INTO onda_requests (id, requester_id, type, address, lat, lng, description, urgency, source, grade_required)
     VALUES (?, 'hi_system', ?, ?, ?, ?, ?, ?, 'hi_webhook', ?)`
  ).bind(requestId, typeMap[ev] || "other", String(body.address || "").slice(0, 200), reqLat, reqLng, description, urgencyMap[ev] || "urgent", ev === "fall" ? "orange" : "green").run();
  const candidateCount = await startDispatch(c.env as any, requestId, { elderId: "hi_system", askedBy: "hi_system", emergency: urgencyMap[ev] === "emergency", who: "말벗 감지" });
  return c.json({ ok: true, requestId, candidateCount, urgency: urgencyMap[ev] || "urgent" });
});

export { app as matchRoutes };
