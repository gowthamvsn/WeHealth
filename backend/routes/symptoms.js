const express = require("express");
const router = express.Router();
const pool = require("../db");

router.get("/", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT canonical_symptom FROM symptom_dictionary ORDER BY canonical_symptom"
    );

    res.json(result.rows);
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

    // Normalize input symptoms using exact + LIKE matching.
    const inputCanonicalSymptoms = [];
    const inputCanonicalSymptomsLower = [];
    for (const symptom of symptoms) {
      const rawLower = String(symptom).toLowerCase().trim();
      const fuzzyToken = `%${rawLower}%`;
      
      let mappingResult = await pool.query(
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
        [rawLower, fuzzyToken]
      );
      
      if (mappingResult.rows.length > 0) {
        const canonical = mappingResult.rows[0].canonical_symptom;
        if (!inputCanonicalSymptoms.includes(canonical)) {
          inputCanonicalSymptoms.push(canonical);
          inputCanonicalSymptomsLower.push(canonical.toLowerCase());
        }
      } else {
        if (/\b(gut|stomach|abdomen|acid|acidity|bloat|bloating|indigestion|digestive)\b/i.test(rawLower)) {
          if (!inputCanonicalSymptomsLower.includes("digestive issues")) {
            inputCanonicalSymptoms.push("digestive issues");
            inputCanonicalSymptomsLower.push("digestive issues");
          }
          continue;
        }

        // Fallback to LIKE match on symptom_dictionary
        let dictResult = await pool.query(
          `SELECT canonical_symptom
           FROM symptom_dictionary
           WHERE LOWER(canonical_symptom) LIKE $1
              OR $2 LIKE ('%' || LOWER(canonical_symptom) || '%')
            ORDER BY LENGTH(canonical_symptom) ASC, symptom_id ASC
           LIMIT 1`,
          [fuzzyToken, rawLower]
        );
        
        if (dictResult.rows.length > 0) {
          const canonical = dictResult.rows[0].canonical_symptom;
          if (!inputCanonicalSymptoms.includes(canonical)) {
            inputCanonicalSymptoms.push(canonical);
            inputCanonicalSymptomsLower.push(canonical.toLowerCase());
          }
        } else {
          return res.status(400).json({
            error: `No matching symptom found for: ${symptom}`
          });
        }
      }
    }

    // Find users with ALL input symptoms from normalized check-ins.
    const cohortQuery = await pool.query(
      `WITH user_symptoms AS (
         SELECT uc.user_id,
                ARRAY_AGG(DISTINCT LOWER(symptom)) AS symptom_list
         FROM user_checkins uc
         CROSS JOIN LATERAL unnest(uc.symptoms) AS symptom
         GROUP BY uc.user_id
       )
       SELECT user_id
       FROM user_symptoms
       WHERE symptom_list @> $1::TEXT[]`,
      [inputCanonicalSymptomsLower]
    );

    const similarUserIds = cohortQuery.rows.map(row => row.user_id);
    const similarUsers = similarUserIds.length;

    if (similarUsers === 0) {
      return res.json({
        input_symptoms: inputCanonicalSymptoms,
        similar_users: 0,
        top_symptoms: [],
        top_treatments: [],
        success_rates: []
      });
    }

    // Find co-occurring symptoms in the cohort (excluding input symptoms)
    const topSymptomsQuery = await pool.query(
      `SELECT symptom AS canonical_symptom, COUNT(*)::int AS count
       FROM (
         SELECT DISTINCT uc.user_id, LOWER(s) AS symptom
         FROM user_checkins uc
         CROSS JOIN LATERAL unnest(uc.symptoms) AS s
         WHERE uc.user_id = ANY($1)
       ) sq
       WHERE symptom <> ALL($2::TEXT[])
       GROUP BY symptom
       ORDER BY count DESC
       LIMIT 10`,
      [similarUserIds, inputCanonicalSymptomsLower]
    );

    // V1 does not store treatment events per user check-in yet.
    const topTreatmentsQuery = { rows: [] };
    const successRatesQuery = { rows: [] };

    res.json({
      input_symptoms: inputCanonicalSymptoms,
      similar_users: similarUsers,
      top_symptoms: topSymptomsQuery.rows,
      top_treatments: topTreatmentsQuery.rows,
      success_rates: successRatesQuery.rows
    });

  } catch (err) {
    console.error("Women-like-me error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;