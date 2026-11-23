import { Hono } from "hono";
import type { Env } from "../types";
import { ensureAllTables } from "../utils/db";
import { requireAuth, getUser } from "../utils/auth";
import { getRegion } from "../utils/regions";
import { recordOndaPersonBridge } from "../utils/personBridge";
import { afterResponderAction } from "../features/tg-care/dispatch";

const app = new Hono<{ Bindings: Env }>();

/** 그 출동의 요청자·도우미·관리자인가 (2026-11-23) */
async function isParty(db: D1Database, matchId: string, u: { id: string; role: string }): Promise<boolean> {
  if (u.role === "admin") return true;
  const m = await db.prepare("SELECT m.responder_id, r.requester_id FROM onda_matches m JOIN onda_requests r ON r.id = m.request_id WHERE m.id = ?")
    .bind(matchId).first<{ responder_id: string; requester_id: string }>();
  return !!m && (m.responder_id === u.id || m.requester_id === u.id);
}

// POST /api/responders/register — 출동자 가입 (검증 강화)
app.post("/api/responders/register", requireAuth(), async (c) => {
  await ensureAllTables(c.env.DB);
  const user = getUser(c);
  const body = await c.req.json<{
    bio?: string; phone?: string; grade?: string;
    criminalCheckAgreed?: boolean; sexOffenderCheckAgreed?: boolean;
    serviceOathAgreed?: boolean;
  }>();

  // Mandatory agreements
  if (!body.criminalCheckAgreed || !body.sexOffenderCheckAgreed || !body.serviceOathAgreed) {
    return c.json({ error: "All safety agreements are required" }, 400);
  }

  const grade = (body.grade === 'orange' || body.grade === 'red') ? body.grade : 'green';

  // Update user role
  await c.env.DB.prepare("UPDATE onda_users SET role = 'responder', phone = ? WHERE id = ?")
    .bind(body.phone || "", user.id).run();

  // 2단계 표준 phoneHash 다리 — phone 저장 직후 best-effort upsert (비차단).
  //   salt 미설정/phone 빈값이면 graceful skip → 제공자 신청은 정상 성공. executionCtx 없으면 방어 skip.
  try {
    c.executionCtx.waitUntil(
      recordOndaPersonBridge(c.env.DB, user.id, body.phone || "", c.env.CANONICAL_PHONE_SALT || ""),
    );
  } catch { /* executionCtx 미가용 등 — 본체 무관 */ }

  // Migration: add safety columns
  const migrations = [
    "ALTER TABLE onda_responders ADD COLUMN criminal_check_agreed INTEGER DEFAULT 0",
    "ALTER TABLE onda_responders ADD COLUMN sex_offender_check_agreed INTEGER DEFAULT 0",
    "ALTER TABLE onda_responders ADD COLUMN service_oath_agreed INTEGER DEFAULT 0",
    "ALTER TABLE onda_responders ADD COLUMN interview_scheduled_at TEXT",
    "ALTER TABLE onda_responders ADD COLUMN interview_status TEXT DEFAULT 'not_scheduled'",
    "ALTER TABLE onda_responders ADD COLUMN warning_count INTEGER DEFAULT 0",
    "ALTER TABLE onda_responders ADD COLUMN suspended_reason TEXT",
  ];
  for (const sql of migrations) { try { await c.env.DB.prepare(sql).run(); } catch {} }

  // Create/update responder profile
  await c.env.DB.prepare(
    `INSERT INTO onda_responders (user_id, bio, grade, criminal_check_agreed, sex_offender_check_agreed, service_oath_agreed)
     VALUES (?, ?, ?, 1, 1, 1)
     ON CONFLICT(user_id) DO UPDATE SET bio = ?, grade = ?, criminal_check_agreed = 1, sex_offender_check_agreed = 1, service_oath_agreed = 1`
  ).bind(user.id, body.bio || "", grade, body.bio || "", grade).run();

  return c.json({ ok: true, status: "pending", grade });
});

