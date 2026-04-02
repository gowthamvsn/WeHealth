/**
 * PHASE 2: ENHANCED EXTRACTION PROMPT
 * 
 * Use this prompt for user-submitted entries (or re-extraction of Reddit data if desired).
 * Includes explicit treatment-symptom pairing for cleaner linkage data.
 * 
 * Key changes from Phase 1:
 * - symptom_treatment_pairs: Array of {symptom, treatments_used} objects
 * - Each treatment has effect rating: positive/negative/neutral/unknown
 * - Frequency/duration information for temporal analysis
 * - Enables link_source='explicit_llm' classification (vs heuristic)
 * 
 * Update Stage 2 extraction prompt to use this structure when enhancing the pipeline.
 */

const PHASE_2_EXTRACTION_PROMPT = `You are a health data extraction assistant. Analyze the following user submission about menopause symptoms and treatments.

Extract structured health information. Return only valid JSON (no markdown, no code block).

Return JSON following this exact schema:

{
  "current_age": <number or null if unknown>,
  "menopause_stage": "<premenopausal|perimenopausal|postmenopausal|unknown>",
  "menopause_onset_age": <number or null if unknown>,
  
  // PHASE 1 (backward compatible):
  "symptoms": [
    {
      "name": "<specific symptom mentioned>",
      "severity": "<mild|moderate|severe|unknown>",
      "description": "<user's description or onset details>",
      "resolved": <true|false|null>
    }
  ],
  
  "treatments": [
    {
      "name": "<specific treatment/medication/supplement mentioned>",
      "type": "<medication|supplement|lifestyle|procedure|other>",
      "description": "<how/when taken, dosage if mentioned>",
      "effect": "<positive|negative|neutral|unknown>",
      "duration": "<e.g. '2 weeks', '6 months', 'ongoing'>"
    }
  ],
  
  // PHASE 2 (NEW - EXPLICIT PAIRING):
  "symptom_treatment_pairs": [
    {
      "symptom": "<canonical name or free-text>",
      "symptom_severity": "<mild|moderate|severe>",
      "treatments_used": [
        {
          "name": "<treatment name>",
          "type": "<medication|supplement|lifestyle|procedure>",
          "effect": "<positive|negative|neutral|unknown>",
          "notes": "<any specific details about this treatment for THIS symptom>",
          "frequency": "<daily|weekly|as_needed|etc>",
          "duration": "<time period>",
          "started_date_relative": "<before|during|after symptom onset>"
        }
      ],
      "other_management": ["<lifestyle changes, self-care, non-pharmacological>"],
      "response_timeline": "<e.g. 'improved after 2 weeks', 'no improvement after 1 month'>"
    }
  ],
  
  "emotional_tone": "<neutral|positive|negative|desperate|hopeful>",
  "seeking_advice": <true|false>,
  "sharing_experience": <true|false>,
  "confidence": {
    "overall": "<high|medium|low>",
    "notes": "<e.g. 'user vague about dosages', 'clear about timeline'>"
  }
}

Rules:
1. Extract ALL symptoms and treatments mentioned, even if unclear.
2. For symptom_treatment_pairs: Link treatments ONLY to symptoms they were explicitly used for.
   - If relationship is obvious from context, include it.
   - If ambiguous (user mentions treatment without linking), use treatments[] instead.
3. Return NULL for any field you cannot determine from the text.
4. Use array for repeated symptoms/treatments (e.g., "tried HRT twice, stopped both times.")
5. For effect field: Use "positive" if user reports improvement, "negative" if worsening, "unknown" if unclear.
6. Preserve user's exact words for descriptions where possible (don't normalize).

Example input: "I'm 52, been in menopause 3 years. Hot flashes are brutal—50+ per day. Started HRT (estrogen patch) 2 months ago, much better now. But I also get terrible anxiety, even with the HRT. My therapist suggested yoga, which helps a little. I also take magnesium before bed and it seems to help my sleep."

Example output:
{
  "current_age": 52,
  "menopause_stage": "postmenopausal",
  "menopause_onset_age": 49,
  
  "symptoms": [
    {"name": "hot flashes", "severity": "severe", "description": "50+ per day", "resolved": false},
    {"name": "anxiety", "severity": "moderate", "description": "even with HRT", "resolved": false},
    {"name": "sleep", "severity": "moderate", "description": null, "resolved": false}
  ],
  
  "treatments": [
    {"name": "estrogen patch", "type": "medication", "description": "HRT, started 2 months ago", "effect": "positive", "duration": "2 months"},
    {"name": "yoga", "type": "lifestyle", "description": "suggested by therapist", "effect": "positive", "duration": "ongoing"},
    {"name": "magnesium", "type": "supplement", "description": "before bed", "effect": "positive", "duration": "ongoing"}
  ],
  
  "symptom_treatment_pairs": [
    {
      "symptom": "hot_flashes",
      "symptom_severity": "severe",
      "treatments_used": [
        {
          "name": "estrogen patch",
          "type": "medication",
          "effect": "positive",
          "notes": "approved and much better now",
          "frequency": "daily",
          "duration": "2 months",
          "started_date_relative": "before symptom mention"
        }
      ],
      "other_management": [],
      "response_timeline": "much better after 2 months"
    },
    {
      "symptom": "anxiety",
      "symptom_severity": "moderate",
      "treatments_used": [
        {
          "name": "yoga",
          "type": "lifestyle",
          "effect": "positive",
          "notes": "therapist suggested; helps a little",
          "frequency": "as_needed",
          "duration": "ongoing",
          "started_date_relative": "unknown"
        }
      ],
      "other_management": [],
      "response_timeline": "helps a little"
    },
    {
      "symptom": "sleep",
      "symptom_severity": "moderate",
      "treatments_used": [
        {
          "name": "magnesium",
          "type": "supplement",
          "effect": "positive",
          "notes": "seems to help sleep",
          "frequency": "daily",
          "duration": "ongoing",
          "started_date_relative": "before sleep mention"
        }
      ],
      "other_management": [],
      "response_timeline": "seems to help"
    }
  ],
  
  "emotional_tone": "hopeful",
  "seeking_advice": false,
  "sharing_experience": true,
  "confidence": {
    "overall": "high",
    "notes": "Clear, specific details about treatments and timelines"
  }
}

Now extract from this user submission:

${PLACEHOLDER_USER_TEXT}

Return only valid JSON, no additional text.`;

module.exports = {
  PHASE_2_EXTRACTION_PROMPT,
};