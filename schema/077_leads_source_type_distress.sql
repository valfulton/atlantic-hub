-- schema/077_leads_source_type_distress.sql  (val 2026-06-06)
--
-- Expand leads.source_type ENUM so promoted distress-watchlist entities can
-- be inserted. The promote-to-lead endpoint was silently 500'ing on every
-- bulk promotion (e.g. CBB watchlist on 2026-06-06) because mysql strict
-- mode rejected the ENUM value 'distress_watchlist'.
--
-- Original enum (schema/004_av_detail_v4.sql):
--     ENUM('audit_form','csv','scrape','manual','api')
--
-- New values needed:
--   * distress_watchlist  → #387 promote path
--   * cascade             → future cascade-pipeline emitted leads
--   * intake_form         → marketing-site intake flow (already used at API layer)
--
-- DB: shhdbite_AV
-- Apply manually via phpMyAdmin. Idempotent: re-running is safe.

USE shhdbite_AV;

ALTER TABLE leads
  MODIFY COLUMN source_type ENUM(
    'audit_form',
    'csv',
    'scrape',
    'manual',
    'api',
    'distress_watchlist',
    'cascade',
    'intake_form'
  ) NULL;

-- Sanity: print the new enum so you can eyeball the apply.
SELECT COLUMN_TYPE
  FROM INFORMATION_SCHEMA.COLUMNS
 WHERE TABLE_SCHEMA='shhdbite_AV'
   AND TABLE_NAME='leads'
   AND COLUMN_NAME='source_type';
