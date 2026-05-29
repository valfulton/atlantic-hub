-- =====================================================================
-- 060_pr_inbox_slug.sql  (#226)
--
-- Per-client PR inbox slug. Powers the email address
-- "<slug>@pr.atlanticandvine.com" that clients (or val on their behalf)
-- can hand to journalists / publicists / media lists. HostGator's catch-all
-- on pr.atlanticandvine.com forwards every inbound email to
-- POST https://atlantic-hub.netlify.app/api/pr/inbox/<slug> -- the slug IS
-- the authentication, so it must be unguessable and unique.
--
-- One slug per client. Rotate by overwriting (no history kept). Old slugs
-- stop working immediately because routing matches `clients.pr_inbox_slug`
-- directly.
-- =====================================================================

USE shhdbite_AV;

-- Idempotent: only add the column if it doesn't already exist.
SET @col_exists := (
  SELECT COUNT(*)
    FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'clients'
     AND COLUMN_NAME = 'pr_inbox_slug'
);

SET @sql := IF(
  @col_exists = 0,
  'ALTER TABLE clients
     ADD COLUMN pr_inbox_slug VARCHAR(64) NULL DEFAULT NULL
       COMMENT ''(#226) per-client PR inbox slug; routes to /api/pr/inbox/<slug>'',
     ADD COLUMN pr_inbox_set_at DATETIME NULL DEFAULT NULL
       COMMENT ''(#226) when the slug was last set/rotated'',
     ADD UNIQUE KEY uq_pr_inbox_slug (pr_inbox_slug)',
  'SELECT ''pr_inbox_slug column already exists -- skipping ALTER'' AS note'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Verify
DESCRIBE clients;
