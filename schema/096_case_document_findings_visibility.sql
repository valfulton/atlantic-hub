-- =====================================================================
-- Atlantic Hub — case_document_findings.visibility (val 2026-06-15)
-- Target: shhdbite_AV
-- Run AFTER: schema/095_case_document_findings.sql
-- =====================================================================
--
-- Per-finding visibility gate. New rows land as 'operator_only' so the
-- LLM scan stays inside the hub until val (or Adriana) chooses to
-- surface a finding to the family.
--
-- Follows the same pattern as case_action_items.visibility ('parents_safe'
-- vs 'operator_only') so the family-side rendering uses the same posture.
-- =====================================================================

USE shhdbite_AV;

ALTER TABLE case_document_findings
  ADD COLUMN visibility ENUM('operator_only','family_visible') NOT NULL DEFAULT 'operator_only'
    COMMENT 'family_visible surfaces to Rebecca / parents / Adriana via FamilyFindingsPanel; operator_only stays in the operator panel.'
  AFTER severity;

-- VERIFY:
--   SHOW CREATE TABLE case_document_findings;
--   SELECT finding_id, severity, visibility FROM case_document_findings;
-- =====================================================================
