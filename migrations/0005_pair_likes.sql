-- Additive only: a new table the previous Worker never reads, so it is safe to apply before the deploy.
-- One like per user per rhyme pair; likes only reorder relations and never change points.
CREATE TABLE IF NOT EXISTS pair_likes (
  pair_id TEXT NOT NULL REFERENCES rhyme_pairs(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  PRIMARY KEY (pair_id, user_id)
);
CREATE INDEX IF NOT EXISTS pair_likes_user ON pair_likes(user_id, created_at DESC);
