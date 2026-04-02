require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ host: process.env.DB_HOST, database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD, port: parseInt(process.env.PGPORT||'5432',10), ssl:{rejectUnauthorized:false} });

const menotypes = [
  'Cognitive fatigue menopause',
  'Anxiety-dominant menopause',
  'Vasomotor insomnia menopause',
  'Inflammatory pain menopause',
  'Hormonal transition menopause'
];

pool.query('SELECT primary_menotype, COUNT(*) as count, ROUND(AVG(confidence)::numeric,3) as avg_confidence FROM menotype_ml_profiles GROUP BY primary_menotype ORDER BY primary_menotype')
  .then(async r => {
    const totRes = await pool.query('SELECT COUNT(*) as total FROM menotype_ml_profiles');
    const total = parseInt(totRes.rows[0].total, 10);
    const byType = await pool.query('SELECT source_type, primary_menotype, COUNT(*) as count FROM menotype_ml_profiles GROUP BY source_type, primary_menotype ORDER BY source_type, primary_menotype');

    console.log(`\n=== Menotype Distribution (total ${total}) ===\n`);
    r.rows.forEach((row) => {
      const name = menotypes[row.primary_menotype] || 'Unknown';
      const pct = ((row.count / total) * 100).toFixed(1);
      console.log(`${row.primary_menotype} (${name}): ${row.count} (${pct}%) avg_confidence=${row.avg_confidence}`);
    });

    console.log('\n=== Breakdown by source_type ===\n');
    const byTypeMap = {};
    byType.rows.forEach(row => {
      if (!byTypeMap[row.source_type]) byTypeMap[row.source_type] = {};
      byTypeMap[row.source_type][row.primary_menotype] = parseInt(row.count, 10);
    });
    ['post','comment'].forEach(st => {
      const d = byTypeMap[st] || {};
      const stTotal = Object.values(d).reduce((a, b) => a + b, 0);
      console.log(`${st} (total: ${stTotal}):`);
      menotypes.forEach((name, id) => {
        const c = d[id] || 0;
        const pct = stTotal > 0 ? ((c / stTotal) * 100).toFixed(1) : '0.0';
        console.log(`  ${id} ${name}: ${c} (${pct}%)`);
      });
    });
    pool.end();
  })
  .catch(e => { console.error(e.message); pool.end(); });
