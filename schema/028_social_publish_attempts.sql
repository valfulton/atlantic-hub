-- 028_social_publish_attempts.sql
-- Publisher-cron concurrency safety for social_outbox (schema 017).
-- See docs/CLAUDE_KICKOFF_PR_PHASE3_HANDOFF.md (P1 - Publisher cron).
--
-- Idempotent + additive: safe to re-run. Does NOT drop/rename/recreate anything.
-- HostGator is classic MySQL (no ADD COLUMN IF NOT EXISTS), so the ALTER is
-- guarded with an information_schema sentinel + PREPARE (same pattern as 027).
--
-- WHY THIS IS THE ONLY COLUMN ADDED (read before adding more):
-- social_outbox ALREADY has everything the publisher needs EXCEPT a claim clock:
--   - status ENUM(... 'publishing' ...)  -> the row-level lock state
--   - retries INT                        -> attempt count (do NOT add a duplicate)
--   - error_message VARCHAR(500)         -> last error (do NOT add a duplicate)
--   - scheduled_for / published_at       -> the due-time + completion clocks
--   - updated_at ON UPDATE CURRENT_TIMESTAMP
-- The one missing piece is a DEDICATED claim timestamp. Overloading updated_at
-- for orphan recovery is fragile (any unrelated edit to a scheduled row resets
-- the orphan timer). claimed_at is a clean, single-purpose clock. Keep it lean:
-- do not add publish_attempts/last_error here -- retries + error_message exist.
--
-- THE CLAIM PROTOCOL the cron must use (document, do not implement here):
--   1. CLAIM (atomic, race-safe -- relies on the conditional UPDATE, not SELECT):
--        UPDATE social_outbox
--           SET status='publishing', claimed_at=NOW()
--         WHERE id=? AND status='scheduled' AND scheduled_for <= NOW();
--      Only the run whose UPDATE affects 1 row owns the post. Overlapping cron
--      runs that lose the race affect 0 rows and skip it -> never double-post.
--   2. PUBLISH the claimed row via the EXISTING publishOutboxRow() (lib/social/publish.ts).
--   3. On success publishOutboxRow already sets status='published'+published_at.
--      On failure it sets status='failed'+error_message and bumps retries.
--   4. ORPHAN RECOVERY (a prior run died mid-publish, row stuck in 'publishing'):
--        ... WHERE status='publishing' AND claimed_at < (NOW() - INTERVAL 15 MINUTE)
--      re-queue (status='scheduled') or fail per retries cap.
--
-- INTELLIGENCE-GRAPH FIT: this migration adds NO new intelligence object. It is
-- pure activation/reliability infra so the EXISTING social.published /
-- social.publish_failed events (system_events, schema 010) start firing on
-- their own cadence instead of only on a manual click. The compounding signal
-- ("which timing/cadence actually earns engagement") flows through those events.

USE shhdbite_AV;

SET @has_claimed_at := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = 'shhdbite_AV'
     AND TABLE_NAME = 'social_outbox'
     AND COLUMN_NAME = 'claimed_at'
);
SET @sql := IF(@has_claimed_at = 0,
  'ALTER TABLE social_outbox
     ADD COLUMN claimed_at DATETIME NULL AFTER status,
     ADD KEY idx_status_claimed (status, claimed_at)',
  'SELECT ''028: social_outbox.claimed_at already present -- skipped'' AS info'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- End of 028. Run once in phpMyAdmin against shhdbite_AV. Re-runnable.
-- Verify:
--   SHOW COLUMNS FROM social_outbox LIKE 'claimed_at';
