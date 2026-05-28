-- =====================================================================
-- 059_lead_address_and_website_status.sql
--
-- Surface buried address data + flag fake websites (#180 + #195).
--
-- Background:
--   Clay, Apollo, and Google Places all CAPTURE address data per lead.
--   • Clay: payload.location (city + state string)
--   • Apollo: apollo_location (constructed but NOT persisted today)
--   • Google Places: formatted_address (full street, in source_payload)
--   None of it is queryable today — it's buried in source_payload JSON,
--   nothing reads it, and the lead card renders no address.
--
--   Meanwhile some leads carry placeholder website strings
--   (clay+row@eventsbywater.com.placeholder, apollo synthetic domains)
--   that 404 in production — and the scorer treats them as a positive
--   signal. They shouldn't.
--
-- This migration is ADDITIVE only — no existing columns change, no
-- behavior changes until app code reads the new columns. Safe to run
-- before pushing the code changes.
--
-- Run in phpMyAdmin against shhdbite_AV. Re-runnable (uses IF NOT
-- EXISTS via information_schema guards).
-- =====================================================================

USE shhdbite_AV;

-- ─── Address columns ────────────────────────────────────────────────
-- 5 structured fields, all NULLable, all safe defaults. Country defaults
-- to NULL so we can tell "we don't know" from "we know it's blank".

SET @i := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA='shhdbite_AV' AND TABLE_NAME='leads' AND COLUMN_NAME='address_street');
SET @sql := IF(@i=0,
  "ALTER TABLE leads ADD COLUMN address_street VARCHAR(500) NULL COMMENT 'Street address or full formatted address; first-pass single field.'",
  "SELECT 'leads.address_street exists — skipped' AS info");
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @i := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA='shhdbite_AV' AND TABLE_NAME='leads' AND COLUMN_NAME='address_city');
SET @sql := IF(@i=0,
  "ALTER TABLE leads ADD COLUMN address_city VARCHAR(100) NULL",
  "SELECT 'leads.address_city exists — skipped' AS info");
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @i := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA='shhdbite_AV' AND TABLE_NAME='leads' AND COLUMN_NAME='address_state');
SET @sql := IF(@i=0,
  "ALTER TABLE leads ADD COLUMN address_state VARCHAR(80) NULL",
  "SELECT 'leads.address_state exists — skipped' AS info");
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @i := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA='shhdbite_AV' AND TABLE_NAME='leads' AND COLUMN_NAME='address_postal');
SET @sql := IF(@i=0,
  "ALTER TABLE leads ADD COLUMN address_postal VARCHAR(20) NULL",
  "SELECT 'leads.address_postal exists — skipped' AS info");
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @i := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA='shhdbite_AV' AND TABLE_NAME='leads' AND COLUMN_NAME='address_country');
SET @sql := IF(@i=0,
  "ALTER TABLE leads ADD COLUMN address_country VARCHAR(60) NULL",
  "SELECT 'leads.address_country exists — skipped' AS info");
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ─── Website data-quality flag ──────────────────────────────────────
-- 'unknown'     – default, no check yet
-- 'valid'       – url shape is real and not a known placeholder
-- 'placeholder' – matches a known placeholder pattern (clay+/apollo synthetic)
-- 'dead'        – HEAD request returned 4xx/5xx (set by future cron #195)

SET @i := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA='shhdbite_AV' AND TABLE_NAME='leads' AND COLUMN_NAME='website_status');
SET @sql := IF(@i=0,
  "ALTER TABLE leads ADD COLUMN website_status ENUM('unknown','valid','placeholder','dead') NOT NULL DEFAULT 'unknown' COMMENT 'Data-quality flag for the website column; scoring should penalize placeholder/dead.'",
  "SELECT 'leads.website_status exists — skipped' AS info");
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ─── Indexes ────────────────────────────────────────────────────────
-- Filter by status (cheap) and by city/state for "leads in Florida" style
-- queries val will eventually want.

SET @i := (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA='shhdbite_AV' AND TABLE_NAME='leads' AND INDEX_NAME='idx_leads_website_status');
SET @sql := IF(@i=0,
  "ALTER TABLE leads ADD INDEX idx_leads_website_status (website_status)",
  "SELECT 'idx_leads_website_status exists — skipped' AS info");
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @i := (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA='shhdbite_AV' AND TABLE_NAME='leads' AND INDEX_NAME='idx_leads_city_state');
SET @sql := IF(@i=0,
  "ALTER TABLE leads ADD INDEX idx_leads_city_state (address_city, address_state)",
  "SELECT 'idx_leads_city_state exists — skipped' AS info");
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ─── Verify ─────────────────────────────────────────────────────────
SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, COLUMN_COMMENT
  FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA='shhdbite_AV' AND TABLE_NAME='leads'
   AND COLUMN_NAME IN
     ('address_street','address_city','address_state','address_postal','address_country','website_status')
 ORDER BY ORDINAL_POSITION;

-- =====================================================================
-- END 059_lead_address_and_website_status.sql
-- Next step: run 059_backfill_address_from_source_payload.sql to populate
-- the new columns from JSON data we already captured.
-- =====================================================================
