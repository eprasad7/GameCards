import { Hono } from "hono";
import type { Env, EvaluateRequest, EvaluateResponse } from "../types";

export const evaluateRoutes = new Hono<{ Bindings: Env }>();

// POST /v1/evaluate — evaluate a card at an offered price
evaluateRoutes.post("/", async (c) => {
  const body = await c.req.json<EvaluateRequest>();
  const { card_id, offered_price, grade = "RAW", grading_company = "RAW" } = body;

  if (!card_id || offered_price == null) {
    return c.json({ error: "card_id and offered_price are required" }, 400);
  }

  // Get latest prediction
  const prediction = await c.env.DB.prepare(
    `SELECT * FROM model_predictions
     WHERE card_id = ? AND grade = ? AND grading_company = ?
     ORDER BY predicted_at DESC LIMIT 1`
  )
    .bind(card_id, grade, grading_company)
    .first();

  if (!prediction) {
    // Fallback to recent sales average
    const recentSales = await c.env.DB.prepare(
      `SELECT AVG(price_usd) as avg_price, COUNT(*) as count
       FROM price_observations
       WHERE card_id = ? AND grading_company = ? AND grade = ?
         AND sale_date >= date('now', '-90 days')
         AND is_anomaly = 0`
    )
      .bind(card_id, grading_company, grade)
      .first();

    if (!recentSales || (recentSales.count as number) === 0) {
      return c.json({ error: "Insufficient data to evaluate this card" }, 404);
    }

    const avgPrice = recentSales.avg_price as number;
    const margin = (avgPrice - offered_price) / avgPrice;

    const response: EvaluateResponse = {
      decision: margin > 0.2 ? "REVIEW_BUY" : margin > 0 ? "FAIR_VALUE" : "SELL_SIGNAL",
      fair_value: Math.round(avgPrice * 100) / 100,
      margin: Math.round(margin * 10000) / 100,
      confidence: "LOW",
      reasoning: `Based on ${recentSales.count} sales in last 90 days (no ML model available). Average sale: $${avgPrice.toFixed(2)}.`,
    };

    return c.json(response);
  }

  const fairValue = prediction.fair_value as number;
  const buyThreshold = prediction.buy_threshold as number;
  const sellThreshold = prediction.sell_threshold as number;
  const confidence = prediction.confidence as "HIGH" | "MEDIUM" | "LOW";
  const volumeBucket = prediction.volume_bucket as string;
  const margin = (fairValue - offered_price) / fairValue;

  let decision: EvaluateResponse["decision"];
  let reasoning: string;

  if (offered_price < buyThreshold) {
    if (confidence !== "LOW") {
      decision = "STRONG_BUY";
      reasoning = `Price $${offered_price.toFixed(2)} is below p20 buy threshold ($${buyThreshold.toFixed(2)}). Fair value: $${fairValue.toFixed(2)}. ${confidence} confidence, ${volumeBucket} volume.`;
    } else {
      decision = "REVIEW_BUY";
      reasoning = `Price is below buy threshold but confidence is LOW (${volumeBucket} volume card). Recommend human review.`;
    }
  } else if (offered_price > sellThreshold) {
    decision = "SELL_SIGNAL";
    reasoning = `Price $${offered_price.toFixed(2)} exceeds p80 sell threshold ($${sellThreshold.toFixed(2)}). Consider selling at this price.`;
  } else {
    decision = "FAIR_VALUE";
    reasoning = `Price $${offered_price.toFixed(2)} is within fair value range ($${buyThreshold.toFixed(2)} - $${sellThreshold.toFixed(2)}). Fair value: $${fairValue.toFixed(2)}.`;
  }

  const response: EvaluateResponse = {
    decision,
    fair_value: Math.round(fairValue * 100) / 100,
    margin: Math.round(margin * 10000) / 100,
    confidence,
    reasoning,
  };

  return c.json(response);
});
