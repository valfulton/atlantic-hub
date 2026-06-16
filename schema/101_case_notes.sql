-- =====================================================================
-- Atlantic Hub -- case_notes: standalone reviewer ↔ family messages
-- File:    schema/101_case_notes.sql
-- Target:  shhdbite_AV
-- Run in:  HostGator phpMyAdmin -> shhdbite_AV -> SQL tab -> paste -> Go
-- =====================================================================
--
-- WHY: val 2026-06-15. Adriana wrote "Dear Gordon and Angelina..." in
-- case_documents.approval_note because that was the only writable note
-- surface she could find. approval_note was designed for short "why I
-- sent this back" reasons, not open letters to the family. The system
-- needs a first-class notes channel.
--
-- WHAT THIS ADDS:
--   case_notes -- standalone notes tied to a case, addressed to a
--   specific audience (family / legal_team / operator_only). Anyone with
--   case access can write (operator + client_user collaborators). Notes
--   are pinnable, soft-deletable, editable by author or operator.
--
-- BACKFILL: a separate SQL block at the bottom copies existing
-- approval_notes from APPROVED docs into case_notes as 'family' audience
-- notes (preserving timestamp + author). Adriana's existing letter to
-- Gordon and Maria on Option E carries over automatically.
--
-- Universal across case_kinds. IDEMPOTENT: information_schema guard.
-- =====================================================================

USE shhdbite_AV;
SET NAMES utf8mb4;

-- ---------------------------------------------------------------------
-- 1. case_notes table
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS case_notes (
  note_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  case_id BIGINT UNSIGNED NOT NULL,
  body TEXT NOT NULL,
  author_user_id BIGINT UNSIGNED NULL
    COMMENT 'client_users.client_user_id (collaborator) OR admin_users.user_id (operator). Role disambiguates.',
  author_role VARCHAR(20) NOT NULL
    COMMENT 'owner / staff / client_user',
  author_display_name VARCHAR(200)
    COMMENT 'Snapshot at write time; survives user rename.',
  audience VARCHAR(20) NOT NULL DEFAULT 'family'
    COMMENT 'family / legal_team / operator_only — drives visibility filter on render.',
  pinned BOOLEAN NOT NULL DEFAULT FALSE
    COMMENT 'Adriana can pin a note to keep it at top regardless of recency.',
  archived_at DATETIME NULL
    COMMENT 'Soft delete: archived notes hidden from default render but kept for audit.',
  source VARCHAR(40) NULL
    COMMENT 'How the note was created: manual / from_approval_note (backfill) / etc.',
  source_document_id BIGINT UNSIGNED NULL
    COMMENT 'When backfilled from a doc approval_note, link to the source doc.',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_case_notes_case_pinned_created (case_id, archived_at, pinned DESC, created_at DESC),
  KEY idx_case_notes_audience (case_id, audience),
  CONSTRAINT fk_case_notes_case FOREIGN KEY (case_id)
    REFERENCES cases(case_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  COMMENT='Standalone case-level notes. Replaces approval_note hack as Adriana''s family-messaging channel. (val 2026-06-15)';

-- ---------------------------------------------------------------------
-- 2. Backfill from existing approval_notes on approved documents
--    IDEMPOTENT — skips rows already migrated (source_document_id match).
-- ---------------------------------------------------------------------
INSERT INTO case_notes
  (case_id, body, author_user_id, author_role, author_display_name,
   audience, source, source_document_id, created_at)
SELECT
  d.case_id,
  d.approval_note,
  d.approved_by_user_id,
  'client_user' AS author_role,
  -- Look up reviewer name from client_users where possible
  (SELECT cu.display_name FROM client_users cu
    WHERE cu.client_user_id = d.approved_by_user_id LIMIT 1) AS author_display_name,
  'family' AS audience,
  'from_approval_note' AS source,
  d.document_id,
  COALESCE(d.approved_at, d.uploaded_at) AS created_at
FROM case_documents d
WHERE d.approval_status = 'approved'
  AND d.approval_note IS NOT NULL
  AND TRIM(d.approval_note) <> ''
  AND NOT EXISTS (
    SELECT 1 FROM case_notes cn
     WHERE cn.source = 'from_approval_note'
       AND cn.source_document_id = d.document_id
  );
