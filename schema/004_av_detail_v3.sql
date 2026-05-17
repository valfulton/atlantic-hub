-- =====================================================================
-- Atlantic Hub — Atlantic & Vine Portal Detail (Path B-lite, v3)
-- File:    schema/004_av_detail_v3.sql
-- Target:  shhdbite_AV  (UPPERCASE — the live AV marketing-site DB)
-- Run in:  HostGator cPanel → phpMyAdmin → shhdbite_AV → SQL tab
-- =====================================================================
--
-- DESIGN (Path B-lite, decided by Val 2026-05-12 evening):
--   The existing `leads` table in shhdbite_AV is the source of truth.
--   It currently holds 12 live rows captured from the audit form at
--   atlanticandvine.com. The portal reads + writes that same table —
--   the existing audit-form data IS the portal's demo data.
--
--   This migration:
--     1. ADDs new columns to `leads` (no rename, no drop, no type
--        change on any existing column). All additive, all nullable
--        or default so the existing PHP INSERT/UPDATE statements
--        continue working byte-identical.
--     2. CREATEs 7 new portal tables (clients, pipeline_stages,
--        lead_notes, lead_events, client_icps, content_recommendations,
--        email_sends). Zero name collision with existing tables.
--     3. ADDs FK constraints from leads → clients and leads →
--        pipeline_stages with ON DELETE SET NULL — deleting a client
--        does NOT delete the existing audit-form leads. They simply
--        become "unassigned" (client_id NULL = Val's own audit-form
--        pipeline).
--
--   ZERO PHP changes required. The live audit form, intake form, and
--   pop-journey endpoints continue writing to shhdbite_AV exactly as
--   they do today.
--
-- WHY PATH C WAS WRONG (previous v2 file):
--   Path C put the portal in a brand-new isolated DB. That would have
--   given the portal an empty CRM at demo time — defeating the purpose,
--   which is for Val to show clients real activity already happening
--   for their own business.
--
-- IDEMPOTENCY:
--   THIS MIGRATION IS NOT IDEMPOTENT.
--   - `ALTER TABLE … ADD COLUMN` fails on re-run with "Duplicate column".
--   - `ALTER TABLE … ADD CONSTRAINT` fails on re-run with "Duplicate FK".
--   Designed to be run ONCE, after a fresh DB backup. To re-run,
--   restore from backup first. The CREATE TABLE statements DO use
--   IF NOT EXISTS for safety.
--
-- PRE-STEPS — required BEFORE running this file:
--   1. phpMyAdmin → shhdbite_AV → Export → Quick → SQL → Go.
--      Save the backup .sql file locally. Verified by trying to open
--      it: it should contain CREATE TABLE leads … and 12 INSERT lines.
--   2. Confirm the live `leads` schema matches Section A below by
--      running:  SHOW CREATE TABLE leads;
--      If the live schema has DRIFTED from database-schema.sql
--      (manual ALTERs in phpMyAdmin since the original), STOP and
--      adjust this file accordingly.
--   3. Confirm the row count:  SELECT COUNT(*) FROM leads;
--      Expect 12. If higher, that's fine (new leads have come in
--      since the screenshot). If lower than 12, find out why before
--      proceeding.
-- =====================================================================

USE shhdbite_AV;

SET NAMES utf8mb4;
SET time_zone = '+00:00';

-- =====================================================================
-- SECTION A — Expected state of the live `leads` table BEFORE migration
-- =====================================================================
-- (For reference only — does not execute. Verify with SHOW CREATE TABLE.)
-- --------------------------------------------------------------------
-- CREATE TABLE leads (
--   id              INT AUTO_INCREMENT PRIMARY KEY,
--   company         VARCHAR(255) NOT NULL,
--   website         VARCHAR(500),
--   industry        VARCHAR(100),
--   contact_name    VARCHAR(255),
--   email           VARCHAR(255) NOT NULL UNIQUE,
--   phone           VARCHAR(20),
--   challenge       TEXT,
--   audit_content   LONGTEXT,
--   audit_generated DATETIME,
--   is_approved     TINYINT DEFAULT 0,
--   approval_date   DATETIME,
--   approved_by     VARCHAR(255),
--   submission_date DATETIME DEFAULT CURRENT_TIMESTAMP,
--   lead_status     ENUM('new','contacted','qualified','converted','lost') DEFAULT 'new',
--   follow_up_date  DATETIME,
--   notes           TEXT,
--   created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
--   updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
--   INDEX idx_email (email),
--   INDEX idx_industry (industry),
--   INDEX idx_submission_date (submission_date),
--   INDEX idx_status (lead_status)
-- );
-- --------------------------------------------------------------------
-- This migration MUST preserve every column above byte-for-byte.
-- =====================================================================

