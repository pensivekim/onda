import { Hono } from "hono";
import type { Env } from "../types";
import { ensureAllTables } from "../utils/db";
import { requireAuth, requireAdmin, getUser } from "../utils/auth";

const app = new Hono<{ Bindings: Env }>();

const MIN_CHARGE = 50000; // 최소 충전 50,000원
const LOW_BALANCE_THRESHOLD = 10000; // 잔액 10,000원 이하 시 알림

// GET /api/wallet/balance — 내 예치금 잔액
app.get("/api/wallet/balance", requireAuth(), async (c) => {
  await ensureAllTables(c.env.DB);
  const user = getUser(c);
  const wallet = await c.env.DB.prepare(
    "SELECT balance FROM onda_wallets WHERE user_id = ?"
  ).bind(user.id).first<{ balance: number }>();

  return c.json({
    balance: wallet?.balance || 0,
    lowBalance: (wallet?.balance || 0) <= LOW_BALANCE_THRESHOLD,
    minCharge: MIN_CHARGE,
  });
});

// GET /api/wallet/transactions — 거래 내역
app.get("/api/wallet/transactions", requireAuth(), async (c) => {
  await ensureAllTables(c.env.DB);
  const user = getUser(c);
  const result = await c.env.DB.prepare(
    "SELECT * FROM onda_wallet_transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 30"
  ).bind(user.id).all();

  return c.json({ transactions: result.results });
});

// POST /api/wallet/charge — 예치금 충전 요청 (Paddle 승인 전: 수동 충전 / 승인 후: Paddle 연동)
app.post("/api/wallet/charge", requireAuth(), async (c) => {
  await ensureAllTables(c.env.DB);
  const user = getUser(c);
  const body = await c.req.json<{ amount: number; method?: string }>();

  if (!body.amount || body.amount < MIN_CHARGE) {
    return c.json({ error: `Minimum charge is ${MIN_CHARGE.toLocaleString()} KRW` }, 400);
  }

  // Create pending charge transaction
  const txnId = crypto.randomUUID();
  await c.env.DB.prepare(
    "INSERT INTO onda_wallet_transactions (id, user_id, type, amount, memo) VALUES (?, ?, 'charge_pending', ?, ?)"
  ).bind(txnId, user.id, body.amount, body.method || "bank_transfer").run();

  // TODO: When Paddle KYB approved, create Paddle checkout here instead
  // For now, return pending status for admin manual confirmation
  return c.json({
    ok: true,
    txnId,
    amount: body.amount,
    status: "pending",
    message: "Bank transfer to confirm. Admin will activate after verification.",
    bankInfo: {
      bank: "IBK기업은행",
      account: "301-088188-01-011",
      holder: "(주)제노믹",
    },
  });
});

// POST /api/wallet/deduct — 돌봄 완료 시 자동 차감 (내부 호출용)
app.post("/api/wallet/deduct", async (c) => {
  await ensureAllTables(c.env.DB);
  const body = await c.req.json<{ userId: string; amount: number; matchId: string; memo?: string }>();
  if (!body.userId || !body.amount || !body.matchId) return c.json({ error: "userId, amount, matchId required" }, 400);

  // Check balance
  const wallet = await c.env.DB.prepare("SELECT balance FROM onda_wallets WHERE user_id = ?")
    .bind(body.userId).first<{ balance: number }>();
  const balance = wallet?.balance || 0;

  if (balance < body.amount) {
    return c.json({ ok: false, error: "Insufficient balance", balance, required: body.amount });
  }

  // Deduct
  await c.env.DB.prepare("UPDATE onda_wallets SET balance = balance - ?, updated_at = datetime('now') WHERE user_id = ?")
    .bind(body.amount, body.userId).run();

  // Record transaction
  const txnId = crypto.randomUUID();
  await c.env.DB.prepare(
    "INSERT INTO onda_wallet_transactions (id, user_id, type, amount, match_id, memo) VALUES (?, ?, 'deduct', ?, ?, ?)"
  ).bind(txnId, body.userId, -body.amount, body.matchId, body.memo || "care_payment").run();

  const newBalance = balance - body.amount;

  // Low balance alert
  if (newBalance <= LOW_BALANCE_THRESHOLD) {
    await c.env.DB.prepare(
      "INSERT INTO onda_notifications (user_id, type, title, body) VALUES (?, 'low_balance', ?, ?)"
    ).bind(body.userId, "잔액 부족 알림", `예치금 잔액이 ${newBalance.toLocaleString()}원입니다. 충전해주세요.`).run();
  }

  return c.json({ ok: true, balance: newBalance });
});

// ===== Admin: 수동 충전 승인 =====
app.patch("/api/admin/wallet/approve-charge/:txnId", requireAdmin(), async (c) => {
  await ensureAllTables(c.env.DB);
  const txnId = c.req.param("txnId");

  const txn = await c.env.DB.prepare(
    "SELECT user_id, amount FROM onda_wallet_transactions WHERE id = ? AND type = 'charge_pending'"
  ).bind(txnId).first<{ user_id: string; amount: number }>();
  if (!txn) return c.json({ error: "Pending charge not found" }, 404);

  // Update transaction type
  await c.env.DB.prepare("UPDATE onda_wallet_transactions SET type = 'charge' WHERE id = ?").bind(txnId).run();

  // Upsert wallet balance
  await c.env.DB.prepare(
    "INSERT INTO onda_wallets (user_id, balance, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(user_id) DO UPDATE SET balance = balance + ?, updated_at = datetime('now')"
  ).bind(txn.user_id, txn.amount, txn.amount).run();

  // Notify user
  await c.env.DB.prepare(
    "INSERT INTO onda_notifications (user_id, type, title, body) VALUES (?, 'charge_complete', ?, ?)"
  ).bind(txn.user_id, "충전 완료", `${txn.amount.toLocaleString()}원이 충전되었습니다.`).run();

  return c.json({ ok: true, userId: txn.user_id, charged: txn.amount });
});

