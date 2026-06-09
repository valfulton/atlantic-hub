-- =====================================================================
-- Atlantic Hub -- Engagement kind on the membership layer (#551)
-- File:    schema/085_engagement_kind.sql
-- Target:  shhdbite_AV   (brand_members lives here, #101)
-- Run in:  HostGator phpMyAdmin -> shhdbite_AV -> SQL tab -> paste -> Go
-- =====================================================================
--
-- WHY HERE (not on clients): KIND belongs to the ENGAGEMENT, not the client.
-- One person/brand can carry several engagements over time, of different
-- kinds:
--   - Ron Elfenbein: Defense PR now -> Medical Practice Marketing after the win
--   - Adriana:       CBB + CLDA
--   - John White:    Campaign + Compass
-- Each engagement is a brand_members row (person <-> brand, #101). Putting
-- engagement_kind here means a brand's surface follows its CURRENT engagement,
-- and a client who graduates from one engagement to another just gets a new
-- row — clients stays a pure identity scope.
--
-- engagement_kind drives: welcome popover copy, dashboard hero, sidebar
-- pages, panel visibility, intake field filtering, and brief grounding.
-- Read by lib/client/engagement_kind.ts (ENGAGEMENT_KIND_CONFIG is the
-- source of truth for what each kind enables).
--
-- DEFAULT 'lead_gen' so every existing brand_members row keeps today's
-- behavior and no current surface changes until a kind is set explicitly.
--
-- NOTE (#550): the Campaign Cockpit's inferClientKind() stays as the fallback
-- for brands with no brand_members row yet — untouched by this migration.
--
-- IDEMPOTENT: guarded by an information_schema column check (058 house style).
-- =====================================================================

USE shhdbite_AV;
SET NAMES utf8mb4;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA='shhdbite_AV'
    AND TABLE_NAME='brand_members'
    AND COLUMN_NAME='engagement_kind');
SET @sql := IF(@c=0,
  "ALTER TABLE brand_members
     ADD COLUMN engagement_kind ENUM(
       'lead_gen',
       'defense_pr',
       'political_campaign',
       'luxury_hospitality',
       'book_pr'
     ) NOT NULL DEFAULT 'lead_gen'
       COMMENT 'Kind of engagement for this brand. Drives dashboard/welcome/intake/brief. See lib/client/engagement_kind.ts.'
     AFTER role",
  "SELECT 'brand_members.engagement_kind exists -- skipped' AS info");
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- =====================================================================
-- Backfill the three live non-lead-gen engagements.
--
-- CONFIRM SLUGS FIRST. The slugs below are from the handoff; live values
-- live only in `clients`. Run this SELECT and check the rows are right:
--
--   SELECT c.client_id, c.client_slug, c.client_name, c.industry,
--          bm.client_user_id, bm.role, bm.engagement_kind
--     FROM clients c
--     JOIN brand_members bm ON bm.client_id = c.client_id
--    WHERE c.client_slug IN ('elfenbein-defense','the-flame','john-white')
--       OR c.client_name LIKE '%Elfenbein%'
--       OR c.client_name LIKE '%Flame%'
--       OR c.client_name LIKE '%White%';
--
-- These UPDATEs set the kind for ALL members of the brand (the engagement
-- belongs to the brand, not one member). A non-matching slug updates zero
-- rows (safe no-op) — it will NOT mis-tag another brand. Everyone else stays
-- 'lead_gen' (the column default).
-- =====================================================================

UPDATE brand_members bm JOIN clients c ON c.client_id = bm.client_id
   SET bm.engagement_kind = 'defense_pr'
 WHERE c.client_slug = 'elfenbein-defense';

UPDATE brand_members bm JOIN clients c ON c.client_id = bm.client_id
   SET bm.engagement_kind = 'luxury_hospitality'
 WHERE c.client_slug = 'the-flame';

UPDATE brand_members bm JOIN clients c ON c.client_id = bm.client_id
   SET bm.engagement_kind = 'political_campaign'
 WHERE c.client_slug = 'john-white';   -- confirm slug (handoff flagged this one)

-- =====================================================================
-- VERIFY:
--   SELECT c.client_slug, c.client_name, bm.engagement_kind, COUNT(*) AS members
--     FROM brand_members bm JOIN clients c ON c.client_id = bm.client_id
--    GROUP BY c.client_slug, c.client_name, bm.engagement_kind
--    ORDER BY bm.engagement_kind, c.client_name;
-- =====================================================================
-- END 085_engagement_kind.sql
-- =====================================================================
