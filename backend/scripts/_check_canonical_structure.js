require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ host: process.env.DB_HOST, database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD, port: parseInt(process.env.PGPORT||'5432',10), ssl:{rejectUnauthorized:false} });

async function main() {
  // Check distinct source_types in canonical tables
  const sourceTypes = await pool.query(`
    SELECT source_type, COUNT(*) as count 
    FROM canonical_symptoms 
    GROUP BY source_type ORDER BY source_type
  `);
  console.log('canonical_symptoms by source_type:');
  sourceTypes.rows.forEach(r => console.log(`  ${r.source_type}: ${r.count}`));

  // Check a sample row to see all columns
  const sample = await pool.query(`
    SELECT * FROM canonical_symptoms LIMIT 1
  `);
  console.log('\ncanonical_symptoms columns:', Object.keys(sample.rows[0]));
  console.log('sample row:', JSON.stringify(sample.rows[0], null, 2));

  // Distinct extractions per source_type
  const extractions = await pool.query(`
    SELECT source_type, COUNT(DISTINCT extraction_id) as unique_extractions
    FROM canonical_symptoms
    GROUP BY source_type
  `);
  console.log('\nunique extractions with symptoms by source_type:');
  extractions.rows.forEach(r => console.log(`  ${r.source_type}: ${r.unique_extractions} extractions`));
}

main().catch(e => { console.error(e.message); process.exitCode=1; }).finally(() => pool.end());
