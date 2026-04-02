-- Stage 1 for wehealth_v3
-- Scope: ingestion only

BEGIN;

CREATE TABLE IF NOT EXISTS pipeline_runs (
  run_id BIGSERIAL PRIMARY KEY,
  pipeline_name TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  status TEXT NOT NULL,
  CONSTRAINT chk_pipeline_status CHECK (status IN ('running', 'success', 'failed'))
);

CREATE TABLE IF NOT EXISTS raw_reddit_posts (
  post_id UUID PRIMARY KEY,
  source_post_id TEXT NOT NULL UNIQUE,
  title_text TEXT,
  body_text TEXT,
  subreddit_name TEXT,
  source_created_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_raw_reddit_posts_source_created
  ON raw_reddit_posts(source_created_at DESC);

CREATE TABLE IF NOT EXISTS raw_reddit_comments (
  comment_id UUID PRIMARY KEY,
  source_post_id TEXT NOT NULL,
  comment_text TEXT NOT NULL,
  comment_order INTEGER NOT NULL,
  CONSTRAINT fk_raw_comments_source_post
    FOREIGN KEY (source_post_id)
    REFERENCES raw_reddit_posts(source_post_id)
    ON DELETE CASCADE,
  CONSTRAINT uq_raw_comment_order_per_post
    UNIQUE (source_post_id, comment_order)
);

CREATE INDEX IF NOT EXISTS idx_raw_reddit_comments_source_post
  ON raw_reddit_comments(source_post_id);

COMMIT;
