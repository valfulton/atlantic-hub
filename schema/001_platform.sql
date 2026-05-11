-- =====================================================================
-- Atlantic Hub — Platform Database Schema
-- File: schema/001_platform.sql
-- Target DB: shhdbite_atlantic_hub
-- Run in: HostGator cPanel → phpMyAdmin → shhdbite_atlantic_hub → SQL tab
-- =====================================================================
--
-- This file creates the platform-level tables that sit ABOVE the
-- per-tenant databases (shhdbite_hunterhoney, shhdbite_av, shhdbite_ebw,
-- and any future tenant DBs like shhdbite_mortgage_v1).
--
-- Schema philosophy:
--   - One human = one row in `accounts` (keyed by SHA-256 of lowercased email)
--   - One row in `tenant_account_link` per (account, tenant, role-in-tenant)
--   - Adding a new tenant = INSERT into `tenants` + new per-tenant detail
--     tables in that tenant's DB. No platform-level migration needed.
--
-- IMPORTANT: Run 001_platform.sql FIRST, then 002_hh_detail.sql, then
-- 003_seed.sql. The seed file depends on tables created here.
-- =====================================================================

-- Use the platform database
USE shhdbite_atlantic_hub;

SET NAMES utf8mb4;
SET time_zone = '+00:00';
SET foreign_key_checks = 0;

