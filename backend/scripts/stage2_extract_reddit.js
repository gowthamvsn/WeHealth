/**
 * Stage 2 — Reddit Extraction Runner
 *
 * Reads raw posts and comments from Stage 1 tables, calls Azure OpenAI to
 * extract structured menopause facts, and writes results to reddit_extractions.
 * Each run is logged in pipeline_runs.
 *
 * Usage:
 *   node scripts/stage2_extract_reddit.js              # process all pending
 *   node scripts/stage2_extract_reddit.js --pilot      # 50 posts + 200 comments only
 *   node scripts/stage2_extract_reddit.js --type post  # posts only
 *   node scripts/stage2_extract_reddit.js --type comment
 *
 * Flags:
 *   --pilot          Process a small sample for validation
 *   --type post|comment   Limit to one source type
 *   --concurrency N  Parallel API calls (default 5)
 *   --reset          Delete all existing reddit_extractions rows for this model+prompt
 *   --retry-errors   Requeue rows with status='error' for this model+prompt
 *   --model NAME     Override AZURE_OPENAI_DEPLOYMENT for this run
 *   --prompt-version V  Prompt version tag stored in reddit_extractions (default v1)
 *   --api-version V  Override AZURE_OPENAI_API_VERSION for this run
 *
 * Model versioning:
 *   Set AZURE_OPENAI_DEPLOYMENT in .env to switch models.
 *   Each (source_post_id, source_type, comment_order, model_name, prompt_version)
 *   gets its own row, so two models can each produce their own extraction for
 *   the same document for comparison.
 */

'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { Pool } = require('pg');
const crypto = require('crypto');

// ─── Config ──────────────────────────────────────────────────────────────────

const ENDPOINT       = process.env.AZURE_OPENAI_ENDPOINT;
const API_KEY        = process.env.AZURE_OPENAI_KEY;

const PILOT_POSTS    = 50;
const PILOT_COMMENTS = 200;

// ─── Args ─────────────────────────────────────────────────────────────────────

const args     = process.argv.slice(2);
const PILOT    = args.includes('--pilot');
const RESET    = args.includes('--reset');
const RETRY_ERRORS = args.includes('--retry-errors');
const typeIdx  = args.indexOf('--type');
const TYPE_FILTER = typeIdx !== -1 ? args[typeIdx + 1] : null;   // 'post' | 'comment' | null

const concIdx  = args.indexOf('--concurrency');
const CONCURRENCY = concIdx !== -1 ? parseInt(args[concIdx + 1], 10) : 5;

const modelIdx = args.indexOf('--model');
const promptIdx = args.indexOf('--prompt-version');
const apiVerIdx = args.indexOf('--api-version');

const MODEL_NAME = modelIdx !== -1 ? String(args[modelIdx + 1] || '').trim() : String(process.env.AZURE_OPENAI_DEPLOYMENT || '').trim();
const PROMPT_VERSION = promptIdx !== -1 ? String(args[promptIdx + 1] || 'v1').trim() : 'v1';
const API_VERSION = apiVerIdx !== -1 ? String(args[apiVerIdx + 1] || '').trim() : String(process.env.AZURE_OPENAI_API_VERSION || '').trim();

if (!MODEL_NAME) {
  throw new Error('Missing model deployment. Set AZURE_OPENAI_DEPLOYMENT in backend/.env or pass --model <deployment_name>.');
}
if (!API_VERSION) {
  throw new Error('Missing AZURE_OPENAI_API_VERSION. Set it in backend/.env or pass --api-version <version>.');
}
if (!ENDPOINT || !API_KEY) {
  throw new Error('Missing Azure OpenAI endpoint/key in backend/.env.');
}

// ─── DB ───────────────────────────────────────────────────────────────────────

const pool = new Pool({
  host:     process.env.DB_HOST,
  database: process.env.DB_NAME,
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  port:     parseInt(process.env.PGPORT || '5432'),
  ssl:      { rejectUnauthorized: false },
});

// ─── Prompt ───────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a medical text analyst specialising in women's perimenopause and menopause health.
Extract structured facts from the Reddit post or comment provided.
Return ONLY valid JSON — no prose, no markdown fences.

