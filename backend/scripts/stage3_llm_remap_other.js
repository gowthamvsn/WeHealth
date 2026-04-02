'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { Pool } = require('pg');

const args = process.argv.slice(2);
const modelIdx = args.indexOf('--model');
const promptIdx = args.indexOf('--prompt-version');
const concIdx = args.indexOf('--concurrency');
const apiVerIdx = args.indexOf('--api-version');
const limitIdx = args.indexOf('--limit');

const MODEL_FILTER = modelIdx !== -1
  ? String(args[modelIdx + 1] || process.env.AZURE_OPENAI_DEPLOYMENT)
  : process.env.AZURE_OPENAI_DEPLOYMENT;
const PROMPT_FILTER = promptIdx !== -1 ? String(args[promptIdx + 1] || 'v1') : 'v1';
const CONCURRENCY = concIdx !== -1 ? Math.max(1, parseInt(args[concIdx + 1] || '3', 10)) : 3;
const API_VERSION = apiVerIdx !== -1
  ? String(args[apiVerIdx + 1] || process.env.AZURE_OPENAI_API_VERSION || '2024-10-21')
  : String(process.env.AZURE_OPENAI_API_VERSION || '2024-10-21');
const LIMIT = limitIdx !== -1 ? Math.max(1, parseInt(args[limitIdx + 1] || '1000000', 10)) : 1000000;

const ENDPOINT = process.env.AZURE_OPENAI_ENDPOINT;
const API_KEY = process.env.AZURE_OPENAI_KEY;
const LLM_MODEL = process.env.AZURE_OPENAI_DEPLOYMENT;

if (!ENDPOINT || !API_KEY) {
  throw new Error('Missing Azure OpenAI endpoint/key in backend/.env.');
}
if (!LLM_MODEL) {
  throw new Error('Missing AZURE_OPENAI_DEPLOYMENT in backend/.env for remap pass.');
}

const pool = new Pool({
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  port: parseInt(process.env.PGPORT || '5432', 10),
  ssl: { rejectUnauthorized: false },
});

function remapPrompt(entityType, rawName, allowedCanonical, fallback) {
  return {
    system: 'You map one raw medical mention to ONE canonical label from an allowed list. Return JSON only.',
    user: [
      `Entity type: ${entityType}`,
      `Raw mention: ${rawName}`,
      `Allowed canonical labels: ${allowedCanonical.join(', ')}`,
      `Rules: choose exactly one label from the allowed list; if uncertain, return ${fallback}; do not invent labels.`,
      'Return JSON: {"canonical_name":"<label>","confidence":<0..1>}'
    ].join('\n')
  };
}

async function callMapper(entityType, rawName, allowedCanonical, fallback) {
  const url = `${ENDPOINT}/openai/deployments/${LLM_MODEL}/chat/completions?api-version=${API_VERSION}`;
  const prompt = remapPrompt(entityType, rawName, allowedCanonical, fallback);

  const body = JSON.stringify({
    messages: [
      { role: 'system', content: prompt.system },
      { role: 'user', content: prompt.user },
    ],
    temperature: 0,
    max_tokens: 120,
    response_format: { type: 'json_object' },
  });

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-key': API_KEY,
    },
    body,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText);
    throw new Error(`HTTP ${res.status}: ${errText}`);
  }

  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error('Empty mapper response');

  const parsed = JSON.parse(content);
  const canonical = String(parsed.canonical_name || '').trim();
  const confidence = Number(parsed.confidence ?? 0);
  return {
    canonical_name: canonical || fallback,
    confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0,
  };
}

async function getCanonicalNames(tableName, excludeName) {
  const { rows } = await pool.query(`SELECT canonical_name FROM ${tableName} WHERE canonical_name <> $1 ORDER BY canonical_name`, [excludeName]);
  return rows.map(r => r.canonical_name);
}

