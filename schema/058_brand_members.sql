-- =====================================================================
-- Atlantic Hub -- Multi-brand membership (task #101)
-- File:    schema/058_brand_members.sql
-- Target:  shhdbite_AV   (clients + client_users live here)
-- Run in:  HostGator phpMyAdmin -> shhdbite_AV -> SQL tab -> paste -> Go
-- =====================================================================
--
-- WHY: one PERSON (client_user) can belong to many BRANDS (clients), and a
-- brand can have many people. This join carries the relationship + role:
--   owner  -> the account owner; one login + one bill; sees every brand they own
--             and the merged calendar across them.
--   rep    -> a salesperson on the brand; sees that brand's whole calendar/pipeline.
--   viewer -> read-only.
-- Many-to-many by design: a rep may serve multiple brands; a person may own
-- multiple brands. See Atlantic_Hub_Playbook/Architecture_MultiBrand_Accounts.md.
--
-- This does NOT replace clients.manager_client_id yet (EHP migrates onto this
-- table in build increment 1). Brands remain their own client_id scopes — this
-- only adds the person<->brand layer on top.
--
-- IDEMPOTENT: guarded by information_schema checks.
-- =====================================================================

USE shhdbite_AV;
SET NAMES utf8mb4;

SET @t := (SELECT COUNT(*) FROM information_schema.TABLES
  WHERE TABLE_SCHEMA='shhdbite_AV' AND TABLE_NAME='brand_members');
SET @sql := IF(@t=0,
  "CREATE TABLE brand_members (
     id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
     client_user_id  BIGINT UNSIGNED NOT NULL COMMENT 'the person (login)',
     client_id       BIGINT UNSIGNED NOT NULL COMMENT 'the brand they belong to',
     role            ENUM('owner','rep','viewer') NOT NULL DEFAULT 'rep',
     created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
     updated_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
     PRIMARY KEY (id),
     UNIQUE KEY uq_member (client_user_id, client_id),
     KEY idx_brand (client_id),
     KEY idx_user (client_user_id)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Person<->brand membership + role (multi-brand accounts, #101)'",
  "SELECT 'brand_members exists -- skipped' AS info");
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- =====================================================================
-- Backfill: every existing client_user that is linked to a brand becomes an
-- 'owner' of that brand (preserves today's behavior — each login owns its hub).
-- Reps/extra owners get added explicitly during the Adriana + EHP setup.
-- Safe to re-run (INSERT IGNORE on the unique (client_user_id, client_id)).
-- =====================================================================
INSERT IGNORE INTO brand_members (client_user_id, client_id, role)
SELECT cu.client_user_id, cu.client_id, 'owner'
  FROM client_users cu
 WHERE cu.client_id IS NOT NULL
   AND cu.archived_at IS NULL;

-- =====================================================================
-- VERIFY:
--   SHOW CREATE TABLE brand_members;
--   SELECT bm.client_user_id, cu.email, bm.client_id, c.client_name, bm.role
--     FROM brand_members bm
--     JOIN client_users cu ON cu.client_user_id = bm.client_user_id
--     JOIN clients c       ON c.client_id       = bm.client_id
--    ORDER BY bm.client_id, bm.role;
-- =====================================================================
-- END 058_brand_members.sql
-- =====================================================================
