require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ host: process.env.DB_HOST, database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD, port: parseInt(process.env.PGPORT||'5432',10), ssl:{rejectUnauthorized:false} });
pool.query("ALTER TABLE menotype_ml_profiles ADD COLUMN IF NOT EXISTS symptom_profile JSONB DEFAULT '{}'::jsonb")
  .then(() => { console.log('✓ Added symptom_profile column'); pool.end(); })
  .catch(e => { console.error(e.message); pool.end(); process.exitCode=1; });
