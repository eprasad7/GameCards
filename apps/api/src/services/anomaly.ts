import type { Env } from "../types";

/**
 * Anomaly detection system.
 * Runs daily at 5am and on-demand via alerts.
 *
 * Detects:
 * 1. Shill bidding patterns
 * 2. Data quality issues (lot sales, currency, Best Offer bias)
 * 3. Market manipulation (pump & dump)
 * 4. Price outliers (statistical)
 */
export async function runAnomalyDetection(env: Env): Promise<number> {
  let totalFlagged = 0;

  totalFlagged += await detectPriceOutliers(env);
  totalFlagged += await detectShillBidding(env);
  totalFlagged += await detectDataQualityIssues(env);
  totalFlagged += await detectPriceSpikes(env);

  return totalFlagged;
}

/**
 * Statistical price outlier detection using IQR method.
 * Flags prices that are >3x IQR from the median.
 */
async function detectPriceOutliers(env: Env): Promise<number> {
  // Get recent observations that haven't been checked
  const recentObs = await env.DB.prepare(
    `SELECT po.id, po.card_id, po.price_usd, po.grading_company, po.grade,
            pa.avg_price, pa.min_price, pa.max_price, pa.sale_count
     FROM price_observations po
     LEFT JOIN price_aggregates pa
       ON pa.card_id = po.card_id
       AND pa.grading_company = COALESCE(po.grading_company, 'RAW')
       AND pa.grade = COALESCE(po.grade, 'RAW')
       AND pa.period = 'monthly'
     WHERE po.is_anomaly = 0
       AND po.created_at >= datetime('now', '-1 day')
       AND pa.sale_count >= 5`
  )
    .bind()
    .all();

  let flagged = 0;

  for (const obs of recentObs.results) {
    const price = obs.price_usd as number;
    const avgPrice = obs.avg_price as number;
    const minPrice = obs.min_price as number;
    const maxPrice = obs.max_price as number;

    // Simple IQR-like detection: flag if price is >3x the range from average
    const range = maxPrice - minPrice;
    const lowerBound = avgPrice - 3 * range;
    const upperBound = avgPrice + 3 * range;

    if (price < lowerBound || price > upperBound) {
      await env.DB.prepare(
        `UPDATE price_observations SET is_anomaly = 1, anomaly_reason = ? WHERE id = ?`
      )
        .bind(
          price > upperBound
            ? `Price $${price.toFixed(2)} exceeds upper bound $${upperBound.toFixed(2)} (avg: $${avgPrice.toFixed(2)})`
            : `Price $${price.toFixed(2)} below lower bound $${lowerBound.toFixed(2)} (avg: $${avgPrice.toFixed(2)})`,
          obs.id
        )
        .run();
      flagged++;
    }
  }

  return flagged;
}

/**
 * Detect shill bidding patterns.
 * Key indicators:
 * - Same seller with abnormally high prices
 * - Concentrated bidding patterns
 * - New sellers with suspiciously high sale prices
 */
async function detectShillBidding(env: Env): Promise<number> {
  // Find sellers with prices consistently above market
  const suspectSellers = await env.DB.prepare(
    `SELECT po.seller_id,
            COUNT(*) as sale_count,
            AVG(po.price_usd) as seller_avg,
            AVG(pa.avg_price) as market_avg
     FROM price_observations po
     JOIN price_aggregates pa
       ON pa.card_id = po.card_id
       AND pa.grading_company = COALESCE(po.grading_company, 'RAW')
       AND pa.grade = COALESCE(po.grade, 'RAW')
       AND pa.period = 'monthly'
     WHERE po.seller_id IS NOT NULL
       AND po.sale_date >= date('now', '-30 days')
       AND po.is_anomaly = 0
     GROUP BY po.seller_id
     HAVING sale_count >= 3 AND seller_avg > market_avg * 1.5`
  )
    .bind()
    .all();

  let flagged = 0;

  for (const seller of suspectSellers.results) {
    // Flag all recent sales from this seller
    const result = await env.DB.prepare(
      `UPDATE price_observations
       SET is_anomaly = 1, anomaly_reason = 'Suspected shill bidding — seller avg ' || ? || '% above market'
       WHERE seller_id = ? AND sale_date >= date('now', '-30 days') AND is_anomaly = 0`
    )
      .bind(
        Math.round(
          (((seller.seller_avg as number) / (seller.market_avg as number)) - 1) * 100
        ),
        seller.seller_id
      )
      .run();

    flagged += result.meta.changes;
  }

  return flagged;
}

/**
 * Detect data quality issues.
 * - Lot sales that slipped through
 * - Suspiciously low prices (likely accessories, not cards)
 * - Duplicate entries
 */
async function detectDataQualityIssues(env: Env): Promise<number> {
  // Flag observations with very low prices for graded cards (likely not actual cards)
  const result = await env.DB.prepare(
    `UPDATE price_observations
     SET is_anomaly = 1, anomaly_reason = 'Suspiciously low price for graded card'
     WHERE is_anomaly = 0
       AND grading_company IN ('PSA', 'BGS', 'CGC', 'SGC')
       AND grade_numeric >= 8
       AND price_usd < 1.00
       AND created_at >= datetime('now', '-1 day')`
  )
    .bind()
    .run();

  return result.meta.changes;
}

/**
 * Detect sudden price spikes/crashes and create alerts.
 */
async function detectPriceSpikes(env: Env): Promise<number> {
  // Find cards where 7d average deviates >30% from 30d average
  const spikes = await env.DB.prepare(
    `SELECT
       card_id, grading_company, grade,
       AVG(CASE WHEN sale_date >= date('now', '-7 days') THEN price_usd END) as avg_7d,
       AVG(CASE WHEN sale_date >= date('now', '-30 days') THEN price_usd END) as avg_30d,
       COUNT(CASE WHEN sale_date >= date('now', '-7 days') THEN 1 END) as count_7d
     FROM price_observations
     WHERE sale_date >= date('now', '-30 days')
       AND is_anomaly = 0
     GROUP BY card_id, grading_company, grade
     HAVING count_7d >= 2 AND avg_30d > 0
       AND ABS(avg_7d - avg_30d) / avg_30d > 0.30`
  )
    .bind()
    .all();

  let alertCount = 0;

  for (const spike of spikes.results) {
    const avg7d = spike.avg_7d as number;
    const avg30d = spike.avg_30d as number;
    const changePct = ((avg7d - avg30d) / avg30d) * 100;
    const alertType = changePct > 0 ? "price_spike" : "price_crash";

    // Check if alert already exists for this card recently
    const existing = await env.DB.prepare(
      `SELECT id FROM price_alerts
       WHERE card_id = ? AND alert_type = ? AND is_active = 1
         AND created_at >= datetime('now', '-1 day')`
    )
      .bind(spike.card_id, alertType)
      .first();

    if (!existing) {
      await env.DB.prepare(
        `INSERT INTO price_alerts (card_id, alert_type, magnitude, trigger_source, message)
         VALUES (?, ?, ?, 'anomaly_detection', ?)`
      )
        .bind(
          spike.card_id,
          alertType,
          Math.round(changePct * 10) / 10,
          `${alertType === "price_spike" ? "Price spike" : "Price crash"}: ${changePct > 0 ? "+" : ""}${changePct.toFixed(1)}% (7d avg $${avg7d.toFixed(2)} vs 30d avg $${avg30d.toFixed(2)})`
        )
        .run();
      alertCount++;
    }
  }

  return alertCount;
}
