import { Hono } from "hono";
import type { Env } from "../types";
import { ensureAllTables } from "../utils/db";
import { requireAdmin } from "../utils/auth";
import { REGIONS, getRegion, formatCurrency } from "../utils/regions";

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

  // Safety stats
  const [warned, suspended, pendingComplaints, interviewPending] = await Promise.all([
    c.env.DB.prepare("SELECT COUNT(*) as cnt FROM onda_responders WHERE warning_count > 0").first<{ cnt: number }>().catch(() => ({ cnt: 0 })),
    c.env.DB.prepare("SELECT COUNT(*) as cnt FROM onda_responders WHERE status = 'suspended'").first<{ cnt: number }>().catch(() => ({ cnt: 0 })),
    c.env.DB.prepare("SELECT COUNT(*) as cnt FROM onda_complaints WHERE status = 'pending'").first<{ cnt: number }>().catch(() => ({ cnt: 0 })),
    c.env.DB.prepare("SELECT COUNT(*) as cnt FROM onda_responders WHERE interview_status = 'scheduled'").first<{ cnt: number }>().catch(() => ({ cnt: 0 })),
  ]);

  return c.json({
    totalUsers: users?.cnt || 0,
    approvedResponders: responders?.cnt || 0,
    pendingResponders: pendingResp?.cnt || 0,
    requestsToday: requestsToday?.cnt || 0,
    completedToday: matchesToday?.cnt || 0,
    warnedResponders: (warned as any)?.cnt || 0,
    suspendedResponders: (suspended as any)?.cnt || 0,
    pendingComplaints: (pendingComplaints as any)?.cnt || 0,
    interviewPending: (interviewPending as any)?.cnt || 0,
  });
});

// ===== Safety: Complaints Management =====

// GET /api/admin/complaints — 민원 목록
app.get("/api/admin/complaints", requireAdmin(), async (c) => {
  await ensureAllTables(c.env.DB);
  const status = c.req.query("status") || "pending";
  const result = await c.env.DB.prepare(
    `SELECT co.*, u1.name as reporter_name, u2.name as target_name
     FROM onda_complaints co
     LEFT JOIN onda_users u1 ON u1.id = co.reporter_id
     LEFT JOIN onda_users u2 ON u2.id = co.target_id
     WHERE co.status = ? ORDER BY co.created_at DESC LIMIT 50`
  ).bind(status).all();
  return c.json({ complaints: result.results });
});

// PATCH /api/admin/complaints/:id/resolve — 민원 처리
app.patch("/api/admin/complaints/:id/resolve", requireAdmin(), async (c) => {
  await ensureAllTables(c.env.DB);
  const id = c.req.param("id");
  const body = await c.req.json<{ action: string; memo?: string }>();
  // action: 'dismissed' (기각), 'warning' (경고), 'suspended' (정지)
  const now = new Date().toISOString();

  await c.env.DB.prepare("UPDATE onda_complaints SET status = 'resolved', resolved_at = ? WHERE id = ?").bind(now, id).run();

  const complaint = await c.env.DB.prepare("SELECT target_id FROM onda_complaints WHERE id = ?").bind(id).first<{ target_id: string }>();
  if (complaint && body.action === 'warning') {
    await c.env.DB.prepare("UPDATE onda_responders SET warning_count = warning_count + 1 WHERE user_id = ?").bind(complaint.target_id).run();
    await c.env.DB.prepare("INSERT INTO onda_notifications (user_id, type, title, body) VALUES (?, 'warning', ?, ?)")
      .bind(complaint.target_id, "Warning Issued", body.memo || "You have received a warning from admin.").run();
  }
  if (complaint && body.action === 'suspended') {
    await c.env.DB.prepare("UPDATE onda_responders SET status = 'suspended', available = 0, suspended_reason = ? WHERE user_id = ?")
      .bind(body.memo || "admin_action", complaint.target_id).run();
  }

  return c.json({ ok: true });
});

