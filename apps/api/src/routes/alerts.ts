import { Hono } from "hono";
import type { Env } from "../types";
import { parsePositiveInt } from "../lib/params";

export const alertRoutes = new Hono<{ Bindings: Env }>();

// GET /v1/alerts/active
alertRoutes.get("/active", async (c) => {
  const category = c.req.query("category");
  const alertType = c.req.query("type");
  const limit = Math.min(parseInt(c.req.query("limit") || "50"), 200);

  let sql = `
    SELECT pa.*, cc.name as card_name, cc.category
    FROM price_alerts pa
    JOIN card_catalog cc ON cc.id = pa.card_id
    WHERE pa.is_active = 1`;
  const params: unknown[] = [];

  if (category) {
    sql += ` AND cc.category = ?`;
    params.push(category);
  }
  if (alertType) {
    sql += ` AND pa.alert_type = ?`;
    params.push(alertType);
  }

  sql += ` ORDER BY pa.created_at DESC LIMIT ?`;
  params.push(limit);

  const results = await c.env.DB.prepare(sql).bind(...params).all();
  return c.json({ alerts: results.results });
});

// POST /v1/alerts/:id/resolve
alertRoutes.post("/:id/resolve", async (c) => {
  const id = c.req.param("id");
  await c.env.DB.prepare(
    `UPDATE price_alerts SET is_active = 0, resolved_at = datetime('now') WHERE id = ?`
  )
    .bind(id)
    .run();

  return c.json({ status: "resolved" });
});

// GET /v1/alerts/history — resolved alerts
alertRoutes.get("/history", async (c) => {
  const days = parsePositiveInt(c.req.query("days"), 30, 365);
  const limit = Math.min(parseInt(c.req.query("limit") || "100"), 500);

  const results = await c.env.DB.prepare(
    `SELECT pa.*, cc.name as card_name, cc.category
     FROM price_alerts pa
     JOIN card_catalog cc ON cc.id = pa.card_id
     WHERE pa.created_at >= date('now', '-' || ? || ' days')
     ORDER BY pa.created_at DESC
     LIMIT ?`
  )
    .bind(days, limit)
    .all();

  return c.json({ alerts: results.results });
});
