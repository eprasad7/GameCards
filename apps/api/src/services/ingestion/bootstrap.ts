import type { Env } from "../../types";

/**
 * Bootstrap card_catalog with initial data from PriceCharting.
 *
 * PriceCharting provides a CSV dump of all products. This function
 * processes a pre-uploaded CSV from R2 and populates the card_catalog.
 *
 * Usage: Call via POST /v1/system/bootstrap or from a one-time script.
 *
 * Expected CSV format (PriceCharting export):
 *   id,product-name,console-name,loose-price,graded-price
 */

interface PriceChartingRow {
  id: string;
  "product-name": string;
  "console-name": string;
  "loose-price"?: string;
  "graded-price"?: string;
}

/** Map PriceCharting console names to our category enum */
function mapCategory(consoleName: string): string {
  const lower = consoleName.toLowerCase();
  if (lower.includes("pokemon")) return "pokemon";
  if (lower.includes("baseball")) return "sports_baseball";
  if (lower.includes("basketball")) return "sports_basketball";
  if (lower.includes("football")) return "sports_football";
  if (lower.includes("hockey")) return "sports_hockey";
  if (lower.includes("magic") || lower.includes("mtg")) return "tcg_mtg";
  if (lower.includes("yu-gi-oh") || lower.includes("yugioh")) return "tcg_yugioh";
  return "other";
}

/** Parse a card name into structured fields */
function parseCardName(name: string, consoleName: string): {
  setName: string;
  cardNumber: string;
  playerCharacter: string | null;
} {
  // Try to extract set name from console name (e.g., "Pokemon Base Set")
  const setName = consoleName;
  const cardNumber = "";
  const playerCharacter = null;

  return { setName, cardNumber, playerCharacter };
}

export async function bootstrapCatalog(env: Env): Promise<{ imported: number }> {
  // Check for bootstrap CSV in R2
  const csvObj = await env.DATA_ARCHIVE.get("bootstrap/pricecharting_catalog.csv");
  if (!csvObj) {
    throw new Error(
      "No bootstrap CSV found. Upload pricecharting_catalog.csv to R2 at bootstrap/pricecharting_catalog.csv"
    );
  }

  const csvText = await csvObj.text();
  const lines = csvText.split("\n");
  const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());

  const BATCH_SIZE = 90;
  let imported = 0;
  let batch: D1PreparedStatement[] = [];

  const stmt = env.DB.prepare(
    `INSERT INTO card_catalog (id, name, set_name, set_year, card_number, category, player_character, pricecharting_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       pricecharting_id = excluded.pricecharting_id,
       updated_at = datetime('now')`
  );

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Simple CSV parse (doesn't handle quoted commas — good enough for PriceCharting format)
    const values = line.split(",");
    if (values.length < 3) continue;

    const pcId = values[headers.indexOf("id")]?.trim();
    const productName = values[headers.indexOf("product-name")]?.trim();
    const consoleName = values[headers.indexOf("console-name")]?.trim();

    if (!pcId || !productName || !consoleName) continue;

    const category = mapCategory(consoleName);
    const { setName, cardNumber, playerCharacter } = parseCardName(productName, consoleName);
    const cardId = `${category}-${pcId}`.toLowerCase().replace(/\s+/g, "-");

    batch.push(
      stmt.bind(cardId, productName, setName, 0, cardNumber, category, playerCharacter, pcId)
    );

    if (batch.length >= BATCH_SIZE) {
      await env.DB.batch(batch);
      imported += batch.length;
      batch = [];
    }
  }

  if (batch.length > 0) {
    await env.DB.batch(batch);
    imported += batch.length;
  }

  return { imported };
}
