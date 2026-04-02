/**
 * Stage 3 — Canonicalization Runner
 *
 * Reads completed rows from reddit_extractions, maps free-text symptom and
 * treatment names to canonical vocabulary, and writes to:
 *   canonical_symptoms   (one row per extraction × symptom)
 *   canonical_treatments (one row per extraction × treatment)
 *
 * No OpenAI calls — pure normalisation using alias tables + fuzzy matching.
 * Each run is logged in pipeline_runs.
 *
 * Usage:
 *   node scripts/stage3_canonicalize.js              # process all new done extractions
 *   node scripts/stage3_canonicalize.js --reset      # delete + reprocess all
 *   node scripts/stage3_canonicalize.js --pilot 500  # process first N extractions
 *
 * Normalisation strategy (in order):
 *   1. Exact match on symptom_aliases / treatment_aliases (lowercased)
 *   2. Substring containment: alias is contained in raw_name (or vice versa)
 *   3. Keyword heuristics (short stopwords like "hrt", "ivf" etc)
 *   4. Falls back to "other_symptom" / "other_treatment" if nothing matches
 */

'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { Pool } = require('pg');
const crypto = require('crypto');

// ─── Args ─────────────────────────────────────────────────────────────────────

const args        = process.argv.slice(2);
const RESET       = args.includes('--reset');
const TRUNCATE_ALL = args.includes('--truncate-all');
const pilotIdx    = args.indexOf('--pilot');
const modelIdx    = args.indexOf('--model');
const promptIdx   = args.indexOf('--prompt-version');
const PILOT_LIMIT = pilotIdx !== -1 ? parseInt(args[pilotIdx + 1], 10) : null;
const MODEL_FILTER = modelIdx !== -1
  ? String(args[modelIdx + 1] || process.env.AZURE_OPENAI_DEPLOYMENT)
  : process.env.AZURE_OPENAI_DEPLOYMENT;  // only canonicalise for active model by default
const PROMPT_FILTER = promptIdx !== -1 ? String(args[promptIdx + 1] || 'v1') : 'v1';
const BATCH_SIZE  = 500;   // extractions processed per DB round-trip

// ─── Helpers ──────────────────────────────────────────────────────────────────

const VALID_EFFECTS = new Set(['positive', 'negative', 'neutral', 'mixed']);
/** Coerce LLM-returned reported_effect to the allowed enum values or null. */
function sanitizeEffect(val) {
  if (!val) return null;
  const v = String(val).toLowerCase().trim();
  if (VALID_EFFECTS.has(v)) return v;
  // Common near-misses
  if (v === 'positive_with_caveats' || v === 'somewhat_positive') return 'mixed';
  if (v === 'partially' || v === 'partial') return 'mixed';
  if (v === 'unknown' || v === 'none' || v === 'n/a') return null;
  return null;
}
/** Coerce LLM-returned resolved to a proper boolean or null. */
function sanitizeBool(val) {
  if (val === null || val === undefined) return null;
  if (typeof val === 'boolean') return val;
  const v = String(val).toLowerCase().trim();
  if (v === 'true' || v === 'yes' || v === '1' || v === 'resolved') return true;
  if (v === 'false' || v === 'no' || v === '0' || v === 'unresolved') return false;
  return null; // anything else (e.g. "partially") → null
}

// ─── DB ───────────────────────────────────────────────────────────────────────

const pool = new Pool({
  host:     process.env.DB_HOST,
  database: process.env.DB_NAME,
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  port:     parseInt(process.env.PGPORT || '5432', 10),
  ssl:      { rejectUnauthorized: false },
});

// ─── pipeline_runs helpers ────────────────────────────────────────────────────

async function startRun(client) {
  const { rows } = await client.query(
    `INSERT INTO pipeline_runs (pipeline_name, started_at, status)
     VALUES ($1, NOW(), 'running') RETURNING run_id`,
    [`stage3_canonicalization_${MODEL_FILTER}_${PROMPT_FILTER}`],
  );
  return rows[0].run_id;
}

async function finishRun(client, runId, status, meta) {
  await client.query(
    `UPDATE pipeline_runs SET completed_at=NOW(), status=$1, notes=$2 WHERE run_id=$3`,
    [status, JSON.stringify(meta), runId],
  );
}

// ─── Load alias tables into memory ───────────────────────────────────────────

async function loadAliases(client) {
  const sa = await client.query('SELECT alias, canonical_name FROM symptom_aliases');
  const ta = await client.query('SELECT alias, canonical_name FROM treatment_aliases');

  const symptomMap = new Map(sa.rows.map(r => [r.alias.toLowerCase(), r.canonical_name]));
  const treatMap   = new Map(ta.rows.map(r => [r.alias.toLowerCase(), r.canonical_name]));
  return { symptomMap, treatMap };
}

