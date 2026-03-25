-- Frontend V1 core tables for tracker + community

CREATE TABLE IF NOT EXISTS user_checkins (
  checkin_id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  mood_score SMALLINT CHECK (mood_score BETWEEN 1 AND 10),
  energy_level SMALLINT CHECK (energy_level BETWEEN 1 AND 10),
  sleep_hours NUMERIC(4,1),
  symptoms TEXT[] DEFAULT ARRAY[]::TEXT[],
  body_changes TEXT,
  emotions TEXT,
  notes TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_checkins_user_created
  ON user_checkins(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS community_posts (
  post_id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  image_url TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_community_posts_created
  ON community_posts(created_at DESC);

CREATE TABLE IF NOT EXISTS post_comments (
  comment_id BIGSERIAL PRIMARY KEY,
  post_id BIGINT NOT NULL REFERENCES community_posts(post_id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_post_comments_post_created
  ON post_comments(post_id, created_at ASC);

CREATE TABLE IF NOT EXISTS post_likes (
  post_id BIGINT NOT NULL REFERENCES community_posts(post_id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (post_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_post_likes_post
  ON post_likes(post_id);
