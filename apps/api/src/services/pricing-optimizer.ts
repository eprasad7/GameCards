import type { Env } from "../types";

/**
 * Pricing Optimizer — demand-aware dynamic pricing layer.
 *
 * Sits between the ML fair value prediction and the final offer/list price.
 * Adjusts pricing based on real-time market conditions, inventory position,
 * and competitive landscape.
 *
 * NOT personalized per user — same price for everyone, but dynamic based on:
 * 1. Inventory position (overstock → markdown, last unit → premium)
 * 2. Demand velocity (accelerating → hold firm, cooling → discount)
 * 3. Competitive gap (overpriced vs market → match, underpriced → hold)
 * 4. Supply signal (pop growth → price pressure, scarcity → premium)
 * 5. Event trigger (viral social → hold/raise, sentiment crash → cut)
 */

export interface PricingContext {
  fairValue: number;
  confidence: "HIGH" | "MEDIUM" | "LOW";

  // Inventory position
  inventoryUnits: number;
  daysInInventory: number;
  sellThroughRate: number;

  // Demand signals
  storeViews: number;
  avgStoreViews: number; // baseline for this card
  velocityTrend: number; // >1 = accelerating

  // Competitive position
  competitorPrice: number | null;
  competitorGap: number | null; // positive = we're higher

  // Supply signal
  popGrowthRate90d: number;

  // Social/event
  sentimentScore: number; // -1 to 1
  sentimentTrend: string; // "spiking", "rising", "stable", "falling"

  // Channel
  channel: "store" | "online" | "ebay";
}

export interface OptimizedPrice {
  listPrice: number;
  tradeInOffer: number;
  adjustments: Array<{ factor: string; impact: number; reason: string }>;
  riskScore: "low" | "medium" | "high";
  holdRecommendation: boolean;
  holdReason: string | null;
  expectedDaysToSell: number;
  expectedProfit: number;
  worstCaseExit: number;
}

