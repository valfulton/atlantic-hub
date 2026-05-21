# BUILD NOW: Social OAuth Connect (LinkedIn + X) -- v1 connect flow only

You are the Social Posting build session. Ship the OAuth **connect** flow so
the "Connect LinkedIn" and "Connect X" buttons on /admin/social actually work.
Posting/scheduling is a later phase -- do NOT build it now. Get accounts
connected and listed. That is the whole milestone.

This is grounded in the current repo (verified 2026-05-21). Do not guess at
names below -- they are real.

## Scope (do exactly this)

1. `lib/social/encrypt.ts` -- token encryption. Model it on the existing
   `lib/email/encrypt.ts` (which exports `encryptString` / `decryptString`),
   but read the key from `SOCIAL_TOKEN_ENCRYPTION_KEY` (64-char hex, already
   set in Netlify). Returns string ciphertext for the TEXT columns. NEVER log
   tokens.

2. Routes (App Router, `runtime = 'nodejs'`, `dynamic = 'force-dynamic'`):
   - `GET /api/admin/social/oauth/linkedin/start`
   - `GET /api/admin/social/oauth/linkedin/callback`
   - `GET /api/admin/social/oauth/x/start`
   - `GET /api/admin/social/oauth/x/callback`
   - `GET /api/admin/social/connections?tenant=<id>`  (list active connections)
   - `POST /api/admin/social/connections/[id]/disconnect`  (set status='revoked')

   `start` builds the provider authorize URL with a CSRF `state` (signed or a
   short-lived httpOnly cookie) and a `tenant` param, then redirects.
   `callback` validates state, exchanges the code for tokens, fetches the
   account profile (id + display name), encrypts the tokens, upserts a
   `social_connections` row, and redirects to `/admin/social?connected=<provider>`.
   On error redirect to `/admin/social?oauth_error=<reason>`.

3. Wire the UI: in `app/admin/social/SocialIntegrationsBoard.tsx`, replace the
   placeholder "SHIPS NEXT SESS" buttons for **LinkedIn and X only** with real
   anchors to `/api/admin/social/oauth/<provider>/start?tenant=<selectedTenant>`,
   and render the connected-accounts list from
   `GET /api/admin/social/connections`. Leave Instagram / Facebook / TikTok as
   the existing "pending" placeholders.

## Auth + tenancy (use what exists)

- Guard every route with `guardAdminRequest` from `lib/api-guard.ts`. Role enum
  is `'owner' | 'staff' | 'client_user'`. Owners + staff only; `client_user` is
  rejected. (The page already redirects `client_user` away.)
- `tenant_id` comes from the "POSTING AS" switcher on the page (`av`, `ebw`,
  `hh`, or `client:<id>`). Default `av`. Store it on the connection.

## Storage: write to social_connections (schema 017, already in prod)

Columns (real): `tenant_id`, `provider` ENUM('linkedin','x',...),
`provider_account_id`, `display_name`, `avatar_url`, `scopes_json`,
`access_token_enc` (NOT NULL), `refresh_token_enc`, `access_token_expires_at`,
`refresh_token_expires_at`, `status` ENUM('active','revoked','expired','error'),
`last_error`, `connected_by_user_id`, `connected_at`, `last_used_at`.

Upsert on (`tenant_id`,`provider`,`provider_account_id`): re-connecting the same
account updates tokens instead of duplicating. Set `connected_by_user_id` to the
acting owner's userId from the guard.

## Provider specifics

LinkedIn (OAuth 2.0): scopes `openid profile w_member_social`. Authorize at
`https://www.linkedin.com/oauth/v2/authorization`, token at
`https://www.linkedin.com/oauth/v2/accessToken`. Profile via the OpenID
userinfo endpoint. Redirect URI registered in the app:
`https://atlantic-hub.netlify.app/api/admin/social/oauth/linkedin/callback`.

X / Twitter (OAuth 2.0 + PKCE, required): scopes
`tweet.read tweet.write users.read offline.access` (offline.access yields the
refresh token). Authorize at `https://twitter.com/i/oauth2/authorize`, token at
`https://api.twitter.com/2/oauth2/token`. Account via `GET /2/users/me`.
Redirect URI registered:
`https://atlantic-hub.netlify.app/api/admin/social/oauth/x/callback`.

Env already set (do NOT change or print): `LINKEDIN_CLIENT_ID`,
`LINKEDIN_CLIENT_SECRET`, `X_CLIENT_ID`, `X_CLIENT_SECRET`,
`SOCIAL_TOKEN_ENCRYPTION_KEY`.

## Hard constraints

- Do NOT drop or recreate the schema 017 tables -- they exist in production.
  If you genuinely need a new column, write `schema/024_*.sql` as an idempotent
  ALTER (information_schema guard). Never DROP. Reserve 024 in
  docs/SESSION_COORDINATION.md before writing it.
- Do NOT build posting/scheduling/social_outbox in this pass.
- Do NOT add Meta/Instagram/Facebook/TikTok (still in review queues).
- Do NOT log access or refresh tokens, ever.
- ASCII only in any commit messages.
- You own `/api/admin/social/**`, `lib/social/**`, and
  `app/admin/social/SocialIntegrationsBoard.tsx`. Nothing else touches these.

## Done = verifiable

After deploy: `/admin/social` shows a real "Connect LinkedIn" button. Clicking
it opens LinkedIn sign-in -> approve -> lands back on `/admin/social` with the
account listed and a Disconnect button. Same for X. Report the commit hash when
shipped.
