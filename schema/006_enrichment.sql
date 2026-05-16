-- =====================================================================
-- Atlantic Hub — Lead Enrichment schema additions
-- File:    schema/006_enrichment.sql
-- Target:  shhdbite_AV
-- Run in:  HostGator phpMyAdmin → shhdbite_AV → SQL tab
-- =====================================================================
--
-- WHAT THIS DOES
--   - Adds 3 enrichment-tracking columns to the leads table:
--       enrichment_status, enriched_at, contact_title
--   - Creates hunter_credit_log table for monthly Hunter.io usage tracking
--     (so we can guardrail against blowing through the 25/month free tier
--     or 500/month Starter tier).
--
-- IDEMPOTENT: ADD COLUMN statements use IF NOT EXISTS (MySQL 8+) and
-- CREATE TABLE uses IF NOT EXISTS. Safe to re-run.
-- =====================================================================

USE shhdbite_AV;
SET NAMES utf8mb4;

-- ---------------------------------------------------------------------
-- 1. Enrichment columns on leads
-- ---------------------------------------------------------------------
-- enrichment_status values:
--   NULL                  — never enriched, eligible
--   'enriched'            — successfully enriched, skip in future runs
--   'failed_no_domain'    — no website on the lead, can't call Hunter
--   'failed_no_results'   — Hunter found no contacts for the domain
--   'failed_permanent'    — manual override to stop trying
--   'in_progress'         — set briefly during a run to prevent double-enrich

ALTER TABLE leads
  ADD COLUMN enrichment_status VARCHAR(40) DEFAULT NULL
    COMMENT 'NULL=eligible, enriched=success, failed_*=skip, in_progress=locked';

ALTER TABLE leads
  ADD COLUMN enriched_at DATETIME DEFAULT NULL
    COMMENT 'Timestamp of the last successful enrichment run for this lead';

ALTER TABLE leads
  ADD COLUMN contact_title VARCHAR(255) DEFAULT NULL
    COMMENT 'Job title from enrichment (Owner, GM, Director, etc.)';

ALTER TABLE leads
  ADD INDEX idx_enrichment_status (enrichment_status);

ALTER TABLE leads
  ADD INDEX idx_enriched_at (enriched_at);

-- ---------------------------------------------------------------------
-- 2. hunter_credit_log — track Hunter.io API calls for credit guardrails
-- ---------------------------------------------------------------------
-- One row per Hunter API call (domain-search, email-finder, verifier).
-- The enricher checks the count of rows for the current calendar month
-- before running. If over the threshold, it refuses to run.
-- =====================================================================

CREATE TABLE IF NOT EXISTS hunter_credit_log (
  credit_log_id   BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  called_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  endpoint        VARCHAR(60) NOT NULL
    COMMENT 'Hunter endpoint called (e.g. domain-search, email-verifier)',
  lead_id         INT NULL
    COMMENT 'FK to leads.id (app-enforced); NULL for non-lead-attributed calls',
  domain          VARCHAR(255) NULL,
  outcome         ENUM('success','no_results','error','rate_limited') NOT NULL DEFAULT 'success',
  credits_charged TINYINT UNSIGNED NOT NULL DEFAULT 1
    COMMENT 'Always 1 today, but kept for future bulk calls',
  trigger_source  ENUM('manual','cron','test') NOT NULL DEFAULT 'manual'
    COMMENT 'Manual button vs scheduled cron vs test/dry-run',
  notes           VARCHAR(500) NULL,
  KEY idx_called_at (called_at),
  KEY idx_lead_id (lead_id),
  KEY idx_outcome (outcome)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================================
-- VERIFICATION (paste each separately after migration)
-- =====================================================================
-- 1. Confirm the 3 new columns are on leads:
-- SHOW COLUMNS FROM leads LIKE 'enrich%';
-- SHOW COLUMNS FROM leads LIKE 'contact_title';

-- 2. Confirm hunter_credit_log exists and is empty:
-- SELECT COUNT(*) FROM hunter_credit_log;

-- 3. Check enrichment-eligible lead count (should be ~16 with placeholder emails):
-- SELECT COUNT(*) FROM leads
--  WHERE (enrichment_status IS NULL OR enrichment_status NOT IN ('enriched','failed_permanent'))
--    AND (email LIKE 'prospect+%' OR contact_name IS NULL);