Required JSON shape:
{
  "current_age": <integer or null>,
  "menopause_onset_age": <integer or null>,
  "menopause_stage": <"perimenopause"|"menopause"|"postmenopause"|"surgical_menopause"|"unknown"|null>,
  "symptoms": [
    {
      "name": <string>,
      "onset_description": <string or null>,
      "severity": <"mild"|"moderate"|"severe"|null>,
      "resolved": <true|false|null>
    }
  ],
  "treatments": [
    {
      "name": <string>,
      "type": <"medication"|"supplement"|"lifestyle"|"procedure"|"other"|null>,
      "reported_effect": <"positive"|"negative"|"neutral"|"mixed"|null>,
      "side_effects": [<string>, ...],
      "duration_description": <string or null>
    }
  ],
  "emotional_tone": <"positive"|"negative"|"neutral"|"mixed"|null>,
  "seeking_advice": <true|false>,
  "sharing_experience": <true|false>,
  "notes": <string or null>
}

Rules:
- current_age is how old the author is NOW. menopause_onset_age is the age they started menopause/perimenopause.
- symptoms and treatments must be arrays of objects (not strings), even if there is only one item.
- Keep name fields concise (1-5 words). Use plain English, not medical jargon.
- side_effects is an array of strings; use [] if none mentioned.
- onset_description is a free-text phrase like "3 months ago" or "since last year".
- If a field cannot be determined return null or [] as appropriate.
- Do not invent data not present in the text.`;

function buildUserMessage(sourceType, text) {
  const label = sourceType === 'post' ? 'Reddit post' : 'Reddit comment';
  return `Extract from this ${label}:\n\n${text.slice(0, 3000)}`;
}

// ─── Azure OpenAI call ────────────────────────────────────────────────────────

async function callOpenAI(sourceType, text) {
  const url = `${ENDPOINT}/openai/deployments/${MODEL_NAME}/chat/completions?api-version=${API_VERSION}`;

  const body = JSON.stringify({
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user',   content: buildUserMessage(sourceType, text) },
    ],
    temperature: 0,
    max_tokens:  1500,
    response_format: { type: 'json_object' },
  });

  const res = await fetch(url, {
    method:  'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-key':      API_KEY,
    },
    body,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText);
    throw new Error(`HTTP ${res.status}: ${errText}`);
  }

  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error('Empty response from OpenAI');

  return JSON.parse(content);   // throws if not valid JSON
}

function isContentFilterError(err) {
  const msg = String(err?.message || '').toLowerCase();
  return msg.includes('content_filter') || msg.includes('responsibleaipolicyviolation');
}

function makeFilteredFallback() {
  return {
    current_age: null,
    menopause_onset_age: null,
    menopause_stage: 'unknown',
    symptoms: [],
    treatments: [],
    emotional_tone: null,
    seeking_advice: false,
    sharing_experience: false,
    notes: 'content_filtered_by_azure',
  };
}

// ─── DB helpers ───────────────────────────────────────────────────────────────

const INSERT_CHUNK = 3000;   // 6 params × 3000 = 18000, well under pg's 65535 limit

async function insertPending(client, rows) {
  if (rows.length === 0) return;
  // Include model_name + prompt_version at seed time:
  //   UNIQUE key is (source_post_id, source_type, comment_order, model_name, prompt_version)
  //   so running a second model simply adds new rows without conflicting.
  for (let start = 0; start < rows.length; start += INSERT_CHUNK) {
    const chunk = rows.slice(start, start + INSERT_CHUNK);
    const values = chunk.map((r, i) => {
      const base = i * 6;
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6})`;
    }).join(', ');

    const params = chunk.flatMap(r => [
      crypto.randomUUID(),
      r.source_type,
      r.source_post_id,
      r.comment_order ?? -1,   // -1 sentinel for posts
      MODEL_NAME,
      PROMPT_VERSION,
    ]);

    await client.query(
      `INSERT INTO reddit_extractions
         (extraction_id, source_type, source_post_id, comment_order, model_name, prompt_version)
       VALUES ${values}
       ON CONFLICT (source_post_id, source_type, comment_order, model_name, prompt_version) DO NOTHING`,
      params,
    );
  }
}

async function markDone(extractionId, json) {
  await pool.query(
    `UPDATE reddit_extractions
        SET status = 'done',
            extracted_json = $1,
            extracted_at   = NOW()
      WHERE extraction_id = $2`,
    [JSON.stringify(json), extractionId],
  );
}

async function markError(extractionId, message) {
  await pool.query(
    `UPDATE reddit_extractions
        SET status = 'error',
            error_message = $1,
            extracted_at  = NOW()
      WHERE extraction_id = $2`,
    [message.slice(0, 1000), extractionId],
  );
}

