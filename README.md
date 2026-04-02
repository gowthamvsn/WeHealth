# WE Health

WE Health is a women-focused health tracking, community, and analytics platform. It has two distinct layers:

1. A user-facing app for registration, login, check-ins, community posts, comments, likes, and cohort-style "Women Like Me" insights.
2. A Reddit analytics pipeline that ingests discussion data, extracts structured menopause facts, canonicalizes symptoms and treatments, and assigns fixed menotype categories.

This README is the project manual for the current repository state. It explains the full flow and the significance of every file currently present in the repo.

## Product Flow

### App flow

1. A user registers with email, username, and password.
2. The backend creates the user and issues a registration OTP.
3. The user verifies the OTP and can then log in.
4. After login, the frontend stores a JWT and uses it for protected API calls.
5. The user can submit daily check-ins with symptoms, mood, energy, sleep, body changes, emotions, and notes.
6. The backend normalizes user symptoms and returns cohort-style insights using menotype and canonical symptom/treatment data.
7. The user can create community posts, comment on posts, and like or unlike posts.

### Analytics pipeline flow

1. Stage 1 ingests Reddit posts and comments into raw tables.
2. Stage 2 uses Azure OpenAI to extract structured JSON from posts and comments.
3. Stage 3 canonicalizes raw symptom and treatment mentions into controlled vocabularies.
4. Stage 3 optional remap uses an LLM to reduce `other_symptom` and `other_treatment` noise.
5. Stage 4 assigns each extraction to one of 5 predefined menotypes.
6. The app uses those outputs to power the "Women Like Me" experience.

## Menotype Method

The currently active menotype path is LLM classification, not random assignment.

- [backend/scripts/stage4_llm_categorize_menotypes.js](backend/scripts/stage4_llm_categorize_menotypes.js): assigns one of 5 fixed menotypes to each extraction using Azure OpenAI.
- [backend/utils/menotype_categorizer.js](backend/utils/menotype_categorizer.js): classifies live user symptom input into the same 5 categories, with heuristic fallback if the LLM fails.
- [backend/scripts/stage4_build_menotype_ml.js](backend/scripts/stage4_build_menotype_ml.js): alternate ML clustering path using k-means style clustering over symptom vectors. This exists as an alternate analysis path, but the user-facing v3 flow is based on LLM categorization into predefined classes.

## Tech Stack

- Frontend: HTML, CSS, vanilla JavaScript
- Backend: Node.js, Express
- Database: PostgreSQL
- Auth: JWT + OTP
- Email: Nodemailer
- AI: Azure OpenAI
- Data pipeline: custom Node scripts over PostgreSQL tables

## Local Setup

### Prerequisites

- Node.js 18+
- npm 9+
- PostgreSQL 13+

### Environment

Create or update `backend/.env` with values like these:

```env
DB_HOST=localhost
DB_PORT=5432
DB_USER=your_postgres_user
DB_PASSWORD=your_postgres_password
DB_NAME=wehealth_v3
DB_SSL=false

JWT_SECRET=replace_with_a_long_random_secret
NODE_ENV=development

EMAIL_USER=your_email@gmail.com
EMAIL_PASS=your_email_app_password

AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com
AZURE_OPENAI_KEY=your-key
AZURE_OPENAI_DEPLOYMENT=we-gpt-4.1
AZURE_OPENAI_API_VERSION=2024-10-21
```

Notes:

- If email credentials are missing, OTP flows still work in development because OTP values are returned or logged for testing.
- Azure PostgreSQL usually requires `DB_SSL=true`.

### Database bootstrap

Run the app-core schema first:

```bash
psql -d wehealth_v3 -f ./database/create_wehealth_v3_app_core.sql
```

Then run the pipeline schemas when you want the Reddit analytics pipeline:

