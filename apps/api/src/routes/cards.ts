import { Hono } from "hono";
import type { Env } from "../types";

export const cardRoutes = new Hono<{ Bindings: Env }>();

// Search cards
cardRoutes.get("/search", async (c) => {
  const query = c.req.query("q") || "";
  const category = c.req.query("category");
  const limit = Math.min(parseInt(c.req.query("limit") || "20"), 100);
  const offset = parseInt(c.req.query("offset") || "0");

  let sql = `SELECT * FROM card_catalog WHERE 1=1`;
  const params: unknown[] = [];

  if (query) {
    sql += ` AND (name LIKE ? OR player_character LIKE ? OR set_name LIKE ?)`;
    const wildcard = `%${query}%`;
    params.push(wildcard, wildcard, wildcard);
  }

  if (category) {
    sql += ` AND category = ?`;
    params.push(category);
  }

  sql += ` ORDER BY updated_at DESC LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  const results = await c.env.DB.prepare(sql).bind(...params).all();
  return c.json({ cards: results.results, meta: { limit, offset } });
});

// Get card by ID
cardRoutes.get("/:id", async (c) => {
  const id = c.req.param("id");
  const card = await c.env.DB.prepare(
    `SELECT * FROM card_catalog WHERE id = ?`
  )
    .bind(id)
    .first();

  if (!card) return c.json({ error: "Card not found" }, 404);
  return c.json(card);
});

// Create card
cardRoutes.post("/", async (c) => {
  const body = await c.req.json();
  const id =
    body.id || `${body.category}-${body.set_name}-${body.card_number}`.toLowerCase().replace(/\s+/g, "-");

  await c.env.DB.prepare(
    `INSERT INTO card_catalog (id, name, set_name, set_year, card_number, category, player_character, team, rarity, image_url, pricecharting_id, psa_cert_lookup_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       updated_at = datetime('now')`
  )
    .bind(
      id,
      body.name,
      body.set_name,
      body.set_year,
      body.card_number,
      body.category,
      body.player_character || null,
      body.team || null,
      body.rarity || null,
      body.image_url || null,
      body.pricecharting_id || null,
      body.psa_cert_lookup_id || null
    )
    .run();

  return c.json({ id, status: "created" }, 201);
});

// Bulk upsert cards
cardRoutes.post("/bulk", async (c) => {
  const { cards } = await c.req.json();
  const stmt = c.env.DB.prepare(
    `INSERT INTO card_catalog (id, name, set_name, set_year, card_number, category, player_character, team, rarity, image_url, pricecharting_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       updated_at = datetime('now')`
  );

  const batch = cards.map((card: Record<string, unknown>) => {
    const id =
      (card.id as string) ||
      `${card.category}-${card.set_name}-${card.card_number}`
        .toLowerCase()
        .replace(/\s+/g, "-");
    return stmt.bind(
      id,
      card.name,
      card.set_name,
      card.set_year,
      card.card_number,
      card.category,
      card.player_character || null,
      card.team || null,
      card.rarity || null,
      card.image_url || null,
      card.pricecharting_id || null
    );
  });

  await c.env.DB.batch(batch);
  return c.json({ status: "ok", count: cards.length });
});
