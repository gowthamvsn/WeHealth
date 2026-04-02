#!/usr/bin/env node
/**
 * Stage 4 — LLM Menotype Categorization
 *
 * Reads canonical symptoms per Reddit post, calls GPT-4.1 to categorize into
 * one of 5 menotypes, stores results in menotype_ml_profiles.
 *
 * Menotypes:
 *   0 = Cognitive fatigue menopause (brain fog + fatigue)
 *   1 = Anxiety-dominant menopause (anxiety dominant)
 *   2 = Vasomotor insomnia menopause (hot flashes + sleep)
 *   3 = Inflammatory pain menopause (pain + inflammation)
 *   4 = Hormonal transition menopause (mixed hormonal)
 *
 * Usage:
 *   node scripts/stage4_llm_categorize_menotypes.js --reset --concurrency 5
 *   node scripts/stage4_llm_categorize_menotypes.js --model we-gpt-4.1
 *
 * Flags:
 *   --reset              Clear & reprocess all posts
 *   --model MODEL        Override Azure model (default: we-gpt-4.1)
 *   --api-version VER    Override API version (default: 2024-10-21)
 *   --concurrency N      Parallel LLM calls (default: 3)
 *   --limit N            Max posts to process (default: all)
 */

'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { Pool } = require('pg');

// ─── Args ─────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const RESET = args.includes('--reset');
const modelIdx = args.indexOf('--model');
const apiVerIdx = args.indexOf('--api-version');
const concurrencyIdx = args.indexOf('--concurrency');
const limitIdx = args.indexOf('--limit');

const MODEL = modelIdx !== -1 ? String(args[modelIdx + 1]) : process.env.AZURE_OPENAI_DEPLOYMENT;
const API_VERSION = apiVerIdx !== -1 ? String(args[apiVerIdx + 1]) : '2024-10-21';
const CONCURRENCY = concurrencyIdx !== -1 ? parseInt(args[concurrencyIdx + 1], 10) : 3;
const LIMIT = limitIdx !== -1 ? parseInt(args[limitIdx + 1], 10) : null;

const ENDPOINT = (process.env.AZURE_OPENAI_ENDPOINT || '').replace(/\/$/, '');
const KEY = process.env.AZURE_OPENAI_KEY;

const pool = new Pool({
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  port: parseInt(process.env.PGPORT || '5432', 10),
  ssl: { rejectUnauthorized: false },
});

// ─── Menotype Definitions ─────────────────────────────────────────────────────

const MENOTYPES = [
  {
    id: 0,
    name: 'Cognitive fatigue menopause',
    dominant_symptoms: ['brain_fog', 'memory_loss', 'fatigue'],
    description: 'Dominant: brain fog and cognitive fatigue',
  },
  {
    id: 1,
    name: 'Anxiety-dominant menopause',
    dominant_symptoms: ['anxiety', 'depression', 'mood_swings'],
    description: 'Dominant: anxiety, mood disturbances, emotional volatility',
  },
  {
    id: 2,
    name: 'Vasomotor insomnia menopause',
    dominant_symptoms: ['hot_flashes', 'temperature', 'sleep'],
    description: 'Dominant: hot flashes, night sweats, and sleep disturbance',
  },
  {
    id: 3,
    name: 'Inflammatory pain menopause',
    dominant_symptoms: ['pain', 'fatigue', 'headaches', 'palpitations'],
    description: 'Dominant: localized or generalized pain, inflammation, somatic complaints',
  },
  {
    id: 4,
    name: 'Hormonal transition menopause',
    dominant_symptoms: ['irregular_periods', 'breast_pain', 'hair_skin', 'weight_changes'],
    description: 'Dominant: hormonal markers, hair/skin changes, metabolic shifts',
  },
];

// ─── LLM Prompt Generator ─────────────────────────────────────────────────────

