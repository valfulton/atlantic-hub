/*
  074_client_users_display_name_cleanup — fix the "Good morning, Central." bug
  across every existing client account.

  Background: createClientFromOperator used to fall back to the company name
  when no contact was typed. Result — every account created without a contact
  has its person field stuffed with the brand name, so every greeting on every
  client page renders "Good morning, <Brand>."

  Code fix already shipped (lib/av/create_client.ts + lib/client/display_name.ts +
  greetingName helper on every /client/* page). This migration cleans the
  existing data so every client account starts fresh on the next load.

  What it does (every account, no carve-outs):
   1. Where display_name equals the linked client's client_name -> NULL it.
   2. Where display_name equals the first word of the linked client's
      client_name (e.g. "Central" for "Central Bottle Brunch") -> NULL it.
   3. Where display_name equals known sentinels ('there', 'friend', 'client',
      'unknown', '-', 'n/a') -> NULL it.

  After this runs, the greeting fallback ("there") wins on every account that
  doesn't have a real contact name set. Operators can fix individual accounts
  via /admin/av/clients/<id> -> Edit account info -> Contact name.

  Idempotent — safe to re-run.
*/

-- 1. Exact brand-name match
UPDATE client_users cu
  JOIN clients c ON c.client_id = cu.client_id
   SET cu.display_name = NULL
 WHERE cu.archived_at IS NULL
   AND cu.display_name IS NOT NULL
   AND TRIM(cu.display_name) <> ''
   AND LOWER(TRIM(cu.display_name)) = LOWER(TRIM(c.client_name));

-- 2. First-word-of-brand match (catches "Central" inside "Central Bottle Brunch")
UPDATE client_users cu
  JOIN clients c ON c.client_id = cu.client_id
   SET cu.display_name = NULL
 WHERE cu.archived_at IS NULL
   AND cu.display_name IS NOT NULL
   AND TRIM(cu.display_name) <> ''
   AND LOWER(TRIM(cu.display_name)) = LOWER(SUBSTRING_INDEX(TRIM(c.client_name), ' ', 1));

-- 3. Sentinel placeholders we used in older intake flows
UPDATE client_users
   SET display_name = NULL
 WHERE archived_at IS NULL
   AND LOWER(TRIM(COALESCE(display_name, ''))) IN ('there', 'friend', 'client', 'unknown', '-', 'n/a');
