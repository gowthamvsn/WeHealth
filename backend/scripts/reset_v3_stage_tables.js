const pool = require("../db");

const TARGET_TABLES = [
  "raw_reddit_comments",
  "raw_reddit_posts",
  "pipeline_runs",
  "extract_document_facts",
  "ingest_user_documents",
  "ingest_reddit_documents"
];

async function main() {
  const client = await pool.connect();
  try {
    const existing = await client.query(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name = ANY($1::text[])
       ORDER BY table_name`,
      [TARGET_TABLES]
    );

    console.log("Existing target tables:", existing.rows.map((r) => r.table_name));

    await client.query("BEGIN");
    for (const tableName of TARGET_TABLES) {
      await client.query(`DROP TABLE IF EXISTS ${tableName} CASCADE`);
      console.log(`Dropped: ${tableName}`);
    }
    await client.query("COMMIT");

    console.log("Reset complete.");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Reset failed:", err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
