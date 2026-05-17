-- =====================================================================
-- Atlantic Hub — Atlantic & Vine Portal Detail (Path B-lite, v4)
-- File:    schema/004_av_detail_v4.sql
-- Target:  shhdbite_AV  (UPPERCASE — the live AV marketing-site DB)
-- Run in:  HostGator cPanel → phpMyAdmin → shhdbite_AV → SQL tab
-- =====================================================================
--
-- WHAT'S NEW IN v4 (vs v3):
--   - REMOVED: content_recommendations table (replaced by the better-
--              designed content_prompts + generated_assets pair).
--   - ADDED:   6 content-engine tables — ai_integrations,
--              content_prompts, generated_assets, social_channels,
--              social_posts, social_post_approvals.
--   - ADDED:   5 seed rows in ai_integrations (grok_imagine,
--              chatgpt_image, buffer, linkedin, blog_wp_draft).
--              Every secret is referenced by env-var NAME only;
--              no actual secret value appears in this file.
--   - SMOKE TESTS: 11 total. Tests 1-5 + 7 + 10 unchanged from v3.
--              Test 6 updated to reflect the new dormant-table list.
--              Tests 8 + 9 replaced (content-engine cascade walk +
--              approval-mode column behavior). Test 11 added
--              (ai_integrations seed sanity).
--
-- DESIGN (Path B-lite, unchanged from v3):
--   The existing `leads` table in shhdbite_AV is the source of truth.
--   It currently holds 12 live audit-form rows captured from
--   atlanticandvine.com. The portal reads + writes that same table —
--   the existing audit-form data IS the portal demo dataset.
--
--   This migration:
--     1. ADDs new columns to `leads` (no rename, no drop, no type
--        change on any existing column). Additive, all nullable
--        or default so existing PHP INSERT/UPDATE statements continue
--        working byte-identical.
--     2. CREATEs 12 new portal tables (the v3 five + 1 dormant
--        digest table + the v4 six content-engine tables). Zero name
--        collision with existing tables.
--     3. ADDs FK constraints from leads → clients and leads →
--        pipeline_stages with ON DELETE SET NULL — deleting a client
--        does NOT delete the existing audit-form leads.
--
--   ZERO PHP changes required. The live audit form, intake form,
--   and pop-journey endpoints continue writing to shhdbite_AV
--   exactly as they do today.
--
-- IDEMPOTENCY:
--   THIS MIGRATION IS NOT IDEMPOTENT. ALTER TABLE … ADD COLUMN and
--   ALTER TABLE … ADD CONSTRAINT fail on re-run. CREATE TABLE
--   statements DO use IF NOT EXISTS for safety. Designed to be run
--   ONCE, after a fresh DB backup. To re-run, restore from backup.
--
-- PRE-STEPS — required BEFORE running this file:
--   1. phpMyAdmin → shhdbite_AV → Export → Quick → SQL → Go.
--      Save the backup .sql locally.
--   2. Confirm `leads` schema matches Section A below via SHOW CREATE
--      TABLE leads. If it has drifted from database-schema.sql, stop
--      and adjust this file accordingly.
--   3. Confirm SELECT COUNT(*) FROM leads. Note the number; the
--      smoke tests assume the pre-migration count is what it should
--      stay (modulo +1/-1 during cascade walk).
-- =====================================================================

USE shhdbite_AV;

SET NAMES utf8mb4;
SET time_zone = '+00:00';

-- =====================================================================
-- SECTION A — Expected state of the live `leads` table BEFORE migration
-- =====================================================================
-- (Reference only — does not execute. Verify with SHOW CREATE TABLE.)
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
-- =====================================================================

-- =====================================================================
-- SECTION B — ALTER TABLE leads (additive only — unchanged from v3)
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

  ADD UNIQUE KEY uq_audit_id (audit_id),
  ADD KEY idx_client_stage    (client_id, pipeline_stage_id),
  ADD KEY idx_client_score    (client_id, ai_score),
  ADD KEY idx_client_activity (client_id, last_activity_at),
  ADD KEY idx_client_archived (client_id, archived_at),
  ADD KEY idx_source_type     (source_type);

