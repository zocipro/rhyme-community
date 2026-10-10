-- Expand the kind constraint while preserving all first submissions and scores.
CREATE TABLE answers_expanded (
  id TEXT PRIMARY KEY,
  topic_id TEXT NOT NULL REFERENCES topics(id),
  text TEXT NOT NULL,
  normalized TEXT NOT NULL UNIQUE,
  readings TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('final','tone','perfect','mixed')),
  points INTEGER NOT NULL,
  author_id TEXT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','withdrawn')),
  created_at TEXT NOT NULL
);
INSERT INTO answers_expanded SELECT id,topic_id,text,normalized,readings,kind,points,author_id,status,created_at FROM answers;
DROP TABLE answers;
ALTER TABLE answers_expanded RENAME TO answers;
CREATE INDEX answers_topic ON answers(topic_id, created_at DESC);
CREATE INDEX answers_author ON answers(author_id, status);
