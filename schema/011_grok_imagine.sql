-- =====================================================================
-- Atlantic Hub -- Grok Imagine: per-lead AI commercial generation
-- File:    schema/011_grok_imagine.sql
-- Target:  shhdbite_AV
-- Run in:  HostGator phpMyAdmin -> click shhdbite_AV in the sidebar so
--          the top bar reads "Database: shhdbite_AV" -> SQL tab ->
--          paste this entire file -> Go
-- =====================================================================
--
-- IDEMPOTENT: safe to re-run. Uses only CREATE TABLE IF NOT EXISTS,
-- which is standard SQL supported by every MySQL / MariaDB version
-- HostGator ships. Re-running this against an existing schema is a
-- no-op for both tables.
--
-- Adds two tables to shhdbite_AV:
--   grok_imagine_assets -- one row per generated commercial (image or video)
--   grok_imagine_log    -- audit + cost trail for every xAI API call
-- =====================================================================

CREATE TABLE IF NOT EXISTS grok_imagine_assets (
  id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  lead_id             BIGINT UNSIGNED NOT NULL,
  asset_type          ENUM('image','video') NOT NULL,
  model               VARCHAR(64) NOT NULL,
  prompt              TEXT NOT NULL,
  enhanced_prompt     TEXT NULL,
  provider_request_id VARCHAR(128) NULL,
  storage_url         VARCHAR(1024) NULL,
  storage_path        VARCHAR(512) NULL,
  mime_type           VARCHAR(64) NULL,
  width               INT UNSIGNED NULL,
  height              INT UNSIGNED NULL,
  duration_seconds    DECIMAL(5,2) NULL,
  resolution_tier     ENUM('1k','2k') NOT NULL DEFAULT '1k',
  aspect_ratio        VARCHAR(8) NULL,
  cost_usd            DECIMAL(8,4) NULL,
  generation_status   ENUM('queued','running','succeeded','failed') NOT NULL DEFAULT 'queued',
  error_message       VARCHAR(500) NULL,
  created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at        DATETIME NULL,
  archived_at         DATETIME NULL,
  created_by_user_id  BIGINT UNSIGNED NULL,
  KEY idx_grok_assets_lead         (lead_id),
  KEY idx_grok_assets_status       (generation_status),
  KEY idx_grok_assets_created      (created_at),
  KEY idx_grok_assets_archived     (archived_at),
  KEY idx_grok_assets_provider_req (provider_request_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS grok_imagine_log (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  called_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  endpoint      VARCHAR(80) NOT NULL,
  lead_id       BIGINT UNSIGNED NULL,
  asset_id      BIGINT UNSIGNED NULL,
  model         VARCHAR(64) NOT NULL,
  cost_usd      DECIMAL(8,4) NULL,
  latency_ms    INT UNSIGNED NULL,
  outcome       ENUM('success','rate_limited','error','quota_exceeded') NOT NULL DEFAULT 'success',
  error_message VARCHAR(500) NULL,
  actor_user_id BIGINT UNSIGNED NULL,
  KEY idx_grok_log_called  (called_at),
  KEY idx_grok_log_outcome (outcome),
  KEY idx_grok_log_lead    (lead_id),
  KEY idx_grok_log_asset   (asset_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Verification (run these after the two CREATE statements succeed):
--   SHOW TABLES LIKE 'grok_imagine%';
--   DESC grok_imagine_assets;
--   DESC grok_imagine_log;
--   SELECT COUNT(*) FROM grok_imagine_assets;  -- expect 0
