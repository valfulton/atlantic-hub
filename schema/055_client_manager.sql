-- =====================================================================
-- Atlantic Hub -- Client sales-team link (a client account can be a REP under
-- a managing client account, e.g. Mike -> Skip at EHP).
-- File:    schema/055_client_manager.sql
-- Target:  shhdbite_AV   (clients live here)
-- Run in:  HostGator phpMyAdmin -> shhdbite_AV -> SQL tab -> paste -> Go
-- =====================================================================
--
-- WHY: Skip (a client) manages reps (Mike, and later Val's EHP account). Setting
-- a rep's clients.manager_client_id to Skip's client_id makes the rep show up on
-- Skip's "Your sales team" view with their pipeline -- the manager view that
-- gives Skip visibility into his downline. NULL = a normal standalone client.
--
-- IDEMPOTENT: guarded by information_schema checks.
-- =====================================================================

USE shhdbite_AV;
SET NAMES utf8mb4;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA='shhdbite_AV' AND TABLE_NAME='clients' AND COLUMN_NAME='manager_client_id');
SET @sql := IF(@c=0,
  "ALTER TABLE clients ADD COLUMN manager_client_id BIGINT UNSIGNED NULL COMMENT 'If set, this client account is a sales rep reporting to that manager client_id. Powers the manager team view. NULL = standalone client.'",
  "SELECT 'clients.manager_client_id exists -- skipped' AS info");
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @i := (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA='shhdbite_AV' AND TABLE_NAME='clients' AND INDEX_NAME='idx_manager_client_id');
SET @sql := IF(@i=0,
  "ALTER TABLE clients ADD INDEX idx_manager_client_id (manager_client_id)",
  "SELECT 'idx_manager_client_id exists -- skipped' AS info");
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- =====================================================================
-- Make Mike (client 6) a rep under Skip (client 4):
--   UPDATE clients SET manager_client_id = 4 WHERE client_id = 6;
-- VERIFY:
--   SHOW COLUMNS FROM clients LIKE 'manager_client_id';
--   SELECT client_id, client_name, manager_client_id FROM clients;
-- =====================================================================
-- END 055_client_manager.sql
-- =====================================================================
