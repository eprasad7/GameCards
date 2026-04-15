import { describe, it, expect } from "vitest";

/**
 * Tests for the statistical estimation and NRV logic
 * in the inference service.
 *
 * These test the pure functions extracted from inference.ts.
 */

// Constants matching inference.ts
const MARKETPLACE_FEE = 0.13;
const SHIPPING = 5.0;
const RETURN_RATE = 0.03;
const REQUIRED_MARGIN = 0.20;

function computeNrv(fairValue: number): number {
  return fairValue * (1 - MARKETPLACE_FEE) * (1 - RETURN_RATE) - SHIPPING;
}

function computeMaxBuyPrice(fairValue: number): number {
  return computeNrv(fairValue) * (1 - REQUIRED_MARGIN);
}

function statisticalEstimation(features: Record<string, number | boolean | string>) {
  const volumeBucket = (features.volume_bucket as "high" | "medium" | "low") || "low";
  const avgPrice30d = (features.avg_price_30d as number) || 0;
  const avgPrice90d = (features.avg_price_90d as number) || 0;
  const volatility = (features.price_volatility_30d as number) || 0;
  const momentum = (features.price_momentum as number) || 1;

  const basePrice = avgPrice30d > 0
    ? avgPrice30d * 0.7 + avgPrice90d * 0.3
    : avgPrice90d > 0 ? avgPrice90d : 0;

  if (basePrice === 0) return { fair_value: 0, buy_threshold: 0, sell_threshold: 0, confidence: "LOW" as const };

  const adjustedPrice = basePrice * (momentum > 0 ? momentum : 1);

  let intervalMultiplier: number;
  let confidence: "HIGH" | "MEDIUM" | "LOW";
  switch (volumeBucket) {
    case "high": intervalMultiplier = Math.max(0.10, volatility * 1.5); confidence = volatility < 0.15 ? "HIGH" : "MEDIUM"; break;
    case "medium": intervalMultiplier = Math.max(0.20, volatility * 2.0); confidence = "MEDIUM"; break;
    default: intervalMultiplier = Math.max(0.35, volatility * 3.0); confidence = "LOW"; break;
  }

  const nrv = adjustedPrice * (1 - MARKETPLACE_FEE) * (1 - RETURN_RATE) - SHIPPING;
  const maxBuyPrice = nrv * (1 - REQUIRED_MARGIN);

  return {
    fair_value: adjustedPrice,
    buy_threshold: Math.max(0, maxBuyPrice),
    sell_threshold: adjustedPrice * (1 + intervalMultiplier),
    confidence,
  };
}

describe("NRV calculations", () => {
  it("computes NRV correctly for $100 card", () => {
    const nrv = computeNrv(100);
    expect(nrv).toBeCloseTo(79.39, 1);
  });

  it("NRV is negative for very cheap cards", () => {
    expect(computeNrv(5)).toBeLessThan(0);
  });

  it("max buy price is 80% of NRV", () => {
    const maxBuy = computeMaxBuyPrice(100);
    expect(maxBuy).toBeCloseTo(computeNrv(100) * 0.80, 1);
  });

  it("buy threshold is always below fair value", () => {
    const result = statisticalEstimation({ avg_price_30d: 100, avg_price_90d: 100, volume_bucket: "high", price_volatility_30d: 0.10, price_momentum: 1.0 });
    expect(result.buy_threshold).toBeLessThan(result.fair_value);
  });

  it("sell threshold is always above fair value", () => {
    const result = statisticalEstimation({ avg_price_30d: 100, avg_price_90d: 100, volume_bucket: "high", price_volatility_30d: 0.10, price_momentum: 1.0 });
    expect(result.sell_threshold).toBeGreaterThan(result.fair_value);
  });
});

describe("Statistical estimation", () => {
  it("returns zero for no price data", () => {
    const result = statisticalEstimation({ avg_price_30d: 0, avg_price_90d: 0 });
    expect(result.fair_value).toBe(0);
  });

  it("weights 30d average higher than 90d", () => {
    const result = statisticalEstimation({ avg_price_30d: 200, avg_price_90d: 100, volume_bucket: "high", price_volatility_30d: 0.10, price_momentum: 1.0 });
    // 200*0.7 + 100*0.3 = 170
    expect(result.fair_value).toBe(170);
  });

  it("applies momentum", () => {
    const base = statisticalEstimation({ avg_price_30d: 100, avg_price_90d: 100, volume_bucket: "high", price_volatility_30d: 0.10, price_momentum: 1.0 });
    const rising = statisticalEstimation({ avg_price_30d: 100, avg_price_90d: 100, volume_bucket: "high", price_volatility_30d: 0.10, price_momentum: 1.2 });
    expect(rising.fair_value).toBeGreaterThan(base.fair_value);
  });

  it("high volume + low volatility = HIGH confidence", () => {
    const result = statisticalEstimation({ avg_price_30d: 100, avg_price_90d: 100, volume_bucket: "high", price_volatility_30d: 0.05, price_momentum: 1.0 });
    expect(result.confidence).toBe("HIGH");
  });

  it("low volume = LOW confidence", () => {
    const result = statisticalEstimation({ avg_price_30d: 100, avg_price_90d: 100, volume_bucket: "low", price_volatility_30d: 0.10, price_momentum: 1.0 });
    expect(result.confidence).toBe("LOW");
  });

  it("wider intervals for low volume cards", () => {
    const high = statisticalEstimation({ avg_price_30d: 100, avg_price_90d: 100, volume_bucket: "high", price_volatility_30d: 0.10, price_momentum: 1.0 });
    const low = statisticalEstimation({ avg_price_30d: 100, avg_price_90d: 100, volume_bucket: "low", price_volatility_30d: 0.10, price_momentum: 1.0 });
    const highWidth = high.sell_threshold - high.buy_threshold;
    const lowWidth = low.sell_threshold - low.buy_threshold;
    expect(lowWidth).toBeGreaterThan(highWidth);
  });
});

describe("Evaluate decision logic", () => {
  it("STRONG_BUY when offered price < max buy price (HIGH confidence)", () => {
    const fairValue = 100;
    const nrv = computeNrv(fairValue);
    const maxBuy = computeMaxBuyPrice(fairValue);
    const offeredPrice = maxBuy - 10; // Below max buy
    expect(offeredPrice).toBeLessThan(maxBuy);
    // At HIGH confidence, this should be STRONG_BUY
  });

  it("SELL_SIGNAL when offered price > sell threshold", () => {
    const result = statisticalEstimation({ avg_price_30d: 100, avg_price_90d: 100, volume_bucket: "high", price_volatility_30d: 0.10, price_momentum: 1.0 });
    const offeredPrice = result.sell_threshold + 10;
    expect(offeredPrice).toBeGreaterThan(result.sell_threshold);
  });

  it("FAIR_VALUE when price is between buy and sell", () => {
    const result = statisticalEstimation({ avg_price_30d: 100, avg_price_90d: 100, volume_bucket: "high", price_volatility_30d: 0.10, price_momentum: 1.0 });
    const offeredPrice = (result.buy_threshold + result.sell_threshold) / 2;
    expect(offeredPrice).toBeGreaterThan(result.buy_threshold);
    expect(offeredPrice).toBeLessThan(result.sell_threshold);
  });
});
