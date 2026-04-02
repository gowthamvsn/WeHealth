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
  const upd = await pool.query(
    `UPDATE pipeline_runs
     SET status='failed', completed_at=NOW(), notes=COALESCE(notes, '') || ' | aborted by operator'
     WHERE run_id=16 AND status='running'`
  );
  const del = await pool.query(
    `DELETE FROM reddit_extractions
     WHERE model_name='we-gpt-4.1' AND prompt_version='v41pilot'`
  );
  console.log(`updated_runs=${upd.rowCount}`);
  console.log(`deleted_rows=${del.rowCount}`);
}

main().catch(e => { console.error(e); process.exit(1); }).finally(async () => { await pool.end(); });
