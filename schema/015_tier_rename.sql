-- =====================================================================
-- Atlantic Hub -- Tier rename: starter -> sprint, growth -> momentum
-- File:    schema/015_tier_rename.sql
-- Target:  shhdbite_AV.client_users
-- Run in:  HostGator phpMyAdmin -> shhdbite_AV -> SQL tab -> paste -> Go
-- =====================================================================
--
-- Why: the legacy tier names in client_users.tier (starter / growth)
-- did not match production Stripe products (sprint / momentum / scale).
-- This migration renames the enum values and migrates existing rows.
--
-- IDEMPOTENT: safe to re-run. Detects which enum signature is current
-- and only runs the MODIFY + UPDATE when the column still has the old
-- values.
--
-- NOTE: schema/011 (Grok Imagine) does not reference client_users.tier,
-- so the order of 011 vs 015 does not matter. Run 011 first when going
-- live; this migration is independent.
-- =====================================================================

USE shhdbite_AV;
SET NAMES utf8mb4;

-- ---------------------------------------------------------------------
-- 1. Detect the current enum signature on client_users.tier.
--    If COLUMN_TYPE still contains 'starter' we know the old names are
--    in place and we should run the rename. If not, we skip everything.
-- ---------------------------------------------------------------------
SET @col_type := (
  SELECT COLUMN_TYPE FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = 'shhdbite_AV'
    AND TABLE_NAME = 'client_users'
    AND COLUMN_NAME = 'tier'
);
SET @has_legacy := (CASE WHEN @col_type LIKE "%'starter'%" OR @col_type LIKE "%'growth'%" THEN 1 ELSE 0 END);

-- ---------------------------------------------------------------------
-- 2. Widen the enum first so it accepts BOTH legacy and new names.
--    This lets the UPDATE in step 3 succeed without an enum-cast error.
-- ---------------------------------------------------------------------
SET @sql := IF(@has_legacy = 1,
  "ALTER TABLE client_users
     MODIFY COLUMN tier ENUM('audit_only','starter','growth','sprint','momentum','scale')
     NOT NULL DEFAULT 'audit_only'",
  "SELECT 'client_users.tier already migrated -- skipped widening' AS info");
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------------
-- 3. Migrate existing rows.
--    starter -> sprint, growth -> momentum. audit_only and scale unchanged.
-- ---------------------------------------------------------------------
SET @sql := IF(@has_legacy = 1,
  "UPDATE client_users SET tier = 'sprint' WHERE tier = 'starter'",
  "SELECT 'no starter rows to migrate' AS info");
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF(@has_legacy = 1,
  "UPDATE client_users SET tier = 'momentum' WHERE tier = 'growth'",
  "SELECT 'no growth rows to migrate' AS info");
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------------
-- 4. Tighten the enum back down to the production-canonical four values.
--    Only do this when there are zero legacy-name rows left (defensive).
-- ---------------------------------------------------------------------
SET @leftover := (
  SELECT COUNT(*) FROM client_users WHERE tier IN ('starter','growth')
);
SET @sql := IF(@leftover = 0,
  "ALTER TABLE client_users
     MODIFY COLUMN tier ENUM('audit_only','sprint','momentum','scale')
     NOT NULL DEFAULT 'audit_only'",
  "SELECT CONCAT('Refusing to tighten enum -- ', @leftover, ' legacy rows remain.') AS warning");
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------------
-- Verification -- run after this migration:
--   SHOW COLUMNS FROM client_users LIKE 'tier';
--     expect: enum('audit_only','sprint','momentum','scale')
--   SELECT tier, COUNT(*) FROM client_users GROUP BY tier;
--     expect: no rows for 'starter' or 'growth'
-- ---------------------------------------------------------------------