```bash
psql -d wehealth_v3 -f ./database/create_wehealth_v3_stage1_ingestion.sql
psql -d wehealth_v3 -f ./database/create_wehealth_v3_stage2_extraction.sql
psql -d wehealth_v3 -f ./database/create_wehealth_v3_stage3_canonicalization.sql
psql -d wehealth_v3 -f ./database/create_wehealth_v3_stage4_linking.sql
```

### Run the app

```bash
npm --prefix backend install
npm --prefix backend start
```

The local app is served at `http://localhost:3000`.

## Core Runtime Architecture

### HTTP server

- [backend/server.js](backend/server.js): Express entry point. Serves static frontend files, mounts auth and protected routes, and logs the active database.

### Database connection

- [backend/db.js](backend/db.js): shared PostgreSQL connection pool. Reads `.env`, auto-enables SSL for Azure PostgreSQL if needed.

### Auth middleware

- [backend/middleware/auth.js](backend/middleware/auth.js): verifies JWT bearer tokens and attaches decoded user info to requests.

### Utility modules

- [backend/utils/sendEmail.js](backend/utils/sendEmail.js): small Nodemailer wrapper used by OTP and password reset flows.
- [backend/utils/menotype_categorizer.js](backend/utils/menotype_categorizer.js): live user menotype classifier for the app. Uses Azure OpenAI first and falls back to heuristic scoring.

## API Surface

### Auth routes

- [backend/routes/auth.js](backend/routes/auth.js): registration, login, OTP verification, forgot password, and reset password. Uses the v3 `otp_codes` table with `purpose` values such as `registration`, `login`, and `password_reset`.

### Check-in routes

- [backend/routes/checkins.js](backend/routes/checkins.js): create and fetch user daily check-ins. Also normalizes raw user symptoms through legacy symptom mapping tables when available.

### Community routes

- [backend/routes/community.js](backend/routes/community.js): list posts, create posts, toggle likes, fetch comments, and create comments.

### Menotype routes

- [backend/routes/menotype.js](backend/routes/menotype.js): legacy route that queries old clustered symptom tables. It is still present but is not the main v3 insight path.

### Symptom and insight routes

- [backend/routes/symptoms.js](backend/routes/symptoms.js): powers the "Women Like Me" experience. It normalizes symptoms, categorizes the user into a menotype, pulls similar cohort data, and returns top symptoms, top treatments, helpful treatments, less-helpful treatments, and recent community posts.

## Frontend

- [backend/public/index.html](backend/public/index.html): the full single-page UI. Contains the landing page, auth forms, tracker view, and community view styling/layout.
- [backend/public/script.js](backend/public/script.js): frontend controller. Handles auth, token storage, check-ins, insight loading, community feed rendering, likes, comments, and UI tab switching.

## Package Configuration

- [backend/package.json](backend/package.json): Node package manifest, runtime dependencies, and stage command aliases.
- [backend/package-lock.json](backend/package-lock.json): npm dependency lockfile for reproducible installs.

## Database Files

- [database/create_frontend_v1_tables.sql](database/create_frontend_v1_tables.sql): older frontend-oriented schema for check-ins, community posts, comments, and likes.
- [database/create_password_reset_table.sql](database/create_password_reset_table.sql): older migration adding reset-token columns directly onto `users`.
- [database/create_wehealth_v3_app_core.sql](database/create_wehealth_v3_app_core.sql): current compact v3 app schema for `users`, `otp_codes`, `user_checkins`, `community_posts`, `post_comments`, and `post_likes`.
- [database/create_wehealth_v3_stage1_ingestion.sql](database/create_wehealth_v3_stage1_ingestion.sql): Stage 1 schema for pipeline runs and raw Reddit post/comment ingestion.
- [database/create_wehealth_v3_stage2_extraction.sql](database/create_wehealth_v3_stage2_extraction.sql): Stage 2 extraction table for OpenAI-produced structured JSON.
- [database/create_wehealth_v3_stage3_canonicalization.sql](database/create_wehealth_v3_stage3_canonicalization.sql): Stage 3 vocabularies, aliases, raw mention tables, canonical tables, and remap audit table.
- [database/create_wehealth_v3_stage4_linking.sql](database/create_wehealth_v3_stage4_linking.sql): Stage 4 materialized view, treatment effectiveness view, menotype profile tables, and menotype-treatment analytics views.
- [database/wehealth_v3_stage1_validation.md](database/wehealth_v3_stage1_validation.md): acceptance checklist for validating ingestion correctness.
- [database/wehealth_v3_stage2_validation.md](database/wehealth_v3_stage2_validation.md): acceptance checklist for validating extraction quality and idempotency.

