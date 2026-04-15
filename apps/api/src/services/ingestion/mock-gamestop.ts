import type { Env } from "../../types";

/**
 * Generate scenario-driven mock GameStop internal data for demo.
 *
 * Creates 3 compelling stories across real cards from the catalog:
 *
 * Scenario 1 — "Buy more": High demand, low inventory, fast sell-through
 * Scenario 2 — "Overpriced": Stale inventory, low views, rejected trade-ins
 * Scenario 3 — "Viral moment": Page view spike, no trade-ins yet, act fast
 *
 * Plus baseline "healthy" cards to show the normal state.
 */

interface InternalMetrics {
  cardId: string;
  tradeInCount: number;
  avgTradeInPrice: number;
  inventoryUnits: number;
  storeViews: number;
  footTrafficIndex: number;
  daysInInventory: number;
  sellThroughRate: number;
  conversionRate: number;
  scenario: "buy_more" | "overpriced" | "viral_moment" | "healthy";
}

export async function generateMockInternalData(env: Env): Promise<{ generated: number; scenarios: Record<string, number> }> {
  const cards = await env.DB.prepare(
    `SELECT cc.id, cc.name, cc.category,
            mp.fair_value, mp.confidence, mp.volume_bucket
     FROM card_catalog cc
     LEFT JOIN model_predictions mp ON mp.card_id = cc.id
     ORDER BY RANDOM()
     LIMIT 200`
  ).bind().all();

  if (cards.results.length === 0) {
    throw new Error("No cards in catalog. Run /v1/system/seed first.");
  }

  await ensureTable(env);

  const today = new Date().toISOString().split("T")[0];
  const scenarios: Record<string, number> = { buy_more: 0, overpriced: 0, viral_moment: 0, healthy: 0 };

  // Assign scenarios: ~15% buy_more, ~15% overpriced, ~10% viral, ~60% healthy
  const allMetrics: InternalMetrics[] = [];

  for (let i = 0; i < cards.results.length; i++) {
    const card = cards.results[i];
    const cardId = card.id as string;
    const fairValue = (card.fair_value as number) || rand(20, 300);
    const isPokemon = (card.category as string) === "pokemon";

    let scenario: InternalMetrics["scenario"];
    if (i < cards.results.length * 0.15) scenario = "buy_more";
    else if (i < cards.results.length * 0.30) scenario = "overpriced";
    else if (i < cards.results.length * 0.40) scenario = "viral_moment";
    else scenario = "healthy";

    allMetrics.push(generateScenario(cardId, fairValue, isPokemon, scenario));
    scenarios[scenario]++;
  }

  // Write metrics to DB
  const BATCH_SIZE = 90;
  const stmt = env.DB.prepare(
    `INSERT OR REPLACE INTO gamestop_internal_metrics
       (card_id, trade_in_count, avg_trade_in_price, inventory_units,
        store_views, foot_traffic_index, days_in_inventory,
        sell_through_rate, conversion_rate, scenario, snapshot_date)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  let stmts: D1PreparedStatement[] = [];
  for (const m of allMetrics) {
    stmts.push(stmt.bind(
      m.cardId, m.tradeInCount, m.avgTradeInPrice, m.inventoryUnits,
      m.storeViews, m.footTrafficIndex, m.daysInInventory,
      m.sellThroughRate, m.conversionRate, m.scenario, today
    ));
    if (stmts.length >= BATCH_SIZE) {
      await env.DB.batch(stmts);
      stmts = [];
    }
  }
  if (stmts.length > 0) await env.DB.batch(stmts);

  // Generate trade-in price observations for "buy_more" and "healthy" cards
  await generateTradeInObservations(env, allMetrics.filter((m) => m.scenario !== "overpriced"));

  // Generate alerts for viral moment cards
  await generateViralAlerts(env, allMetrics.filter((m) => m.scenario === "viral_moment"));

  return { generated: allMetrics.length, scenarios };
}

/**
 * Scenario 1: "Buy more of this card"
 * High demand signals, low supply, fast movement
 */
function scenarioBuyMore(cardId: string, fairValue: number, isPokemon: boolean): InternalMetrics {
  return {
    cardId,
    tradeInCount: Math.floor(rand(5, 15)),          // Lots of people bringing them in
    avgTradeInPrice: round2(fairValue * rand(0.45, 0.55)),  // Good margin on trade-ins
    inventoryUnits: Math.floor(rand(0, 3)),           // Almost out of stock
    storeViews: Math.floor(rand(200, isPokemon ? 800 : 400)),  // High interest
    footTrafficIndex: round2(rand(0.7, 0.95)),        // Strong regional demand
    daysInInventory: Math.floor(rand(1, 5)),          // Sells fast
    sellThroughRate: round2(rand(0.85, 0.98)),        // Nearly everything sells
    conversionRate: round2(rand(0.12, 0.25)),         // Good view-to-buy ratio
    scenario: "buy_more",
  };
}

/**
 * Scenario 2: "We're overpriced on this card"
 * Stale inventory, nobody buying, trade-ins rejected
 */
function scenarioOverpriced(cardId: string, fairValue: number, isPokemon: boolean): InternalMetrics {
  return {
    cardId,
    tradeInCount: Math.floor(rand(0, 2)),             // Sellers not even bringing them in
    avgTradeInPrice: round2(fairValue * rand(0.25, 0.35)),  // Would need to offer less
    inventoryUnits: Math.floor(rand(8, 25)),           // Way too much stock
    storeViews: Math.floor(rand(5, 30)),              // Nobody looking
    footTrafficIndex: round2(rand(0.1, 0.3)),         // Low demand
    daysInInventory: Math.floor(rand(45, 120)),       // Sitting forever
    sellThroughRate: round2(rand(0.05, 0.20)),        // Barely moves
    conversionRate: round2(rand(0.005, 0.02)),        // Views but no buys = overpriced
    scenario: "overpriced",
  };
}

/**
 * Scenario 3: "Viral moment — act fast"
 * Sudden interest spike, supply hasn't reacted yet
 */
function scenarioViralMoment(cardId: string, fairValue: number, isPokemon: boolean): InternalMetrics {
  return {
    cardId,
    tradeInCount: Math.floor(rand(0, 1)),             // Nobody selling yet — they see the hype
    avgTradeInPrice: round2(fairValue * rand(0.50, 0.60)),  // If we could get them, great margin
    inventoryUnits: Math.floor(rand(1, 4)),           // Limited stock
    storeViews: Math.floor(rand(500, isPokemon ? 2000 : 1000)),  // 10x normal views
    footTrafficIndex: round2(rand(0.8, 1.0)),         // Everyone asking about it
    daysInInventory: Math.floor(rand(1, 3)),          // What we have moves instantly
    sellThroughRate: round2(rand(0.95, 1.0)),         // 100% sell-through
    conversionRate: round2(rand(0.30, 0.50)),         // Extremely high — people buying on sight
    scenario: "viral_moment",
  };
}

/**
 * Baseline: "Healthy normal card"
 * Average metrics, nothing remarkable
 */
function scenarioHealthy(cardId: string, fairValue: number, isPokemon: boolean): InternalMetrics {
  return {
    cardId,
    tradeInCount: Math.floor(rand(1, 5)),
    avgTradeInPrice: round2(fairValue * rand(0.40, 0.50)),
    inventoryUnits: Math.floor(rand(2, 8)),
    storeViews: Math.floor(rand(20, isPokemon ? 150 : 80)),
    footTrafficIndex: round2(rand(0.3, 0.6)),
    daysInInventory: Math.floor(rand(10, 35)),
    sellThroughRate: round2(rand(0.40, 0.70)),
    conversionRate: round2(rand(0.04, 0.10)),
    scenario: "healthy",
  };
}

function generateScenario(cardId: string, fairValue: number, isPokemon: boolean, scenario: InternalMetrics["scenario"]): InternalMetrics {
  switch (scenario) {
    case "buy_more": return scenarioBuyMore(cardId, fairValue, isPokemon);
    case "overpriced": return scenarioOverpriced(cardId, fairValue, isPokemon);
    case "viral_moment": return scenarioViralMoment(cardId, fairValue, isPokemon);
    case "healthy": return scenarioHealthy(cardId, fairValue, isPokemon);
  }
}

async function generateTradeInObservations(env: Env, metrics: InternalMetrics[]) {
  const BATCH_SIZE = 90;
  const stmt = env.DB.prepare(
    `INSERT OR IGNORE INTO price_observations
       (card_id, source, price_usd, sale_date, grade, grading_company, grade_numeric, sale_type, listing_url)
     VALUES (?, 'gamestop_internal', ?, ?, 'RAW', 'RAW', NULL, 'fixed', ?)`
  );

  let stmts: D1PreparedStatement[] = [];

  for (const m of metrics) {
    if (m.tradeInCount === 0) continue;
    const count = Math.min(m.tradeInCount, 5);

    for (let i = 0; i < count; i++) {
      const daysAgo = Math.floor(rand(1, 30));
      const date = new Date();
      date.setDate(date.getDate() - daysAgo);
      const dateStr = date.toISOString().split("T")[0];
      const price = round2(m.avgTradeInPrice * rand(0.9, 1.1));

      stmts.push(stmt.bind(m.cardId, price, dateStr, `gamestop://trade-in/${m.cardId}/${dateStr}/${i}`));

      if (stmts.length >= BATCH_SIZE) {
        await env.DB.batch(stmts);
        stmts = [];
      }
    }
  }

  if (stmts.length > 0) await env.DB.batch(stmts);
}

