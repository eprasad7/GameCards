import { Hono } from "hono";
import type { Env, EvaluateRequest, EvaluateResponse } from "../types";
import { buildPricingContext, optimizePrice } from "../services/pricing-optimizer";

export const evaluateRoutes = new Hono<{ Bindings: Env }>();

// Retail economics constants (Section 3.5 of spec)
const MARKETPLACE_FEE_PCT = 0.13;
const SHIPPING_COST = 5.0;
const RETURN_RATE = 0.03;
const REQUIRED_MARGIN = 0.20;

function computeNrv(fairValue: number): number {
  const gross = fairValue * (1 - MARKETPLACE_FEE_PCT);
  const netAfterReturns = gross * (1 - RETURN_RATE);
  return netAfterReturns - SHIPPING_COST;
}

interface EvaluatedCard extends EvaluateResponse {
  card_id: string;
  card_name: string;
  offered_price: number;
  grade: string;
  grading_company: string;
  max_buy_price: number;
  sell_threshold: number | null;
}

function invalidRequest(message: string): never {
  const error = new Error(message) as Error & { status: number };
  error.status = 400;
  throw error;
}

function notFound(message: string): never {
  const error = new Error(message) as Error & { status: number };
  error.status = 404;
  throw error;
}

async function evaluateCard(env: Env, body: EvaluateRequest): Promise<EvaluatedCard> {
  const { card_id, offered_price, grade = "RAW", grading_company = "RAW" } = body;

  if (!card_id || offered_price == null || typeof offered_price !== "number" || offered_price <= 0) {
    invalidRequest("card_id and a positive offered_price are required");
  }

  const card = await env.DB.prepare(`SELECT name FROM card_catalog WHERE id = ?`).bind(card_id).first();
  if (!card) {
    notFound("Card not found");
  }

  const prediction = await env.DB.prepare(
    `SELECT * FROM model_predictions
     WHERE card_id = ? AND grade = ? AND grading_company = ?
     ORDER BY predicted_at DESC LIMIT 1`
  )
    .bind(card_id, grade, grading_company)
    .first();

  if (!prediction) {
    const recentSales = await env.DB.prepare(
      `SELECT AVG(price_usd) as avg_price, COUNT(*) as count
       FROM price_observations
       WHERE card_id = ? AND grading_company = ? AND grade = ?
         AND sale_date >= date('now', '-90 days')
         AND is_anomaly = 0`
    )
      .bind(card_id, grading_company, grade)
      .first();

    if (!recentSales || (recentSales.count as number) === 0) {
      notFound("Insufficient data to evaluate this card");
    }

    const avgPrice = recentSales.avg_price as number;
    const nrv = computeNrv(avgPrice);
    const maxBuyPrice = nrv * (1 - REQUIRED_MARGIN);
    const nrvMargin = offered_price < nrv
      ? ((nrv - offered_price) / nrv) * 100
      : ((offered_price - nrv) / nrv) * -100;

    return {
      card_id,
      card_name: card.name as string,
      offered_price,
      grade,
      grading_company,
      decision: offered_price < maxBuyPrice ? "REVIEW_BUY" : offered_price < nrv ? "FAIR_VALUE" : "SELL_SIGNAL",
      fair_value: Math.round(avgPrice * 100) / 100,
      margin: Math.round(nrvMargin * 100) / 100,
      confidence: "LOW",
      reasoning: `Based on ${recentSales.count} sales in last 90 days (no ML model). Fair value: $${avgPrice.toFixed(2)}, NRV: $${nrv.toFixed(2)}, max buy: $${maxBuyPrice.toFixed(2)}.`,
      max_buy_price: Math.round(maxBuyPrice * 100) / 100,
      sell_threshold: null,
    };
  }

  // Use the STORED sell_threshold from model_predictions, not raw p90
  const fairValue = prediction.fair_value as number;
  const sellThreshold = prediction.sell_threshold as number;
  const confidence = prediction.confidence as "HIGH" | "MEDIUM" | "LOW";
  const volumeBucket = prediction.volume_bucket as string;

  const nrv = computeNrv(fairValue);
  const maxBuyPrice = nrv * (1 - REQUIRED_MARGIN);
  const nrvMargin = offered_price < nrv
    ? ((nrv - offered_price) / nrv) * 100
    : ((offered_price - nrv) / nrv) * -100;

  let decision: EvaluateResponse["decision"];
  let reasoning: string;

  if (offered_price < maxBuyPrice) {
    if (confidence !== "LOW") {
      decision = "STRONG_BUY";
      reasoning = `Price $${offered_price.toFixed(2)} is below max buy price $${maxBuyPrice.toFixed(2)} (NRV: $${nrv.toFixed(2)}, fair value: $${fairValue.toFixed(2)}). Expected ${nrvMargin.toFixed(1)}% net margin. ${confidence} confidence, ${volumeBucket} volume.`;
    } else {
      decision = "REVIEW_BUY";
      reasoning = `Price below max buy price but LOW confidence (${volumeBucket} volume). NRV: $${nrv.toFixed(2)}, max buy: $${maxBuyPrice.toFixed(2)}. Human review recommended.`;
    }
  } else if (offered_price > sellThreshold) {
    decision = "SELL_SIGNAL";
    reasoning = `Price $${offered_price.toFixed(2)} exceeds sell threshold $${sellThreshold.toFixed(2)}. Consider selling. NRV at fair value: $${nrv.toFixed(2)}.`;
  } else if (offered_price > nrv) {
    decision = "FAIR_VALUE";
    reasoning = `Price $${offered_price.toFixed(2)} exceeds NRV $${nrv.toFixed(2)} — buying would not meet ${REQUIRED_MARGIN * 100}% margin target.`;
  } else {
    decision = "FAIR_VALUE";
    reasoning = `Price $${offered_price.toFixed(2)} is between max buy $${maxBuyPrice.toFixed(2)} and NRV $${nrv.toFixed(2)}. Margin of ${nrvMargin.toFixed(1)}% is below ${REQUIRED_MARGIN * 100}% target.`;
  }

  return {
    card_id,
    card_name: card.name as string,
    offered_price,
    grade,
    grading_company,
    decision,
    fair_value: Math.round(fairValue * 100) / 100,
    margin: Math.round(nrvMargin * 100) / 100,
    confidence,
    reasoning,
    max_buy_price: Math.round(maxBuyPrice * 100) / 100,
    sell_threshold: Math.round(sellThreshold * 100) / 100,
  };
}

