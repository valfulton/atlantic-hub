-- =====================================================================
-- Atlantic Hub — Atlantic & Vine Tenant Detail Tables
-- File: schema/004_av_detail.sql
-- Target DB: shhdbite_av  (ADDS to existing DB, does not drop anything)
-- Run in: HostGator cPanel → phpMyAdmin → shhdbite_av → SQL tab
-- Run AFTER: 001_platform.sql + 003_seed.sql have been applied to
--            shhdbite_atlantic_hub. This file is independent of 002.
-- =====================================================================
--
-- These are the per-tenant detail tables for Atlantic & Vine — the
-- LinkedIn lead-pipeline / client-portal product.
--
-- Naming convention: NO `av_` prefix. Tables live in `shhdbite_av`,
-- which already supplies the namespace — same convention as
-- 002_hh_detail.sql uses for the HH tables (subscribers,
-- fap_applications, …) in shhdbite_hunterhoney.
--
-- ID convention:
--   - Internal PKs: BIGINT UNSIGNED AUTO_INCREMENT (matches HH detail).
--   - Public-facing reference IDs on `leads`: CHAR(36) UUID (`audit_id`).
--   - Cross-DB person identity (future): an optional CHAR(26) ULID
--     column on `leads` will point at shhdbite_atlantic_hub.accounts —
--     deferred to v2 when a lead converts to a platform account.
--
-- Naming — `clients` (NOT `accounts`):
--   RESOLVED: this is named `clients` (not `accounts`) precisely
--   because the platform DB has its own `accounts` table with a
--   different concept (per-person canonical record). Code:
--   shhdbite_av.clients = per-business; shhdbite_atlantic_hub.accounts
--   = per-person.
--
-- Kill switch:
--   `clients.enabled = 0` disables an AV client. Enforcement is in the
--   application layer (every API route filters by enabled = 1 before
--   touching any data). MySQL does NOT enforce it via constraint.
--
-- GDPR:
--   Every child table has ON DELETE CASCADE from `clients`. Removing
--   an AV client wipes all their leads / notes / events / etc.
--   `clients.retention_days` documents the per-client retention policy
--   (default 730d = 2y). A v2 cron will purge stale rows.
-- =====================================================================

USE shhdbite_av;

SET NAMES utf8mb4;
SET time_zone = '+00:00';

-- =====================================================================
-- clients: one row per AV client (the business paying for the portal)
-- =====================================================================
-- This is per-business, NOT per-person. The platform-level person record
-- lives in shhdbite_atlantic_hub.accounts; do not conflate.
--
-- Seed row: 'av-internal' = Val's own internal client. Inserted at the
-- bottom of this file with INSERT IGNORE.
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
-- pipeline_stages: per-client pipeline columns (New, Contacted, …)
-- =====================================================================
-- stage_key is the stable identifier the application uses (e.g., 'new').
-- stage_name is the operator-editable label shown in the UI.
-- is_terminal = TRUE for won/lost/dead stages — those rows don't count
-- toward the active pipeline.
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
-- leads: one row per LinkedIn lead, scoped to an AV client
-- =====================================================================
-- AI scoring columns are FIRST-CLASS and non-negotiable — every list
-- query in the dashboard returns them. Score history lives in
-- lead_events, but the *current* score, band, reason, breakdown, audit,
-- and email draft sit here.
--
-- Dedupe: (client_id, linkedin_url) is UNIQUE. The same person across
-- two different AV clients is two rows — that's the multi-tenant story.
--
-- audit_id is a public-facing CHAR(36) UUID used in URLs and logs so we
-- never expose the internal BIGINT PK.
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

  -- AI scoring (non-negotiable — these are the product story)
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
-- lead_notes: shared notes thread between Val and the AV client
-- =====================================================================
-- Separated from lead_events so the dashboard can render a clean
-- chronological thread without joining audit rows.
--
-- author_user_id is shhdbite_atlantic_hub.admin_users.user_id. Cross-DB,
-- so no SQL FK — the application layer enforces it.
--
-- author_role is a SNAPSHOT at write time. Notably this is NOT the same
-- enum as the platform admin_users.role ('owner','staff','client_user').
-- The note thread has a domain-specific actor vocabulary:
--   owner       = Val (snapshot of platform 'owner' role)
--   operator    = Hub staff member writing on Val's behalf
--                 (snapshot of platform 'staff' role)
--   client_user = the AV client's seat (snapshot of platform 'client_user')
--   system      = automated event (e.g., AI scoring run injected a note)
-- The mapping platform-role → note-role happens in the API route layer.
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
-- lead_events: append-only domain audit log for every lead-level change
-- =====================================================================
-- This is the per-tenant business event log. Distinct from the
-- platform-level audit_log_global (which tracks API-call-level events).
-- The next-session API helper should write BOTH on every mutation:
--   1. lead_events row here (rich domain payload, kept long-term)
--   2. audit_log_global row in shhdbite_atlantic_hub (PII-scrubbed,
--      compliance evidence)
--
-- actor_user_id is platform admin_users.user_id (cross-DB, app-enforced).
-- actor_role is a SNAPSHOT of the platform role at event time.
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
-- DORMANT TABLES — schema in v1, UI/API in v2 (digest-email feature)
-- =====================================================================
-- The three tables below are NOT touched by v1 application code. They
-- exist now so v2 can build on a stable schema without re-migrating
-- live data. Mark them NOT IN USE in any v2 doc until the digest-email
-- feature lands.
-- =====================================================================

