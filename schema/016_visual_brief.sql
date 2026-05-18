-- =====================================================================
-- Atlantic Hub -- Visual Brief: structured creative direction per lead
-- File:    schema/016_visual_brief.sql
-- Target:  shhdbite_AV
-- Run in:  HostGator phpMyAdmin -> click shhdbite_AV in sidebar
--          -> SQL tab -> paste -> Go
-- =====================================================================
--
-- IDEMPOTENT: CREATE TABLE IF NOT EXISTS only. Re-running is a no-op.
--
-- WHY: the AI audit was written for sales / strategy purposes
-- (problem framing, ICP, segmentation). Squeezing visual prompts out
-- of a sales document gives generic commercials. The visual_brief
-- is a SECOND AI pass per lead that produces a structured creative
-- direction (hero shot, mood, palette, motifs, persona, do-nots).
-- This is what the Grok discoverer reads to build commercial prompts.
--
-- Versioned: each generation creates a new row, latest active row wins.
-- ============================================================================

CREATE TABLE IF NOT EXISTS lead_visual_briefs (
  id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  lead_id           BIGINT UNSIGNED NOT NULL,
  -- Structured creative direction. JSON-as-TEXT for broad MySQL compat.
  hero_shot         TEXT NULL,
  brand_mood        VARCHAR(255) NULL,
  palette_json      TEXT NULL,       -- JSON array of color/tone words
  motifs_json       TEXT NULL,       -- JSON array of recurring visual elements
  donts_json        TEXT NULL,       -- JSON array of banned elements
  customer_persona  TEXT NULL,
  video_pacing      VARCHAR(255) NULL,
  text_overlay_hook VARCHAR(500) NULL,
  -- Raw response and source tracking
  raw_response_json TEXT NULL,       -- the full JSON the model returned
  source_audit_id   VARCHAR(36) NULL,-- which audit_id this brief was built from, if any
  model             VARCHAR(64) NOT NULL,
  tokens_used       INT UNSIGNED NULL,
  cost_usd          DECIMAL(8,4) NULL,
  -- Lifecycle
  status            ENUM('active','superseded','failed') NOT NULL DEFAULT 'active',
  error_message     VARCHAR(500) NULL,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  superseded_at     DATETIME NULL,
  created_by_user_id BIGINT UNSIGNED NULL,
  KEY idx_lvb_lead     (lead_id),
  KEY idx_lvb_status   (status),
  KEY idx_lvb_lead_active (lead_id, status),
  KEY idx_lvb_created  (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Verification:
--   DESC lead_visual_briefs;
--   SELECT COUNT(*) FROM lead_visual_briefs;  -- expect 0 on fresh install
