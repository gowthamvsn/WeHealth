# wehealth_v3 Stage 1 Validation Gate

Run these checks after applying Stage 1 and after each ingestion rerun.

## Source Manifest (Current Backfill)

- d:/PeriMP/menopause_anxiety_posts_with_comments.csv (500 rows)
- d:/PeriMP/menopause_anxiety_posts_with_comments4.csv (572 rows)
- d:/PeriMP/menopause_anxiety_posts_with_comments5.csv (121 rows)
- d:/PeriMP/menopause_anxiety_posts_with_comments_3.csv (694 rows)
- d:/PeriMP/menopause_anxiety_posts_with_comments_2.csv (499 rows)

Observed source shape across all files:
- Columns: subreddit, post_id, title, post_text, score, created_utc, url, num_comments, comments
- Total post rows across files: 2386
- Distinct post_id values: 702
- Duplicate post rows across files: 1684

Important ingestion note:
- CSV files do not include native reddit comment IDs.
- Ingestion must generate a deterministic synthetic comment ID per parsed comment row.
- Use the same synthetic ID algorithm on reruns so comments dedupe correctly.

## Pass Criteria

1. Count reconciliation
- Reddit posts inserted count matches source posts count.
- Reddit comments inserted count matches source comments count.

2. Parent linkage integrity
- Every reddit comment row has a non-null source_post_id.
- Every reddit comment row has a non-null parent_document_id.
- parent_document_id points to a row with source_type = post.

3. Idempotency
- Rerunning same input batch inserts 0 duplicate rows.
- Duplicate attempts should update last_seen_at, not create new rows.

4. Incremental behavior
- Adding N new rows processes only those N rows.
- Existing rows stay out of pending unless content hash changes.

5. Status lifecycle
- Rows move pending -> processing -> done.
- Failures move to failed with last_error populated.

6. Latency baseline
- Capture ingest rows/sec for posts and comments separately.
- Record pipeline run metrics in pipeline_runs.

## Approval Rule

Approve Stage 1 only when all pass criteria are green for:
- initial backfill run
- one idempotent rerun
- one incremental mini-run
