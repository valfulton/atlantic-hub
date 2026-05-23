-- 036_campaigns_lanes.sql
-- The orchestration spine: NARRATIVE LANES (editable editorial pillars) and
-- CAMPAIGNS (coordinated pushes within a lane that group blog/social/commercial
-- output). This is "create intelligence once, distribute everywhere" made real:
-- every artifact carries a campaign_id, campaigns roll up into a lane.
--
-- MySQL: plain ADD COLUMN (no IF NOT EXISTS). Run ONCE.

USE shhdbite_AV;

-- Editable editorial pillars, per brand. The operator adds/renames/retires these.
CREATE TABLE IF NOT EXISTS narrative_lanes (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL,                 -- av | ebw | hh
  name VARCHAR(120) NOT NULL,
  description VARCHAR(500) NULL,
  accent VARCHAR(16) NULL,                          -- hex accent for the UI
  cadence_hint VARCHAR(120) NULL,                   -- e.g. "weekly", "around events"
  sort_order INT NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  archived_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_tenant_name (tenant_id, name),
  KEY idx_tenant_active (tenant_id, is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- A coordinated push within a lane. Optionally tied to a client lead.
CREATE TABLE IF NOT EXISTS campaigns (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL,
  lane_id BIGINT UNSIGNED NULL,                     -- soft ref narrative_lanes
  lead_id BIGINT UNSIGNED NULL,                     -- soft ref leads (client campaign)
  name VARCHAR(200) NOT NULL,
  goal VARCHAR(1000) NULL,                           -- the narrative / objective
  status ENUM('planning','active','paused','done') NOT NULL DEFAULT 'planning',
  archived_at DATETIME NULL,
  created_by_user_id BIGINT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_tenant_status (tenant_id, status),
  KEY idx_lane (lane_id),
  KEY idx_lead (lead_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Artifacts compile up into a campaign. (grok_imagine_assets already has
-- campaign_id from schema 035; social_outbox can be linked in a later phase.)
ALTER TABLE content_artifacts ADD COLUMN campaign_id BIGINT UNSIGNED NULL;
ALTER TABLE content_artifacts ADD KEY idx_campaign (campaign_id);

-- Seed a robust, editable starter set of lanes for Atlantic & Vine.
INSERT IGNORE INTO narrative_lanes (tenant_id, name, description, accent, cadence_hint, sort_order) VALUES
  ('av','Authority & Expertise','Thought leadership that shows we know this space.','#FF9C5B','weekly',1),
  ('av','Client Wins & Proof','Results, case studies, and social proof.','#56B870','as wins happen',2),
  ('av','Pain-Point Education','Address the audience''s recurring problems.','#5BA8FF','weekly',3),
  ('av','Seasonal & Timely','Holidays, seasons, events, and news hooks.','#FFC73D','around dates',4),
  ('av','Brand Story & Behind the Scenes','Humanize the brand: people, process, craft.','#C58BFF','monthly',5),
  ('av','Offers & Conversion','Promotions, packages, and clear calls to action.','#FF5A6E','around launches',6),
  ('av','Community & Partnerships','Local and industry relationships and collaborations.','#2DD4BF','as they arise',7);

-- Verify:
--   SHOW TABLES LIKE 'narrative_lanes';
--   SELECT name FROM narrative_lanes WHERE tenant_id='av' ORDER BY sort_order;
--   SHOW COLUMNS FROM content_artifacts LIKE 'campaign_id';
