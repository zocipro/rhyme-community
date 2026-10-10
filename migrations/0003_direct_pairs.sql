-- Add the direct-pair model; legacy topics and answers remain an internal archive.
CREATE TABLE words (
  id TEXT PRIMARY KEY,
  text TEXT NOT NULL,
  normalized TEXT NOT NULL UNIQUE,
  readings TEXT NOT NULL,
  n INTEGER NOT NULL CHECK(n >= 2),
  created_at TEXT NOT NULL
);
CREATE TABLE submissions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  request_id TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  pair_count INTEGER NOT NULL,
  points INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(user_id,request_id)
);
CREATE TABLE rhyme_pairs (
  id TEXT PRIMARY KEY,
  left_word_id TEXT NOT NULL REFERENCES words(id),
  right_word_id TEXT NOT NULL REFERENCES words(id),
  left_text TEXT NOT NULL,
  right_text TEXT NOT NULL,
  left_readings TEXT NOT NULL,
  right_readings TEXT NOT NULL,
  n INTEGER NOT NULL CHECK(n >= 2),
  kind TEXT NOT NULL CHECK(kind IN ('final','tone','perfect','mixed')),
  points INTEGER NOT NULL,
  author_id TEXT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','withdrawn')),
  created_at TEXT NOT NULL,
  submission_id TEXT REFERENCES submissions(id),
  CHECK(left_word_id < right_word_id),
  UNIQUE(left_word_id,right_word_id)
);
CREATE INDEX rhyme_pairs_right ON rhyme_pairs(right_word_id,status);
CREATE INDEX rhyme_pairs_left ON rhyme_pairs(left_word_id,status);
CREATE INDEX rhyme_pairs_author ON rhyme_pairs(author_id,created_at DESC);
CREATE INDEX rhyme_pairs_submission ON rhyme_pairs(submission_id);
CREATE TABLE score_entries (
  id TEXT PRIMARY KEY,
  pair_id TEXT NOT NULL REFERENCES rhyme_pairs(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  points INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('active','withdrawn')),
  source TEXT NOT NULL CHECK(source IN ('legacy','submission')),
  source_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(source,source_id)
);
CREATE INDEX score_entries_user ON score_entries(user_id,created_at DESC);
CREATE INDEX score_entries_pair ON score_entries(pair_id,status);
CREATE TABLE legacy_word_mapping (
  source TEXT NOT NULL CHECK(source IN ('topic','answer')),
  legacy_id TEXT NOT NULL,
  word_id TEXT NOT NULL REFERENCES words(id),
  PRIMARY KEY(source,legacy_id)
);

WITH records AS (
  SELECT t.id,t.text,t.normalized,t.readings,t.created_at,'topic' AS source FROM topics t WHERE EXISTS(SELECT 1 FROM answers a WHERE a.topic_id=t.id AND a.normalized<>t.normalized)
  UNION ALL
  SELECT a.id,a.text,a.normalized,a.readings,a.created_at,'answer' FROM answers a JOIN topics t ON t.id=a.topic_id WHERE a.normalized<>t.normalized
), ranked AS (
  SELECT *,MIN(id) OVER (PARTITION BY normalized) AS source_id,ROW_NUMBER() OVER (PARTITION BY normalized ORDER BY created_at,id,source) AS rank FROM records
)
INSERT INTO words(id,text,normalized,readings,n,created_at)
SELECT 'legacy-word-'||source_id,text,normalized,readings,json_array_length(readings),created_at FROM ranked WHERE rank=1;

WITH records AS (
  SELECT a.*,t.text AS topic_text,t.normalized AS topic_normalized,t.readings AS topic_readings,t.status AS topic_status,t.n,
    CASE WHEN t.normalized<a.normalized THEN t.normalized ELSE a.normalized END AS low,
    CASE WHEN t.normalized<a.normalized THEN a.normalized ELSE t.normalized END AS high
  FROM answers a JOIN topics t ON t.id=a.topic_id WHERE a.normalized<>t.normalized
), ranked AS (
  SELECT *,ROW_NUMBER() OVER (PARTITION BY low,high ORDER BY created_at,id) AS first_rank,
    ROW_NUMBER() OVER (PARTITION BY low,high ORDER BY CASE WHEN status='active' AND topic_status='active' THEN 0 ELSE 1 END,created_at,id) AS payload_rank,
    MAX(CASE WHEN status='active' AND topic_status='active' THEN 1 ELSE 0 END) OVER (PARTITION BY low,high) AS active
  FROM records
)
INSERT INTO rhyme_pairs(id,left_word_id,right_word_id,left_text,right_text,left_readings,right_readings,n,kind,points,author_id,status,created_at,submission_id)
SELECT first.id,
  CASE WHEN tw.id<aw.id THEN tw.id ELSE aw.id END,
  CASE WHEN tw.id<aw.id THEN aw.id ELSE tw.id END,
  CASE WHEN tw.id<aw.id THEN payload.topic_text ELSE payload.text END,
  CASE WHEN tw.id<aw.id THEN payload.text ELSE payload.topic_text END,
  CASE WHEN tw.id<aw.id THEN payload.topic_readings ELSE payload.readings END,
  CASE WHEN tw.id<aw.id THEN payload.readings ELSE payload.topic_readings END,
  payload.n,payload.kind,payload.points,first.author_id,CASE WHEN payload.active=1 THEN 'active' ELSE 'withdrawn' END,first.created_at,NULL
FROM ranked first JOIN ranked payload ON payload.low=first.low AND payload.high=first.high AND payload.payload_rank=1
  JOIN words tw ON tw.normalized=payload.topic_normalized JOIN words aw ON aw.normalized=payload.normalized
WHERE first.first_rank=1;

INSERT INTO score_entries(id,pair_id,user_id,points,status,source,source_id,created_at)
SELECT 'legacy-score-'||a.id,p.id,a.author_id,a.points,CASE WHEN a.status='active' AND t.status='active' THEN 'active' ELSE 'withdrawn' END,'legacy',a.id,a.created_at
FROM answers a JOIN topics t ON t.id=a.topic_id JOIN words tw ON tw.normalized=t.normalized JOIN words aw ON aw.normalized=a.normalized
  JOIN rhyme_pairs p ON p.left_word_id=CASE WHEN tw.id<aw.id THEN tw.id ELSE aw.id END AND p.right_word_id=CASE WHEN tw.id<aw.id THEN aw.id ELSE tw.id END;
INSERT INTO legacy_word_mapping(source,legacy_id,word_id)
SELECT 'topic',t.id,w.id FROM topics t JOIN words w ON w.normalized=t.normalized
UNION ALL
SELECT 'answer',a.id,w.id FROM answers a JOIN words w ON w.normalized=a.normalized;

CREATE TABLE moderation_pairs (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL CHECK(entity_type IN ('topic','answer','pair','user')),
  entity_id TEXT NOT NULL,
  admin_id TEXT NOT NULL REFERENCES users(id),
  reason TEXT NOT NULL,
  action TEXT NOT NULL,
  created_at TEXT NOT NULL
);
INSERT INTO moderation_pairs SELECT * FROM moderation;
DROP TABLE moderation;
ALTER TABLE moderation_pairs RENAME TO moderation;
-- The deploy script controls content_write_paused independently.
INSERT INTO settings(key,value) VALUES('pair_model_ready','1') ON CONFLICT(key) DO UPDATE SET value='1';
