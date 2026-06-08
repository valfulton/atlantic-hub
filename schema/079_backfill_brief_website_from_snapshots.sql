-- 079_backfill_brief_website_from_snapshots.sql (#517, val 2026-06-08)
--
-- Backfill creative_briefs.brief_payload.website_url from the latest
-- website_audit_snapshots.homepage_url for clients who:
--   - have a successful audit snapshot on file (so the URL is known-good),
--   - AND don't already have a website_url on their brief.
--
-- The trigger: val pasted Mark Francis's website (ndvip.com), ran the audit
-- and brand-kit + intake-fill scrapes — all of which fetched the URL
-- successfully — but none of those endpoints wrote the URL back to the brief.
-- So pre-flight kept saying "no website on brief" forever. The fix landed in
-- TypeScript (#517 stampWebsiteOnBrief helper wired into all three routes),
-- but that fix only stamps on NEW scrapes. This script heals the data that
-- already exists.
--
-- Safe to run repeatedly. Idempotent. Only touches briefs that:
--   - have NO website_url (or it's empty / null),
--   - DO have a corresponding latest snapshot with a homepage_url.
--
-- After this runs, the affected briefs will show their website on /admin/av/
-- clients/[id] pre-flight, and resolveClientWebsite() will return the URL.

-- Step 1: One-off CTE-style update via a derived table. For each client_id,
-- pull the homepage_url from the MOST RECENT audit snapshot. Apply only when
-- the brief currently lacks a website on any of the historical keys.

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
  -- Also defensive: don't run over the (other) legacy keys, since the
  -- resolver checks websiteUrl / website / companyWebsite as fallbacks. If
  -- ANY of those is set, leave the brief alone.
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

-- Step 2: Mirror to client_users.intake_payload (same key) so the preview
-- intake page renders the URL too. Same blanks-only safety.

UPDATE client_users cu
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
) ws ON ws.client_id = cu.client_id
SET cu.intake_payload = JSON_SET(
      COALESCE(cu.intake_payload, JSON_OBJECT()),
      '$.website_url',
      ws.homepage_url
    )
WHERE (
  cu.intake_payload IS NULL
  OR JSON_TYPE(JSON_EXTRACT(cu.intake_payload, '$.website_url')) = 'NULL'
  OR JSON_UNQUOTE(JSON_EXTRACT(cu.intake_payload, '$.website_url')) = ''
);

-- Step 3: Verification — list the briefs that now have a website_url
-- populated AND have a snapshot, with the client name. Run this AFTER the
-- updates above to confirm the heal worked.
--
-- SELECT
--   c.client_id,
--   c.client_name,
--   JSON_UNQUOTE(JSON_EXTRACT(cb.brief_payload, '$.website_url')) AS website_on_brief,
--   (SELECT homepage_url FROM website_audit_snapshots s
--     WHERE s.client_id = c.client_id
--     ORDER BY created_at DESC LIMIT 1) AS latest_snapshot_url
--   FROM clients c
--   LEFT JOIN creative_briefs cb ON cb.client_id = c.client_id AND cb.tenant_id = 'av'
--  WHERE c.tenant_id = 'av'
--  ORDER BY c.client_id DESC;
