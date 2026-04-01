import { Hono } from "hono";
import type { Env } from "../types";
import { ensureAllTables } from "../utils/db";
import { requireAuth, getUser } from "../utils/auth";
import { getRegion } from "../utils/regions";

const app = new Hono<{ Bindings: Env }>();

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

// GET /api/matches/:id — 매치 상세 (by match ID)
app.get("/api/matches/:id", requireAuth(), async (c) => {
  await ensureAllTables(c.env.DB);
  const matchId = c.req.param("id");
  const match = await c.env.DB.prepare(
    `SELECT m.*, r.address, r.description, r.type, r.urgency, u.name as requester_name
     FROM onda_matches m
     JOIN onda_requests r ON r.id = m.request_id
     LEFT JOIN onda_users u ON u.id = r.requester_id
     WHERE m.id = ?`
  ).bind(matchId).first();
  if (!match) return c.json({ error: "Match not found" }, 404);
  return c.json({ match });
});

// GET /api/matches/offered — 내게 제안된 매치 목록
app.get("/api/matches/offered", requireAuth(), async (c) => {
  await ensureAllTables(c.env.DB);
  const user = getUser(c);
  const result = await c.env.DB.prepare(
    `SELECT m.*, r.type, r.address, r.description, r.urgency, u.name as requester_name
     FROM onda_matches m
     JOIN onda_requests r ON r.id = m.request_id
     LEFT JOIN onda_users u ON u.id = r.requester_id
     WHERE m.responder_id = ? AND m.status IN ('offered','accepted','moving','arrived','in_progress')
     ORDER BY m.created_at DESC LIMIT 10`
  ).bind(user.id).all();
  return c.json({ matches: result.results });
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

  // Safe parameterized timestamp updates
  if (status === "moving") {
    await c.env.DB.prepare("UPDATE onda_matches SET status = 'moving' WHERE id = ?").bind(matchId).run();
  }
  if (status === "arrived") {
    await c.env.DB.prepare("UPDATE onda_matches SET status = 'arrived', arrived_at = ? WHERE id = ?").bind(now, matchId).run();
  }
  if (status === "in_progress") {
    await c.env.DB.prepare("UPDATE onda_matches SET status = 'in_progress', started_at = ? WHERE id = ?").bind(now, matchId).run();
  }
  if (status === "completed") {
    // Calculate duration and amount
    const startedAt = match.started_at as string;
    if (startedAt) {
      const mins = Math.max(1, Math.round((Date.now() - new Date(startedAt).getTime()) / 60000));
      const responder = await c.env.DB.prepare("SELECT grade FROM onda_responders WHERE user_id = ?").bind(user.id).first<{grade:string}>();
      const userRegion = await c.env.DB.prepare("SELECT region FROM onda_users WHERE id = ?").bind(user.id).first<{region:string}>();
      const regionConfig = getRegion(userRegion?.region || 'KR');
      const grade = responder?.grade || 'green';
      const hourlyRate = regionConfig.rates[grade as keyof typeof regionConfig.rates] || regionConfig.rates.green;
      const amount = Math.round((mins / 60) * hourlyRate);
      await c.env.DB.prepare("UPDATE onda_matches SET status = 'completed', completed_at = ?, duration_min = ?, amount = ? WHERE id = ?")
        .bind(now, mins, amount, matchId).run();

      // Create settlement
      const fee = Math.round(amount * regionConfig.feePercent / 100);
      await c.env.DB.prepare(
        "INSERT INTO onda_settlements (id, match_id, responder_id, amount, fee, net_amount) VALUES (?, ?, ?, ?, ?, ?)"
      ).bind(crypto.randomUUID(), matchId, user.id, amount, fee, amount - fee).run();

      // Auto-deduct from requester wallet
      const request = await c.env.DB.prepare("SELECT requester_id FROM onda_requests WHERE id = ?")
        .bind(match.request_id).first<{ requester_id: string }>();
      if (request) {
        const wallet = await c.env.DB.prepare("SELECT balance FROM onda_wallets WHERE user_id = ?")
          .bind(request.requester_id).first<{ balance: number }>();
        if (wallet && wallet.balance >= amount) {
          await c.env.DB.prepare("UPDATE onda_wallets SET balance = balance - ?, updated_at = datetime('now') WHERE user_id = ?")
            .bind(amount, request.requester_id).run();
          await c.env.DB.prepare(
            "INSERT INTO onda_wallet_transactions (id, user_id, type, amount, match_id, memo) VALUES (?, ?, 'deduct', ?, ?, ?)"
          ).bind(crypto.randomUUID(), request.requester_id, -amount, matchId, `care:${grade}:${mins}min`).run();
          // Mark settlement as wallet_paid
          await c.env.DB.prepare("UPDATE onda_settlements SET status = 'wallet_paid' WHERE match_id = ?").bind(matchId).run();
          // Low balance alert
          if (wallet.balance - amount <= 10000) {
            await c.env.DB.prepare(
              "INSERT INTO onda_notifications (user_id, type, title, body) VALUES (?, 'low_balance', ?, ?)"
            ).bind(request.requester_id, "Low Balance", `Balance: ${(wallet.balance - amount).toLocaleString()}. Please recharge.`).run();
          }
        }
      }
    }
    // Update request status
    await c.env.DB.prepare("UPDATE onda_requests SET status = 'completed' WHERE id = ?").bind(match.request_id).run();
    // Update responder stats
    await c.env.DB.prepare("UPDATE onda_responders SET total_done = total_done + 1 WHERE user_id = ?").bind(user.id).run();

    // Check if requester is gov beneficiary or sponsor covers cost
    const request = await c.env.DB.prepare("SELECT requester_id, type FROM onda_requests WHERE id = ?").bind(match.request_id).first<{ requester_id: string; type: string }>();
    if (request) {
      // Gov contract: check if requester is a beneficiary
      const govBen = await c.env.DB.prepare(
        `SELECT b.contract_id, g.budget, g.spent FROM onda_gov_beneficiaries b
         JOIN onda_gov_contracts g ON g.id = b.contract_id
         WHERE b.user_id = ? AND b.status = 'active' AND g.status = 'active' LIMIT 1`
      ).bind(request.requester_id).first<{ contract_id: string; budget: number; spent: number }>();
      if (govBen && govBen.spent + amount <= govBen.budget) {
        await c.env.DB.prepare("UPDATE onda_gov_contracts SET spent = spent + ?, used_requests_month = used_requests_month + 1 WHERE id = ?")
          .bind(amount, govBen.contract_id).run();
        await c.env.DB.prepare("UPDATE onda_settlements SET status = 'gov_covered' WHERE match_id = ?").bind(matchId).run();
      }

      // Sponsor: check active sponsors covering this region/type
      if (!govBen) {
        const sponsor = await c.env.DB.prepare(
          `SELECT id, budget, spent FROM onda_sponsors
           WHERE status = 'active' AND target_types LIKE ? AND spent + ? <= budget
           ORDER BY spent ASC LIMIT 1`
        ).bind(`%${request.type}%`, amount).first<{ id: string; budget: number; spent: number }>();
        if (sponsor) {
          await c.env.DB.prepare("UPDATE onda_sponsors SET spent = spent + ? WHERE id = ?").bind(amount, sponsor.id).run();
          await c.env.DB.prepare("INSERT INTO onda_sponsor_usage (id, sponsor_id, request_id, match_id, amount) VALUES (?, ?, ?, ?, ?)")
            .bind(crypto.randomUUID(), sponsor.id, match.request_id as string, matchId, amount).run();
          await c.env.DB.prepare("UPDATE onda_settlements SET status = 'sponsor_covered' WHERE match_id = ?").bind(matchId).run();
        }
      }
    } else {
      await c.env.DB.prepare("UPDATE onda_matches SET status = 'completed', completed_at = ? WHERE id = ?").bind(now, matchId).run();
    }
  }

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
    return c.json({ error: "Not part of this match" }, 403);
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

  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    "INSERT INTO onda_complaints (id, request_id, match_id, reporter_id, target_id, reason, detail) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).bind(id, body.requestId || "", body.matchId || "", user.id, body.targetId, body.reason, body.detail || "").run();

  // Auto-suspend: 2+ pending/resolved complaints → suspend
  const complaintCount = await c.env.DB.prepare(
    "SELECT COUNT(*) as cnt FROM onda_complaints WHERE target_id = ? AND status IN ('pending','resolved')"
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
  // Find active match
  const match = await c.env.DB.prepare(
    "SELECT responder_id FROM onda_matches WHERE request_id = ? AND status IN ('accepted','moving','arrived','in_progress') LIMIT 1"
  ).bind(requestId).first<{ responder_id: string }>();
  if (!match) return c.json({ error: "No active match" }, 404);

  // Get responder location from KV
  const locStr = await c.env.LOCATION_KV.get(`loc:${match.responder_id}`);
  if (!locStr) return c.json({ lat: null, lng: null, available: false });
  const [lat, lng] = locStr.split(",").map(Number);
  return c.json({ lat, lng, available: true, responderId: match.responder_id });
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

export { app as responderRoutes };
