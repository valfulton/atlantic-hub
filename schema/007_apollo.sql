-- =====================================================================
-- Atlantic Hub — Apollo Search API integration
-- File:    schema/007_apollo.sql
-- Target:  shhdbite_AV
-- Run in:  HostGator phpMyAdmin → shhdbite_AV → SQL tab
-- =====================================================================
--
-- WHAT THIS DOES
--   - Adds apollo_person_id to leads (UNIQUE) for dedup across search runs.
--     Apollo gives each person a stable internal id; we record it so the
--     same Apollo contact never gets inserted twice.
--   - Creates apollo_search_log table for credit tracking + audit trail
--     (parallel to hunter_credit_log from migration 006).
--
-- IDEMPOTENT for the most part. ADD COLUMN will error if re-run on MySQL
-- without IF NOT EXISTS; CREATE TABLE uses IF NOT EXISTS.
-- =====================================================================

USE shhdbite_AV;
SET NAMES utf8mb4;

-- ---------------------------------------------------------------------
-- 1. apollo_person_id on leads (dedup key for Apollo-sourced leads)
-- ---------------------------------------------------------------------
ALTER TABLE leads
  ADD COLUMN apollo_person_id VARCHAR(100) DEFAULT NULL
    COMMENT 'Apollo internal id (people.id from mixed_people/search) — used to dedup repeat searches';

ALTER TABLE leads
  ADD UNIQUE KEY uq_apollo_person_id (apollo_person_id);

-- ---------------------------------------------------------------------
-- 2. apollo_search_log — one row per Apollo Search API call
-- ---------------------------------------------------------------------
-- Apollo's API charges credits per search call (typically 1 credit per
-- 25 people returned, but varies by plan). The discoverer checks this
-- table for the month-to-date count before running and refuses if over
-- the configured ceiling.
-- =====================================================================

CREATE TABLE IF NOT EXISTS apollo_search_log (
  search_log_id     BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  called_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  endpoint          VARCHAR(80) NOT NULL DEFAULT 'mixed_people/search',
  filter_payload    JSON NULL
    COMMENT 'Sanitized ICP filter the user submitted',
  results_count     INT UNSIGNED NOT NULL DEFAULT 0
    COMMENT 'Number of people returned by this call',
  inserted_count    INT UNSIGNED NOT NULL DEFAULT 0
    COMMENT 'Number of NEW leads written (dedup-aware)',
  credits_charged   SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  trigger_source    ENUM('manual','cron','test') NOT NULL DEFAULT 'manual',
  outcome           ENUM('success','no_results','error','rate_limited','quota_exceeded') NOT NULL DEFAULT 'success',
  actor_user_id     BIGINT UNSIGNED NULL,
  error_message     VARCHAR(500) NULL,
  KEY idx_called_at (called_at),
  KEY idx_outcome (outcome),
  KEY idx_trigger (trigger_source)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================================
-- VERIFICATION (paste each separately)
-- =====================================================================
-- 1. Confirm apollo_person_id is on leads:
-- SHOW COLUMNS FROM leads LIKE 'apollo_person_id';

-- 2. Confirm apollo_search_log exists and is empty:
-- SELECT COUNT(*) FROM apollo_search_log;

-- 3. Once discovery has run, see month-to-date credit usage:
-- SELECT COUNT(*) AS searches_this_month,
--        COALESCE(SUM(credits_charged), 0) AS credits_charged,
--        COALESCE(SUM(inserted_count), 0) AS new_leads_this_month
--   FROM apollo_search_log
--  WHERE YEAR(called_at) = YEAR(UTC_TIMESTAMP())
--    AND MONTH(called_at) = MONTH(UTC_TIMESTAMP());
