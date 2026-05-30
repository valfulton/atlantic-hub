-- =====================================================================
-- 064_client_icp_contact_titles.sql  (#252 Inc 1)
--
-- Per-client preferred / excluded contact titles for ICP-driven discovery.
-- The classic use case: Skip Krause's ICP excludes HR titles because they
-- gate-keep — when discovery picks the "top person" at a matched company,
-- it should deprioritize HR/Recruiter titles and prefer CEO/Founder/Owner
-- titles. This Inc only adds the schema; the application is Inc 2.
--
-- IMPORTANT — shared-hosting note:
--   Same as 063 — shhdbite blocks SELECT on information_schema (#1044).
--   This runs raw ALTER. Re-running will throw "Duplicate column name"
--   errors that are SAFE to ignore (the migration already landed). The
--   SHOW COLUMNS at the bottom is the real verification.
-- =====================================================================

USE shhdbite_AV;

ALTER TABLE client_icps
  ADD COLUMN preferred_contact_titles JSON NULL DEFAULT NULL
    COMMENT '(#252) JSON array of role titles to PREFER when picking top person (e.g. ["CEO","Founder","Owner","COO"])',
  ADD COLUMN excluded_contact_titles JSON NULL DEFAULT NULL
    COMMENT '(#252) JSON array of role titles to EXCLUDE from results (e.g. ["HR","Recruiter"] — Skip-style gate-keeper aversion)';

-- Verify (uses SHOW so shared hosting allows it; information_schema is blocked)
SHOW COLUMNS FROM client_icps LIKE '%_contact_titles';
