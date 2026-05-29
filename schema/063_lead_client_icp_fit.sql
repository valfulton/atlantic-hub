-- =====================================================================
-- 063_lead_client_icp_fit.sql  (#95)
--
-- Per-lead "how well does THIS lead fit the OWNING CLIENT's ICP" score.
-- Distinct from ai_score (the generic 0-100 audit signal): this scores
-- the lead against the SPECIFIC client's full intake/brief — so val and
-- the client see immediately which pipeline leads actually match THEIR
-- target, not the AV-generic average.
--
-- IMPORTANT — shared-hosting note:
--   shhdbite blocks SELECT on information_schema for this MySQL user
--   (#1044 Access denied). So this migration just runs the ALTER raw.
--   If you run it a SECOND time you'll see "Duplicate column name" errors —
--   IGNORE THEM. That just means it already landed. Re-running on a fresh
--   DB still works. Verification at the bottom uses SHOW COLUMNS which
--   shared hosting DOES allow.
-- =====================================================================

USE shhdbite_AV;

-- --- The actual change ---
-- Three new columns + one index. Run once; ignore "Duplicate column name"
-- errors if you accidentally run twice.
ALTER TABLE leads
  ADD COLUMN client_icp_fit_score TINYINT UNSIGNED NULL DEFAULT NULL
    COMMENT '(#95) 0-100 fit score vs THIS lead''s owning client''s ICP/intake',
  ADD COLUMN client_icp_fit_reasoning TEXT NULL DEFAULT NULL
    COMMENT '(#95) one-sentence explanation of the fit score',
  ADD COLUMN client_icp_fit_at DATETIME NULL DEFAULT NULL
    COMMENT '(#95) when the score was last computed',
  ADD KEY idx_client_icp_fit (client_id, client_icp_fit_score);

-- --- Verify (uses SHOW, not information_schema, so shared hosting is fine) ---
SHOW COLUMNS FROM leads LIKE 'client_icp_fit%';