async function generateViralAlerts(env: Env, viralCards: InternalMetrics[]) {
  for (const m of viralCards.slice(0, 10)) {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO price_alerts
         (card_id, alert_type, magnitude, trigger_source, message)
       SELECT ?, 'viral_social', ?, 'mock_internal', ?
       WHERE NOT EXISTS (
         SELECT 1 FROM price_alerts WHERE card_id = ? AND alert_type = 'viral_social'
           AND is_active = 1 AND created_at >= datetime('now', '-1 day')
       )`
    ).bind(
      m.cardId,
      round2(m.storeViews / 100),
      `Viral: ${m.storeViews} store views (${Math.round(m.conversionRate * 100)}% conversion). ${m.inventoryUnits} units left. Act fast.`,
      m.cardId
    ).run();
  }
}

async function ensureTable(env: Env) {
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS gamestop_internal_metrics (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       card_id TEXT NOT NULL,
       trade_in_count INTEGER NOT NULL DEFAULT 0,
       avg_trade_in_price REAL NOT NULL DEFAULT 0,
       inventory_units INTEGER NOT NULL DEFAULT 0,
       store_views INTEGER NOT NULL DEFAULT 0,
       foot_traffic_index REAL NOT NULL DEFAULT 0,
       days_in_inventory INTEGER NOT NULL DEFAULT 0,
       sell_through_rate REAL NOT NULL DEFAULT 0,
       conversion_rate REAL NOT NULL DEFAULT 0,
       scenario TEXT,
       snapshot_date TEXT NOT NULL DEFAULT (date('now')),
       created_at TEXT NOT NULL DEFAULT (datetime('now')),
       UNIQUE(card_id, snapshot_date)
     )`
  ).bind().run();
}

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
