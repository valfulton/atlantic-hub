-- =====================================================================
-- Atlantic Hub — case_documents.extracted_text + case_document_extracts
-- val 2026-06-15
-- Target: shhdbite_AV
-- Run AFTER: schema/096_case_document_findings_visibility.sql
-- =====================================================================
--
-- Two related changes:
--
-- 1) case_documents.extracted_text — caches the full per-page text we
--    pull out with unpdf the first time anyone runs the LLM scanner on a
--    document. With this in place, every later operation (re-scan,
--    party-extraction, search, future AI sessions) reads from MySQL
--    instead of re-parsing the PDF — and surfaces the text to chat so
--    val and I can grep the trust without needing a working PDF
--    renderer in the sandbox.
--
-- 2) case_document_extracts — structured metadata pulled from the
--    document: parties, addresses, contacts, attorney/firm info, dates,
--    bar numbers. Distinct from case_document_findings (which is the
--    oddity scanner). One table, free-form (kind, label, value, page,
--    note) so we don't pre-shape every possible extraction.
-- =====================================================================

USE shhdbite_AV;

-- (1) Per-document extracted text cache
ALTER TABLE case_documents
  ADD COLUMN extracted_text        LONGTEXT     DEFAULT NULL
    COMMENT 'Full per-page text from unpdf, separated by \\n\\n--- PAGE N ---\\n\\n. Populated by document_reader on first scan, refreshed on re-scan after content_hash changes.'
  AFTER section_index,
  ADD COLUMN extracted_at          TIMESTAMP    NULL DEFAULT NULL
    COMMENT 'When extracted_text was last populated.'
  AFTER extracted_text,
  ADD COLUMN extracted_page_count  INT UNSIGNED DEFAULT NULL
    COMMENT 'Number of pages extracted (for quick UI sanity check).'
  AFTER extracted_at;

-- (2) Structured metadata extractions
CREATE TABLE IF NOT EXISTS case_document_extracts (
  extract_id      BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  document_id     BIGINT UNSIGNED NOT NULL,
  case_id         BIGINT UNSIGNED NOT NULL,
  kind            VARCHAR(48)     NOT NULL
    COMMENT 'party | address | contact | attorney | firm | date | bar_number | other',
  label           VARCHAR(128)    DEFAULT NULL
    COMMENT 'What this is — e.g. "Drafting Attorney", "Trustor 1", "Successor Trustee", "Firm Address".',
  value           TEXT            DEFAULT NULL
    COMMENT 'The extracted value (name, address, phone, etc).',
  page_number     INT UNSIGNED    DEFAULT NULL,
  note            TEXT            DEFAULT NULL
    COMMENT 'Free-form note from the extractor (e.g. "appears in signature block; phone not present").',
  model_id        VARCHAR(128)    DEFAULT NULL,
  created_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (extract_id),
  KEY idx_cde_document (document_id),
  KEY idx_cde_case (case_id),
  KEY idx_cde_kind (kind),
  CONSTRAINT fk_cde_document FOREIGN KEY (document_id)
    REFERENCES case_documents (document_id) ON DELETE CASCADE,
  CONSTRAINT fk_cde_case FOREIGN KEY (case_id)
    REFERENCES cases (case_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Structured metadata pulled from case documents — parties, contacts, attorney info. Parallel to findings.';

-- VERIFY:
--   SHOW CREATE TABLE case_documents;
--   SHOW CREATE TABLE case_document_extracts;
-- =====================================================================
