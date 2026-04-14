import type { Env } from "../types";

/**
 * Compute daily/weekly/monthly price aggregates.
 * Runs daily at 4am before feature computation.
 */
export async function computeAggregates(env: Env): Promise<void> {
  const today = new Date().toISOString().split("T")[0];

  // Daily aggregates for yesterday
  await env.DB.prepare(
    `INSERT OR REPLACE INTO price_aggregates
       (card_id, grade, grading_company, period, period_start,
        avg_price, median_price, min_price, max_price, sale_count, volume_bucket)
     SELECT
       card_id,
       COALESCE(grade, 'RAW') as grade,
       COALESCE(grading_company, 'RAW') as grading_company,
       'daily' as period,
       date('now', '-1 day') as period_start,
       AVG(price_usd) as avg_price,
       -- SQLite doesn't have PERCENTILE_CONT, approximate median
       AVG(price_usd) as median_price,
       MIN(price_usd) as min_price,
       MAX(price_usd) as max_price,
       COUNT(*) as sale_count,
       CASE
         WHEN COUNT(*) >= 5 THEN 'high'
         WHEN COUNT(*) >= 2 THEN 'medium'
         ELSE 'low'
       END as volume_bucket
     FROM price_observations
     WHERE sale_date = date('now', '-1 day')
       AND is_anomaly = 0
     GROUP BY card_id, grade, grading_company`
  )
    .bind()
    .run();

  // Weekly aggregates (on Mondays)
  const dayOfWeek = new Date().getDay();
  if (dayOfWeek === 1) {
    await env.DB.prepare(
      `INSERT OR REPLACE INTO price_aggregates
         (card_id, grade, grading_company, period, period_start,
          avg_price, median_price, min_price, max_price, sale_count, volume_bucket)
       SELECT
         card_id,
         COALESCE(grade, 'RAW') as grade,
         COALESCE(grading_company, 'RAW') as grading_company,
         'weekly' as period,
         date('now', '-7 days') as period_start,
         AVG(price_usd),
         AVG(price_usd),
         MIN(price_usd),
         MAX(price_usd),
         COUNT(*),
         CASE
           WHEN COUNT(*) >= 15 THEN 'high'
           WHEN COUNT(*) >= 5 THEN 'medium'
           ELSE 'low'
         END
       FROM price_observations
       WHERE sale_date >= date('now', '-7 days')
         AND is_anomaly = 0
       GROUP BY card_id, grade, grading_company`
    )
      .bind()
      .run();
  }

  // Monthly aggregates (on the 1st)
  const dayOfMonth = new Date().getDate();
  if (dayOfMonth === 1) {
    await env.DB.prepare(
      `INSERT OR REPLACE INTO price_aggregates
         (card_id, grade, grading_company, period, period_start,
          avg_price, median_price, min_price, max_price, sale_count, volume_bucket)
       SELECT
         card_id,
         COALESCE(grade, 'RAW') as grade,
         COALESCE(grading_company, 'RAW') as grading_company,
         'monthly' as period,
         date('now', '-1 month') as period_start,
         AVG(price_usd),
         AVG(price_usd),
         MIN(price_usd),
         MAX(price_usd),
         COUNT(*),
         CASE
           WHEN COUNT(*) >= 50 THEN 'high'
           WHEN COUNT(*) >= 10 THEN 'medium'
           ELSE 'low'
         END
       FROM price_observations
       WHERE sale_date >= date('now', '-1 month')
         AND is_anomaly = 0
       GROUP BY card_id, grade, grading_company`
    )
      .bind()
      .run();
  }
}
