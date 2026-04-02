'use strict';

const path = require('path');
const { spawn } = require('child_process');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { Pool } = require('pg');

const args = process.argv.slice(2);
const modelIdx = args.indexOf('--model');
const promptIdx = args.indexOf('--prompt-version');
const pollIdx = args.indexOf('--poll-seconds');
const truncateAllStage3 = args.includes('--truncate-all-stage3');
const llmRemapOther = args.includes('--llm-remap-other');
const remapConcIdx = args.indexOf('--llm-remap-concurrency');
const REMAP_CONCURRENCY = remapConcIdx !== -1 ? Math.max(1, parseInt(args[remapConcIdx + 1] || '3', 10)) : 3;

const MODEL = modelIdx !== -1 ? String(args[modelIdx + 1] || process.env.AZURE_OPENAI_DEPLOYMENT) : process.env.AZURE_OPENAI_DEPLOYMENT;
const PROMPT = promptIdx !== -1 ? String(args[promptIdx + 1] || 'v41prod') : 'v41prod';
const POLL_MS = pollIdx !== -1 ? Math.max(5, parseInt(args[pollIdx + 1] || '60', 10)) * 1000 : 60000;

const STAGE2_PIPELINE = `stage2_extraction_${MODEL}_${PROMPT}`;

const pool = new Pool({
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  port: parseInt(process.env.PGPORT || '5432', 10),
  ssl: { rejectUnauthorized: false },
});

async function getLatestRun() {
  const { rows } = await pool.query(
    `SELECT run_id, status, started_at, completed_at
     FROM pipeline_runs
     WHERE pipeline_name = $1
     ORDER BY run_id DESC
     LIMIT 1`,
    [STAGE2_PIPELINE],
  );
  return rows[0] || null;
}

function runStage3() {
  return new Promise((resolve) => {
    const script = path.join(__dirname, 'stage3_canonicalize.js');
    const stage3Args = truncateAllStage3
      ? [script, '--truncate-all', '--model', MODEL, '--prompt-version', PROMPT]
      : [script, '--reset', '--model', MODEL, '--prompt-version', PROMPT];
    const child = spawn(process.execPath, stage3Args, {
      stdio: 'inherit',
      cwd: path.join(__dirname, '..'),
    });
    child.on('exit', (code) => resolve(code === 0));
    child.on('error', () => resolve(false));
  });
}

function runStage3LlmRemap() {
  return new Promise((resolve) => {
    const script = path.join(__dirname, 'stage3_llm_remap_other.js');
    const child = spawn(
      process.execPath,
      [script, '--model', MODEL, '--prompt-version', PROMPT, '--concurrency', String(REMAP_CONCURRENCY)],
      {
        stdio: 'inherit',
        cwd: path.join(__dirname, '..'),
      },
    );
    child.on('exit', (code) => resolve(code === 0));
    child.on('error', () => resolve(false));
  });
}

async function tick() {
  const run = await getLatestRun();
  if (!run) {
    console.log(`[watch] no Stage 2 run found for ${STAGE2_PIPELINE}`);
    return false;
  }

  console.log(`[watch] Stage 2 run_id=${run.run_id} status=${run.status}`);
  if (run.status === 'running') return false;

  if (run.status !== 'success') {
    console.log('[watch] Stage 2 did not succeed. watcher exiting.');
    return true;
  }

  console.log('[watch] Stage 2 success detected. Launching Stage 3 reset canonicalization...');
  const ok = await runStage3();
  console.log(`[watch] Stage 3 completed: ${ok ? 'success' : 'failed'}`);
  if (ok && llmRemapOther) {
    console.log('[watch] Launching Stage 3 LLM remap for other_* rows...');
    const remapOk = await runStage3LlmRemap();
    console.log(`[watch] Stage 3 LLM remap completed: ${remapOk ? 'success' : 'failed'}`);
  }
  return true;
}

(async () => {
  console.log(`[watch] watching ${STAGE2_PIPELINE}`);
  console.log(`[watch] stage3_mode=${truncateAllStage3 ? 'truncate-all' : 'reset-by-model-prompt'}`);
  console.log(`[watch] llm_remap_other=${llmRemapOther ? `enabled(concurrency=${REMAP_CONCURRENCY})` : 'disabled'}`);
  while (true) {
    try {
      const done = await tick();
      if (done) break;
    } catch (e) {
      console.error('[watch] error:', e.message);
    }
    await new Promise(r => setTimeout(r, POLL_MS));
  }
  await pool.end().catch(() => {});
  process.exit(0);
})();
