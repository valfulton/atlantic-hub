-- =====================================================================
-- Atlantic Hub -- AV employees ↔ client account assignment (task #377)
-- File:    schema/074_account_employees.sql
-- Target:  shhdbite_AV   (clients + leads live here; admin_users is cross-DB)
-- Run in:  HostGator phpMyAdmin -> shhdbite_AV -> SQL tab -> paste -> Go
-- =====================================================================
--
-- WHY: Adriana's reps demo (#377). Rebecca stays as a platform admin_users
-- staff employee — no client_user parallel. To show "Your A&V team — Rebecca
-- is on it" on the client dashboard BEFORE any leads have been assigned to
-- her, we need a place to record her as the primary rep on a brand.
--
-- This table is OPTIONAL for the read path: lib/client/employees_on_account.ts
-- already derives "who's working this account" from leads.assigned_to_user_id.
-- This table just adds the EXPLICIT layer:
--   primary_rep -> the named rep on the brand (shows even with zero leads).
--   rep         -> additional reps on this brand.
--   support     -> ops / brand-kit owners who aren't the sales surface.
--
-- CROSS-DB FK: user_id references shhdbite_atlantic_hub.admin_users.user_id.
-- Enforced by the app, never by InnoDB — same pattern as leads.assigned_to_user_id
-- and call_log.user_id.
--
-- IDEMPOTENT: information_schema guard.
-- =====================================================================

USE shhdbite_AV;
SET NAMES utf8mb4;

SET @t := (SELECT COUNT(*) FROM information_schema.TABLES
  WHERE TABLE_SCHEMA='shhdbite_AV' AND TABLE_NAME='account_employees');
SET @sql := IF(@t=0,
  "CREATE TABLE account_employees (
     id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
     client_id       BIGINT UNSIGNED NOT NULL COMMENT 'the brand (clients.client_id)',
     user_id         BIGINT UNSIGNED NOT NULL COMMENT 'platform admin_users.user_id (app-enforced, cross-DB)',
     role            ENUM('primary_rep','rep','support') NOT NULL DEFAULT 'rep',
     assigned_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
     updated_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
     PRIMARY KEY (id),
     UNIQUE KEY uq_account_employee (client_id, user_id),
     KEY idx_client (client_id),
     KEY idx_user (user_id)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
     COMMENT='AV-employee→client assignment for Model B reps (#377). Cross-DB FK to platform admin_users — app-enforced.'",
  "SELECT 'account_employees exists -- skipped' AS info");
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- =====================================================================
-- VERIFY:
--   SHOW CREATE TABLE account_employees;
--   SELECT * FROM account_employees ORDER BY client_id, role;
-- =====================================================================
-- END 074_account_employees.sql
-- =====================================================================
