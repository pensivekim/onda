import { sign, verify } from "hono/jwt";
import type { Context, Next } from "hono";
import type { Env } from "../types";

export async function signToken(
  payload: Record<string, unknown>,
  secret: string
): Promise<string> {
  return sign(payload, secret, "HS256");
}

export async function verifyJwt(
  token: string,
  secret: string
): Promise<Record<string, unknown> | null> {
  try {
    return (await verify(token, secret, "HS256")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export interface AuthUser {
  id: string;
  name: string;
  role: string;
}

// Middleware: extract user from JWT
export function requireAuth() {
  return async (c: Context<{ Bindings: Env }>, next: Next) => {
    const header = c.req.header("Authorization") || "";
    const token = header.replace("Bearer ", "");
    if (!token) return c.json({ error: "Authentication required" }, 401);

    const payload = await verifyJwt(token, c.env.JWT_SECRET);
    if (!payload || !payload.sub) return c.json({ error: "Invalid token" }, 401);

    (c as any).set("user", {
      id: payload.sub as string,
      name: (payload.name as string) || "",
      role: (payload.role as string) || "requester",
    });
    return next();
  };
}

// Middleware: admin only
export function requireAdmin() {
  return async (c: Context<{ Bindings: Env }>, next: Next) => {
    const header = c.req.header("Authorization") || "";
    const token = header.replace("Bearer ", "");
    if (!token) return c.json({ error: "Authentication required" }, 401);

    const payload = await verifyJwt(token, c.env.JWT_SECRET);
    if (!payload || !payload.sub) return c.json({ error: "Invalid token" }, 401);
    if (payload.role !== "admin") return c.json({ error: "Admin only" }, 403);

    (c as any).set("user", {
      id: payload.sub as string,
      name: (payload.name as string) || "",
      role: "admin",
    });
    return next();
  };
}

export function getUser(c: Context): AuthUser {
  return (c as any).get("user");
}