-- ---------------------------------------------------------------------
-- client_icps: Ideal Customer Profile per AV client
-- ---------------------------------------------------------------------
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
  updated_by_user_id         BIGINT UNSIGNED NULL,  -- platform admin_users.user_id (app-enforced)
  UNIQUE KEY uq_client (client_id),
  CONSTRAINT fk_icps_client FOREIGN KEY (client_id)
    REFERENCES clients(client_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- content_recommendations: outbound content the system suggests
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS content_recommendations (
  content_recommendation_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  client_id                 BIGINT UNSIGNED NOT NULL,
  content_url               VARCHAR(800) NOT NULL,
  content_title             VARCHAR(500) NOT NULL,
  content_summary           TEXT NULL,
  recommended_for_topics    JSON NULL,
  source                    VARCHAR(120) NULL,
  delivered_in_email_id     BIGINT UNSIGNED NULL,  -- FK populated when sent (app-enforced; see email_sends)
  archived_at               DATETIME NULL,
  created_at                DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_client_time (client_id, created_at),
  CONSTRAINT fk_recs_client FOREIGN KEY (client_id)
    REFERENCES clients(client_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- email_sends: every digest email sent to an AV client
-- ---------------------------------------------------------------------
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
-- SEED — Val's internal AV client + default pipeline stages
-- =====================================================================
-- Idempotent via INSERT IGNORE on the UNIQUE keys. client_uuid uses
-- MySQL's UUID() so re-runs after a manual DELETE will pick a new value.
--
-- Note: the client_uuid below is generated at INSERT time. If you need
-- a deterministic UUID for testing, replace UUID() with a string literal
-- before running.
-- =====================================================================
INSERT IGNORE INTO clients (client_uuid, client_name, client_slug, industry, enabled, plan_tier)
  VALUES (UUID(), 'Atlantic & Vine (Val)', 'av-internal', 'agency-internal', TRUE, 'owner');

-- Pull Val's client_id once, then seed the 6 default stages.
-- INSERT IGNORE on uq_client_stage_key (client_id, stage_key) keeps it idempotent.
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
-- SMOKE TESTS — paste into phpMyAdmin → shhdbite_av → SQL after running
-- =====================================================================
-- 1. All 8 AV tables exist (5 active + 3 dormant):
--    SELECT table_name FROM information_schema.tables
--    WHERE table_schema = DATABASE()
--      AND table_name IN (
--        'clients','pipeline_stages','leads','lead_notes','lead_events',
--        'client_icps','content_recommendations','email_sends'
--      )
--    ORDER BY table_name;
--    -- expect: 8 rows
--
-- 2. Seed: av-internal client exists with 6 pipeline stages:
--    SELECT c.client_slug, COUNT(s.pipeline_stage_id) AS stage_count
--      FROM clients c
--      LEFT JOIN pipeline_stages s ON s.client_id = c.client_id
--    WHERE c.client_slug = 'av-internal'
--    GROUP BY c.client_id;
--    -- expect: 1 row, stage_count = 6
--
-- 3. FK chain + cascade (run as one block, then verify cleanup):
--    SET @cid = (SELECT client_id FROM clients WHERE client_slug = 'av-internal');
--    INSERT INTO leads (client_id, audit_id, full_name, source_type)
--      VALUES (@cid, UUID(), 'Smoke Test Lead', 'manual');
--    SET @lid = LAST_INSERT_ID();
--    INSERT INTO lead_events (client_id, lead_id, event_type, event_payload)
--      VALUES (@cid, @lid, 'created', JSON_OBJECT('source','smoke-test'));
--    INSERT INTO lead_notes (client_id, lead_id, author_role, body)
--      VALUES (@cid, @lid, 'system', 'smoke-test note');
--    -- verify rows are joinable:
--    SELECT l.lead_id, l.full_name,
--           (SELECT COUNT(*) FROM lead_events WHERE lead_id = l.lead_id) AS event_count,
--           (SELECT COUNT(*) FROM lead_notes  WHERE lead_id = l.lead_id) AS note_count
--      FROM leads l WHERE l.lead_id = @lid;
--    -- expect: 1 row with event_count=1, note_count=1
--
-- 4. Cascade test — deleting the lead removes the events and notes:
--    DELETE FROM leads WHERE lead_id = @lid;
--    SELECT
--      (SELECT COUNT(*) FROM lead_events WHERE lead_id = @lid) AS orphan_events,
--      (SELECT COUNT(*) FROM lead_notes  WHERE lead_id = @lid) AS orphan_notes;
--    -- expect: 0, 0
--
-- 5. Kill switch — flip and verify (application enforces, but this
--    proves the column accepts the flip):
--    UPDATE clients SET enabled = FALSE WHERE client_slug = 'av-internal';
--    SELECT client_slug, enabled FROM clients WHERE client_slug = 'av-internal';
--    -- expect: enabled = 0
--    UPDATE clients SET enabled = TRUE  WHERE client_slug = 'av-internal';
-- =====================================================================
-- END 004_av_detail.sql
-- =====================================================================
