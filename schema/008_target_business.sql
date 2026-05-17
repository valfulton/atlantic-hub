-- =====================================================================
-- Atlantic Hub — target_business + archive + cross-source dedup
-- File:    schema/008_target_business.sql
-- Target:  shhdbite_AV
-- Run in:  HostGator phpMyAdmin → shhdbite_AV → SQL tab
-- =====================================================================
--
-- WHAT THIS DOES
--   1. Adds target_business ENUM('av','ebw','both') to leads. This lets a
--      single lead row serve both the Atlantic & Vine pipeline (marketing
--      agency) and the Events by Water pipeline (boat-charter prospect)
--      without duplicating the record. Defaults to 'av'.
--
--   2. Backfills hospitality leads (restaurants, hotels-as-retreats,
--      wedding planners) to 'both' so the existing ones get the right
--      treatment immediately. Apollo discovery + future sources will set
--      this at insert time using the same heuristic in code
--      (lib/leads/target_business.ts).
--
--   3. Adds normalized_domain VARCHAR(255) — the dedup key shared across
--      ALL discovery sources (Apollo, Google Places, Instagram, manual,
--      contact-page scrape). Stores 'example.com' style (no protocol, no
--      www, no path). Indexed so dedup-on-insert is O(log n).
--
--   4. Backfills normalized_domain for existing rows using the website
--      column. Best-effort SQL string ops; new inserts compute it in code
--      via lib/leads/dedup.ts:normalizeDomain.
--
--   5. archived_at already exists on leads. This file just adds an index
--      for fast filter performance (the GET endpoint filters every load).
--
-- IDEMPOTENT-ISH: ALTER TABLE ADD COLUMN errors on re-run (MySQL has no
-- IF NOT EXISTS for columns prior to 8.0.x in HostGator's MariaDB build).
-- Comment out lines you've already run.
-- =====================================================================

USE shhdbite_AV;
SET NAMES utf8mb4;

-- ---------------------------------------------------------------------
-- 1. target_business — which pipeline this lead belongs to
-- ---------------------------------------------------------------------
ALTER TABLE leads
  ADD COLUMN target_business ENUM('av','ebw','both') NOT NULL DEFAULT 'av'
    AFTER source_type
    COMMENT 'Which business pipeline this lead serves. ''both'' means visible from /admin/av AND /admin/ebw — notes shared.';

ALTER TABLE leads
  ADD INDEX idx_target_business (target_business);

-- ---------------------------------------------------------------------
-- 2. Backfill hospitality leads to 'both'
--    Restaurants, hotels (mapped as corporate_retreat by Apollo normalizer),
--    and wedding planners all plausibly buy AV's marketing services AND
--    book Events by Water for events / corporate retreats.
-- ---------------------------------------------------------------------
UPDATE leads
SET target_business = 'both'
WHERE industry IN ('wedding_planner', 'restaurant', 'corporate_retreat')
   OR industry LIKE '%hotel%'
   OR industry LIKE '%resort%'
   OR industry LIKE '%hospitality%';

-- ---------------------------------------------------------------------
-- 3. normalized_domain — shared dedup key across all discovery sources
-- ---------------------------------------------------------------------
ALTER TABLE leads
  ADD COLUMN normalized_domain VARCHAR(255) DEFAULT NULL
    COMMENT 'Stripped of protocol/www/path. Cross-source dedup key. Computed by lib/leads/dedup.ts:normalizeDomain on insert.';

ALTER TABLE leads
  ADD INDEX idx_normalized_domain (normalized_domain);

-- Backfill existing rows from website column (best-effort string ops).
-- Handles: 'https://www.foo.com', 'http://foo.com/about', 'foo.com', 'www.foo.com'
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
-- 4. Ensure archived_at is indexed (the leads list filters on it every load)
--    Safe to re-run; the IF NOT EXISTS won't work on older MariaDB so we
--    use a procedural guard instead.
-- ---------------------------------------------------------------------
SET @idx_exists := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = 'shhdbite_AV'
    AND TABLE_NAME = 'leads'
    AND INDEX_NAME = 'idx_archived_at'
);
SET @sql := IF(@idx_exists = 0,
  'ALTER TABLE leads ADD INDEX idx_archived_at (archived_at)',
  'SELECT ''idx_archived_at already exists'' AS info');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------------
-- Verification — eyeball the result after running:
--   SELECT target_business, COUNT(*) FROM leads
--   WHERE archived_at IS NULL GROUP BY target_business;
--
--   SELECT normalized_domain, COUNT(*) c FROM leads
--   WHERE archived_at IS NULL AND normalized_domain IS NOT NULL
--   GROUP BY normalized_domain HAVING c > 1
--   ORDER BY c DESC;
--   -- ^ flags any pre-existing duplicates by domain. Archive losers manually.
-- ---------------------------------------------------------------------
