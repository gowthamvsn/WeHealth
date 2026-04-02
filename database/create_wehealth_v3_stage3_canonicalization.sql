-- WeHealth v3 Stage 3: Canonicalization
-- Explodes JSONB arrays from reddit_extractions into clean relational rows.
-- Uses the same canonical vocabulary as v2's symptom_matrix / treatment_dictionary
-- so Stage 4 menotype scoring can directly use these rows.
--
-- No OpenAI calls — pure SQL + Node normalizer (stage3_canonicalize.js)
--
-- Tables:
--   symptom_vocab       — master canonical symptom list (same 24 as v2 symptom_matrix)
--   treatment_vocab     — master canonical treatment list
--   symptom_aliases     — free-text -> canonical mapping (LLM output normalisation)
--   treatment_aliases   — free-text -> canonical mapping
--   raw_symptoms        — one row per raw symptom mention (before canonicalization)
--   raw_treatments      — one row per raw treatment mention (before canonicalization)
--   canonical_symptoms  — one row per (extraction, symptom mention)
--   canonical_treatments— one row per (extraction, treatment mention)

-- ─── Vocabulary: Symptoms ────────────────────────────────────────────────────
-- Exactly mirrors v2 symptom_matrix column names so menotype model reuses labels

CREATE TABLE IF NOT EXISTS symptom_vocab (
    symptom_id      SMALLSERIAL PRIMARY KEY,
    canonical_name  TEXT NOT NULL UNIQUE,   -- e.g. "hot_flashes", "brain_fog"
    display_name    TEXT NOT NULL           -- e.g. "Hot Flashes", "Brain Fog"
);

INSERT INTO symptom_vocab (canonical_name, display_name) VALUES
    ('hot_flashes',        'Hot Flashes / Hot Flushes'),
    ('sleep',              'Sleep Problems / Insomnia'),
    ('anxiety',            'Anxiety'),
    ('depression',         'Depression / Low Mood'),
    ('brain_fog',          'Brain Fog / Cognitive Issues'),
    ('mood_swings',        'Mood Swings / Irritability'),
    ('fatigue',            'Fatigue / Low Energy'),
    ('pain',               'Pain (joint, muscle, body)'),
    ('headaches',          'Headaches / Migraines'),
    ('palpitations',       'Heart Palpitations'),
    ('vaginal_dryness',    'Vaginal Dryness / Atrophy'),
    ('libido',             'Low Libido / Sex Drive Changes'),
    ('irregular_periods',  'Irregular Periods / Spotting'),
    ('weight_changes',     'Weight Changes / Bloating'),
    ('hair_skin',          'Hair Loss / Skin Changes'),
    ('digestive',          'Digestive Issues / Gut Problems'),
    ('urinary',            'Urinary Issues / UTIs'),
    ('breast_pain',        'Breast Tenderness / Pain'),
    ('dizziness',          'Dizziness / Vertigo'),
    ('tingling',           'Tingling / Numbness'),
    ('memory_loss',        'Memory Loss / Forgetfulness'),
    ('temperature',        'Temperature Sensitivity / Night Sweats'),
    ('suicidal',           'Suicidal Thoughts / Self-Harm Ideation'),
    ('other_symptom',      'Other / Unclassified Symptom')
ON CONFLICT (canonical_name) DO NOTHING;


-- ─── Vocabulary: Treatments ──────────────────────────────────────────────────
-- Derived from v2 treatment_dictionary + treatment_events corpus

CREATE TABLE IF NOT EXISTS treatment_vocab (
    treatment_id    SMALLSERIAL PRIMARY KEY,
    canonical_name  TEXT NOT NULL UNIQUE,
    display_name    TEXT NOT NULL,
    treatment_type  TEXT NOT NULL CHECK (treatment_type IN
                        ('medication', 'supplement', 'lifestyle', 'procedure', 'other'))
);

