-- 017_social_posting.sql
-- Multi-tenant social posting connectors: LinkedIn, X, IG, FB, Threads, TikTok, YouTube.
-- Idempotent: safe to re-run. Uses IF NOT EXISTS everywhere.
--
-- NAMING NOTE: This DB already has social_channels, social_posts, social_post_approvals
-- from schema 004 v4 (May 12). To avoid colliding with that existing system, the new
-- tables here are namespaced:
--   social_connections      (OAuth-connected provider accounts; the missing piece)
--   social_outbox           (posts queued for the new publisher; legacy social_posts untouched)
--   social_publish_log      (one row per publish attempt)
--   social_tenant_settings  (per-tenant smart-timing config)
--
-- The legacy social_post_approvals table IS used by the new publisher as the client-channel
-- approval gate (Option B). See the build session prompt for the publisher rule that joins
-- social_outbox -> social_post_approvals for tenant_id LIKE 'client:%' rows.
--
-- If you later decide to merge with the legacy social_posts schema, write that migration
-- as 02x — DO NOT drop the legacy tables here.

USE shhdbite_AV;

CREATE TABLE IF NOT EXISTS social_connections (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL,
  provider ENUM('linkedin','x','instagram','facebook','threads','tiktok','youtube') NOT NULL,
  provider_account_id VARCHAR(255) NOT NULL,
  display_name VARCHAR(255) NULL,
  avatar_url VARCHAR(1024) NULL,
  scopes_json TEXT NULL,
  access_token_enc TEXT NOT NULL,
  refresh_token_enc TEXT NULL,
  access_token_expires_at DATETIME NULL,
  refresh_token_expires_at DATETIME NULL,
  status ENUM('active','revoked','expired','error') NOT NULL DEFAULT 'active',
  last_error VARCHAR(500) NULL,
  connected_by_user_id BIGINT UNSIGNED NULL,
  connected_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at DATETIME NULL,
  UNIQUE KEY uq_tenant_provider_account (tenant_id, provider, provider_account_id),
  KEY idx_tenant (tenant_id),
  KEY idx_provider_status (provider, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS social_outbox (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL,
  connection_id BIGINT UNSIGNED NOT NULL,
  lead_id BIGINT UNSIGNED NULL,
  asset_id BIGINT UNSIGNED NULL,
  body_text TEXT NULL,
  media_url VARCHAR(1024) NULL,
  media_type ENUM('none','image','video','carousel') NOT NULL DEFAULT 'none',
  status ENUM('draft','scheduled','publishing','published','failed','canceled') NOT NULL DEFAULT 'draft',
  scheduled_for DATETIME NULL,
  published_at DATETIME NULL,
  provider_post_id VARCHAR(255) NULL,
  provider_url VARCHAR(1024) NULL,
  error_message VARCHAR(500) NULL,
  retries INT UNSIGNED NOT NULL DEFAULT 0,
  created_by_user_id BIGINT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  archived_at DATETIME NULL,
  KEY idx_tenant_status (tenant_id, status),
  KEY idx_connection (connection_id),
  KEY idx_status_scheduled (status, scheduled_for),
  KEY idx_lead (lead_id),
  KEY idx_asset (asset_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS social_publish_log (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  outbox_id BIGINT UNSIGNED NOT NULL,
  attempted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  outcome ENUM('success','retry','permanent_failure') NOT NULL,
  http_status INT UNSIGNED NULL,
  latency_ms INT UNSIGNED NULL,
  error_message VARCHAR(500) NULL,
  KEY idx_outbox (outbox_id),
  KEY idx_attempted (attempted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS social_tenant_settings (
  tenant_id VARCHAR(64) NOT NULL PRIMARY KEY,
  auto_schedule_enabled TINYINT(1) NOT NULL DEFAULT 0,
  timezone VARCHAR(64) NOT NULL DEFAULT 'America/New_York',
  preferred_windows_json TEXT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- End of 017. This file is a clean idempotent replay of what shipped to
-- shhdbite_AV on 2026-05-19. The build session will write schema 024 to add:
--   1. social_outbox.operator_override BOOLEAN NOT NULL DEFAULT FALSE
--      (required by the client-channel approval gate)
--   2. social_publish_log.outcome ENUM ... 'awaiting_approval' value
--      (used when the publisher blocks a client:% post pending approval)
-- 024 is an ALTER-only migration; this 017 file is never edited after ship.
