-- =====================================================================
-- Atlantic Hub -- Living Score (ship 1 of 5, VP-of-Sales rollout)
-- File:    schema/018_living_score.sql
-- Target:  shhdbite_AV
-- Run in:  HostGator phpMyAdmin -> shhdbite_AV -> SQL tab -> paste -> Go
-- =====================================================================
--
-- WHAT THIS DOES
--   Until now ai_score has been a static one-shot rating set at insert time
--   and bumped only on a manual Re-score. The score never moved in response
--   to real signal -- a positive reply, an email open, an unsubscribe.
--
--   Living Score introduces three new columns:
--
--     ai_engagement_score        -- signed integer that moves on system_events
--                                  Positive: open, click, positive reply,
--                                  commercial generated, audit-form refill.
--                                  Negative: bounce, unsubscribe, negative
--                                  reply, silence-after-contact.
--
--     ai_combined_score          -- the visible 0-100 number on the dashboard,
--                                  computed as clamp(ai_score + ai_engagement_score, 0, 100)
--                                  Stored not derived so we can index + sort.
--
--     score_history              -- JSON rolling log of every score change,
--                                  capped at last 50 entries by the lib code.
--                                  Powers the sparkline on the lead detail page
--                                  and gives the AI a memory of how a lead has
--                                  been courted over time.
--
--     engagement_score_updated_at-- when engagement last moved. Lets the daily
--                                  cron prune cold leads and lets the UI render
--                                  "12 minutes ago" style freshness cues.
--
-- IDEMPOTENT: every ALTER guarded by an information_schema check.
-- =====================================================================

USE shhdbite_AV;
SET NAMES utf8mb4;

-- ---------------------------------------------------------------------
-- 1. ai_engagement_score -- signed int default 0
-- ---------------------------------------------------------------------
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = 'shhdbite_AV' AND TABLE_NAME = 'leads' AND COLUMN_NAME = 'ai_engagement_score'
);
SET @sql := IF(@col_exists = 0,
  "ALTER TABLE leads ADD COLUMN ai_engagement_score INT NOT NULL DEFAULT 0 COMMENT 'Living engagement delta. Positive = real-world signal of buying intent. Negative = signal away. Bumped by lib/ai/engagement_score.ts on system_events.'",
  "SELECT 'ai_engagement_score column already exists -- skipped' AS info");
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------------
-- 2. ai_combined_score -- the visible 0-100 number
-- ---------------------------------------------------------------------
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = 'shhdbite_AV' AND TABLE_NAME = 'leads' AND COLUMN_NAME = 'ai_combined_score'
);
SET @sql := IF(@col_exists = 0,
  "ALTER TABLE leads ADD COLUMN ai_combined_score TINYINT UNSIGNED NULL COMMENT 'clamp(ai_score + ai_engagement_score, 0, 100). Stored not derived so it can be indexed + sorted on the leads list.'",
  "SELECT 'ai_combined_score column already exists -- skipped' AS info");
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------------
-- 3. score_history -- JSON rolling log
-- ---------------------------------------------------------------------
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = 'shhdbite_AV' AND TABLE_NAME = 'leads' AND COLUMN_NAME = 'score_history'
);
SET @sql := IF(@col_exists = 0,
  "ALTER TABLE leads ADD COLUMN score_history JSON NULL COMMENT 'Array of {at, event_type, delta, fit, engagement, combined, note} entries. Cap 50 by lib code. Drives the sparkline on lead detail.'",
  "SELECT 'score_history column already exists -- skipped' AS info");
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------------
-- 4. engagement_score_updated_at
-- ---------------------------------------------------------------------
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = 'shhdbite_AV' AND TABLE_NAME = 'leads' AND COLUMN_NAME = 'engagement_score_updated_at'
);
SET @sql := IF(@col_exists = 0,
  "ALTER TABLE leads ADD COLUMN engagement_score_updated_at DATETIME NULL COMMENT 'Set every time ai_engagement_score moves. Cron prunes; UI renders freshness.'",
  "SELECT 'engagement_score_updated_at column already exists -- skipped' AS info");
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------------
-- 5. Index on ai_combined_score -- the leads list orders by it
-- ---------------------------------------------------------------------
SET @idx_exists := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = 'shhdbite_AV' AND TABLE_NAME = 'leads' AND INDEX_NAME = 'idx_combined_score'
);
SET @sql := IF(@idx_exists = 0,
  "ALTER TABLE leads ADD INDEX idx_combined_score (ai_combined_score)",
  "SELECT 'idx_combined_score already exists -- skipped' AS info");
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------------
-- 6. Backfill ai_combined_score for any rows that already have ai_score.
--    Engagement starts at 0 so combined == fit until events start firing.
--    Re-running this is safe (only touches rows where combined is NULL).
-- ---------------------------------------------------------------------
UPDATE leads
   SET ai_combined_score = LEAST(100, GREATEST(0, ai_score))
 WHERE ai_combined_score IS NULL
   AND ai_score IS NOT NULL;

-- =====================================================================
-- VERIFICATION (paste each separately)
-- =====================================================================
-- 1. Confirm the columns and index exist:
-- SHOW COLUMNS FROM leads LIKE 'ai_engagement_score';
-- SHOW COLUMNS FROM leads LIKE 'ai_combined_score';
-- SHOW COLUMNS FROM leads LIKE 'score_history';
-- SHOW COLUMNS FROM leads LIKE 'engagement_score_updated_at';
-- SHOW INDEX FROM leads WHERE Key_name = 'idx_combined_score';
--
-- 2. Spot-check the backfill:
-- SELECT id, company, ai_score, ai_engagement_score, ai_combined_score
--   FROM leads WHERE ai_score IS NOT NULL ORDER BY id DESC LIMIT 10;
-- -- Expect ai_combined_score == ai_score (engagement starts at 0).
--
-- 3. After Living Score code ships and you trigger an event, sanity:
-- SELECT id, company, ai_score, ai_engagement_score, ai_combined_score,
--        engagement_score_updated_at, JSON_LENGTH(score_history) AS history_n
--   FROM leads WHERE ai_engagement_score != 0 ORDER BY engagement_score_updated_at DESC LIMIT 10;
-- =====================================================================
-- END 018_living_score.sql
-- =====================================================================
