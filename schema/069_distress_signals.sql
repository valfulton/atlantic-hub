-- schema/069_distress_signals.sql  (#372, val 2026-06-03)
--
-- Revenue Distress Intelligence Engine — the scoring layer on top of
-- public_intel_records that turns raw federal/state/county data into a
-- per-entity score telling each operator "who's likely to need you THIS
-- week."
--
-- The framing (per the advisor brief): Atlantic Hub is not a lead list,
-- it's a Revenue Distress Intelligence Engine. Each client maps the
-- public-data signals to their own service:
--   - CBB (collections): suspensions, lawsuits, bankruptcies, UCC filings
--   - Marty (consumer loans): denials, refinances, neighborhood velocity
--   - Adriana (CLDA liens): suspensions, dissolutions, recorder activity
--
-- Two tables:
--
--   distress_signal_weights — per-client (and per-tenant-default) signal
--     name → weight. NULL client_id means "tenant-wide default." Weights
--     are signed integers in [-100, 100]; negative weights damp the score
--     (e.g. "Active + paying entity = -5"). Operator-editable; seeded with
--     the advisor's 7 weights for CBB on first use.
--
--   entity_distress_scores — rolling per-entity score keyed by
--     (client_id, entity_key). entity_key matches public_intel_records
--     entity_key OR a synthetic id when an entity is constructed from
--     joined sources. Stores the score, the contributing signal hits, and
--     the timestamp of last recomputation.

CREATE TABLE IF NOT EXISTS distress_signal_weights (
  weight_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  client_id INT UNSIGNED NULL,
  signal_kind VARCHAR(96) NOT NULL,
  weight INT NOT NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  description VARCHAR(500) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (weight_id),
  UNIQUE KEY uk_client_signal (client_id, signal_kind),
  KEY idx_signal (signal_kind),
  KEY idx_enabled (enabled)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS entity_distress_scores (
  score_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  client_id INT UNSIGNED NOT NULL,
  -- Canonical entity key. Either a public_intel_records.entity_key or a
  -- synthesized id ("entity:NDVIP-LLC") for cross-source entities.
  entity_key VARCHAR(255) NOT NULL,
  entity_label VARCHAR(255) NULL,
  region_code VARCHAR(64) NULL,
  -- The current rolling distress score (clamped 0-1000).
  score INT NOT NULL DEFAULT 0,
  -- Signal contributions as JSON array: [{ signal_kind, weight, source }].
  contributing_signals JSON NULL,
  -- When this entity first hit the watchlist for this client.
  first_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- When the score was last recomputed.
  last_recomputed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- When the operator last acted on this entity (Contacted, Dismissed,
  -- Converted). Drives the "fresh / acted" UI filter.
  last_acted_at DATETIME NULL,
  last_action ENUM('contacted','dismissed','converted','ignored') NULL,
  PRIMARY KEY (score_id),
  UNIQUE KEY uk_client_entity (client_id, entity_key),
  KEY idx_client_score (client_id, score),
  KEY idx_recomputed (last_recomputed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
