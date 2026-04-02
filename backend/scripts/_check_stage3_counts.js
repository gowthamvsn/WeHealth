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

async function count(table, model, prompt) {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM ${table} WHERE model_name=$1 AND prompt_version=$2`,
    [model, prompt],
  );
  return rows[0].n;
}

async function main() {
  const model = 'we-gpt-4.1';
  const prompt = 'v41prod';
  console.log('raw_symptoms', await count('raw_symptoms', model, prompt));
  console.log('raw_treatments', await count('raw_treatments', model, prompt));
  console.log('canonical_symptoms', await count('canonical_symptoms', model, prompt));
  console.log('canonical_treatments', await count('canonical_treatments', model, prompt));
}

main().catch(e => { console.error(e); process.exit(1); }).finally(async () => { await pool.end(); });
