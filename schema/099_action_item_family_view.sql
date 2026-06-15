-- =====================================================================
-- Atlantic Hub -- Action items: family view (acknowledge + bucket + next-step)
-- File:    schema/099_action_item_family_view.sql
-- Target:  shhdbite_AV
-- Run in:  HostGator phpMyAdmin -> shhdbite_AV -> SQL tab -> paste -> Go
-- =====================================================================
--
-- WHY: val 2026-06-15. Johnson family Outstanding items list reads as
-- 19 URGENT items with no path forward. Parents freeze. This adds the
-- three pieces that turn "huge mess they cant fix" into "manageable
-- and tracked":
--
--   1. family_next_step  -- one plain-English sentence per item that
--                           tells the family WHAT IS BEING DONE about
--                           this, not what the legal analysis says.
--                           Renders ABOVE the detail body on the
--                           family case view.
--
--   2. family_bucket     -- which group the item belongs to on the
--                           family view:
--                             'reviewer_handling' = Adriana is on it
--                             'family_decision'   = mom & dad choose
--                             'info_only'         = read when you can
--                           Drives the three top-level groups on the
--                           family Outstanding items section.
--
--   3. family_acknowledged_at + family_acknowledged_by_user_id
--                        -- a parent/Rebecca can tap "Got it" on an
--                           item; we record who + when. The progress
--                           strip at the top reads "5 of 19 understood"
--                           which gives parents the satisfaction signal
--                           that the work is moving even when they
--                           themselves haven't had to DO anything.
--
-- Universal: works for any case_kind. Default family_bucket =
-- 'reviewer_handling' since most items will be operator-handled.
--
-- IDEMPOTENT: information_schema guards in 058/085/089/098 house style.
-- =====================================================================

USE shhdbite_AV;
SET NAMES utf8mb4;

-- ---------------------------------------------------------------------
-- 1. family_next_step -- the plain-English action sentence
-- ---------------------------------------------------------------------
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA='shhdbite_AV'
    AND TABLE_NAME='case_action_items'
    AND COLUMN_NAME='family_next_step');
SET @sql := IF(@c=0,
  "ALTER TABLE case_action_items
     ADD COLUMN family_next_step TEXT NULL
       COMMENT 'One-line plain-English status the family sees ABOVE the legal detail. Example: Adriana is preparing a 17200 petition. (val 2026-06-15)'",
  "SELECT 'case_action_items.family_next_step already exists -- skipped' AS info");
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ---------------------------------------------------------------------
-- 2. family_bucket -- which group on the family view
-- ---------------------------------------------------------------------
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA='shhdbite_AV'
    AND TABLE_NAME='case_action_items'
    AND COLUMN_NAME='family_bucket');
SET @sql := IF(@c=0,
  "ALTER TABLE case_action_items
     ADD COLUMN family_bucket ENUM('reviewer_handling','family_decision','info_only')
       NOT NULL DEFAULT 'reviewer_handling'
       COMMENT 'Group on the family Outstanding items section. reviewer_handling = Adriana on it; family_decision = mom & dad choose; info_only = read when you can. (val 2026-06-15)'",
  "SELECT 'case_action_items.family_bucket already exists -- skipped' AS info");
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ---------------------------------------------------------------------
-- 3. family_acknowledged_at -- when a family member tapped Got it
-- ---------------------------------------------------------------------
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA='shhdbite_AV'
    AND TABLE_NAME='case_action_items'
    AND COLUMN_NAME='family_acknowledged_at');
SET @sql := IF(@c=0,
  "ALTER TABLE case_action_items
     ADD COLUMN family_acknowledged_at DATETIME NULL
       COMMENT 'NULL = no family member has tapped Got it. Set on first tap. (val 2026-06-15)'",
  "SELECT 'case_action_items.family_acknowledged_at already exists -- skipped' AS info");
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ---------------------------------------------------------------------
-- 4. family_acknowledged_by_user_id -- who tapped Got it
-- ---------------------------------------------------------------------
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA='shhdbite_AV'
    AND TABLE_NAME='case_action_items'
    AND COLUMN_NAME='family_acknowledged_by_user_id');
SET @sql := IF(@c=0,
  "ALTER TABLE case_action_items
     ADD COLUMN family_acknowledged_by_user_id BIGINT UNSIGNED NULL
       COMMENT 'client_user_id of the family member who tapped Got it (Rebecca / Gordon / Maria / Adriana). (val 2026-06-15)'",
  "SELECT 'case_action_items.family_acknowledged_by_user_id already exists -- skipped' AS info");
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ---------------------------------------------------------------------
-- 5. Index on family_bucket + status so the family render can group
--    and count quickly without a table scan.
-- ---------------------------------------------------------------------
SET @c := (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA='shhdbite_AV'
    AND TABLE_NAME='case_action_items'
    AND INDEX_NAME='idx_case_actions_case_bucket_status');
SET @sql := IF(@c=0,
  "ALTER TABLE case_action_items
     ADD KEY idx_case_actions_case_bucket_status (case_id, family_bucket, status)",
  "SELECT 'idx_case_actions_case_bucket_status already exists -- skipped' AS info");
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
