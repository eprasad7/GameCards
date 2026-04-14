import { Hono } from "hono";
import type { Env } from "../types";

export const historyRoutes = new Hono<{ Bindings: Env }>();

// GET /v1/history/:cardId?grade=PSA10&days=90
historyRoutes.get("/:cardId", async (c) => {
  const cardId = c.req.param("cardId");
  const grade = c.req.query("grade");
  const gradingCompany = c.req.query("grading_company");
  const days = parseInt(c.req.query("days") || "90");
  const source = c.req.query("source");

  let sql = `
    SELECT po.*, cc.name as card_name
    FROM price_observations po
    JOIN card_catalog cc ON cc.id = po.card_id
    WHERE po.card_id = ?
      AND po.sale_date >= date('now', '-' || ? || ' days')
      AND po.is_anomaly = 0`;
  const params: unknown[] = [cardId, days];

  if (grade) {
    sql += ` AND po.grade = ?`;
    params.push(grade);
  }
  if (gradingCompany) {
    sql += ` AND po.grading_company = ?`;
    params.push(gradingCompany);
  }
  if (source) {
    sql += ` AND po.source = ?`;
    params.push(source);
  }

  sql += ` ORDER BY po.sale_date DESC LIMIT 500`;

  const results = await c.env.DB.prepare(sql).bind(...params).all();
  return c.json({ card_id: cardId, sales: results.results });
});

// GET /v1/history/:cardId/aggregates?period=daily&days=90
historyRoutes.get("/:cardId/aggregates", async (c) => {
  const cardId = c.req.param("cardId");
  const grade = c.req.query("grade") || "10";
  const gradingCompany = c.req.query("grading_company") || "PSA";
  const period = c.req.query("period") || "daily";
  const days = parseInt(c.req.query("days") || "90");

  const results = await c.env.DB.prepare(
    `SELECT * FROM price_aggregates
     WHERE card_id = ? AND grade = ? AND grading_company = ? AND period = ?
       AND period_start >= date('now', '-' || ? || ' days')
     ORDER BY period_start ASC`
  )
    .bind(cardId, grade, gradingCompany, period, days)
    .all();

  return c.json({ card_id: cardId, aggregates: results.results });
});
