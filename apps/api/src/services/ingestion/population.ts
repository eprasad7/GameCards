import type { Env } from "../../types";

/**
 * Ingest PSA population reports via GemRate API.
 * Runs daily at 3am via Cron Trigger.
 *
 * GemRate aggregates population data from PSA, BGS, CGC, SGC.
 * Free tier available.
 */
export async function ingestPopulationReports(env: Env): Promise<number> {
  // Get cards that have PSA cert lookup IDs
  const cards = await env.DB.prepare(
    `SELECT cc.id, cc.name, cc.psa_cert_lookup_id
     FROM card_catalog cc
     WHERE cc.psa_cert_lookup_id IS NOT NULL
     ORDER BY (
       SELECT MAX(snapshot_date) FROM population_reports WHERE card_id = cc.id
     ) ASC NULLS FIRST
     LIMIT 50`
  )
    .bind()
    .all();

  let totalIngested = 0;
  const today = new Date().toISOString().split("T")[0];

  for (const card of cards.results) {
    try {
      // GemRate API endpoint (adjust based on actual API)
      const response = await fetch(
        `https://api.gemrate.com/v1/population/${card.psa_cert_lookup_id}`,
        {
          headers: { "Content-Type": "application/json" },
        }
      );

      if (!response.ok) {
        console.error(`GemRate API error for ${card.id}: ${response.status}`);
        continue;
      }

      const popData = await response.json() as {
        grades: Array<{
          grade: string;
          grading_company: string;
          population: number;
          pop_higher: number;
          total: number;
        }>;
      };

      if (!popData.grades?.length) continue;

      const stmts = popData.grades.map((g) =>
        env.DB.prepare(
          `INSERT INTO population_reports (card_id, grading_company, grade, population, pop_higher, total_population, snapshot_date)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(card_id, grading_company, grade, snapshot_date) DO UPDATE SET
             population = excluded.population,
             pop_higher = excluded.pop_higher,
             total_population = excluded.total_population`
        ).bind(
          card.id,
          g.grading_company,
          g.grade,
          g.population,
          g.pop_higher,
          g.total,
          today
        )
      );

      await env.DB.batch(stmts);
      totalIngested += popData.grades.length;
    } catch (err) {
      console.error(`Population ingestion failed for ${card.id}:`, err);
    }
  }

  return totalIngested;
}