// ─── pipeline_runs helpers ────────────────────────────────────────────────────

async function startRun(client) {
  const name = `stage2_extraction_${MODEL_NAME}_${PROMPT_VERSION}`;
  const { rows } = await client.query(
    `INSERT INTO pipeline_runs (pipeline_name, started_at, status)
     VALUES ($1, NOW(), 'running')
     RETURNING run_id`,
    [name],
  );
  return rows[0].run_id;   // BIGSERIAL, generated by DB
}

async function finishRun(client, runId, status, meta) {
  await client.query(
    `UPDATE pipeline_runs
        SET completed_at = NOW(),
            status       = $1,
            notes        = $2
      WHERE run_id = $3`,
    [status, JSON.stringify(meta), runId],
  );
}

// ─── Source row fetchers ──────────────────────────────────────────────────────

async function fetchPendingPosts(client, limit) {
  const { rows } = await client.query(
    `SELECT re.extraction_id,
            re.source_post_id,
            COALESCE(p.title_text || ' ' || COALESCE(p.body_text, ''), '') AS text
       FROM reddit_extractions re
       JOIN raw_reddit_posts p ON p.source_post_id = re.source_post_id
      WHERE re.source_type = 'post'
        AND re.comment_order = -1
        AND re.model_name = $2
        AND re.prompt_version = $3
        AND re.status = 'pending'
      ORDER BY re.created_at
      LIMIT $1`,
    [limit || 999999, MODEL_NAME, PROMPT_VERSION],
  );
  return rows;
}

async function fetchPendingComments(client, limit) {
  const { rows } = await client.query(
    `SELECT re.extraction_id,
            re.source_post_id,
            re.comment_order,
            COALESCE(c.comment_text, '') AS text
       FROM reddit_extractions re
       JOIN raw_reddit_comments c
         ON c.source_post_id = re.source_post_id
        AND c.comment_order  = re.comment_order
      WHERE re.source_type = 'comment'
        AND re.comment_order >= 0
        AND re.model_name = $2
        AND re.prompt_version = $3
        AND re.status = 'pending'
      ORDER BY re.created_at
      LIMIT $1`,
    [limit || 999999, MODEL_NAME, PROMPT_VERSION],
  );
  return rows;
}

// ─── Concurrency pool ─────────────────────────────────────────────────────────