// POST /api/responders/upload-license — 면허증 업로드 (레드/오렌지 등급)
app.post("/api/responders/upload-license", requireAuth(), async (c) => {
  await ensureAllTables(c.env.DB);
  const user = getUser(c);
  const body = await c.req.json<{ licenseType: string; licenseNumber?: string }>();
  if (!body.licenseType) return c.json({ error: "licenseType required" }, 400);

  const validTypes = ['nurse', 'doctor', 'emt', 'caregiver', 'social_worker', 'childcare_teacher'];
  if (!validTypes.includes(body.licenseType)) return c.json({ error: "Invalid license type" }, 400);

  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    "INSERT INTO onda_licenses (id, responder_id, license_type, license_number) VALUES (?, ?, ?, ?)"
  ).bind(id, user.id, body.licenseType, body.licenseNumber || "").run();

  return c.json({ ok: true, licenseId: id });
});

// GET /api/responders/licenses — 내 면허 목록
app.get("/api/responders/licenses", requireAuth(), async (c) => {
  await ensureAllTables(c.env.DB);
  const user = getUser(c);
  const result = await c.env.DB.prepare(
    "SELECT * FROM onda_licenses WHERE responder_id = ? ORDER BY created_at DESC"
  ).bind(user.id).all();
  return c.json({ licenses: result.results });
});

// POST /api/responders/upload-cert — 자격증 사진 업로드 (R2)
app.post("/api/responders/upload-cert", requireAuth(), async (c) => {
  const user = getUser(c);
  const formData = await c.req.formData();
  const file = formData.get("file") as unknown as File;
  if (!file || typeof file === "string") return c.json({ error: "file required" }, 400);
  // 2026-11-23 보안: 사진·PDF 만, 10MB 까지. 주소는 공개 주소가 아니라 저장 열쇠만 남기고, 보기는 관리자 입구로만
  const ALLOW: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf" };
  if (!ALLOW[file.type]) return c.json({ error: "jpg, png, webp, pdf only" }, 400);
  if (file.size > 10 * 1024 * 1024) return c.json({ error: "max 10MB" }, 400);
  const key = `certs/${user.id}/${crypto.randomUUID()}.${ALLOW[file.type]}`;
  await c.env.CERT_BUCKET.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });
  await c.env.DB.prepare("UPDATE onda_responders SET cert_photo_url = ? WHERE user_id = ?").bind(`r2:${key}`, user.id).run();
  return c.json({ ok: true, key });
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
  // fix 2026-10-26: Cloudflare KV 최소 TTL 은 60초 — 30초면 저장이 매번 실패(500)해 출동자 위치가 하나도 안 남았음
  await c.env.LOCATION_KV.put(`loc:${user.id}`, `${lat},${lng}`, { expirationTtl: 60 });
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

// fix 2026-10-26: offered 를 :id 보다 먼저 등록 — 순서가 반대면 /api/matches/offered 가 :id 로 잡혀 404
// GET /api/matches/offered — 내게 제안된 매치 목록
app.get("/api/matches/offered", requireAuth(), async (c) => {
  await ensureAllTables(c.env.DB);
  const user = getUser(c);
  const result = await c.env.DB.prepare(
    `SELECT m.*, r.type, r.address, r.description, r.urgency, CASE WHEN r.source = 'evac_forecast' THEN '다올 대피' ELSE u.name END as requester_name /* 2026-10-26: 대피 출동은 어르신 실명 대신 */
     FROM onda_matches m
     JOIN onda_requests r ON r.id = m.request_id
     LEFT JOIN onda_users u ON u.id = r.requester_id
     WHERE m.responder_id = ? AND m.status IN ('offered','accepted','moving','arrived','in_progress')
     ORDER BY m.created_at DESC LIMIT 10`
  ).bind(user.id).all();
  return c.json({ matches: result.results });
});

