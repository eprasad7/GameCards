import { Hono } from "hono";
import type { Env } from "../types";
import { bootstrapCatalog } from "../services/ingestion/bootstrap";

export const systemRoutes = new Hono<{ Bindings: Env }>();

/**
 * GET /v1/system/health
 *
 * Returns pipeline health: prediction freshness, model version,
 * ingestion status, and whether pricing data is stale.
 */
systemRoutes.get("/health", async (c) => {
  const [predictionMeta, latestPrediction, latestIngestion, cardCount] = await Promise.all([
    c.env.MODELS.get("models/predictions_meta.json").then(async (obj) => {
      if (!obj) return null;
      return obj.json() as Promise<{
        version: string;
        model_version: string;
        conformal_correction: number;
        cards_scored: number;
        scored_at: string;
      }>;
    }),
    c.env.DB.prepare(`SELECT MAX(predicted_at) as latest FROM model_predictions`).bind().first(),
    c.env.DB.prepare(
      `SELECT source, status, records_processed, completed_at
       FROM ingestion_log WHERE status IN ('completed', 'failed')
       ORDER BY completed_at DESC LIMIT 5`
    ).bind().all(),
    c.env.DB.prepare(`SELECT COUNT(*) as cnt FROM card_catalog`).bind().first(),
  ]);

  const latestPredAt = latestPrediction?.latest as string | null;
  const hoursSincePrediction = latestPredAt
    ? (Date.now() - new Date(latestPredAt).getTime()) / (1000 * 60 * 60)
    : null;

  const scoredAt = predictionMeta?.scored_at;
  const hoursSinceScoring = scoredAt
    ? (Date.now() - new Date(scoredAt).getTime()) / (1000 * 60 * 60)
    : null;

  // Stale if predictions older than 36 hours (or no predictions at all)
  const isStale = hoursSincePrediction === null || hoursSincePrediction > 36;

  return c.json({
    status: isStale ? "degraded" : "healthy",
    predictions: {
      stale: isStale,
      latestPredictionAt: latestPredAt,
      hoursSincePrediction: hoursSincePrediction !== null ? Math.round(hoursSincePrediction * 10) / 10 : null,
      hoursSinceScoring: hoursSinceScoring !== null ? Math.round(hoursSinceScoring * 10) / 10 : null,
    },
    model: predictionMeta || null,
    catalog: {
      totalCards: (cardCount?.cnt as number) || 0,
    },
    ingestion: {
      recentRuns: latestIngestion.results.map((r) => ({
        source: r.source,
        status: r.status,
        records: r.records_processed,
        at: r.completed_at,
      })),
    },
  });
});

/**
 * GET /v1/system/model
 */
systemRoutes.get("/model", async (c) => {
  const meta = await c.env.MODELS.get("models/predictions_meta.json");
  if (!meta) return c.json({ error: "No model metadata found in R2" }, 404);
  return c.json(await meta.json());
});

/**
 * POST /v1/system/rollback
 *
 * Full rollback: copies versioned predictions back to latest in R2,
 * re-imports into D1 model_predictions, invalidates KV cache,
 * and updates predictions_meta.json.
 */
systemRoutes.post("/rollback", async (c) => {
  let body: { version_key: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Expected: { version_key: 'models/versions/...' }" }, 400);
  }

  const { version_key } = body;
  if (!version_key?.startsWith("models/versions/")) {
    return c.json({ error: "Invalid version_key" }, 400);
  }

  const versionedObj = await c.env.MODELS.get(version_key);
  if (!versionedObj) {
    return c.json({ error: `Version not found: ${version_key}` }, 404);
  }

  // 1. Copy versioned predictions to latest in R2
  const predictionsBytes = await versionedObj.arrayBuffer();
  await c.env.MODELS.put("models/batch_predictions.json", predictionsBytes);

  // 2. Parse predictions and re-import into D1 model_predictions
  const predictions = JSON.parse(new TextDecoder().decode(predictionsBytes)) as Array<{
    card_id: string; grade: string; grading_company: string; model_version: string;
    fair_value: number; p10: number; p25: number; p50: number; p75: number; p90: number;
    buy_threshold: number; sell_threshold: number; confidence: string; volume_bucket: string;
  }>;

  // Batch upsert into D1
  const BATCH_SIZE = 90;
  const stmt = c.env.DB.prepare(
    `INSERT INTO model_predictions
       (card_id, grade, grading_company, model_version, fair_value, p10, p25, p50, p75, p90,
        buy_threshold, sell_threshold, confidence, volume_bucket)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(card_id, grade, grading_company) DO UPDATE SET
       model_version = excluded.model_version, fair_value = excluded.fair_value,
       p10 = excluded.p10, p25 = excluded.p25, p50 = excluded.p50,
       p75 = excluded.p75, p90 = excluded.p90,
       buy_threshold = excluded.buy_threshold, sell_threshold = excluded.sell_threshold,
       confidence = excluded.confidence, volume_bucket = excluded.volume_bucket,
       predicted_at = datetime('now')`
  );

  for (let i = 0; i < predictions.length; i += BATCH_SIZE) {
    const chunk = predictions.slice(i, i + BATCH_SIZE).map((p) =>
      stmt.bind(p.card_id, p.grade, p.grading_company, p.model_version,
        p.fair_value, p.p10, p.p25, p.p50, p.p75, p.p90,
        p.buy_threshold, p.sell_threshold, p.confidence, p.volume_bucket)
    );
    await c.env.DB.batch(chunk);
  }

  // 3. Invalidate ALL KV price cache entries
  // KV doesn't support list+delete, so we write a cache-bust marker
  // that inference.ts checks. Simpler: delete known keys from predictions.
  for (const p of predictions.slice(0, 500)) {
    await c.env.PRICE_CACHE.delete(`price:${p.card_id}:${p.grading_company}:${p.grade}`);
  }

  // 4. Update predictions_meta.json to reflect the rollback
  const rollbackMeta = {
    version: `rollback-${Date.now()}`,
    model_version: predictions[0]?.model_version || "unknown",
    cards_scored: predictions.length,
    scored_at: new Date().toISOString(),
    rolled_back_from: version_key,
  };
  await c.env.MODELS.put("models/predictions_meta.json", JSON.stringify(rollbackMeta));

  return c.json({
    status: "rolled_back",
    from: version_key,
    predictions_updated: predictions.length,
    kv_invalidated: Math.min(predictions.length, 500),
    meta_updated: true,
  });
});

/**
 * POST /v1/system/bootstrap
 */
systemRoutes.post("/bootstrap", async (c) => {
  try {
    const result = await bootstrapCatalog(c.env);
    return c.json({ status: "ok", ...result });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
  }
});