async function runWithConcurrency(tasks, worker, concurrency) {
  const results = { done: 0, error: 0, errorsByMessage: new Map() };
  let idx = 0;

  async function runNext() {
    while (idx < tasks.length) {
      const task = tasks[idx++];
      try {
        await worker(task);
        results.done++;
      } catch (e) {
        results.error++;
        const key = String(e?.message || 'Unknown error').slice(0, 500);
        results.errorsByMessage.set(key, (results.errorsByMessage.get(key) || 0) + 1);
      }
    }
  }

  const workers = Array.from({ length: concurrency }, runNext);
  await Promise.all(workers);
  return results;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('Stage 2 extraction starting');
  console.log(`  model: ${MODEL_NAME}  prompt: ${PROMPT_VERSION}  api_version: ${API_VERSION}  concurrency: ${CONCURRENCY}`);
  if (PILOT)       console.log(`  PILOT mode: ${PILOT_POSTS} posts + ${PILOT_COMMENTS} comments`);
  if (TYPE_FILTER) console.log(`  type filter: ${TYPE_FILTER}`);
  if (RETRY_ERRORS) console.log('  retry mode: requeueing prior error rows');

  const client = await pool.connect();
  let runId;
  try {

    // ── Log run start ──────────────────────────────────────────────────────
    runId = await startRun(client);
    console.log(`  pipeline_runs run_id: ${runId}`);

    // ── Optional reset ─────────────────────────────────────────────────────
    if (RESET) {
      await client.query(
        'DELETE FROM reddit_extractions WHERE model_name = $1 AND prompt_version = $2',
        [MODEL_NAME, PROMPT_VERSION],
      );
      console.log(`  reset: deleted existing rows for ${MODEL_NAME}/${PROMPT_VERSION}`);
    }

    if (RETRY_ERRORS) {
      const whereType = TYPE_FILTER ? 'AND source_type = $3' : '';
      const params = TYPE_FILTER
        ? [MODEL_NAME, PROMPT_VERSION, TYPE_FILTER]
        : [MODEL_NAME, PROMPT_VERSION];
      const retried = await client.query(
        `UPDATE reddit_extractions
            SET status = 'pending',
                error_message = NULL,
                extracted_at = NULL
          WHERE model_name = $1
            AND prompt_version = $2
            AND status = 'error'
            ${whereType}`,
        params,
      );
      console.log(`  requeued error rows: ${retried.rowCount}`);
    }

    // ── Seed pending rows ──────────────────────────────────────────────────
    console.log('Seeding pending rows from Stage 1 tables...');

    if (!TYPE_FILTER || TYPE_FILTER === 'post') {
      const { rows: posts } = await client.query(
        `SELECT source_post_id FROM raw_reddit_posts ${PILOT ? `LIMIT ${PILOT_POSTS}` : ''}`
      );
      await insertPending(client, posts.map(p => ({ source_type: 'post', source_post_id: p.source_post_id, comment_order: -1 })));
      console.log(`  seeded ${posts.length} posts`);
    }

    if (!TYPE_FILTER || TYPE_FILTER === 'comment') {
      const { rows: comments } = await client.query(
        `SELECT source_post_id, comment_order FROM raw_reddit_comments ${PILOT ? `LIMIT ${PILOT_COMMENTS}` : ''}`
      );
      await insertPending(client, comments.map(c => ({ source_type: 'comment', source_post_id: c.source_post_id, comment_order: c.comment_order })));
      console.log(`  seeded ${comments.length} comments`);
    }

    // ── Fetch pending rows ─────────────────────────────────────────────────
    const postRows    = (!TYPE_FILTER || TYPE_FILTER === 'post')    ? await fetchPendingPosts(client,    PILOT ? PILOT_POSTS    : null) : [];
    const commentRows = (!TYPE_FILTER || TYPE_FILTER === 'comment') ? await fetchPendingComments(client, PILOT ? PILOT_COMMENTS : null) : [];
    const allRows = [...postRows.map(r => ({ ...r, source_type: 'post' })),
                     ...commentRows.map(r => ({ ...r, source_type: 'comment' }))];

    console.log(`Processing: ${postRows.length} posts + ${commentRows.length} comments = ${allRows.length} total`);

    if (allRows.length === 0) {
      console.log('Nothing to process. All rows already extracted.');
      return;
    }

    // ── Extract ────────────────────────────────────────────────────────────
    let processed = 0;

    const results = await runWithConcurrency(allRows, async (row) => {
      try {
        const json = await callOpenAI(row.source_type, row.text);
        await markDone(row.extraction_id, json);
        processed++;
        if (processed % 50 === 0) {
          console.log(`  ${processed} / ${allRows.length} done...`);
        }
      } catch (e) {
        if (isContentFilterError(e)) {
          await markDone(row.extraction_id, makeFilteredFallback());
          processed++;
          return;
        }
        await markError(row.extraction_id, e.message).catch(() => {});
        throw e;   // re-throw so runWithConcurrency counts it as error
      }
    }, CONCURRENCY);

    // ── Summary ────────────────────────────────────────────────────────────
    const { rows: counts } = await client.query(
      `SELECT status, COUNT(*) FROM reddit_extractions
        WHERE model_name = $1 AND prompt_version = $2
        GROUP BY status ORDER BY status`,
      [MODEL_NAME, PROMPT_VERSION],
    );

    const meta = {
      model: MODEL_NAME, prompt: PROMPT_VERSION,
      succeeded: results.done, errors: results.error,
      pilot: PILOT, type_filter: TYPE_FILTER || 'all',
    };

    if (results.error > 0) {
      console.log('\nTop extraction errors:');
      const topErrors = [...results.errorsByMessage.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);
      topErrors.forEach(([msg, count]) => console.log(`  ${count}x ${msg}`));
    }

    await finishRun(client, runId, results.error > 0 ? 'failed' : 'success', meta);

    console.log('\n=== Stage 2 Extraction Complete ===');
    console.log(`  run_id    : ${runId}`);
    console.log(`  succeeded : ${results.done}`);
    console.log(`  errors    : ${results.error}`);
    console.log(`\nExtraction statuses for ${MODEL_NAME}/${PROMPT_VERSION}:`);
    counts.forEach(r => console.log(`  ${r.status}: ${r.count}`));

  } catch (fatalErr) {
    if (runId) {
      await finishRun(client, runId, 'failed', { error: fatalErr.message }).catch(() => {});
    }
    throw fatalErr;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