// GET /api/matches/:id — 매치 상세 (by match ID)
app.get("/api/matches/:id", requireAuth(), async (c) => {
  await ensureAllTables(c.env.DB);
  const matchId = c.req.param("id");
  const match = await c.env.DB.prepare(
    `SELECT m.*, r.address, r.description, r.type, r.urgency, r.requester_id, CASE WHEN r.source = 'evac_forecast' THEN '다올 대피' ELSE u.name END as requester_name /* 2026-10-26: 대피 출동은 어르신 실명 대신 */
     FROM onda_matches m
     JOIN onda_requests r ON r.id = m.request_id
     LEFT JOIN onda_users u ON u.id = r.requester_id
     WHERE m.id = ?`
  ).bind(matchId).first<Record<string, unknown>>();
  if (!match) return c.json({ error: "Match not found" }, 404);
  // fix 2026-10-26: 본인(출동자·요청자)·관리자만 — 전에는 로그인한 누구나 남의 출동 상세를 봄
  const viewer = getUser(c);
  if (viewer.role !== "admin" && viewer.id !== match.responder_id && viewer.id !== match.requester_id)
    return c.json({ error: "Match not found" }, 404);
  return c.json({ match });
});

// POST /api/matches/:id/accept — 요청 수락
app.post("/api/matches/:id/accept", requireAuth(), async (c) => {
  await ensureAllTables(c.env.DB);
  const user = getUser(c);
  const matchId = c.req.param("id");

  const match = await c.env.DB.prepare("SELECT * FROM onda_matches WHERE id = ? AND responder_id = ?").bind(matchId, user.id).first();
  if (!match) return c.json({ error: "Match not found" }, 404);

  const now = new Date().toISOString();
  // fix 2026-10-26: «제안 중»일 때만, 같은 요청에서 이미 누가 맡았으면 수락 안 됨(동시에 눌러도 한 사람만)
  const taken = await c.env.DB.prepare(
    "SELECT 1 FROM onda_matches WHERE request_id = ? AND status IN ('accepted','moving','arrived','in_progress','completed') LIMIT 1"
  ).bind(match.request_id).first();
  if (taken) return c.json({ error: "taken" }, 409);
  const acc = await c.env.DB.prepare(
    `UPDATE onda_matches SET status = 'accepted', accepted_at = ? WHERE id = ? AND status = 'offered'
       AND NOT EXISTS (SELECT 1 FROM onda_matches o WHERE o.request_id = onda_matches.request_id AND o.id != onda_matches.id
                       AND o.status IN ('accepted','moving','arrived','in_progress','completed'))`
  ).bind(now, matchId).run();
  if (!acc.meta.changes) return c.json({ error: "taken" }, 409);
  await c.env.DB.prepare("UPDATE onda_requests SET status = 'matched' WHERE id = ?").bind(match.request_id).run();
  // Cancel other offers for same request
  await c.env.DB.prepare("UPDATE onda_matches SET status = 'cancelled' WHERE request_id = ? AND id != ? AND status = 'offered'")
    .bind(match.request_id, matchId).run();
  try { await afterResponderAction(c.env as any, matchId || ""); } catch (e) { console.error("[dispatch] accept hook", e); }   // 가족·상황실 알림

  return c.json({ ok: true, status: "accepted" });
});

