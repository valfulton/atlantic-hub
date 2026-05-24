-- 040_narrative_line_owner.sql
-- Give a narrative line a CUSTOMER OWNER so the cockpit can scope by customer
-- and a client dashboard can pull its own lines.
--
-- Ownership model (one clean axis, same table — no duplication):
--   tenant_id  -> which brand context the line lives in: 'av' | 'ebw' | 'hh'
--   client_id  -> NULL  = a HOUSE line owned by that brand/operator
--                 >0    = owned by that specific client account (clients.client_id)
--
-- Leads are NOT owners; they are the audience, reached through campaigns
-- (campaign.lane_id -> line; campaign_leads -> the targeted leads).
--
-- MySQL: plain ADD COLUMN. Run ONCE. Existing rows get client_id = NULL
-- (house lines), so the current AV cockpit is unchanged.

USE shhdbite_AV;

ALTER TABLE narrative_lanes
  ADD COLUMN client_id BIGINT UNSIGNED NULL AFTER tenant_id;   -- soft ref clients.client_id

ALTER TABLE narrative_lanes
  ADD KEY idx_owner (tenant_id, client_id, state);

-- Engagement rows can also carry the owning client for fast per-customer rollups.
ALTER TABLE narrative_line_engagement
  ADD COLUMN client_id BIGINT UNSIGNED NULL AFTER tenant_id;

-- Verify:
--   SHOW COLUMNS FROM narrative_lanes LIKE 'client_id';
--   SELECT tenant_id, client_id, COUNT(*) FROM narrative_lanes GROUP BY tenant_id, client_id;
