-- 051_client_icp_excluded_industries.sql
-- Add an excluded-industries list to a client's ICP.
--
-- Apollo has NO negative-keyword filter, so client-scoped discovery uses this
-- column to POST-FILTER results: drop any company whose name / industry text
-- matches an excluded term. Example: a benefits broker (Skip) excludes
-- "hospital", "health system", "insurance carrier" so discovery returns
-- EMPLOYERS, not the healthcare orgs that match "health insurance".
--
-- Read/written by lib/client/icp.ts (excludedIndustries). Stored as a JSON
-- array of lowercase-ish phrase tags, same shape as excluded_topics.
--
-- MySQL: plain ADD COLUMN (no IF NOT EXISTS). Run ONCE in shhdbite_AV.

USE shhdbite_AV;

ALTER TABLE client_icps
  ADD COLUMN excluded_industries JSON NULL AFTER excluded_topics;
