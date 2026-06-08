-- 083_restore_from_brief_versions.sql  (#519 follow-up, val 2026-06-08)
--
-- RESTORES EVERY WIPED BRIEF KEY (not just the identity quartet 082 covers).
--
-- Background: prior to commit 0b60222, prep-all step 1 called saveBriefPayload
-- with only the LLM patch, not the merged brief. Since the writer does a full
-- JSON column replace (brief_store.ts:141), every Prep run that wrote
-- anything wiped every other key from creative_briefs.brief_payload —
-- business_description, key_message, brand_colors, the "Your numbers"
-- fields, founder_story, every PR_* field, everything.
--
-- The good news: brief_store.ts:131 calls snapshotBriefVersion(...) BEFORE
-- every saveBriefPayload overwrite. So each wipe wrote the PRE-wipe payload
-- into creative_brief_versions. That table is the time machine.
--
-- This script merges the most-recent snapshot of ANY source back over each
-- client's current brief. JSON_MERGE_PATCH(snapshot, current) means CURRENT
-- wins on key conflict — so any keys val typed AFTER the wipe (re-entries,
-- hand-edits, schema 082's identity backfill) are preserved. Only keys
-- that were ONLY in the snapshot get restored.
--
-- Why no source filter (val 2026-06-08): inspection of the live snapshot
-- table showed only 1 row with source='web_filler_apply', confirming the
-- wipe happened essentially once. With one wipe + no subsequent writes on
-- the affected client, the MOST RECENT snapshot of any source IS that
-- client's pre-wipe state. For all other clients whose briefs are intact,
-- the latest snapshot is just an older copy of their current brief —
-- merging with current-wins is a no-op.
--
-- Clients with ZERO rows in creative_brief_versions cannot be recovered
-- from this table (as of 2026-06-08 that's at least client_id 1, 5, 13 —
-- their thin briefs need fresh intake submissions, not snapshot restore).
-- This script silently skips them via the INNER JOIN.
--
-- Safe to run repeatedly. The JSON_MERGE_PATCH is idempotent: running it
-- twice on a recovered brief produces the same result (current always
-- wins, so the merge is a no-op once keys are filled).
--
-- ORDERING: complementary to 080 (website_url backfill) and 082 (identity
-- quartet from operational tables). Order does not matter for
-- correctness — all three are blanks-only or current-wins. Recommended:
-- run this BEFORE the next prep-all on any affected client, so val
-- doesn't lose the recovered keys to a fresh write cycle. (The fix in
-- 0b60222 means new prep-all runs are safe, but verify the deploy is
-- live first.)

-- Step 1: For every client with at least one snapshot in
-- creative_brief_versions, merge the most-recent snapshot's payload back
-- under the current live brief. JSON_MERGE_PATCH(a, b): b's keys override
-- a's. We pass (snapshot, current) so current wins on conflict.
UPDATE creative_briefs cb
JOIN (
  SELECT cbv.client_id, cbv.brief_payload AS snapshot
    FROM creative_brief_versions cbv
    JOIN (
      SELECT client_id, MAX(created_at) AS max_at
        FROM creative_brief_versions
       WHERE tenant_id = 'av'
       GROUP BY client_id
    ) latest
      ON latest.client_id = cbv.client_id
     AND latest.max_at    = cbv.created_at
   WHERE cbv.tenant_id = 'av'
) ws ON ws.client_id = cb.client_id
   SET cb.brief_payload = JSON_MERGE_PATCH(ws.snapshot, cb.brief_payload),
       cb.updated_at    = NOW()
 WHERE cb.tenant_id = 'av';

-- Step 2 (verify, run BEFORE the UPDATE to preview impact): per-client
-- key counts so val can see who would gain back what. Wipe victims show
-- snapshot_key_count >> current_key_count. Healthy clients show roughly
-- equal counts (or current >= snapshot if val edited after the snapshot
-- was written). Clients with NO row in creative_brief_versions don't
-- appear here at all — they need fresh intake, not version-restore.
-- Run this in phpMyAdmin first; if the diff looks right, run Step 1;
-- then re-run this to confirm current_key_count >= snapshot_key_count
-- for every affected client.
-- SELECT
--   c.client_id,
--   c.client_name,
--   JSON_LENGTH(JSON_KEYS(cb.brief_payload))         AS current_key_count,
--   JSON_LENGTH(JSON_KEYS(latest_snap.snapshot))     AS snapshot_key_count,
--   GREATEST(
--     JSON_LENGTH(JSON_KEYS(latest_snap.snapshot))
--       - JSON_LENGTH(JSON_KEYS(cb.brief_payload)),
--     0
--   )                                                AS keys_to_restore,
--   latest_snap.source                               AS snapshot_source,
--   latest_snap.snap_at                              AS snapshot_at
--   FROM clients c
--   JOIN creative_briefs cb
--     ON cb.client_id = c.client_id AND cb.tenant_id = 'av'
--   JOIN (
--     SELECT cbv.client_id,
--            cbv.brief_payload AS snapshot,
--            cbv.source        AS source,
--            cbv.created_at    AS snap_at
--       FROM creative_brief_versions cbv
--       JOIN (
--         SELECT client_id, MAX(created_at) AS max_at
--           FROM creative_brief_versions
--          WHERE tenant_id = 'av'
--          GROUP BY client_id
--       ) latest
--         ON latest.client_id = cbv.client_id AND latest.max_at = cbv.created_at
--      WHERE cbv.tenant_id = 'av'
--   ) latest_snap ON latest_snap.client_id = c.client_id
--  WHERE c.tenant_id = 'av'
--  ORDER BY keys_to_restore DESC, c.client_id ASC;
--
-- To see which clients have NO snapshots and therefore can't be restored
-- by this script (as of 2026-06-08: client_id 1, 5, 13) — run separately:
-- SELECT c.client_id, c.client_name
--   FROM clients c
--   LEFT JOIN creative_brief_versions cbv
--     ON cbv.client_id = c.client_id AND cbv.tenant_id = 'av'
--  WHERE c.tenant_id = 'av' AND cbv.id IS NULL
--  ORDER BY c.client_id ASC;
