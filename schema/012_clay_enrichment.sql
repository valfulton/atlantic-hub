-- =====================================================================
-- Atlantic Hub -- Clay enrichment receiver audit log
-- File:    schema/012_clay_enrichment.sql
-- Target:  shhdbite_AV
-- Run in:  HostGator phpMyAdmin -> click shhdbite_AV in the sidebar so
--          the top bar reads "Database: shhdbite_AV" -> SQL tab ->
--          paste this entire file -> Go
-- =====================================================================
--
-- WHAT THIS DOES
--   Creates the audit trail for the Clay webhook receiver. One row per
--   incoming Clay POST so the operator can triage what landed, what was
--   inserted vs merged vs rejected, and replay payloads forensically.
--
--   The receiver itself writes leads into shhdbite_AV.leads via the
--   existing cross-source dedup (lib/leads/dedup.ts) -- this table is
--   purely the receipt log for the integration.
--
-- ORDER: ships after schema/011_grok_imagine.sql. Owns 012 per the
-- registry in docs/SESSION_COORDINATION.md.
--
-- IDEMPOTENT: information_schema guard + PREPARE/EXECUTE so it is safe
-- to re-run against an existing schema. Re-running is a no-op.
-- =====================================================================

USE shhdbite_AV;
SET NAMES utf8mb4;

-- ---------------------------------------------------------------------
-- 1. Create clay_enrichment_log (only if it does not exist).
-- ---------------------------------------------------------------------

SET @tbl_exists := (SELECT COUNT(*) FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = 'shhdbite_AV' AND TABLE_NAME = 'clay_enrichment_log');

SET @sql := IF(@tbl_exists = 0,
  "CREATE TABLE clay_enrichment_log (
     id             BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
     received_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
     clay_table_id  VARCHAR(128) NULL,
     clay_row_id    VARCHAR(128) NULL,
     lead_id        BIGINT UNSIGNED NULL,
     outcome        ENUM('inserted','updated','duplicate','invalid','error')
                    NOT NULL DEFAULT 'inserted',
     payload        JSON NULL,
     error_message  VARCHAR(500) NULL,
     KEY idx_clay_log_received (received_at),
     KEY idx_clay_log_outcome  (outcome),
     KEY idx_clay_log_lead     (lead_id),
     KEY idx_clay_log_table    (clay_table_id)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
  "SELECT 'clay_enrichment_log already exists' AS info");

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------------
-- 2. Verification (uncomment to run manually after the migration)
-- ---------------------------------------------------------------------
-- SHOW CREATE TABLE clay_enrichment_log\G
-- SELECT COUNT(*) AS rows_logged FROM clay_enrichment_log;
