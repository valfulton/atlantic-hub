-- =====================================================================
-- Atlantic Hub -- Per-lead brand kit (logo + composite settings)
-- File:    schema/023_brand_kits.sql
-- Target:  shhdbite_AV
-- Run in:  HostGator phpMyAdmin -> click shhdbite_AV in sidebar
--          -> SQL tab -> paste -> Go
-- =====================================================================
--
-- IDEMPOTENT: CREATE TABLE IF NOT EXISTS only. Re-running is a no-op.
--
-- WHY: AI engines render logos badly. The Commercials generator already
-- asks the model to leave clean negative-space in a chosen corner. This
-- migration stores the actual logo + composite settings per lead so a
-- separate compositor (lib/brand_kit/compositor.ts) can overlay the
-- real logo on every generated asset on download / publish.
--
-- v1 stores logos inline as base64 in `logo_data` (small files only,
-- under ~512 KB). Phase 2 swaps this for a proper object storage URL
-- when the asset rehosting work lands.
-- ============================================================================

CREATE TABLE IF NOT EXISTS lead_brand_kits (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  lead_id BIGINT UNSIGNED NOT NULL UNIQUE,
  -- Source logo: inline base64 for v1 (cheap, no new storage deps).
  -- ~700 KB max after base64 expansion since LONGBLOB cap is 4 GB but
  -- composite latency degrades quickly past that.
  logo_data LONGBLOB NULL,
  logo_mime_type VARCHAR(64) NULL,                     -- 'image/png' etc
  logo_filename VARCHAR(255) NULL,
  logo_width INT UNSIGNED NULL,
  logo_height INT UNSIGNED NULL,
  -- Composite settings the operator picks once per lead.
  default_position ENUM('top-left','top-right','bottom-left','bottom-right')
                   NOT NULL DEFAULT 'bottom-right',
  default_opacity DECIMAL(3,2) NOT NULL DEFAULT 1.00,  -- 0.00 to 1.00
  default_scale DECIMAL(4,3) NOT NULL DEFAULT 0.150,   -- logo width as fraction of frame width
  default_padding INT UNSIGNED NOT NULL DEFAULT 24,    -- pixels from the chosen edge
  auto_apply BOOLEAN NOT NULL DEFAULT TRUE,
  -- Audit
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by_user_id BIGINT UNSIGNED NULL,
  KEY idx_brand_kit_lead (lead_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Verification:
--   DESC lead_brand_kits;
--   SELECT COUNT(*) FROM lead_brand_kits;  -- expect 0 on fresh install