-- =====================================================================
-- SECTION C — Backfill audit_id for existing leads (unchanged from v3)
-- =====================================================================
UPDATE leads SET audit_id = UUID() WHERE audit_id IS NULL;

-- =====================================================================
-- SECTION D — Create the 12 new portal tables
-- =====================================================================
-- Ordering matters because of FK dependencies. Tables that have no
-- inbound FKs go first; tables referenced by others go before their
-- referencers.
-- =====================================================================

-- ---------------------------------------------------------------------
-- D.1 — clients (per-AV-portal-client; per-business; unchanged from v3)
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
-- D.2 — pipeline_stages (unchanged from v3)
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
-- D.3 — lead_notes (unchanged from v3; lead_id is INT to match leads.id)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lead_notes (
  lead_note_id      BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  client_id         BIGINT UNSIGNED NULL
    COMMENT 'NULL for audit-form leads not yet assigned to a portal client',
  lead_id           INT NOT NULL
    COMMENT 'FK to leads.id; type INT matches existing schema',
  author_user_id    BIGINT UNSIGNED NULL,
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
-- D.4 — lead_events (unchanged from v3; lead_id is INT)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lead_events (
  lead_event_id     BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  client_id         BIGINT UNSIGNED NULL,
  lead_id           INT NOT NULL,
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
-- D.5 — client_icps (dormant; v2 digest-email; unchanged from v3)
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

-- =====================================================================
-- D.6 → D.11 — Content engine layer (NEW in v4)
-- =====================================================================
-- Six tables that wire together the AI-content workflow:
--   ai_integrations          → registry of AI tools (Grok, ChatGPT, etc.)
--   content_prompts          → AI-generated prompts from leads
--   generated_assets         → outputs from those tools (video/image/etc.)
--   social_channels          → destinations (Val's LinkedIn, AV blog, …)
--   social_posts             → queued / published / scheduled posts
--   social_post_approvals    → per-post approval audit log
-- =====================================================================

-- ---------------------------------------------------------------------
-- D.6 — ai_integrations: registry of every AI tool the portal can use
-- ---------------------------------------------------------------------
-- No outbound FKs. This is the lookup table other tables point at.
-- enabled=FALSE is the soft-delete signal (never hard-delete a row
-- referenced by historical assets/posts).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_integrations (
  integration_id    BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  integration_key   VARCHAR(60) NOT NULL
    COMMENT 'Stable identifier — e.g., grok_imagine, chatgpt_image, buffer',
  display_name      VARCHAR(120) NOT NULL,
  category          ENUM('content_generation','social_posting','other') NOT NULL,
  capabilities      JSON NOT NULL
    COMMENT '{input, output, duration_s, max_prompt_chars, …} — declarative tool capabilities',
  enabled           BOOLEAN NOT NULL DEFAULT TRUE,
  config_schema     JSON NULL
    COMMENT 'Declares which env-var NAMES hold this integration''s secrets. Never contains actual secret values.',
  notes             TEXT NULL,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_integration_key (integration_key),
  KEY idx_category_enabled (category, enabled)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- D.7 — content_prompts: AI-generated prompts ready to feed into tools
-- ---------------------------------------------------------------------
-- One prompt → many possible assets (operator picks the best output).
-- ON DELETE SET NULL on lead/client/integration: history survives,
-- the link goes NULL when upstream entities are deleted.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS content_prompts (
  prompt_id               BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  client_id               BIGINT UNSIGNED NULL
    COMMENT 'Which AV portal client this is for; NULL = Val''s own pipeline',
  source_lead_id          INT NULL
    COMMENT 'FK to leads.id; NULL = not lead-derived. Type INT to match parent.',
  intended_integration_id BIGINT UNSIGNED NULL
    COMMENT 'Hint at which AI tool to feed this into; operator may override at execution time',
  prompt_kind             ENUM(
    'video','image','audio','blog_post','social_caption','email_template','other'
  ) NOT NULL,
  prompt_title            VARCHAR(255) NULL,
  prompt_text             TEXT NOT NULL,
  prompt_metadata         JSON NULL
    COMMENT '{target_audience, tone, length, hashtags_suggested, …}',
  ai_generator_model      VARCHAR(60) NULL
    COMMENT 'Which Claude/GPT/etc. model produced this prompt (different from the consuming integration)',
  status                  ENUM('proposed','approved','rejected','consumed','expired')
    NOT NULL DEFAULT 'proposed',
  approved_at             DATETIME NULL,
  approved_by_user_id     BIGINT UNSIGNED NULL,
  created_at              DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at              DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  archived_at             DATETIME NULL,
  KEY idx_client_status (client_id, status),
  KEY idx_lead          (source_lead_id),
  KEY idx_integration   (intended_integration_id),
  CONSTRAINT fk_prompts_client FOREIGN KEY (client_id)
    REFERENCES clients(client_id) ON DELETE SET NULL,
  CONSTRAINT fk_prompts_lead FOREIGN KEY (source_lead_id)
    REFERENCES leads(id) ON DELETE SET NULL,
  CONSTRAINT fk_prompts_integration FOREIGN KEY (intended_integration_id)
    REFERENCES ai_integrations(integration_id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- D.8 — generated_assets: outputs from AI tools (video/image/audio/text)
-- ---------------------------------------------------------------------
-- The asset survives even if the prompt is deleted — the asset itself
-- may already be live on social media, so losing the audit trail to
-- its origin is acceptable but losing the asset record is not.
-- integration_id is NOT NULL: every asset must record which tool made
-- it (provenance). No ON DELETE on integration FK — integrations are
-- soft-deleted via enabled=FALSE (RESTRICT is the default).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS generated_assets (
  asset_id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  prompt_id         BIGINT UNSIGNED NULL
    COMMENT 'Which prompt produced this asset; ON DELETE SET NULL',
  client_id         BIGINT UNSIGNED NULL,
  integration_id    BIGINT UNSIGNED NOT NULL
    COMMENT 'Required — provenance of the generating tool',
  asset_kind        ENUM('video','image','audio','text') NOT NULL,
  asset_url         VARCHAR(1000) NULL
    COMMENT 'URL to the asset (S3, CDN, third-party hosted)',
  asset_storage_key VARCHAR(500) NULL
    COMMENT 'Internal storage key if we host it ourselves',
  thumbnail_url     VARCHAR(1000) NULL,
  duration_seconds  INT NULL,
  width_px          INT NULL,
  height_px         INT NULL,
  asset_metadata    JSON NULL
    COMMENT '{generation_cost_cents, model_version, seed, full_provider_response, …}',
  external_id       VARCHAR(200) NULL
    COMMENT 'Provider''s ID for this asset (Grok job id, OpenAI image id, …)',
  status            ENUM('pending','ready','failed','deleted') NOT NULL DEFAULT 'pending',
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_prompt               (prompt_id),
  KEY idx_client_status        (client_id, status),
  KEY idx_integration_external (integration_id, external_id),
  CONSTRAINT fk_assets_prompt FOREIGN KEY (prompt_id)
    REFERENCES content_prompts(prompt_id) ON DELETE SET NULL,
  CONSTRAINT fk_assets_client FOREIGN KEY (client_id)
    REFERENCES clients(client_id) ON DELETE SET NULL,
  CONSTRAINT fk_assets_integration FOREIGN KEY (integration_id)
    REFERENCES ai_integrations(integration_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- D.9 — social_channels: destinations (Val's LinkedIn, AV blog, etc.)
-- ---------------------------------------------------------------------
-- A client's channels DO cascade-delete with the client (the channels
-- are owned by that client). Integration FK has no ON DELETE — soft-
-- delete via enabled=FALSE on the integration.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS social_channels (
  channel_id       BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  client_id        BIGINT UNSIGNED NULL
    COMMENT 'NULL = Val''s own channels; non-null = an AV client''s channels',
  channel_key      VARCHAR(80) NOT NULL
    COMMENT 'Stable identifier — e.g., val_linkedin_personal, av_blog_wp',
  display_name     VARCHAR(120) NOT NULL,
  integration_id   BIGINT UNSIGNED NOT NULL
    COMMENT 'Which integration handles posts for this channel',
  platform         ENUM(
    'linkedin','instagram','facebook','x','tiktok','youtube','threads','blog','email','other'
  ) NOT NULL,
  approval_mode    ENUM('auto','required') NOT NULL DEFAULT 'required'
    COMMENT 'Per-channel approval flow. auto=post immediately, required=human approval before posting',
  config           JSON NULL
    COMMENT 'Non-secret config only (handle, default hashtags, posting hours). Secrets live in env vars.',
  enabled          BOOLEAN NOT NULL DEFAULT TRUE,
  last_used_at     DATETIME NULL,
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_channel_key (channel_key),
  KEY idx_client_platform (client_id, platform),
  CONSTRAINT fk_channels_client FOREIGN KEY (client_id)
    REFERENCES clients(client_id) ON DELETE CASCADE,
  CONSTRAINT fk_channels_integration FOREIGN KEY (integration_id)
    REFERENCES ai_integrations(integration_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- D.10 — social_posts: queued / scheduled / published posts
-- ---------------------------------------------------------------------
-- Posts survive everything. Once published to a platform, the
-- historical record matters even if originating lead/prompt/asset/
-- client is deleted later. Links go NULL but the post row stays.
-- Channel FK has no ON DELETE — channels are soft-deleted via
-- enabled=FALSE. Cannot hard-delete a channel with posts in it.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS social_posts (
  post_id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  client_id        BIGINT UNSIGNED NULL,
  channel_id       BIGINT UNSIGNED NOT NULL
    COMMENT 'Every post belongs to a channel; required',
  asset_id         BIGINT UNSIGNED NULL
    COMMENT 'Media asset attached to this post; NULL for text-only posts',
  source_lead_id   INT NULL
    COMMENT 'Attribution: which lead inspired this post. Type INT to match parent.',
  source_prompt_id BIGINT UNSIGNED NULL,
  post_body        TEXT NULL,
  post_metadata    JSON NULL
    COMMENT '{hashtags, mentions, link_url, scheduled_for, …}',
  status           ENUM(
    'draft','pending_approval','approved','scheduled','publishing',
    'published','failed','rejected','cancelled'
  ) NOT NULL DEFAULT 'draft',
  scheduled_for    DATETIME NULL,
  published_at     DATETIME NULL,
  external_post_id VARCHAR(200) NULL
    COMMENT 'Platform''s post ID once live',
  external_url     VARCHAR(1000) NULL,
  failure_reason   TEXT NULL,
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_client_status  (client_id, status),
  KEY idx_channel_status (channel_id, status),
  KEY idx_scheduled      (status, scheduled_for),
  KEY idx_source_lead    (source_lead_id),
  CONSTRAINT fk_posts_client FOREIGN KEY (client_id)
    REFERENCES clients(client_id) ON DELETE SET NULL,
  CONSTRAINT fk_posts_channel FOREIGN KEY (channel_id)
    REFERENCES social_channels(channel_id),
  CONSTRAINT fk_posts_asset FOREIGN KEY (asset_id)
    REFERENCES generated_assets(asset_id) ON DELETE SET NULL,
  CONSTRAINT fk_posts_lead FOREIGN KEY (source_lead_id)
    REFERENCES leads(id) ON DELETE SET NULL,
  CONSTRAINT fk_posts_prompt FOREIGN KEY (source_prompt_id)
    REFERENCES content_prompts(prompt_id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- D.11 — social_post_approvals: per-post approval audit log
-- ---------------------------------------------------------------------
-- One row per approval REQUEST, not per channel-per-post. If a post
-- is rejected and resubmitted, a new approval row is created (full
-- decision audit trail). Approvals cascade-delete with their post —
-- an approval has no meaning without the post it approved.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS social_post_approvals (
  approval_id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  post_id              BIGINT UNSIGNED NOT NULL,
  requested_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  requested_by_user_id BIGINT UNSIGNED NULL,
  decided_at           DATETIME NULL,
  decided_by_user_id   BIGINT UNSIGNED NULL,
  decision             ENUM('pending','approved','rejected','expired') NOT NULL DEFAULT 'pending',
  decision_notes       TEXT NULL,
  KEY idx_decision_pending (decision, requested_at),
  KEY idx_post (post_id),
  CONSTRAINT fk_approvals_post FOREIGN KEY (post_id)
    REFERENCES social_posts(post_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- D.12 — email_sends (dormant; unchanged from v3)
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
ALTER TABLE leads
  ADD CONSTRAINT fk_leads_client FOREIGN KEY (client_id)
    REFERENCES clients(client_id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_leads_stage  FOREIGN KEY (pipeline_stage_id)
    REFERENCES pipeline_stages(pipeline_stage_id) ON DELETE SET NULL;

-- =====================================================================
-- SECTION F — Seed
-- =====================================================================

-- F.1 — One client (Val's own internal AV business)
INSERT IGNORE INTO clients (client_uuid, client_name, client_slug, industry, enabled, plan_tier)
  VALUES (UUID(), 'Atlantic & Vine (Val)', 'av-internal', 'agency-internal', TRUE, 'owner');

-- F.2 — 6 default pipeline stages for av-internal
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

-- ---------------------------------------------------------------------
-- F.3 — Five ai_integrations registry rows (NEW in v4)
-- ---------------------------------------------------------------------
-- CRITICAL: config_schema declares which env-var NAMES hold each
-- integration's secrets. It NEVER contains actual secret values.
-- The seed rows are configuration TEMPLATES; deployment populates
-- the env vars separately.
-- ---------------------------------------------------------------------
INSERT IGNORE INTO ai_integrations
  (integration_key, display_name, category, capabilities, enabled, config_schema, notes)
VALUES
  -- 1. Grok Imagine — text-to-video / text-to-image from xAI
  ('grok_imagine',
   'Grok Imagine',
   'content_generation',
   '{"input": "text", "output": ["video","image"], "duration_s": [5, 10, 15], "max_prompt_chars": 4000}',
   TRUE,
   '{"env_vars": {"api_key": "GROK_API_KEY"}, "endpoint": "https://api.x.ai/v1/imagine", "default_model": "grok-imagine-1", "rate_limit_per_minute": 10}',
   'Text-to-video and text-to-image generation from xAI. Used for short-form social content derived from lead audit submissions. Manual upload step today; API integration is a future session.'),

  -- 2. ChatGPT Image (DALL-E 3) — fallback image generation
  ('chatgpt_image',
   'ChatGPT Image (DALL-E 3)',
   'content_generation',
   '{"input": "text", "output": ["image"], "sizes": ["1024x1024", "1792x1024", "1024x1792"], "max_prompt_chars": 4000}',
   TRUE,
   '{"env_vars": {"api_key": "OPENAI_API_KEY"}, "endpoint": "https://api.openai.com/v1/images/generations", "default_model": "dall-e-3", "default_size": "1024x1024", "rate_limit_per_minute": 50}',
   'OpenAI image generation. Fallback when Grok Imagine rate-limits or for image-only (non-video) content.'),

  -- 3. Buffer — multi-channel social posting
  ('buffer',
   'Buffer (multi-channel)',
   'social_posting',
   '{"input": ["text","image","video"], "destinations": ["linkedin","instagram","facebook","x","tiktok","threads"], "scheduling": true, "max_post_chars": 5000}',
   TRUE,
   '{"env_vars": {"access_token": "BUFFER_ACCESS_TOKEN"}, "endpoint": "https://api.bufferapp.com/1", "default_profiles": [], "rate_limit_per_minute": 60}',
   'Buffer wraps OAuth and posting for 6+ social platforms. Recommended primary social-posting integration for v1 because it handles platform-specific spec validation, token refresh, and retries. Direct platform integrations (LinkedIn API, Meta Graph) deferred to later sessions.'),

  -- 4. LinkedIn — direct API (personal-profile posting)
  ('linkedin',
   'LinkedIn (direct)',
   'social_posting',
   '{"input": ["text","image","video"], "destinations": ["linkedin"], "scheduling": false, "max_post_chars": 3000}',
   TRUE,
   '{"env_vars": {"client_id": "LINKEDIN_CLIENT_ID", "client_secret": "LINKEDIN_CLIENT_SECRET", "access_token": "LINKEDIN_ACCESS_TOKEN", "refresh_token": "LINKEDIN_REFRESH_TOKEN"}, "endpoint": "https://api.linkedin.com/v2", "actor_urn": "urn:li:person:<placeholder>", "rate_limit_per_day": 100}',
   'Direct LinkedIn Marketing API. Used for personal-profile posts to drive AV-Internal lead-gen. Requires LinkedIn Share on LinkedIn product approval. Token refresh required ~every 60 days.'),

  -- 5. Blog (WordPress drafts) — auto-posts to atlanticandvine.com WP drafts
  ('blog_wp_draft',
   'Blog (WordPress draft folder)',
   'social_posting',
   '{"input": ["text","image"], "destinations": ["wordpress_drafts"], "scheduling": false, "max_post_chars": 100000}',
   TRUE,
   '{"env_vars": {"wp_application_password": "WORDPRESS_APP_PASSWORD"}, "endpoint": "https://atlanticandvine.com/wp-json/wp/v2", "username": "val", "default_status": "draft", "default_category_id": null}',
   'Auto-posts to the WordPress drafts folder on atlanticandvine.com for Val to review and publish manually. social_channels using this integration should have approval_mode=auto (low-risk because drafts are not publicly visible until manually published in WP admin).');

-- =====================================================================
-- SMOKE TESTS — paste each block into phpMyAdmin → shhdbite_AV → SQL
-- after the migration above completes. 11 total tests.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. The existing leads still exist (no data loss).
-- ---------------------------------------------------------------------
-- SELECT COUNT(*) AS total_leads FROM leads;
-- -- expect: 12 (or whatever the pre-migration count was, exact match)

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
-- 6. All other new tables exist and are empty (UPDATED in v4 to reflect
--    the new dormant-table list — content_recommendations REMOVED,
--    6 content-engine tables ADDED, all empty post-create).
-- ---------------------------------------------------------------------
-- SELECT 'lead_notes' AS t,             COUNT(*) AS n FROM lead_notes
-- UNION ALL SELECT 'lead_events',            COUNT(*) FROM lead_events
-- UNION ALL SELECT 'client_icps',            COUNT(*) FROM client_icps
-- UNION ALL SELECT 'content_prompts',        COUNT(*) FROM content_prompts
-- UNION ALL SELECT 'generated_assets',       COUNT(*) FROM generated_assets
-- UNION ALL SELECT 'social_channels',        COUNT(*) FROM social_channels
-- UNION ALL SELECT 'social_posts',           COUNT(*) FROM social_posts
-- UNION ALL SELECT 'social_post_approvals',  COUNT(*) FROM social_post_approvals
-- UNION ALL SELECT 'email_sends',            COUNT(*) FROM email_sends;
-- -- expect: 9 rows, all n=0

-- ---------------------------------------------------------------------
-- 7. Backwards-compat — the audit form's exact INSERT still works.
--    Replicates api/index.php :: handleAuditSubmission() byte-for-byte.
-- ---------------------------------------------------------------------
-- INSERT INTO leads (company, email, website, industry, contact_name, phone, challenge, submission_date)
-- VALUES ('Smoke Test Co', 'smoke-row-13@test.local', 'https://smoke.test',
--         'test-industry', 'Smoke Tester', '555-0000',
--         'verifying the migration', NOW());
-- SELECT COUNT(*) AS total_after_insert FROM leads;
-- -- expect: 13
-- SELECT id, source_type, audit_id IS NOT NULL AS has_uuid
--   FROM leads WHERE email = 'smoke-row-13@test.local';
-- -- expect: source_type='audit_form', has_uuid=0 (new row, NULL audit_id;
-- --         next-session API layer will populate)

-- ---------------------------------------------------------------------
-- 8. CONTENT-ENGINE CASCADE WALK (NEW in v4 — REPLACES v3 test 8).
--    Walks the full chain: prompt → asset → channel → post → approval.
--    Verifies SET NULL behavior on lead deletion, CASCADE on post
--    deletion to approvals.
--
--    DATA IMPACT NOTICE: this test SELECTs a real lead via LIMIT 1
--    then DELETES it. Running the test reduces the live leads count
--    by 1. Either: (a) run on a backup DB only, or (b) accept the
--    loss and restore from your pre-migration backup afterward.
-- ---------------------------------------------------------------------
-- -- Set up: use an existing audit-form lead
-- SET @lead_id = (SELECT id FROM leads LIMIT 1);
-- SET @client_id = (SELECT client_id FROM clients WHERE client_slug = 'av-internal');
-- SET @integration_grok = (SELECT integration_id FROM ai_integrations
--                          WHERE integration_key = 'grok_imagine');
-- SET @integration_buffer = (SELECT integration_id FROM ai_integrations
--                            WHERE integration_key = 'buffer');
--
-- -- Step 1: create a content_prompt derived from the lead
-- INSERT INTO content_prompts
--   (client_id, source_lead_id, intended_integration_id, prompt_kind,
--    prompt_title, prompt_text, status)
-- VALUES
--   (@client_id, @lead_id, @integration_grok, 'video',
--    'Test video prompt',
--    '15s video showing a frustrated SMB owner staring at a CRM dashboard',
--    'proposed');
-- SET @prompt_id = LAST_INSERT_ID();
--
-- -- Step 2: create a generated_asset linked to that prompt
-- INSERT INTO generated_assets
--   (prompt_id, client_id, integration_id, asset_kind, asset_url, status)
-- VALUES
--   (@prompt_id, @client_id, @integration_grok, 'video',
--    'https://grok.example/asset/test', 'ready');
-- SET @asset_id = LAST_INSERT_ID();
--
-- -- Step 3: create a social_channel for av-internal (buffer-backed)
-- INSERT INTO social_channels
--   (client_id, channel_key, display_name, integration_id, platform, approval_mode)
-- VALUES
--   (@client_id, 'val_buffer_linkedin_test',
--    'Val LinkedIn (via Buffer) [test]',
--    @integration_buffer, 'linkedin', 'required');
-- SET @channel_id = LAST_INSERT_ID();
--
-- -- Step 4: create a social_post referencing lead/prompt/asset/channel
-- INSERT INTO social_posts
--   (client_id, channel_id, asset_id, source_lead_id, source_prompt_id, post_body, status)
-- VALUES
--   (@client_id, @channel_id, @asset_id, @lead_id, @prompt_id,
--    'Test post body', 'pending_approval');
-- SET @post_id = LAST_INSERT_ID();
--
-- -- Step 5: create an approval record for the post
-- INSERT INTO social_post_approvals (post_id, decision)
-- VALUES (@post_id, 'pending');
-- SET @approval_id = LAST_INSERT_ID();
--
-- -- Verify the full chain joins:
-- SELECT
--   p.post_id,
--   p.status                 AS post_status,
--   c.channel_key,
--   c.approval_mode,
--   a.asset_kind,
--   a.status                 AS asset_status,
--   pr.prompt_kind,
--   pr.status                AS prompt_status,
--   l.id                     AS lead_id,
--   ap.decision              AS approval_decision,
--   ai_int.integration_key   AS posting_integration
-- FROM social_posts p
-- JOIN social_channels c    ON c.channel_id = p.channel_id
-- JOIN ai_integrations ai_int ON ai_int.integration_id = c.integration_id
-- LEFT JOIN generated_assets a       ON a.asset_id = p.asset_id
-- LEFT JOIN content_prompts pr       ON pr.prompt_id = p.source_prompt_id
-- LEFT JOIN leads l                  ON l.id = p.source_lead_id
-- LEFT JOIN social_post_approvals ap ON ap.post_id = p.post_id
-- WHERE p.post_id = @post_id;
-- -- expect: 1 row, every join populated
--
-- -- A. Delete the lead. Verify prompts/posts SET NULL but survive.
-- DELETE FROM leads WHERE id = @lead_id;
-- SELECT
--   (SELECT source_lead_id FROM content_prompts WHERE prompt_id = @prompt_id) AS prompt_lead_should_be_null,
--   (SELECT source_lead_id FROM social_posts WHERE post_id = @post_id)        AS post_lead_should_be_null,
--   (SELECT COUNT(*) FROM content_prompts WHERE prompt_id = @prompt_id)       AS prompt_should_still_exist,
--   (SELECT COUNT(*) FROM social_posts WHERE post_id = @post_id)              AS post_should_still_exist;
-- -- expect: NULL, NULL, 1, 1
--
-- -- B. Delete the post. Verify the approval cascade-deletes.
-- DELETE FROM social_posts WHERE post_id = @post_id;
-- SELECT COUNT(*) AS orphan_approvals
--   FROM social_post_approvals WHERE post_id = @post_id;
-- -- expect: 0
--
-- -- C. Cleanup of the test rows (lead already gone via A)
-- DELETE FROM generated_assets WHERE asset_id = @asset_id;
-- DELETE FROM content_prompts WHERE prompt_id = @prompt_id;
-- DELETE FROM social_channels WHERE channel_id = @channel_id;

-- ---------------------------------------------------------------------
-- 9. APPROVAL-MODE COLUMN BEHAVIOR (NEW in v4 — REPLACES v3 test 9).
--    Confirms social_channels.approval_mode accepts both values + the
--    default is 'required' (the conservative choice for public social).
-- ---------------------------------------------------------------------
-- SET @client_id = (SELECT client_id FROM clients WHERE client_slug = 'av-internal');
-- SET @integration_buffer = (SELECT integration_id FROM ai_integrations
--                            WHERE integration_key = 'buffer');
-- SET @integration_blog = (SELECT integration_id FROM ai_integrations
--                          WHERE integration_key = 'blog_wp_draft');
--
-- -- A. Auto channel (blog drafts)
-- INSERT INTO social_channels
--   (client_id, channel_key, display_name, integration_id, platform, approval_mode)
-- VALUES
--   (@client_id, 'av_blog_auto_test', 'Blog auto-post [test]',
--    @integration_blog, 'blog', 'auto');
--
-- -- B. Required channel (LinkedIn)
-- INSERT INTO social_channels
--   (client_id, channel_key, display_name, integration_id, platform, approval_mode)
-- VALUES
--   (@client_id, 'av_linkedin_required_test',
--    'LinkedIn manual approval [test]',
--    @integration_buffer, 'linkedin', 'required');
--
-- -- C. Default (no approval_mode specified)
-- INSERT INTO social_channels
--   (client_id, channel_key, display_name, integration_id, platform)
-- VALUES
--   (@client_id, 'av_default_mode_test',
--    'Default approval-mode [test]',
--    @integration_buffer, 'instagram');
--
-- -- Verify all three:
-- SELECT channel_key, approval_mode
--   FROM social_channels
--   WHERE channel_key IN
--     ('av_blog_auto_test','av_linkedin_required_test','av_default_mode_test')
--   ORDER BY channel_key;
-- -- expect:
-- --   av_blog_auto_test          | auto
-- --   av_default_mode_test       | required
-- --   av_linkedin_required_test  | required
--
-- -- Cleanup
-- DELETE FROM social_channels
--   WHERE channel_key IN
--     ('av_blog_auto_test','av_linkedin_required_test','av_default_mode_test');

-- ---------------------------------------------------------------------
-- 10. PHP-write-compatibility audit (unchanged from v3 test 10).
--     Confirm every leads column the live PHP touches still exists
--     with original types.
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
-- -- expect: 19 rows, types unchanged per Section A.

-- ---------------------------------------------------------------------
-- 11. AI_INTEGRATIONS SEED SANITY (NEW in v4).
--     Confirm the 5 seeded integrations exist with valid JSON.
-- ---------------------------------------------------------------------
-- SELECT
--   COUNT(*)                       AS expected_5,
--   SUM(JSON_VALID(capabilities))  AS valid_capabilities_jsons,
--   SUM(JSON_VALID(config_schema)) AS valid_config_schemas
-- FROM ai_integrations
-- WHERE integration_key IN
--   ('grok_imagine','chatgpt_image','buffer','linkedin','blog_wp_draft');
-- -- expect: 5, 5, 5
--
-- SELECT integration_key, category, enabled
--   FROM ai_integrations
--   ORDER BY integration_key;
-- -- expect 5 rows, all enabled=1, mix of categories:
-- --   content_generation: grok_imagine, chatgpt_image
-- --   social_posting:     buffer, linkedin, blog_wp_draft
-- =====================================================================
-- END 004_av_detail_v4.sql
-- =====================================================================
