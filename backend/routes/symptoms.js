const express = require("express");
const router = express.Router();
const pool = require("../db");
const { categorizeMenotype, MENOTYPES } = require("../utils/menotype_categorizer");

const ACTIVE_MODEL = "we-gpt-4.1";

function normalizeToken(value) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[\s-]+/g, "_")
    .replace(/[^a-z0-9_]/g, "")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

async function normalizeSymptomsInput(symptoms) {
  const input = Array.isArray(symptoms) ? symptoms : [];
  const out = [];

  for (const symptom of input) {
    const token = normalizeToken(symptom);
    if (!token) continue;

    const exact = await pool.query(
      `SELECT canonical_name
         FROM symptom_vocab
        WHERE canonical_name = $1
          AND canonical_name <> 'other_symptom'
        LIMIT 1`,
      [token],
    );
    if (exact.rows.length > 0) {
      const c = exact.rows[0].canonical_name;
      if (!out.includes(c)) out.push(c);
      continue;
    }

    const alias = await pool.query(
      `SELECT canonical_name
         FROM symptom_aliases
        WHERE alias = $1
          AND canonical_name <> 'other_symptom'
        LIMIT 1`,
      [token],
    );
    if (alias.rows.length > 0) {
      const c = alias.rows[0].canonical_name;
      if (!out.includes(c)) out.push(c);
      continue;
    }

    const fuzzy = `%${token}%`;
    const aliasFuzzy = await pool.query(
      `SELECT canonical_name
         FROM symptom_aliases
        WHERE alias LIKE $1 OR $2 LIKE ('%' || alias || '%')
          AND canonical_name <> 'other_symptom'
        ORDER BY LENGTH(alias) ASC
        LIMIT 1`,
      [fuzzy, token],
    );
    if (aliasFuzzy.rows.length > 0) {
      const c = aliasFuzzy.rows[0].canonical_name;
      if (!out.includes(c)) out.push(c);
    }
  }

  return out;
}

