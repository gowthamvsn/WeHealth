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
  const res = await pool.query(
    `UPDATE pipeline_runs
        SET status='failed', completed_at=NOW(),
            notes=COALESCE(notes,'') || ' | auto-closed stale running record'
      WHERE pipeline_name='stage2_extraction_we-gpt-4.1_v41prod'
        AND status='running'`
  );
  console.log(`closed=${res.rowCount}`);
}

main().catch(e => { console.error(e); process.exit(1); }).finally(async () => { await pool.end(); });
