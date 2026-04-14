import type { Env } from "../types";

/**
 * ML inference service.
 *
 * Strategy:
 * - Load ONNX model from R2 bucket (trained offline)
 * - Fall back to statistical estimation if no model available
 * - Volume-aware routing: different estimation strategies
 *   for high/medium/low volume cards
 */

interface PredictionResult {
  fair_value: number;
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  buy_threshold: number;
  sell_threshold: number;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  volume_bucket: "high" | "medium" | "low";
  model_version: string;
}

/**
 * Generate price predictions for a card.
 * Uses ONNX model if available, falls back to statistical estimation.
 */
export async function predictPrice(
  env: Env,
  cardId: string,
  gradingCompany: string,
  grade: string
): Promise<PredictionResult | null> {
  // Get pre-computed features
  const featureRow = await env.DB.prepare(
    `SELECT features FROM feature_store
     WHERE card_id = ? AND grade = ? AND grading_company = ?`
  )
    .bind(cardId, grade, gradingCompany)
    .first();

  if (!featureRow) return null;

  const features = JSON.parse(featureRow.features as string);

  // Try ONNX model first
  const onnxResult = await runOnnxModel(env, features);
  if (onnxResult) return onnxResult;

  // Fallback: statistical estimation based on volume bucket
  return statisticalEstimation(env, cardId, gradingCompany, grade, features);
}

/**
 * Run ONNX model inference.
 * The ONNX model is stored in R2, trained offline via the Python pipeline.
 */
async function runOnnxModel(
  env: Env,
  features: Record<string, unknown>
): Promise<PredictionResult | null> {
  try {
    // Check if model exists in R2
    const modelObj = await env.MODELS.get("models/lightgbm_quantile_latest.onnx");
    if (!modelObj) return null;

    // ONNX Runtime on Workers is available via @cloudflare/ai
    // For now, we use Workers AI with the feature vector
    // In production, use onnxruntime-web or a custom ONNX worker

    // Prepare feature vector in the order the model expects
    const featureVector = [
      features.grade_numeric || 0,
      features.pop_at_grade || 0,
      features.pop_higher || 0,
      features.pop_ratio || 0,
      features.sales_count_7d || 0,
      features.sales_count_30d || 0,
      features.sales_count_90d || 0,
      features.velocity_trend || 0,
      features.price_momentum || 0,
      features.avg_price_7d || 0,
      features.avg_price_30d || 0,
      features.avg_price_90d || 0,
      features.price_volatility_30d || 0,
      features.social_sentiment_score || 0,
      features.social_mention_count_7d || 0,
      features.month_sin || 0,
      features.month_cos || 0,
      features.is_gem_mint ? 1 : 0,
      features.is_perfect_10 ? 1 : 0,
      features.is_pop_1 ? 1 : 0,
      features.is_holiday_season ? 1 : 0,
      features.is_tax_refund_season ? 1 : 0,
    ];

    // Store feature vector metadata alongside model for versioning
    const modelMeta = await env.MODELS.get("models/lightgbm_quantile_latest.json");
    if (!modelMeta) return null;

    const meta = await modelMeta.json() as { version: string };

    // TODO: When onnxruntime-web is stable on Workers, replace this
    // with actual ONNX inference. For now, return null to use fallback.
    console.log("ONNX model found but runtime not yet configured. Feature vector:", featureVector.length, "features");
    return null;
  } catch (err) {
    console.error("ONNX inference failed:", err);
    return null;
  }
}

/**
 * Statistical fallback estimation when ONNX model is unavailable.
 * Routes to different strategies based on volume bucket.
 */
async function statisticalEstimation(
  env: Env,
  cardId: string,
  gradingCompany: string,
  grade: string,
  features: Record<string, number | boolean | string>
): Promise<PredictionResult> {
  const volumeBucket = features.volume_bucket as "high" | "medium" | "low";
  const avgPrice30d = features.avg_price_30d as number;
  const avgPrice90d = features.avg_price_90d as number;
  const volatility = features.price_volatility_30d as number;
  const momentum = features.price_momentum as number;

  // Base price: weighted average of recent prices
  const basePrice = avgPrice30d > 0
    ? avgPrice30d * 0.7 + avgPrice90d * 0.3
    : avgPrice90d > 0
      ? avgPrice90d
      : 0;

  if (basePrice === 0) {
    // No data at all — return minimal prediction
    return {
      fair_value: 0,
      p10: 0, p25: 0, p50: 0, p75: 0, p90: 0,
      buy_threshold: 0,
      sell_threshold: 0,
      confidence: "LOW",
      volume_bucket: volumeBucket,
      model_version: "statistical-v1",
    };
  }

  // Adjust for momentum
  const adjustedPrice = basePrice * (momentum > 0 ? momentum : 1);

  // Width of prediction intervals based on volume and volatility
  let intervalMultiplier: number;
  let confidence: "HIGH" | "MEDIUM" | "LOW";

  switch (volumeBucket) {
    case "high":
      intervalMultiplier = Math.max(0.10, volatility * 1.5);
      confidence = volatility < 0.15 ? "HIGH" : "MEDIUM";
      break;
    case "medium":
      intervalMultiplier = Math.max(0.20, volatility * 2.0);
      confidence = "MEDIUM";
      break;
    case "low":
    default:
      intervalMultiplier = Math.max(0.35, volatility * 3.0);
      confidence = "LOW";
      break;
  }

  const p50 = adjustedPrice;
  const p10 = p50 * (1 - intervalMultiplier * 1.5);
  const p25 = p50 * (1 - intervalMultiplier * 0.8);
  const p75 = p50 * (1 + intervalMultiplier * 0.8);
  const p90 = p50 * (1 + intervalMultiplier * 1.5);

  return {
    fair_value: round2(p50),
    p10: round2(Math.max(0, p10)),
    p25: round2(Math.max(0, p25)),
    p50: round2(p50),
    p75: round2(p75),
    p90: round2(p90),
    buy_threshold: round2(Math.max(0, p50 * (1 - intervalMultiplier))),
    sell_threshold: round2(p50 * (1 + intervalMultiplier)),
    confidence,
    volume_bucket: volumeBucket,
    model_version: "statistical-v1",
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Batch predict prices for all cards with features.
 * Called by the daily pricing generation cron.
 */
export async function batchPredict(env: Env): Promise<number> {
  const featureRows = await env.DB.prepare(
    `SELECT card_id, grade, grading_company, features FROM feature_store`
  )
    .bind()
    .all();

  let count = 0;

  for (const row of featureRows.results) {
    const cardId = row.card_id as string;
    const grade = row.grade as string;
    const gradingCompany = row.grading_company as string;

    const prediction = await predictPrice(env, cardId, gradingCompany, grade);
    if (!prediction) continue;

    await env.DB.prepare(
      `INSERT INTO model_predictions
         (card_id, grade, grading_company, model_version,
          fair_value, p10, p25, p50, p75, p90,
          buy_threshold, sell_threshold, confidence, volume_bucket)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        cardId, grade, gradingCompany, prediction.model_version,
        prediction.fair_value, prediction.p10, prediction.p25,
        prediction.p50, prediction.p75, prediction.p90,
        prediction.buy_threshold, prediction.sell_threshold,
        prediction.confidence, prediction.volume_bucket
      )
      .run();

    // Update KV cache
    await env.PRICE_CACHE.delete(`price:${cardId}:${gradingCompany}:${grade}`);

    count++;
  }

  return count;
}