function menotypeCategorizePrompt(symptoms) {
  const symptomList = symptoms.join(', ');
  
  return {
    system: `You are a menopause health expert categorizing symptom profiles into 5 distinct menotypes. 
Your task is to identify the PRIMARY menotype that best fits a given symptom profile.

MENOTYPES (5 clinically-distinct categories):
0. Cognitive fatigue menopause: Dominant symptoms are brain fog, memory loss, and fatigue
1. Anxiety-dominant menopause: Dominant symptoms are anxiety, depression, and mood swings
2. Vasomotor insomnia menopause: Dominant symptoms are hot flashes, temperature changes, and sleep disturbance
3. Inflammatory pain menopause: Dominant symptoms are pain (localized/generalized), fatigue, headaches, palpitations
4. Hormonal transition menopause: Dominant symptoms are irregular periods, breast pain, hair/skin changes, weight changes

INSTRUCTIONS:
- Analyze the symptom list carefully.
- Identify which category BEST matches the dominant cluster.
- Return ONLY valid JSON with: { "menotype_id": 0-4, "confidence": 0.7-1.0, "reasoning": "brief explanation" }
- If multiple menotypes are present, pick the most prominent one.
- Confidence: 0.7 (weak match with fallback), 0.8 (moderate match), 0.9+ (strong match)
- Do NOT return markdown, explanations, or any text outside the JSON.`,
    
    user: `Categorize this symptom profile into one of the 5 menotypes:\n\nSymptoms: ${symptomList}\n\nRespond with valid JSON only, no markdown.`,
  };
}

// ─── Azure OpenAI LLM Call ────────────────────────────────────────────────────

async function callMenypeMapper(symptoms, retries = 2) {
  const url = `${ENDPOINT}/openai/deployments/${MODEL}/chat/completions?api-version=${API_VERSION}`;
  const prompt = menotypeCategorizePrompt(symptoms);
  
  const payload = JSON.stringify({
    messages: [
      { role: 'system', content: prompt.system },
      { role: 'user', content: prompt.user },
    ],
    temperature: 0.5,
    max_tokens: 150,
    response_format: { type: 'json_object' },
  });

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'api-key': KEY,
        },
        body: payload,
      });

      if (!resp.ok) {
        if (resp.status === 429) {
          console.log(`[menotype] rate limited, waiting 5s...`);
          await new Promise(r => setTimeout(r, 5000));
          continue;
        }
        throw new Error(`HTTP ${resp.status}: ${await resp.text()}`);
      }

      const json = await resp.json();
      const content = json.choices?.[0]?.message?.content || '';
      const parsed = JSON.parse(content);

      if (typeof parsed.menotype_id === 'number' && parsed.menotype_id >= 0 && parsed.menotype_id <= 4) {
        return {
          menotype_id: parsed.menotype_id,
          confidence: Math.min(1, Math.max(0.7, parsed.confidence || 0.8)),
          reasoning: String(parsed.reasoning || ''),
        };
      }

      throw new Error(`Invalid menotype_id: ${parsed.menotype_id}`);
    } catch (err) {
      if (attempt === retries - 1) throw err;
      await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
}

// ─── Fallback: Heuristic Categorization ───────────────────────────────────────

function fallbackCategorize(symptoms) {
  const symp = new Set(symptoms.map(s => s.toLowerCase()));
  
  // Count menotype marker symptoms
  const scores = [0, 0, 0, 0, 0];
  
  if (symp.has('brain_fog') || symp.has('memory_loss') || symp.has('fatigue')) scores[0] += 2;
  if (symp.has('anxiety') || symp.has('depression') || symp.has('mood_swings')) scores[1] += 2;
  if (symp.has('hot_flashes') || symp.has('temperature') || symp.has('sleep')) scores[2] += 2;
  if (symp.has('pain') || symp.has('headaches') || symp.has('palpitations')) scores[3] += 2;
  if (symp.has('irregular_periods') || symp.has('breast_pain') || symp.has('hair_skin') || symp.has('weight_changes')) scores[4] += 2;
  
  // Minor scoring for related symptoms
  if (symp.has('dizziness') || symp.has('tingling')) scores[3]++;
  if (symp.has('libido')) scores[4]++;

  const maxScore = Math.max(...scores);
  const menotype_id = scores.indexOf(maxScore);
  const confidence = maxScore > 0 ? 0.7 : 0.5;

  return { menotype_id, confidence, reasoning: 'heuristic fallback' };
}

// ─── Concurrent LLM Worker ────────────────────────────────────────────────────

