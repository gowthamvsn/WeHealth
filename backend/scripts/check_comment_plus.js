const pool = require("../db");

(async () => {
  try {
    const total = await pool.query("SELECT COUNT(*)::int AS c FROM raw_reddit_comments");
    const trailing = await pool.query("SELECT COUNT(*)::int AS c FROM raw_reddit_comments WHERE right(comment_text, 1) = '+'");
    const withPlus = await pool.query("SELECT COUNT(*)::int AS c FROM raw_reddit_comments WHERE comment_text LIKE '%+%'");
    const examples = await pool.query(
      "SELECT source_post_id, comment_order, right(comment_text, 60) AS tail FROM raw_reddit_comments WHERE right(comment_text, 1) = '+' LIMIT 10"
    );

    console.log("total_comments=", total.rows[0].c);
    console.log("trailing_plus=", trailing.rows[0].c);
    console.log("contains_plus_anywhere=", withPlus.rows[0].c);
    console.log("examples=", examples.rows);
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
