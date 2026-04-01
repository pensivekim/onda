import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env } from "./types";
import { authRoutes } from "./routes/authRoutes";
import { requestRoutes } from "./routes/requestRoutes";
import { responderRoutes } from "./routes/responderRoutes";
import { matchRoutes } from "./routes/matchRoutes";
import { adminRoutes } from "./routes/adminRoutes";

const app = new Hono<{ Bindings: Env }>();

// CORS
app.use("*", cors({
  origin: ["https://onda.genomic.cc", "http://localhost:5173", "http://localhost:3000"],
  allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization"],
}));

// Error handler
app.onError((err, c) => {
  if (err.message?.includes("JSON") || err.message?.includes("Unexpected")) {
    return c.json({ error: "Invalid JSON" }, 400);
  }
  console.error("Error:", err.message);
  return c.json({ error: "Internal server error" }, 500);
});

// Routes
app.route("/", authRoutes);
app.route("/", requestRoutes);
app.route("/", responderRoutes);
app.route("/", matchRoutes);
app.route("/", adminRoutes);

// Health
app.get("/health", (c) => c.json({ status: "ok", service: "onda-backend", timestamp: new Date().toISOString() }));

export default { fetch: app.fetch };
