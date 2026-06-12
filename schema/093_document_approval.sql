-- =====================================================================
-- 093_document_approval.sql  (val 2026-06-12)
--
-- Document approval workflow for case_documents — the "pass-through docs
-- ready for Adriana to approve and for clients to download" pattern val
-- asked for on the Johnson Family case.
--
-- Flow:
--   1. val (operator) uploads a draft document (e.g. Option B amendment).
--      approval_status defaults to 'draft' on NEW uploads.
--   2. val clicks "Send for review" → status flips to 'pending_review'.
--   3. Adriana (collaborator with case access) sees it in her queue and
--      either approves or rejects with a note.
--   4. On approve → status='approved'. Primary clients (Mrs. Johnson,
--      Rebecca) see a Download button only on 'approved' docs.
--
-- attached_to_action_id (NEW) links a document to a specific action item
-- (e.g. the Cecilia removal options). When set, the doc surfaces on the
-- action detail page AND the case doc vault; otherwise it lives only in
-- the case-wide vault.
--
-- BACKFILL: existing rows default to approval_status='approved' so old
-- uploads (trust PDF, property report) keep rendering for everyone. New
-- code paths set status='draft' explicitly when uploading.
-- =====================================================================

ALTER TABLE case_documents
  ADD COLUMN approval_status VARCHAR(20) NOT NULL DEFAULT 'approved'
    COMMENT 'draft / pending_review / approved / rejected — clients only see approved.',
  ADD COLUMN approved_by_user_id BIGINT UNSIGNED NULL
    COMMENT 'client_users.client_user_id of the collaborator (typically attorney) who approved/rejected.',
  ADD COLUMN approved_at DATETIME NULL,
  ADD COLUMN approval_note TEXT
    COMMENT 'Adriana''s note on approve/reject (e.g. "draft ready to sign" or "needs §5.B clarification").',
  ADD COLUMN attached_to_action_id BIGINT UNSIGNED NULL
    COMMENT 'When set, document is linked to a specific case_action_item (e.g. an option-amendment draft on the Cecilia-removal action).',
  ADD KEY idx_case_documents_status (case_id, approval_status),
  ADD KEY idx_case_documents_action (attached_to_action_id),
  ADD CONSTRAINT fk_case_documents_action FOREIGN KEY (attached_to_action_id)
    REFERENCES case_action_items(action_id) ON DELETE SET NULL;

-- Belt-and-suspenders: ensure pre-existing rows are explicitly 'approved'
-- (the column default already covers this, but be explicit for any rows
-- whose ALTER ran in a different order). The Johnson trust PDF + property
-- report are pre-existing, and we don't want them to disappear from
-- Mrs. Johnson's view just because the column got added.
UPDATE case_documents
   SET approval_status = 'approved'
 WHERE approval_status IS NULL OR approval_status = '';

-- =====================================================================
-- VERIFY:
--   SHOW COLUMNS FROM case_documents LIKE 'approval%';
--   SHOW COLUMNS FROM case_documents LIKE 'attached_to_action_id';
--   SELECT document_id, document_name, approval_status, attached_to_action_id
--     FROM case_documents;
-- =====================================================================
