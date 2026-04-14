import { Hono } from "hono";
import type { Env } from "../types";

/**
 * Thin REST proxy for agent @callable methods.
 *
 * Primary interaction should be via useAgent() WebSocket hooks on the dashboard.
 * These REST endpoints exist for external integrations and non-WebSocket clients.
 *
 * Agents are accessed via Durable Object stub.fetch() to their onRequest handler.
 * The @callable methods are the canonical API — these routes just wrap them.
 */
export const agentRoutes = new Hono<{ Bindings: Env }>();

async function callAgent(
  ns: DurableObjectNamespace,
  name: string,
  method: string,
  body?: unknown
): Promise<unknown> {
  const id = ns.idFromName(name);
  const stub = ns.get(id);
  const init: RequestInit = body !== undefined
    ? { method: "POST", body: JSON.stringify({ method, args: Array.isArray(body) ? body : [body] }), headers: { "Content-Type": "application/json" } }
    : { method: "POST", body: JSON.stringify({ method, args: [] }), headers: { "Content-Type": "application/json" } };
  const resp = await stub.fetch(new Request("https://agent/rpc", init));
  return resp.json();
}

// ─── Price Monitor ───
agentRoutes.get("/monitor/status", async (c) => {
  return c.json(await callAgent(c.env.PriceMonitorAgent, "default", "getStatus"));
});

agentRoutes.post("/monitor/check", async (c) => {
  return c.json(await callAgent(c.env.PriceMonitorAgent, "default", "runMonitoringCheck"));
});

// ─── Market Intelligence ───
agentRoutes.get("/intelligence/latest", async (c) => {
  const report = await callAgent(c.env.MarketIntelligenceAgent, "default", "getLatestReport");
  if (!report) return c.json({ error: "No reports yet" }, 404);
  return c.json(report);
});

agentRoutes.post("/intelligence/generate", async (c) => {
  return c.json(await callAgent(c.env.MarketIntelligenceAgent, "default", "generateDailyReport"));
});

// ─── Competitor Tracker ───
agentRoutes.get("/competitors/status", async (c) => {
  return c.json(await callAgent(c.env.CompetitorTrackerAgent, "default", "getStatus"));
});

agentRoutes.get("/competitors/gaps", async (c) => {
  return c.json({ gaps: await callAgent(c.env.CompetitorTrackerAgent, "default", "getAllGaps") });
});

agentRoutes.post("/competitors/scan", async (c) => {
  return c.json(await callAgent(c.env.CompetitorTrackerAgent, "default", "scanCompetitorPrices"));
});

// ─── Pricing Recommendations ───
agentRoutes.get("/recommendations/pending", async (c) => {
  const action = c.req.query("action");
  return c.json({ recommendations: await callAgent(c.env.PricingRecommendationAgent, "default", "getPending", action ? [action] : []) });
});

agentRoutes.get("/recommendations/status", async (c) => {
  return c.json(await callAgent(c.env.PricingRecommendationAgent, "default", "getStatus"));
});

agentRoutes.post("/recommendations/generate", async (c) => {
  return c.json(await callAgent(c.env.PricingRecommendationAgent, "default", "generateRecommendations"));
});

agentRoutes.post("/recommendations/:id/approve", async (c) => {
  const recId = c.req.param("id");
  let body: { approvedBy?: string } = {};
  try { body = await c.req.json(); } catch { /* ok */ }
  const result = await callAgent(c.env.PricingRecommendationAgent, "default", "approveRecommendation", [recId, body.approvedBy || "api"]);
  if (!result) return c.json({ error: "Not found" }, 404);
  return c.json(result);
});

agentRoutes.post("/recommendations/:id/reject", async (c) => {
  const recId = c.req.param("id");
  let body: { rejectedBy?: string } = {};
  try { body = await c.req.json(); } catch { /* ok */ }
  const result = await callAgent(c.env.PricingRecommendationAgent, "default", "rejectRecommendation", [recId, body.rejectedBy || "api"]);
  if (!result) return c.json({ error: "Not found" }, 404);
  return c.json(result);
});
