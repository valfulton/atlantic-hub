-- 037_campaign_leads.sql
-- A campaign targets MANY leads (and a lead can be in many campaigns). This is
-- what lets a campaign sweep up every business sharing a pain point, instead of
-- being tied to one lead. Replaces the single campaigns.lead_id notion (that
-- column stays for an optional "primary" but the join is the source of truth for
-- targeting + the client cockpit).
--
-- MySQL. Run ONCE.

USE shhdbite_AV;

CREATE TABLE IF NOT EXISTS campaign_leads (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  campaign_id BIGINT UNSIGNED NOT NULL,
  lead_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_campaign_lead (campaign_id, lead_id),
  KEY idx_campaign (campaign_id),
  KEY idx_lead (lead_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Backfill: any campaign that already had a single lead_id becomes a target row.
INSERT IGNORE INTO campaign_leads (campaign_id, lead_id)
  SELECT id, lead_id FROM campaigns WHERE lead_id IS NOT NULL AND archived_at IS NULL;

-- Verify:
--   SHOW TABLES LIKE 'campaign_leads';
--   SELECT campaign_id, COUNT(*) FROM campaign_leads GROUP BY campaign_id;
