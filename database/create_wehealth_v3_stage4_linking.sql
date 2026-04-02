-- WeHealth v3 Stage 4 (active):
--   1) treatment effectiveness from canonical_treatments.reported_effect
--   2) ML menotype profiles
--   3) menotype -> treatment outcomes
--
-- Legacy Stage 4 link-table artifacts are intentionally retired.

-- Retire legacy objects from previous heuristic/explicit link-table approach.
DROP VIEW IF EXISTS top_treatments_by_symptom_heuristic CASCADE;
DROP VIEW IF EXISTS symptom_cooccurrence_with_treatment CASCADE;
DROP VIEW IF EXISTS treatment_effectiveness_heuristic CASCADE;
DROP VIEW IF EXISTS treatment_effectiveness_explicit CASCADE;
DROP TABLE IF EXISTS treatment_symptom_link CASCADE;

-- Symptom frequency matrix: per-post mention rates (float 0.0–1.0) per symptom.
-- Aggregates all extractions per post, storing how often each symptom was mentioned
-- across the post's extractions. More informative than binary 0/1 presence.
DROP MATERIALIZED VIEW IF EXISTS symptom_frequency_matrix CASCADE;
CREATE MATERIALIZED VIEW symptom_frequency_matrix AS
WITH post_extraction_counts AS (
    SELECT source_post_id,
           COUNT(DISTINCT extraction_id) AS total_extractions
    FROM canonical_symptoms
    GROUP BY source_post_id
),
symptom_mention_counts AS (
    SELECT cs.source_post_id,
           cs.canonical_name,
           COUNT(DISTINCT cs.extraction_id) AS mention_count
    FROM canonical_symptoms cs
    GROUP BY cs.source_post_id, cs.canonical_name
)
SELECT
    smc.source_post_id,
    pec.total_extractions::int,
    jsonb_object_agg(
        smc.canonical_name,
        ROUND(smc.mention_count::numeric / pec.total_extractions, 4)
    ) AS symptom_rates
FROM symptom_mention_counts smc
JOIN post_extraction_counts pec ON pec.source_post_id = smc.source_post_id
GROUP BY smc.source_post_id, pec.total_extractions;

-- Unique index required for REFRESH CONCURRENTLY and fast lookup.
CREATE UNIQUE INDEX idx_sfm_post_id ON symptom_frequency_matrix(source_post_id);

-- Stage 4 effectiveness from Stage 3 canonical treatments.
CREATE OR REPLACE VIEW treatment_effectiveness_stage4 AS
SELECT
    ct.canonical_name AS treatment_canonical_name,
    ct.treatment_type,
    COUNT(*) AS mention_count,
    COUNT(*) FILTER (WHERE ct.reported_effect = 'positive') AS positive_count,
    COUNT(*) FILTER (WHERE ct.reported_effect = 'negative') AS negative_count,
    COUNT(*) FILTER (WHERE ct.reported_effect = 'neutral')  AS neutral_count,
    COUNT(*) FILTER (WHERE ct.reported_effect = 'mixed')    AS mixed_count,
    ROUND(
        100.0 * COUNT(*) FILTER (WHERE ct.reported_effect = 'positive')
        / NULLIF(COUNT(*) FILTER (WHERE ct.reported_effect IN ('positive', 'negative', 'neutral', 'mixed')), 0),
        2
    ) AS positive_rate_pct
FROM canonical_treatments ct
GROUP BY ct.canonical_name, ct.treatment_type;

-- Menotype ML profiles (one row per source_post_id per model_name).
CREATE TABLE IF NOT EXISTS menotype_ml_profiles (
    id BIGSERIAL PRIMARY KEY,
    source_post_id TEXT NOT NULL,
    model_name VARCHAR(50) NOT NULL,
    cluster_id INT NOT NULL,
    primary_menotype VARCHAR(50) NOT NULL,
    secondary_menotype VARCHAR(50),
    confidence NUMERIC(4,3),
    symptom_count INT NOT NULL,
    extraction_count INT NOT NULL,
    top_symptoms JSONB NOT NULL DEFAULT '[]'::jsonb,
    domain_scores JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_menotype_ml_profiles UNIQUE (source_post_id, model_name)
);

CREATE INDEX IF NOT EXISTS idx_menotype_ml_model ON menotype_ml_profiles(model_name);
CREATE INDEX IF NOT EXISTS idx_menotype_ml_primary ON menotype_ml_profiles(primary_menotype);

-- Cluster naming metadata (one row per model x cluster).
CREATE TABLE IF NOT EXISTS menotype_cluster_labels (
    id BIGSERIAL PRIMARY KEY,
    model_name VARCHAR(50) NOT NULL,
    cluster_id INT NOT NULL,
    cluster_label VARCHAR(100) NOT NULL,
    label_notes TEXT,
    top_symptoms JSONB NOT NULL DEFAULT '[]'::jsonb,
    domain_scores JSONB NOT NULL DEFAULT '[]'::jsonb,
    cluster_size INT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_menotype_cluster_label UNIQUE (model_name, cluster_id)
);

CREATE INDEX IF NOT EXISTS idx_menotype_cluster_labels_model ON menotype_cluster_labels(model_name);

-- Menotype -> treatment outcome aggregation.
CREATE OR REPLACE VIEW menotype_treatment_outcomes_ml AS
SELECT
    mp.model_name,
    mp.primary_menotype,
    COALESCE(mp.secondary_menotype, 'none') AS secondary_menotype,
    ct.canonical_name AS treatment_canonical_name,
    COUNT(*) AS mention_count,
    COUNT(*) FILTER (WHERE ct.reported_effect = 'positive') AS positive_count,
    COUNT(*) FILTER (WHERE ct.reported_effect = 'negative') AS negative_count,
    COUNT(*) FILTER (WHERE ct.reported_effect = 'neutral')  AS neutral_count,
    COUNT(*) FILTER (WHERE ct.reported_effect = 'mixed')    AS mixed_count,
    ROUND(
        100.0 * COUNT(*) FILTER (WHERE ct.reported_effect = 'positive')
        / NULLIF(COUNT(*) FILTER (WHERE ct.reported_effect IN ('positive', 'negative', 'neutral', 'mixed')), 0),
        2
    ) AS positive_rate_pct,
    ROUND(AVG(mp.confidence), 3) AS avg_profile_confidence
FROM menotype_ml_profiles mp
JOIN canonical_treatments ct
  ON ct.source_post_id = mp.source_post_id
GROUP BY
    mp.model_name,
    mp.primary_menotype,
    COALESCE(mp.secondary_menotype, 'none'),
    ct.canonical_name;

-- Named profile view for easy manual verification.
CREATE OR REPLACE VIEW menotype_profiles_named AS
SELECT
    mp.model_name,
    mp.source_post_id,
    mp.cluster_id,
    mp.primary_menotype,
    mcl.cluster_label,
    mp.secondary_menotype,
    mp.confidence,
    mp.symptom_count,
    mp.extraction_count,
    mp.top_symptoms,
    mp.domain_scores
FROM menotype_ml_profiles mp
LEFT JOIN menotype_cluster_labels mcl
  ON mcl.model_name = mp.model_name
 AND mcl.cluster_id = mp.cluster_id;
