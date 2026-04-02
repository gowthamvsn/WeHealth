const pool = require("../db");

(async () => {
  try {
    const plusOnlyLine = await pool.query(
      `SELECT COUNT(*)::int AS c
       FROM raw_reddit_comments
       WHERE comment_text = '+'
          OR comment_text LIKE '+\n%'
          OR comment_text LIKE '%\n+'
          OR comment_text LIKE '%\n+\n%'`
    );
    const trailing = await pool.query(
      "SELECT COUNT(*)::int AS c FROM raw_reddit_comments WHERE right(rtrim(comment_text), 1) = '+'"
    );
    const sample = await pool.query(
      "SELECT source_post_id, comment_order, quote_literal(comment_text) AS quoted FROM raw_reddit_comments WHERE source_post_id = 'j73ltu' ORDER BY comment_order LIMIT 5"
    );

    console.log("plus_only_line_count=", plusOnlyLine.rows[0].c);
    console.log("trailing_plus_count=", trailing.rows[0].c);
    console.log("sample_quoted=", sample.rows);
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