// ─── Normaliser ───────────────────────────────────────────────────────────────

function normalise(rawName, aliasMap, fallback) {
  if (!rawName) return fallback;
  const lower = rawName.toLowerCase().trim();

  // 1. Exact match
  if (aliasMap.has(lower)) return aliasMap.get(lower);

  // 2. Alias is a substring of raw (e.g. raw="hot flashes and night sweats" hits "hot flashes")
  for (const [alias, canonical] of aliasMap) {
    if (lower.includes(alias)) return canonical;
  }

  // 3. Raw is a substring of alias (e.g. raw="hrt" is contained in "hrt / hormone replacement")
  for (const [alias, canonical] of aliasMap) {
    if (alias.includes(lower) && lower.length >= 3) return canonical;
  }

  return fallback;
}

// ─── Bulk insert helpers ──────────────────────────────────────────────────────

async function bulkInsertSymptoms(client, rows) {
  if (rows.length === 0) return 0;
  // 11 params per row — chunk to 500 rows max (5500 params)
  const CHUNK = 500;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const vals  = chunk.map((r, idx) => {
      const b = idx * 11;
      return `($${b+1},$${b+2},$${b+3},$${b+4},$${b+5},$${b+6},$${b+7},$${b+8},$${b+9},$${b+10},$${b+11})`;
    }).join(',');
    const params = chunk.flatMap(r => [
      r.extraction_id, r.source_post_id, r.source_type, r.comment_order,
      r.canonical_name, r.raw_name,
      r.severity || null, r.onset_description || null,
      r.resolved ?? null,
      r.model_name, r.prompt_version,
    ]);
    const res = await client.query(
      `INSERT INTO canonical_symptoms
         (extraction_id, source_post_id, source_type, comment_order,
          canonical_name, raw_name, severity, onset_description,
          resolved, model_name, prompt_version)
       VALUES ${vals}
       ON CONFLICT (extraction_id, canonical_name) DO NOTHING`,
      params,
    );
    inserted += res.rowCount;
  }
  return inserted;
}

async function bulkInsertRawSymptoms(client, rows) {
  if (rows.length === 0) return 0;
  const CHUNK = 500;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const vals = chunk.map((r, idx) => {
      const b = idx * 13;
      return `($${b+1},$${b+2},$${b+3},$${b+4},$${b+5},$${b+6},$${b+7},$${b+8},$${b+9},$${b+10}::jsonb,$${b+11},$${b+12},$${b+13})`;
    }).join(',');
    const params = chunk.flatMap(r => [
      r.extraction_id, r.source_post_id, r.source_type, r.comment_order,
      r.mention_index, r.raw_name, r.severity || null, r.onset_description || null,
      r.resolved ?? null, JSON.stringify(r.raw_payload || {}),
      r.model_name, r.prompt_version, r.created_at || new Date().toISOString(),
    ]);

    const res = await client.query(
      `INSERT INTO raw_symptoms
         (extraction_id, source_post_id, source_type, comment_order,
          mention_index, raw_name, severity, onset_description,
          resolved, raw_payload, model_name, prompt_version, created_at)
       VALUES ${vals}
       ON CONFLICT (extraction_id, mention_index) DO NOTHING`,
      params,
    );
    inserted += res.rowCount;
  }
  return inserted;
}

async function bulkInsertRawTreatments(client, rows) {
  if (rows.length === 0) return 0;
  const CHUNK = 500;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const vals = chunk.map((r, idx) => {
      const b = idx * 14;
      return `($${b+1},$${b+2},$${b+3},$${b+4},$${b+5},$${b+6},$${b+7},$${b+8},$${b+9},$${b+10},$${b+11}::jsonb,$${b+12},$${b+13},$${b+14})`;
    }).join(',');
    const params = chunk.flatMap(r => [
      r.extraction_id, r.source_post_id, r.source_type, r.comment_order,
      r.mention_index, r.raw_name, r.treatment_type || null, r.reported_effect || null,
      r.side_effects?.length ? r.side_effects : [],
      r.duration_description || null,
      JSON.stringify(r.raw_payload || {}),
      r.model_name, r.prompt_version, r.created_at || new Date().toISOString(),
    ]);

    const res = await client.query(
      `INSERT INTO raw_treatments
         (extraction_id, source_post_id, source_type, comment_order,
          mention_index, raw_name, treatment_type, reported_effect,
          side_effects, duration_description, raw_payload,
          model_name, prompt_version, created_at)
       VALUES ${vals}
       ON CONFLICT (extraction_id, mention_index) DO NOTHING`,
      params,
    );
    inserted += res.rowCount;
  }
  return inserted;
}

