-- Additive only: the database is shared with Workers that predate these tables and never read them.
CREATE TABLE IF NOT EXISTS search_counts (
  normalized TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  first_searched_at TEXT NOT NULL,
  last_searched_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS search_counts_hot ON search_counts(count DESC, last_searched_at DESC);
-- One row per client, day and word: a client adds at most one count per word per day.
CREATE TABLE IF NOT EXISTS search_hits (
  client TEXT NOT NULL,
  day TEXT NOT NULL,
  normalized TEXT NOT NULL,
  PRIMARY KEY (client, day, normalized)
);
CREATE INDEX IF NOT EXISTS search_hits_day ON search_hits(day);