async function fetchOtherRows(kind, limit) {
  const sql = kind === 'symptom'
    ? `SELECT id, extraction_id, raw_name, canonical_name, model_name, prompt_version
         FROM canonical_symptoms
        WHERE model_name=$1 AND prompt_version=$2 AND canonical_name='other_symptom'
          AND COALESCE(raw_name,'') <> ''
        ORDER BY id
        LIMIT $3`
    : `SELECT id, extraction_id, raw_name, canonical_name, model_name, prompt_version
         FROM canonical_treatments
        WHERE model_name=$1 AND prompt_version=$2 AND canonical_name='other_treatment'
          AND COALESCE(raw_name,'') <> ''
        ORDER BY id
        LIMIT $3`;

  const { rows } = await pool.query(sql, [MODEL_FILTER, PROMPT_FILTER, limit]);
  return rows;
}

async function applyRemap(kind, row, mappedCanonical, confidence) {
  if (kind === 'symptom') {
    await pool.query(
      `UPDATE canonical_symptoms
          SET canonical_name = $1
        WHERE id = $2`,
      [mappedCanonical, row.id],
    );
  } else {
    await pool.query(
      `UPDATE canonical_treatments
          SET canonical_name = $1
        WHERE id = $2`,
      [mappedCanonical, row.id],
    );
  }

  await pool.query(
    `INSERT INTO stage3_llm_remap_audit
       (entity_type, row_id, extraction_id, raw_name, old_canonical, new_canonical,
        llm_model, llm_confidence, model_name, prompt_version)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      kind,
      row.id,
      row.extraction_id,
      row.raw_name,
      row.canonical_name,
      mappedCanonical,
      LLM_MODEL,
      confidence,
      row.model_name,
      row.prompt_version,
    ],
  );
}

async function runWithConcurrency(items, worker, concurrency) {
  let idx = 0;
  const out = { processed: 0, updated: 0, failed: 0 };

  async function next() {
    while (idx < items.length) {
      const item = items[idx++];
      try {
        const updated = await worker(item);
        out.processed++;
        if (updated) out.updated++;
      } catch (e) {
        out.failed++;
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, next));
  return out;
}

async function remapKind(kind, allowedCanonical, fallback) {
  const rows = await fetchOtherRows(kind, LIMIT);
  if (!rows.length) {
    console.log(`[remap] ${kind}: no ${fallback} rows to remap`);
    return { processed: 0, updated: 0, failed: 0 };
  }

  console.log(`[remap] ${kind}: candidates=${rows.length}`);

  const stats = await runWithConcurrency(rows, async (row) => {
    const mapped = await callMapper(kind, row.raw_name, allowedCanonical, fallback);
    if (!allowedCanonical.includes(mapped.canonical_name) && mapped.canonical_name !== fallback) {
      return false;
    }
    if (mapped.canonical_name === row.canonical_name) {
      return false;
    }
    await applyRemap(kind, row, mapped.canonical_name, mapped.confidence);
    return true;
  }, CONCURRENCY);

  console.log(`[remap] ${kind}: processed=${stats.processed} updated=${stats.updated} failed=${stats.failed}`);
  return stats;
}

async function main() {
  console.log('[remap] Stage 3 LLM remap starting');
  console.log(`[remap] source model=${MODEL_FILTER} prompt=${PROMPT_FILTER}`);
  console.log(`[remap] llm_model=${LLM_MODEL} api_version=${API_VERSION} concurrency=${CONCURRENCY}`);

  const symptomCanonical = await getCanonicalNames('symptom_vocab', 'other_symptom');
  const treatmentCanonical = await getCanonicalNames('treatment_vocab', 'other_treatment');

  const sym = await remapKind('symptom', symptomCanonical, 'other_symptom');
  const trt = await remapKind('treatment', treatmentCanonical, 'other_treatment');

  console.log('[remap] complete');
  console.log(`[remap] symptom_updated=${sym.updated} treatment_updated=${trt.updated}`);
}

main().catch((e) => {
  console.error('[remap] fatal:', e.message);
  process.exit(1);
}).finally(async () => {
  await pool.end();
});
