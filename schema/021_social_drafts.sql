-- =====================================================================
-- Atlantic Hub -- Social drafts cache per lead
-- File:    schema/021_social_drafts.sql
-- Target:  shhdbite_AV
-- Run in:  HostGator phpMyAdmin -> click shhdbite_AV in sidebar
--          -> SQL tab -> paste -> Go
-- =====================================================================
-- Note: renumbered from 018 -> 021 on 2026-05-19 because the conductor's
-- parallel session reserved schemas 018-019 for the Living Score +
-- Sales mega-ship rollout. Registry in docs/SESSION_COORDINATION.md is
-- the canonical source of truth.
-- =====================================================================
--
-- IDEMPOTENT: CREATE TABLE IF NOT EXISTS only. Re-running is a no-op.
--
-- WHY: every time the operator clicks "Generate social content" on a
-- lead, the AI Social Content endpoint returns N LinkedIn / X /
-- Instagram posts. Until now those drafts lived only in the request
-- response; closing the modal lost them. This table persists every
-- generated draft so other surfaces (the Commercials tab, the future
-- Social Posting queue) can re-use the same exact post as a prompt or
-- as the published body, with NO additional LLM call.
--
-- Per-lead, ordered by created_at DESC for "most recent first" reads.
-- ============================================================================

CREATE TABLE IF NOT EXISTS lead_social_drafts (
  id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  lead_id           BIGINT UNSIGNED NOT NULL,
  -- Which platform tone this draft was written for. Drives later channel
  -- suggestions (e.g. LinkedIn drafts default to 16:9 commercials).
  platform          ENUM('linkedin','twitter','instagram','facebook','threads','tiktok','other')
                    NOT NULL DEFAULT 'other',
  -- 'for_prospect' vs 'about_industry' from the original social endpoint.
  variant           VARCHAR(40) NULL,
  -- The actual post copy.
  body_text         TEXT NOT NULL,
  -- Optional character count for quick admin views.
  char_count        INT UNSIGNED NULL,
  -- Lifecycle. 'used_for_commercial' is set when this draft was pulled
  -- into the Commercial generator so we can show "already used" hints.
  status            ENUM('active','used_for_commercial','published','archived') NOT NULL DEFAULT 'active',
  -- Provenance + cost trail (admin-only -- never client-facing).
  model             VARCHAR(64) NULL,
  tokens_used       INT UNSIGNED NULL,
  -- Optional link to a generated commercial that used this draft as the prompt.
  commercial_asset_id BIGINT UNSIGNED NULL,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  used_at           DATETIME NULL,
  archived_at       DATETIME NULL,
  created_by_user_id BIGINT UNSIGNED NULL,
  KEY idx_lsd_lead         (lead_id),
  KEY idx_lsd_lead_active  (lead_id, status),
  KEY idx_lsd_platform     (platform),
  KEY idx_lsd_created      (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Verification:
--   DESC lead_social_drafts;
--   SELECT COUNT(*) FROM lead_social_drafts;  -- expect 0 on fresh install
