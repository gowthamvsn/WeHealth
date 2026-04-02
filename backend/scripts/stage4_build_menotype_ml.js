#!/usr/bin/env node
'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { Pool } = require('pg');

const args = process.argv.slice(2);
const kIdx = args.indexOf('--k');
const seedIdx = args.indexOf('--seed');
const modelIdx = args.indexOf('--model-name');
const kMinIdx = args.indexOf('--k-min');
const kMaxIdx = args.indexOf('--k-max');
const labelModeIdx = args.indexOf('--label-mode');
const weightModeIdx = args.indexOf('--weight-mode');
const featureModeIdx = args.indexOf('--feature-mode');

const K_OVERRIDE = kIdx !== -1 ? parseInt(args[kIdx + 1] || '6', 10) : null;
const K_MIN = kMinIdx !== -1 ? parseInt(args[kMinIdx + 1] || '2', 10) : 2;
const K_MAX = kMaxIdx !== -1 ? parseInt(args[kMaxIdx + 1] || '11', 10) : 11;
const SEED = seedIdx !== -1 ? parseInt(args[seedIdx + 1] || '42', 10) : 42;
const MODEL_NAME = modelIdx !== -1 ? String(args[modelIdx + 1] || 'menotype_kmeans_v2style') : 'menotype_kmeans_v2style';
const RESET = args.includes('--reset');
const INCLUDE_OTHER = args.includes('--include-other-symptom');
const LABEL_MODE = labelModeIdx !== -1 ? String(args[labelModeIdx + 1] || 'cluster') : 'cluster';
const WEIGHT_MODE = weightModeIdx !== -1 ? String(args[weightModeIdx + 1] || 'idf') : 'idf';
// binary: 0/1 presence (matches v2 exactly). float: mention rate 0.0–1.0 (default, richer signal).
const FEATURE_MODE = featureModeIdx !== -1 ? String(args[featureModeIdx + 1] || 'float') : 'float';

const pool = new Pool({
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  port: parseInt(process.env.PGPORT || '5432', 10),
  ssl: { rejectUnauthorized: false },
  max: 10,
});

const V2_STYLE_FEATURES = [
  'hot_flashes',
  'sleep',
  'anxiety',
  'depression',
  'brain_fog',
  'mood_swings',
  'fatigue',
  'pain',
  'headaches',
  'palpitations',
  'vaginal_dryness',
  'libido',
  'irregular_periods',
  'weight_changes',
  'hair_skin',
  'digestive',
  'urinary',
  'breast_pain',
  'dizziness',
  'tingling',
  'suicidal',
  'memory_loss',
  'temperature',
];

function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function distance(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    s += d * d;
  }
  return Math.sqrt(s);
}

function distance2(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    s += d * d;
  }
  return s;
}

function nearest(point, centroids) {
  let best = 0;
  let bestD2 = Number.POSITIVE_INFINITY;
  let secondD2 = Number.POSITIVE_INFINITY;
  for (let i = 0; i < centroids.length; i++) {
    const d2 = distance2(point, centroids[i]);
    if (d2 < bestD2) {
      secondD2 = bestD2;
      bestD2 = d2;
      best = i;
    } else if (d2 < secondD2) {
      secondD2 = d2;
    }
  }
  return { best, bestD2, secondD2 };
}

function kMeansPPSeeds(data, k, rand) {
  // k-means++ initialization: each subsequent centroid chosen with probability
  // proportional to D²(x) — distance squared to nearest already-chosen centroid.
  // This spreads initial centroids apart, dramatically reducing bad local optima.
  const n = data.length;
  const centroids = [];

  // Pick first centroid uniformly at random.
  centroids.push(data[Math.floor(rand() * n)].slice());

  for (let c = 1; c < k; c++) {
    // Compute D²(x) for each point = distance² to nearest existing centroid.
    const d2 = new Array(n);
    let totalD2 = 0;
    for (let i = 0; i < n; i++) {
      let minD2 = Infinity;
      for (const cent of centroids) {
        let s = 0;
        for (let j = 0; j < data[i].length; j++) {
          const diff = data[i][j] - cent[j];
          s += diff * diff;
        }
        if (s < minD2) minD2 = s;
      }
      d2[i] = minD2;
      totalD2 += minD2;
    }
    // Sample next centroid proportional to D²
    let r = rand() * totalD2;
    for (let i = 0; i < n; i++) {
      r -= d2[i];
      if (r <= 0) {
        centroids.push(data[i].slice());
        break;
      }
    }
    // Fallback if floating-point leaves r > 0 at end
    if (centroids.length < c + 1) centroids.push(data[n - 1].slice());
  }

  return centroids;
}

