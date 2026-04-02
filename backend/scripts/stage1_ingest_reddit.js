const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { parse } = require("csv-parse/sync");
const pool = require("../db");

const DEFAULT_SOURCES = [
  "d:/PeriMP/menopause_anxiety_posts_with_comments.csv",
  "d:/PeriMP/menopause_anxiety_posts_with_comments4.csv",
  "d:/PeriMP/menopause_anxiety_posts_with_comments5.csv",
  "d:/PeriMP/menopause_anxiety_posts_with_comments_3.csv",
  "d:/PeriMP/menopause_anxiety_posts_with_comments_2.csv"
];

function normalizeText(value) {
  return String(value || "").replace(/\r\n/g, "\n").trim();
}

function parseCreatedUtc(createdUtc) {
  if (createdUtc === null || createdUtc === undefined || String(createdUtc).trim() === "") {
    return null;
  }
  const numeric = Number(createdUtc);
  if (Number.isNaN(numeric)) {
    return null;
  }
  if (numeric > 1000000000000) {
    return new Date(numeric);
  }
  return new Date(numeric * 1000);
}

async function startRun(client) {
  const result = await client.query(
    `INSERT INTO pipeline_runs (pipeline_name, status)
     VALUES ($1, 'running')
     RETURNING run_id`,
    ["stage1_ingestion"]
  );
  return result.rows[0].run_id;
}

async function finishRun(client, runId, status) {
  await client.query(
    `UPDATE pipeline_runs
     SET status = $2,
         completed_at = NOW()
     WHERE run_id = $1`,
    [runId, status]
  );
}

async function insertPost(client, row) {
  const postId = String(row.post_id || "").trim();
  if (!postId) {
    throw new Error("Missing post_id");
  }

  const title = normalizeText(row.title);
  const postText = normalizeText(row.post_text);
  const body = [title, postText].filter(Boolean).join("\n\n");
  const createdAt = parseCreatedUtc(row.created_utc);

  await client.query(
    `INSERT INTO raw_reddit_posts (
       post_id,
       source_post_id,
       title_text,
       body_text,
       subreddit_name,
       source_created_at
     )
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (source_post_id) DO NOTHING`,
    [crypto.randomUUID(), postId, title || null, postText || null, row.subreddit || null, createdAt]
  );
}

async function insertComment(client, sourcePostId, commentText, commentOrder) {
  await client.query(
    `INSERT INTO raw_reddit_comments (comment_id, source_post_id, comment_text, comment_order)
     VALUES ($1, $2, $3, $4)`,
    [crypto.randomUUID(), sourcePostId, commentText, commentOrder]
  );
}

function parseCommentsBlob(commentsValue) {
  const raw = String(commentsValue || "").trim();
  if (!raw) {
    return [];
  }

  const primaryDelimiter = raw.includes("|||") ? "|||" : "||";

  return raw
    .split(primaryDelimiter)
    .map((piece) => normalizeText(piece))
    .filter((piece) => piece.length >= 5);
}

function readCsvRows(sourceFile) {
  const raw = fs.readFileSync(sourceFile, "utf8");
  return parse(raw, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    trim: false
  });
}

function getPreferredPostRow(currentRow, candidateRow) {
  if (!currentRow) {
    return candidateRow;
  }

  const currentBody = [normalizeText(currentRow.title), normalizeText(currentRow.post_text)].filter(Boolean).join("\n\n");
  const candidateBody = [normalizeText(candidateRow.title), normalizeText(candidateRow.post_text)].filter(Boolean).join("\n\n");

  if (candidateBody.length > currentBody.length) {
    return candidateRow;
  }

  return currentRow;
}

function consolidateSourceRows(sourceFiles) {
  const grouped = new Map();

  for (const sourceFile of sourceFiles) {
    const rows = readCsvRows(sourceFile);

    for (const row of rows) {
      const postId = String(row.post_id || "").trim();
      if (!postId) {
        continue;
      }

      let aggregate = grouped.get(postId);
      if (!aggregate) {
        aggregate = {
          row: row,
          comments: new Map(),
          sourceRowsRead: 0
        };
        grouped.set(postId, aggregate);
      }

      aggregate.sourceRowsRead += 1;
      const preferredRow = getPreferredPostRow(aggregate.row, row);
      if (preferredRow === row) {
        aggregate.row = row;
      }

      const comments = parseCommentsBlob(row.comments);
      for (const comment of comments) {
        const normalizedKey = comment.toLowerCase();
        if (!aggregate.comments.has(normalizedKey)) {
          aggregate.comments.set(normalizedKey, comment);
        }
      }
    }
  }

  return Array.from(grouped.values());
}

async function main() {
  const args = process.argv.slice(2);
  const shouldTruncate = args.includes("--truncate");
  const sourceFiles = args.filter((arg) => arg !== "--truncate");
  const effectiveSources = sourceFiles.length > 0 ? sourceFiles : DEFAULT_SOURCES;
  const resolvedFiles = effectiveSources.map((f) => path.resolve(f));

  for (const file of resolvedFiles) {
    if (!fs.existsSync(file)) {
      throw new Error(`Source file not found: ${file}`);
    }
  }

  const client = await pool.connect();
  const metrics = {
    rowsRead: 0,
    rowsFailed: 0,
    postRows: 0,
    commentRows: 0
  };

  let runId = null;

  try {
    runId = await startRun(client);

    if (shouldTruncate) {
      await client.query("TRUNCATE TABLE raw_reddit_comments, raw_reddit_posts RESTART IDENTITY CASCADE");
    }

    const aggregatedPosts = consolidateSourceRows(resolvedFiles);

    for (const aggregate of aggregatedPosts) {
      metrics.rowsRead += aggregate.sourceRowsRead;

      try {
        await client.query("BEGIN");

        const sourcePostId = String(aggregate.row.post_id || "").trim();
        if (!sourcePostId) {
          throw new Error("Missing source post id");
        }

        await insertPost(client, aggregate.row);

        metrics.postRows += 1;

        let ordinal = 1;
        for (const comment of aggregate.comments.values()) {
          await insertComment(client, sourcePostId, comment, ordinal);
          ordinal += 1;

          metrics.commentRows += 1;
        }

        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        metrics.rowsFailed += 1;
      }
    }

    const status = metrics.rowsFailed > 0 ? "partial" : "success";
    await finishRun(client, runId, status === "partial" ? "failed" : status);

    console.log("Stage1 ingestion complete");
    console.log(`truncate_mode=${shouldTruncate}`);
    console.log(JSON.stringify({ runId, metrics }, null, 2));
  } catch (err) {
    if (runId !== null) {
      try {
        await finishRun(client, runId, "failed");
      } catch (_e) {
        // Best effort run finalization.
      }
    }
    console.error("Stage1 ingestion failed:", err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
