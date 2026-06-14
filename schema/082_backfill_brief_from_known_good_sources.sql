-- 082_backfill_brief_from_known_good_sources.sql  (#519 follow-up, val 2026-06-08)
--
-- REPAIRS THE PREP-ALL WIPE DAMAGE.
--
-- Background: prior to commit 0b60222, app/api/admin/av/clients/[client_id]/
-- prep-all/route.ts called saveBriefPayload(...) with only the LLM patch, not
-- the merged brief. saveBriefPayload does a full JSON column replace, so every
-- Prep run that wrote anything wiped every other key from the brief.
--
-- The originals of three fields survived elsewhere (the wipe only touched
-- creative_briefs.brief_payload, not the operational tables):
--   - clients.client_name        -> brief_payload.company
--   - clients.industry           -> brief_payload.industry
--   - client_users.display_name  -> brief_payload.contact_name
--   - latest website_audit_snapshots.homepage_url -> brief_payload.website_url
--
-- This script mirrors those known-good values into every brief that has them
-- blank or missing. Safe to run repeatedly. Only writes when the source value
-- is non-empty AND the brief slot is blank/missing (so it won't overwrite a
-- hand-curated value).
--
-- After this runs:
--   - Pre-flight will show the real field count
--   - Drafters / prompts / dossier panel that read brief.{company,
--     contact_name,industry,website_url} will see the values you typed
--   - The new operator dossier panel's patent/trademark screen buttons will
--     have the company name to query


-- ----------------------------------------------------------------------------
-- Pass A: company (from clients.client_name)
-- ----------------------------------------------------------------------------
UPDATE creative_briefs cb
JOIN clients c ON c.client_id = cb.client_id
   SET cb.brief_payload = JSON_SET(
         COALESCE(cb.brief_payload, JSON_OBJECT()),
         '$.company', c.client_name
       )
 WHERE cb.tenant_id = 'av'
   AND c.client_name IS NOT NULL
   AND c.client_name <> ''
   AND (
     cb.brief_payload IS NULL
     OR JSON_TYPE(JSON_EXTRACT(cb.brief_payload, '$.company')) = 'NULL'
     OR JSON_UNQUOTE(JSON_EXTRACT(cb.brief_payload, '$.company')) = ''
   );

-- ----------------------------------------------------------------------------
-- Pass B: industry (from clients.industry)
-- ----------------------------------------------------------------------------
UPDATE creative_briefs cb
JOIN clients c ON c.client_id = cb.client_id
   SET cb.brief_payload = JSON_SET(
         COALESCE(cb.brief_payload, JSON_OBJECT()),
         '$.industry', c.industry
       )
 WHERE cb.tenant_id = 'av'
   AND c.industry IS NOT NULL
   AND c.industry <> ''
   AND (
     cb.brief_payload IS NULL
     OR JSON_TYPE(JSON_EXTRACT(cb.brief_payload, '$.industry')) = 'NULL'
     OR JSON_UNQUOTE(JSON_EXTRACT(cb.brief_payload, '$.industry')) = ''
   );

-- ----------------------------------------------------------------------------
-- Pass C: contact_name (from client_users.display_name — pick the most recent
-- non-empty for each client)
-- ----------------------------------------------------------------------------
UPDATE creative_briefs cb
JOIN (
  SELECT cu.client_id, cu.display_name
    FROM client_users cu
    JOIN (
      SELECT client_id, MAX(client_user_id) AS max_uid
        FROM client_users
       WHERE display_name IS NOT NULL AND display_name <> ''
         AND client_id IS NOT NULL
       GROUP BY client_id
    ) latest ON latest.client_id = cu.client_id AND latest.max_uid = cu.client_user_id
) lu ON lu.client_id = cb.client_id
   SET cb.brief_payload = JSON_SET(
         COALESCE(cb.brief_payload, JSON_OBJECT()),
         '$.contact_name', lu.display_name
       )
 WHERE cb.tenant_id = 'av'
   AND (
     cb.brief_payload IS NULL
     OR JSON_TYPE(JSON_EXTRACT(cb.brief_payload, '$.contact_name')) = 'NULL'
     OR JSON_UNQUOTE(JSON_EXTRACT(cb.brief_payload, '$.contact_name')) = ''
   );

-- ----------------------------------------------------------------------------
-- Pass D: website_url (re-run of the 079/080 logic, in case any new audit
-- snapshots have landed since the last backfill ran)
-- ----------------------------------------------------------------------------
UPDATE creative_briefs cb
JOIN (
  SELECT s.client_id, s.homepage_url
    FROM website_audit_snapshots s
    JOIN (
      SELECT client_id, MAX(created_at) AS max_at
        FROM website_audit_snapshots
       WHERE tenant_id = 'av' AND client_id IS NOT NULL
       GROUP BY client_id
    ) latest ON latest.client_id = s.client_id AND latest.max_at = s.created_at
   WHERE s.homepage_url <> ''
) ws ON ws.client_id = cb.client_id
   SET cb.brief_payload = JSON_SET(
         COALESCE(cb.brief_payload, JSON_OBJECT()),
         '$.website_url', ws.homepage_url
       )
 WHERE cb.tenant_id = 'av'
   AND (
     cb.brief_payload IS NULL
     OR JSON_TYPE(JSON_EXTRACT(cb.brief_payload, '$.website_url')) = 'NULL'
     OR JSON_UNQUOTE(JSON_EXTRACT(cb.brief_payload, '$.website_url')) = ''
   );

-- ----------------------------------------------------------------------------
-- VERIFY (uncomment + run separately to confirm):
-- ----------------------------------------------------------------------------
-- SELECT
--   c.client_id,
--   c.client_name AS clients_name,
--   JSON_UNQUOTE(JSON_EXTRACT(cb.brief_payload, '$.company'))      AS brief_company,
--   JSON_UNQUOTE(JSON_EXTRACT(cb.brief_payload, '$.contact_name')) AS brief_contact,
--   JSON_UNQUOTE(JSON_EXTRACT(cb.brief_payload, '$.industry'))     AS brief_industry,
--   JSON_UNQUOTE(JSON_EXTRACT(cb.brief_payload, '$.website_url'))  AS brief_website,
--   JSON_LENGTH(cb.brief_payload) AS brief_field_count
--   FROM clients c
--   LEFT JOIN creative_briefs cb
--     ON cb.client_id = c.client_id AND cb.tenant_id = 'av'
--  ORDER BY c.client_id DESC;
