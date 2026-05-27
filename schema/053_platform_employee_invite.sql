-- =====================================================================
-- Atlantic Hub -- Staff set-password invite columns on the PLATFORM admin_users
-- File:    schema/053_platform_employee_invite.sql
-- Target:  shhdbite_atlantic_hub   (the platform DB that /login authenticates against)
-- Run in:  HostGator phpMyAdmin -> shhdbite_atlantic_hub -> SQL tab -> paste -> Go
-- =====================================================================
--
-- WHY THIS EXISTS
--   Migration 052 added set_password_token / set_password_expires_at to
--   shhdbite_AV.admin_users -- but that AV-side admin_users is DORMANT. The real
--   admin_users that /login reads (and whose role ENUM includes 'staff') lives in
--   the PLATFORM database, shhdbite_atlantic_hub. createEmployee() was therefore
--   inserting into the wrong table; a created rep both errored on insert (the
--   dormant table's role ENUM has no 'staff') and could never have logged in.
--
--   lib/employees/store.ts now writes the staff account to the platform
--   admin_users. This migration adds the two invite columns there so the
--   set-password flow has somewhere to store its token. employee_profiles +
--   employee_documents stay in shhdbite_AV (from 052), keyed by the platform
--   admin_users.user_id -- the same cross-DB, app-enforced pattern as
--   leads.assigned_to_user_id.
--
-- IDEMPOTENT: every ALTER is guarded by an information_schema check, so re-running
-- is safe and will simply report "skipped".
-- =====================================================================

USE shhdbite_atlantic_hub;
SET NAMES utf8mb4;

-- ---------------------------------------------------------------------
-- 1. set_password_token
-- ---------------------------------------------------------------------
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = 'shhdbite_atlantic_hub' AND TABLE_NAME = 'admin_users'
    AND COLUMN_NAME = 'set_password_token'
);
SET @sql := IF(@col_exists = 0,
  "ALTER TABLE admin_users ADD COLUMN set_password_token CHAR(64) NULL AFTER password_hash",
  "SELECT 'set_password_token already exists -- skipped' AS info");
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------------
-- 2. set_password_expires_at
-- ---------------------------------------------------------------------
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = 'shhdbite_atlantic_hub' AND TABLE_NAME = 'admin_users'
    AND COLUMN_NAME = 'set_password_expires_at'
);
SET @sql := IF(@col_exists = 0,
  "ALTER TABLE admin_users ADD COLUMN set_password_expires_at DATETIME NULL AFTER set_password_token",
  "SELECT 'set_password_expires_at already exists -- skipped' AS info");
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------------
-- 3. index on set_password_token (invite-link lookups)
-- ---------------------------------------------------------------------
SET @idx_exists := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = 'shhdbite_atlantic_hub' AND TABLE_NAME = 'admin_users'
    AND INDEX_NAME = 'idx_set_password_token'
);
SET @sql := IF(@idx_exists = 0,
  "ALTER TABLE admin_users ADD KEY idx_set_password_token (set_password_token)",
  "SELECT 'idx_set_password_token already exists -- skipped' AS info");
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- =====================================================================
-- VERIFICATION
--   SHOW COLUMNS FROM admin_users LIKE 'set_password_token';
--   SHOW COLUMNS FROM admin_users LIKE 'set_password_expires_at';
--   -- role ENUM must include 'staff' (it does, per schema/001_platform.sql):
--   SHOW COLUMNS FROM admin_users LIKE 'role';
-- =====================================================================
-- END 053_platform_employee_invite.sql
-- =====================================================================