router.get("/", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT canonical_name
         FROM symptom_vocab
        WHERE canonical_name <> 'other_symptom'
        ORDER BY canonical_name`,
    );

    res.json(result.rows.map((r) => ({ canonical_symptom: r.canonical_name })));
  } catch (err) {
    console.error(err);
    res.status(500).send("Server error");
  }
});

router.post("/women-like-me", async (req, res) => {
  try {
    const { symptoms } = req.body;

    if (!symptoms || !Array.isArray(symptoms) || symptoms.length === 0) {
      return res.status(400).json({ error: "Symptoms array is required" });
    }

    const canonicalSymptoms = await normalizeSymptomsInput(symptoms);
    if (canonicalSymptoms.length === 0) {
      return res.status(400).json({ error: "No recognizable symptoms found" });
    }

    const menotype = await categorizeMenotype(canonicalSymptoms);

    const cohortSizeRes = await pool.query(
      `SELECT COUNT(*)::int AS n
         FROM menotype_ml_profiles
        WHERE model_name = $1
          AND primary_menotype = $2`,
      [ACTIVE_MODEL, menotype.menotype_id],
    );
    const similarUsers = cohortSizeRes.rows[0]?.n || 0;

    const topSymptomsRes = await pool.query(
      `SELECT cs.canonical_name AS canonical_symptom,
              COUNT(*)::int AS count
         FROM menotype_ml_profiles m
         JOIN canonical_symptoms cs ON cs.extraction_id::text = m.extraction_id
        WHERE m.model_name = $1
          AND m.primary_menotype = $2
          AND cs.canonical_name <> 'other_symptom'
        GROUP BY cs.canonical_name
        ORDER BY count DESC
        LIMIT 10`,
      [ACTIVE_MODEL, menotype.menotype_id],
    );

    const topTreatmentsRes = await pool.query(
      `SELECT ct.canonical_name AS canonical_treatment,
              COUNT(*)::int AS count
         FROM menotype_ml_profiles m
         JOIN canonical_treatments ct ON ct.extraction_id::text = m.extraction_id
        WHERE m.model_name = $1
          AND m.primary_menotype = $2
          AND ct.canonical_name <> 'other_treatment'
        GROUP BY ct.canonical_name
        ORDER BY count DESC
        LIMIT 10`,
      [ACTIVE_MODEL, menotype.menotype_id],
    );

    const workedRes = await pool.query(
      `WITH s AS (
         SELECT ct.canonical_name,
                COUNT(*) FILTER (WHERE ct.reported_effect='positive')::int AS pos_n,
                COUNT(*) FILTER (WHERE ct.reported_effect='negative')::int AS neg_n,
                COUNT(*) FILTER (WHERE ct.reported_effect IS NOT NULL)::int AS known_n
           FROM menotype_ml_profiles m
           JOIN canonical_treatments ct ON ct.extraction_id::text = m.extraction_id
          WHERE m.model_name = $1
            AND m.primary_menotype = $2
            AND ct.canonical_name <> 'other_treatment'
          GROUP BY ct.canonical_name
       )
       SELECT canonical_name AS treatment,
              pos_n, neg_n, known_n,
              ROUND((pos_n - neg_n)::numeric / NULLIF(known_n, 0), 3) AS net_score
         FROM s
        WHERE known_n >= 8
        ORDER BY net_score DESC, known_n DESC
        LIMIT 8`,
      [ACTIVE_MODEL, menotype.menotype_id],
    );

    const didntWorkRes = await pool.query(
      `WITH s AS (
         SELECT ct.canonical_name,
                COUNT(*) FILTER (WHERE ct.reported_effect='positive')::int AS pos_n,
                COUNT(*) FILTER (WHERE ct.reported_effect='negative')::int AS neg_n,
                COUNT(*) FILTER (WHERE ct.reported_effect IS NOT NULL)::int AS known_n
           FROM menotype_ml_profiles m
           JOIN canonical_treatments ct ON ct.extraction_id::text = m.extraction_id
          WHERE m.model_name = $1
            AND m.primary_menotype = $2
            AND ct.canonical_name <> 'other_treatment'
          GROUP BY ct.canonical_name
       )
       SELECT canonical_name AS treatment,
              pos_n, neg_n, known_n,
              ROUND((pos_n - neg_n)::numeric / NULLIF(known_n, 0), 3) AS net_score
         FROM s
        WHERE known_n >= 8
        ORDER BY net_score ASC, known_n DESC
        LIMIT 8`,
      [ACTIVE_MODEL, menotype.menotype_id],
    );

    const recentCommunityRes = await pool.query(
      `SELECT p.post_id, p.content, p.created_at, u.username,
              COALESCE(l.likes_count, 0)::int AS likes_count,
              COALESCE(c.comments_count, 0)::int AS comments_count
         FROM community_posts p
         JOIN users u ON u.user_id = p.user_id
         LEFT JOIN (
           SELECT post_id, COUNT(*) AS likes_count FROM post_likes GROUP BY post_id
         ) l ON l.post_id = p.post_id
         LEFT JOIN (
           SELECT post_id, COUNT(*) AS comments_count FROM post_comments GROUP BY post_id
         ) c ON c.post_id = p.post_id
        ORDER BY p.created_at DESC
        LIMIT 5`,
    );

    res.json({
      input_symptoms: canonicalSymptoms,
      menotype: {
        id: menotype.menotype_id,
        name: menotype.menotype_name,
        confidence: menotype.confidence,
        reasoning: menotype.reasoning,
        definition: MENOTYPES[menotype.menotype_id]?.description || null,
      },
      similar_users: similarUsers,
      top_symptoms: topSymptomsRes.rows,
      top_treatments: topTreatmentsRes.rows,
      worked_best: workedRes.rows,
      didnt_work_best: didntWorkRes.rows,
      recent_community_posts: recentCommunityRes.rows,
    });
  } catch (err) {
    console.error("Women-like-me error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;