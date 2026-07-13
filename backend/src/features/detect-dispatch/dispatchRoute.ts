// 감지→대응 결합 v1: 감지 이벤트 → 출동요청 생성 + 등급 매핑 + 근접 매칭 (격리 신규 라우트)
// 기존 /api/dispatch/webhook(matchRoutes)를 수정하지 않고, 바이탈·상황판정·RED 경로를 더한 확장 엔드포인트.
// index.ts 마운트는 1줄(app.route("/", detectDispatchRoutes)) — 선보고 후 반영.

import { Hono } from "hono";
import { ensureAllTables } from "../../utils/db";
import { mapDetectionToGrade, type DetectionInput } from "./grade";

type Bindings = { DB: D1Database; LOCATION_KV: KVNamespace };

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
  await ensureAllTables(c.env.DB);
  const body = await c.req.json<
    DetectionInput & {
      facility_id?: string; facility_name?: string;
      lat?: number; lng?: number; address?: string; phone?: string; source_system?: string;
    }
  >();

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

  // 등급 필터 근접 매칭(5km)
  let candidateCount = 0;
  const matched: Array<{ user_id: string; grade: string; km: number }> = [];
  if (reqLat !== 0 && reqLng !== 0) {
    const responders = await c.env.DB.prepare(
      `SELECT user_id, grade FROM onda_responders WHERE status = 'approved' AND available = 1 AND grade IN ${GRADE_IN[triage.grade]}`
    ).all<{ user_id: string; grade: string }>();
    for (const r of responders.results) {
      const locStr = await c.env.LOCATION_KV.get(`loc:${r.user_id}`);
      if (!locStr) continue;
      const [lat, lng] = locStr.split(",").map(Number);
      const km = haversine(reqLat, reqLng, lat, lng);
      if (km <= 5) {
        await c.env.DB.prepare(
          "INSERT INTO onda_matches (id, request_id, responder_id, status) VALUES (?, ?, ?, 'offered')"
        ).bind(crypto.randomUUID(), requestId, r.user_id).run();
        candidateCount++;
        matched.push({ user_id: r.user_id, grade: r.grade, km: Math.round(km * 100) / 100 });
      }
    }
  }

  return c.json({
    ok: true, requestId,
    grade: triage.grade, urgency: triage.urgency, call119: triage.call119, reason: triage.reason,
    candidateCount, matched,
  });
});

export { app as detectDispatchRoutes };
