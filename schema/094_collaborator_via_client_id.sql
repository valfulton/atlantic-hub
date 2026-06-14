-- =====================================================================
-- Atlantic Hub — collaborator brand-scoping (#657)
-- File:    schema/094_collaborator_via_client_id.sql   (bumped from 092 → 094: 092_case_action_item_notes.sql and 093_document_approval.sql already exist)
-- Target:  shhdbite_AV
-- Run AFTER: schema/089_case_management.sql
-- =====================================================================
--
-- WHY (val caught this 2026-06-14):
--   A multi-brand owner who collaborates on a case via ONE of their brands
--   was seeing that case bleed onto ALL their brands. Adriana works the
--   Johnson trust as attorney through her LEGAL brand (CLDA, client_id 10),
--   NOT her debt-collection brand (CBB, client_id 9). The matters card was
--   surfacing Johnson on CBB too — a family trust dispute on a debt-collection
--   dashboard. Wrong.
--
-- THE RULE (the matters card surfaces a collaborator's case when ANY hold):
--   1. the viewer's active brand == the case's own client_id   (case home)
--   2. via_client_id IS NULL                                   (single-brand
--      collaborator — Rebecca, parents — only have one home)
--   3. the viewer's active brand == via_client_id              (work-context
--      brand the collaborator works this case through)
--   And it HIDES when the active brand is the collaborator's OTHER brand.
--
-- via_client_id = the collaborator's client_id at invite time (the brand they
-- do this work through). NULL keeps today's behavior for single-brand people.
-- =====================================================================

USE shhdbite_AV;

ALTER TABLE family_case_collaborators
  ADD COLUMN via_client_id BIGINT UNSIGNED NULL
    COMMENT 'Brand the collaborator works this case through (their client_id at invite time). NULL = no brand-scoping (single-brand collaborator). Matters card surfaces this row only when the viewer''s active brand = via_client_id OR = the case''s own client_id.'
    AFTER role,
  ADD KEY idx_fcc_via_client (via_client_id);

-- ---------------------------------------------------------------------
-- Data backfill for the Johnson case (collaborator_id = 3 = Adriana /
-- cldaservices on case 1). Confirm the id first:
--   SELECT collaborator_id, case_id, client_user_id, role, revoked_at, via_client_id
--     FROM family_case_collaborators
--    WHERE case_id = 1;
-- Then un-revoke + scope to CLDA (client_id 10):
-- ---------------------------------------------------------------------
-- UPDATE family_case_collaborators SET revoked_at = NULL      WHERE collaborator_id = 3;
-- UPDATE family_case_collaborators SET via_client_id = 10     WHERE collaborator_id = 3;

-- VERIFY:
--   SELECT collaborator_id, case_id, client_user_id, role, via_client_id, revoked_at
--     FROM family_case_collaborators WHERE case_id = 1;
-- =====================================================================
-- END 092_collaborator_via_client_id.sql
-- =====================================================================
