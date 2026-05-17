-- =====================================================================
-- Atlantic Hub - Client Portal authentication
-- File:    schema/009_client_portal.sql
-- Target:  shhdbite_AV
-- Run in:  HostGator phpMyAdmin -> shhdbite_AV -> SQL tab -> paste -> Go
-- =====================================================================
--
-- Adds the client_users table that backs the Client Portal at
--   atlantic-hub.netlify.app/client/*
--
-- One client_users row per portal login. One client (the business)
-- can in principle have multiple logins (founder + ops person) so
-- email is unique but client_id is not. For v1 the intake flow only
-- creates one login per intake; multi-seat is a future enhancement.
--
-- Joins to:
--   - clients          (shhdbite_AV.clients.client_id)         — the business
--   - leads            (shhdbite_AV.leads.client_id)           — the audit + pipeline
--
-- Note on tiers: this migration's tier ENUM (audit_only / starter /
-- growth / scale) is the portal's tier, NOT the legacy
-- clients.plan_tier ENUM (sprint / momentum / scale / owner). The
-- portal reads ONLY client_users.tier. Legacy plan_tier stays as-is
-- for backward compatibility; we can deprecate it in a later sweep.
--
-- Note on the earlier 004_av_client_portal.sql sketch
-- (/Users/atlanticandvine/Documents/Claude/Projects/Atlantic And Vine/):
-- That file proposed a parallel av_accounts / av_leads schema for a
-- multi-tenant CRM. It is superseded by the current production
-- approach where the existing shhdbite_AV.leads table (with
-- audit_content, client_id, audit_id) is the single source of truth.
-- 009 adds only the auth layer on top.
--
-- IDEMPOTENT: every CREATE uses IF NOT EXISTS. Safe to re-run.
-- =====================================================================

USE shhdbite_AV;
SET NAMES utf8mb4;

-- ---------------------------------------------------------------------
-- 1. client_users - one row per portal login
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS client_users (
  client_user_id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,

  -- Identity
  client_id               BIGINT UNSIGNED NULL
    COMMENT 'FK to clients.client_id. NULL while intake is pending account creation.',
  email                   VARCHAR(255) NOT NULL,
  display_name            VARCHAR(255) NULL
    COMMENT 'What to show in the dashboard header.',

  -- Auth
  password_hash           VARCHAR(255) DEFAULT NULL
    COMMENT 'bcrypt-12. NULL until user sets a password via set-password flow.',
  magic_token             VARCHAR(64) DEFAULT NULL
    COMMENT 'One-time hex token for first-login / password-reset. Cleared on use.',
  magic_token_expires_at  DATETIME DEFAULT NULL
    COMMENT 'Token TTL. Default 24 hours from issue.',

  -- Lifecycle timestamps
  email_verified_at       DATETIME DEFAULT NULL
    COMMENT 'Set when the user clicks a valid magic link.',
  last_login_at           DATETIME DEFAULT NULL,

  -- Tier (portal-specific, not the legacy clients.plan_tier)
  tier                    ENUM('audit_only','starter','growth','scale')
                          NOT NULL DEFAULT 'audit_only'
    COMMENT 'audit_only = free-audit submitter. Paid tiers match marketing-site pricing.',

  -- Free-form
  intake_payload          JSON DEFAULT NULL
    COMMENT 'Raw client-intake form payload for forensic audit.',

  created_at              DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at              DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                          ON UPDATE CURRENT_TIMESTAMP,
  archived_at             DATETIME DEFAULT NULL
    COMMENT 'Soft-delete. Filter WHERE archived_at IS NULL on all reads.',

  UNIQUE KEY uq_client_users_email (email),
  KEY idx_client_users_client_id   (client_id),
  KEY idx_client_users_magic_token (magic_token),
  KEY idx_client_users_archived    (archived_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- Verification - paste after running:
--   SHOW CREATE TABLE client_users\G
--   SELECT COUNT(*) FROM client_users;
--   -- expect: 0
--
-- Smoke insert (uncomment to test, then DELETE):
--   INSERT INTO client_users
--     (email, display_name, magic_token, magic_token_expires_at, tier)
--   VALUES
--     ('smoke@example.com', 'Smoke Test',
--      'abc123def456abc123def456abc123def456abc123def456abc123def456abcd',
--      DATE_ADD(NOW(), INTERVAL 1 DAY), 'audit_only');
--   SELECT client_user_id, email, tier, magic_token_expires_at FROM client_users
--   WHERE email = 'smoke@example.com';
--   DELETE FROM client_users WHERE email = 'smoke@example.com';
-- ---------------------------------------------------------------------