function runKMeans(data, k, seed, maxIter = 200) {
  const rand = mulberry32(seed);
  const n = data.length;
  const dim = data[0].length;

  // Use k-means++ for smarter initialization instead of pure random seeding.
  const centroids = kMeansPPSeeds(data, k, rand);

  let assignments = new Array(n).fill(0);
  for (let iter = 0; iter < maxIter; iter++) {
    let changed = false;

    for (let i = 0; i < n; i++) {
      const hit = nearest(data[i], centroids);
      if (assignments[i] !== hit.best) {
        assignments[i] = hit.best;
        changed = true;
      }
    }

    const sums = Array.from({ length: k }, () => new Array(dim).fill(0));
    const counts = new Array(k).fill(0);
    for (let i = 0; i < n; i++) {
      const c = assignments[i];
      counts[c]++;
      for (let j = 0; j < dim; j++) sums[c][j] += data[i][j];
    }

    for (let c = 0; c < k; c++) {
      if (counts[c] === 0) {
        const idx = Math.floor(rand() * n);
        centroids[c] = data[idx].slice();
        continue;
      }
      for (let j = 0; j < dim; j++) centroids[c][j] = sums[c][j] / counts[c];
    }

    if (!changed) break;
  }

  let inertia = 0;
  for (let i = 0; i < n; i++) inertia += distance2(data[i], centroids[assignments[i]]);
  return { centroids, assignments, inertia };
}

function silhouetteScore(data, assignments, k) {
  const n = data.length;
  if (k < 2 || n < 3) return 0;

  const clusters = Array.from({ length: k }, () => []);
  for (let i = 0; i < n; i++) clusters[assignments[i]].push(i);

  const dist = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = distance(data[i], data[j]);
      dist[i][j] = d;
      dist[j][i] = d;
    }
  }

  let sum = 0;
  let used = 0;
  for (let i = 0; i < n; i++) {
    const own = assignments[i];
    const ownMembers = clusters[own];
    if (ownMembers.length <= 1) continue;

    let a = 0;
    for (const j of ownMembers) if (j !== i) a += dist[i][j];
    a /= (ownMembers.length - 1);

    let b = Number.POSITIVE_INFINITY;
    for (let c = 0; c < k; c++) {
      if (c === own || clusters[c].length === 0) continue;
      let avg = 0;
      for (const j of clusters[c]) avg += dist[i][j];
      avg /= clusters[c].length;
      if (avg < b) b = avg;
    }

    if (!Number.isFinite(b)) continue;
    const s = (b - a) / Math.max(a, b);
    sum += s;
    used++;
  }

  return used ? sum / used : 0;
}

function buildDomainMap() {
  return {
    vasomotor: ['hot_flashes', 'temperature'],
    psychological: ['anxiety', 'depression', 'mood_swings'],
    neurocognitive: ['brain_fog', 'memory_loss', 'headaches', 'dizziness'],
    pain_somatic: ['pain', 'fatigue', 'palpitations', 'tingling', 'breast_pain'],
    urogenital: ['vaginal_dryness', 'urinary', 'libido', 'irregular_periods'],
    metabolic_other: ['weight_changes', 'digestive', 'hair_skin', 'sleep'],
  };
}

function pickMenotype(clusterMean, featureNames) {
  const map = buildDomainMap();
  const byName = new Map();
  for (let i = 0; i < featureNames.length; i++) byName.set(featureNames[i], clusterMean[i] || 0);

  const scored = Object.entries(map).map(([domain, names]) => ({
    domain,
    score: names.reduce((s, n) => s + (byName.get(n) || 0), 0),
  })).sort((a, b) => b.score - a.score);

  const primary = scored[0]?.domain || 'metabolic_other';
  const secondary = scored[1] && scored[1].score >= scored[0].score * 0.75 ? scored[1].domain : null;
  return { primary, secondary, scored };
}

