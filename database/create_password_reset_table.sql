-- Add password reset columns to users table
-- Run this SQL migration in your PostgreSQL database

ALTER TABLE users ADD COLUMN reset_token TEXT;
ALTER TABLE users ADD COLUMN reset_token_expires_at TIMESTAMP;

-- Optional: Create index for faster lookups during reset
CREATE INDEX IF NOT EXISTS idx_users_reset_token ON users (reset_token);

