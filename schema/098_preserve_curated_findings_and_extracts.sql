-- =====================================================================
-- Atlantic Hub — preserve curated findings + extracts on re-scan
-- val 2026-06-15  (#673)
-- Target: shhdbite_AV
-- Run AFTER: schema/097_case_document_text_cache_and_extracts.sql
-- =====================================================================
--
-- Adds is_curated TINYINT(1) to both case_document_findings and
-- case_document_extracts. Set to 1 the moment any operator action
-- touches a row (edit content / change severity / flip visibility /
-- manual extract correction). On re-scan, document_reader's clear
-- step is changed to DELETE … WHERE is_curated = 0, so val's edits
-- are never overwritten by a fresh LLM run.
-- =====================================================================

USE shhdbite_AV;

ALTER TABLE case_document_findings
  ADD COLUMN is_curated TINYINT(1) NOT NULL DEFAULT 0
    COMMENT 'Set to 1 by any operator action (edit content / change severity / flip visibility). Re-runs of the LLM scanner never delete is_curated=1 rows.'
  AFTER visibility,
  ADD KEY idx_cdf_curated (is_curated);

ALTER TABLE case_document_extracts
  ADD COLUMN is_curated TINYINT(1) NOT NULL DEFAULT 0
    COMMENT 'Set to 1 by any operator action. Re-runs of the LLM scanner never delete is_curated=1 rows.'
  AFTER value,
  ADD KEY idx_cde_curated (is_curated);

-- VERIFY:
--   SHOW CREATE TABLE case_document_findings;
--   SHOW CREATE TABLE case_document_extracts;
-- =====================================================================