async function bulkInsertTreatments(client, rows) {
  if (rows.length === 0) return 0;
  const CHUNK = 500;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const vals  = chunk.map((r, idx) => {
      const b = idx * 12;
      return `($${b+1},$${b+2},$${b+3},$${b+4},$${b+5},$${b+6},$${b+7},$${b+8},$${b+9},$${b+10},$${b+11},$${b+12})`;
    }).join(',');
    const params = chunk.flatMap(r => [
      r.extraction_id, r.source_post_id, r.source_type, r.comment_order,
      r.canonical_name, r.raw_name,
      r.treatment_type || null, r.reported_effect || null,
      r.side_effects?.length ? r.side_effects : [],
      r.duration_description || null,
      r.model_name, r.prompt_version,
    ]);
    const res = await client.query(
      `INSERT INTO canonical_treatments
         (extraction_id, source_post_id, source_type, comment_order,
          canonical_name, raw_name, treatment_type, reported_effect,
          side_effects, duration_description, model_name, prompt_version)
       VALUES ${vals}
       ON CONFLICT (extraction_id, canonical_name) DO NOTHING`,
      params,
    );
    inserted += res.rowCount;
  }
  return inserted;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('Stage 3 canonicalization starting');
  console.log(`  model: ${MODEL_FILTER}  prompt: ${PROMPT_FILTER}`);
  if (PILOT_LIMIT) console.log(`  PILOT: first ${PILOT_LIMIT} extractions`);
  if (RESET)       console.log('  RESET: will delete and reprocess all');
  if (TRUNCATE_ALL) console.log('  TRUNCATE_ALL: will clear all Stage 3 raw/canonical tables');

  const client = await pool.connect();
  let runId;
  try {
    runId = await startRun(client);
    console.log(`  pipeline_runs run_id: ${runId}`);

    // ── Optional reset ─────────────────────────────────────────────────────
    if (TRUNCATE_ALL) {
      await client.query('TRUNCATE TABLE raw_treatments, raw_symptoms, canonical_treatments, canonical_symptoms RESTART IDENTITY');
      console.log('  truncate-all done');
    } else if (RESET) {
      await client.query(
        `DELETE FROM canonical_treatments WHERE model_name=$1 AND prompt_version=$2`,
        [MODEL_FILTER, PROMPT_FILTER],
      );
      await client.query(
        `DELETE FROM canonical_symptoms WHERE model_name=$1 AND prompt_version=$2`,
        [MODEL_FILTER, PROMPT_FILTER],
      );
      await client.query(
        `DELETE FROM raw_treatments WHERE model_name=$1 AND prompt_version=$2`,
        [MODEL_FILTER, PROMPT_FILTER],
      );
      await client.query(
        `DELETE FROM raw_symptoms WHERE model_name=$1 AND prompt_version=$2`,
        [MODEL_FILTER, PROMPT_FILTER],
      );
      console.log('  reset done');
    }

    // ── Load alias maps ────────────────────────────────────────────────────
    const { symptomMap, treatMap } = await loadAliases(client);
    console.log(`  loaded ${symptomMap.size} symptom aliases, ${treatMap.size} treatment aliases`);

    // ── Fetch done extractions not yet canonicalised ───────────────────────
    const limitClause = PILOT_LIMIT ? `LIMIT ${PILOT_LIMIT}` : '';
    const { rows: extractions } = await client.query(
      `SELECT re.extraction_id, re.source_post_id, re.source_type,
              re.comment_order, re.extracted_json, re.model_name, re.prompt_version
         FROM reddit_extractions re
        WHERE re.status = 'done'
          AND re.model_name   = $1
          AND re.prompt_version = $2
          AND NOT EXISTS (
            SELECT 1 FROM canonical_symptoms cs
             WHERE cs.extraction_id = re.extraction_id
          )
        ORDER BY re.extraction_id
        ${limitClause}`,
      [MODEL_FILTER, PROMPT_FILTER],
    );

    console.log(`  extractions to process: ${extractions.length}`);
    if (extractions.length === 0) {
      console.log('Nothing to canonicalise.');
      await finishRun(client, runId, 'success', { processed: 0 });
      return;
    }

    // ── Process in batches ─────────────────────────────────────────────────
    let totalSymptoms = 0;
    let totalTreatments = 0;
    let totalRawSymptoms = 0;
    let totalRawTreatments = 0;
    let processed = 0;

    for (let i = 0; i < extractions.length; i += BATCH_SIZE) {
      const batch = extractions.slice(i, i + BATCH_SIZE);
      const symRows = [];
      const treatRows = [];
      const rawSymRows = [];
      const rawTreatRows = [];

      for (const ex of batch) {
        const json = ex.extracted_json;
        if (!json) continue;

        const base = {
          extraction_id: ex.extraction_id,
          source_post_id: ex.source_post_id,
          source_type: ex.source_type,
          comment_order: ex.comment_order,
          model_name: ex.model_name,
          prompt_version: ex.prompt_version,
        };

        // Symptoms
        const symptoms = Array.isArray(json.symptoms) ? json.symptoms : [];
        const seenSymptoms = new Set();
        symptoms.forEach((s, idx) => {
          const rawName = typeof s === 'string' ? s : s?.name;
          if (!rawName) return;

          rawSymRows.push({
            ...base,
            mention_index: idx,
            raw_name: rawName,
            severity: typeof s === 'object' ? s.severity : null,
            onset_description: typeof s === 'object' ? s.onset_description : null,
            resolved: sanitizeBool(typeof s === 'object' ? s.resolved : null),
            raw_payload: typeof s === 'object' ? s : { name: rawName },
          });

          const canonical = normalise(rawName, symptomMap, 'other_symptom');
          if (seenSymptoms.has(canonical)) return;  // one row per canonical per extraction
          seenSymptoms.add(canonical);
          symRows.push({
            ...base,
            canonical_name: canonical,
            raw_name: rawName,
            severity: typeof s === 'object' ? s.severity : null,
            onset_description: typeof s === 'object' ? s.onset_description : null,
            resolved: sanitizeBool(typeof s === 'object' ? s.resolved : null),
          });
        });

        // Treatments
        const treatments = Array.isArray(json.treatments) ? json.treatments : [];
        const seenTreats = new Set();
        treatments.forEach((t, idx) => {
          const rawName = typeof t === 'string' ? t : t?.name;
          if (!rawName) return;

          rawTreatRows.push({
            ...base,
            mention_index: idx,
            raw_name: rawName,
            treatment_type: typeof t === 'object' ? t.type : null,
            reported_effect: sanitizeEffect(typeof t === 'object' ? t.reported_effect : null),
            side_effects: typeof t === 'object' && Array.isArray(t.side_effects) ? t.side_effects : [],
            duration_description: typeof t === 'object' ? t.duration_description : null,
            raw_payload: typeof t === 'object' ? t : { name: rawName },
          });

          const canonical = normalise(rawName, treatMap, 'other_treatment');
          if (seenTreats.has(canonical)) return;
          seenTreats.add(canonical);
          treatRows.push({
            ...base,
            canonical_name: canonical,
            raw_name: rawName,
            treatment_type: typeof t === 'object' ? t.type : null,
            reported_effect: sanitizeEffect(typeof t === 'object' ? t.reported_effect : null),
            side_effects: typeof t === 'object' && Array.isArray(t.side_effects) ? t.side_effects : [],
            duration_description: typeof t === 'object' ? t.duration_description : null,
          });
        });
      }

      const rs = await bulkInsertRawSymptoms(client, rawSymRows);
      const rt = await bulkInsertRawTreatments(client, rawTreatRows);
      const s = await bulkInsertSymptoms(client, symRows);
      const t = await bulkInsertTreatments(client, treatRows);
      totalRawSymptoms += rs;
      totalRawTreatments += rt;
      totalSymptoms += s;
      totalTreatments += t;
      processed += batch.length;

      if (processed % 2000 === 0 || processed === extractions.length) {
        console.log(`  ${processed} / ${extractions.length} extractions processed`
          + `  (+${rs} raw_symptoms, +${rt} raw_treatments, +${s} symptoms, +${t} treatments this batch)`);
      }
    }

    // ── Summary ────────────────────────────────────────────────────────────
    const meta = {
      model: MODEL_FILTER, prompt: PROMPT_FILTER,
      extractions_processed: processed,
      raw_symptoms_inserted: totalRawSymptoms,
      raw_treatments_inserted: totalRawTreatments,
      symptoms_inserted: totalSymptoms,
      treatments_inserted: totalTreatments,
    };
    await finishRun(client, runId, 'success', meta);

    console.log('\n=== Stage 3 Canonicalization Complete ===');
    console.log(`  run_id               : ${runId}`);
    console.log(`  extractions processed: ${processed}`);
    console.log(`  raw symptom rows ins.: ${totalRawSymptoms}`);
    console.log(`  raw treatment rows in: ${totalRawTreatments}`);
    console.log(`  symptom rows inserted: ${totalSymptoms}`);
    console.log(`  treatment rows ins.  : ${totalTreatments}`);

  } catch (err) {
    if (runId) {
      await finishRun(client, runId, 'failed', { error: err.message }).catch(() => {});
    }
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
