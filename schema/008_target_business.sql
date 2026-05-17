-- =====================================================================
-- Atlantic Hub — target_business + archive + cross-source dedup
-- File:    schema/008_target_business.sql
-- Target:  shhdbite_AV
-- Run in:  HostGator phpMyAdmin → shhdbite_AV → SQL tab → paste → Go
-- =====================================================================
--
-- IDEMPOTENT: safe to re-run. Every ALTER is guarded by an
-- information_schema check, so if a column or index already exists from
-- a previous attempt the migration just skips that step and moves on.
-- =====================================================================

USE shhdbite_AV;
SET NAMES utf8mb4;

-- ---------------------------------------------------------------------
-- 1. target_business — which pipeline this lead belongs to
-- ---------------------------------------------------------------------
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = 'shhdbite_AV' AND TABLE_NAME = 'leads' AND COLUMN_NAME = 'target_business'
);
SET @sql := IF(@col_exists = 0,
  "ALTER TABLE leads ADD COLUMN target_business ENUM('av','ebw','both') NOT NULL DEFAULT 'av' AFTER source_type",
  "SELECT 'target_business column already exists — skipped' AS info");
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx_exists := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = 'shhdbite_AV' AND TABLE_NAME = 'leads' AND INDEX_NAME = 'idx_target_business'
);
SET @sql := IF(@idx_exists = 0,
  "ALTER TABLE leads ADD INDEX idx_target_business (target_business)",
  "SELECT 'idx_target_business already exists — skipped' AS info");
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------------
-- 2. Backfill hospitality leads to 'both'
--    Restaurants, hotels (mapped as corporate_retreat by Apollo normalizer),
--    and wedding planners all plausibly buy AV's marketing services AND
--    book Events by Water for events / corporate retreats.
--    Re-running this is safe — UPDATE … WHERE is naturally idempotent.
-- ---------------------------------------------------------------------
UPDATE leads
SET target_business = 'both'
WHERE target_business = 'av'
  AND (
    industry IN ('wedding_planner', 'restaurant', 'corporate_retreat')
    OR industry LIKE '%hotel%'
    OR industry LIKE '%resort%'
    OR industry LIKE '%hospitality%'
  );

-- ---------------------------------------------------------------------
-- 3. normalized_domain — shared dedup key across all discovery sources
-- ---------------------------------------------------------------------
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = 'shhdbite_AV' AND TABLE_NAME = 'leads' AND COLUMN_NAME = 'normalized_domain'
);
SET @sql := IF(@col_exists = 0,
  "ALTER TABLE leads ADD COLUMN normalized_domain VARCHAR(255) DEFAULT NULL COMMENT 'Cross-source dedup key. Stripped of protocol/www/path.'",
  "SELECT 'normalized_domain column already exists — skipped' AS info");
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx_exists := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = 'shhdbite_AV' AND TABLE_NAME = 'leads' AND INDEX_NAME = 'idx_normalized_domain'
);
SET @sql := IF(@idx_exists = 0,
  "ALTER TABLE leads ADD INDEX idx_normalized_domain (normalized_domain)",
  "SELECT 'idx_normalized_domain already exists — skipped' AS info");
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Backfill existing rows from website column. Only touches rows where
-- normalized_domain is currently NULL — re-running this is safe.
UPDATE leads
SET normalized_domain = LOWER(
  TRIM(TRAILING '/' FROM
    SUBSTRING_INDEX(
      SUBSTRING_INDEX(
        REPLACE(REPLACE(REPLACE(website, 'https://', ''), 'http://', ''), 'www.', ''),
        '/', 1
      ),
      '?', 1
    )
  )
)
WHERE website IS NOT NULL AND website != '' AND normalized_domain IS NULL;

-- ---------------------------------------------------------------------
-- 4. archived_at index (the leads list filters on it every load)
-- ---------------------------------------------------------------------
SET @idx_exists := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = 'shhdbite_AV' AND TABLE_NAME = 'leads' AND INDEX_NAME = 'idx_archived_at'
);
SET @sql := IF(@idx_exists = 0,
  "ALTER TABLE leads ADD INDEX idx_archived_at (archived_at)",
  "SELECT 'idx_archived_at already exists — skipped' AS info");
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------------
-- 5. archived_at column itself (if a fresh DB without prior migrations)
--    Skips if already exists.
-- ---------------------------------------------------------------------
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = 'shhdbite_AV' AND TABLE_NAME = 'leads' AND COLUMN_NAME = 'archived_at'
);
SET @sql := IF(@col_exists = 0,
  "ALTER TABLE leads ADD COLUMN archived_at DATETIME NULL DEFAULT NULL COMMENT 'Soft-delete timestamp. Filter `WHERE archived_at IS NULL` to hide.'",
  "SELECT 'archived_at column already exists — skipped' AS info");
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------------
-- Verification — eyeball after running:
--   SELECT target_business, COUNT(*) FROM leads
--   WHERE archived_at IS NULL GROUP BY target_business;
--
--   SELECT normalized_domain, COUNT(*) c FROM leads
--   WHERE archived_at IS NULL AND normalized_domain IS NOT NULL
--   GROUP BY normalized_domain HAVING c > 1
--   ORDER BY c DESC;
-- ---------------------------------------------------------------------
