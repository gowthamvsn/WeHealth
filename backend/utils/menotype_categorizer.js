/**
 * Menotype Categorizer for User Check-ins
 *
 * Single function that can be called from API routes to categorize
 * a user's symptoms into one of 5 menotypes.
 *
 * Usage (from API):
 *   const { categorizeMenotype } = require('./menotype_categorizer');
 *   const result = await categorizeMenotype(['anxiety', 'depression', 'mood_swings']);
 *   // { menotype_id: 1, menotype_name: 'Anxiety-dominant menopause', confidence: 0.95 }
 */

'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const ENDPOINT = (process.env.AZURE_OPENAI_ENDPOINT || '').replace(/\/$/, '');
const KEY = process.env.AZURE_OPENAI_KEY;
const MODEL = process.env.AZURE_OPENAI_DEPLOYMENT || 'we-gpt-4.1';
const API_VERSION = '2024-10-21';

// ─── Menotype Definitions ─────────────────────────────────────────────────────

const MENOTYPES = [
  {
    id: 0,
    name: 'Cognitive fatigue menopause',
    dominant_symptoms: ['brain_fog', 'memory_loss', 'fatigue'],
    description: 'Brain fog, cognitive fatigue, memory loss',
  },
  {
    id: 1,
    name: 'Anxiety-dominant menopause',
    dominant_symptoms: ['anxiety', 'depression', 'mood_swings'],
    description: 'Anxiety, mood disturbances, emotional volatility',
  },
  {
    id: 2,
    name: 'Vasomotor insomnia menopause',
    dominant_symptoms: ['hot_flashes', 'temperature', 'sleep'],
    description: 'Hot flashes, night sweats, sleep disturbance',
  },
  {
    id: 3,
    name: 'Inflammatory pain menopause',
    dominant_symptoms: ['pain', 'fatigue', 'headaches', 'palpitations'],
    description: 'Pain, inflammation, somatic complaints',
  },
  {
    id: 4,
    name: 'Hormonal transition menopause',
    dominant_symptoms: ['irregular_periods', 'breast_pain', 'hair_skin', 'weight_changes'],
    description: 'Hormonal markers, metabolic shifts',
  },
];

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
- Confidence: 0.7 (weak match), 0.8 (moderate match), 0.9+ (strong match)
- Do NOT return markdown or any text outside the JSON.`,
    
    user: `Categorize this symptom profile into one of the 5 menotypes:\n\nSymptoms: ${symptomList}\n\nRespond with valid JSON only.`,
  };
}

// ─── LLM Call ─────────────────────────────────────────────────────────────────

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
          await new Promise(r => setTimeout(r, 2000));
          continue;
        }
        throw new Error(`HTTP ${resp.status}`);
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
      throw new Error(`Invalid menotype_id`);
    } catch (err) {
      if (attempt === retries - 1) throw err;
      await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
}

// ─── Heuristic Fallback ───────────────────────────────────────────────────────

function fallbackCategorize(symptoms) {
  const symp = new Set(symptoms.map(s => s.toLowerCase()));
  const scores = [0, 0, 0, 0, 0];
  
  if (symp.has('brain_fog') || symp.has('memory_loss') || symp.has('fatigue')) scores[0] += 2;
  if (symp.has('anxiety') || symp.has('depression') || symp.has('mood_swings')) scores[1] += 2;
  if (symp.has('hot_flashes') || symp.has('temperature') || symp.has('sleep')) scores[2] += 2;
  if (symp.has('pain') || symp.has('headaches') || symp.has('palpitations')) scores[3] += 2;
  if (symp.has('irregular_periods') || symp.has('breast_pain') || symp.has('hair_skin') || symp.has('weight_changes')) scores[4] += 2;
  
  if (symp.has('dizziness') || symp.has('tingling')) scores[3]++;
  if (symp.has('libido')) scores[4]++;

  const maxScore = Math.max(...scores);
  const menotype_id = scores.indexOf(maxScore);

  return { menotype_id, confidence: maxScore > 0 ? 0.75 : 0.6, reasoning: 'heuristic' };
}

// ─── Main Export ──────────────────────────────────────────────────────────────

async function categorizeMenotype(symptoms) {
  if (!Array.isArray(symptoms) || symptoms.length === 0) {
    return {
      menotype_id: 4, // default to hormonal transition
      menotype_name: 'Hormonal transition menopause',
      confidence: 0.5,
      reasoning: 'no symptoms provided',
    };
  }

  try {
    // Try LLM first
    const result = await callMenypeMapper(symptoms);
    const menotype = MENOTYPES[result.menotype_id];
    return {
      menotype_id: result.menotype_id,
      menotype_name: menotype.name,
      confidence: result.confidence,
      reasoning: result.reasoning,
    };
  } catch (err) {
    // Fallback to heuristic
    const result = fallbackCategorize(symptoms);
    const menotype = MENOTYPES[result.menotype_id];
    return {
      menotype_id: result.menotype_id,
      menotype_name: menotype.name,
      confidence: result.confidence,
      reasoning: result.reasoning,
    };
  }
}

async function getMenotypeCohortStats(menotype_id, pool) {
  if (!pool) {
    console.error('menotype_categorizer: pool not provided for cohort stats');
    return null;
  }

  try {
    const { rows } = await pool.query(
      `WITH cohort AS (
         SELECT extraction_id
           FROM menotype_ml_profiles
          WHERE primary_menotype = $1
            AND model_name = $2
       )
       SELECT
         (SELECT COUNT(*)::int FROM cohort) AS cohort_size,
         COALESCE(
           ARRAY(
             SELECT ct.canonical_name
               FROM canonical_treatments ct
               JOIN cohort c ON c.extraction_id = ct.extraction_id::text
              WHERE ct.canonical_name <> 'other_treatment'
              GROUP BY ct.canonical_name
              ORDER BY COUNT(*) DESC
              LIMIT 10
           ),
           ARRAY[]::text[]
         ) AS common_treatments`,
      [menotype_id, MODEL],
    );
    return rows[0] || null;
  } catch (err) {
    console.error(`menotype_categorizer: error fetching cohort stats: ${err.message}`);
    return null;
  }
}

module.exports = {
  categorizeMenotype,
  getMenotypeCohortStats,
  MENOTYPES,
};
