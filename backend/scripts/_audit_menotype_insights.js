require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  port: parseInt(process.env.PGPORT || '5432', 10),
  ssl: { rejectUnauthorized: false },
});

async function q(name, sql, params = []) {
  const { rows } = await pool.query(sql, params);
  return { name, rows };
}

async function main() {
  const model = 'we-gpt-4.1';

  const checks = await Promise.all([
    q('total_profiles', `SELECT COUNT(*)::int AS n FROM menotype_ml_profiles WHERE model_name=$1`, [model]),
    q('by_source_type', `SELECT source_type, COUNT(*)::int AS n FROM menotype_ml_profiles WHERE model_name=$1 GROUP BY source_type ORDER BY source_type`, [model]),
    q('by_menotype', `SELECT primary_menotype, COUNT(*)::int AS n, ROUND(AVG(confidence)::numeric,3) AS avg_conf FROM menotype_ml_profiles WHERE model_name=$1 GROUP BY primary_menotype ORDER BY primary_menotype`, [model]),
    q('other_symptom_rate', `
      SELECT
        COUNT(*)::int AS total_symptom_rows,
        COUNT(*) FILTER (WHERE canonical_name='other_symptom')::int AS other_rows,
        ROUND(100.0*COUNT(*) FILTER (WHERE canonical_name='other_symptom')/NULLIF(COUNT(*),0),2) AS other_pct
      FROM canonical_symptoms
      WHERE model_name=$1 AND prompt_version='v41prod'`, [model]),
    q('other_treatment_rate', `
      SELECT
        COUNT(*)::int AS total_treatment_rows,
        COUNT(*) FILTER (WHERE canonical_name='other_treatment')::int AS other_rows,
        ROUND(100.0*COUNT(*) FILTER (WHERE canonical_name='other_treatment')/NULLIF(COUNT(*),0),2) AS other_pct
      FROM canonical_treatments
      WHERE model_name=$1 AND prompt_version='v41prod'`, [model]),
    q('effect_known_rate', `
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE reported_effect IS NOT NULL)::int AS known,
        ROUND(100.0*COUNT(*) FILTER (WHERE reported_effect IS NOT NULL)/NULLIF(COUNT(*),0),2) AS known_pct,
        COUNT(*) FILTER (WHERE reported_effect='positive')::int AS pos,
        COUNT(*) FILTER (WHERE reported_effect='negative')::int AS neg,
        COUNT(*) FILTER (WHERE reported_effect='neutral')::int AS neu,
        COUNT(*) FILTER (WHERE reported_effect='mixed')::int AS mix
      FROM canonical_treatments
      WHERE model_name=$1 AND prompt_version='v41prod'`, [model]),
    q('top_other_symptom_raw', `
      SELECT raw_name, COUNT(*)::int AS n
      FROM canonical_symptoms
      WHERE model_name=$1 AND prompt_version='v41prod' AND canonical_name='other_symptom'
      GROUP BY raw_name
      ORDER BY n DESC
      LIMIT 20`, [model]),
    q('top_other_treatment_raw', `
      SELECT raw_name, COUNT(*)::int AS n
      FROM canonical_treatments
      WHERE model_name=$1 AND prompt_version='v41prod' AND canonical_name='other_treatment'
      GROUP BY raw_name
      ORDER BY n DESC
      LIMIT 20`, [model]),
    q('low_confidence', `
      SELECT
        COUNT(*) FILTER (WHERE confidence < 0.75)::int AS lt_075,
        COUNT(*) FILTER (WHERE confidence < 0.80)::int AS lt_080,
        COUNT(*) FILTER (WHERE confidence >= 0.90)::int AS ge_090
      FROM menotype_ml_profiles
      WHERE model_name=$1`, [model]),
    q('symptom_vocab_coverage', `
      SELECT canonical_name, COUNT(*)::int AS n
      FROM canonical_symptoms
      WHERE model_name=$1 AND prompt_version='v41prod'
      GROUP BY canonical_name
      ORDER BY n DESC`, [model]),
    q('treatment_vocab_coverage', `
      SELECT canonical_name, COUNT(*)::int AS n
      FROM canonical_treatments
      WHERE model_name=$1 AND prompt_version='v41prod'
      GROUP BY canonical_name
      ORDER BY n DESC`, [model]),
    q('high_negative_treatments', `
      SELECT
        m.primary_menotype,
        ct.canonical_name,
        COUNT(*) FILTER (WHERE ct.reported_effect='negative')::int AS neg_n,
        COUNT(*) FILTER (WHERE ct.reported_effect='positive')::int AS pos_n,
        COUNT(*) FILTER (WHERE ct.reported_effect IS NOT NULL)::int AS known_n,
        ROUND((COUNT(*) FILTER (WHERE ct.reported_effect='positive') - COUNT(*) FILTER (WHERE ct.reported_effect='negative'))::numeric
          / NULLIF(COUNT(*) FILTER (WHERE ct.reported_effect IS NOT NULL),0),3) AS net_score
      FROM menotype_ml_profiles m
      JOIN canonical_treatments ct ON ct.extraction_id::text = m.extraction_id
      WHERE m.model_name=$1 AND ct.model_name=$1 AND ct.prompt_version='v41prod'
      GROUP BY m.primary_menotype, ct.canonical_name
      HAVING COUNT(*) FILTER (WHERE ct.reported_effect IS NOT NULL) >= 15
      ORDER BY net_score ASC, known_n DESC
      LIMIT 20`, [model]),
  ]);

  for (const c of checks) {
    console.log(`\n=== ${c.name} ===`);
    console.log(JSON.stringify(c.rows, null, 2));
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
