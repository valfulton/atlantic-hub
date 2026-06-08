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
-- into creative_brief_versions with source='web_filler_apply'. That table
-- is the time machine.
--
-- This script merges the most-recent pre-wipe snapshot back over each
-- client's current brief. JSON_MERGE_PATCH(pre_wipe, current) means
-- CURRENT wins on key conflict — so any keys val typed AFTER the wipe
-- (re-entries, hand-edits, schema 082's identity backfill) are preserved.
-- Only keys that were ONLY in the pre-wipe snapshot get restored.
--
-- Source-label rationale: saveBriefPayload at brief_store.ts:131 records
-- the snapshot's source as the source label of the WRITE that is about to
-- happen. So source='web_filler_apply' marks "this snapshot is the brief
-- state immediately before a prep-all step-1 wipe." The safe fill-intake
-- apply uses source='web_filler' (no underscore-apply suffix), so this
-- filter targets the wipes specifically.
--
-- If a client was wiped multiple times, MAX(created_at) picks the snapshot
-- from RIGHT BEFORE the most recent wipe — which by induction contains
-- everything val accumulated through all the earlier wipes + any
-- re-entries she made between wipes. So one merge restores the maximum
-- recoverable state.
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

-- Step 1: For every client with a web_filler_apply snapshot in
-- creative_brief_versions, merge the most-recent snapshot's payload back
-- under the current live brief. JSON_MERGE_PATCH(a, b): b's keys override
-- a's. We pass (pre_wipe, current) so current wins on conflict.
UPDATE creative_briefs cb
JOIN (
  SELECT cbv.client_id, cbv.brief_payload AS pre_wipe
    FROM creative_brief_versions cbv
    JOIN (
      SELECT client_id, MAX(created_at) AS max_at
        FROM creative_brief_versions
       WHERE tenant_id = 'av'
         AND source    = 'web_filler_apply'
       GROUP BY client_id
    ) latest
      ON latest.client_id = cbv.client_id
     AND latest.max_at    = cbv.created_at
   WHERE cbv.tenant_id = 'av'
     AND cbv.source    = 'web_filler_apply'
) ws ON ws.client_id = cb.client_id
   SET cb.brief_payload = JSON_MERGE_PATCH(ws.pre_wipe, cb.brief_payload),
       cb.updated_at    = NOW()
 WHERE cb.tenant_id = 'av';

-- Step 2 (verify, run BEFORE the UPDATE to preview impact): per-client
-- key counts so val can see who got how much back. Wipe victims show
-- prewipe_key_count >> current_key_count. Run this in phpMyAdmin first;
-- if the diff looks right, run Step 1; then re-run this to confirm
-- current_key_count == prewipe_key_count for every affected client.
-- SELECT
--   c.client_id,
--   c.client_name,
--   JSON_LENGTH(JSON_KEYS(cb.brief_payload))         AS current_key_count,
--   JSON_LENGTH(JSON_KEYS(latest_snap.pre_wipe))     AS prewipe_key_count,
--   JSON_LENGTH(JSON_KEYS(latest_snap.pre_wipe))
--     - JSON_LENGTH(JSON_KEYS(cb.brief_payload))     AS keys_to_restore,
--   latest_snap.snap_at                              AS prewipe_snapshot_at
--   FROM clients c
--   JOIN creative_briefs cb
--     ON cb.client_id = c.client_id AND cb.tenant_id = 'av'
--   JOIN (
--     SELECT cbv.client_id,
--            cbv.brief_payload AS pre_wipe,
--            cbv.created_at    AS snap_at
--       FROM creative_brief_versions cbv
--       JOIN (
--         SELECT client_id, MAX(created_at) AS max_at
--           FROM creative_brief_versions
--          WHERE tenant_id = 'av' AND source = 'web_filler_apply'
--          GROUP BY client_id
--       ) latest
--         ON latest.client_id = cbv.client_id AND latest.max_at = cbv.created_at
--      WHERE cbv.tenant_id = 'av' AND cbv.source = 'web_filler_apply'
--   ) latest_snap ON latest_snap.client_id = c.client_id
--  WHERE c.tenant_id = 'av'
--  ORDER BY keys_to_restore DESC, c.client_id ASC;
