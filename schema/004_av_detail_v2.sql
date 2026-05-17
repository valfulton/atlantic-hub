-- =====================================================================
-- Atlantic Hub — Atlantic & Vine Portal Detail Tables (Path C v2)
-- File: schema/004_av_detail_v2.sql
-- Target DB: shhdbite_av_portal  (NEW database — must be created first)
-- Run in: HostGator cPanel → phpMyAdmin → shhdbite_av_portal → SQL tab
-- =====================================================================
--
-- REVISION HISTORY:
--   v1 (003 in this folder, dated session 2 morning): DEPRECATED. That
--   file targeted `shhdbite_av` (lowercase, non-existent) and would
--   have collided with `shhdbite_AV.leads` (12 live rows) via
--   `CREATE TABLE IF NOT EXISTS leads` silently no-opping. DO NOT
--   APPLY the v1 file. It will be archived after Val confirms v2.
--
--   v2 (THIS FILE): Path C. Portal tables live in a NEW database
--   `shhdbite_av_portal`, completely separate from the live AV
--   marketing-site DB `shhdbite_AV`. Zero risk of touching the 12
--   live audit-form leads, 4 client_intakes, or 2 client_pop_journey
--   rows in the marketing-site DB.
--
-- =====================================================================
-- PRE-STEP — required BEFORE running this file
-- =====================================================================
--   1. HostGator cPanel → MySQL Databases → "Create New Database"
--      Name: shhdbite_av_portal
--   2. Create a new MySQL user for the portal DB, scoped to that DB
--      only. Do NOT reuse the user that has access to shhdbite_AV.
--      User: shhdbite_avportaluser  (or similar)
--      Privilege: ALL PRIVILEGES on shhdbite_av_portal.* only
--   3. Note the user + password — they go into Netlify env vars
--      DB_USER_AV and DB_PASS_AV.
--   4. Open phpMyAdmin → select shhdbite_av_portal → SQL tab → paste
--      this file → Go.
--   5. Run the 5 smoke tests at the bottom.
-- =====================================================================
--
-- Naming: NO `av_` prefix. Tables live in a per-product DB which
-- supplies the namespace — same convention as 002_hh_detail.sql.
--
-- ID convention: BIGINT UNSIGNED PKs (internal), CHAR(36) UUIDs for
-- public-facing reference IDs.
--
-- Why `clients` (not `accounts`): the platform DB
-- (shhdbite_atlantic_hub) has its own `accounts` table for per-person
-- canonical identity. The portal's `clients` is per-business.
-- Different DB, different concept.
--
-- Kill switch: `clients.enabled = 0`. Application-layer enforcement.
--
-- GDPR: every child table has ON DELETE CASCADE from `clients`.
-- `clients.retention_days` documents per-client retention.
-- =====================================================================

USE shhdbite_av_portal;

SET NAMES utf8mb4;
SET time_zone = '+00:00';