export function optimizePrice(ctx: PricingContext): OptimizedPrice {
  let listMultiplier = 1.0;
  let tradeInDiscount = 0.20; // Base: offer 80% of list
  const adjustments: OptimizedPrice["adjustments"] = [];

  // ─── 1. Inventory Position ───
  if (ctx.inventoryUnits === 0) {
    // Out of stock — if we get one, it's valuable
    tradeInDiscount = 0.15; // Offer more aggressively (85% of list)
    adjustments.push({ factor: "inventory", impact: 0.05, reason: "Out of stock — aggressive buy" });
  } else if (ctx.inventoryUnits === 1) {
    listMultiplier *= 1.05; // Scarcity premium
    adjustments.push({ factor: "inventory", impact: 0.05, reason: "Last unit — scarcity premium" });
  } else if (ctx.inventoryUnits > 5 && ctx.daysInInventory > 45) {
    const agingDiscount = Math.min(0.15, (ctx.daysInInventory - 45) * 0.002);
    listMultiplier *= (1 - agingDiscount);
    adjustments.push({ factor: "inventory", impact: -agingDiscount, reason: `Overstocked (${ctx.inventoryUnits} units, ${ctx.daysInInventory}d aging)` });
  }

  if (ctx.sellThroughRate < 0.20 && ctx.inventoryUnits > 3) {
    listMultiplier *= 0.92;
    adjustments.push({ factor: "sell_through", impact: -0.08, reason: `Low sell-through (${Math.round(ctx.sellThroughRate * 100)}%)` });
  }

  // ─── 2. Demand Velocity ───
  if (ctx.velocityTrend > 1.5) {
    listMultiplier *= 1.03;
    adjustments.push({ factor: "demand", impact: 0.03, reason: "Accelerating demand" });
  } else if (ctx.velocityTrend < 0.5 && ctx.velocityTrend > 0) {
    listMultiplier *= 0.97;
    adjustments.push({ factor: "demand", impact: -0.03, reason: "Cooling demand" });
  }

  // Store view spike (someone's looking — don't discount)
  if (ctx.avgStoreViews > 0 && ctx.storeViews > ctx.avgStoreViews * 3) {
    listMultiplier = Math.max(listMultiplier, 1.0); // Don't discount during view spike
    adjustments.push({ factor: "views", impact: 0, reason: `View spike (${ctx.storeViews} vs avg ${ctx.avgStoreViews})` });
  }

  // ─── 3. Competitive Position ───
  if (ctx.competitorPrice && ctx.competitorGap !== null) {
    if (ctx.competitorGap > 15) {
      // We're 15%+ above market — match
      const matchAdjust = Math.min(0.12, ctx.competitorGap / 100 * 0.8);
      listMultiplier *= (1 - matchAdjust);
      adjustments.push({ factor: "competitive", impact: -matchAdjust, reason: `Overpriced vs market by ${Math.round(ctx.competitorGap)}%` });
    } else if (ctx.competitorGap < -10) {
      // We're 10%+ below market — we can raise
      const raiseAdjust = Math.min(0.08, Math.abs(ctx.competitorGap) / 100 * 0.5);
      listMultiplier *= (1 + raiseAdjust);
      adjustments.push({ factor: "competitive", impact: raiseAdjust, reason: `Underpriced vs market by ${Math.round(Math.abs(ctx.competitorGap))}%` });
    }
  }

  // ─── 4. Supply Signal ───
  if (ctx.popGrowthRate90d > 0.20) {
    listMultiplier *= 0.97;
    adjustments.push({ factor: "supply", impact: -0.03, reason: `Population growing ${Math.round(ctx.popGrowthRate90d * 100)}% — supply pressure` });
  } else if (ctx.popGrowthRate90d < -0.05) {
    // Pop shrinking (regrading/crossovers) — bullish
    listMultiplier *= 1.02;
    adjustments.push({ factor: "supply", impact: 0.02, reason: "Population declining — increasing scarcity" });
  }

  // ─── 5. Event Trigger ───
  let holdRecommendation = false;
  let holdReason: string | null = null;

  if (ctx.sentimentTrend === "spiking" && ctx.sentimentScore > 0.5) {
    holdRecommendation = true;
    holdReason = "Viral social activity detected — price is likely rising. Hold inventory.";
    listMultiplier *= 1.0; // Don't discount during hype
    adjustments.push({ factor: "viral", impact: 0, reason: "HOLD — viral moment, price rising" });
  } else if (ctx.sentimentTrend === "crashing" && ctx.sentimentScore < -0.3) {
    listMultiplier *= 0.95;
    tradeInDiscount = 0.30; // Offer less on trade-ins during crash
    adjustments.push({ factor: "sentiment", impact: -0.05, reason: "Negative sentiment — reduce exposure" });
  }

  // ─── 6. Channel Adjustment ───
  let channelMultiplier = 1.0;
  switch (ctx.channel) {
    case "store":
      channelMultiplier = 1.05; // In-store premium (impulse, no shipping)
      adjustments.push({ factor: "channel", impact: 0.05, reason: "In-store premium (no shipping, impulse)" });
      break;
    case "ebay":
      channelMultiplier = 1.15; // Must cover 13% fees
      adjustments.push({ factor: "channel", impact: 0.15, reason: "eBay listing (13% fees)" });
      break;
    case "online":
    default:
      // Gamestop.com — competitive, no adjustment
      break;
  }

  // ─── Compute Final Prices ───
  const listPrice = round2(ctx.fairValue * listMultiplier * channelMultiplier);
  const tradeInOffer = round2(listPrice * (1 - tradeInDiscount));

  // ─── Risk Assessment ───
  const riskFactors: number[] = [];
  if (ctx.confidence === "LOW") riskFactors.push(2);
  if (ctx.confidence === "MEDIUM") riskFactors.push(1);
  if (ctx.daysInInventory > 60) riskFactors.push(1);
  if (ctx.inventoryUnits > 5) riskFactors.push(1);
  if (ctx.sellThroughRate < 0.3) riskFactors.push(1);
  if (ctx.sentimentTrend === "falling" || ctx.sentimentTrend === "crashing") riskFactors.push(1);

  const riskTotal = riskFactors.reduce((a, b) => a + b, 0);
  const riskScore: OptimizedPrice["riskScore"] = riskTotal >= 4 ? "high" : riskTotal >= 2 ? "medium" : "low";

  // Expected days to sell (based on velocity and inventory)
  const dailySaleRate = ctx.sellThroughRate * ctx.inventoryUnits / Math.max(ctx.daysInInventory, 1);
  const expectedDaysToSell = dailySaleRate > 0 ? Math.round(1 / dailySaleRate) : 90;

  // Expected profit per unit
  const costBasis = tradeInOffer; // What we'd pay for a trade-in
  const netRevenue = listPrice * (ctx.channel === "ebay" ? 0.87 : ctx.channel === "store" ? 1.0 : 0.95);
  const expectedProfit = round2(netRevenue - costBasis);

  // Worst case: liquidate on eBay at 80% of fair value minus fees
  const worstCaseExit = round2(ctx.fairValue * 0.80 * 0.87);

  return {
    listPrice,
    tradeInOffer,
    adjustments,
    riskScore,
    holdRecommendation,
    holdReason,
    expectedDaysToSell,
    expectedProfit,
    worstCaseExit,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Build pricing context from D1 data for a specific card.
 */
export async function buildPricingContext(
  env: Env,
  cardId: string,
  grade: string,
  gradingCompany: string,
  fairValue: number,
  confidence: "HIGH" | "MEDIUM" | "LOW",
  channel: "store" | "online" | "ebay" = "online"
): Promise<PricingContext> {
  // Get internal metrics
  const internal = await env.DB.prepare(
    `SELECT inventory_units, days_in_inventory, sell_through_rate,
            store_views, foot_traffic_index
     FROM gamestop_internal_metrics
     WHERE card_id = ?
     ORDER BY snapshot_date DESC LIMIT 1`
  ).bind(cardId).first();

  // Get competitor gap
  const competitor = await env.DB.prepare(
    `SELECT price_usd FROM price_observations
     WHERE card_id = ? AND source IN ('pricecharting', 'cardhedger', 'soldcomps')
       AND COALESCE(grade, 'RAW') = ? AND COALESCE(grading_company, 'RAW') = ?
     ORDER BY sale_date DESC LIMIT 1`
  ).bind(cardId, grade, gradingCompany).first();

  // Get features for velocity and sentiment
  const features = await env.DB.prepare(
    `SELECT features FROM feature_store
     WHERE card_id = ? AND grade = ? AND grading_company = ?`
  ).bind(cardId, grade, gradingCompany).first();

  const feat = features?.features ? JSON.parse(features.features as string) : {};

  const competitorPrice = competitor?.price_usd as number | null;
  const competitorGap = competitorPrice && competitorPrice > 0
    ? ((fairValue - competitorPrice) / competitorPrice) * 100
    : null;

  return {
    fairValue,
    confidence,
    inventoryUnits: (internal?.inventory_units as number) || 0,
    daysInInventory: (internal?.days_in_inventory as number) || 0,
    sellThroughRate: (internal?.sell_through_rate as number) || 0.5,
    storeViews: (internal?.store_views as number) || 0,
    avgStoreViews: 50, // Baseline — would compute from historical data
    velocityTrend: (feat.velocity_trend as number) || 1.0,
    competitorPrice,
    competitorGap,
    popGrowthRate90d: (feat.pop_growth_rate_90d as number) || 0,
    sentimentScore: (feat.social_sentiment_score as number) || 0,
    sentimentTrend: "stable",
    channel,
  };
}
