// 감지→대응 결합 v1: 감지 이벤트 → 출동요청 생성 + 등급 매핑 + 근접 매칭 (격리 신규 라우트)
// 기존 /api/dispatch/webhook(matchRoutes)를 수정하지 않고, 바이탈·상황판정·RED 경로를 더한 확장 엔드포인트.
// index.ts 마운트는 1줄(app.route("/", detectDispatchRoutes)) — 선보고 후 반영.

import { Hono } from "hono";
import { ensureAllTables } from "../../utils/db";
import { mapDetectionToGrade, type DetectionInput } from "./grade";
import { verifySigned } from "../../utils/signed";
import { startDispatch } from "../tg-care/dispatch";

type Bindings = { DB: D1Database; LOCATION_KV: KVNamespace; HI_ONDA_SECRET?: string };

const app = new Hono<{ Bindings: Bindings }>();

function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// 등급별 매칭 가능 출동자(상위 등급은 하위 요청도 수행 가능)
const GRADE_IN: Record<string, string> = {
  red: "('red')",
  orange: "('orange','red')",
  green: "('green','orange','red')",
};

const TYPE_MAP: Record<string, string> = {
  fall: "elder", wander: "elder", no_response: "elder", vital_abnormal: "elder",
  fire: "other", intrusion: "other", sound: "other",
};

// POST /api/detect/dispatch — 감지 이벤트(hi/68/스텁) → 출동요청 + 등급 + 근접 매칭
app.post("/api/detect/dispatch", async (c) => {
  // 2026-11-23 보안: 서명(HI_ONDA_SECRET) 필수 — 전에는 아무나 출동을 만들 수 있었다. 매칭은 차례 출동 엔진으로
  const raw = await c.req.text();
  const signed = await verifySigned(raw, c.req.header("x-hi-ts"), c.req.header("x-hi-sig"), (c.env as any).HI_ONDA_SECRET, c.env.LOCATION_KV);
  if (!signed) return c.json({ error: "forbidden" }, 403);
  await ensureAllTables(c.env.DB);
  const body = signed as DetectionInput & {
      facility_id?: string; facility_name?: string;
      lat?: number; lng?: number; address?: string; phone?: string; source_system?: string;
    };

  const triage = mapDetectionToGrade(body);
  const requestId = crypto.randomUUID();
  const reqLat = body.lat || 0;
  const reqLng = body.lng || 0;

  const vitalStr = body.vitals
    ? ` vitals(spo2=${body.vitals.spo2 ?? "-"},hr=${body.vitals.hr ?? "-"},resp=${body.vitals.responsive ?? "-"})`
    : "";
  const description =
    `[detect:${body.source_system || "stub"}] ${body.facility_name || body.facility_id || "unknown"} ` +
    `${body.event_type}${body.situation ? "/" + body.situation : ""}${vitalStr} → ${triage.grade.toUpperCase()} (${triage.reason})`;

  // 출동요청 생성 (grade_required = 매핑된 등급)
  await c.env.DB.prepare(
    `INSERT INTO onda_requests (id, requester_id, type, address, lat, lng, description, grade_required, source, urgency)
     VALUES (?, 'detect_system', ?, ?, ?, ?, ?, ?, 'detect_dispatch', ?)`
  ).bind(requestId, TYPE_MAP[body.event_type] || "other", body.address || "", reqLat, reqLng,
         description, triage.grade, triage.urgency).run();

  // 감사 로그
  await c.env.DB.prepare(
    "INSERT INTO onda_admin_logs (admin_id, action, target_type, target_id, memo) VALUES ('system', 'detect_dispatch', ?, ?, ?)"
  ).bind(body.event_type, requestId, JSON.stringify({ grade: triage.grade, urgency: triage.urgency, call119: triage.call119 })).run();

  // 차례 출동 (가까운 분부터 한 분씩) — 2026-11-23
  const candidateCount = (reqLat && reqLng)
    ? await startDispatch(c.env as any, requestId, { elderId: "detect_system", askedBy: "detect_system", emergency: triage.urgency === "emergency", who: "감지 장치" })
    : 0;
  const matched: never[] = [];

  return c.json({
    ok: true, requestId,
    grade: triage.grade, urgency: triage.urgency, call119: triage.call119, reason: triage.reason,
    candidateCount, matched,
  });
});

export { app as detectDispatchRoutes };
