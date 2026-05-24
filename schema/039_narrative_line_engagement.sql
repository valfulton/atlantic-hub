-- 039_narrative_line_engagement.sql
-- Engagement attribution for narrative lines: the start of the LEARNING LOOP.
-- Numbers can be entered MANUALLY today (source='manual') so we capture real
-- signal immediately, and a later "pull from socials" job will write rows with
-- source='pull' once the platform APIs are trusted (see task #45). Either way
-- the data lands in the same place and rolls up per line.
--
-- MySQL: run ONCE.

USE shhdbite_AV;

CREATE TABLE IF NOT EXISTS narrative_line_engagement (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL,
  narrative_line_id BIGINT UNSIGNED NOT NULL,        -- soft ref narrative_lanes.id
  campaign_id BIGINT UNSIGNED NULL,                  -- soft ref campaigns.id
  channel VARCHAR(40) NOT NULL DEFAULT 'other',      -- linkedin|facebook|instagram|blog|newsroom|email|other
  -- the window these numbers cover (a post's lifetime, a week, etc.)
  period_start DATE NULL,
  period_end DATE NULL,
  impressions INT NOT NULL DEFAULT 0,
  engagements INT NOT NULL DEFAULT 0,                 -- likes + comments + shares + reactions
  clicks INT NOT NULL DEFAULT 0,
  conversions INT NOT NULL DEFAULT 0,                 -- inquiries / replies / bookings attributed
  source ENUM('manual','pull') NOT NULL DEFAULT 'manual',
  note VARCHAR(500) NULL,
  created_by_user_id BIGINT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_line (narrative_line_id),
  KEY idx_tenant_line (tenant_id, narrative_line_id),
  KEY idx_campaign (campaign_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Verify:
--   SHOW TABLES LIKE 'narrative_line_engagement';
--   SELECT narrative_line_id, SUM(impressions), SUM(engagements), SUM(conversions)
--     FROM narrative_line_engagement GROUP BY narrative_line_id;
