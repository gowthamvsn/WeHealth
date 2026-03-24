const express = require("express");
const router = express.Router();
const pool = require("../db");

router.post("/", async (req, res) => {
  try {
    const symptoms = req.body?.symptoms || [];

    if (!symptoms || symptoms.length === 0) {
      return res.status(400).json({ error: "No symptoms provided" });
    }

    const query = `
        SELECT smc.menotype, COUNT(*) AS matches
        FROM public.symptom_matrix_clustered smc
        JOIN public.entry_symptoms_normalized es
        ON smc.entry_id = es.entry_id
        JOIN public.symptom_dictionary sd
        ON es.symptom_id = sd.symptom_id
        WHERE sd.canonical_symptom = ANY($1)
        GROUP BY smc.menotype
        ORDER BY matches DESC
        LIMIT 1
        `;

    const result = await pool.query(query, [symptoms]);

    if (result.rows.length === 0) {
      return res.json({
        message: "No matching menotype found"
      });
    }

    res.json({
      menotype: result.rows[0].menotype,
      matches: result.rows[0].count
    });

  } catch (err) {
    console.error(err);
    res.status(500).send("Server error");
  }
});

module.exports = router;