INSERT INTO treatment_vocab (canonical_name, display_name, treatment_type) VALUES
    -- Hormonal medications
    ('hrt',                     'HRT / Hormone Replacement Therapy',        'medication'),
    ('estrogen',                'Estrogen (standalone)',                     'medication'),
    ('progesterone',            'Progesterone / Progestogen',                'medication'),
    ('testosterone',            'Testosterone Therapy',                      'medication'),
    ('birth_control',           'Birth Control / OCP',                       'medication'),
    ('mirena_iud',              'Mirena IUD',                                'procedure'),
    -- Non-hormonal medications
    ('antidepressants',         'Antidepressants (SSRIs/SNRIs)',              'medication'),
    ('gabapentin',              'Gabapentin / Pregabalin',                   'medication'),
    ('clonidine',               'Clonidine',                                 'medication'),
    ('sleep_medication',        'Sleep Medication (prescription)',           'medication'),
    ('pain_medication',         'Pain Medication (OTC/Rx)',                  'medication'),
    -- Supplements
    ('magnesium',               'Magnesium',                                 'supplement'),
    ('vitamin_d',               'Vitamin D',                                 'supplement'),
    ('omega_3',                 'Omega-3 / Fish Oil',                        'supplement'),
    ('black_cohosh',            'Black Cohosh',                              'supplement'),
    ('evening_primrose',        'Evening Primrose Oil',                      'supplement'),
    ('ashwagandha',             'Ashwagandha / Adaptogens',                  'supplement'),
    ('melatonin',               'Melatonin',                                 'supplement'),
    ('probiotics',              'Probiotics / Gut Health',                   'supplement'),
    ('collagen',                'Collagen',                                  'supplement'),
    ('phytoestrogens',          'Phytoestrogens / Soy / Isoflavones',        'supplement'),
    ('multivitamin',            'Multivitamin / General Supplement',         'supplement'),
    -- Lifestyle
    ('exercise',                'Exercise / Movement',                       'lifestyle'),
    ('diet_change',             'Diet Change / Nutrition',                   'lifestyle'),
    ('alcohol_reduction',       'Alcohol Reduction',                         'lifestyle'),
    ('sleep_hygiene',           'Sleep Hygiene / Routine',                   'lifestyle'),
    ('stress_management',       'Stress Management / Mindfulness',           'lifestyle'),
    ('therapy_counselling',     'Therapy / Counselling',                     'lifestyle'),
    ('yoga_meditation',         'Yoga / Meditation',                         'lifestyle'),
    ('acupuncture',             'Acupuncture',                               'lifestyle'),
    -- Procedures
    ('hysterectomy',            'Hysterectomy',                              'procedure'),
    ('oophorectomy',            'Oophorectomy',                              'procedure'),
    -- Other
    ('other_treatment',         'Other / Unclassified Treatment',            'other')
ON CONFLICT (canonical_name) DO NOTHING;


-- ─── Alias tables (free-text -> canonical) ───────────────────────────────────
-- Normalizer script uses these for exact + fuzzy matching before fallback to "other"

CREATE TABLE IF NOT EXISTS symptom_aliases (
    alias           TEXT PRIMARY KEY,       -- lowercased free-text from LLM
    canonical_name  TEXT NOT NULL REFERENCES symptom_vocab(canonical_name)
);

CREATE TABLE IF NOT EXISTS treatment_aliases (
    alias           TEXT PRIMARY KEY,
    canonical_name  TEXT NOT NULL REFERENCES treatment_vocab(canonical_name)
);

