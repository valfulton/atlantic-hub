-- =====================================================================
-- 062_pr_pitches_client_approval.sql  (#220)
--
-- Client-side approval workflow for PR pitches. Before this, the only
-- approval signal on a pr_pitches row was the operator-side `status`
-- column (draft / approved / sent / declined). Clients (Momentum+ tier)
-- now see their matched opportunities at /client/pr and can:
--   - Approve   -> green-light val to send as-is
--   - Decline   -> client passes; we close out the pitch
--   - Review    -> client wants val's eyes on it before it goes out
--
-- We DON'T overload the operator `status` column because the client +
-- operator approval states need to coexist (e.g. operator marks 'sent'
-- AFTER client approves -- both signals must persist). New columns,
-- additive only, idempotent ALTER.
-- =====================================================================

USE shhdbite_AV;

SET @col_exists := (
  SELECT COUNT(*)
    FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'pr_pitches'
     AND COLUMN_NAME = 'client_approval'
);

SET @sql := IF(
  @col_exists = 0,
  'ALTER TABLE pr_pitches
     ADD COLUMN client_approval ENUM(''approved'',''declined'',''review_requested'') NULL DEFAULT NULL
       COMMENT ''(#220) client-side approval signal; NULL = client has not acted'',
     ADD COLUMN client_approval_at DATETIME NULL DEFAULT NULL
       COMMENT ''(#220) when client_approval was last set'',
     ADD COLUMN client_approval_by_user_id BIGINT UNSIGNED NULL DEFAULT NULL
       COMMENT ''(#220) which client_user clicked the button'',
     ADD COLUMN client_note TEXT NULL DEFAULT NULL
       COMMENT ''(#220) optional note from the client on decline / review'',
     ADD KEY idx_client_approval (client_approval, client_approval_at)',
  'SELECT ''client_approval column already exists on pr_pitches -- skipping ALTER'' AS note'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

DESCRIBE pr_pitches;
