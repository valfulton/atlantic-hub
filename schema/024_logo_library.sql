-- =====================================================================
-- Atlantic Hub -- Reusable logo library (operator-scoped)
-- File:    schema/024_logo_library.sql
-- Target:  shhdbite_AV
-- Run in:  HostGator phpMyAdmin -> click shhdbite_AV in sidebar
--          -> SQL tab -> paste -> Go
-- =====================================================================
--
-- IDEMPOTENT: CREATE TABLE IF NOT EXISTS only. Re-running is a no-op.
--
-- WHY: lead_brand_kits (schema 023) stores one logo PER LEAD. The
-- operator runs Atlantic & Vine for her own brand, Events by Water,
-- HunterHoney, and a growing roster of clients -- many leads share the
-- same logo. This library lets her upload each logo ONCE, then apply
-- it to any new lead in one click. Sorted by recency so the most-used
-- logos float to the top.
--
-- v1: operator-scoped (no per-tenant ACL). Phase 2 can add a
-- tenant_id column when staff users come online.
-- ============================================================================

CREATE TABLE IF NOT EXISTS operator_logo_library (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  -- Friendly label so Val sees "Atlantic & Vine wordmark" instead of a filename.
  display_name VARCHAR(255) NOT NULL,
  -- Optional tenant hint helps future-Val sort logos by which brand they belong to.
  -- 'av' | 'ebw' | 'hh' | 'client:<n>' | NULL (= general).
  tenant_hint VARCHAR(64) NULL,
  -- Logo bytes. Same v1 storage strategy as lead_brand_kits.
  logo_data LONGBLOB NOT NULL,
  logo_mime_type VARCHAR(64) NOT NULL,
  logo_filename VARCHAR(255) NULL,
  logo_width INT UNSIGNED NULL,
  logo_height INT UNSIGNED NULL,
  -- Default composite settings carried into lead_brand_kits when applied.
  default_position ENUM('top-left','top-right','bottom-left','bottom-right')
                   NOT NULL DEFAULT 'bottom-right',
  default_opacity DECIMAL(3,2) NOT NULL DEFAULT 1.00,
  default_scale DECIMAL(4,3) NOT NULL DEFAULT 0.150,
  default_padding INT UNSIGNED NOT NULL DEFAULT 24,
  -- Recency + usage for "most likely the right one" surfacing.
  use_count INT UNSIGNED NOT NULL DEFAULT 0,
  last_used_at DATETIME NULL,
  -- Audit
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  archived_at DATETIME NULL,
  created_by_user_id BIGINT UNSIGNED NULL,
  KEY idx_library_recency (archived_at, last_used_at),
  KEY idx_library_tenant (tenant_hint, archived_at),
  KEY idx_library_use_count (use_count)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Verification:
--   DESC operator_logo_library;
--   SELECT COUNT(*) FROM operator_logo_library;  -- expect 0 on fresh install