// ===== Admin: 지자체/스폰서 예치금 대납 =====
app.post("/api/admin/wallet/gov-deposit", requireAdmin(), async (c) => {
  await ensureAllTables(c.env.DB);
  const body = await c.req.json<{ userId: string; amount: number; contractId: string; memo?: string }>();
  if (!body.userId || !body.amount) return c.json({ error: "userId and amount required" }, 400);

  // Upsert wallet
  await c.env.DB.prepare(
    "INSERT INTO onda_wallets (user_id, balance, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(user_id) DO UPDATE SET balance = balance + ?, updated_at = datetime('now')"
  ).bind(body.userId, body.amount, body.amount).run();

  // Record transaction
  await c.env.DB.prepare(
    "INSERT INTO onda_wallet_transactions (id, user_id, type, amount, memo) VALUES (?, ?, 'gov_deposit', ?, ?)"
  ).bind(crypto.randomUUID(), body.userId, body.amount, body.memo || `gov_contract:${body.contractId}`).run();

  // Update gov contract spent
  if (body.contractId) {
    await c.env.DB.prepare("UPDATE onda_gov_contracts SET spent = spent + ? WHERE id = ?").bind(body.amount, body.contractId).run();
  }

  return c.json({ ok: true });
});

app.post("/api/admin/wallet/sponsor-deposit", requireAdmin(), async (c) => {
  await ensureAllTables(c.env.DB);
  const body = await c.req.json<{ userId: string; amount: number; sponsorId: string; memo?: string }>();
  if (!body.userId || !body.amount) return c.json({ error: "userId and amount required" }, 400);

  await c.env.DB.prepare(
    "INSERT INTO onda_wallets (user_id, balance, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(user_id) DO UPDATE SET balance = balance + ?, updated_at = datetime('now')"
  ).bind(body.userId, body.amount, body.amount).run();

  await c.env.DB.prepare(
    "INSERT INTO onda_wallet_transactions (id, user_id, type, amount, memo) VALUES (?, ?, 'sponsor_deposit', ?, ?)"
  ).bind(crypto.randomUUID(), body.userId, body.amount, body.memo || `sponsor:${body.sponsorId}`).run();

  if (body.sponsorId) {
    await c.env.DB.prepare("UPDATE onda_sponsors SET spent = spent + ? WHERE id = ?").bind(body.amount, body.sponsorId).run();
  }

  return c.json({ ok: true });
});

// GET /api/admin/wallet/pending-charges — 충전 대기 목록
app.get("/api/admin/wallet/pending-charges", requireAdmin(), async (c) => {
  await ensureAllTables(c.env.DB);
  const result = await c.env.DB.prepare(
    `SELECT t.*, u.name as user_name, u.phone FROM onda_wallet_transactions t
     LEFT JOIN onda_users u ON u.id = t.user_id
     WHERE t.type = 'charge_pending' ORDER BY t.created_at DESC`
  ).bind().all();
  return c.json({ charges: result.results });
});

// ===== Paddle Webhook (KYB 승인 후 활성화) =====
app.post("/api/wallet/paddle-webhook", async (c) => {
  const body = await c.req.text();
  const paddleSig = c.req.header("paddle-signature") || "";
  const webhookSecret = c.env.PADDLE_WEBHOOK_SECRET;

  // Signature verification (same pattern as hi.genomic.cc)
  if (webhookSecret && paddleSig) {
    const parts = Object.fromEntries(paddleSig.split(";").map(p => { const [k, v] = p.split("="); return [k, v]; }));
    const ts = parts.ts || "";
    const h1 = parts.h1 || "";
    const signedPayload = `${ts}:${body}`;
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey("raw", encoder.encode(webhookSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(signedPayload)));
    const computed = Array.from(sig).map(b => b.toString(16).padStart(2, '0')).join('');
    if (computed !== h1) return c.json({ error: "invalid signature" }, 401);
  }

  const event = JSON.parse(body);
  const type = event.event_type;
  const db = c.env.DB;
  await ensureAllTables(db);

  // transaction.completed → 예치금 충전 확정
  if (type === "transaction.completed") {
    const txn = event.data;
    const customData = txn.custom_data || {};
    const userId = customData.onda_user_id;
    const chargeAmount = parseInt(customData.charge_amount || "0");

    if (userId && chargeAmount > 0) {
      await db.prepare(
        "INSERT INTO onda_wallets (user_id, balance, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(user_id) DO UPDATE SET balance = balance + ?, updated_at = datetime('now')"
      ).bind(userId, chargeAmount, chargeAmount).run();

      await db.prepare(
        "INSERT INTO onda_wallet_transactions (id, user_id, type, amount, memo) VALUES (?, ?, 'charge', ?, ?)"
      ).bind(crypto.randomUUID(), userId, chargeAmount, `paddle:${txn.id}`).run();

      await db.prepare(
        "INSERT INTO onda_notifications (user_id, type, title, body) VALUES (?, 'charge_complete', ?, ?)"
      ).bind(userId, "Charge Complete", `${chargeAmount.toLocaleString()} KRW has been added to your wallet.`).run();
    }
  }

  return c.json({ received: true });
});

export { app as walletRoutes };
