-- ============================================================================
-- 088_cockpit_approvals.sql (#569, Tier 1.2) — campaign cockpit approval rows
-- ============================================================================
-- Why a separate table:
--   content_artifacts (#029) is scoped by lead_id + tenant_id and its
--   artifact_type ENUM doesn't include the cockpit kinds (commercial,
--   press_release, op_ed, social). We need a per-CLIENT artifact bucket the
--   cockpit reads + the Green Light button writes to + the Edit modal updates.
--   This table is that bucket — lightweight, client-scoped, narrative-line-
--   linkable, and dispatch-traceable to downstream surfaces (press_touches,
--   social_outbox, calendar_entries).
--
-- Lifecycle:
--   pending → approved (Green Light) → published (cron dispatches)
--                    ↓
--                    killed (operator dismisses)
--
-- Linked rows (set on green-light dispatch, NULL until then):
--   linked_press_touch_id → press_touches.touch_id (for press_release kind)
--   linked_outbox_id      → social_outbox.id       (for social/commercial)
--   linked_calendar_id    → calendar_entries.id    (when scheduled_at set)
--
-- Idempotent: safe to re-run. CREATE TABLE IF NOT EXISTS only.
-- ============================================================================

USE shhdbite_AV;

CREATE TABLE IF NOT EXISTS cockpit_approvals (
  approval_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL DEFAULT 'av',
  client_id BIGINT UNSIGNED NOT NULL,
  -- The cockpit asset kind this row represents.
  approval_kind ENUM('commercial','press_release','op_ed','social') NOT NULL,
  -- Card title shown in the cockpit; brief-grounded by cockpit_asset_titles.ts.
  title VARCHAR(300) NOT NULL,
  -- The actual draft text (filled by asset_generator in v2; until then NULL
  -- and the Edit modal lets val author it manually).
  body_text MEDIUMTEXT NULL,
  -- One-line provenance: "brief.key_message · brief.target_audience" etc.
  -- Lets val trace every draft back to the brief fields that fed it.
  source VARCHAR(500) NULL,
  angle VARCHAR(8) NULL,              -- 'A' | 'B' | 'C' | '—'
  status ENUM('pending','approved','killed','published') NOT NULL DEFAULT 'pending',
  -- Tied to a narrative line (campaigns table) so the asset participates in
  -- the spine — same intelligence loop as PR drafts and own-brand posts.
  narrative_line_id BIGINT UNSIGNED NULL,
  -- When the operator schedules a date; calendar surfaces read this.
  scheduled_at DATETIME NULL,
  -- Audit fields.
  approved_at DATETIME NULL,
  approved_by_user_id BIGINT UNSIGNED NULL,
  killed_at DATETIME NULL,
  killed_by_user_id BIGINT UNSIGNED NULL,
  published_at DATETIME NULL,
  -- Downstream-row links populated on green-light dispatch.
  linked_press_touch_id BIGINT UNSIGNED NULL,
  linked_outbox_id BIGINT UNSIGNED NULL,
  linked_calendar_id BIGINT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_client_status (client_id, status, created_at),
  INDEX idx_narrative_line (narrative_line_id),
  INDEX idx_scheduled (client_id, scheduled_at),
  INDEX idx_status_pending (status, client_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
