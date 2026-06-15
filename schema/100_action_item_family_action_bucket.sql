-- =====================================================================
-- Atlantic Hub -- Action items: family_action bucket + relabel
-- File:    schema/100_action_item_family_action_bucket.sql
-- Target:  shhdbite_AV
-- Run in:  HostGator phpMyAdmin -> shhdbite_AV -> SQL tab -> paste -> Go
-- =====================================================================
--
-- WHY: val 2026-06-15. Three buckets aren't enough — most Johnson items
-- aren't 'Adriana is handling these', they're a MIX:
--
--   - Facts to know (the breach findings: §5.A, §5.F, §6.G(2))
--   - Family decisions (which option for the trust)
--   - Family homework (confirm titling, gather statements, talk to Adriana)
--   - Adriana's actual queue (file 17200, demand accounting)
--
-- The current 3 buckets collapsed #3 and #4 into 'reviewer_handling',
-- which mislabels family homework as Adriana's work and makes the page
-- feel inaccurate.
--
-- This widens the ENUM with one new value:
--   family_action  = Things you can do (homework for Rebecca + parents)
--
-- Total buckets after this migration: 4
--   reviewer_handling  -- Adriana is handling these
--   family_decision    -- Decisions for your family
--   family_action      -- Things you can do                (NEW)
--   info_only          -- Just so you know
--
-- Code labels in app/client/cases/[caseId]/page.tsx render the new
-- group between family_decision and reviewer_handling in display order.
--
-- IDEMPOTENT: information_schema guard, safe to re-run.
-- =====================================================================

USE shhdbite_AV;
SET NAMES utf8mb4;

-- Check whether family_action is already in the ENUM.
SET @needs_widen := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA='shhdbite_AV'
    AND TABLE_NAME='case_action_items'
    AND COLUMN_NAME='family_bucket'
    AND COLUMN_TYPE NOT LIKE '%family_action%'
);

SET @sql := IF(@needs_widen=1,
  "ALTER TABLE case_action_items
     MODIFY COLUMN family_bucket ENUM(
       'reviewer_handling',
       'family_decision',
       'family_action',
       'info_only'
     ) NOT NULL DEFAULT 'reviewer_handling'
       COMMENT 'Group on the family Outstanding items section. reviewer_handling = Adriana on it; family_decision = mom & dad choose; family_action = family homework (added 2026-06-15); info_only = read when you can.'",
  "SELECT 'case_action_items.family_bucket already has family_action -- skipped' AS info");
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