-- Seed common aliases
INSERT INTO symptom_aliases (alias, canonical_name) VALUES
    ('hot flash',             'hot_flashes'),
    ('hot flashes',           'hot_flashes'),
    ('hot flushes',           'hot_flashes'),
    ('night sweats',          'temperature'),
    ('cold sweats',           'temperature'),
    ('temperature sensitivity','temperature'),
    ('insomnia',              'sleep'),
    ('sleep problems',        'sleep'),
    ('sleep disturbance',     'sleep'),
    ('poor sleep',            'sleep'),
    ('waking at night',       'sleep'),
    ('brain fog',             'brain_fog'),
    ('cognitive issues',      'brain_fog'),
    ('memory problems',       'memory_loss'),
    ('forgetfulness',         'memory_loss'),
    ('foggy thinking',        'brain_fog'),
    ('mood swings',           'mood_swings'),
    ('irritability',          'mood_swings'),
    ('anger',                 'mood_swings'),
    ('anxiety',               'anxiety'),
    ('panic attacks',         'anxiety'),
    ('nervousness',           'anxiety'),
    ('depression',            'depression'),
    ('low mood',              'depression'),
    ('sadness',               'depression'),
    ('fatigue',               'fatigue'),
    ('exhaustion',            'fatigue'),
    ('low energy',            'fatigue'),
    ('tiredness',             'fatigue'),
    ('joint pain',            'pain'),
    ('muscle pain',           'pain'),
    ('body pain',             'pain'),
    ('aching joints',         'pain'),
    ('headache',              'headaches'),
    ('migraines',             'headaches'),
    ('heart palpitations',    'palpitations'),
    ('racing heart',          'palpitations'),
    ('palpitations',          'palpitations'),
    ('vaginal dryness',       'vaginal_dryness'),
    ('vaginal atrophy',       'vaginal_dryness'),
    ('dryness',               'vaginal_dryness'),
    ('low libido',            'libido'),
    ('decreased libido',      'libido'),
    ('loss of sex drive',     'libido'),
    ('irregular periods',     'irregular_periods'),
    ('spotting',              'irregular_periods'),
    ('heavy periods',         'irregular_periods'),
    ('missed periods',        'irregular_periods'),
    ('weight gain',           'weight_changes'),
    ('bloating',              'weight_changes'),
    ('weight changes',        'weight_changes'),
    ('hair loss',             'hair_skin'),
    ('hair thinning',         'hair_skin'),
    ('dry skin',              'hair_skin'),
    ('acne',                  'hair_skin'),
    ('skin changes',          'hair_skin'),
    ('digestive issues',      'digestive'),
    ('bloat',                 'digestive'),
    ('constipation',          'digestive'),
    ('diarrhea',              'digestive'),
    ('gut issues',            'digestive'),
    ('urinary incontinence',  'urinary'),
    ('frequent urination',    'urinary'),
    ('uti',                   'urinary'),
    ('breast tenderness',     'breast_pain'),
    ('sore breasts',          'breast_pain'),
    ('dizziness',             'dizziness'),
    ('vertigo',               'dizziness'),
    ('tingling',              'tingling'),
    ('numbness',              'tingling'),
    ('pins and needles',      'tingling'),
    ('memory loss',           'memory_loss'),
    ('suicidal thoughts',     'suicidal'),
    ('self harm',             'suicidal'),
    ('suicidal ideation',     'suicidal'),
    -- Additional aliases from pilot analysis
    ('sleep issues',          'sleep'),
    ('sleep deprivation',     'sleep'),
    ('sleeplessness',         'sleep'),
    ('nightsweats',           'temperature'),
    ('back pain',             'pain'),
    ('pelvic pain',           'pain'),
    ('body aches',            'pain'),
    ('overall pain',          'pain'),
    ('chest pain',            'pain'),
    ('menstrual cramp pain',  'pain'),
    ('muscle loss',           'pain'),
    ('nausea',                'digestive'),
    ('loose stools',          'digestive'),
    ('bowel upset',           'digestive'),
    ('nervous stomach',       'digestive'),
    ('urinary urgency',       'urinary'),
    ('tender breasts',        'breast_pain'),
    ('rage',                  'mood_swings'),
    ('agitation',             'mood_swings'),
    ('doom and gloom',        'depression'),
    ('emotional distress',    'depression'),
    ('crying',                'depression'),
    ('emotional fragility',   'depression'),
    ('lack of interest',      'depression'),
    ('stress',                'anxiety'),
    ('fear',                  'anxiety'),
    ('intrusive thoughts',    'anxiety'),
    ('pmdd',                  'irregular_periods'),
    ('menstruation',          'irregular_periods'),
    ('cycle irregularities',  'irregular_periods'),
    ('shortened cycles',      'irregular_periods'),
    ('terrible bleeding',     'irregular_periods'),
    ('memory issues',         'memory_loss'),
    ('crazy feelings',        'brain_fog'),
    ('brain fog',             'brain_fog'),
    ('hormonal issues',       'brain_fog'),
    ('aging face',            'hair_skin'),
    ('nightmares',            'sleep'),
    ('crazy dreams',          'sleep'),
    -- High-frequency other_symptom values that should be named canonicals
    -- irregular_periods
    ('heavy bleeding',        'irregular_periods'),
    ('irregular cycles',      'irregular_periods'),
    ('painful periods',       'irregular_periods'),
    ('period changes',        'irregular_periods'),
    ('period irregularities', 'irregular_periods'),
    ('late period',           'irregular_periods'),
    ('bleeding',              'irregular_periods'),
    ('flooding',              'irregular_periods'),
    ('erratic periods',       'irregular_periods'),
    -- mood_swings
    ('mood issues',           'mood_swings'),
    ('moodiness',             'mood_swings'),
    ('mood changes',          'mood_swings'),
    ('emotional instability', 'mood_swings'),
    ('emotional changes',     'mood_swings'),
    ('emotional dysregulation','mood_swings'),
    ('mood fluctuations',     'mood_swings'),
    ('mood problems',         'mood_swings'),
    ('emotionality',          'mood_swings'),
    -- temperature / hot_flashes
    ('sweating',              'temperature'),
    ('cold flashes',          'hot_flashes'),
    ('cold sweats',           'temperature'),
    ('flushing',              'hot_flashes'),
    ('overheating',           'temperature'),
    ('heat intolerance',      'temperature'),
    ('night sweating',        'temperature'),
    -- fatigue
    ('lack of motivation',    'fatigue'),
    ('lethargy',              'fatigue'),
    ('constant tiredness',    'fatigue'),
    ('always tired',          'fatigue'),
    ('burnout',               'fatigue'),
    ('weakness',              'fatigue'),
    -- libido
    ('low sex drive',         'libido'),
    ('sex drive changes',     'libido'),
    ('no sex drive',          'libido'),
    ('reduced libido',        'libido'),
    ('sexual dysfunction',    'libido'),
    -- pain
    ('cramping',              'pain'),
    ('cramps',                'pain'),
    ('nerve pain',            'tingling'),
    ('joint aches',           'pain'),
    ('hip pain',              'pain'),
    ('knee pain',             'pain'),
    ('shoulder pain',         'pain'),
    ('fibromyalgia',          'pain'),
    ('muscle aches',          'pain'),
    ('body ache',             'pain'),
    -- anxiety
    ('ocd',                   'anxiety'),
    ('phone anxiety',         'anxiety'),
    ('health anxiety',        'anxiety'),
    ('social anxiety',        'anxiety'),
    ('worry',                 'anxiety'),
    ('anxious',               'anxiety'),
    -- depression / mood
    ('hopelessness',          'depression'),
    ('despair',               'depression'),
    ('anhedonia',             'depression'),
    ('low self esteem',       'depression'),
    ('grief',                 'depression'),
    -- brain_fog / cognitive
    ('adhd',                  'brain_fog'),
    ('concentration issues',  'brain_fog'),
    ('focus problems',        'brain_fog'),
    ('word finding',          'brain_fog'),
    ('confusion',             'brain_fog'),
    ('mental fog',            'brain_fog'),
    -- sleep
    ('waking up',             'sleep'),
    ('disrupted sleep',       'sleep'),
    ('trouble sleeping',      'sleep'),
    ('early waking',          'sleep'),
    ('sleep maintenance',     'sleep'),
    -- urinary
    ('urinary leakage',       'urinary'),
    ('bladder issues',        'urinary'),
    ('overactive bladder',    'urinary'),
    ('incontinence',          'urinary'),
    -- weight / digestive
    ('weight loss',           'weight_changes'),
    ('appetite changes',      'weight_changes'),
    ('metabolism changes',    'weight_changes'),
    ('vomiting',              'digestive'),
    ('acid reflux',           'digestive'),
    ('ibs',                   'digestive'),
    -- skin / hair
    ('itching',               'hair_skin'),
    ('itchiness',             'hair_skin'),
    ('hives',                 'hair_skin'),
    ('itchy skin',            'hair_skin'),
    ('rash',                  'hair_skin'),
    ('dry hair',              'hair_skin'),
    -- palpitations
    ('racing heart',          'palpitations'),
    ('heart racing',          'palpitations'),
    ('heart flutters',        'palpitations'),
    -- tingling
    ('tinnitus',              'tingling'),
    ('ringing ears',          'tingling'),
    ('electric shocks',       'tingling'),
    ('electric shock feeling','tingling'),
    ('pins needles',          'tingling'),
    -- suicidal
    ('suicidal',              'suicidal'),
    ('dark thoughts',         'suicidal'),
    ('self harm thoughts',    'suicidal'),
    -- Second-pass residuals (still falling to other_symptom after first expansion)
    ('mental health issues',  'anxiety'),
    ('pms',                   'irregular_periods'),
    ('pms symptoms',          'irregular_periods'),
    ('peri symptoms',         'other_symptom'),
    ('menopause symptoms',    'other_symptom'),
    ('chronic pain',          'pain'),
    ('itchy ears',            'tingling'),
    ('anemia',                'fatigue'),
    ('restless legs',         'tingling'),
    ('frozen shoulder',       'pain'),
    ('osteoporosis',          'pain'),
    ('agoraphobia',           'anxiety'),
    ('grogginess',            'brain_fog'),
    ('painful sex',           'vaginal_dryness'),
    ('dry eyes',              'hair_skin'),
    ('chills',                'temperature'),
    ('irritation',            'mood_swings'),
    ('heat flares',           'hot_flashes'),
    ('disorganization',       'brain_fog'),
    ('weight issues',         'weight_changes'),
    ('low blood pressure',    'dizziness'),
    ('body aches',            'pain'),
    ('severe symptoms',       'other_symptom'),
    ('worsening symptoms',    'other_symptom'),
    ('various symptoms',      'other_symptom')
