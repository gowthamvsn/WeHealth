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
  const q1 = await pool.query(`
    SELECT COUNT(*)::int AS posts,
           COUNT(DISTINCT source_post_id)::int AS unique_posts
    FROM raw_reddit_posts
  `);
  const q2 = await pool.query(`
    SELECT source_post_id, COUNT(*)::int AS n
    FROM raw_reddit_posts
    GROUP BY source_post_id
    HAVING COUNT(*) > 1
    ORDER BY n DESC
    LIMIT 5
  `);
  const q3 = await pool.query(`
    SELECT COUNT(*)::int AS comments,
           COUNT(DISTINCT (source_post_id, comment_order))::int AS unique_comment_keys
    FROM raw_reddit_comments
  `);
  const q4 = await pool.query(`
    SELECT source_post_id, comment_order, COUNT(*)::int AS n
    FROM raw_reddit_comments
    GROUP BY source_post_id, comment_order
    HAVING COUNT(*) > 1
    ORDER BY n DESC
    LIMIT 5
  `);

  console.log('=== stage1 uniqueness ===');
  console.log(JSON.stringify(q1.rows[0]));
  console.log('duplicate posts sample:', JSON.stringify(q2.rows));
  console.log(JSON.stringify(q3.rows[0]));
  console.log('duplicate comments sample:', JSON.stringify(q4.rows));
}

main().catch(e => { console.error(e); process.exit(1); }).finally(async () => { await pool.end(); });
