-- =====================================================================
-- 061_pr_sources_per_client.sql  (#214)
--
-- Tag PR discovery sources (RSS feeds, Reddit watches) with an optional
-- client_id so each client can have their own tuned feed list. Before
-- this, every source was tenant-wide -- one global RSS list, hopeless to
-- tune for John White (political), Adriana (legal), Ron Elfenbein (health),
-- and AV's own discovery at the same time.
--
-- Behavior:
--   client_id = NULL  -> tenant-wide source (current behavior; backwards
--                        compatible -- existing rows stay tenant-wide)
--   client_id = <id>  -> opportunities ingested from this source are
--                        attributed to that client (logged + surfaced on
--                        the per-client PR section from #213)
--
-- Idempotent ALTER guarded by information_schema check.
-- =====================================================================

USE shhdbite_AV;

SET @col_exists := (
  SELECT COUNT(*)
    FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'pr_discovery_sources'
     AND COLUMN_NAME = 'client_id'
);

SET @sql := IF(
  @col_exists = 0,
  'ALTER TABLE pr_discovery_sources
     ADD COLUMN client_id BIGINT UNSIGNED NULL DEFAULT NULL
       COMMENT ''(#214) per-client scope; NULL = tenant-wide'',
     ADD COLUMN label VARCHAR(255) NULL DEFAULT NULL
       COMMENT ''(#214) human label shown in the operator UI'',
     ADD KEY idx_client (client_id)',
  'SELECT ''client_id column already exists on pr_discovery_sources -- skipping ALTER'' AS note'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Verify
DESCRIBE pr_discovery_sources;
