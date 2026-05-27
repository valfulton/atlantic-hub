-- =====================================================================
-- Atlantic Hub -- Multi-lens lead audits (no-drift). A lead can hold MANY
-- audits/call-scripts, one per SELLER lens, so reassigning or re-scoring for one
-- seller never overwrites another's.
-- File:    schema/056_lead_audits.sql
-- Target:  shhdbite_AV
-- Run in:  HostGator phpMyAdmin -> shhdbite_AV -> SQL tab -> paste -> Go
-- =====================================================================
--
-- lens = WHO is selling to this prospect:
--   'av'  -> Atlantic & Vine's own marketing audit
--   'ebw' -> Events by Water pitch
--   'client:<id>' -> a client selling THEIR offer (e.g. client:4 = Skip/EHP)
--
-- Each (lead_id, lens) keeps its own audit_content + pain_point_profile + score.
-- The leads.audit_content / pain_point_profile columns stay as the "current" view
-- for back-compat; this table is the durable per-lens history that prevents drift.
--
-- The backfill at the bottom copies every existing audit into its current lens so
-- nothing accumulated is lost.
-- =====================================================================

USE shhdbite_AV;
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS lead_audits (
  lead_audit_id      BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  lead_id            INT NOT NULL,
  lens               VARCHAR(40) NOT NULL COMMENT 'av | ebw | hh | client:<id>',
  audit_content      MEDIUMTEXT NULL,
  pain_point_profile JSON NULL,
  ai_score           INT NULL,
  ai_score_band      VARCHAR(10) NULL,
  generated_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_lead_lens (lead_id, lens),
  KEY idx_lead (lead_id),
  CONSTRAINT fk_lead_audits_lead FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- BACKFILL: preserve every existing audit as its CURRENT lens, so the work
-- already accumulated carries into the new per-lens model. INSERT IGNORE so
-- re-running is safe (the unique key skips rows already present).
-- ---------------------------------------------------------------------
INSERT IGNORE INTO lead_audits
  (lead_id, lens, audit_content, pain_point_profile, ai_score, ai_score_band, generated_at)
SELECT id,
       CASE WHEN client_id IS NOT NULL THEN CONCAT('client:', client_id) ELSE 'av' END AS lens,
       audit_content, pain_point_profile, ai_score, ai_score_band,
       COALESCE(audit_generated, NOW())
FROM leads
WHERE audit_content IS NOT NULL AND archived_at IS NULL;

-- VERIFY:
--   SELECT lead_id, lens, LEFT(audit_content,60), generated_at FROM lead_audits ORDER BY lead_id;
-- =====================================================================
-- END 056_lead_audits.sql
-- =====================================================================
