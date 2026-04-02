require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ host: process.env.DB_HOST, database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD, port: parseInt(process.env.PGPORT||'5432',10), ssl:{rejectUnauthorized:false} });

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Add new columns
    await client.query('ALTER TABLE menotype_ml_profiles ADD COLUMN IF NOT EXISTS extraction_id TEXT');
    await client.query('ALTER TABLE menotype_ml_profiles ADD COLUMN IF NOT EXISTS source_type TEXT');
    await client.query('ALTER TABLE menotype_ml_profiles ADD COLUMN IF NOT EXISTS comment_order INTEGER');
    console.log('✓ Added extraction_id, source_type, comment_order columns');

    // Drop old unique constraint based on source_post_id only
    await client.query('ALTER TABLE menotype_ml_profiles DROP CONSTRAINT IF EXISTS uq_menotype_ml_profiles');
    console.log('✓ Dropped old unique constraint');

    // Add new unique constraint on extraction_id + model_name
    await client.query(`
      ALTER TABLE menotype_ml_profiles
      ADD CONSTRAINT uq_menotype_ml_extraction UNIQUE (extraction_id, model_name)
    `);
    console.log('✓ Added new unique constraint on (extraction_id, model_name)');

    // Add index on source_type for filtering
    await client.query('CREATE INDEX IF NOT EXISTS idx_menotype_ml_source_type ON menotype_ml_profiles(source_type)');
    console.log('✓ Added index on source_type');

    await client.query('COMMIT');
    console.log('\nSchema migration complete');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('FAILED:', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
