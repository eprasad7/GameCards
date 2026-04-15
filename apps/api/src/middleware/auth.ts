import { createMiddleware } from "hono/factory";
import type { Env } from "../types";
import { secureCompareStrings } from "../lib/security";

/**
 * API authentication middleware.
 *
 * Accepts two auth methods via X-API-Key header:
 * 1. Static API key (for programmatic/server-to-server access)
 * 2. Session token from /v1/auth/login (for dashboard users)
 *
 * Auth routes (/v1/auth/*) are exempt — login must be accessible.
 */
export const apiKeyAuth = createMiddleware<{ Bindings: Env }>(async (c, next) => {
  // Skip auth for health check, CORS preflight, and auth routes
  if (c.req.path === "/" || c.req.method === "OPTIONS") {
    return next();
  }

  // Auth routes are public (login, verify)
  if (c.req.path.startsWith("/v1/auth/")) {
    return next();
  }

  // In development, allow unauthenticated access
  if (c.env.ENVIRONMENT === "development") {
    return next();
  }

  const token = c.req.header("X-API-Key");
  if (!token) {
    return c.json({ error: "Missing X-API-Key header" }, 401);
  }

  // Check 1: Is it the static API key? (server-to-server)
  const isStaticKey = await secureCompareStrings(token, c.env.API_KEY);
  if (isStaticKey) {
    return next();
  }

  // Check 2: Is it a valid session token? (dashboard users)
  const session = await c.env.PRICE_CACHE.get(`session:${token}`);
  if (session) {
    const { expiresAt } = JSON.parse(session) as { expiresAt: number };
    if (Date.now() <= expiresAt) {
      return next();
    }
    // Expired — clean up
    await c.env.PRICE_CACHE.delete(`session:${token}`);
  }

  return c.json({ error: "Invalid or expired credentials" }, 403);
});

/**
 * Rate limiting middleware using KV.
 */
const MAX_REQUESTS_PER_MINUTE = 120;

export const rateLimiter = createMiddleware<{ Bindings: Env }>(async (c, next) => {
  if (c.req.path === "/" || c.req.method === "OPTIONS" || c.req.path.startsWith("/v1/auth/")) {
    return next();
  }

  if (c.env.ENVIRONMENT === "development") {
    return next();
  }

  const apiKey = c.req.header("X-API-Key") || "anonymous";
  const minute = Math.floor(Date.now() / 60000);
  const rateLimitKey = `ratelimit:${apiKey}:${minute}`;

  const current = await c.env.PRICE_CACHE.get(rateLimitKey);
  const count = current ? parseInt(current, 10) : 0;

  if (count >= MAX_REQUESTS_PER_MINUTE) {
    return c.json({ error: "Rate limit exceeded. Maximum 120 requests per minute." }, 429);
  }

  await c.env.PRICE_CACHE.put(rateLimitKey, String(count + 1), { expirationTtl: 120 });

  c.header("X-RateLimit-Limit", String(MAX_REQUESTS_PER_MINUTE));
  c.header("X-RateLimit-Remaining", String(MAX_REQUESTS_PER_MINUTE - count - 1));

  return next();
});
