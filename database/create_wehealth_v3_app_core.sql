-- WeHealth v3 App Core Schema
-- Minimal tables for: users/auth OTP/reset, checkins, community posts/comments/likes.
-- Designed to scale from tiny usage to very large workloads.

BEGIN;

-- 1) Users (single source of truth for registration/login identities)
CREATE TABLE IF NOT EXISTS users (
  user_id UUID PRIMARY KEY,
  email TEXT NOT NULL,
  username TEXT,
  password TEXT,
  email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_users_email UNIQUE (email),
  CONSTRAINT uq_users_username UNIQUE (username)
);

CREATE INDEX IF NOT EXISTS idx_users_created_at ON users(created_at DESC);

-- 2) OTP codes (single table for registration OTP + login OTP + password-reset OTP)
-- purpose values: registration, login, password_reset
CREATE TABLE IF NOT EXISTS otp_codes (
  otp_id BIGSERIAL PRIMARY KEY,
  email TEXT NOT NULL,
  purpose VARCHAR(32) NOT NULL,
  otp TEXT NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  attempts_count INT NOT NULL DEFAULT 0,
  used_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_otp_email_purpose UNIQUE (email, purpose),
  CONSTRAINT ck_otp_purpose CHECK (purpose IN ('registration', 'login', 'password_reset'))
);

CREATE INDEX IF NOT EXISTS idx_otp_lookup_active
  ON otp_codes(email, purpose, expires_at DESC)
  WHERE used_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_otp_expires_at ON otp_codes(expires_at);

-- 3) User check-ins (daily tracker)
CREATE TABLE IF NOT EXISTS user_checkins (
  checkin_id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  mood_score SMALLINT CHECK (mood_score BETWEEN 1 AND 10),
  energy_level SMALLINT CHECK (energy_level BETWEEN 1 AND 10),
  sleep_hours NUMERIC(4,1),
  symptoms TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  body_changes TEXT,
  emotions TEXT,
  notes TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_checkins_user_created
  ON user_checkins(user_id, created_at DESC);

-- 4) Community posts
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

CREATE INDEX IF NOT EXISTS idx_community_posts_user_created
  ON community_posts(user_id, created_at DESC);

-- 5) Community comments
CREATE TABLE IF NOT EXISTS post_comments (
  comment_id BIGSERIAL PRIMARY KEY,
  post_id BIGINT NOT NULL REFERENCES community_posts(post_id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_post_comments_post_created
  ON post_comments(post_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_post_comments_user_created
  ON post_comments(user_id, created_at DESC);

-- 6) Post likes (many-to-many user <-> post)
CREATE TABLE IF NOT EXISTS post_likes (
  post_id BIGINT NOT NULL REFERENCES community_posts(post_id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (post_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_post_likes_post ON post_likes(post_id);
CREATE INDEX IF NOT EXISTS idx_post_likes_user ON post_likes(user_id);

-- Backward compatibility migration for older schemas where otp_codes existed without purpose.
ALTER TABLE otp_codes ADD COLUMN IF NOT EXISTS purpose VARCHAR(32) DEFAULT 'registration';
ALTER TABLE otp_codes ADD COLUMN IF NOT EXISTS attempts_count INT NOT NULL DEFAULT 0;
ALTER TABLE otp_codes ADD COLUMN IF NOT EXISTS used_at TIMESTAMP;
ALTER TABLE otp_codes ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT NOW();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ck_otp_purpose'
  ) THEN
    ALTER TABLE otp_codes
      ADD CONSTRAINT ck_otp_purpose
      CHECK (purpose IN ('registration', 'login', 'password_reset'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'uq_otp_email_purpose'
  ) THEN
    ALTER TABLE otp_codes
      ADD CONSTRAINT uq_otp_email_purpose UNIQUE (email, purpose);
  END IF;
END $$;

COMMIT;
