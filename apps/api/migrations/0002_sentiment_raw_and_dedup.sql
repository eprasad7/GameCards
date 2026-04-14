-- Forward migration for existing D1 databases that already applied 0001.
-- Adds sentiment_raw table, rollup_date to sentiment_scores, and dedup indexes.

-- ─── New: sentiment_raw table ───
CREATE TABLE IF NOT EXISTS sentiment_raw (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id TEXT NOT NULL REFERENCES card_catalog(id),
  source TEXT NOT NULL CHECK (source IN ('reddit','twitter')),
  score REAL NOT NULL,
  post_url TEXT,
  engagement INTEGER NOT NULL DEFAULT 0,
  observed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sentiment_raw_card ON sentiment_raw(card_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_sentiment_raw_date ON sentiment_raw(observed_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sentiment_raw_dedup ON sentiment_raw(card_id, source, post_url) WHERE post_url IS NOT NULL;

-- ─── Alter: add rollup_date to sentiment_scores ───
-- SQLite doesn't support ADD COLUMN with UNIQUE constraints,
-- so we recreate the table if the old schema exists.

-- Drop old table and recreate with rollup_date
DROP TABLE IF EXISTS sentiment_scores;

CREATE TABLE sentiment_scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id TEXT NOT NULL REFERENCES card_catalog(id),
  source TEXT NOT NULL CHECK (source IN ('reddit','twitter')),
  score REAL NOT NULL,
  mention_count INTEGER NOT NULL DEFAULT 0,
  period TEXT NOT NULL CHECK (period IN ('24h','7d','30d')),
  top_posts TEXT,
  rollup_date TEXT NOT NULL,
  computed_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(card_id, source, period, rollup_date)
);

CREATE INDEX idx_sentiment_card ON sentiment_scores(card_id, rollup_date DESC);

-- ─── New: dedup index on price_observations ───
CREATE UNIQUE INDEX IF NOT EXISTS idx_price_obs_dedup ON price_observations(card_id, source, listing_url) WHERE listing_url IS NOT NULL;