function toTitle(s) {
  return String(s || '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

// V2-style fixed menotype names — matched to v2's 5 clinically validated clusters.
// Each archetype has a feature score: how well does a cluster's centroid match this category?
const V2_ARCHETYPES = [
  {
    key: 'pain',
    label: 'Inflammatory Pain Menopause',
    note:  'Pain and inflammation dominant; maps to v2 menotype 3',
    score: s => s('pain') * 3 + s('digestive') * 0.5,
  },
  {
    key: 'hormonal',
    label: 'Hormonal Transition Menopause',
    note:  'Mixed hormonal; hair/skin changes dominant; maps to v2 menotype 4',
    score: s => s('hair_skin') * 3 + s('irregular_periods') * 2 + s('libido') + s('vaginal_dryness'),
  },
  {
    key: 'vasomotor',
    label: 'Vasomotor Insomnia Menopause',
    note:  'Hot flashes and sleep disturbance dominant; maps to v2 menotype 2',
    score: s => s('hot_flashes') * 2.5 + s('temperature') * 2 + s('palpitations'),
  },
  {
    key: 'cognitive',
    label: 'Cognitive Fatigue Menopause',
    note:  'Brain fog and cognitive fatigue dominant; maps to v2 menotype 0',
    score: s => s('brain_fog') * 3 + s('memory_loss') * 3 + s('fatigue') * 0.5,
  },
  {
    key: 'anxiety',
    label: 'Anxiety-Dominant Menopause',
    note:  'Anxiety and mood dominant; maps to v2 menotype 1',
    score: s => s('anxiety') * 2 + s('depression') + s('mood_swings') * 0.5,
  },
];

// Ensures all clusters get a v2 archetype label.
// k <= 5: unique bipartite greedy assignment — each archetype used at most once.
//         (force-assigns by elimination so all 5 names appear)
// k > 5:  each cluster independently picks its best-scoring archetype.
//         Multiple clusters may share a name; API groups by primary_menotype to show 5 buckets.
function resolveV2Labels(clusterMetas) {
  const byName = ts => {
    const m = {};
    for (const s of (ts || [])) m[s.name] = s.score;
    return name => m[name] || 0;
  };
  const getScore = (meta, arch) => { const s = byName(meta.topSymptoms); return arch.score(s); };
  const K = clusterMetas.length;

  if (K <= V2_ARCHETYPES.length) {
    // Unique bipartite greedy assignment
    const pairs = [];
    for (let c = 0; c < K; c++)
      for (let a = 0; a < V2_ARCHETYPES.length; a++)
        pairs.push([getScore(clusterMetas[c], V2_ARCHETYPES[a]), c, a]);
    pairs.sort((x, y) => y[0] - x[0]);

    const usedC = new Set(), usedA = new Set();
    const assignment = new Array(K).fill(null);
    for (const [, c, a] of pairs) {
      if (usedC.has(c) || usedA.has(a)) continue;
      assignment[c] = V2_ARCHETYPES[a];
      usedC.add(c); usedA.add(a);
      if (usedC.size === K || usedA.size === V2_ARCHETYPES.length) break;
    }
    // Fallback for any remaining cluster (shouldn't happen with k=5)
    for (let c = 0; c < K; c++) {
      if (assignment[c]) continue;
      let best = V2_ARCHETYPES[0], bestScore = -Infinity;
      for (const arch of V2_ARCHETYPES) {
        const sc = getScore(clusterMetas[c], arch);
        if (sc > bestScore) { bestScore = sc; best = arch; }
      }
      assignment[c] = best;
    }
    for (let c = 0; c < K; c++) {
      clusterMetas[c].clusterLabel = assignment[c].label;
      clusterMetas[c].labelNotes  = assignment[c].note;
    }
  } else {
    // k > 5: independent best-fit per cluster (duplicates allowed)
    for (let c = 0; c < K; c++) {
      let best = V2_ARCHETYPES[0], bestScore = -Infinity;
      for (const arch of V2_ARCHETYPES) {
        const sc = getScore(clusterMetas[c], arch);
        if (sc > bestScore) { bestScore = sc; best = arch; }
      }
      clusterMetas[c].clusterLabel = best.label;
      clusterMetas[c].labelNotes   = best.note;
    }
  }
}

function makeClusterLabel(meta) {
  // v2 mode: resolveV2Labels() is called after all clusters are built — per-cluster
  // call here just returns a placeholder; the resolver overwrites it.
  if (LABEL_MODE === 'v2') {
    return { label: '__v2_pending__', note: '' };
  }
  const domain = meta.domainPrimary || 'mixed';
  const topA = meta.topSymptoms?.[0]?.name || 'mixed';
  const topB = meta.topSymptoms?.[1]?.name || null;
  const label = `${toTitle(domain)}: ${toTitle(topA)}${topB ? ` + ${toTitle(topB)}` : ''}`;
  const note = `Primary domain ${domain}; top symptoms derived from weighted centroid.`;
  return { label, note };
}

function normalizeRows(matrix) {
  return matrix.map(row => {
    const norm = Math.sqrt(row.reduce((s, v) => s + v * v, 0));
    if (!norm) return row.map(() => 0);
    return row.map(v => v / norm);
  });
}

async function fetchMatrix(client) {
  const featureSet = new Set(V2_STYLE_FEATURES);
  if (INCLUDE_OTHER) featureSet.add('other_symptom');
  const features = Array.from(featureSet);

  // Refresh materialized view so training always uses latest canonical_symptoms data.
  // Non-concurrent refresh is fine here (training-only path, not a live query).
  await client.query('REFRESH MATERIALIZED VIEW symptom_frequency_matrix');
  console.log('symptom_frequency_matrix refreshed');

  // Pull per-post symptom mention rates. Only posts that have at least one
  // of our training features are included.
  const res = await client.query(`
    SELECT sfm.source_post_id,
           sfm.total_extractions,
           sfm.symptom_rates
    FROM symptom_frequency_matrix sfm
    WHERE sfm.source_post_id IN (
      SELECT DISTINCT source_post_id
      FROM canonical_symptoms
      WHERE canonical_name = ANY($1)
    )
  `, [features]);

  if (!res.rows.length) {
    return { features, postIds: [], matrix: [], stats: new Map() };
  }

  const postIds = res.rows.map(r => r.source_post_id);

  // IDF: count posts where mention rate > 0 for each feature.
  const dfByFeature = new Map(features.map(f => [f, 0]));
  for (const row of res.rows) {
    for (const f of features) {
      if ((row.symptom_rates[f] ?? 0) > 0) {
        dfByFeature.set(f, dfByFeature.get(f) + 1);
      }
    }
  }

  const nPosts = postIds.length;
  const idfWeights = features.map(f => {
    if (WEIGHT_MODE !== 'idf') return 1;
    const df = dfByFeature.get(f) || 0;
    return Math.log((nPosts + 1) / (df + 1)) + 1;
  });

  // Build matrix: binary (0/1) or float mention rate (0.0–1.0), × IDF weight.
  // binary matches v2 exactly. float uses mention frequency for richer signal.
  const matrixRaw = res.rows.map(row => {
    return features.map((name, idx) => {
      const rate = parseFloat(row.symptom_rates[name] ?? 0);
      const val = FEATURE_MODE === 'binary' ? (rate > 0 ? 1 : 0) : rate;
      return val * idfWeights[idx];
    });
  });
  const matrix = normalizeRows(matrixRaw);

  const stats = new Map(res.rows.map(r => [r.source_post_id, {
    symptom_count: Object.keys(r.symptom_rates).length,
    extraction_count: parseInt(r.total_extractions, 10),
  }]));

  return { features, postIds, matrix, stats };
}

async function upsertClusterLabels(client, rows) {
  if (!rows.length) return;
  const values = rows.map((_, idx) => {
    const b = idx * 7;
    return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5}::jsonb,$${b + 6}::jsonb,$${b + 7})`;
  }).join(',');
  const params = rows.flatMap(r => [
    MODEL_NAME,
    r.cluster_id,
    r.cluster_label,
    r.label_notes,
    JSON.stringify(r.top_symptoms),
    JSON.stringify(r.domain_scores),
    r.cluster_size,
  ]);

  await client.query(
    `
    INSERT INTO menotype_cluster_labels
      (model_name, cluster_id, cluster_label, label_notes, top_symptoms, domain_scores, cluster_size)
    VALUES ${values}
    ON CONFLICT (model_name, cluster_id)
    DO UPDATE SET
      cluster_label = EXCLUDED.cluster_label,
      label_notes = EXCLUDED.label_notes,
      top_symptoms = EXCLUDED.top_symptoms,
      domain_scores = EXCLUDED.domain_scores,
      cluster_size = EXCLUDED.cluster_size,
      updated_at = NOW()
    `,
    params,
  );
}

async function upsertProfiles(client, rows) {
  const CHUNK = 250;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const vals = chunk.map((_, idx) => {
      const b = idx * 10;
      return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9}::jsonb,$${b + 10}::jsonb)`;
    }).join(',');

    const params = chunk.flatMap(r => [
      r.source_post_id,
      r.cluster_id,
      r.primary_menotype,
      r.secondary_menotype,
      r.confidence,
      r.symptom_count,
      r.extraction_count,
      MODEL_NAME,
      JSON.stringify(r.top_symptoms),
      JSON.stringify(r.domain_scores),
    ]);

    await client.query(`
      INSERT INTO menotype_ml_profiles
        (source_post_id, cluster_id, primary_menotype, secondary_menotype,
         confidence, symptom_count, extraction_count, model_name, top_symptoms, domain_scores)
      VALUES ${vals}
      ON CONFLICT (source_post_id, model_name)
      DO UPDATE SET
        cluster_id = EXCLUDED.cluster_id,
        primary_menotype = EXCLUDED.primary_menotype,
        secondary_menotype = EXCLUDED.secondary_menotype,
        confidence = EXCLUDED.confidence,
        symptom_count = EXCLUDED.symptom_count,
        extraction_count = EXCLUDED.extraction_count,
        top_symptoms = EXCLUDED.top_symptoms,
        domain_scores = EXCLUDED.domain_scores,
        updated_at = NOW()
    `, params);
  }
}