// GET /api/admin/responders/warned — 경고/정지 출동자 목록
app.get("/api/admin/responders/warned", requireAdmin(), async (c) => {
  await ensureAllTables(c.env.DB);
  const result = await c.env.DB.prepare(
    `SELECT r.*, u.name, u.phone FROM onda_responders r
     JOIN onda_users u ON u.id = r.user_id
     WHERE r.warning_count > 0 OR r.status = 'suspended'
     ORDER BY r.warning_count DESC`
  ).bind().all();
  return c.json({ responders: result.results });
});

// GET /api/admin/responders/verification-status — 검증 단계별 현황
app.get("/api/admin/responders/verification-status", requireAdmin(), async (c) => {
  await ensureAllTables(c.env.DB);
  const result = await c.env.DB.prepare(
    `SELECT r.user_id, u.name, u.phone, r.grade, r.status, r.criminal_check_agreed,
       r.sex_offender_check_agreed, r.service_oath_agreed, r.interview_status, r.interview_scheduled_at,
       r.warning_count, r.rating, r.total_done, r.created_at
     FROM onda_responders r JOIN onda_users u ON u.id = r.user_id
     ORDER BY r.created_at DESC`
  ).bind().all();
  return c.json({ responders: result.results });
});

// PATCH /api/admin/responders/:id/interview-complete — 인터뷰 완료 처리
app.patch("/api/admin/responders/:id/interview-complete", requireAdmin(), async (c) => {
  const id = c.req.param("id");
  await c.env.DB.prepare("UPDATE onda_responders SET interview_status = 'completed' WHERE user_id = ?").bind(id).run();
  return c.json({ ok: true });
});

// PATCH /api/admin/responders/:id/reinstate — 정지 해제
app.patch("/api/admin/responders/:id/reinstate", requireAdmin(), async (c) => {
  const id = c.req.param("id");
  await c.env.DB.prepare("UPDATE onda_responders SET status = 'approved', suspended_reason = NULL, warning_count = 0 WHERE user_id = ?").bind(id).run();
  return c.json({ ok: true });
});

// ===== Phase 3: 면허 검증 =====

// GET /api/admin/licenses/pending — 미검증 면허 목록
app.get("/api/admin/licenses/pending", requireAdmin(), async (c) => {
  await ensureAllTables(c.env.DB);
  const result = await c.env.DB.prepare(
    `SELECT l.*, u.name as responder_name, r.grade
     FROM onda_licenses l
     JOIN onda_users u ON u.id = l.responder_id
     JOIN onda_responders r ON r.user_id = l.responder_id
     WHERE l.verified = 0 ORDER BY l.created_at DESC`
  ).bind().all();
  return c.json({ licenses: result.results });
});

// PATCH /api/admin/licenses/:id/verify — 면허 검증 승인
app.patch("/api/admin/licenses/:id/verify", requireAdmin(), async (c) => {
  await ensureAllTables(c.env.DB);
  const id = c.req.param("id");
  const now = new Date().toISOString();
  await c.env.DB.prepare("UPDATE onda_licenses SET verified = 1, verified_at = ? WHERE id = ?").bind(now, id).run();

  // Auto-upgrade grade if all required licenses verified
  const license = await c.env.DB.prepare("SELECT responder_id, license_type FROM onda_licenses WHERE id = ?").bind(id).first<{ responder_id: string; license_type: string }>();
  if (license) {
    const medicalTypes = ['nurse', 'doctor', 'emt'];
    const professionalTypes = ['caregiver', 'social_worker', 'childcare_teacher'];
    if (medicalTypes.includes(license.license_type)) {
      await c.env.DB.prepare("UPDATE onda_responders SET grade = 'red' WHERE user_id = ?").bind(license.responder_id).run();
    } else if (professionalTypes.includes(license.license_type)) {
      await c.env.DB.prepare("UPDATE onda_responders SET grade = 'orange' WHERE user_id = ? AND grade = 'green'").bind(license.responder_id).run();
    }
  }
  return c.json({ ok: true });
});

// PATCH /api/admin/licenses/:id/reject — 면허 검증 거부
app.patch("/api/admin/licenses/:id/reject", requireAdmin(), async (c) => {
  const id = c.req.param("id");
  await c.env.DB.prepare("DELETE FROM onda_licenses WHERE id = ?").bind(id).run();
  return c.json({ ok: true });
});

