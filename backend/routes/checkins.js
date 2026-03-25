const express = require("express");
const router = express.Router();
const pool = require("../db");

router.get("/", async (req, res) => {
  const limit = Number.parseInt(req.query.limit || "20", 10);
  const safeLimit = Number.isNaN(limit) ? 20 : Math.min(Math.max(limit, 1), 100);

  try {
    const result = await pool.query(
      `SELECT checkin_id, mood_score, energy_level, sleep_hours, symptoms,
              body_changes, emotions, notes, created_at
       FROM user_checkins
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [req.user.userId, safeLimit]
    );

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch check-ins" });
  }
});

router.post("/", async (req, res) => {
  const {
    mood_score,
    energy_level,
    sleep_hours,
    symptoms,
    body_changes,
    emotions,
    notes
  } = req.body;

  const rawSymptoms = Array.isArray(symptoms)
    ? symptoms
        .map((item) => String(item).trim().toLowerCase())
        .filter((item) => item.length > 0)
    : [];

  try {
    // Normalize symptoms using symptom_mapping table
    const canonicalSymptoms = [];
    for (const rawSymptom of rawSymptoms) {
      const fuzzyToken = `%${rawSymptom}%`;
      const mappingResult = await pool.query(
        `SELECT canonical_symptom
         FROM symptom_mapping
         WHERE LOWER(raw_symptom) = $1
            OR LOWER(raw_symptom) LIKE $2
            OR $1 LIKE ('%' || LOWER(raw_symptom) || '%')
         ORDER BY
           CASE
             WHEN LOWER(raw_symptom) = $1 THEN 0
             WHEN LOWER(raw_symptom) LIKE $2 THEN 1
             ELSE 2
           END,
           LENGTH(raw_symptom) ASC
         LIMIT 1`,
        [rawSymptom, fuzzyToken]
      );
      
      if (mappingResult.rows.length > 0) {
        const canonical = mappingResult.rows[0].canonical_symptom;
        if (!canonicalSymptoms.includes(canonical)) {
          canonicalSymptoms.push(canonical);
        }
      } else {
        // Symptom-family fallback for common phrasing not present in mapping table.
        if (/\b(gut|stomach|abdomen|acid|acidity|bloat|bloating|indigestion|digestive)\b/i.test(rawSymptom)) {
          if (!canonicalSymptoms.includes("digestive issues")) {
            canonicalSymptoms.push("digestive issues");
          }
          continue;
        }

        // Fallback to canonical dictionary LIKE match.
        const dictionaryResult = await pool.query(
          `SELECT canonical_symptom
           FROM symptom_dictionary
           WHERE LOWER(canonical_symptom) LIKE $1
              OR $2 LIKE ('%' || LOWER(canonical_symptom) || '%')
           ORDER BY LENGTH(canonical_symptom) ASC
           LIMIT 1`,
          [fuzzyToken, rawSymptom]
        );

        if (dictionaryResult.rows.length > 0) {
          const canonical = dictionaryResult.rows[0].canonical_symptom;
          if (!canonicalSymptoms.includes(canonical)) {
            canonicalSymptoms.push(canonical);
          }
        } else if (!canonicalSymptoms.includes(rawSymptom)) {
          // If still no match, store raw symptom as-is.
          canonicalSymptoms.push(rawSymptom);
        }
      }
    }

    const result = await pool.query(
      `INSERT INTO user_checkins (
         user_id, mood_score, energy_level, sleep_hours, symptoms,
         body_changes, emotions, notes, created_at, updated_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
       RETURNING checkin_id, mood_score, energy_level, sleep_hours, symptoms,
                 body_changes, emotions, notes, created_at`,
      [
        req.user.userId,
        mood_score ?? null,
        energy_level ?? null,
        sleep_hours ?? null,
        canonicalSymptoms,
        body_changes ?? null,
        emotions ?? null,
        notes ?? null
      ]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("Checkin creation error:", err);
    res.status(500).json({ error: "Failed to create check-in" });
  }
});

module.exports = router;
