import { describe, it, expect } from "vitest";
import {
  computeMaxBuyPrice,
  computeNrv,
  makeTradeDecision,
  statisticalEstimation,
} from "../src/lib/pricing";

describe("NRV calculations (shared production logic)", () => {
  it("NRV = fairValue * (1-fees) * (1-returns) - shipping", () => {
    expect(computeNrv(100)).toBeCloseTo(79.39, 1);
  });

  it("NRV is negative for sub-$6 cards", () => {
    expect(computeNrv(5)).toBeLessThan(0);
    expect(computeNrv(6)).toBeCloseTo(0.1, 0);
  });

  it("max buy price = NRV * 0.80", () => {
    expect(computeMaxBuyPrice(100)).toBeCloseTo(63.51, 0);
  });
});

describe("Decision logic (shared production logic)", () => {
  it("STRONG_BUY when price < max buy and HIGH confidence", () => {
    expect(makeTradeDecision(30, 100, 120, "HIGH")).toBe("STRONG_BUY");
  });

  it("REVIEW_BUY when price < max buy but LOW confidence", () => {
    expect(makeTradeDecision(30, 100, 120, "LOW")).toBe("REVIEW_BUY");
  });

  it("SELL_SIGNAL when price > sell threshold", () => {
    expect(makeTradeDecision(150, 100, 120, "HIGH")).toBe("SELL_SIGNAL");
  });

  it("FAIR_VALUE when price between max buy and sell threshold", () => {
    expect(makeTradeDecision(80, 100, 120, "HIGH")).toBe("FAIR_VALUE");
  });

  it("won't recommend buying unprofitable cards", () => {
    expect(makeTradeDecision(85, 100, 120, "HIGH")).not.toBe("STRONG_BUY");
  });
});

describe("Statistical fallback estimation", () => {
  it("returns zero prediction for missing price data", () => {
    const result = statisticalEstimation({ avg_price_30d: 0, avg_price_90d: 0 });
    expect(result.fair_value).toBe(0);
    expect(result.model_version).toBe("statistical-v1");
  });

  it("weights 30d average higher than 90d", () => {
    const result = statisticalEstimation({
      avg_price_30d: 200,
      avg_price_90d: 100,
      volume_bucket: "high",
      price_volatility_30d: 0.1,
      price_momentum: 1,
    });
    expect(result.fair_value).toBe(170);
  });

  it("applies price momentum and keeps buy threshold below fair value", () => {
    const base = statisticalEstimation({
      avg_price_30d: 100,
      avg_price_90d: 100,
      volume_bucket: "high",
      price_volatility_30d: 0.1,
      price_momentum: 1,
    });
    const rising = statisticalEstimation({
      avg_price_30d: 100,
      avg_price_90d: 100,
      volume_bucket: "high",
      price_volatility_30d: 0.1,
      price_momentum: 1.2,
    });
    expect(rising.fair_value).toBeGreaterThan(base.fair_value);
    expect(rising.buy_threshold).toBeLessThan(rising.fair_value);
  });

  it("widens intervals and lowers confidence for low-volume cards", () => {
    const high = statisticalEstimation({
      avg_price_30d: 100,
      avg_price_90d: 100,
      volume_bucket: "high",
      price_volatility_30d: 0.1,
      price_momentum: 1,
    });
    const low = statisticalEstimation({
      avg_price_30d: 100,
      avg_price_90d: 100,
      volume_bucket: "low",
      price_volatility_30d: 0.1,
      price_momentum: 1,
    });
    expect(low.confidence).toBe("LOW");
    expect(low.sell_threshold - low.buy_threshold).toBeGreaterThan(
      high.sell_threshold - high.buy_threshold,
    );
  });
});
