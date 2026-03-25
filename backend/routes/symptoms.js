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

    // Resolve each input symptom to a canonical dictionary entry via case-insensitive LIKE.
    const resolvedSymptoms = [];
    for (const symptom of symptoms) {
      const matchQuery = await pool.query(
        `SELECT symptom_id, canonical_symptom
         FROM symptom_dictionary
         WHERE LOWER(canonical_symptom) LIKE $1
         ORDER BY symptom_id
         LIMIT 1`,
        [`%${String(symptom).toLowerCase().trim()}%`]
      );

      if (matchQuery.rows.length === 0) {
        return res.status(400).json({
          error: `No matching symptom found for input: ${symptom}`
        });
      }

      resolvedSymptoms.push(matchQuery.rows[0]);
    }

    // Deduplicate IDs in case multiple inputs resolve to the same canonical symptom.
    const symptomIds = [...new Set(resolvedSymptoms.map(row => row.symptom_id))];
    const inputCanonicalSymptoms = [...new Set(resolvedSymptoms.map(row => row.canonical_symptom))];

    // Build cohort: entries that contain ALL selected symptoms.
    const cohortQuery = await pool.query(
      `SELECT entry_id
       FROM entry_symptoms_normalized
       WHERE symptom_id = ANY($1)
       GROUP BY entry_id
       HAVING COUNT(DISTINCT symptom_id) = $2`,
      [symptomIds, symptomIds.length]
    );

    const entryIds = cohortQuery.rows.map(row => row.entry_id);
    const similarUsers = entryIds.length;

    if (similarUsers === 0) {
      return res.json({
        input_symptoms: inputCanonicalSymptoms,
        similar_users: 0,
        top_symptoms: [],
        top_treatments: [],
        success_rates: []
      });
    }

    // Most common co-occurring symptoms in the cohort, excluding input symptoms.
    const topSymptomsQuery = await pool.query(
      `SELECT sd.canonical_symptom, COUNT(*)::int AS count
       FROM entry_symptoms_normalized es
       JOIN symptom_dictionary sd ON es.symptom_id = sd.symptom_id
       WHERE es.entry_id = ANY($1)
         AND es.symptom_id <> ALL($2)
       GROUP BY sd.canonical_symptom
       ORDER BY count DESC
       LIMIT 10`,
      [entryIds, symptomIds]
    );

    // Top treatments in the cohort.
    const topTreatmentsQuery = await pool.query(
      `SELECT td.canonical_treatment, COUNT(*)::int AS count
       FROM treatment_events_normalized te
       JOIN treatment_dictionary td ON te.treatment_id = td.treatment_id
       WHERE te.entry_id = ANY($1)
       GROUP BY td.canonical_treatment
       ORDER BY count DESC
       LIMIT 10`,
      [entryIds]
    );

    // Treatment success rates in the cohort.
    const successRatesQuery = await pool.query(
      `SELECT td.canonical_treatment,
              SUM(CASE WHEN te.worked = true THEN 1 ELSE 0 END)::int AS worked,
              COUNT(*)::int AS total
       FROM treatment_events_normalized te
       JOIN treatment_dictionary td ON te.treatment_id = td.treatment_id
       WHERE te.entry_id = ANY($1)
       GROUP BY td.canonical_treatment
       ORDER BY total DESC`,
      [entryIds]
    );

    res.json({
      input_symptoms: inputCanonicalSymptoms,
      similar_users: similarUsers,
      top_symptoms: topSymptomsQuery.rows,
      top_treatments: topTreatmentsQuery.rows,
      success_rates: successRatesQuery.rows
    });

  } catch (err) {
    console.error(err);
    res.status(500).send("Server error");
  }
});

module.exports = router;