ON CONFLICT (alias) DO NOTHING;

INSERT INTO treatment_aliases (alias, canonical_name) VALUES
    ('hrt',                       'hrt'),
    ('hormone replacement therapy','hrt'),
    ('hormone therapy',           'hrt'),
    ('ht',                        'hrt'),
    ('mht',                       'hrt'),
    ('menopausal hormone therapy','hrt'),
    ('estrogen',                  'estrogen'),
    ('oestrogen',                 'estrogen'),
    ('estradiol',                 'estrogen'),
    ('estrace',                   'estrogen'),
    ('climara',                   'estrogen'),
    ('vivelle',                   'estrogen'),
    ('progesterone',              'progesterone'),
    ('progestin',                 'progesterone'),
    ('prometrium',                'progesterone'),
    ('testosterone',              'testosterone'),
    ('androgen',                  'testosterone'),
    ('birth control',             'birth_control'),
    ('oral contraceptive',        'birth_control'),
    ('the pill',                  'birth_control'),
    ('mirena',                    'mirena_iud'),
    ('mirena iud',                'mirena_iud'),
    ('iud',                       'mirena_iud'),
    ('antidepressant',            'antidepressants'),
    ('ssri',                      'antidepressants'),
    ('snri',                      'antidepressants'),
    ('lexapro',                   'antidepressants'),
    ('zoloft',                    'antidepressants'),
    ('prozac',                    'antidepressants'),
    ('effexor',                   'antidepressants'),
    ('venlafaxine',               'antidepressants'),
    ('sertraline',                'antidepressants'),
    ('gabapentin',                'gabapentin'),
    ('pregabalin',                'gabapentin'),
    ('clonidine',                 'clonidine'),
    ('sleep medication',          'sleep_medication'),
    ('ambien',                    'sleep_medication'),
    ('melatonin',                 'melatonin'),
    ('magnesium',                 'magnesium'),
    ('magnesium glycinate',       'magnesium'),
    ('vitamin d',                 'vitamin_d'),
    ('vitamin d3',                'vitamin_d'),
    ('omega 3',                   'omega_3'),
    ('fish oil',                  'omega_3'),
    ('black cohosh',              'black_cohosh'),
    ('evening primrose',          'evening_primrose'),
    ('evening primrose oil',      'evening_primrose'),
    ('ashwagandha',               'ashwagandha'),
    ('probiotics',                'probiotics'),
    ('probiotic',                 'probiotics'),
    ('collagen',                  'collagen'),
    ('soy',                       'phytoestrogens'),
    ('isoflavones',               'phytoestrogens'),
    ('phytoestrogens',            'phytoestrogens'),
    ('exercise',                  'exercise'),
    ('walking',                   'exercise'),
    ('running',                   'exercise'),
    ('strength training',         'exercise'),
    ('weightlifting',             'exercise'),
    ('diet',                      'diet_change'),
    ('diet change',               'diet_change'),
    ('low carb',                  'diet_change'),
    ('mediterranean diet',        'diet_change'),
    ('alcohol reduction',         'alcohol_reduction'),
    ('cutting alcohol',           'alcohol_reduction'),
    ('sleep hygiene',             'sleep_hygiene'),
    ('sleep routine',             'sleep_hygiene'),
    ('mindfulness',               'stress_management'),
    ('meditation',                'yoga_meditation'),
    ('yoga',                      'yoga_meditation'),
    ('acupuncture',               'acupuncture'),
    ('therapy',                   'therapy_counselling'),
    ('counselling',               'therapy_counselling'),
    ('cbt',                       'therapy_counselling'),
    ('cognitive behavioral therapy','therapy_counselling'),
    ('hysterectomy',              'hysterectomy'),
    ('oophorectomy',              'oophorectomy'),
    -- Additional aliases from pilot analysis
    ('hormones',                  'hrt'),
    ('bioidentical hormones',     'hrt'),
    ('bioidentical hrt',          'hrt'),
    ('combipatch',                'hrt'),
    ('evorel',                    'hrt'),
    ('evorel sequi',              'hrt'),
    ('wellbutrin',                'antidepressants'),
    ('bupropion',                 'antidepressants'),
    ('celexa',                    'antidepressants'),
    ('citalopram',                'antidepressants'),
    ('paxil',                     'antidepressants'),
    ('paroxetine',                'antidepressants'),
    ('trazodone',                 'sleep_medication'),
    ('dayvigo',                   'sleep_medication'),
    ('anxiety medication',        'antidepressants'),
    ('lorazepam',                 'sleep_medication'),
    ('valium',                    'sleep_medication'),
    ('alprazolam',                'sleep_medication'),
    ('diazepam',                  'sleep_medication'),
    ('beta blockers',             'clonidine'),
    ('propranolol',               'clonidine'),
    ('iron supplements',         'multivitamin'),
    ('iron',                      'multivitamin'),
    ('cannabis',                  'other_treatment'),
    ('sativa',                    'other_treatment'),
    ('bc',                        'birth_control'),
    ('levothyroxine',             'other_treatment'),
    ('levothiroxine',             'other_treatment'),
    ('telehealth',                'therapy_counselling'),
    ('telehealth psychologist',   'therapy_counselling')