// ===== Phase 3: 지자체 계약 =====

// POST /api/admin/gov-contracts — 지자체 계약 등록
app.post("/api/admin/gov-contracts", requireAdmin(), async (c) => {
  await ensureAllTables(c.env.DB);
  const body = await c.req.json<{
    govName: string; region: string; contactName?: string; contactPhone?: string;
    contactEmail?: string; budget?: number; maxRequestsMonth?: number;
    targetTypes?: string; startedAt?: string; expiresAt?: string;
  }>();
  if (!body.govName || !body.region) return c.json({ error: "govName and region required" }, 400);

  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO onda_gov_contracts (id, gov_name, region, contact_name, contact_phone, contact_email, budget, max_requests_month, target_types, started_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, body.govName, body.region, body.contactName || "", body.contactPhone || "",
    body.contactEmail || "", body.budget || 0, body.maxRequestsMonth || 100,
    body.targetTypes || "elder,disabled", body.startedAt || new Date().toISOString(), body.expiresAt || "").run();

  return c.json({ ok: true, contractId: id });
});

// GET /api/admin/gov-contracts — 지자체 계약 목록
app.get("/api/admin/gov-contracts", requireAdmin(), async (c) => {
  await ensureAllTables(c.env.DB);
  const result = await c.env.DB.prepare("SELECT * FROM onda_gov_contracts ORDER BY created_at DESC").bind().all();
  return c.json({ contracts: result.results });
});

// POST /api/admin/gov-contracts/:id/beneficiaries — 수혜자 등록
app.post("/api/admin/gov-contracts/:id/beneficiaries", requireAdmin(), async (c) => {
  await ensureAllTables(c.env.DB);
  const contractId = c.req.param("id");
  const body = await c.req.json<{ userId: string; name?: string; category?: string; address?: string; notes?: string }>();
  if (!body.userId) return c.json({ error: "userId required" }, 400);

  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    "INSERT INTO onda_gov_beneficiaries (id, contract_id, user_id, name, category, address, notes) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).bind(id, contractId, body.userId, body.name || "", body.category || "elder", body.address || "", body.notes || "").run();

  return c.json({ ok: true });
});

// GET /api/admin/gov-contracts/:id/beneficiaries — 수혜자 목록
app.get("/api/admin/gov-contracts/:id/beneficiaries", requireAdmin(), async (c) => {
  await ensureAllTables(c.env.DB);
  const contractId = c.req.param("id");
  const result = await c.env.DB.prepare(
    "SELECT b.*, u.name as user_name, u.phone FROM onda_gov_beneficiaries b LEFT JOIN onda_users u ON u.id = b.user_id WHERE b.contract_id = ?"
  ).bind(contractId).all();
  return c.json({ beneficiaries: result.results });
});

// ===== Phase 3: 기업 스폰서 =====

// POST /api/admin/sponsors — 스폰서 등록
app.post("/api/admin/sponsors", requireAdmin(), async (c) => {
  await ensureAllTables(c.env.DB);
  const body = await c.req.json<{
    companyName: string; contactName?: string; contactEmail?: string; contactPhone?: string;
    budget?: number; region?: string; targetTypes?: string; message?: string;
    startedAt?: string; expiresAt?: string;
  }>();
  if (!body.companyName) return c.json({ error: "companyName required" }, 400);

  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO onda_sponsors (id, company_name, contact_name, contact_email, contact_phone, budget, region, target_types, message, started_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, body.companyName, body.contactName || "", body.contactEmail || "",
    body.contactPhone || "", body.budget || 0, body.region || "",
    body.targetTypes || "child,elder", body.message || "",
    body.startedAt || new Date().toISOString(), body.expiresAt || "").run();

  return c.json({ ok: true, sponsorId: id });
});

