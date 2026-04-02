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
  const q = await pool.query(
    `SELECT status, COUNT(*)::int AS n
     FROM reddit_extractions
     WHERE model_name='we-gpt-4.1' AND prompt_version='v41prod'
     GROUP BY status
     ORDER BY status`
  );
  console.log('=== v41prod extraction status ===');
  q.rows.forEach(r => console.log(`${r.status}: ${r.n}`));

  const r = await pool.query(
    `SELECT run_id, status, started_at, completed_at
     FROM pipeline_runs
     WHERE pipeline_name='stage2_extraction_we-gpt-4.1_v41prod'
     ORDER BY run_id DESC
     LIMIT 3`
  );
  console.log('=== recent stage2 v41prod runs ===');
  r.rows.forEach(x => console.log(JSON.stringify(x)));
}

main().catch(e => { console.error(e); process.exit(1); }).finally(async () => { await pool.end(); });
