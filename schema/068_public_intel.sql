-- schema/068_public_intel.sql  (#368, val 2026-06-02)
--
-- Public Intelligence Layer (free public data adapters): the moat alongside
-- LLM cost discipline. Each adapter pulls relevant free public data per-client
-- (HMDA for Marty's consumer loans, CA recorder / SOS for Adriana's CLDA liens,
-- Census ACS for income tracts, CFPB for consumer complaints, etc.) and feeds
-- the existing intelligence_objects spine.
--
-- Two tables:
--
--   public_intel_sources — per-client config: which adapters are enabled and
--     what scope (CA counties, US states, NAICS codes, etc.). One row per
--     (client_id, source_kind). NULL client_id means "tenant-wide default."
--
--   public_intel_records — cached results per (source_kind, entity_key). The
--     entity_key is adapter-defined (e.g. "ca:los-angeles:business:NDVIP"
--     or "hmda:2024:tract:06037-2071.00"). Records expire via fetched_at.
--
-- Adapters are pure-TypeScript with no shared schema beyond these tables —
-- each adapter knows how to map its API response into intelligence_objects.

CREATE TABLE IF NOT EXISTS public_intel_sources (
  source_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  client_id INT UNSIGNED NULL,
  -- Canonical adapter id. Matches PublicIntelAdapter.kind in lib/public_intel.
  source_kind VARCHAR(64) NOT NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  -- Per-source config as JSON (states/counties/NAICS/etc). Adapter validates.
  config_json JSON NULL,
  last_run_at DATETIME NULL,
  last_run_status ENUM('ok','error','skipped') NULL,
  last_run_detail VARCHAR(500) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (source_id),
  UNIQUE KEY uk_client_source (client_id, source_kind),
  KEY idx_kind (source_kind),
  KEY idx_enabled (enabled)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS public_intel_records (
  record_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  source_kind VARCHAR(64) NOT NULL,
  -- Adapter-defined natural key. Used for dedup + cache hits on re-runs.
  entity_key VARCHAR(255) NOT NULL,
  client_id INT UNSIGNED NULL,
  lead_id INT UNSIGNED NULL,
  -- The actual fetched record as JSON (full payload, not a digest).
  record_json JSON NOT NULL,
  -- Coarse summary fields exposed for quick filtering without parsing JSON.
  summary_label VARCHAR(255) NULL,
  region_code VARCHAR(64) NULL,
  fetched_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NULL,
  PRIMARY KEY (record_id),
  UNIQUE KEY uk_kind_entity (source_kind, entity_key),
  KEY idx_client (client_id),
  KEY idx_lead (lead_id),
  KEY idx_region (region_code),
  KEY idx_fetched (fetched_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