-- =====================================================================
-- clients: one row per AV portal client (a business paying for the portal)
-- =====================================================================
-- This is NOT the platform-level person record (shhdbite_atlantic_hub.accounts)
-- and NOT the legacy AV marketing-site CRM (which lives in shhdbite_AV
-- with different tables and a different purpose).
-- =====================================================================
CREATE TABLE IF NOT EXISTS clients (
  client_id         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  client_uuid       CHAR(36) NOT NULL,
  client_name       VARCHAR(255) NOT NULL,
  client_slug       VARCHAR(120) NOT NULL,
  industry          VARCHAR(120) NULL,
  enabled           BOOLEAN NOT NULL DEFAULT TRUE,
  retention_days    INT NOT NULL DEFAULT 730,
  plan_tier         ENUM('sprint','momentum','scale','owner') NOT NULL DEFAULT 'sprint',
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  archived_at       DATETIME NULL,
  UNIQUE KEY uq_client_uuid (client_uuid),
  UNIQUE KEY uq_client_slug (client_slug),
  KEY idx_enabled (enabled)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================================
-- pipeline_stages: per-client pipeline columns
-- =====================================================================
CREATE TABLE IF NOT EXISTS pipeline_stages (
  pipeline_stage_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  client_id         BIGINT UNSIGNED NOT NULL,
  stage_key         VARCHAR(40) NOT NULL,
  stage_name        VARCHAR(80) NOT NULL,
  stage_order       INT NOT NULL,
  is_terminal       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  archived_at       DATETIME NULL,
  UNIQUE KEY uq_client_stage_key (client_id, stage_key),
  KEY idx_client_order (client_id, stage_order),
  CONSTRAINT fk_stages_client FOREIGN KEY (client_id)
    REFERENCES clients(client_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================================
-- leads: one row per LinkedIn lead, scoped to an AV portal client
-- =====================================================================
-- NOTE: there is also a `leads` table in shhdbite_AV (the legacy AV
-- marketing-site CRM, capturing inbound audit-form prospects). That
-- table has 12 live rows and is unrelated to this one. The two live
-- in different databases and never JOIN.
--
-- AI scoring columns are FIRST-CLASS and non-negotiable.
-- =====================================================================
CREATE TABLE IF NOT EXISTS leads (
  lead_id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  client_id          BIGINT UNSIGNED NOT NULL,
  audit_id           CHAR(36) NOT NULL,
  pipeline_stage_id  BIGINT UNSIGNED NULL,

  -- Identity
  full_name          VARCHAR(255) NOT NULL,
  title              VARCHAR(255) NULL,
  company            VARCHAR(255) NULL,
  location           VARCHAR(255) NULL,
  email              VARCHAR(255) NULL,
  phone              VARCHAR(40)  NULL,
  linkedin_url       VARCHAR(500) NULL,

  -- AI scoring (non-negotiable)
  ai_score           TINYINT UNSIGNED NULL,
  ai_score_band      ENUM('hot','warm','cool') NULL,
  ai_score_reason    TEXT NULL,
  ai_score_breakdown JSON NULL,
  ai_audit           JSON NULL,
  ai_email_subject   VARCHAR(255) NULL,
  ai_email_body      TEXT NULL,
  ai_last_scored_at  DATETIME NULL,
  ai_model_version   VARCHAR(60) NULL,

  -- Source / provenance
  source_type        ENUM('csv','scrape','manual','api') NOT NULL DEFAULT 'manual',
  source_payload     JSON NULL,
  imported_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  imported_by_user_id BIGINT UNSIGNED NULL,  -- shhdbite_atlantic_hub.admin_users.user_id (app-enforced FK)

  -- Operator workspace
  tags               JSON NULL,
  last_activity_at   DATETIME NULL,
  consent_basis      VARCHAR(60) NULL,

  -- Lifecycle
  archived_at        DATETIME NULL,
  created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY uq_audit_id (audit_id),
  UNIQUE KEY uq_client_linkedin (client_id, linkedin_url),
  KEY idx_client_stage    (client_id, pipeline_stage_id),
  KEY idx_client_score    (client_id, ai_score),
  KEY idx_client_activity (client_id, last_activity_at),
  KEY idx_client_archived (client_id, archived_at),
  KEY idx_email           (email),
  CONSTRAINT fk_leads_client FOREIGN KEY (client_id)
    REFERENCES clients(client_id) ON DELETE CASCADE,
  CONSTRAINT fk_leads_stage FOREIGN KEY (pipeline_stage_id)
    REFERENCES pipeline_stages(pipeline_stage_id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================================
-- lead_notes: shared notes thread between Val and the AV portal client
-- =====================================================================
CREATE TABLE IF NOT EXISTS lead_notes (
  lead_note_id      BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  client_id         BIGINT UNSIGNED NOT NULL,
  lead_id           BIGINT UNSIGNED NOT NULL,
  author_user_id    BIGINT UNSIGNED NULL,  -- platform admin_users.user_id (app-enforced FK)
  author_role       ENUM('owner','operator','client_user','system') NOT NULL,
  body              TEXT NOT NULL,
  is_internal       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_lead_time   (lead_id, created_at),
  KEY idx_client_time (client_id, created_at),
  CONSTRAINT fk_notes_client FOREIGN KEY (client_id)
    REFERENCES clients(client_id) ON DELETE CASCADE,
  CONSTRAINT fk_notes_lead FOREIGN KEY (lead_id)
    REFERENCES leads(lead_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================================
-- lead_events: per-tenant business event log
-- =====================================================================
CREATE TABLE IF NOT EXISTS lead_events (
  lead_event_id     BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  client_id         BIGINT UNSIGNED NOT NULL,
  lead_id           BIGINT UNSIGNED NOT NULL,
  event_type        ENUM(
    'created','stage_changed','note_added','tag_added','tag_removed',
    'archived','exported','deleted','ai_scored','ai_audited',
    'ai_email_drafted','email_opened','email_clicked'
  ) NOT NULL,
  event_payload     JSON NULL,
  actor_user_id     BIGINT UNSIGNED NULL,
  actor_role        VARCHAR(40) NULL,
  occurred_at       DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_lead_time   (lead_id, occurred_at),
  KEY idx_client_time (client_id, occurred_at),
  KEY idx_event_type  (event_type),
  CONSTRAINT fk_events_client FOREIGN KEY (client_id)
    REFERENCES clients(client_id) ON DELETE CASCADE,
  CONSTRAINT fk_events_lead FOREIGN KEY (lead_id)
    REFERENCES leads(lead_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================================
-- DORMANT TABLES — v2 digest-email feature (schema only in v1)
-- =====================================================================

CREATE TABLE IF NOT EXISTS client_icps (
  client_icp_id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  client_id                  BIGINT UNSIGNED NOT NULL,
  target_industries          JSON NULL,
  target_titles              JSON NULL,
  target_company_size_min    INT NULL,
  target_company_size_max    INT NULL,
  target_geographies         JSON NULL,
  content_topics_of_interest JSON NULL,
  excluded_topics            JSON NULL,
  description                TEXT NULL,
  updated_at                 DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  updated_by_user_id         BIGINT UNSIGNED NULL,
  UNIQUE KEY uq_client (client_id),
  CONSTRAINT fk_icps_client FOREIGN KEY (client_id)
    REFERENCES clients(client_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS content_recommendations (
  content_recommendation_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  client_id                 BIGINT UNSIGNED NOT NULL,
  content_url               VARCHAR(800) NOT NULL,
  content_title             VARCHAR(500) NOT NULL,
  content_summary           TEXT NULL,
  recommended_for_topics    JSON NULL,
  source                    VARCHAR(120) NULL,
  delivered_in_email_id     BIGINT UNSIGNED NULL,
  archived_at               DATETIME NULL,
  created_at                DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_client_time (client_id, created_at),
  CONSTRAINT fk_recs_client FOREIGN KEY (client_id)
    REFERENCES clients(client_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS email_sends (
  email_send_id       BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  client_id           BIGINT UNSIGNED NOT NULL,
  recipient_email     VARCHAR(255) NOT NULL,
  subject             VARCHAR(500) NOT NULL,
  template_name       VARCHAR(120) NULL,
  recommendation_ids  JSON NULL,
  sent_at             DATETIME NULL,
  delivery_status     ENUM('pending','sent','bounced','complained','failed') NOT NULL DEFAULT 'pending',
  provider_message_id VARCHAR(200) NULL,
  opened_at           DATETIME NULL,
  clicked_at          DATETIME NULL,
  created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_client_time (client_id, created_at),
  KEY idx_status      (delivery_status),
  CONSTRAINT fk_sends_client FOREIGN KEY (client_id)
    REFERENCES clients(client_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================================
-- SEED — Val's internal AV portal client + default pipeline stages
-- =====================================================================
INSERT IGNORE INTO clients (client_uuid, client_name, client_slug, industry, enabled, plan_tier)
  VALUES (UUID(), 'Atlantic & Vine (Val)', 'av-internal', 'agency-internal', TRUE, 'owner');

INSERT IGNORE INTO pipeline_stages (client_id, stage_key, stage_name, stage_order, is_terminal)
SELECT c.client_id, t.stage_key, t.stage_name, t.stage_order, t.is_terminal
FROM clients c
CROSS JOIN (
  SELECT 'new'       AS stage_key, 'New'       AS stage_name, 1 AS stage_order, FALSE AS is_terminal
  UNION ALL SELECT 'contacted','Contacted', 2, FALSE
  UNION ALL SELECT 'qualified','Qualified', 3, FALSE
  UNION ALL SELECT 'proposal', 'Proposal',  4, FALSE
  UNION ALL SELECT 'won',      'Won',       5, TRUE
  UNION ALL SELECT 'lost',     'Lost',      6, TRUE
) t
WHERE c.client_slug = 'av-internal';

-- =====================================================================
-- SMOKE TESTS — paste into phpMyAdmin → shhdbite_av_portal → SQL
-- =====================================================================
-- 1. Confirm DB targeting (you should see shhdbite_av_portal, NOT shhdbite_AV):
--    SELECT DATABASE();
--
-- 2. All 8 portal tables exist:
--    SELECT table_name FROM information_schema.tables
--    WHERE table_schema = 'shhdbite_av_portal'
--    ORDER BY table_name;
--    -- expect: clients, client_icps, content_recommendations, email_sends,
--    --         lead_events, lead_notes, leads, pipeline_stages (8 rows)
--
-- 3. Seed: av-internal client + 6 stages:
--    SELECT c.client_slug, COUNT(s.pipeline_stage_id) AS stage_count
--      FROM clients c
--      LEFT JOIN pipeline_stages s ON s.client_id = c.client_id
--    WHERE c.client_slug = 'av-internal'
--    GROUP BY c.client_id;
--    -- expect: 1 row, stage_count = 6
--
-- 4. FK chain + cascade smoke test:
--    SET @cid = (SELECT client_id FROM clients WHERE client_slug = 'av-internal');
--    INSERT INTO leads (client_id, audit_id, full_name, source_type)
--      VALUES (@cid, UUID(), 'Smoke Test Lead', 'manual');
--    SET @lid = LAST_INSERT_ID();
--    INSERT INTO lead_events (client_id, lead_id, event_type, event_payload)
--      VALUES (@cid, @lid, 'created', JSON_OBJECT('source','smoke-test'));
--    INSERT INTO lead_notes (client_id, lead_id, author_role, body)
--      VALUES (@cid, @lid, 'system', 'smoke-test note');
--    SELECT l.lead_id,
--           (SELECT COUNT(*) FROM lead_events WHERE lead_id = l.lead_id) AS evt,
--           (SELECT COUNT(*) FROM lead_notes  WHERE lead_id = l.lead_id) AS note
--      FROM leads l WHERE l.lead_id = @lid;
--    -- expect: 1 row, evt=1, note=1
--
-- 5. Cascade cleanup test:
--    DELETE FROM leads WHERE lead_id = @lid;
--    SELECT (SELECT COUNT(*) FROM lead_events WHERE lead_id = @lid) AS orphan_evt,
--           (SELECT COUNT(*) FROM lead_notes  WHERE lead_id = @lid) AS orphan_note;
--    -- expect: 0, 0
--
-- 6. Confirm the LEGACY AV DB is untouched:
--    USE shhdbite_AV;
--    SELECT COUNT(*) FROM leads;  -- expect: 12 (unchanged)
--    SELECT COUNT(*) FROM client_intakes; -- expect: 4 (unchanged)
--    SELECT COUNT(*) FROM client_pop_journey; -- expect: 2 (unchanged)
-- =====================================================================
-- END 004_av_detail_v2.sql
-- =====================================================================
