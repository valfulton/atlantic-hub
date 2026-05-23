-- 035_asset_provenance.sql
-- Foundational provenance + permanence layer for generated media. The DB is the
-- SOURCE OF TRUTH for lineage/relationships; durable storage holds the bytes;
-- Arweave (Phase 2) holds the permanent copy for "keeper" assets. No on-chain
-- logic now -- these columns make on-chain anchoring / NFT / licensing a bolt-on
-- later WITHOUT a schema rewrite.
--
-- MySQL: no `ADD COLUMN IF NOT EXISTS`. Plain ADD COLUMN; run ONCE. If a column
-- already exists, remove it from the list and re-run.
--
-- Columns:
--   content_hash       SHA-256 of the asset bytes (immutable fingerprint / dedupe / integrity)
--   hot_storage_key    key in durable hot storage (Netlify Blobs) -- the stable URL source
--   permanent_uri      Arweave tx URI once a keeper is archived (Phase 2; NULL until then)
--   is_keeper          1 = approved/published -> eligible for permanent archival
--   parent_asset_id    lineage: the asset this was derived/iterated from (version chain)
--   campaign_id        soft ref to the campaigns object (schema 030, reserved) for relationship mapping
--   provenance_json    flexible bag: prompt snapshot, params, future fields (AR/NFT meta) without migrations

USE shhdbite_AV;

ALTER TABLE grok_imagine_assets
  ADD COLUMN content_hash CHAR(64) NULL,
  ADD COLUMN hot_storage_key VARCHAR(512) NULL,
  ADD COLUMN permanent_uri VARCHAR(512) NULL,
  ADD COLUMN is_keeper TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN parent_asset_id BIGINT UNSIGNED NULL,
  ADD COLUMN campaign_id BIGINT UNSIGNED NULL,
  ADD COLUMN provenance_json JSON NULL,
  ADD KEY idx_content_hash (content_hash),
  ADD KEY idx_is_keeper (is_keeper),
  ADD KEY idx_parent_asset (parent_asset_id),
  ADD KEY idx_campaign (campaign_id);

-- Verify:
--   SHOW COLUMNS FROM grok_imagine_assets LIKE 'content_hash';
--   SHOW COLUMNS FROM grok_imagine_assets LIKE 'permanent_uri';
