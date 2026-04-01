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

// ===== LINE OAuth =====
app.get("/api/auth/line", (c) => {
  const channelId = c.env.LINE_CHANNEL_ID;
  if (!channelId) return c.json({ error: "LINE not configured" }, 503);
  const redirectUri = `https://onda-backend.pensive-kim.workers.dev/api/auth/line/callback`;
  const state = crypto.randomUUID().slice(0, 8);
  const url = `https://access.line.me/oauth2/v2.1/authorize?response_type=code&client_id=${channelId}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}&scope=profile%20openid`;
  return c.redirect(url);
});

app.get("/api/auth/line/callback", async (c) => {
  const code = c.req.query("code");
  if (!code) return c.redirect(`${c.env.FRONTEND_URL}/login?error=missing_code`);

  const channelId = c.env.LINE_CHANNEL_ID;
  const channelSecret = c.env.LINE_CHANNEL_SECRET;
  const jwtSecret = c.env.JWT_SECRET;
  if (!channelId || !channelSecret || !jwtSecret) return c.redirect(`${c.env.FRONTEND_URL}/login?error=server_error`);

  const redirectUri = `https://onda-backend.pensive-kim.workers.dev/api/auth/line/callback`;

  // Exchange code for token
  const tokenRes = await fetch("https://api.line.me/oauth2/v2.1/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: channelId,
      client_secret: channelSecret,
    }).toString(),
  });
  if (!tokenRes.ok) return c.redirect(`${c.env.FRONTEND_URL}/login?error=auth_failed`);
  const tokenData = await tokenRes.json<{ access_token: string; id_token?: string }>();

  // Get user profile
  const profileRes = await fetch("https://api.line.me/v2/profile", {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });
  if (!profileRes.ok) return c.redirect(`${c.env.FRONTEND_URL}/login?error=auth_failed`);
  const profile = await profileRes.json<{ userId: string; displayName: string; pictureUrl?: string }>();

  const lineId = profile.userId;
  const nickname = profile.displayName || "";
  const profileImage = profile.pictureUrl || "";

  // line_id column migration
  await ensureAllTables(c.env.DB);
  try { await c.env.DB.prepare("ALTER TABLE onda_users ADD COLUMN line_id TEXT UNIQUE").run(); } catch {}

  const existing = await c.env.DB.prepare("SELECT id, role FROM onda_users WHERE line_id = ?").bind(lineId).first<{ id: string; role: string }>();

  let userId: string;
  let role: string;
  if (existing) {
    userId = existing.id;
    role = existing.role;
    await c.env.DB.prepare("UPDATE onda_users SET name = ?, profile_image = ? WHERE id = ?").bind(nickname, profileImage, userId).run();
  } else {
    userId = crypto.randomUUID();
    role = "requester";
    // Detect region by LINE (JP/TH/ID)
    const region = "JP"; // Default for LINE users — can refine later
    await c.env.DB.prepare(
      "INSERT INTO onda_users (id, line_id, name, profile_image, role, region) VALUES (?, ?, ?, ?, ?, ?)"
    ).bind(userId, lineId, nickname, profileImage, role, region).run();
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

// ===== Email + Password Login =====
app.post("/api/auth/login", async (c) => {
  await ensureAllTables(c.env.DB);
  const { email, password } = await c.req.json<{ email: string; password: string }>();
  if (!email || !password) return c.json({ error: "email and password required" }, 400);

  const user = await c.env.DB.prepare(
    "SELECT id, email, password_hash, name, role FROM onda_users WHERE email = ?"
  ).bind(email.toLowerCase().trim()).first<{ id: string; email: string; password_hash: string; name: string; role: string }>();

  if (!user || !user.password_hash) return c.json({ error: "Invalid credentials" }, 401);

  // PBKDF2 verify
  const [saltB64, hashB64] = user.password_hash.split(":");
  if (!saltB64 || !hashB64) return c.json({ error: "Invalid credentials" }, 401);
  const salt = Uint8Array.from(atob(saltB64), ch => ch.charCodeAt(0));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const hash = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" }, key, 256);
  const computedB64 = btoa(String.fromCharCode(...new Uint8Array(hash)));
  if (computedB64 !== hashB64) return c.json({ error: "Invalid credentials" }, 401);

  const now = Math.floor(Date.now() / 1000);
  const accessToken = await signToken({ sub: user.id, name: user.name, role: user.role, email: user.email, type: "access", iat: now, exp: now + 86400 }, c.env.JWT_SECRET);
  const refreshToken = await signToken({ sub: user.id, name: user.name, role: user.role, type: "refresh", iat: now, exp: now + 86400 * 30 }, c.env.JWT_SECRET);

  return c.json({ ok: true, token: accessToken, refreshToken, user: { id: user.id, name: user.name, role: user.role } });
});

// ===== Email + Password Register =====
app.post("/api/auth/register", async (c) => {
  await ensureAllTables(c.env.DB);
  const { email, password, name } = await c.req.json<{ email: string; password: string; name: string }>();
  if (!email || !password || !name) return c.json({ error: "email, password, name required" }, 400);

  // Check existing
  const existing = await c.env.DB.prepare("SELECT id FROM onda_users WHERE email = ?").bind(email.toLowerCase().trim()).first();
  if (existing) return c.json({ error: "Email already registered" }, 409);

  // Hash password (PBKDF2)
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const hash = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" }, key, 256);
  const saltB64 = btoa(String.fromCharCode(...salt));
  const hashB64 = btoa(String.fromCharCode(...new Uint8Array(hash)));
  const passwordHash = saltB64 + ":" + hashB64;

  const userId = crypto.randomUUID();
  // Add password_hash column if not exists
  try { await c.env.DB.prepare("ALTER TABLE onda_users ADD COLUMN password_hash TEXT").run(); } catch {}

  await c.env.DB.prepare(
    "INSERT INTO onda_users (id, email, name, role, password_hash) VALUES (?, ?, ?, 'admin', ?)"
  ).bind(userId, email.toLowerCase().trim(), name, passwordHash).run();

  return c.json({ ok: true, userId });
});

export { app as authRoutes };
