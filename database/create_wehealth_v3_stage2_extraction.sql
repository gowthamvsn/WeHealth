-- WeHealth v3 Stage 2: Reddit Extractions
-- One row per source document per model run
-- Populated by stage2_extract_reddit.js
--
-- comment_order uses -1 as sentinel for posts (NOT NULL so UNIQUE constraint fires)
-- model_name is included in UNIQUE key so multiple models can each produce a row
--   for the same document (model versioning / A-B comparison)
--
-- extracted_json shape (v1):
-- {
--   "current_age": <int|null>,
--   "menopause_onset_age": <int|null>,
--   "menopause_stage": "perimenopause|menopause|postmenopause|surgical_menopause|unknown|null",
--   "symptoms": [
--     { "name": <str>, "onset_description": <str|null>,
--       "severity": "mild|moderate|severe|null", "resolved": <bool|null> }
--   ],
--   "treatments": [
--     { "name": <str>, "type": "medication|supplement|lifestyle|procedure|other",
--       "reported_effect": "positive|negative|neutral|mixed|null",
--       "side_effects": [<str>], "duration_description": <str|null> }
--   ],
--   "emotional_tone": "positive|negative|neutral|mixed|null",
--   "seeking_advice": <bool>,
--   "sharing_experience": <bool>,
--   "notes": <str|null>
-- }

-- Add notes column to pipeline_runs if not already present
ALTER TABLE pipeline_runs ADD COLUMN IF NOT EXISTS notes TEXT;

CREATE TABLE IF NOT EXISTS reddit_extractions (
    extraction_id       UUID        PRIMARY KEY,
    source_type         TEXT        NOT NULL CHECK (source_type IN ('post', 'comment')),
    source_post_id      TEXT        NOT NULL,
    comment_order       INTEGER     NOT NULL DEFAULT -1,  -- -1 = post, >=0 = comment
    model_name          TEXT        NOT NULL,
    prompt_version      TEXT        NOT NULL,
    extracted_json      JSONB,
    status              TEXT        NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending', 'done', 'error')),
    error_message       TEXT,
    extracted_at        TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (source_post_id, source_type, comment_order, model_name, prompt_version)
);
