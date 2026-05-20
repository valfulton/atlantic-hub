-- =====================================================================
-- Atlantic Hub -- Sales Team mega-ship (VP-of-Sales rollout, ships 2 to 5 bundled)
-- File:    schema/019_sales_team_pain_lifecycle.sql
-- Target:  shhdbite_AV
-- Run in:  HostGator phpMyAdmin -> shhdbite_AV -> SQL tab -> paste -> Go
-- =====================================================================
--
-- WHAT THIS DOES
--   Sets up the database for everything Val asked for: a working sales
--   team where reps collect leads + make calls, the owner sends warm
--   emails, leads never disappear (nurture / not_now / referred /
--   case_study lifecycle), real-time pain-point intelligence on each
--   lead, and a pipeline value rollup that gets the team excited.
--
--   Specifically:
--
--     1. pain_point_profile (JSON)   -- daily AI sweep extracts a
--                                       structured pain profile per lead
--                                       (primary_pain, urgency,
--                                       decision_maker_proximity,
--                                       budget_signal, timing_signal,
--                                       last_objection_seen). Surfaces
--                                       on the lead detail page as
--                                       "what to say on the call".
--     2. pain_extracted_at           -- when pain profile last refreshed.
--                                       Cron only re-runs if stale or NULL.
--     3. assigned_to_user_id         -- which sales rep owns this lead.
--                                       Powers the "My leads" filter.
--     4. handed_to_owner_at          -- timestamp when a rep flagged the
--                                       lead for the owner's warm-email
--                                       queue. Owner sees a filter chip
--                                       to find these on /admin/av.
--     5. wake_at_date                -- for leads in nurture / not_now
--                                       status, the date the nurture-wake
--                                       cron should flip them back to
--                                       contacted (date-based wake).
--                                       Behavior-based wake is wired into
--                                       lib/ai/engagement_score.ts
--                                       (positive engagement on a parked
--                                       lead automatically wakes it).
--     6. parked_reason               -- short text the rep typed when
--                                       parking the lead. Shows on the
--                                       lead detail when it wakes.
--     7. lead_status ENUM extension  -- adds nurture, not_now, referred,
--                                       case_study to the existing five
--                                       (new, contacted, qualified,
--                                       converted, lost). Nothing dies
--                                       at "lost" anymore.
--     8. call_log table              -- one row per call attempt. Tracks
--                                       outcome (connected, voicemail,
--                                       no_answer, wrong_number,
--                                       not_interested, follow_up,
--                                       converted), duration_seconds,
--                                       notes, called_at. Feeds the
--                                       Calls tab on lead detail + the
--                                       weekly recap counts.
--
-- IDEMPOTENT: every ALTER guarded by an information_schema check.
-- =====================================================================

USE shhdbite_AV;
SET NAMES utf8mb4;