## Pipeline Scripts

### Primary stage runners

- [backend/scripts/stage1_ingest_reddit.js](backend/scripts/stage1_ingest_reddit.js): ingests CSV Reddit datasets into Stage 1 raw tables and records pipeline runs.
- [backend/scripts/stage2_extract_reddit.js](backend/scripts/stage2_extract_reddit.js): calls Azure OpenAI on raw posts/comments and stores structured extraction JSON.
- [backend/scripts/stage3_canonicalize.js](backend/scripts/stage3_canonicalize.js): expands extraction JSON into raw and canonical symptom/treatment rows.
- [backend/scripts/stage3_llm_remap_other.js](backend/scripts/stage3_llm_remap_other.js): uses an LLM to remap `other_*` rows into allowed canonical labels where possible.
- [backend/scripts/stage4_llm_categorize_menotypes.js](backend/scripts/stage4_llm_categorize_menotypes.js): active Stage 4 path that assigns fixed menotypes with Azure OpenAI.
- [backend/scripts/stage4_build_menotype_ml.js](backend/scripts/stage4_build_menotype_ml.js): alternate ML clustering path using weighted symptom vectors and k-means style grouping.

### Pipeline automation and orchestration

- [backend/scripts/watch_stage2_then_stage3.js](backend/scripts/watch_stage2_then_stage3.js): polls Stage 2 run status and auto-triggers Stage 3, optionally with remap.
- [backend/scripts/auto_start_stage3_when_stage2_done.js](backend/scripts/auto_start_stage3_when_stage2_done.js): older watcher that auto-starts later stages when Stage 2 finishes.

### Phase 2 extraction support

- [backend/scripts/prompts_phase2_extraction.js](backend/scripts/prompts_phase2_extraction.js): alternate prompt definition for explicit symptom-treatment pairing extraction.
- [backend/scripts/phase2_parser.js](backend/scripts/phase2_parser.js): parser for the Phase 2 explicit-link extraction format.
- [PHASE_2_EXTRACTION_README.md](PHASE_2_EXTRACTION_README.md): design note describing the explicit pairing extraction approach and intended next steps.

### Schema and migration helpers

- [backend/scripts/reset_v3_stage_tables.js](backend/scripts/reset_v3_stage_tables.js): destructive reset helper for a set of stage tables.
- [backend/scripts/_migrate_menotype_schema.js](backend/scripts/_migrate_menotype_schema.js): updates menotype profile schema toward extraction-level uniqueness.
- [backend/scripts/_add_symptom_profile.js](backend/scripts/_add_symptom_profile.js): adds `symptom_profile` JSONB to menotype profiles.

### Diagnostics, audits, and recovery helpers

