require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ host: process.env.DB_HOST, database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD, port: parseInt(process.env.PGPORT||'5432',10), ssl:{rejectUnauthorized:false} });
pool.query(
  "UPDATE pipeline_runs SET status='failed', completed_at=NOW(), notes=COALESCE(notes,'') || ' | auto-closed stale running record' WHERE run_id IN (20,21) AND status='running'"
).then(r => { console.log('closed=' + r.rowCount); pool.end(); })
 .catch(e => { console.error(e.message); pool.end(); process.exitCode = 1; });