-- =====================================================================
-- SECTION B — ALTER TABLE leads (additive only)
-- =====================================================================
-- Add 18 new columns and 6 new indexes. No rename, no drop, no type
-- change on any existing column. Each ADD COLUMN is NULLable or has
-- a default so existing audit-form INSERT (8 columns) continues to
-- work unchanged.
--
-- NOTE: FK constraints for client_id and pipeline_stage_id are NOT
-- added here — those parent tables don't exist yet. The FKs are
-- added in Section D, after the parents are created.
-- =====================================================================

ALTER TABLE leads
  ADD COLUMN client_id BIGINT UNSIGNED NULL
    COMMENT 'FK to clients.client_id; NULL means audit-form lead (Val''s own business pipeline)',
  ADD COLUMN pipeline_stage_id BIGINT UNSIGNED NULL
    COMMENT 'FK to pipeline_stages.pipeline_stage_id',
  ADD COLUMN audit_id CHAR(36) NULL
    COMMENT 'Public-facing UUID for portal URLs; backfilled for existing rows in Section C',
  ADD COLUMN source_type ENUM('audit_form','csv','scrape','manual','api')
    NOT NULL DEFAULT 'audit_form'
    COMMENT 'Where the lead came from. Existing 12 rows correctly default to audit_form.',
  ADD COLUMN source_payload JSON NULL
    COMMENT 'Raw inbound row / forensic audit trail for non-audit_form leads',

  -- AI scoring (non-negotiable — the portal product story)
  ADD COLUMN ai_score TINYINT UNSIGNED NULL,
  ADD COLUMN ai_score_band ENUM('hot','warm','cool') NULL,
  ADD COLUMN ai_score_reason TEXT NULL,
  ADD COLUMN ai_score_breakdown JSON NULL,
  ADD COLUMN ai_audit JSON NULL,
  ADD COLUMN ai_email_subject VARCHAR(255) NULL,
  ADD COLUMN ai_email_body TEXT NULL,
  ADD COLUMN ai_last_scored_at DATETIME NULL,
  ADD COLUMN ai_model_version VARCHAR(60) NULL,

  -- Operator workspace
  ADD COLUMN tags JSON NULL,
  ADD COLUMN last_activity_at DATETIME NULL,
  ADD COLUMN consent_basis VARCHAR(60) NULL,
  ADD COLUMN archived_at DATETIME NULL,
  ADD COLUMN imported_by_user_id BIGINT UNSIGNED NULL
    COMMENT 'shhdbite_atlantic_hub.admin_users.user_id (cross-DB, app-enforced)',

  -- New indexes for portal queries (existing 4 indexes preserved unchanged)
  ADD UNIQUE KEY uq_audit_id (audit_id),
  ADD KEY idx_client_stage    (client_id, pipeline_stage_id),
  ADD KEY idx_client_score    (client_id, ai_score),
  ADD KEY idx_client_activity (client_id, last_activity_at),
  ADD KEY idx_client_archived (client_id, archived_at),
  ADD KEY idx_source_type     (source_type);

-- =====================================================================
-- SECTION C — Backfill audit_id for the existing 12 audit-form leads
-- =====================================================================
-- Every lead needs a public-facing UUID so the portal can build URLs
-- like /admin/av/leads/{audit_id} without exposing the internal INT id.
-- New audit-form INSERTs after this migration will have audit_id NULL
-- until the next-session API layer either: (a) adds it to the INSERT,
-- or (b) backfills via a hook. For v3, the 12 existing rows are
-- populated below; the uq_audit_id UNIQUE allows NULLs (MySQL UNIQUE
-- treats multiple NULLs as distinct), so new rows with NULL audit_id
-- won't violate the constraint while the API layer catches up.
-- =====================================================================

UPDATE leads SET audit_id = UUID() WHERE audit_id IS NULL;

