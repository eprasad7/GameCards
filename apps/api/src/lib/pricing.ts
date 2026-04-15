import type { EvaluateResponse } from "../types";

export type PricingConfidence = "HIGH" | "MEDIUM" | "LOW";
export type VolumeBucket = "high" | "medium" | "low";
export type PricingDecision = EvaluateResponse["decision"];

export const MARKETPLACE_FEE_PCT = 0.13;
export const SHIPPING_COST = 5.0;
export const RETURN_RATE = 0.03;
export const REQUIRED_MARGIN = 0.20;
export const STATISTICAL_MODEL_VERSION = "statistical-v1";

export interface StatisticalPricingResult {
  fair_value: number;
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  buy_threshold: number;
  sell_threshold: number;
  confidence: PricingConfidence;
  volume_bucket: VolumeBucket;
  model_version: string;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function computeNrv(fairValue: number): number {
  const gross = fairValue * (1 - MARKETPLACE_FEE_PCT);
  const netAfterReturns = gross * (1 - RETURN_RATE);
  return netAfterReturns - SHIPPING_COST;
}

export function computeMaxBuyPrice(fairValue: number): number {
  return computeNrv(fairValue) * (1 - REQUIRED_MARGIN);
}

export function computeMarginPct(offeredPrice: number, nrv: number): number {
  if (nrv <= 0) {
    return -100;
  }

  return offeredPrice < nrv
    ? ((nrv - offeredPrice) / nrv) * 100
    : ((offeredPrice - nrv) / nrv) * -100;
}

export function makeTradeDecision(
  offeredPrice: number,
  fairValue: number,
  sellThreshold: number,
  confidence: PricingConfidence,
): PricingDecision {
  const nrv = computeNrv(fairValue);
  const maxBuyPrice = computeMaxBuyPrice(fairValue);

  if (offeredPrice < maxBuyPrice) {
    return confidence !== "LOW" ? "STRONG_BUY" : "REVIEW_BUY";
  }
  if (offeredPrice > sellThreshold) {
    return "SELL_SIGNAL";
  }
  if (offeredPrice > nrv) {
    return "FAIR_VALUE";
  }
  return "FAIR_VALUE";
}

export function statisticalEstimation(
  features: Record<string, number | boolean | string>,
): StatisticalPricingResult {
  const volumeBucket = (features.volume_bucket as VolumeBucket) || "low";
  const avgPrice30d = (features.avg_price_30d as number) || 0;
  const avgPrice90d = (features.avg_price_90d as number) || 0;
  const volatility = (features.price_volatility_30d as number) || 0;
  const momentum = (features.price_momentum as number) || 1;

  const basePrice = avgPrice30d > 0
    ? avgPrice30d * 0.7 + avgPrice90d * 0.3
    : avgPrice90d > 0
      ? avgPrice90d
      : 0;

  if (basePrice === 0) {
    return {
      fair_value: 0,
      p10: 0,
      p25: 0,
      p50: 0,
      p75: 0,
      p90: 0,
      buy_threshold: 0,
      sell_threshold: 0,
      confidence: "LOW",
      volume_bucket: volumeBucket,
      model_version: STATISTICAL_MODEL_VERSION,
    };
  }

  const adjustedPrice = basePrice * (momentum > 0 ? momentum : 1);

  let intervalMultiplier: number;
  let confidence: PricingConfidence;

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
    buy_threshold: round2(Math.max(0, computeMaxBuyPrice(p50))),
    sell_threshold: round2(p50 * (1 + intervalMultiplier)),
    confidence,
    volume_bucket: volumeBucket,
    model_version: STATISTICAL_MODEL_VERSION,
  };
}
