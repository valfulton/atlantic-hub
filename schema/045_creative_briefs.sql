-- 045_creative_briefs.sql
--
-- The editable Creative Brief store. ONE shape for everyone:
--   * a real client      -> (tenant_id, client_id = clients.client_id)
--   * a house brand       -> (tenant_id, client_id = NULL)  e.g. 'av' / 'ebw' / 'hh'
--
-- brief_payload uses the SAME canonical 6-question keys as
-- client_users.intake_payload, so lib/client/intake_brief.extractBriefSeedFromIntake()
-- consumes either source unchanged. This is the missing foundation: until now
-- val's OWN brands had no intake record, so the thesis + PR prompts fell back to a
-- hardcoded "Atlantic & Vine" label and generic grounding.
--
-- No UNIQUE on (tenant_id, client_id): MySQL does not dedupe NULLs in a unique
-- index, so the app emulates upsert (SELECT then UPDATE/INSERT) for the house-brand
-- (client_id NULL) rows — same pattern as intelligence_objects in lib/pr/drafter.ts.
--
-- Run ONCE.

CREATE TABLE IF NOT EXISTS creative_briefs (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id     VARCHAR(16)     NOT NULL DEFAULT 'av'
    COMMENT 'av | ebw | hh — the brand/tenant this brief belongs to',
  client_id     BIGINT UNSIGNED NULL
    COMMENT 'FK to clients.client_id. NULL = the house brand for this tenant.',
  brief_payload JSON            DEFAULT NULL
    COMMENT 'Canonical 6-question creative-brief answers; same shape as client_users.intake_payload',
  created_at    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_creative_briefs_scope (tenant_id, client_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
