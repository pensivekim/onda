import { Hono } from "hono";
import type { Env } from "../types";
import { ensureAllTables } from "../utils/db";
import { signToken } from "../utils/auth";

const app = new Hono<{ Bindings: Env }>();

// ===== Kakao OAuth =====
app.get("/api/auth/kakao", (c) => {
  const clientId = c.env.KAKAO_CLIENT_ID;
  if (!clientId) return c.json({ error: "Kakao not configured" }, 503);
  const redirectUri = `https://onda-backend.pensive-kim.workers.dev/api/auth/kakao/callback`;
  const url = `https://kauth.kakao.com/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code`;
  return c.redirect(url);
});

app.get("/api/auth/kakao/callback", async (c) => {
  const code = c.req.query("code");
  if (!code) return c.redirect(`${c.env.FRONTEND_URL}/login?error=missing_code`);

  const clientId = c.env.KAKAO_CLIENT_ID;
  const clientSecret = c.env.KAKAO_CLIENT_SECRET;
  const jwtSecret = c.env.JWT_SECRET;
  if (!clientId || !jwtSecret) return c.redirect(`${c.env.FRONTEND_URL}/login?error=server_error`);

  const redirectUri = `https://onda-backend.pensive-kim.workers.dev/api/auth/kakao/callback`;

  // Exchange code for token
  const tokenRes = await fetch("https://kauth.kakao.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId,
      ...(clientSecret ? { client_secret: clientSecret } : {}),
      redirect_uri: redirectUri,
      code,
    }).toString(),
  });
  if (!tokenRes.ok) return c.redirect(`${c.env.FRONTEND_URL}/login?error=auth_failed`);
  const tokenData = await tokenRes.json<{ access_token: string }>();

  // Get user info
  const userRes = await fetch("https://kapi.kakao.com/v2/user/me", {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });
  if (!userRes.ok) return c.redirect(`${c.env.FRONTEND_URL}/login?error=auth_failed`);
  const userData = await userRes.json<{ id: number; kakao_account?: any }>();

  const kakaoId = String(userData.id);
  const account = userData.kakao_account || {};
  const nickname = account.profile?.nickname || "";
  const email = account.email || "";
  const profileImage = account.profile?.profile_image_url || "";

  await ensureAllTables(c.env.DB);
  const existing = await c.env.DB.prepare("SELECT id, role FROM onda_users WHERE kakao_id = ?").bind(kakaoId).first<{ id: string; role: string }>();

  let userId: string;
  let role: string;
  if (existing) {
    userId = existing.id;
    role = existing.role;
    await c.env.DB.prepare("UPDATE onda_users SET name = ?, email = ?, profile_image = ? WHERE id = ?").bind(nickname, email, profileImage, userId).run();
  } else {
    userId = crypto.randomUUID();
    role = "requester";
    await c.env.DB.prepare(
      "INSERT INTO onda_users (id, kakao_id, name, email, profile_image, role) VALUES (?, ?, ?, ?, ?, ?)"
    ).bind(userId, kakaoId, nickname, email, profileImage, role).run();
  }

  const now = Math.floor(Date.now() / 1000);
  const accessToken = await signToken({ sub: userId, name: nickname, role, type: "access", iat: now, exp: now + 86400 }, jwtSecret);
  const refreshToken = await signToken({ sub: userId, name: nickname, role, type: "refresh", iat: now, exp: now + 86400 * 30 }, jwtSecret);

  return c.redirect(`${c.env.FRONTEND_URL}/login?token=${accessToken}&refresh_token=${refreshToken}`);
});

