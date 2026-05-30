-- 065_social_outbox_client_review.sql   (#61 Inc 4-polish-A)
--
-- Two columns on social_outbox so the client review queue can be more than
-- a yes/no decision:
--   client_notes        — free-text note from the client back to val
--                         (e.g. "love it, but punch up the open line")
--   client_edited_body  — operator's draft caption survives in body_text;
--                         the client's edit lives here for audit. On approve
--                         the edited copy is mirrored into body_text so the
--                         publisher reads the right version without knowing
--                         about the new column.
--
-- Idempotent without `ADD COLUMN IF NOT EXISTS` (which needs MySQL 8.0.29+).
-- Uses information_schema check + prepared statements; works on the older
-- MySQL/MariaDB this DB runs on. Run ONCE in shhdbite_AV.

USE shhdbite_AV;

SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = 'shhdbite_AV'
     AND TABLE_NAME = 'social_outbox'
     AND COLUMN_NAME = 'client_notes'
);
SET @sql := IF(
  @col_exists = 0,
  "ALTER TABLE social_outbox ADD COLUMN client_notes TEXT NULL COMMENT 'Free-text comment the client left on a draft (#61 Inc 4-polish-A)'",
  "SELECT 'client_notes already present' AS msg"
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = 'shhdbite_AV'
     AND TABLE_NAME = 'social_outbox'
     AND COLUMN_NAME = 'client_edited_body'
);
SET @sql := IF(
  @col_exists = 0,
  "ALTER TABLE social_outbox ADD COLUMN client_edited_body TEXT NULL COMMENT 'Client-edited version of body_text; preferred at publish time when non-null (#61 Inc 4-polish-A)'",
  "SELECT 'client_edited_body already present' AS msg"
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Verify:
--   SHOW COLUMNS FROM social_outbox LIKE 'client_%';