evaluateRoutes.post("/", async (c) => {
  let body: EvaluateRequest;
  try {
    body = await c.req.json<EvaluateRequest>();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  try {
    const result = await evaluateCard(c.env, body);
    const { decision, fair_value, margin, confidence, reasoning } = result;
    return c.json<EvaluateResponse>({
      decision,
      fair_value,
      margin,
      confidence,
      reasoning,
    });
  } catch (error) {
    const status = (error as { status?: number }).status || 500;
    return c.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: status as 400 | 404 | 500 }
    );
  }
});

// POST /v1/evaluate/batch — evaluate a lot of cards in one request
evaluateRoutes.post("/batch", async (c) => {
  let body: { items: EvaluateRequest[] };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const items = body.items || [];
  if (!Array.isArray(items) || items.length === 0 || items.length > 200) {
    return c.json({ error: "items must be an array with 1-200 rows" }, 400);
  }

  const results = [];
  for (const item of items) {
    try {
      results.push(await evaluateCard(c.env, item));
    } catch (error) {
      results.push({
        card_id: item.card_id,
        grade: item.grade || "RAW",
        grading_company: item.grading_company || "RAW",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return c.json({ results });
});

// POST /v1/evaluate/save — save a recommendation for later review
evaluateRoutes.post("/save", async (c) => {
  let body: {
    card_id: string;
    grade?: string;
    grading_company?: string;
    decision: string;
    offered_price: number;
    fair_value: number;
    margin: number;
    confidence: string;
    channel?: string;
    notes?: string;
  };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const { card_id, grade = "RAW", grading_company = "RAW", decision, offered_price, fair_value, margin, confidence, channel, notes } = body;

  if (!card_id || !decision || offered_price == null || fair_value == null) {
    return c.json({ error: "card_id, decision, offered_price, and fair_value are required" }, 400);
  }

  const result = await c.env.DB.prepare(
    `INSERT INTO recommendations (card_id, grade, grading_company, decision, offered_price, fair_value, margin, confidence, channel, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(card_id, grade, grading_company, decision, offered_price, fair_value, margin, confidence, channel || null, notes || null)
    .run();

  return c.json({ status: "saved", id: result.meta.last_row_id });
});

// GET /v1/evaluate/recommendations — list saved recommendations
evaluateRoutes.get("/recommendations", async (c) => {
  const status = c.req.query("status") || "pending";
  const limit = Math.min(parseInt(c.req.query("limit") || "50"), 200);

  const results = await c.env.DB.prepare(
    `SELECT r.*, cc.name as card_name
     FROM recommendations r
     JOIN card_catalog cc ON cc.id = r.card_id
     WHERE r.status = ?
     ORDER BY r.created_at DESC
     LIMIT ?`
  )
    .bind(status, limit)
    .all();

  return c.json({ recommendations: results.results });
});

// POST /v1/evaluate/recommendations/:id/review — update recommendation status
evaluateRoutes.post("/recommendations/:id/review", async (c) => {
  let body: { status: "approved" | "rejected" | "expired"; reviewed_by?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  if (!["approved", "rejected", "expired"].includes(body.status)) {
    return c.json({ error: "status must be approved, rejected, or expired" }, 400);
  }

  const id = c.req.param("id");
  await c.env.DB.prepare(
    `UPDATE recommendations
     SET status = ?, reviewed_by = COALESCE(?, reviewed_by), reviewed_at = datetime('now')
     WHERE id = ?`
  )
    .bind(body.status, body.reviewed_by || null, id)
    .run();

  return c.json({ status: "updated" });
});

/**
 * POST /v1/evaluate/advanced
 *
 * Level 1 demand-aware dynamic pricing.
 * Same card, different price based on inventory, demand, competition, and events.
 *
 * This is what a store associate sees when a customer walks in with a card:
 * - Should we buy it? At what price?
 * - What should we list it at?
 * - What's the expected profit and risk?
 */
evaluateRoutes.post("/advanced", async (c) => {
  let body: { card_id: string; offered_price?: number; grade?: string; grading_company?: string; channel?: "store" | "online" | "ebay" };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }

  const { card_id, offered_price, grade = "RAW", grading_company = "RAW", channel = "store" } = body;
  if (!card_id) return c.json({ error: "card_id required" }, 400);

  // Get ML prediction
  const prediction = await c.env.DB.prepare(
    `SELECT * FROM model_predictions WHERE card_id = ? AND grade = ? AND grading_company = ? ORDER BY predicted_at DESC LIMIT 1`
  ).bind(card_id, grade, grading_company).first();

  if (!prediction) return c.json({ error: "No prediction available for this card" }, 404);

  const fairValue = prediction.fair_value as number;
  const confidence = prediction.confidence as "HIGH" | "MEDIUM" | "LOW";

  // Build full pricing context from D1
  const ctx = await buildPricingContext(c.env, card_id, grade, grading_company, fairValue, confidence, channel);

  // Run pricing optimizer
  const optimized = optimizePrice(ctx);

  // Card name
  const card = await c.env.DB.prepare(`SELECT name FROM card_catalog WHERE id = ?`).bind(card_id).first();

  // Trade-in decision (if offered_price provided)
  let tradeInDecision: string | null = null;
  let tradeInReasoning: string | null = null;
  if (offered_price != null && offered_price > 0) {
    if (optimized.holdRecommendation) {
      tradeInDecision = "HOLD";
      tradeInReasoning = optimized.holdReason;
    } else if (offered_price <= optimized.tradeInOffer) {
      tradeInDecision = optimized.riskScore === "high" ? "REVIEW_BUY" : "BUY";
      tradeInReasoning = `Offered $${offered_price.toFixed(2)} is ${offered_price < optimized.tradeInOffer ? "below" : "at"} our max offer of $${optimized.tradeInOffer.toFixed(2)}. Expected profit: $${(optimized.listPrice * (channel === "store" ? 1 : 0.87) - offered_price).toFixed(2)} in ~${optimized.expectedDaysToSell} days.`;
    } else {
      tradeInDecision = "DECLINE";
      tradeInReasoning = `Offered $${offered_price.toFixed(2)} exceeds our max offer of $${optimized.tradeInOffer.toFixed(2)}. Unprofitable at this price.`;
    }
  }

  return c.json({
    card_id,
    card_name: (card?.name as string) || card_id,
    grade,
    grading_company,
    channel,

    // ML prediction
    fair_value: fairValue,
    confidence,

    // Optimized pricing
    list_price: optimized.listPrice,
    trade_in_offer: optimized.tradeInOffer,
    adjustments: optimized.adjustments,

    // Risk
    risk_score: optimized.riskScore,
    expected_days_to_sell: optimized.expectedDaysToSell,
    expected_profit: optimized.expectedProfit,
    worst_case_exit: optimized.worstCaseExit,

    // Hold signal
    hold: optimized.holdRecommendation,
    hold_reason: optimized.holdReason,

    // Trade-in decision (if offered_price provided)
    trade_in: offered_price != null ? {
      offered_price,
      decision: tradeInDecision,
      reasoning: tradeInReasoning,
    } : null,
  });
});