ON CONFLICT (alias) DO NOTHING;


-- ─── Canonical fact rows ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS raw_symptoms (
    id              BIGSERIAL   PRIMARY KEY,
    extraction_id   UUID        NOT NULL REFERENCES reddit_extractions(extraction_id),
    source_post_id  TEXT        NOT NULL,
    source_type     TEXT        NOT NULL,
    comment_order   INTEGER     NOT NULL,
    mention_index   INTEGER     NOT NULL,
    raw_name        TEXT,
    severity        TEXT,
    onset_description TEXT,
    resolved        BOOLEAN,
    raw_payload     JSONB       NOT NULL DEFAULT '{}'::jsonb,
    model_name      TEXT        NOT NULL,
    prompt_version  TEXT        NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (extraction_id, mention_index)
);

CREATE TABLE IF NOT EXISTS raw_treatments (
    id              BIGSERIAL   PRIMARY KEY,
    extraction_id   UUID        NOT NULL REFERENCES reddit_extractions(extraction_id),
    source_post_id  TEXT        NOT NULL,
    source_type     TEXT        NOT NULL,
    comment_order   INTEGER     NOT NULL,
    mention_index   INTEGER     NOT NULL,
    raw_name        TEXT,
    treatment_type  TEXT,
    reported_effect TEXT,
    side_effects    TEXT[],
    duration_description TEXT,
    raw_payload     JSONB       NOT NULL DEFAULT '{}'::jsonb,
    model_name      TEXT        NOT NULL,
    prompt_version  TEXT        NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (extraction_id, mention_index)
);