- [backend/scripts/_audit_menotype_insights.js](backend/scripts/_audit_menotype_insights.js): audits cohort and menotype insight quality.
- [backend/scripts/_check_canonical_structure.js](backend/scripts/_check_canonical_structure.js): inspects canonical table source separation and shape.
- [backend/scripts/_check_menotype_distribution.js](backend/scripts/_check_menotype_distribution.js): prints menotype distribution overall and by source type.
- [backend/scripts/_check_stage1_uniqueness.js](backend/scripts/_check_stage1_uniqueness.js): validates uniqueness assumptions for ingested posts/comments.
- [backend/scripts/_check_stage2_status.js](backend/scripts/_check_stage2_status.js): inspects recent Stage 2 runs and extraction states.
- [backend/scripts/_check_stage3_counts.js](backend/scripts/_check_stage3_counts.js): quick row-count summary for Stage 3 output tables.
- [backend/scripts/_check_v41prod_progress.js](backend/scripts/_check_v41prod_progress.js): checks progress for the `v41prod` extraction run.
- [backend/scripts/_validate_stage2_pilot.js](backend/scripts/_validate_stage2_pilot.js): evaluates pilot extraction quality and completeness.
- [backend/scripts/_list_db_tables.js](backend/scripts/_list_db_tables.js): lists current public schema tables.
- [backend/scripts/_probe_aoai.js](backend/scripts/_probe_aoai.js): probes Azure OpenAI deployment and API-version compatibility.
- [backend/scripts/check_comment_plus.js](backend/scripts/check_comment_plus.js): investigates `+` comment artifacts in ingested Reddit data.
- [backend/scripts/check_plus_artifact.js](backend/scripts/check_plus_artifact.js): deeper probe for plus-sign text artifact patterns.

### Cleanup and requeue helpers

- [backend/scripts/_cleanup_v41pilot.js](backend/scripts/_cleanup_v41pilot.js): clears pilot extraction data and closes a stale run.
- [backend/scripts/_close_stale_runs_20_21.js](backend/scripts/_close_stale_runs_20_21.js): marks specific stale runs as failed.
- [backend/scripts/_close_stale_stage2_run.js](backend/scripts/_close_stale_stage2_run.js): closes a stale Stage 2 run.
- [backend/scripts/_close_stale_v41prod_runs.js](backend/scripts/_close_stale_v41prod_runs.js): closes stale `v41prod` Stage 2 run records.
- [backend/scripts/_stage2_clear_model.js](backend/scripts/_stage2_clear_model.js): deletes extraction rows for a given model.

## Deployment and Generated Artifacts

- [backend/deploy-azure.ps1](backend/deploy-azure.ps1): PowerShell helper to provision and deploy the backend to Azure App Service.
- `backend/backend.zip`: generated zip artifact from deployment experiments.
- `backend/deploy.zip`: smaller generated deployment package.
- `backend/_deploy/`: generated deployment mirror of the backend source used during deployment debugging.

Inside `backend/_deploy/`:

- `db.js`: copied DB connection file for deployment packaging.
- `package.json`: copied runtime manifest for deployment packaging.
- `package-lock.json`: copied dependency lockfile for deployment packaging.
- `server.js`: copied Express entry point for deployment packaging.
- `middleware/auth.js`: copied JWT middleware.
- `public/index.html`: copied frontend HTML.
- `public/script.js`: copied frontend logic.
- `routes/auth.js`: copied auth routes.
- `routes/checkins.js`: copied check-in routes.
- `routes/community.js`: copied community routes.
- `routes/menotype.js`: copied legacy menotype route.
- `routes/symptoms.js`: copied insight route.
- `utils/sendEmail.js`: copied mailer utility.
- `utils/menotype_categorizer.js`: copied live user menotype categorizer.

These `_deploy` files are not the primary source of truth. The main source lives under `backend/`.

## Postman and Workspace Metadata

- [.postman/resources.yaml](.postman/resources.yaml): local Postman workspace resource metadata.
- [postman/globals/workspace.globals.yaml](postman/globals/workspace.globals.yaml): Postman global variables for testing flows.

## Root Repository Files

- [README.md](README.md): this project manual.
- [.gitignore](.gitignore): ignore rules for local secrets, dependencies, and generated artifacts.

## Important Design Notes

### Why there are old and new schemas together

This repository currently contains both legacy v1 or v2-era schema files and the newer v3 pipeline/app files. The important current path is:

- App runtime: `create_wehealth_v3_app_core.sql`
- Pipeline runtime: `create_wehealth_v3_stage1_ingestion.sql` through `create_wehealth_v3_stage4_linking.sql`

The older files are still useful as historical reference and compatibility scaffolding.

### Why there are two menotype approaches

- LLM categorization was chosen for the active user-facing flow because you wanted 5 fixed menotype definitions, not machine-discovered clusters that may drift.
- The ML clustering script remains in the repo as a research and comparison path.

### Why `_deploy` exists

It was created during Azure deployment debugging as a copied deployable backend bundle. It is useful for packaging experiments, but it should not replace the primary `backend/` source tree.

## Recommended Developer Workflow

1. Start with the app-core SQL if you only need auth, check-ins, and community.
2. Run the Stage 1 to Stage 4 SQL files when you need Reddit analytics and menotype insights.
3. Start the local server with `npm --prefix backend start`.
4. Use the app at `http://localhost:3000`.
5. Use the pipeline scripts directly from `backend/scripts/` when refreshing analytics.

## Current Source of Truth Summary

- Main app source: `backend/`
- Main database source: `database/`
- Main docs: `README.md`
- Research or historical notes: `PHASE_2_EXTRACTION_README.md`
- Generated deployment artifacts: `backend/_deploy/`, `backend/*.zip`
		timestamp created_at
	}

	ENTRIES {
		int entry_id PK
		text post_id
		text emotional_state
		text timeframe
		text primary_issue
		int age
		text age_range
		int age_at_menopause
		int years_since_menopause
		text menopause_stage
		text stage_confidence
	}

	ENTRY_SYMPTOMS_NORMALIZED {
		int entry_id FK
		int symptom_id FK
	}

	MENOTYPES {
		int entry_id
		int menotype
	}

	SYMPTOM_DICTIONARY {
		int symptom_id PK
		text canonical_symptom
	}

	SYMPTOM_MAPPING {
		text raw_symptom
		text canonical_symptom
	}

	SYMPTOM_SYNONYMS {
		text raw_symptom
		int symptom_id
	}

	TREATMENT_DICTIONARY {
		int treatment_id PK
		text canonical_treatment
	}

	TREATMENT_MAPPING {
		text raw_treatment
		text canonical_treatment
		int treatment_id
	}

	TREATMENT_SYNONYMS {
		text raw_treatment
		int treatment_id
	}

	TREATMENT_EVENTS {
		int event_id PK
		int entry_id
		text treatment
		boolean worked
		boolean discontinued
	}

	TREATMENT_EVENTS_NORMALIZED {
		int entry_id
		int treatment_id
		boolean worked
		boolean discontinued
	}

	TREATMENT_SIDE_EFFECTS {
		int event_id
		text side_effect
	}

	COMMENTS {
		int comment_id PK
		int entry_id
		text comment_text
		text comment_clean
	}

	TREATMENT_COMMENTS {
		int comment_id
		int entry_id
		text comment_clean
	}

	COMMENT_TREATMENT_EVENTS {
		int event_id PK
		int comment_id
		int entry_id
		text treatment
		text symptom
		text outcome
		text evidence_type
	}

	COMMENT_EVENTS_NORMALIZED {
		int id PK
		int event_id
		int comment_id
		int entry_id
		int treatment_id
		int symptom_id
		text outcome
		text evidence_type
	}

	RAW_POSTS {
		text post_id PK
		text subreddit
		text title
		text post_text
		text comments
	}

	RAW_ENTRIES {
		int entry_id PK
		text subreddit
		text post_id
		text title
		text post_text
		int score
		float created_utc
		text url
		int num_comments
		text comments
	}

	ENTRIES_CLEAN {
		int entry_id
		text post_id
		text emotional_state
		text timeframe
		text primary_issue
		int age
		text age_range
		int age_at_menopause
		int years_since_menopause
		text menopause_stage
		text stage_confidence
	}

	ENTRY_SYMPTOMS {
		int entry_id
		text symptom
	}

	SYMPTOM_MATRIX {
		int entry_id
		int hot_flashes
		int sleep
		int anxiety
		int depression
		int brain_fog
		int mood_swings
		int fatigue
		int pain
		int headaches
		int palpitations
		int vaginal_dryness
		int libido
		int irregular_periods
		int weight_changes
		int hair_skin
		int digestive
		int urinary
		int breast_pain
		int dizziness
		int tingling
		int suicidal
		int memory_loss
		int temperature
	}

	SYMPTOM_MATRIX_CLEAN {
		int entry_id
		int menotype
	}

	SYMPTOM_MATRIX_CLUSTERED {
		int entry_id
		int menotype
	}

	USERS ||--o{ USER_CHECKINS : has
	USERS ||--o{ COMMUNITY_POSTS : creates
	USERS ||--o{ POST_COMMENTS : writes
	USERS ||--o{ POST_LIKES : likes

	COMMUNITY_POSTS ||--o{ POST_COMMENTS : has
	COMMUNITY_POSTS ||--o{ POST_LIKES : has

	ENTRIES ||--o{ ENTRY_SYMPTOMS_NORMALIZED : contains
	SYMPTOM_DICTIONARY ||--o{ ENTRY_SYMPTOMS_NORMALIZED : categorizes

	ENTRIES ||--o{ MENOTYPES : classified_as
	ENTRIES ||--o{ TREATMENT_EVENTS : treatment_events
	ENTRIES ||--o{ TREATMENT_EVENTS_NORMALIZED : normalized_events
	ENTRIES ||--o{ ENTRY_SYMPTOMS : raw_symptoms
	ENTRIES ||--o{ COMMENTS : source_comments

	TREATMENT_DICTIONARY ||--o{ TREATMENT_EVENTS_NORMALIZED : canonical_treatment
	TREATMENT_EVENTS ||--o{ TREATMENT_SIDE_EFFECTS : side_effects

	SYMPTOM_DICTIONARY ||--o{ SYMPTOM_SYNONYMS : synonym_of
	TREATMENT_DICTIONARY ||--o{ TREATMENT_SYNONYMS : synonym_of

	RAW_POSTS ||--o{ RAW_ENTRIES : source
```

## Install and Run (Manual)

From project root:

```bash
cd backend
npm install
node server.js
```

Expected startup logs:

- WE Health API running on port 3000
- Connected to DB: your_database_name

Open in browser:

http://localhost:3000

## API Overview

Public auth routes:

- POST /auth/register
- POST /auth/login
- POST /auth/request-otp
- POST /auth/verify-otp
- POST /auth/verify-registration-otp
- POST /auth/forgot-password
- POST /auth/reset-password

Protected routes (Bearer token required):

- GET /symptoms
- POST /symptoms/women-like-me
- POST /menotype
- GET /checkins
- POST /checkins
- GET /community/posts
- POST /community/posts
- POST /community/posts/:postId/like
- GET /community/posts/:postId/comments
- POST /community/posts/:postId/comments

## Typical User Flow

1. User opens landing page and registers.
2. User verifies account with OTP.
3. User logs in and receives JWT.
4. User submits daily check-ins.
5. User receives cohort insights from similar symptoms.
6. User posts and interacts in the community feed.

## Known Setup Caveats

- backend/package.json currently has no start/dev script. Use node server.js directly.
- Ensure JWT_SECRET is always set; protected routes and login tokens depend on it.
- Keep backend/.env out of version control in real deployments.

## Future Improvements

- Add npm scripts: start, dev, and test
- Add DB migration tooling (for complete reproducible setup)
- Add automated tests for auth, check-ins, and community routes
- Add API docs (OpenAPI/Swagger)
- Add deployment guides for staging/production