-- =====================================================================
-- SECTION D — Create the 7 new portal tables
-- =====================================================================
-- Naming: per-tenant DB supplies namespace, so no av_ prefix.
-- PK style: BIGINT UNSIGNED AUTO_INCREMENT for new tables.
-- FK to leads(id): the child FK column is named lead_id (descriptive)
--   but its type must be INT NOT NULL (matching parent leads.id INT,
--   NOT BIGINT UNSIGNED — this is the one deviation from Hub's
--   normal BIGINT UNSIGNED convention, forced by the existing schema).
-- DATETIME everywhere; DATETIME(3) for event ordering inside the same
--   second (lead_events).
-- =====================================================================

-- ---------------------------------------------------------------------
-- D.1 — clients: one row per AV portal client (a business paying for
--                the portal). NOT the platform per-person `accounts`
--                in shhdbite_atlantic_hub.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS clients (
  client_id         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  client_uuid       CHAR(36) NOT NULL,
  client_name       VARCHAR(255) NOT NULL,
  client_slug       VARCHAR(120) NOT NULL,
  industry          VARCHAR(120) NULL,
  enabled           BOOLEAN NOT NULL DEFAULT TRUE
    COMMENT 'Kill switch — enforced in application layer, not by MySQL constraint',
  retention_days    INT NOT NULL DEFAULT 730
    COMMENT 'GDPR retention policy in days; v2 cron will purge',
  plan_tier         ENUM('sprint','momentum','scale','owner') NOT NULL DEFAULT 'sprint',
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  archived_at       DATETIME NULL,
  UNIQUE KEY uq_client_uuid (client_uuid),
  UNIQUE KEY uq_client_slug (client_slug),
  KEY idx_enabled (enabled)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- D.2 — pipeline_stages: per-client kanban columns (New, Contacted, …)
-- ---------------------------------------------------------------------
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

-- ---------------------------------------------------------------------
-- D.3 — lead_notes: portal-side threaded notes on a lead
-- ---------------------------------------------------------------------
-- Distinct from leads.notes (legacy TEXT column on the existing table,
-- a single free-text field). lead_notes is structured + multi-row.
-- FK lead_id type is INT (matches leads.id INT).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lead_notes (
  lead_note_id      BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  client_id         BIGINT UNSIGNED NULL
    COMMENT 'NULL for audit-form leads not yet assigned to a portal client',
  lead_id           INT NOT NULL
    COMMENT 'FK to leads.id; type INT matches existing schema, not BIGINT UNSIGNED',
  author_user_id    BIGINT UNSIGNED NULL
    COMMENT 'platform admin_users.user_id (cross-DB, app-enforced)',
  author_role       ENUM('owner','operator','client_user','system') NOT NULL,
  body              TEXT NOT NULL,
  is_internal       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_lead_time   (lead_id, created_at),
  KEY idx_client_time (client_id, created_at),
  CONSTRAINT fk_notes_lead FOREIGN KEY (lead_id)
    REFERENCES leads(id) ON DELETE CASCADE,
  CONSTRAINT fk_notes_client FOREIGN KEY (client_id)
    REFERENCES clients(client_id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- D.4 — lead_events: append-only domain audit log for lead changes
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lead_events (
  lead_event_id     BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  client_id         BIGINT UNSIGNED NULL
    COMMENT 'NULL for events on audit-form leads not yet assigned to a portal client',
  lead_id           INT NOT NULL
    COMMENT 'FK to leads.id; type INT matches existing schema',
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
  CONSTRAINT fk_events_lead FOREIGN KEY (lead_id)
    REFERENCES leads(id) ON DELETE CASCADE,
  CONSTRAINT fk_events_client FOREIGN KEY (client_id)
    REFERENCES clients(client_id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- D.5 — client_icps (dormant; v2 digest-email feature)
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
  updated_by_user_id         BIGINT UNSIGNED NULL,
  UNIQUE KEY uq_client (client_id),
  CONSTRAINT fk_icps_client FOREIGN KEY (client_id)
    REFERENCES clients(client_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- D.6 — content_recommendations (dormant)
-- ---------------------------------------------------------------------
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

-- ---------------------------------------------------------------------
-- D.7 — email_sends (dormant)
-- ---------------------------------------------------------------------
-- Distinct from the legacy `email_log` table in shhdbite_AV which is
-- empty (0 rows) and conceptually similar. Future decision: deprecate
-- email_log in favor of email_sends, or merge.
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
-- SECTION E — ADD FK constraints from leads → clients + pipeline_stages
-- =====================================================================
-- Now that the parent tables exist, wire up the cross-table FKs.
-- ON DELETE SET NULL (not CASCADE) — deleting a client does NOT delete
-- the existing 12 audit-form leads. They become "unassigned"
-- (client_id NULL = Val's own audit-form pipeline).
-- =====================================================================

ALTER TABLE leads
  ADD CONSTRAINT fk_leads_client FOREIGN KEY (client_id)
    REFERENCES clients(client_id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_leads_stage  FOREIGN KEY (pipeline_stage_id)
    REFERENCES pipeline_stages(pipeline_stage_id) ON DELETE SET NULL;

-- =====================================================================
-- SECTION F — Seed
-- =====================================================================
-- One client (Val's own internal AV business) + 6 default pipeline
-- stages. The existing 12 audit-form leads are NOT auto-assigned to
-- this client — they stay with client_id = NULL meaning "Val's own
-- audit-form pipeline." Val claims them via the portal UI when ready.
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
-- SMOKE TESTS — paste these into phpMyAdmin → shhdbite_AV → SQL after
-- the migration above completes. Run each block in order.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. The 12 existing leads still exist (no data loss).
-- ---------------------------------------------------------------------
-- SELECT COUNT(*) AS total_leads FROM leads;
-- -- expect: 12  (or however many leads existed before migration;
-- --             must equal the pre-migration count exactly)

-- ---------------------------------------------------------------------
-- 2. Every existing lead has a non-null audit_id (UUID backfilled).
-- ---------------------------------------------------------------------
-- SELECT COUNT(*) AS leads_without_audit_id
--   FROM leads WHERE audit_id IS NULL;
-- -- expect: 0

-- ---------------------------------------------------------------------
-- 3. Every existing lead has source_type = 'audit_form'.
-- ---------------------------------------------------------------------
-- SELECT source_type, COUNT(*) FROM leads GROUP BY source_type;
-- -- expect: one row, source_type='audit_form', count=12

-- ---------------------------------------------------------------------
-- 4. The new clients table exists with 1 row (av-internal).
-- ---------------------------------------------------------------------
-- SELECT client_slug, plan_tier, enabled FROM clients;
-- -- expect: 1 row, client_slug='av-internal', plan_tier='owner', enabled=1

-- ---------------------------------------------------------------------
-- 5. pipeline_stages has 6 rows for av-internal.
-- ---------------------------------------------------------------------
-- SELECT c.client_slug, COUNT(s.pipeline_stage_id) AS stage_count
--   FROM clients c
--   LEFT JOIN pipeline_stages s ON s.client_id = c.client_id
--   WHERE c.client_slug = 'av-internal'
--   GROUP BY c.client_id;
-- -- expect: 1 row, stage_count=6

-- ---------------------------------------------------------------------
-- 6. lead_notes, lead_events, client_icps, content_recommendations,
--    email_sends all exist and are empty.
-- ---------------------------------------------------------------------
-- SELECT 'lead_notes' AS t, COUNT(*) AS n FROM lead_notes
-- UNION ALL SELECT 'lead_events',              COUNT(*) FROM lead_events
-- UNION ALL SELECT 'client_icps',              COUNT(*) FROM client_icps
-- UNION ALL SELECT 'content_recommendations',  COUNT(*) FROM content_recommendations
-- UNION ALL SELECT 'email_sends',              COUNT(*) FROM email_sends;
-- -- expect: all 5 rows show n=0

-- ---------------------------------------------------------------------
-- 7. Backwards-compat: the audit form's exact INSERT still works.
--    This replicates byte-for-byte what api/index.php :: handleAudit
--    Submission() runs in production.
-- ---------------------------------------------------------------------
-- INSERT INTO leads (company, email, website, industry, contact_name, phone, challenge, submission_date)
-- VALUES ('Smoke Test Co', 'smoke-row-13@test.local', 'https://smoke.test',
--         'test-industry', 'Smoke Tester', '555-0000',
--         'verifying the migration', NOW());
-- SELECT COUNT(*) AS total_after_insert FROM leads;
-- -- expect: 13
-- SELECT id, source_type, audit_id IS NOT NULL AS has_uuid
--   FROM leads WHERE email = 'smoke-row-13@test.local';
-- -- expect: source_type='audit_form' (default), has_uuid=0
-- --         (new row gets NULL audit_id; API layer will populate later)

-- ---------------------------------------------------------------------
-- 8. Cascade test: add a portal note + event to the smoke-test lead,
--    then DELETE that lead, verify the note + event vanished too.
-- ---------------------------------------------------------------------
-- SET @smoke_lead_id = (SELECT id FROM leads WHERE email = 'smoke-row-13@test.local');
-- SET @cid = (SELECT client_id FROM clients WHERE client_slug = 'av-internal');
-- INSERT INTO lead_notes (client_id, lead_id, author_role, body)
--   VALUES (@cid, @smoke_lead_id, 'system', 'smoke-test note');
-- INSERT INTO lead_events (client_id, lead_id, event_type, event_payload)
--   VALUES (@cid, @smoke_lead_id, 'created', JSON_OBJECT('source','smoke'));
-- SELECT
--   (SELECT COUNT(*) FROM lead_notes  WHERE lead_id = @smoke_lead_id) AS n,
--   (SELECT COUNT(*) FROM lead_events WHERE lead_id = @smoke_lead_id) AS e;
-- -- expect: n=1, e=1
-- DELETE FROM leads WHERE id = @smoke_lead_id;
-- SELECT
--   (SELECT COUNT(*) FROM lead_notes  WHERE lead_id = @smoke_lead_id) AS n,
--   (SELECT COUNT(*) FROM lead_events WHERE lead_id = @smoke_lead_id) AS e,
--   (SELECT COUNT(*) FROM leads) AS total_leads;
-- -- expect: n=0, e=0, total_leads=12  (back to original)

-- ---------------------------------------------------------------------
-- 9. Kill switch: confirm clients.enabled accepts a flip.
-- ---------------------------------------------------------------------
-- UPDATE clients SET enabled = FALSE WHERE client_slug = 'av-internal';
-- SELECT client_slug, enabled FROM clients WHERE client_slug = 'av-internal';
-- -- expect: enabled = 0
-- UPDATE clients SET enabled = TRUE  WHERE client_slug = 'av-internal';
-- SELECT client_slug, enabled FROM clients WHERE client_slug = 'av-internal';
-- -- expect: enabled = 1

-- ---------------------------------------------------------------------
-- 10. Backwards-compat — every column the live PHP touches is intact.
--     The audit form INSERT writes: company, email, website, industry,
--     contact_name, phone, challenge, submission_date.
--     The async audit-generation UPDATE writes: audit_content,
--     audit_generated, is_approved.
--     Confirm all 11 columns exist with their original types.
-- ---------------------------------------------------------------------
-- SELECT column_name, column_type, is_nullable, column_default
--   FROM information_schema.columns
--  WHERE table_schema = 'shhdbite_AV'
--    AND table_name = 'leads'
--    AND column_name IN (
--      'id','company','email','website','industry','contact_name',
--      'phone','challenge','submission_date','audit_content',
--      'audit_generated','is_approved','approval_date','approved_by',
--      'lead_status','follow_up_date','notes','created_at','updated_at'
--    )
--  ORDER BY column_name;
-- -- expect: 19 rows (all original columns present), each with the
-- -- column_type matching Section A above. Specifically:
-- --   id                   int            (NOT NULL, AUTO_INCREMENT)
-- --   company              varchar(255)   (NOT NULL)
-- --   email                varchar(255)   (NOT NULL, UNIQUE)
-- --   website              varchar(500)
-- --   industry             varchar(100)
-- --   contact_name         varchar(255)
-- --   phone                varchar(20)
-- --   challenge            text
-- --   audit_content        longtext
-- --   audit_generated      datetime
-- --   is_approved          tinyint
-- --   approval_date        datetime
-- --   approved_by          varchar(255)
-- --   submission_date      datetime
-- --   lead_status          enum(...)
-- --   follow_up_date       datetime
-- --   notes                text
-- --   created_at           timestamp
-- --   updated_at           timestamp
-- =====================================================================
-- END 004_av_detail_v3.sql
-- =====================================================================