function clamp01(v) {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

async function main() {
  const client = await pool.connect();
  try {
    console.log(`Stage 4 menotype ML (v2 style) starting model=${MODEL_NAME}`);
    console.log(`label_mode=${LABEL_MODE}`);
    console.log(`weight_mode=${WEIGHT_MODE}`);
    console.log(`feature_mode=${FEATURE_MODE}`);

    if (RESET) {
      const del = await client.query(`DELETE FROM menotype_ml_profiles WHERE model_name = $1`, [MODEL_NAME]);
      console.log(`RESET deleted rows: ${del.rowCount}`);
    }

    const { features, postIds, matrix, stats } = await fetchMatrix(client);
    if (!matrix.length) {
      console.log('No matrix rows found from canonical_symptoms');
      return;
    }

    let finalK = K_OVERRIDE;
    let finalModel = null;
    let bestSil = Number.NEGATIVE_INFINITY;
    const sweep = [];

    const RESTARTS = 10; // k-means++ still benefits from multiple restarts to escape local optima
    const maxAllowedK = Math.min(K_MAX, Math.max(2, matrix.length - 1));
    if (!finalK) {
      for (let k = K_MIN; k <= maxAllowedK; k++) {
        let bestRun = null;
        for (let run = 0; run < RESTARTS; run++) {
          const km = runKMeans(matrix, k, SEED + run * 31);
          const sil = silhouetteScore(matrix, km.assignments, k);
          if (!bestRun || sil > bestRun.sil) bestRun = { ...km, sil };
        }
        sweep.push({ k, silhouette: Number(bestRun.sil.toFixed(4)), inertia: Number(bestRun.inertia.toFixed(2)) });
        if (bestRun.sil > bestSil) {
          bestSil = bestRun.sil;
          finalK = k;
          finalModel = bestRun;
        }
      }
    } else {
      // Even with fixed k, run multiple restarts and take the best.
      let bestRun = null;
      for (let run = 0; run < RESTARTS; run++) {
        const km = runKMeans(matrix, finalK, SEED + run * 31);
        const sil = silhouetteScore(matrix, km.assignments, finalK);
        if (!bestRun || sil > bestRun.sil) bestRun = { ...km, sil };
      }
      finalModel = bestRun;
      bestSil = bestRun.sil;
      sweep.push({ k: finalK, silhouette: Number(bestSil.toFixed(4)), inertia: Number(finalModel.inertia.toFixed(2)) });
    }

    if (!finalModel) {
      throw new Error('Unable to train k-means model');
    }

    const clusterCounts = new Array(finalK).fill(0);
    const clusterSums = Array.from({ length: finalK }, () => new Array(features.length).fill(0));
    for (let i = 0; i < matrix.length; i++) {
      const c = finalModel.assignments[i];
      clusterCounts[c]++;
      for (let j = 0; j < features.length; j++) clusterSums[c][j] += matrix[i][j];
    }

    const clusterMeans = clusterSums.map((arr, c) => {
      if (!clusterCounts[c]) return arr;
      return arr.map(v => v / clusterCounts[c]);
    });

    const clusterMeta = clusterMeans.map((mean, idx) => {
      const cls = pickMenotype(mean, features);
      const topSymptoms = features.map((name, i) => ({ name, score: Number(mean[i].toFixed(4)) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 8)
        .filter(x => x.score > 0);
      const clusterNaming = makeClusterLabel({
        domainPrimary: cls.primary,
        topSymptoms,
      });
      return {
        clusterId: idx,
        domainPrimary: cls.primary,
        domainSecondary: cls.secondary,
        domainScores: cls.scored,
        topSymptoms,
        clusterLabel: clusterNaming.label,
        labelNotes: clusterNaming.note,
      };
    });

    // Resolve v2 names: unique bipartite assignment across all clusters.
    if (LABEL_MODE === 'v2') resolveV2Labels(clusterMeta);

    const rows = [];
    for (let i = 0; i < postIds.length; i++) {
      const a = finalModel.assignments[i];
      const hit = nearest(matrix[i], finalModel.centroids);
      const confidence = hit.secondD2 === Number.POSITIVE_INFINITY
        ? 1
        : clamp01(1 - (Math.sqrt(hit.bestD2) / Math.max(Math.sqrt(hit.secondD2), 1e-9)));
      const st = stats.get(postIds[i]) || { symptom_count: 0, extraction_count: 0 };

      rows.push({
        source_post_id: postIds[i],
        cluster_id: a,
        primary_menotype: LABEL_MODE === 'domain' ? clusterMeta[a].domainPrimary
          : LABEL_MODE === 'v2' ? clusterMeta[a].clusterLabel
          : `cluster_${a}`,
        secondary_menotype: LABEL_MODE === 'domain' ? clusterMeta[a].domainSecondary : null,
        confidence: Number(confidence.toFixed(3)),
        symptom_count: st.symptom_count,
        extraction_count: st.extraction_count,
        top_symptoms: clusterMeta[a].topSymptoms,
        domain_scores: clusterMeta[a].domainScores,
      });
    }

    await upsertProfiles(client, rows);

    await upsertClusterLabels(client, clusterMeta.map((m, idx) => ({
      cluster_id: idx,
      cluster_label: m.clusterLabel,
      label_notes: m.labelNotes,
      top_symptoms: m.topSymptoms,
      domain_scores: m.domainScores,
      cluster_size: clusterCounts[idx],
    })));

    console.log('k sweep:', JSON.stringify(sweep));
    console.log(`selected_k=${finalK} silhouette=${bestSil.toFixed(4)} rows=${rows.length}`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(async (err) => {
  console.error('Fatal:', err.message);
  await pool.end().catch(() => {});
  process.exit(1);
});
