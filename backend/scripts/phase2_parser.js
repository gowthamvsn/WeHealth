/**
 * PHASE 2 EXTRACTION PARSER
 * 
 * Converts Phase 2 JSON (with explicit symptom_treatment_pairs) into both:
 * 1. Backward-compatible extract for reddit_extractions table
 * 2. Direct treatment_symptom_link inserts with link_source='explicit_llm'
 */

/**
 * parsePhase2Extraction(jsonData)
 * 
 * Input: Raw JSON from LLM (Phase 2 schema with symptom_treatment_pairs)
 * Output: {
 *   extract: {...},           // Normalized for reddit_extractions table
 *   explicit_links: [...]     // Array of links for treatment_symptom_link table
 * }
 */
function parsePhase2Extraction(jsonData) {
  if (!jsonData) {
    return { extract: null, explicit_links: [] };
  }

  // Ensure we have a valid object
  if (typeof jsonData === 'string') {
    try {
      jsonData = JSON.parse(jsonData);
    } catch (e) {
      console.error('Invalid JSON:', e);
      return { extract: null, explicit_links: [] };
    }
  }

  const extract = {
    // Basics
    current_age: jsonData.current_age || null,
    menopause_stage: jsonData.menopause_stage || 'unknown',
    menopause_onset_age: jsonData.menopause_onset_age || null,

    // Phase 1 backward compatibility
    symptoms: normalizeSymptoms(jsonData.symptoms),
    treatments: normalizeTreatments(jsonData.treatments),

    // Emotional context
    emotional_tone: jsonData.emotional_tone || 'neutral',
    seeking_advice: jsonData.seeking_advice || false,
    sharing_experience: jsonData.sharing_experience || false,
  };

  // Parse explicit pairs
  const explicit_links = parseExplicitPairs(jsonData.symptom_treatment_pairs || []);

  return {
    extract,
    explicit_links,
  };
}

/**
 * Normalize symptoms array to match expected schema
 */
function normalizeSymptoms(symptoms) {
  if (!Array.isArray(symptoms)) return [];

  return symptoms.map((s) => ({
    name: s.name || s.symptom || 'unknown',
    severity: s.severity || 'unknown',
    description: s.description || null,
    resolved: s.resolved !== undefined ? s.resolved : null,
  }));
}

/**
 * Normalize treatments array to match expected schema
 */
function normalizeTreatments(treatments) {
  if (!Array.isArray(treatments)) return [];

  return treatments.map((t) => ({
    name: t.name || 'unknown',
    type: t.type || 'other',
    description: t.description || null,
    effect: t.effect || 'unknown',
    duration: t.duration || null,
  }));
}

/**
 * Parse explicit symptom_treatment_pairs into linkage rows
 * 
 * Returns array of objects suitable for treatment_symptom_link table:
 * {
 *   symptom_canonical_name: string,
 *   treatment_canonical_name: string,
 *   link_source: 'explicit_llm',
 *   explicit_effect: 'positive|negative|neutral|unknown',
 *   co_mention_distance: null,
 *   co_paragraph: null,
 * }
 */
function parseExplicitPairs(pairs) {
  if (!Array.isArray(pairs)) return [];

  const links = [];

  pairs.forEach((pair) => {
    const symptom = pair.symptom || 'other_symptom';
    const treatmentsArray = pair.treatments_used || [];

    treatmentsArray.forEach((treatment) => {
      links.push({
        symptom_canonical_name: symptom,
        treatment_canonical_name: treatment.name || 'other_treatment',
        link_source: 'explicit_llm',
        explicit_effect: treatment.effect || 'unknown',
        co_mention_distance: null,
        co_paragraph: null,
        metadata: {
          frequency: treatment.frequency || null,
          duration: treatment.duration || null,
          notes: treatment.notes || null,
          started_date_relative: treatment.started_date_relative || null,
        },
      });
    });
  });

  return links;
}

/**
 * convertToCanonicalNames(extract, canonicalMappings)
 * 
 * Maps free-text symptom/treatment names to canonical names using alias tables
 * 
 * Input:
 *   extract: parsed extract object
 *   canonicalMappings: {
 *     symptoms: Map<freeText, canonicalName>,
 *     treatments: Map<freeText, canonicalName>
 *   }
 * 
 * Output: Normalized extract with canonical names
 */
function convertToCanonicalNames(extract, canonicalMappings) {
  if (!canonicalMappings) return extract;

  const normalized = { ...extract };

  // Normalize symptoms
  if (normalized.symptoms && canonicalMappings.symptoms) {
    normalized.symptoms = normalized.symptoms.map((s) => ({
      ...s,
      canonical_name:
        canonicalMappings.symptoms.get(s.name.toLowerCase()) ||
        canonicalMappings.symptoms.get(s.name) ||
        'other_symptom',
    }));
  }

  // Normalize treatments
  if (normalized.treatments && canonicalMappings.treatments) {
    normalized.treatments = normalized.treatments.map((t) => ({
      ...t,
      canonical_name:
        canonicalMappings.treatments.get(t.name.toLowerCase()) ||
        canonicalMappings.treatments.get(t.name) ||
        'other_treatment',
    }));
  }

  return normalized;
}

module.exports = {
  parsePhase2Extraction,
  normalizeSymptoms,
  normalizeTreatments,
  parseExplicitPairs,
  convertToCanonicalNames,
};