// ===== Google OAuth =====
app.get("/api/auth/google", (c) => {
  const clientId = c.env.GOOGLE_CLIENT_ID;
  if (!clientId) return c.json({ error: "Google not configured" }, 503);
  const redirectUri = `https://onda-backend.pensive-kim.workers.dev/api/auth/google/callback`;
  const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent("openid email profile")}&access_type=offline&prompt=select_account`;
  return c.redirect(url);
});

app.get("/api/auth/google/callback", async (c) => {
  const code = c.req.query("code");
  if (!code) return c.redirect(`${c.env.FRONTEND_URL}/login?error=missing_code`);

  const clientId = c.env.GOOGLE_CLIENT_ID;
  const clientSecret = c.env.GOOGLE_CLIENT_SECRET;
  const jwtSecret = c.env.JWT_SECRET;
  if (!clientId || !clientSecret || !jwtSecret) return c.redirect(`${c.env.FRONTEND_URL}/login?error=server_error`);

  const redirectUri = `https://onda-backend.pensive-kim.workers.dev/api/auth/google/callback`;

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      code,
    }).toString(),
  });
  if (!tokenRes.ok) return c.redirect(`${c.env.FRONTEND_URL}/login?error=auth_failed`);
  const tokenData = await tokenRes.json<{ access_token: string }>();

  const userRes = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });
  if (!userRes.ok) return c.redirect(`${c.env.FRONTEND_URL}/login?error=auth_failed`);
  const userData = await userRes.json<{ sub: string; name?: string; email?: string; picture?: string }>();

  const googleId = userData.sub;
  const nickname = userData.name || "";
  const email = userData.email || "";
  const profileImage = userData.picture || "";

  await ensureAllTables(c.env.DB);
  const existing = await c.env.DB.prepare("SELECT id, role FROM onda_users WHERE google_id = ?").bind(googleId).first<{ id: string; role: string }>();

  let userId: string;
  let role: string;
  if (existing) {
    userId = existing.id;
    role = existing.role;
    await c.env.DB.prepare("UPDATE onda_users SET name = ?, email = ?, profile_image = ? WHERE id = ?").bind(nickname, email, profileImage, userId).run();
  } else {
    userId = crypto.randomUUID();
    role = "requester";
    await c.env.DB.prepare(
      "INSERT INTO onda_users (id, google_id, name, email, profile_image, role) VALUES (?, ?, ?, ?, ?, ?)"
    ).bind(userId, googleId, nickname, email, profileImage, role).run();
  }

  const now = Math.floor(Date.now() / 1000);
  const accessToken = await signToken({ sub: userId, name: nickname, role, type: "access", iat: now, exp: now + 86400 }, jwtSecret);
  const refreshToken = await signToken({ sub: userId, name: nickname, role, type: "refresh", iat: now, exp: now + 86400 * 30 }, jwtSecret);

  return c.redirect(`${c.env.FRONTEND_URL}/login?token=${accessToken}&refresh_token=${refreshToken}`);
});

// ===== Token Verify =====
app.post("/api/auth/verify", async (c) => {
  const { token } = await c.req.json<{ token: string }>();
  if (!token) return c.json({ error: "token required" }, 400);
  const { verifyJwt } = await import("../utils/auth");
  const payload = await verifyJwt(token, c.env.JWT_SECRET);
  if (!payload) return c.json({ valid: false }, 401);
  return c.json({ valid: true, userId: payload.sub, name: payload.name, role: payload.role });
});

// ===== Token Refresh =====
app.post("/api/auth/refresh", async (c) => {
  const { refreshToken } = await c.req.json<{ refreshToken: string }>();
  if (!refreshToken) return c.json({ error: "refreshToken required" }, 400);
  const { verifyJwt } = await import("../utils/auth");
  const payload = await verifyJwt(refreshToken, c.env.JWT_SECRET);
  if (!payload || payload.type !== "refresh") return c.json({ error: "Invalid refresh token" }, 401);

  const now = Math.floor(Date.now() / 1000);
  const newToken = await signToken(
    { sub: payload.sub, name: payload.name, role: payload.role, type: "access", iat: now, exp: now + 86400 },
    c.env.JWT_SECRET
  );
  return c.json({ token: newToken });
});

export { app as authRoutes };
