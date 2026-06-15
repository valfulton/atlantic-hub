-- =====================================================================
-- Atlantic Hub — case_action_items.visibility += 'legal_team'
--                (val 2026-06-15, #685)
-- Target: shhdbite_AV
-- Run AFTER: schema/097_case_document_text_cache_and_extracts.sql
-- =====================================================================
--
-- Adds a third visibility tier so val + Rebecca + Adriana can keep
-- private investigation notes that DO NOT surface to the parents.
--
--   parents_safe  — every viewer who can see the case (parents included)
--   legal_team    — operator + account_rep + professional only (NEW)
--   operator_only — operator + account_rep only (Rebecca + val; Adriana hidden)
--
-- Default stays 'parents_safe' — legacy rows unchanged.
-- =====================================================================

USE shhdbite_AV;

ALTER TABLE case_action_items
  MODIFY COLUMN visibility ENUM('parents_safe','operator_only','legal_team')
    NOT NULL DEFAULT 'parents_safe'
    COMMENT 'parents_safe = renders for family; legal_team = Rebecca + Adriana + val only; operator_only = Rebecca + val only.';

-- VERIFY:
--   SHOW CREATE TABLE case_action_items;
--   SELECT visibility, COUNT(*) FROM case_action_items GROUP BY visibility;
-- =====================================================================
