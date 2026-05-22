-- 027_pr_discovery.sql
-- PR Discovery + Orchestration. Extends the schema 025 PR engine from a reactive
-- paste-in desk into a PROACTIVE one: opportunities are discovered (internal
-- signals, monitored PR inbox, Reddit/RSS) and ranked, and a single action can
-- chain pitch -> commercial -> queued social post.
-- See docs/CLAUDE_KICKOFF_PR_DISCOVERY_AND_ORCHESTRATION.md.
--
-- Idempotent + additive: safe to re-run. Does NOT drop/rename/recreate anything.
-- HostGator is classic MySQL (no ADD COLUMN IF NOT EXISTS), so the ALTER on
-- pr_opportunities is guarded with an information_schema check + PREPARE.
--
-- Tables added: pr_discovery_sources, pr_ingestion_log.
-- Columns added to pr_opportunities: origin, relevance_score, suggested,
--   discovered_at, dedupe_hash, linked_pitch_id, linked_asset_id, linked_outbox_id.

USE shhdbite_AV;

-- 1. Idempotent ALTER of pr_opportunities --------------------------------------
-- Sentinel on `origin`: all 027 columns are introduced together, so if `origin`
-- is missing we add the whole set; if present we skip (re-run safe).
SET @has_origin := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = 'shhdbite_AV'
     AND TABLE_NAME = 'pr_opportunities'
     AND COLUMN_NAME = 'origin'
);
SET @sql := IF(@has_origin = 0,
  'ALTER TABLE pr_opportunities
     ADD COLUMN origin VARCHAR(32) NOT NULL DEFAULT ''paste'',
     ADD COLUMN relevance_score TINYINT UNSIGNED NULL,
     ADD COLUMN suggested TINYINT(1) NOT NULL DEFAULT 0,
     ADD COLUMN discovered_at DATETIME NULL,
     ADD COLUMN dedupe_hash CHAR(64) NULL,
     ADD COLUMN linked_pitch_id BIGINT UNSIGNED NULL,
     ADD COLUMN linked_asset_id BIGINT UNSIGNED NULL,
     ADD COLUMN linked_outbox_id BIGINT UNSIGNED NULL,
     ADD KEY idx_origin_suggested (origin, suggested),
     ADD UNIQUE KEY uq_tenant_dedupe (tenant_id, dedupe_hash)',
  'SELECT ''027: pr_opportunities already extended -- skipped'' AS info'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 2. pr_discovery_sources ------------------------------------------------------
-- Per-tenant configuration for each discovery lane. `secret_ref` names the env
-- var holding any credential (never store the secret itself). `config_json`
-- holds lane-specific config (subreddits + keywords, RSS urls, mailbox name).
CREATE TABLE IF NOT EXISTS pr_discovery_sources (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL,
  kind ENUM('internal','email_inbox','reddit','rss') NOT NULL,
  config_json JSON NULL,
  secret_ref VARCHAR(128) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  last_run_at DATETIME NULL,
  last_status VARCHAR(32) NULL,
  last_detail VARCHAR(500) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_tenant_kind (tenant_id, kind),
  KEY idx_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. pr_ingestion_log ----------------------------------------------------------
-- One row per raw inbound item from any discovery lane, before/after parse.
-- dedupe_hash prevents the same journalist request creating duplicate
-- opportunities across repeated polls/forwards. Feeds future closed-loop learning.
CREATE TABLE IF NOT EXISTS pr_ingestion_log (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL,
  source_kind VARCHAR(32) NOT NULL,
  raw_text MEDIUMTEXT NULL,
  dedupe_hash CHAR(64) NULL,
  parsed_opportunity_id BIGINT UNSIGNED NULL,
  status ENUM('received','parsed','duplicate','failed') NOT NULL DEFAULT 'received',
  detail VARCHAR(500) NULL,
  received_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_tenant_status (tenant_id, status),
  KEY idx_dedupe (dedupe_hash),
  KEY idx_received (received_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- End of 027. Run once in phpMyAdmin against shhdbite_AV. Re-runnable.
-- Verify:
--   SHOW COLUMNS FROM pr_opportunities LIKE 'origin';
--   SHOW TABLES LIKE 'pr_discovery_sources';
--   SHOW TABLES LIKE 'pr_ingestion_log';
