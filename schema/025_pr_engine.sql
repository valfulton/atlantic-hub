-- 025_pr_engine.sql
-- PR / Narrative Intelligence Engine. NOT a press-release tool: this is an
-- intelligence-distribution layer that reads from and contributes to the shared
-- operational intelligence graph. See docs/CLAUDE_KICKOFF_PR_ENGINE.md.
--
-- Idempotent: safe to re-run. Uses CREATE TABLE IF NOT EXISTS everywhere.
-- Additive only: does NOT drop, rename, or recreate any existing table.
--
-- Tables (5):
--   pr_opportunities      one row per journalist request / media query
--   pr_pitches            one AI-drafted pitch per opportunity + client
--   press_releases        a drafted release tied to a client win/launch
--   press_distribution_log where each release/pitch went + coverage that came back
--   intelligence_objects  the compounding-intelligence store (reusable strategic
--                         context referenced across outreach, PR, social, etc.)
--
-- Event logging is NOT a table here: PR actions emit pr.* events via
-- lib/events/log.ts into the EXISTING system_events table (schema 010).
--
-- Conductor note (2026-05-21): this file was pre-written by the conductor so the
-- PR build session runs it as-is rather than regenerating. If the session needs
-- a column change, ALTER it in a later reserved migration -- do not edit 025
-- after it has been run against shhdbite_AV.

USE shhdbite_AV;

-- 1. pr_opportunities ---------------------------------------------------------
-- A journalist question / media query / authority opportunity. why_it_matters is
-- the drafter-generated strategic-guidance string (why this matters, why now,
-- expected authority impact, seasonal/positioning/campaign relevance).
CREATE TABLE IF NOT EXISTS pr_opportunities (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL,
  source ENUM('qwoted','featured','sourcebottle','help_a_b2b_writer','reddit','linkedin','podcast','manual','other') NOT NULL DEFAULT 'manual',
  outlet VARCHAR(255) NULL,
  journalist VARCHAR(255) NULL,
  query_text TEXT NULL,
  topic_tags JSON NULL,
  why_it_matters TEXT NULL,
  deadline DATETIME NULL,
  matched_lead_id BIGINT UNSIGNED NULL,
  status ENUM('new','drafted','submitted','won','passed') NOT NULL DEFAULT 'new',
  created_by_user_id BIGINT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_tenant_status (tenant_id, status),
  KEY idx_source (source),
  KEY idx_deadline (deadline),
  KEY idx_matched_lead (matched_lead_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. pr_pitches ---------------------------------------------------------------
-- One AI-drafted pitch per opportunity + client, in that client's voice.
CREATE TABLE IF NOT EXISTS pr_pitches (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  opportunity_id BIGINT UNSIGNED NOT NULL,
  tenant_id VARCHAR(64) NOT NULL,
  lead_id BIGINT UNSIGNED NULL,
  body_text TEXT NULL,
  model VARCHAR(64) NULL,
  status ENUM('draft','approved','sent','declined') NOT NULL DEFAULT 'draft',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_opportunity (opportunity_id),
  KEY idx_tenant_status (tenant_id, status),
  KEY idx_lead (lead_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. press_releases -----------------------------------------------------------
-- A drafted release tied to a client win/launch.
CREATE TABLE IF NOT EXISTS press_releases (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL,
  lead_id BIGINT UNSIGNED NULL,
  title VARCHAR(300) NULL,
  body_text MEDIUMTEXT NULL,
  status ENUM('draft','approved','published') NOT NULL DEFAULT 'draft',
  created_by_user_id BIGINT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_tenant_status (tenant_id, status),
  KEY idx_lead (lead_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. press_distribution_log ---------------------------------------------------
-- Where each release/pitch went, and any coverage that came back. Designed so it
-- can later feed authority scoring: keep url + outcome + channel queryable.
CREATE TABLE IF NOT EXISTS press_distribution_log (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  release_id BIGINT UNSIGNED NULL,
  pitch_id BIGINT UNSIGNED NULL,
  tenant_id VARCHAR(64) NULL,
  channel VARCHAR(64) NOT NULL,
  outcome ENUM('queued','submitted','live','failed') NOT NULL DEFAULT 'queued',
  url VARCHAR(1024) NULL,
  detail VARCHAR(500) NULL,
  attempted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_release (release_id),
  KEY idx_pitch (pitch_id),
  KEY idx_tenant_channel (tenant_id, channel),
  KEY idx_outcome (outcome)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5. intelligence_objects -----------------------------------------------------
-- The compounding-intelligence store. Reusable strategic context layers that are
-- READ by every system and STRENGTHENED/CREATED by PR drafting. Examples of
-- object_type: founder_story, authority_positioning, audience_psychology,
-- seasonal_opportunities, competitive_weaknesses, market_positioning,
-- differentiators, preferred_narrative_angles, proof_points, engagement_patterns,
-- authority_topics, media_friendly_topics. (pain_point_profile still lives on the
-- leads table; read it there, do not duplicate it here.)
-- Upsert semantics: one current row per (tenant_id, lead_id, object_type) is the
-- intended pattern -- the unique key enforces it for lead-scoped objects so
-- re-derivation overwrites. CAVEAT: MySQL allows multiple NULLs in a unique
-- index, so for TENANT-LEVEL objects (lead_id IS NULL) the unique key does NOT
-- dedupe. The drafter must handle that case in app code: SELECT-then-UPDATE on
-- (tenant_id, object_type) WHERE lead_id IS NULL, else INSERT.
CREATE TABLE IF NOT EXISTS intelligence_objects (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL,
  lead_id BIGINT UNSIGNED NULL,
  object_type VARCHAR(64) NOT NULL,
  object_json JSON NULL,
  source VARCHAR(64) NULL,
  confidence TINYINT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tenant_lead_type (tenant_id, lead_id, object_type),
  KEY idx_tenant_type (tenant_id, object_type),
  KEY idx_lead (lead_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- End of 025. Run once in phpMyAdmin against shhdbite_AV. Re-runnable.
-- Verify:
--   SHOW TABLES LIKE 'pr_%';
--   SHOW TABLES LIKE 'intelligence_objects';
--   SHOW CREATE TABLE pr_opportunities;
