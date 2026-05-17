-- =====================================================================
-- Atlantic Hub -- unified system_events table
-- File:    schema/010_system_events.sql
-- Target:  shhdbite_AV
-- Run in:  HostGator phpMyAdmin -> shhdbite_AV -> SQL tab -> paste -> Go
--
-- ORDER: run AFTER schema/009_client_portal.sql (the client portal
-- session reserved 009). This file owns 010.
-- =====================================================================
--
-- WHAT THIS DOES
--   Creates one cross-cutting analytics + observability table.
--   Supplements (does NOT replace) the existing domain-specific event
--   tables:
--     lead_events          -- per-lead status changes, notes, tags
--     apollo_search_log    -- per-Apollo-call credit + outcome audit
--     hunter_credit_log    -- per-Hunter-call credit + outcome audit
--
--   system_events captures the cross-cutting events that don't belong
--   to any one domain table:
--     lead.created (across all 5 discovery sources)
--     lead.enriched, lead.enrichment_failed
--     ai.lead_scored, ai.audit_generated, ai.social_content_generated
--     ai.score_failed, ai.audit_failed
--     api.openai_error, api.apollo_error, api.rate_limited
--     workflow.failed
--     scoring.cron_run, scoring.cron_error
--
--   Used by /admin/events as the unified observability surface, and
--   eventually by the AI memory stream (Phase 2E).
--
-- IDEMPOTENT: every statement is guarded by information_schema checks
-- so this file is safe to re-run.
-- =====================================================================

USE shhdbite_AV;
SET NAMES utf8mb4;

-- ---------------------------------------------------------------------
-- 1. Create system_events table (only if it does not exist).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS system_events (
  id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  event_type        VARCHAR(64) NOT NULL
    COMMENT 'Dot-namespaced event name -- e.g. lead.created, ai.lead_scored, api.openai_error',
  organization_id   BIGINT UNSIGNED NULL
    COMMENT 'Tenant/organization scope; NULL for cross-tenant or operator-internal events',
  lead_id           BIGINT UNSIGNED NULL
    COMMENT 'Which lead this event is about; NULL for non-lead events',
  user_id           BIGINT UNSIGNED NULL
    COMMENT 'Acting admin user id; NULL for system / cron / API-triggered events',
  source            VARCHAR(64) NULL
    COMMENT 'Origin label -- apollo, google_places, instagram, csv, scrape, hunter, openai, scraper, cron',
  payload           JSON NULL
    COMMENT 'Free-form event-specific payload (status code, scores, tokens used, etc.)',
  status            ENUM('success','failure','partial','pending') NOT NULL DEFAULT 'success',
  execution_time_ms INT UNSIGNED NULL
    COMMENT 'How long the operation took, when measurable',
  error_message     VARCHAR(1000) NULL
    COMMENT 'Truncated error string when status=failure',
  created_at        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_event_type  (event_type),
  KEY idx_lead_id     (lead_id),
  KEY idx_status      (status),
  KEY idx_source      (source),
  KEY idx_created_at  (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 2. Idempotent index guards.
--    If the table already existed from an earlier run that did not have
--    all indexes (e.g. an older schema), add each one only when missing.
-- ---------------------------------------------------------------------
SET @idx_exists := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = 'shhdbite_AV' AND TABLE_NAME = 'system_events' AND INDEX_NAME = 'idx_event_type'
);
SET @sql := IF(@idx_exists = 0,
  "ALTER TABLE system_events ADD INDEX idx_event_type (event_type)",
  "SELECT 'idx_event_type already exists -- skipped' AS info");
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx_exists := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = 'shhdbite_AV' AND TABLE_NAME = 'system_events' AND INDEX_NAME = 'idx_lead_id'
);
SET @sql := IF(@idx_exists = 0,
  "ALTER TABLE system_events ADD INDEX idx_lead_id (lead_id)",
  "SELECT 'idx_lead_id already exists -- skipped' AS info");
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx_exists := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = 'shhdbite_AV' AND TABLE_NAME = 'system_events' AND INDEX_NAME = 'idx_status'
);
SET @sql := IF(@idx_exists = 0,
  "ALTER TABLE system_events ADD INDEX idx_status (status)",
  "SELECT 'idx_status already exists -- skipped' AS info");
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx_exists := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = 'shhdbite_AV' AND TABLE_NAME = 'system_events' AND INDEX_NAME = 'idx_source'
);
SET @sql := IF(@idx_exists = 0,
  "ALTER TABLE system_events ADD INDEX idx_source (source)",
  "SELECT 'idx_source already exists -- skipped' AS info");
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx_exists := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = 'shhdbite_AV' AND TABLE_NAME = 'system_events' AND INDEX_NAME = 'idx_created_at'
);
SET @sql := IF(@idx_exists = 0,
  "ALTER TABLE system_events ADD INDEX idx_created_at (created_at)",
  "SELECT 'idx_created_at already exists -- skipped' AS info");
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- =====================================================================
-- VERIFICATION (paste each separately)
-- =====================================================================
-- 1. Confirm the table exists and is empty:
-- SELECT COUNT(*) AS n FROM system_events;
--
-- 2. Confirm the schema:
-- SHOW CREATE TABLE system_events;
--
-- 3. After running a Discover Places search, recent activity:
-- SELECT created_at, event_type, source, status, lead_id, execution_time_ms
--   FROM system_events
--   ORDER BY created_at DESC
--   LIMIT 25;
--
-- 4. Per-source counts (last 24h):
-- SELECT source, event_type, status, COUNT(*) AS n
--   FROM system_events
--   WHERE created_at > DATE_SUB(NOW(), INTERVAL 1 DAY)
--   GROUP BY source, event_type, status
--   ORDER BY n DESC;
-- =====================================================================
-- END 010_system_events.sql
-- =====================================================================