async function runWithConcurrency(posts, pool, concurrency) {
  let completed = 0;
  let updated = 0;
  let failed = 0;
  let idx = 0;

  const workers = Array.from({ length: concurrency }, async () => {
    while (idx < posts.length) {
      const post = posts[idx++];
      try {
        let result;
        try {
          result = await callMenypeMapper(post.symptoms);
        } catch (err) {
          console.log(`[menotype] LLM error for post ${post.source_post_id}: ${err.message}, using fallback`);
          result = fallbackCategorize(post.symptoms);
          failed++;
        }

        const res = await pool.query(
          `INSERT INTO menotype_ml_profiles
             (extraction_id, source_post_id, source_type, comment_order,
              model_name, cluster_id, primary_menotype, secondary_menotype,
              confidence, symptom_count, extraction_count, top_symptoms, symptom_profile, created_at)
           VALUES ($1, $2, $3, $4, $5, 0, $6, NULL, $7, $8, $8, $9, $10, NOW())
           ON CONFLICT (extraction_id, model_name) DO UPDATE SET
             primary_menotype  = EXCLUDED.primary_menotype,
             confidence        = EXCLUDED.confidence,
             top_symptoms      = EXCLUDED.top_symptoms,
             symptom_profile   = EXCLUDED.symptom_profile,
             updated_at        = NOW()`,
          [
            post.extraction_id,
            post.source_post_id,
            post.source_type,
            post.comment_order ?? null,
            MODEL,
            result.menotype_id,
            result.confidence,
            post.symptoms.length,
            JSON.stringify(post.symptoms),
            JSON.stringify({ symptoms: post.symptoms, reasoning: result.reasoning }),
          ],
        );

        if (res.rowCount > 0) updated++;
        completed++;

        if (completed % 200 === 0) {
          console.log(`[menotype] ${completed} extractions processed, ${updated} inserted/updated, ${failed} LLM errors`);
        }
      } catch (err) {
        console.error(`[menotype] DB error for post: ${err.message}`);
        failed++;
      }
    }
  });

  await Promise.all(workers);
  return { completed, updated, failed };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const client = await pool.connect();
  try {
    console.log('[menotype] Stage 4 LLM menotype categorization starting');
    console.log(`  model: ${MODEL}  api_version: ${API_VERSION}`);
    console.log(`  concurrency: ${CONCURRENCY}`);

    if (RESET) {
      await client.query('TRUNCATE TABLE menotype_ml_profiles RESTART IDENTITY CASCADE');
      console.log('  RESET: truncated menotype_ml_profiles (posts + comments)');
    }

    // Load each extraction (post OR comment) independently with its own symptoms
    // Each extraction_id is unique: one row per post, one row per comment
    let query = `
      SELECT
        cs.extraction_id::text,
        cs.source_post_id,
        cs.source_type,
        cs.comment_order,
        ARRAY_AGG(DISTINCT cs.canonical_name ORDER BY cs.canonical_name) AS symptoms
      FROM canonical_symptoms cs
      WHERE NOT EXISTS (
        SELECT 1 FROM menotype_ml_profiles mmp
        WHERE mmp.extraction_id = cs.extraction_id::text AND mmp.model_name = $1
      )
      GROUP BY cs.extraction_id, cs.source_post_id, cs.source_type, cs.comment_order
      ORDER BY cs.source_post_id, cs.source_type, cs.comment_order`;

    if (LIMIT) query += ` LIMIT ${LIMIT}`;

    const { rows: posts } = await client.query(query, [MODEL]);
    const postCount  = posts.filter(r => r.source_type === 'post').length;
    const commCount  = posts.filter(r => r.source_type === 'comment').length;
    console.log(`[menotype] extractions to categorize: ${posts.length} (${postCount} posts, ${commCount} comments)`);

    if (posts.length === 0) {
      console.log('[menotype] no extractions to process');
      return;
    }

    // Run concurrent categorization
    const result = await runWithConcurrency(posts, pool, CONCURRENCY);

    const postsDone  = posts.filter(r => r.source_type === 'post').length;
    const commsDone  = posts.filter(r => r.source_type === 'comment').length;
    console.log('[menotype] complete');
    console.log(`  total extractions: ${result.completed} (${postsDone} posts, ${commsDone} comments)`);
    console.log(`  inserted/updated: ${result.updated}`);
    console.log(`  llm_errors: ${result.failed}`);

  } catch (err) {
    console.error('FATAL:', err.message);
    process.exitCode = 1;
  } finally {
    await client.release();
    await pool.end();
  }
}

main();