CREATE TABLE IF NOT EXISTS stage3_llm_remap_audit (
        id               BIGSERIAL   PRIMARY KEY,
        entity_type      TEXT        NOT NULL CHECK (entity_type IN ('symptom', 'treatment')),
        row_id           BIGINT      NOT NULL,
        extraction_id    UUID        NOT NULL REFERENCES reddit_extractions(extraction_id),
        raw_name         TEXT,
        old_canonical    TEXT        NOT NULL,
        new_canonical    TEXT        NOT NULL,
        llm_model        TEXT        NOT NULL,
        llm_confidence   NUMERIC(4,3),
        model_name       TEXT        NOT NULL,
        prompt_version   TEXT        NOT NULL,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stage3_llm_remap_audit_lookup
    ON stage3_llm_remap_audit(model_name, prompt_version, entity_type, created_at DESC);

CREATE TABLE IF NOT EXISTS canonical_symptoms (
    id              BIGSERIAL   PRIMARY KEY,
    extraction_id   UUID        NOT NULL REFERENCES reddit_extractions(extraction_id),
    source_post_id  TEXT        NOT NULL,
    source_type     TEXT        NOT NULL,   -- 'post' | 'comment'
    comment_order   INTEGER     NOT NULL,   -- -1 for posts
    canonical_name  TEXT        NOT NULL REFERENCES symptom_vocab(canonical_name),
    raw_name        TEXT,                   -- original LLM output before normalisation
    severity        TEXT        CHECK (severity IN ('mild','moderate','severe',null)),
    onset_description TEXT,
    resolved        BOOLEAN,
    model_name      TEXT        NOT NULL,
    prompt_version  TEXT        NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (extraction_id, canonical_name)  -- one row per symptom per document
);

CREATE TABLE IF NOT EXISTS canonical_treatments (
    id              BIGSERIAL   PRIMARY KEY,
    extraction_id   UUID        NOT NULL REFERENCES reddit_extractions(extraction_id),
    source_post_id  TEXT        NOT NULL,
    source_type     TEXT        NOT NULL,
    comment_order   INTEGER     NOT NULL,
    canonical_name  TEXT        NOT NULL REFERENCES treatment_vocab(canonical_name),
    raw_name        TEXT,
    treatment_type  TEXT,
    reported_effect TEXT        CHECK (reported_effect IN
                        ('positive','negative','neutral','mixed',null)),
    side_effects    TEXT[],
    duration_description TEXT,
    model_name      TEXT        NOT NULL,
    prompt_version  TEXT        NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (extraction_id, canonical_name)
);
