-- 050_narrative_line_links.sql
-- The narrative spine's MEMORY MAP. One row per (narrative line -> asset), with a
-- ROLE describing how that asset relates to the line's thesis:
--   advances   - directly pushes the thesis forward (PR pitch, sales email, hero commercial)
--   reinforces - strengthens / repeats the positioning (testimonial, founder note, repost)
--   tests      - an experimental variation (new angle, audience, CTA, platform)
--
-- This is what lets the system later understand "these 27 assets all advanced the
-- SAME story," and learn which channels / framings / theses actually convert --
-- without duplicating intelligence. It is the join behind System Constitution's
-- "every asset attaches to exactly one narrative line" (a rail: backfilled gently,
-- enforced going forward).
--
-- Canonical store: narrative_line_id soft-refs narrative_lanes.id (the lines table).
-- asset_id is the primary key of the asset table named by asset_type.
--
-- MySQL: idempotent (CREATE TABLE IF NOT EXISTS). Run ONCE, after 049, in shhdbite_AV.

USE shhdbite_AV;

CREATE TABLE IF NOT EXISTS narrative_line_links (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL,
  narrative_line_id BIGINT UNSIGNED NOT NULL,          -- soft ref narrative_lanes.id
  asset_type ENUM(
    'content_artifact','commercial','social_post','pr_pitch','press_release','lead','campaign'
  ) NOT NULL,
  asset_id BIGINT UNSIGNED NOT NULL,
  role ENUM('advances','reinforces','tests') NOT NULL DEFAULT 'advances',
  note VARCHAR(280) NULL,
  created_by_user_id BIGINT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  -- An asset links to a given line at most once (re-linking updates the role).
  UNIQUE KEY uq_line_asset (narrative_line_id, asset_type, asset_id),
  KEY idx_line_role (narrative_line_id, role),
  KEY idx_asset (asset_type, asset_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Verify:
--   SHOW COLUMNS FROM narrative_line_links;
--   SELECT narrative_line_id, role, COUNT(*) FROM narrative_line_links GROUP BY 1,2;
