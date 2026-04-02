# wehealth_v3 Stage 2 Validation Gate

Stage 2 scope: extraction only.
Do not start canonicalization until this gate passes.

## Pass Criteria

1. Coverage
- 100% of eligible pending documents in Stage 1 are attempted.
- Success rate target is met (define threshold before run).

2. Parse correctness
- raw_response_json is present for done rows.
- symptoms_raw_json and treatments_raw_json are valid arrays.
- Required metadata present: model_name, prompt_version, extraction_schema_version.

3. Idempotency
- Rerun with same source_content_hash + same versions does not create duplicate extraction rows.
- Rerun updates status/attempts where needed.

4. Incremental behavior
- Only documents with new/changed source_content_hash are extracted on incremental run.
- Unchanged documents remain skipped/done.

5. Quality sample
- Human spot-check sample of done rows confirms field plausibility:
  age, menopause_stage_raw, symptoms_raw_json, treatments_raw_json.

6. Cost and latency baseline
- Capture docs/min, average latency/doc, token usage/doc.
- Record run summary in pipeline_runs.

## Approval Rule

Approve Stage 2 only when all criteria are green for:
- first full extraction run
- one idempotent rerun
- one incremental mini-run
