require('dotenv').config();
const { Pool } = require('pg');

const model = process.argv[2] || 'we-gpt-4.1';
const prompt = process.argv[3] || 'v41pilot';

const pool = new Pool({
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  port: parseInt(process.env.PGPORT || '5432', 10),
  ssl: { rejectUnauthorized: false },
});

async function main() {
  const status = await pool.query(
    `SELECT status, COUNT(*)::int AS n
     FROM reddit_extractions
     WHERE model_name=$1 AND prompt_version=$2
     GROUP BY status
     ORDER BY status`,
    [model, prompt]
  );

  const quality = await pool.query(
    `SELECT
       COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE extracted_json IS NOT NULL)::int AS json_present,
       COUNT(*) FILTER (WHERE jsonb_typeof(extracted_json->'symptoms')='array' AND jsonb_array_length(extracted_json->'symptoms') > 0)::int AS with_symptoms,
       COUNT(*) FILTER (WHERE jsonb_typeof(extracted_json->'treatments')='array' AND jsonb_array_length(extracted_json->'treatments') > 0)::int AS with_treatments,
       COUNT(*) FILTER (WHERE COALESCE(extracted_json->>'menopause_stage','') <> '')::int AS with_stage,
       COUNT(*) FILTER (WHERE extracted_json->>'notes' = 'content_filtered_by_azure')::int AS content_filtered
     FROM reddit_extractions
     WHERE model_name=$1 AND prompt_version=$2 AND status='done'`,
    [model, prompt]
  );

  const sourceSplit = await pool.query(
    `SELECT source_type, COUNT(*)::int AS n
     FROM reddit_extractions
     WHERE model_name=$1 AND prompt_version=$2 AND status='done'
     GROUP BY source_type
     ORDER BY source_type`,
    [model, prompt]
  );

  console.log('=== Stage2 Pilot Status ===');
  status.rows.forEach(r => console.log(JSON.stringify(r)));
  console.log('=== Stage2 Pilot Quality ===');
  console.log(JSON.stringify(quality.rows[0]));
  console.log('=== Stage2 Pilot Source Split ===');
  sourceSplit.rows.forEach(r => console.log(JSON.stringify(r)));
}

main().catch(e => { console.error(e); process.exit(1); }).finally(async () => { await pool.end(); });
