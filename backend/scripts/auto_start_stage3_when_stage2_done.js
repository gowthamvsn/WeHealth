'use strict';

const path = require('path');
const { spawn } = require('child_process');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { Pool } = require('pg');

const MODEL = process.env.AZURE_OPENAI_DEPLOYMENT;
const PROMPT = 'v1';
const STAGE2_PIPELINE = `stage2_extraction_${MODEL}_${PROMPT}`;
const STAGE3_PIPELINE = `stage3_canonicalization_${MODEL}_${PROMPT}`;
const POLL_MS = 60 * 1000;

const pool = new Pool({
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  port: parseInt(process.env.PGPORT || '5432', 10),
  ssl: { rejectUnauthorized: false },
});

let stage3Started = false;

async function getLatestRun(pipelineName) {
  const { rows } = await pool.query(
    `SELECT run_id, status, started_at, completed_at
       FROM pipeline_runs
      WHERE pipeline_name = $1
      ORDER BY run_id DESC
      LIMIT 1`,
    [pipelineName],
  );
  return rows[0] || null;
}

function runStage(stageName, scriptPath) {
  return new Promise((resolve) => {
    console.log(`[auto] launching ${stageName}: node ${scriptPath}`);

    const child = spawn(process.execPath, [scriptPath], {
      stdio: 'inherit',
      cwd: path.join(__dirname, '..'),
    });

    child.on('exit', async (code) => {
      console.log(`[auto] ${stageName} exited with code ${code}`);
      resolve(code === 0);
    });

    child.on('error', (err) => {
      console.error(`[auto] ${stageName} error: ${err.message}`);
      resolve(false);
    });
  });
}

async function tick() {
  try {
    // Check Stage 2 status
    const stage2 = await getLatestRun(STAGE2_PIPELINE);
    if (!stage2) {
      console.log('[auto] no Stage 2 run found yet, waiting...');
      return;
    }

    console.log(`[auto] Stage 2 run_id=${stage2.run_id}, status=${stage2.status}`);

    // Trigger Stage 3 if Stage 2 succeeded
    if (stage2.status === 'success' && !stage3Started) {
      stage3Started = true;
      const script = path.join(__dirname, 'stage3_canonicalize.js');
      const success = await runStage('Stage 3', script);
      
      if (!success) {
        console.log('[auto] Stage 3 failed; waiting for manual recovery...');
        stage3Started = false;
        return;
      }

      // After Stage 3 succeeds, trigger Stage 4 menotype build
      console.log('[auto] Stage 3 succeeded, launching Stage 4...');
      const stage4Script = path.join(__dirname, 'stage4_build_menotype_ml.js');
      const stage4Success = await runStage('Stage 4', stage4Script);

      if (stage4Success) {
        console.log('[auto] ✓ ALL STAGES COMPLETE (2 → 3 → 4)');
      } else {
        console.log('[auto] Stage 4 failed (non-blocking; Stage 3 complete)');
      }

      // Exit after both stages attempted
      console.log('[auto] exiting watcher');
      await pool.end().catch(() => {});
      process.exit(stage4Success ? 0 : 1);
    }

    // If Stage 2 failed, keep waiting
    if (stage2.status === 'failed') {
      console.log('[auto] Stage 2 failed; waiting for manual recovery...');
    }
  } catch (err) {
    console.error('[auto] poll error:', err.message);
  }
}

(async () => {
  console.log(`[auto] pipeline watcher started`);
  console.log(`[auto] watching ${STAGE2_PIPELINE} → triggers Stage 3 + Stage 4 menotype`);
  console.log(`[auto] polling every ${POLL_MS / 1000}s`);
  console.log('');

  await tick();
  setInterval(tick, POLL_MS);
})();