-- =====================================================================
-- admin_users: people who can log into the dashboard
-- =====================================================================
-- Roles:
--   owner       = Val + any co-founder; full access across all tenants
--   staff       = trusted operators; can be scoped per-tenant later
--   client_user = SCHEMA ONLY in v1; reserved for Founding Advisor
--                 Partners who will log in to view their own clients'
--                 analytical outputs in v2.
-- =====================================================================
DROP TABLE IF EXISTS admin_users;
CREATE TABLE admin_users (
  user_id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  email             VARCHAR(255) NOT NULL,
  password_hash     VARCHAR(255) NOT NULL,
  role              ENUM('owner','staff','client_user') NOT NULL DEFAULT 'staff',
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  display_name      VARCHAR(120) NOT NULL,
  last_login_at     DATETIME NULL,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_admin_email (email),
  KEY idx_role_active (role, is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================================
-- tenants: the business lines registered to the platform
-- =====================================================================
-- Adding a new tenant later (e.g., mortgage advisory) is one INSERT here
-- plus creating the per-tenant detail tables in its own DB. No code
-- change required for the platform-level auth or audit layers.
-- =====================================================================
DROP TABLE IF EXISTS tenants;
CREATE TABLE tenants (
  tenant_id         VARCHAR(40) NOT NULL,
  display_name      VARCHAR(120) NOT NULL,
  db_name           VARCHAR(80) NOT NULL,
  brand_color_hex   VARCHAR(7) NOT NULL,
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================================
-- accounts: the canonical platform-level person record
-- =====================================================================
-- One row per unique human (identified by email_hash). The same person
-- across HH, AV, and EBW gets ONE row here and three rows in
-- tenant_account_link.
--
-- Email is stored both as a hash (for lookups, GDPR-friendly) and
-- encrypted (for display + sending). Hash is SHA-256(lower(trim(email))).
-- Encrypted column is AES-GCM, key in EMAIL_ENCRYPTION_KEY env var.
-- =====================================================================
DROP TABLE IF EXISTS accounts;
CREATE TABLE accounts (
  account_id        CHAR(26) NOT NULL,
  email_hash        CHAR(64) NOT NULL,
  email_encrypted   VARBINARY(512) NOT NULL,
  display_name      VARCHAR(120) NULL,
  first_seen_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  identity_verified BOOLEAN NOT NULL DEFAULT FALSE,
  notes_md          TEXT NULL,
  PRIMARY KEY (account_id),
  UNIQUE KEY uq_email_hash (email_hash),
  KEY idx_last_seen (last_seen_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================================
-- tenant_account_link: the bridge between accounts and tenants
-- =====================================================================
-- One row per (account, tenant, role-in-tenant). A person can be both
-- an `individual_learner` and a `research_api_customer` on HH — that's
-- two rows here, both pointing to the same account_id.
--
-- account_type values are tenant-specific. Examples:
--   hunterhoney: individual_learner, research_api_customer, advisor_partner
--   av:          client, prospect
--   ebw:         investor, charter_customer
--   (future)    mortgage_client, debt_servicing_client
-- =====================================================================
DROP TABLE IF EXISTS tenant_account_link;
CREATE TABLE tenant_account_link (
  link_id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  account_id        CHAR(26) NOT NULL,
  tenant_id         VARCHAR(40) NOT NULL,
  account_type      VARCHAR(60) NOT NULL,
  status            ENUM('lead','active','churned','rejected') NOT NULL DEFAULT 'lead',
  tier              VARCHAR(40) NULL,
  mrr_cents         INT NOT NULL DEFAULT 0,
  source            VARCHAR(80) NULL,
  detail_table      VARCHAR(80) NULL,
  detail_row_id     BIGINT UNSIGNED NULL,
  linked_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_account_tenant_type (account_id, tenant_id, account_type),
  KEY idx_tenant_status (tenant_id, status),
  KEY idx_account (account_id),
  CONSTRAINT fk_link_account FOREIGN KEY (account_id) REFERENCES accounts(account_id) ON DELETE CASCADE,
  CONSTRAINT fk_link_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(tenant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================================
-- audit_log_global: the compliance-ready append-only audit trail
-- =====================================================================
-- One row per: page view, API call, login attempt, webhook ingestion,
-- error. Designed to satisfy SOC 2 Type I evidence requirements and
-- shaped so an SEC-registered advisor-partner's compliance officer
-- can export it as a vendor packet when FAP #1 signs.
--
-- NEVER LOG PII HERE:
--   - No raw email, name, phone, account numbers
--   - No raw IP — only ip_hash = SHA-256(ip + IP_SALT)
--   - No user agent string — only user_agent_hash
--   - No password, JWT contents, raw webhook payload bodies
-- =====================================================================
DROP TABLE IF EXISTS audit_log_global;
CREATE TABLE audit_log_global (
  audit_id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  actor_user_id     BIGINT UNSIGNED NULL,
  actor_role        VARCHAR(40) NULL,
  tenant_id         VARCHAR(40) NULL,
  target_resource   VARCHAR(255) NOT NULL,
  action            VARCHAR(60) NOT NULL,
  model_version     VARCHAR(80) NULL,
  prompt_template_id VARCHAR(80) NULL,
  input_hash        CHAR(64) NULL,
  output_hash       CHAR(64) NULL,
  ip_hash           CHAR(64) NOT NULL,
  user_agent_hash   CHAR(64) NULL,
  status_code       SMALLINT NULL,
  error_class       VARCHAR(80) NULL,
  ts                DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_actor_ts (actor_user_id, ts),
  KEY idx_tenant_ts (tenant_id, ts),
  KEY idx_action_ts (action, ts),
  KEY idx_ts (ts)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================================
-- feature_flags: kill switches + future-toggle slots
-- =====================================================================
-- Edit via direct SQL from phpMyAdmin to flip any flag without a redeploy.
-- Middleware reads flags fresh per request with 30s in-memory cache per
-- warm Lambda instance.
-- =====================================================================
DROP TABLE IF EXISTS feature_flags;
CREATE TABLE feature_flags (
  flag_name         VARCHAR(80) NOT NULL,
  enabled           BOOLEAN NOT NULL DEFAULT TRUE,
  notes             VARCHAR(255) NULL,
  updated_by        BIGINT UNSIGNED NULL,
  updated_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (flag_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================================
-- rate_limit_buckets: sliding-window rate limiting (no Redis on HostGator)
-- =====================================================================
-- Cleanup: rows with window_start older than 24 hours can be purged.
-- A nightly cron will be added in v2; for v1, MySQL handles ~millions
-- of rows without issue and we'll purge manually if needed.
-- =====================================================================
DROP TABLE IF EXISTS rate_limit_buckets;
CREATE TABLE rate_limit_buckets (
  bucket_key        VARCHAR(255) NOT NULL,
  window_start      DATETIME(3) NOT NULL,
  hit_count         INT NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket_key, window_start),
  KEY idx_window (window_start)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================================
-- webhook_events: idempotency + replay log for inbound webhooks
-- =====================================================================
-- Netlify Forms webhooks include a submission id. We use it as
-- external_id to dedupe retries (Netlify auto-retries on 5xx).
-- payload_sha256 is the SHA-256 of the raw JSON body; allows replay
-- without re-fetching from Netlify.
-- =====================================================================
DROP TABLE IF EXISTS webhook_events;
CREATE TABLE webhook_events (
  event_id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  source            VARCHAR(40) NOT NULL,
  external_id       VARCHAR(120) NOT NULL,
  form_name         VARCHAR(80) NOT NULL,
  payload_sha256    CHAR(64) NOT NULL,
  ingestion_status  ENUM('pending','ingested','failed','duplicate') NOT NULL DEFAULT 'pending',
  error_message     VARCHAR(500) NULL,
  received_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at      DATETIME NULL,
  UNIQUE KEY uq_source_external (source, external_id),
  KEY idx_status_received (ingestion_status, received_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET foreign_key_checks = 1;

-- =====================================================================
-- Done. Verify with:
--   SHOW TABLES;
-- Expect: 7 tables.
-- =====================================================================
