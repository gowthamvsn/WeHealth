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

async function main() {
  const runs = await pool.query(
    `SELECT run_id, pipeline_name, status, started_at, completed_at
     FROM pipeline_runs
     WHERE pipeline_name LIKE 'stage2_extraction_%'
     ORDER BY run_id DESC
     LIMIT 8`
  );
  console.log('=== recent stage2 runs ===');
  runs.rows.forEach(r => console.log(JSON.stringify(r)));

  const ext = await pool.query(
    `SELECT model_name, prompt_version, status, COUNT(*)::int AS n
     FROM reddit_extractions
     WHERE prompt_version IN ('v41pilot', 'v2pilot', 'vbaseline', 'v1')
     GROUP BY model_name, prompt_version, status
     ORDER BY model_name, prompt_version, status`
  );
  console.log('=== extraction status summary ===');
  ext.rows.forEach(r => console.log(JSON.stringify(r)));

  const err = await pool.query(
    `SELECT source_type, source_post_id, comment_order, error_message
     FROM reddit_extractions
     WHERE model_name='we-gpt-4.1'
       AND prompt_version='v41pilot'
       AND status='error'
     ORDER BY source_type, source_post_id, comment_order`
  );
  console.log('=== v41pilot residual errors ===');
  err.rows.forEach(r => console.log(JSON.stringify(r)));
}

main().catch(e => { console.error(e); process.exit(1); }).finally(async () => { await pool.end(); });
