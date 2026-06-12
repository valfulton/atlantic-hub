-- =====================================================================
-- Atlantic Hub -- case_documents: add section_index for PDF deep-linking
-- File:    schema/091_case_document_section_index.sql
-- Target:  shhdbite_AV
-- Run in:  HostGator phpMyAdmin -> shhdbite_AV -> SQL tab -> paste -> Go
-- =====================================================================
--
-- WHY: When a trust / will / POA PDF is uploaded, we scan the page text
-- once and store {sectionKey: pageNumber} so that any time we render an
-- action item or synopsis that mentions e.g. "§6.G(2)", that token can
-- render as a clickable link straight into page 12 of the PDF.
--
-- Section keys: normalized form like "5.A", "5.C(1)", "6.G(2)", "2.C".
-- Page numbers: 1-indexed (PDF.js convention used by ?#page= anchor).
--
-- IDEMPOTENT via information_schema guard (058/085/089 style).
-- =====================================================================

USE shhdbite_AV;
SET NAMES utf8mb4;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA='shhdbite_AV'
    AND TABLE_NAME='case_documents'
    AND COLUMN_NAME='section_index');
SET @sql := IF(@c=0,
  "ALTER TABLE case_documents
     ADD COLUMN section_index JSON NULL
       COMMENT '{sectionKey: pageNumber} map built once at upload via pdfjs-dist scan. NULL until indexed; empty {} after scan with no hits. (val 2026-06-12)'
     AFTER notes",
  "SELECT 'case_documents.section_index already exists -- skipped' AS info");
PREPARE s FROM @sql;
EXECUTE s;
DEALLOCATE PREPARE s;

-- VERIFY:
--   SELECT COLUMN_NAME, COLUMN_TYPE, COLUMN_COMMENT
--     FROM information_schema.COLUMNS
--    WHERE TABLE_SCHEMA='shhdbite_AV' AND TABLE_NAME='case_documents'
--      AND COLUMN_NAME='section_index';
--
-- ROLLBACK (only if needed):
--   ALTER TABLE case_documents DROP COLUMN section_index;
-- =====================================================================
