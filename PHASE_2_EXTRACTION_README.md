# Phase 2 Extraction System

## Overview

Phase 2 enhances the data extraction pipeline to capture **explicit treatment-symptom linkage**. Instead of inference-based all-to-all pairing (heuristic), we ask the LLM to explicitly map which treatments are used for which symptoms.

## New Files

### 1. `prompts_phase2_extraction.js`
Contains the revised LLM system prompt with explicit `symptom_treatment_pairs` field.

**Key additions:**
- `symptom_treatment_pairs`: Array of symptoms, each with an array of treatments specifically used for it
- `effect`: For each treatment, what effect did the user report? (positive/negative/neutral/unknown)
- `frequency`, `duration`, `notes`: Temporal and usage context
- Backward-compatible: Still includes Phase 1 `symptoms[]` and `treatments[]` for fallback

**Usage:**
```javascript
const { PHASE_2_EXTRACTION_PROMPT } = require('./prompts_phase2_extraction');

// Inject user text into placeholder
const userPrompt = PHASE_2_EXTRACTION_PROMPT.replace(
  '${PLACEHOLDER_USER_TEXT}',
  userSubmission
);

// Call Azure OpenAI with userPrompt
const response = await client.createChatCompletion({ messages: [{ content: userPrompt }] });
```

### 2. `phase2_parser.js`
Parses the new JSON structure into two outputs:

**Functions:**
- `parsePhase2Extraction(jsonData)` → Returns `{ extract, explicit_links }`
  - `extract`: Normalized for `reddit_extractions` table (Phase 1 compatible)
  - `explicit_links`: Array of link objects for `treatment_symptom_link` table

- `parseExplicitPairs(pairs)` → Extracts treatment-symptom links
  - Returns links marked with `link_source='explicit_llm'` (vs 'heuristic_all_to_all')
  - Preserves effect, frequency, duration, and notes

- `convertToCanonicalNames(extract, canonicalMappings)` → Maps free-text to canonical
  - Uses alias lookup tables to normalize names
  - Fallback: unmapped names become 'other_symptom'/'other_treatment'

**Usage:**
```javascript
const { parsePhase2Extraction } = require('./phase2_parser');

const llmResponse = await openaiClient.createChatCompletion({ ...userPrompt });
const parsedJson = JSON.parse(llmResponse.content);

const { extract, explicit_links } = parsePhase2Extraction(parsedJson);

// Insert extract into reddit_extractions (or user_extractions for Phase 3)
await client.query('INSERT INTO reddit_extractions (...) VALUES (...)', [...]);

// Insert explicit_links into treatment_symptom_link
for (const link of explicit_links) {
  await client.query(
    `INSERT INTO treatment_symptom_link 
     (extraction_id, symptom_canonical_name, treatment_canonical_name, link_source, explicit_effect, ...)
     VALUES ($1, $2, $3, 'explicit_llm', $4, ...)`,
    [extractionId, link.symptom_canonical_name, link.treatment_canonical_name, link.explicit_effect]
  );
}
```

### 3. Updated Auto-Watcher
`auto_start_stage3_when_stage2_done.js` now runs the full chain:

**Stage 2 completes** (status='success') → **[auto-trigger]** → **Stage 3 canonicalization**

**Stage 3 completes** → **[auto-trigger]** → **Stage 4 treatment-symptom linking**

**Stage 4 completes** → **[exit]**

The watcher stays running and polled every 60 seconds until all three stages complete successfully.

## Data Quality Improvements

### Phase 1 (Current - Heuristic)
- All treatments linked to all symptoms from same extraction
- **Benefit**: Quick, works immediately
- **Cost**: ~6.8% false positives (all-to-all overattribution)
- `link_source = 'heuristic_all_to_all'`

### Phase 2 (New - Explicit)
- Each treatment linked only to symptoms LLM parsed as relevant
- **Benefit**: Clean, high-confidence linkage
- **Cost**: Requires LLM extraction with explicit pairing
- `link_source = 'explicit_llm'`
- Stored alongside heuristic links; can query either or both

### Phase 3 (Future - Hybrid)
- As user data grows with explicit links, gradually phase out heuristic inference
- Queries can filter: `link_source IN ('explicit_llm', 'user_marked')`
- Aggregate stats become increasingly trustworthy

## Integration Timeline

### Immediate (Reddit Data)
- Heuristic links already active (Stage 4 complete)
- Enables baseline cohort analysis
- **Do NOT re-extract** Reddit data with Phase 2 prompt (time-wasteful; heuristic sufficient)

### Phase 3 Prep (User Entry System)
- Implement user check-in table + submission API (U1)
- Use Phase 2 prompt for all new extractions (U2)
- Stage 3 canonicalization on user entries (U3)
- Stage 4 explicit link population (same script, now with `link_source='explicit_llm'`)
- Insights engine uses both heuristic + explicit links (U4)

## Example: Comparing Link Sources

```sql
-- Heuristic: all treatments for anxiety
SELECT treatment_canonical_name, COUNT(*) as count
FROM treatment_symptom_link
WHERE symptom_canonical_name = 'anxiety'
  AND link_source = 'heuristic_all_to_all'
GROUP BY treatment_canonical_name
ORDER BY count DESC
LIMIT 10;

-- Explicit: only treatments explicitly used for anxiety (user data)
SELECT treatment_canonical_name, COUNT(*) as count
FROM treatment_symptom_link
WHERE symptom_canonical_name = 'anxiety'
  AND link_source = 'explicit_llm'
GROUP BY treatment_canonical_name
ORDER BY count DESC
LIMIT 10;

-- Comparison: heuristic vs explicit for specific pair
SELECT
  'heuristic' as source, COUNT(*) as count
FROM treatment_symptom_link
WHERE symptom_canonical_name = 'anxiety'
  AND treatment_canonical_name = 'hrt'
  AND link_source = 'heuristic_all_to_all'
UNION ALL
SELECT
  'explicit' as source, COUNT(*) as count
FROM treatment_symptom_link
WHERE symptom_canonical_name = 'anxiety'
  AND treatment_canonical_name = 'hrt'
  AND link_source = 'explicit_llm';
```

## Next Steps

1. **Deploy U1 (user check-ins)** → Capture free-text submissions
2. **Deploy U2 extraction** → Use PHASE_2_EXTRACTION_PROMPT
3. **Add parser integration** → Use phase2_parser to convert + link
4. **Monitor linkage quality** → Compare heuristic vs explicit coverage
5. **Gradually shift analytics** to explicit-only queries as user data accumulates