-- ---------------------------------------------------------------------
-- 1. pain_point_profile (JSON)
-- ---------------------------------------------------------------------
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = 'shhdbite_AV' AND TABLE_NAME = 'leads' AND COLUMN_NAME = 'pain_point_profile'
);
SET @sql := IF(@col_exists = 0,
  "ALTER TABLE leads ADD COLUMN pain_point_profile JSON NULL COMMENT 'Structured pain profile extracted from audit_content + challenge + reply bodies. Populated by lib/ai/pain_extractor.ts daily cron.'",
  "SELECT 'pain_point_profile column already exists -- skipped' AS info");
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = 'shhdbite_AV' AND TABLE_NAME = 'leads' AND COLUMN_NAME = 'pain_extracted_at'
);
SET @sql := IF(@col_exists = 0,
  "ALTER TABLE leads ADD COLUMN pain_extracted_at DATETIME NULL COMMENT 'When pain_point_profile was last refreshed. Cron re-runs on NULL or older than 14 days.'",
  "SELECT 'pain_extracted_at column already exists -- skipped' AS info");
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------------
-- 2. assigned_to_user_id -- which sales rep owns this lead
-- ---------------------------------------------------------------------
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = 'shhdbite_AV' AND TABLE_NAME = 'leads' AND COLUMN_NAME = 'assigned_to_user_id'
);
SET @sql := IF(@col_exists = 0,
  "ALTER TABLE leads ADD COLUMN assigned_to_user_id BIGINT UNSIGNED NULL COMMENT 'shhdbite_atlantic_hub.admin_users.user_id (cross-DB, app-enforced). NULL = unassigned. Powers My-leads filter.'",
  "SELECT 'assigned_to_user_id column already exists -- skipped' AS info");
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx_exists := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = 'shhdbite_AV' AND TABLE_NAME = 'leads' AND INDEX_NAME = 'idx_assigned_to_user_id'
);
SET @sql := IF(@idx_exists = 0,
  "ALTER TABLE leads ADD INDEX idx_assigned_to_user_id (assigned_to_user_id)",
  "SELECT 'idx_assigned_to_user_id already exists -- skipped' AS info");
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------------
-- 3. handed_to_owner_at -- rep flagged the lead for the owner
-- ---------------------------------------------------------------------
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = 'shhdbite_AV' AND TABLE_NAME = 'leads' AND COLUMN_NAME = 'handed_to_owner_at'
);
SET @sql := IF(@col_exists = 0,
  "ALTER TABLE leads ADD COLUMN handed_to_owner_at DATETIME NULL COMMENT 'Set when a rep clicks Hand to owner. Owner sees a filter chip on /admin/av for warm-email queue. NULL = not handed.'",
  "SELECT 'handed_to_owner_at column already exists -- skipped' AS info");
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx_exists := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = 'shhdbite_AV' AND TABLE_NAME = 'leads' AND INDEX_NAME = 'idx_handed_to_owner_at'
);
SET @sql := IF(@idx_exists = 0,
  "ALTER TABLE leads ADD INDEX idx_handed_to_owner_at (handed_to_owner_at)",
  "SELECT 'idx_handed_to_owner_at already exists -- skipped' AS info");
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------------
-- 4. wake_at_date + parked_reason -- nurture / not_now lifecycle
-- ---------------------------------------------------------------------
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = 'shhdbite_AV' AND TABLE_NAME = 'leads' AND COLUMN_NAME = 'wake_at_date'
);
SET @sql := IF(@col_exists = 0,
  "ALTER TABLE leads ADD COLUMN wake_at_date DATE NULL COMMENT 'Set when status moves to nurture or not_now. nurture-wake-cron flips status back to contacted when wake_at_date <= today.'",
  "SELECT 'wake_at_date column already exists -- skipped' AS info");
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx_exists := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = 'shhdbite_AV' AND TABLE_NAME = 'leads' AND INDEX_NAME = 'idx_wake_at_date'
);
SET @sql := IF(@idx_exists = 0,
  "ALTER TABLE leads ADD INDEX idx_wake_at_date (wake_at_date)",
  "SELECT 'idx_wake_at_date already exists -- skipped' AS info");
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = 'shhdbite_AV' AND TABLE_NAME = 'leads' AND COLUMN_NAME = 'parked_reason'
);
SET @sql := IF(@col_exists = 0,
  "ALTER TABLE leads ADD COLUMN parked_reason VARCHAR(160) NULL COMMENT 'Short text the rep typed when parking the lead in nurture / not_now / referred. Shows on the lead detail on wake.'",
  "SELECT 'parked_reason column already exists -- skipped' AS info");
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------------
-- 5. lead_status ENUM extension -- add nurture, not_now, referred, case_study
-- ---------------------------------------------------------------------
-- The ENUM is widening. Existing values (new, contacted, qualified,
-- converted, lost) keep working. Re-running this ALTER is safe because
-- MariaDB no-ops an ENUM redefinition that already matches.
-- ---------------------------------------------------------------------
ALTER TABLE leads MODIFY COLUMN lead_status
  ENUM('new','contacted','qualified','converted','lost','nurture','not_now','referred','case_study')
  NOT NULL DEFAULT 'new';

-- ---------------------------------------------------------------------
-- 6. call_log table -- one row per call attempt
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS call_log (
  call_log_id      BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  lead_id          INT NOT NULL,
  user_id          BIGINT UNSIGNED NULL
    COMMENT 'shhdbite_atlantic_hub.admin_users.user_id (cross-DB, app-enforced). NULL = system / unknown.',
  outcome          ENUM(
    'connected','voicemail','no_answer','wrong_number','not_interested',
    'follow_up','meeting_booked','converted','other'
  ) NOT NULL DEFAULT 'no_answer',
  duration_seconds INT UNSIGNED NULL,
  notes            TEXT NULL,
  called_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_lead_called_at (lead_id, called_at),
  KEY idx_user_called_at (user_id, called_at),
  KEY idx_outcome (outcome),
  CONSTRAINT fk_call_log_lead FOREIGN KEY (lead_id)
    REFERENCES leads(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================================
-- VERIFICATION (paste each separately)
-- =====================================================================
-- 1. Confirm the new columns exist:
-- SHOW COLUMNS FROM leads LIKE 'pain_point_profile';
-- SHOW COLUMNS FROM leads LIKE 'pain_extracted_at';
-- SHOW COLUMNS FROM leads LIKE 'assigned_to_user_id';
-- SHOW COLUMNS FROM leads LIKE 'handed_to_owner_at';
-- SHOW COLUMNS FROM leads LIKE 'wake_at_date';
-- SHOW COLUMNS FROM leads LIKE 'parked_reason';
--
-- 2. Confirm the ENUM widened:
-- SHOW COLUMNS FROM leads LIKE 'lead_status';
-- -- Expect: enum('new','contacted','qualified','converted','lost','nurture','not_now','referred','case_study')
--
-- 3. Confirm call_log exists and is empty:
-- SELECT COUNT(*) FROM call_log;
-- -- Expect: 0
--
-- 4. After UI ships and you click into a lead, log a test call:
-- INSERT INTO call_log (lead_id, user_id, outcome, duration_seconds, notes)
--   VALUES ((SELECT id FROM leads LIMIT 1), 1, 'voicemail', 30, 'smoke test');
-- SELECT * FROM call_log ORDER BY call_log_id DESC LIMIT 1;
-- =====================================================================
-- END 019_sales_team_pain_lifecycle.sql
-- =====================================================================
