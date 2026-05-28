-- =====================================================================
-- 059_backfill_address_from_source_payload.sql
--
-- One-shot harvest: pull address data out of source_payload JSON into the
-- new structured columns added in 059_lead_address_and_website_status.sql.
--
-- Sources we know about:
--   • Google Places  →  source_payload.formatted_address  →  address_street
--   • Clay          →  source_payload.location           →  address_city
--   (Apollo's apollo_location was constructed in code and never persisted —
--    nothing to backfill for Apollo rows.)
--
-- Plus: mark website_status for known placeholder patterns so the scorer
-- can stop rewarding fake URLs (#195).
--
-- Run ONLY AFTER 059_lead_address_and_website_status.sql has succeeded.
-- Safe to re-run (each statement is idempotent — only updates rows where
-- the target column is still NULL or where status is still 'unknown').
-- =====================================================================

USE shhdbite_AV;

-- ─── Address backfill — Google Places ───────────────────────────────
-- Google Places stores a full string like "1234 Main St, City, ST 12345, USA"
-- in source_payload.formatted_address. We pull it into address_street as
-- one field; future enrichment can parse the comma-separated parts.

UPDATE leads
   SET address_street = JSON_UNQUOTE(JSON_EXTRACT(source_payload, '$.formatted_address'))
 WHERE address_street IS NULL
   AND source_payload IS NOT NULL
   AND JSON_EXTRACT(source_payload, '$.formatted_address') IS NOT NULL
   AND JSON_EXTRACT(source_payload, '$.formatted_address') <> CAST('null' AS JSON);

-- ─── Address backfill — Clay ────────────────────────────────────────
-- Clay's payload.location is usually a city-or-region string. Drop it into
-- address_city. If it contains a comma we leave it as-is; refinement later.

UPDATE leads
   SET address_city = JSON_UNQUOTE(JSON_EXTRACT(source_payload, '$.location'))
 WHERE address_city IS NULL
   AND source_payload IS NOT NULL
   AND JSON_EXTRACT(source_payload, '$.location') IS NOT NULL
   AND JSON_EXTRACT(source_payload, '$.location') <> CAST('null' AS JSON);

-- ─── Website status — flag known placeholder patterns ──────────────
-- Synthetic websites the discoverers emit when a real URL isn't known.
-- These should never score HOT. Match what we know:
--   • Clay placeholder pattern: noemail+...@anything OR ...@*.placeholder
--   • Apollo synthetic domains: very low-signal heuristic — placeholder
--     for now is everything that's exactly empty/null treated below.

UPDATE leads
   SET website_status = 'placeholder'
 WHERE website_status = 'unknown'
   AND (
        website LIKE '%placeholder%'
     OR website LIKE 'http%clay+%'
     OR website LIKE 'http%apollo+%'
     OR email   LIKE 'clay+%@%placeholder%'
     OR email   LIKE 'noemail+%@%'
     OR website = ''
     OR website IS NULL
   );

-- Anything else with a website that LOOKS like a real URL — call it 'valid'.
-- This is a low-bar shape check; the future cron (#195) will HEAD-request
-- to mark genuinely dead ones.

UPDATE leads
   SET website_status = 'valid'
 WHERE website_status = 'unknown'
   AND website IS NOT NULL
   AND website <> ''
   AND (website LIKE 'http://%' OR website LIKE 'https://%')
   AND website NOT LIKE '%placeholder%';

-- ─── Verify ─────────────────────────────────────────────────────────
-- How many leads now have address data + a flagged website status?

SELECT
  COUNT(*)                                          AS total_leads,
  SUM(address_street IS NOT NULL)                   AS with_street,
  SUM(address_city   IS NOT NULL)                   AS with_city,
  SUM(website_status = 'valid')                     AS website_valid,
  SUM(website_status = 'placeholder')               AS website_placeholder,
  SUM(website_status = 'unknown')                   AS website_unknown
FROM leads
WHERE archived_at IS NULL;

-- Show 5 freshly-addressed leads as a spot check:

SELECT id, company, website, website_status, address_street, address_city
  FROM leads
 WHERE archived_at IS NULL
   AND (address_street IS NOT NULL OR address_city IS NOT NULL)
 ORDER BY id DESC
 LIMIT 5;

-- =====================================================================
-- END 059_backfill_address_from_source_payload.sql
-- =====================================================================