// GET /api/admin/sponsors — 스폰서 목록
app.get("/api/admin/sponsors", requireAdmin(), async (c) => {
  await ensureAllTables(c.env.DB);
  const result = await c.env.DB.prepare("SELECT * FROM onda_sponsors ORDER BY created_at DESC").bind().all();
  return c.json({ sponsors: result.results });
});

// GET /api/admin/sponsors/:id/usage — 스폰서 사용 내역
app.get("/api/admin/sponsors/:id/usage", requireAdmin(), async (c) => {
  await ensureAllTables(c.env.DB);
  const sponsorId = c.req.param("id");
  const result = await c.env.DB.prepare(
    "SELECT u.*, r.address, r.type FROM onda_sponsor_usage u LEFT JOIN onda_requests r ON r.id = u.request_id WHERE u.sponsor_id = ? ORDER BY u.created_at DESC"
  ).bind(sponsorId).all();
  return c.json({ usage: result.results });
});

// ===== Phase 3: 공개 API (지자체/스폰서 현황 — 마케팅용) =====

// GET /api/public/impact — 온다 임팩트 통계 (KBS 마케팅 연동용)
app.get("/api/public/impact", async (c) => {
  await ensureAllTables(c.env.DB);
  const [totalRequests, totalCompleted, totalResponders, totalReviews, avgRating,
    govContracts, sponsors] = await Promise.all([
    c.env.DB.prepare("SELECT COUNT(*) as cnt FROM onda_requests").first<{ cnt: number }>(),
    c.env.DB.prepare("SELECT COUNT(*) as cnt FROM onda_requests WHERE status = 'completed'").first<{ cnt: number }>(),
    c.env.DB.prepare("SELECT COUNT(*) as cnt FROM onda_responders WHERE status = 'approved'").first<{ cnt: number }>(),
    c.env.DB.prepare("SELECT COUNT(*) as cnt FROM onda_reviews").first<{ cnt: number }>(),
    c.env.DB.prepare("SELECT AVG(rating) as avg FROM onda_reviews").first<{ avg: number }>(),
    c.env.DB.prepare("SELECT COUNT(*) as cnt FROM onda_gov_contracts WHERE status = 'active'").first<{ cnt: number }>(),
    c.env.DB.prepare("SELECT COUNT(*) as cnt FROM onda_sponsors WHERE status = 'active'").first<{ cnt: number }>(),
  ]);

  return c.json({
    platform: "onda.genomic.cc",
    operator: "(주)제노믹",
    stats: {
      totalRequests: totalRequests?.cnt || 0,
      completedCare: totalCompleted?.cnt || 0,
      verifiedHelpers: totalResponders?.cnt || 0,
      totalReviews: totalReviews?.cnt || 0,
      averageRating: avgRating?.avg ? Math.round(avgRating.avg * 10) / 10 : 0,
      govPartnerships: govContracts?.cnt || 0,
      corporateSponsors: sponsors?.cnt || 0,
    },
    grades: {
      green: { name: "Verified Citizen", hourlyRate: 25000 },
      orange: { name: "Professional Caregiver", hourlyRate: 40000 },
      red: { name: "Medical Professional", hourlyRate: 80000 },
    },
  });
});

// GET /api/public/regions — 활성 지역 목록 (글로벌 진입용)
app.get("/api/public/regions", (c) => {
  const regions = Object.values(REGIONS).filter(r => r.active).map(r => ({
    code: r.code, name: r.name, currency: r.currency, currencySymbol: r.currencySymbol,
    defaultLang: r.defaultLang, rates: r.rates, licenseTypes: r.licenseTypes.map(l => ({ id: l.id, name: l.name, grade: l.grade })),
    authProviders: r.authProviders,
  }));
  return c.json({ regions });
});

// GET /api/public/sponsors — 공개 스폰서 목록 (랜딩 페이지 표시용)
app.get("/api/public/sponsors", async (c) => {
  await ensureAllTables(c.env.DB);
  const result = await c.env.DB.prepare(
    "SELECT company_name, logo_url, message, region FROM onda_sponsors WHERE status = 'active' ORDER BY budget DESC LIMIT 20"
  ).bind().all();
  return c.json({ sponsors: result.results });
});

export { app as adminRoutes };
