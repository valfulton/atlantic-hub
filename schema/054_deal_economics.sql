-- =====================================================================
-- Atlantic Hub -- Per-client deal economics + per-lead deal metrics
-- File:    schema/054_deal_economics.sql
-- Target:  shhdbite_AV   (clients + leads live here)
-- Run in:  HostGator phpMyAdmin -> shhdbite_AV -> SQL tab -> paste -> Go
-- =====================================================================
--
-- WHY THIS EXISTS
--   Pipeline value used to be computed with Atlantic & Vine's own pricing
--   (Sprint floor x AI score) -- meaningless for a client like Skip (EHP), whose
--   economics are a commission of ~$10 per employee per month. This lets each
--   client carry their OWN deal model, and each lead carry the metric that drives
--   its value, so "potential pipeline" is real money in the client's terms.
--
--   clients.deal_model     'per_head' | 'flat'  (switchable per client; NULL = use
--                          the legacy AV pipeline math, unchanged)
--   clients.deal_rate_cents per-unit, per-MONTH rate in cents (per_head). EHP = 1000 ($10).
--   clients.deal_unit_label what a unit is, e.g. 'employee' (per_head display).
--
--   leads.deal_unit_count  the per_head metric for THIS lead (e.g. # employees).
--   leads.deal_flat_cents   the flat monthly value for THIS lead (flat mode).
--
--   Monthly value = per_head ? (rate_cents * unit_count) : flat_cents.
--   Annual = monthly * 12 (headline is monthly recurring).
--
-- IDEMPOTENT: every ALTER guarded by an information_schema check.
-- =====================================================================

USE shhdbite_AV;
SET NAMES utf8mb4;

-- ---------------------------------------------------------------------
-- clients.deal_model
-- ---------------------------------------------------------------------
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA='shhdbite_AV' AND TABLE_NAME='clients' AND COLUMN_NAME='deal_model');
SET @sql := IF(@c=0,
  "ALTER TABLE clients ADD COLUMN deal_model ENUM('per_head','flat') NULL COMMENT 'How this client values a deal. NULL = legacy AV pipeline math.'",
  "SELECT 'clients.deal_model exists -- skipped' AS info");
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ---------------------------------------------------------------------
-- clients.deal_rate_cents
-- ---------------------------------------------------------------------
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA='shhdbite_AV' AND TABLE_NAME='clients' AND COLUMN_NAME='deal_rate_cents');
SET @sql := IF(@c=0,
  "ALTER TABLE clients ADD COLUMN deal_rate_cents INT UNSIGNED NULL COMMENT 'per_head: per-unit per-MONTH rate in cents. EHP=1000 ($10/employee/mo).'",
  "SELECT 'clients.deal_rate_cents exists -- skipped' AS info");
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ---------------------------------------------------------------------
-- clients.deal_unit_label
-- ---------------------------------------------------------------------
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA='shhdbite_AV' AND TABLE_NAME='clients' AND COLUMN_NAME='deal_unit_label');
SET @sql := IF(@c=0,
  "ALTER TABLE clients ADD COLUMN deal_unit_label VARCHAR(40) NULL COMMENT 'per_head unit noun, e.g. employee.'",
  "SELECT 'clients.deal_unit_label exists -- skipped' AS info");
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ---------------------------------------------------------------------
-- leads.deal_unit_count
-- ---------------------------------------------------------------------
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA='shhdbite_AV' AND TABLE_NAME='leads' AND COLUMN_NAME='deal_unit_count');
SET @sql := IF(@c=0,
  "ALTER TABLE leads ADD COLUMN deal_unit_count INT UNSIGNED NULL COMMENT 'per_head metric for this lead, e.g. # employees.'",
  "SELECT 'leads.deal_unit_count exists -- skipped' AS info");
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ---------------------------------------------------------------------
-- leads.deal_flat_cents
-- ---------------------------------------------------------------------
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA='shhdbite_AV' AND TABLE_NAME='leads' AND COLUMN_NAME='deal_flat_cents');
SET @sql := IF(@c=0,
  "ALTER TABLE leads ADD COLUMN deal_flat_cents INT UNSIGNED NULL COMMENT 'flat-mode monthly value for this lead, in cents.'",
  "SELECT 'leads.deal_flat_cents exists -- skipped' AS info");
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- =====================================================================
-- SET EHP's model (Skip & Mike): per-head, $10/employee/month.
-- Replace <SKIP_CLIENT_ID> with the client_id, or set by matching the email.
-- =====================================================================
-- UPDATE clients SET deal_model='per_head', deal_rate_cents=1000, deal_unit_label='employee'
--   WHERE client_id = <SKIP_CLIENT_ID>;
--
-- VERIFICATION:
--   SHOW COLUMNS FROM clients LIKE 'deal_%';
--   SHOW COLUMNS FROM leads LIKE 'deal_%';
-- =====================================================================
-- END 054_deal_economics.sql
-- =====================================================================
