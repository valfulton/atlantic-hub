-- =====================================================================
-- Atlantic Hub — case_document_findings (#666 LLM doc reader)
-- val 2026-06-15
-- Target: shhdbite_AV
-- Run AFTER: schema/091_case_document_section_index.sql
-- =====================================================================
--
-- Structured findings produced by lib/case/document_reader.ts. Each row
-- is one anomaly / clause-conflict / risk flag the LLM identified after
-- reading an uploaded PDF (trust, will, POA, contract, deed, etc.).
--
-- The doc reader pipeline:
--   1. Fetch PDF bytes via getHotStorage('case-documents').getBytes()
--   2. Extract per-page text via unpdf (mergePages: false)
--   3. Pick a prompt template based on case_documents.document_kind
--   4. Call runLlm with task_kind 'document_read'
--   5. Parse the model's JSON output into rows here
--
-- Severity scale:
--   'urgent'  — material conflict that needs to be raised with the parents/principal
--   'high'    — drafting ambiguity that should be clarified
--   'normal'  — note worth flagging but not blocking
--   'info'    — observation, no action required
--
-- Re-run replaces (NOT appends) — we DELETE WHERE document_id = ? before
-- inserting a fresh batch, so the operator never sees stale findings
-- after Adriana uploads a revised PDF.
-- =====================================================================

USE shhdbite_AV;

CREATE TABLE IF NOT EXISTS case_document_findings (
  finding_id      BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  document_id     BIGINT UNSIGNED NOT NULL,
  case_id         BIGINT UNSIGNED NOT NULL,
  section_key     VARCHAR(64)     DEFAULT NULL
    COMMENT 'Canonical section ref like "5.A" or "6.G(2)" if the finding ties to a clause.',
  quote           TEXT            DEFAULT NULL
    COMMENT 'Verbatim sentence from the document supporting this finding.',
  oddity_type     VARCHAR(64)     DEFAULT NULL
    COMMENT 'Free-text category: clause_conflict / late_modification / ambiguous_signature / missing_field / unusual_term / etc.',
  severity        ENUM('urgent','high','normal','info') NOT NULL DEFAULT 'normal',
  page_number     INT UNSIGNED    DEFAULT NULL,
  llm_note        TEXT            DEFAULT NULL
    COMMENT 'Operator-facing analysis of WHY this is flagged (model output).',
  model_id        VARCHAR(128)    DEFAULT NULL
    COMMENT 'Which LLM produced the finding (for accountability + re-run diffs).',
  created_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (finding_id),
  KEY idx_cdf_document (document_id),
  KEY idx_cdf_case (case_id),
  KEY idx_cdf_severity (severity),
  CONSTRAINT fk_cdf_document FOREIGN KEY (document_id)
    REFERENCES case_documents (document_id) ON DELETE CASCADE,
  CONSTRAINT fk_cdf_case FOREIGN KEY (case_id)
    REFERENCES cases (case_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='LLM-produced findings per uploaded case document (#666).';

-- VERIFY:
--   SHOW CREATE TABLE case_document_findings;
--   SELECT COUNT(*) FROM case_document_findings;
-- =====================================================================
-- END 095_case_document_findings.sql
-- =====================================================================
