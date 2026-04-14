import { Hono } from "hono";
import type { Env } from "../types";

export const marketRoutes = new Hono<{ Bindings: Env }>();

// GET /v1/market/index
marketRoutes.get("/index", async (c) => {
  // Check cache
  const cached = await c.env.PRICE_CACHE.get("market:index", "json");
  if (cached) return c.json(cached);

  // Compute market indices by category
  const pokemonIndex = await computeCategoryIndex(c.env.DB, "pokemon");
  const sportsIndex = await computeCategoryIndex(c.env.DB, "sports_baseball");

  // 30-day trend
  const trend30d = await c.env.DB.prepare(
    `SELECT
       AVG(CASE WHEN sale_date >= date('now', '-7 days') THEN price_usd END) as recent,
       AVG(CASE WHEN sale_date >= date('now', '-30 days') AND sale_date < date('now', '-7 days') THEN price_usd END) as older
     FROM price_observations
     WHERE sale_date >= date('now', '-30 days') AND is_anomaly = 0`
  )
    .bind()
    .first();

  const recent = (trend30d?.recent as number) || 0;
  const older = (trend30d?.older as number) || 0;
  const trendPct = older > 0 ? ((recent - older) / older) * 100 : 0;

  // Volatility (coefficient of variation of daily averages)
  const dailyPrices = await c.env.DB.prepare(
    `SELECT sale_date, AVG(price_usd) as avg_price
     FROM price_observations
     WHERE sale_date >= date('now', '-30 days') AND is_anomaly = 0
     GROUP BY sale_date
     ORDER BY sale_date`
  )
    .bind()
    .all();

  const prices = dailyPrices.results.map((r) => r.avg_price as number);
  const mean = prices.length > 0 ? prices.reduce((a, b) => a + b, 0) / prices.length : 0;
  const variance =
    prices.length > 0
      ? prices.reduce((sum, p) => sum + (p - mean) ** 2, 0) / prices.length
      : 0;
  const cv = mean > 0 ? Math.sqrt(variance) / mean : 0;
  const volatility = cv > 0.15 ? "high" : cv > 0.08 ? "moderate" : "low";

  const response = {
    pokemon_index: pokemonIndex,
    sports_index: sportsIndex,
    trend_30d: `${trendPct >= 0 ? "+" : ""}${trendPct.toFixed(1)}%`,
    volatility,
    updated_at: new Date().toISOString(),
  };

  // Cache for 15 minutes
  await c.env.PRICE_CACHE.put("market:index", JSON.stringify(response), {
    expirationTtl: 900,
  });

  return c.json(response);
});

// GET /v1/market/movers — biggest price movers
marketRoutes.get("/movers", async (c) => {
  const direction = c.req.query("direction") || "up"; // up or down
  const days = parseInt(c.req.query("days") || "7");
  const limit = Math.min(parseInt(c.req.query("limit") || "20"), 50);

  const orderDir = direction === "down" ? "ASC" : "DESC";

  const movers = await c.env.DB.prepare(
    `SELECT
       po.card_id,
       cc.name,
       cc.category,
       po.grading_company,
       po.grade,
       AVG(CASE WHEN po.sale_date >= date('now', '-' || ? || ' days') THEN po.price_usd END) as recent_avg,
       AVG(CASE WHEN po.sale_date < date('now', '-' || ? || ' days') AND po.sale_date >= date('now', '-' || (? * 2) || ' days') THEN po.price_usd END) as prior_avg
     FROM price_observations po
     JOIN card_catalog cc ON cc.id = po.card_id
     WHERE po.sale_date >= date('now', '-' || (? * 2) || ' days')
       AND po.is_anomaly = 0
     GROUP BY po.card_id, po.grading_company, po.grade
     HAVING recent_avg IS NOT NULL AND prior_avg IS NOT NULL AND prior_avg > 0
     ORDER BY (recent_avg - prior_avg) / prior_avg ${orderDir}
     LIMIT ?`
  )
    .bind(days, days, days, days, limit)
    .all();

  const results = movers.results.map((m) => ({
    ...m,
    change_pct:
      ((m.recent_avg as number) - (m.prior_avg as number)) /
      (m.prior_avg as number) *
      100,
  }));

  return c.json({ direction, days, movers: results });
});

async function computeCategoryIndex(db: D1Database, category: string): Promise<number> {
  const result = await db
    .prepare(
      `SELECT AVG(price_usd) * COUNT(DISTINCT card_id) as index_value
       FROM price_observations
       WHERE card_id IN (SELECT id FROM card_catalog WHERE category = ?)
         AND sale_date >= date('now', '-30 days')
         AND is_anomaly = 0`
    )
    .bind(category)
    .first();

  return Math.round((result?.index_value as number) || 0);
}
