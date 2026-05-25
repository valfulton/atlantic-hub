-- 047_creative_brief_versions.sql
--
-- Restore points for the creative brief / intake. Every time a brief is saved
-- (by the operator) OR a returning client resubmits their intake, we first
-- snapshot the PREVIOUS payload here with a timestamp + who changed it. val can
-- then view history and restore any prior version, so a client editing and
-- sending back bad info can never irreversibly overwrite her good data.
--
-- Keyed by (tenant_id, client_id) to match the creative_briefs scope
-- (client_id NULL = house brand). source records who/what triggered the change.
--
-- Run ONCE.

CREATE TABLE IF NOT EXISTS creative_brief_versions (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id     VARCHAR(16)     NOT NULL DEFAULT 'av',
  client_id     BIGINT UNSIGNED NULL
    COMMENT 'FK to clients.client_id. NULL = house brand for this tenant.',
  brief_payload JSON            NULL
    COMMENT 'Snapshot of the PRIOR payload (the version being replaced).',
  source        VARCHAR(24)     NOT NULL DEFAULT 'operator'
    COMMENT 'operator | client_intake | restore',
  changed_by    VARCHAR(255)    NULL
    COMMENT 'operator email, client email, or null',
  created_at    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_cbv_scope (tenant_id, client_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