// POST /api/matches/:id/reject — 요청 거절
app.post("/api/matches/:id/reject", requireAuth(), async (c) => {
  await ensureAllTables(c.env.DB);
  const user = getUser(c);
  const matchId = c.req.param("id");
  // 2026-11-23: «제안 중»일 때만 거절 — 수락 뒤 거절하면 요청이 «맡음»에 멈춰 아무도 안 가던 것
  const r = await c.env.DB.prepare("UPDATE onda_matches SET status = 'rejected' WHERE id = ? AND responder_id = ? AND status = 'offered'").bind(matchId, user.id).run();
  if (!r.meta.changes) return c.json({ error: "not offered" }, 409);
  try { await afterResponderAction(c.env as any, matchId || ""); } catch (e) { console.error("[dispatch] reject hook", e); }   // 바로 다음 분께
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
  // fix 2026-10-26: 순서대로만(수락→이동중→도착→돌봄중→완료) — 취소·만료된 제안으로 «완료»·정산이 생기던 것 막음
  const PREV: Record<string, string> = { moving: "accepted", arrived: "moving", in_progress: "arrived", completed: "in_progress" };
  if (match.status !== PREV[status]) return c.json({ error: "Invalid transition", from: match.status, to: status }, 409);

  const now = new Date().toISOString();

  // Safe parameterized timestamp updates
  if (status === "moving") {
    await c.env.DB.prepare("UPDATE onda_matches SET status = 'moving' WHERE id = ? AND status = 'accepted'").bind(matchId).run();
  }
  if (status === "arrived") {
    await c.env.DB.prepare("UPDATE onda_matches SET status = 'arrived', arrived_at = ? WHERE id = ? AND status = 'moving'").bind(now, matchId).run();
  }
  if (status === "in_progress") {
    await c.env.DB.prepare("UPDATE onda_matches SET status = 'in_progress', started_at = ? WHERE id = ? AND status = 'arrived'").bind(now, matchId).run();
  }
  if (status === "completed") {
    // Calculate duration and amount
    // fix 2026-10-26: amount 를 블록 밖에서 선언 — 안쪽 const 라 아래 지자체 대납·후원 차감에서 ReferenceError(완료마다 500) 나던 것
    let amount = 0;
    const startedAt = match.started_at as string;
    // 2026-11-23: 먼저 «마침»을 한 번만 잡는다 — 두 번 눌러도 정산·결제가 두 번 생기지 않게
    const claim = await c.env.DB.prepare("UPDATE onda_matches SET status = 'completed', completed_at = ? WHERE id = ? AND status = 'in_progress'").bind(now, matchId).run();
    if (!claim.meta.changes) return c.json({ error: "Invalid transition" }, 409);
    if (startedAt) {
      const mins = Math.max(1, Math.round((Date.now() - new Date(startedAt).getTime()) / 60000));
      const responder = await c.env.DB.prepare("SELECT grade FROM onda_responders WHERE user_id = ?").bind(user.id).first<{grade:string}>();
      const userRegion = await c.env.DB.prepare("SELECT region FROM onda_users WHERE id = ?").bind(user.id).first<{region:string}>();
      const regionConfig = getRegion(userRegion?.region || 'KR');
      const grade = responder?.grade || 'green';
      const hourlyRate = regionConfig.rates[grade as keyof typeof regionConfig.rates] || regionConfig.rates.green;
      amount = Math.round((mins / 60) * hourlyRate);
      await c.env.DB.prepare("UPDATE onda_matches SET duration_min = ?, amount = ? WHERE id = ?")
        .bind(mins, amount, matchId).run();

      // Create settlement
      const fee = Math.round(amount * regionConfig.feePercent / 100);
      await c.env.DB.prepare(
        "INSERT INTO onda_settlements (id, match_id, responder_id, amount, fee, net_amount) VALUES (?, ?, ?, ?, ?, ?)"
      ).bind(crypto.randomUUID(), matchId, user.id, amount, fee, amount - fee).run();

      // 누가 내는가 (2026-11-23 고침: 순서 하나로, 한 곳만 낸다)
      //  ① 지자체 수혜자이고 예산이 남으면 지자체 ② 아니면 맞는 후원사 ③ 아니면 요청자 지갑 ④ 모자라면 «미수»로 남겨 관리자·요청자에게 알림
      //  전에는 지갑에서 빼고 후원사도 또 내거나, 지자체 예산이 모자라면 아무도 안 내는 경우가 있었다
      await payFor(c.env.DB, String(match.request_id), matchId || "", amount, `care:${grade}:${mins}min`);
    }
    // Update request status
    await c.env.DB.prepare("UPDATE onda_requests SET status = 'completed' WHERE id = ?").bind(match.request_id).run();
    // Update responder stats
    await c.env.DB.prepare("UPDATE onda_responders SET total_done = total_done + 1 WHERE user_id = ?").bind(user.id).run();

  }
  try { await afterResponderAction(c.env as any, matchId || ""); } catch (e) { console.error("[dispatch] status hook", e); }   // 가족·상황실 알림

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

// ===== 리뷰/평점 =====

// POST /api/reviews — 리뷰 작성 (양방향: 요청자↔출동자)
app.post("/api/reviews", requireAuth(), async (c) => {
  await ensureAllTables(c.env.DB);
  const user = getUser(c);
  const body = await c.req.json<{ matchId: string; rating: number; comment?: string }>();
  if (!body.matchId || !body.rating || body.rating < 1 || body.rating > 5) {
    return c.json({ error: "matchId and rating (1-5) required" }, 400);
  }

  // Find match and determine target
  const match = await c.env.DB.prepare(
    "SELECT m.*, r.requester_id FROM onda_matches m JOIN onda_requests r ON r.id = m.request_id WHERE m.id = ?"
  ).bind(body.matchId).first<Record<string, unknown>>();
  if (!match) return c.json({ error: "Match not found" }, 404);
  if (match.status !== 'completed') return c.json({ error: "Can only review completed matches" }, 400);

  // 2026-11-23: 그 출동의 요청자·도우미만 후기 (전에는 아무나 쓸 수 있었음)
  if (user.id !== match.requester_id && user.id !== match.responder_id) return c.json({ error: "Match not found" }, 404);
  // Determine target: if reviewer is requester → target is responder, vice versa
  const isRequester = user.id === match.requester_id;
  const targetId = isRequester ? match.responder_id as string : match.requester_id as string;

  // Check if already reviewed
  const existing = await c.env.DB.prepare(
    "SELECT id FROM onda_reviews WHERE match_id = ? AND reviewer_id = ?"
  ).bind(body.matchId, user.id).first();
  if (existing) return c.json({ error: "Already reviewed" }, 409);

  const reviewId = crypto.randomUUID();
  await c.env.DB.prepare(
    "INSERT INTO onda_reviews (id, match_id, reviewer_id, target_id, rating, comment) VALUES (?, ?, ?, ?, ?, ?)"
  ).bind(reviewId, body.matchId, user.id, targetId, body.rating, body.comment || "").run();

  // Update responder average rating + auto-warning system
  if (isRequester) {
    const avg = await c.env.DB.prepare(
      "SELECT AVG(rating) as avg_rating, COUNT(*) as cnt FROM onda_reviews WHERE target_id = ?"
    ).bind(targetId).first<{ avg_rating: number; cnt: number }>();
    if (avg) {
      await c.env.DB.prepare("UPDATE onda_responders SET rating = ? WHERE user_id = ?")
        .bind(Math.round(avg.avg_rating * 10) / 10, targetId).run();

      // Auto-warning: 3 or more reviews with avg <= 3.0
      if (avg.cnt >= 3 && avg.avg_rating <= 3.0) {
        try { await c.env.DB.prepare("ALTER TABLE onda_responders ADD COLUMN warning_count INTEGER DEFAULT 0").run(); } catch {}
        await c.env.DB.prepare("UPDATE onda_responders SET warning_count = warning_count + 1 WHERE user_id = ?").bind(targetId).run();
        await c.env.DB.prepare(
          "INSERT INTO onda_notifications (user_id, type, title, body) VALUES (?, 'warning', ?, ?)"
        ).bind(targetId, "Low Rating Warning", "Your average rating is below 3.0. Please improve your service quality.").run();
      }
    }
  }

  return c.json({ ok: true, reviewId });
});

// GET /api/reviews/:matchId — 매치의 리뷰 조회
app.get("/api/reviews/:matchId", requireAuth(), async (c) => {
  await ensureAllTables(c.env.DB);
  const matchId = c.req.param("matchId");
  const viewer = getUser(c);
  if (!(await isParty(c.env.DB, matchId || "", viewer))) return c.json({ error: "Match not found" }, 404);   // 2026-11-23: 남의 후기 엿보기 막음
  const result = await c.env.DB.prepare(
    "SELECT r.*, u.name as reviewer_name FROM onda_reviews r JOIN onda_users u ON u.id = r.reviewer_id WHERE r.match_id = ?"
  ).bind(matchId).all();
  return c.json({ reviews: result.results });
});

// ===== 채팅 =====

// POST /api/chat/:matchId — 메시지 전송
app.post("/api/chat/:matchId", requireAuth(), async (c) => {
  await ensureAllTables(c.env.DB);
  const user = getUser(c);
  const matchId = c.req.param("matchId");
  const { content } = await c.req.json<{ content: string }>();
  if (!content?.trim()) return c.json({ error: "content required" }, 400);

  // Verify user is part of this match
  const match = await c.env.DB.prepare(
    "SELECT m.responder_id, r.requester_id FROM onda_matches m JOIN onda_requests r ON r.id = m.request_id WHERE m.id = ?"
  ).bind(matchId).first<{ responder_id: string; requester_id: string }>();
  if (!match) return c.json({ error: "Match not found" }, 404);
  if (user.id !== match.responder_id && user.id !== match.requester_id && user.role !== 'admin') {
    return c.json({ error: "Match not found" }, 404);
  }

  await c.env.DB.prepare(
    "INSERT INTO onda_messages (match_id, sender_id, content) VALUES (?, ?, ?)"
  ).bind(matchId, user.id, content.trim().slice(0, 500)).run();

  return c.json({ ok: true });
});

// GET /api/chat/:matchId — 메시지 목록 (폴링)
app.get("/api/chat/:matchId", requireAuth(), async (c) => {
  await ensureAllTables(c.env.DB);
  const user = getUser(c);
  const matchId = c.req.param("matchId");
  const after = c.req.query("after") || "0"; // message ID cursor
  if (!(await isParty(c.env.DB, matchId || "", user))) return c.json({ error: "Match not found" }, 404);   // 2026-11-23: 남의 채팅 엿보기 막음

  const result = await c.env.DB.prepare(
    `SELECT m.id, m.sender_id, m.content, m.created_at, u.name as sender_name
     FROM onda_messages m JOIN onda_users u ON u.id = m.sender_id
     WHERE m.match_id = ? AND m.id > ?
     ORDER BY m.id ASC LIMIT 50`
  ).bind(matchId, parseInt(after)).all();

  return c.json({ messages: result.results });
});

// ===== 민원 접수 =====
app.post("/api/complaints", requireAuth(), async (c) => {
  await ensureAllTables(c.env.DB);
  const user = getUser(c);
  const body = await c.req.json<{ requestId?: string; matchId?: string; targetId: string; reason: string; detail?: string }>();
  if (!body.targetId || !body.reason) return c.json({ error: "targetId and reason required" }, 400);
  // 2026-11-23: 민원은 함께한 출동의 상대방에게만 (전에는 아무나 아무에게 — 2건이면 자동 정지되어 악용 가능)
  if (!body.matchId) return c.json({ error: "matchId required" }, 400);
  const cm = await c.env.DB.prepare("SELECT m.responder_id, r.requester_id FROM onda_matches m JOIN onda_requests r ON r.id = m.request_id WHERE m.id = ?")
    .bind(body.matchId).first<{ responder_id: string; requester_id: string }>();
  const pair = cm && ((cm.requester_id === user.id && cm.responder_id === body.targetId) || (cm.responder_id === user.id && cm.requester_id === body.targetId));
  if (!pair) return c.json({ error: "Match not found" }, 404);
  const dup = await c.env.DB.prepare("SELECT 1 FROM onda_complaints WHERE match_id = ? AND reporter_id = ?").bind(body.matchId, user.id).first();
  if (dup) return c.json({ error: "Already reported" }, 409);

  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    "INSERT INTO onda_complaints (id, request_id, match_id, reporter_id, target_id, reason, detail) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).bind(id, body.requestId || "", body.matchId || "", user.id, body.targetId, body.reason, body.detail || "").run();

  // Auto-suspend: 2+ pending/resolved complaints → suspend
  const complaintCount = await c.env.DB.prepare(
    "SELECT COUNT(DISTINCT reporter_id) as cnt FROM onda_complaints WHERE target_id = ? AND status IN ('pending','resolved')"
  ).bind(body.targetId).first<{ cnt: number }>();

  if (complaintCount && complaintCount.cnt >= 2) {
    try { await c.env.DB.prepare("ALTER TABLE onda_responders ADD COLUMN suspended_reason TEXT").run(); } catch {}
    await c.env.DB.prepare(
      "UPDATE onda_responders SET status = 'suspended', available = 0, suspended_reason = 'auto_complaint_2+' WHERE user_id = ?"
    ).bind(body.targetId).run();
    await c.env.DB.prepare(
      "INSERT INTO onda_notifications (user_id, type, title, body) VALUES (?, 'suspended', ?, ?)"
    ).bind(body.targetId, "Account Suspended", "Your account has been suspended due to multiple complaints. Admin will review.").run();
    // Notify admin
    await c.env.DB.prepare(
      "INSERT INTO onda_admin_logs (admin_id, action, target_type, target_id, memo) VALUES ('system', 'auto_suspend', 'responder', ?, ?)"
    ).bind(body.targetId, `complaint_count=${complaintCount.cnt}`).run();
  }

  return c.json({ ok: true, complaintId: id });
});

// GET /api/complaints/my — 내가 접수한 민원
app.get("/api/complaints/my", requireAuth(), async (c) => {
  await ensureAllTables(c.env.DB);
  const user = getUser(c);
  const result = await c.env.DB.prepare(
    "SELECT * FROM onda_complaints WHERE reporter_id = ? ORDER BY created_at DESC LIMIT 20"
  ).bind(user.id).all();
  return c.json({ complaints: result.results });
});

// ===== 출동 중 실시간 위치 공유 (요청자가 출동자 위치 조회) =====
app.get("/api/dispatch/:requestId/responder-location", requireAuth(), async (c) => {
  const requestId = c.req.param("requestId");
  // 2026-11-23: 그 요청을 한 사람·관리자만 (전에는 로그인한 누구나 출동 중 도우미 위치를 봄)
  const viewer = getUser(c);
  const own = await c.env.DB.prepare("SELECT requester_id FROM onda_requests WHERE id = ?").bind(requestId).first<{ requester_id: string }>();
  if (!own || (own.requester_id !== viewer.id && viewer.role !== "admin")) return c.json({ error: "No active match" }, 404);
  // Find active match
  const match = await c.env.DB.prepare(
    "SELECT responder_id FROM onda_matches WHERE request_id = ? AND status IN ('accepted','moving','arrived','in_progress') LIMIT 1"
  ).bind(requestId).first<{ responder_id: string }>();
  if (!match) return c.json({ error: "No active match" }, 404);

  // Get responder location from KV
  const locStr = await c.env.LOCATION_KV.get(`loc:${match.responder_id}`);
  if (!locStr) return c.json({ lat: null, lng: null, available: false });
  const [lat, lng] = locStr.split(",").map(Number);
  return c.json({ lat, lng, available: true });
});

// ===== 화상 인터뷰 일정 예약 =====
app.post("/api/responders/schedule-interview", requireAuth(), async (c) => {
  await ensureAllTables(c.env.DB);
  const user = getUser(c);
  const body = await c.req.json<{ scheduledAt: string }>();
  if (!body.scheduledAt) return c.json({ error: "scheduledAt required" }, 400);

  try { await c.env.DB.prepare("ALTER TABLE onda_responders ADD COLUMN interview_scheduled_at TEXT").run(); } catch {}
  try { await c.env.DB.prepare("ALTER TABLE onda_responders ADD COLUMN interview_status TEXT DEFAULT 'not_scheduled'").run(); } catch {}

  await c.env.DB.prepare(
    "UPDATE onda_responders SET interview_scheduled_at = ?, interview_status = 'scheduled' WHERE user_id = ?"
  ).bind(body.scheduledAt, user.id).run();

  return c.json({ ok: true, scheduledAt: body.scheduledAt });
});

/** 돌봄 값 내기 — 한 곳만, 순서대로 (2026-11-23) */
export async function payFor(db: D1Database, requestId: string, matchId: string, amount: number, memo: string): Promise<string> {
  const req = await db.prepare("SELECT requester_id, type FROM onda_requests WHERE id = ?").bind(requestId).first<{ requester_id: string; type: string }>();
  if (!req || amount <= 0) return "none";
  const setSt = (st: string) => db.prepare("UPDATE onda_settlements SET status = ? WHERE match_id = ?").bind(st, matchId).run();
  // ① 지자체: 예산이 남을 때만 (조건부 갱신으로 동시에 두 건이 넘치지 않게)
  const gov = await db.prepare(
    `SELECT b.contract_id FROM onda_gov_beneficiaries b JOIN onda_gov_contracts g ON g.id = b.contract_id
      WHERE b.user_id = ? AND b.status = 'active' AND g.status = 'active' LIMIT 1`).bind(req.requester_id).first<{ contract_id: string }>();
  if (gov) {
    const r = await db.prepare("UPDATE onda_gov_contracts SET spent = spent + ?, used_requests_month = used_requests_month + 1 WHERE id = ? AND spent + ? <= budget")
      .bind(amount, gov.contract_id, amount).run();
    if (r.meta.changes) { await setSt("gov_covered"); return "gov"; }
  }
  // ② 후원사
  const sp = await db.prepare(
    `SELECT id FROM onda_sponsors WHERE status = 'active' AND (',' || target_types || ',') LIKE ? AND spent + ? <= budget ORDER BY spent ASC LIMIT 1`
  ).bind(`%,${req.type},%`, amount).first<{ id: string }>();
  if (sp) {
    const r = await db.prepare("UPDATE onda_sponsors SET spent = spent + ? WHERE id = ? AND spent + ? <= budget").bind(amount, sp.id, amount).run();
    if (r.meta.changes) {
      await db.prepare("INSERT INTO onda_sponsor_usage (id, sponsor_id, request_id, match_id, amount) VALUES (?, ?, ?, ?, ?)")
        .bind(crypto.randomUUID(), sp.id, requestId, matchId, amount).run();
      await setSt("sponsor_covered"); return "sponsor";
    }
  }
  // ③ 지갑 (잔액이 될 때만, 조건부 차감)
  const w = await db.prepare("UPDATE onda_wallets SET balance = balance - ?, updated_at = datetime('now') WHERE user_id = ? AND balance >= ?")
    .bind(amount, req.requester_id, amount).run();
  if (w.meta.changes) {
    await db.prepare("INSERT INTO onda_wallet_transactions (id, user_id, type, amount, match_id, memo) VALUES (?, ?, 'deduct', ?, ?, ?)")
      .bind(crypto.randomUUID(), req.requester_id, -amount, matchId, memo).run();
    await setSt("wallet_paid");
    const bal = await db.prepare("SELECT balance FROM onda_wallets WHERE user_id = ?").bind(req.requester_id).first<{ balance: number }>();
    if (bal && bal.balance <= 10000)
      await db.prepare("INSERT INTO onda_notifications (user_id, type, title, body) VALUES (?, 'low_balance', ?, ?)")
        .bind(req.requester_id, "Low Balance", `Balance: ${bal.balance.toLocaleString()}. Please recharge.`).run();
    return "wallet";
  }
  // ④ 미수
  await setSt("unpaid");
  await db.prepare("INSERT INTO onda_notifications (user_id, type, title, body) VALUES (?, 'unpaid', ?, ?)")
    .bind(req.requester_id, "Payment needed", `${amount.toLocaleString()} care fee is unpaid. Please recharge your wallet.`).run();
  await db.prepare("INSERT INTO onda_admin_logs (admin_id, action, target_type, target_id, memo) VALUES ('system', 'unpaid', 'match', ?, ?)").bind(matchId, String(amount)).run();
  return "unpaid";
}

export { app as responderRoutes };
