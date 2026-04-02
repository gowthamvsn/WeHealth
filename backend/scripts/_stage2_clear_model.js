require('dotenv').config();
const { Pool } = require('pg');

const model = process.argv[2] || 'we-gpt-4.1';

const pool = new Pool({
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  port: parseInt(process.env.PGPORT || '5432', 10),
  ssl: { rejectUnauthorized: false },
});

async function main() {
  const del = await pool.query('DELETE FROM reddit_extractions WHERE model_name = $1', [model]);
  console.log(`deleted_rows=${del.rowCount}`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
}).finally(async () => {
  await pool.end();
});
