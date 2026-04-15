import { Hono } from "hono";
import type { Env } from "../types";

export const authRoutes = new Hono<{ Bindings: Env }>();

/**
 * POST /v1/auth/login
 *
 * Validates the access code server-side and returns a session token.
 * The access code is stored as a secret (DEMO_ACCESS_CODE), never in client JS.
 * Session tokens expire after 24 hours.
 */
authRoutes.post("/login", async (c) => {
  let body: { code: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }

  const { code } = body;
  if (!code) {
    return c.json({ error: "Access code is required" }, 400);
  }

  // Validate against server-side secret
  const validCode = c.env.DEMO_ACCESS_CODE || "GMESTART2026";
  if (code.trim().toUpperCase() !== validCode.toUpperCase()) {
    return c.json({ error: "Invalid access code" }, 401);
  }

  // Generate a session token: base64(timestamp + random + hmac)
  const now = Date.now();
  const expiresAt = now + 24 * 60 * 60 * 1000; // 24 hours
  const random = crypto.getRandomValues(new Uint8Array(16));
  const randomHex = Array.from(random).map((b) => b.toString(16).padStart(2, "0")).join("");

  const payload = `${expiresAt}:${randomHex}`;
  const encoder = new TextEncoder();

  // Sign with API_KEY as HMAC secret
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(c.env.API_KEY),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  const sigHex = Array.from(new Uint8Array(signature)).map((b) => b.toString(16).padStart(2, "0")).join("");

  const token = btoa(`${payload}:${sigHex}`);

  // Store session in KV with expiry
  await c.env.PRICE_CACHE.put(`session:${token}`, JSON.stringify({ expiresAt }), {
    expirationTtl: 86400, // 24 hours
  });

  return c.json({
    token,
    expiresAt: new Date(expiresAt).toISOString(),
    expiresIn: 86400,
  });
});

/**
 * POST /v1/auth/verify
 *
 * Check if a session token is still valid.
 */
authRoutes.post("/verify", async (c) => {
  const token = c.req.header("X-API-Key");
  if (!token) {
    return c.json({ valid: false, error: "No token" }, 401);
  }

  const session = await c.env.PRICE_CACHE.get(`session:${token}`);
  if (!session) {
    return c.json({ valid: false, error: "Session expired or invalid" }, 401);
  }

  const { expiresAt } = JSON.parse(session);
  if (Date.now() > expiresAt) {
    await c.env.PRICE_CACHE.delete(`session:${token}`);
    return c.json({ valid: false, error: "Session expired" }, 401);
  }

  return c.json({ valid: true, expiresAt: new Date(expiresAt).toISOString() });
});

/**
 * POST /v1/auth/logout
 */
authRoutes.post("/logout", async (c) => {
  const token = c.req.header("X-API-Key");
  if (token) {
    await c.env.PRICE_CACHE.delete(`session:${token}`);
  }
  return c.json({ status: "logged_out" });
});
