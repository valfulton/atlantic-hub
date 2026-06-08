-- 080_backfill_brief_insert_missing.sql (#517 follow-up, val 2026-06-08)
--
-- 079 only UPDATE'd existing rows. Mark Francis (and likely other freshly
-- created clients) have NO row in creative_briefs yet, so the UPDATE was a
-- no-op even though their audit snapshot exists. This script does the
-- INSERT half: creates a creative_briefs row with website_url populated
-- from the latest snapshot for every client missing one.
--
-- Safe to run repeatedly. Only inserts when:
--   - the client has at least one website_audit_snapshots row with a
--     non-empty homepage_url,
--   - AND no creative_briefs row exists for (tenant_id, client_id).
--
-- After this runs, every audited client will have a brief row containing
-- at minimum { "website_url": "<their homepage>" }. Pre-flight on those
-- clients will show the website + the brief field count.

-- Step 1: INSERT brief rows for clients with a snapshot but no brief row.
INSERT INTO creative_briefs (tenant_id, client_id, brief_payload)
SELECT 'av', s.client_id, JSON_OBJECT('website_url', s.homepage_url)
  FROM website_audit_snapshots s
  JOIN (
    SELECT client_id, MAX(created_at) AS max_at
      FROM website_audit_snapshots
     WHERE tenant_id = 'av'
       AND client_id IS NOT NULL
     GROUP BY client_id
  ) latest ON latest.client_id = s.client_id AND latest.max_at = s.created_at
  LEFT JOIN creative_briefs cb
    ON cb.tenant_id = 'av' AND cb.client_id = s.client_id
 WHERE cb.id IS NULL
   AND s.homepage_url <> '';

-- Step 2: Re-run the 079 UPDATE for any briefs that now exist but still
-- lack a website_url (covers the case where a brief row existed but with
-- a different shape).
UPDATE creative_briefs cb
JOIN (
  SELECT s.client_id, s.homepage_url
    FROM website_audit_snapshots s
    JOIN (
      SELECT client_id, MAX(created_at) AS max_at
        FROM website_audit_snapshots
       WHERE tenant_id = 'av'
         AND client_id IS NOT NULL
       GROUP BY client_id
    ) latest ON latest.client_id = s.client_id AND latest.max_at = s.created_at
   WHERE s.homepage_url <> ''
) ws ON ws.client_id = cb.client_id
SET cb.brief_payload = JSON_SET(
      COALESCE(cb.brief_payload, JSON_OBJECT()),
      '$.website_url',
      ws.homepage_url
    )
WHERE cb.tenant_id = 'av'
  AND (
    cb.brief_payload IS NULL
    OR JSON_TYPE(JSON_EXTRACT(cb.brief_payload, '$.website_url')) = 'NULL'
    OR JSON_UNQUOTE(JSON_EXTRACT(cb.brief_payload, '$.website_url')) = ''
  )
  AND (
    cb.brief_payload IS NULL
    OR JSON_TYPE(JSON_EXTRACT(cb.brief_payload, '$.websiteUrl')) = 'NULL'
    OR JSON_UNQUOTE(JSON_EXTRACT(cb.brief_payload, '$.websiteUrl')) = ''
  )
  AND (
    cb.brief_payload IS NULL
    OR JSON_TYPE(JSON_EXTRACT(cb.brief_payload, '$.website')) = 'NULL'
    OR JSON_UNQUOTE(JSON_EXTRACT(cb.brief_payload, '$.website')) = ''
  )
  AND (
    cb.brief_payload IS NULL
    OR JSON_TYPE(JSON_EXTRACT(cb.brief_payload, '$.companyWebsite')) = 'NULL'
    OR JSON_UNQUOTE(JSON_EXTRACT(cb.brief_payload, '$.companyWebsite')) = ''
  );

-- Step 3: Verify — list every client + whether the brief now has a website.
-- SELECT
--   c.client_id,
--   c.client_name,
--   JSON_UNQUOTE(JSON_EXTRACT(cb.brief_payload, '$.website_url')) AS website_on_brief,
--   (SELECT homepage_url FROM website_audit_snapshots
--     WHERE client_id = c.client_id AND tenant_id = 'av'
--     ORDER BY created_at DESC LIMIT 1) AS latest_snapshot_url
--   FROM clients c
--   LEFT JOIN creative_briefs cb
--     ON cb.client_id = c.client_id AND cb.tenant_id = 'av'
--  WHERE c.tenant_id = 'av'
--  ORDER BY c.client_id DESC;
