# Atlantic Hub -- Project Status 2026-05-17 (c)

Companion to PROJECT_STATUS_2026-05-17.md and PROJECT_STATUS_2026-05-17b.md.
Captures the Client Portal Phase 2A shipment.

---

## WHAT SHIPPED (2026-05-17c)

The Client Portal at `atlantic-hub.netlify.app/client/*`, end-to-end:
intake form -> magic link -> password set -> dashboard with audit + tier
upsells. Built on the existing operator-side auth scaffolding so there
are zero new secrets or third-party services.

### 1. Schema

New idempotent migration `schema/009_client_portal.sql` adds the
`shhdbite_AV.client_users` table:

- `client_user_id` PK, `client_id` FK to `clients` (nullable; populated
  best-effort from existing `leads.client_id` if the email matches).
- `email` UNIQUE, `display_name`.
- `password_hash` (nullable until first set), `magic_token` + 24h
  expiry (single-use, cleared on consumption).
- `tier` ENUM `audit_only / starter / growth / scale` (the portal's
  tier; the legacy `clients.plan_tier` ENUM is left untouched and
  unused by the portal -- reconcile in a later sweep).
- `email_verified_at`, `last_login_at`, `intake_payload` (JSON
  forensic record), `archived_at` soft-delete.

Indexes: unique on email, regular on `client_id`, `magic_token`,
`archived_at`.

### 2. Auth layer (mirrors operator auth one-for-one)

| File | Role |
| --- | --- |
| `lib/auth/client-jwt.ts` | `signClientSessionJwt()` -- HS256 + JWT_SECRET, 8h TTL, `aud=client-portal`. |
| `lib/auth/client-session.ts` | Cookie helpers for `ah_client_session` (HttpOnly + Secure + SameSite=Lax + Path=/). `readClientActorFromHeaders()` parses the middleware-attached headers. |
| `lib/auth/client-magic-token.ts` | 32-byte CSPRNG hex token, 24h TTL, `buildMagicLinkUrl()`. |
| `lib/auth/client-user.ts` | Typed query helpers: `findClientUserByEmail`, `findClientUserById`, `findClientUserByMagicToken`, `upsertClientUserForIntake`, `consumeMagicToken`, `setClientUserPasswordHash`, `markClientUserLoggedIn`. |
| `lib/auth/client-cors.ts` | (from a prior portal session) Env-driven origin allowlist for `/api/client/intake`. |
| `lib/client-portal/tiers.ts` | Single source of truth for the tier feature matrix used by both `/api/client/me` and `/client/dashboard`. |

### 3. API routes under `/api/client/*`

All six routes write `audit_log_global` rows via the existing `writeAuditRow()`
helper. Magic-link issuance is **console-logged** with a distinctive
`[client-portal:magic-link]` / `[client-portal:intake]` prefix for v1 --
no Resend / Postmark dependency. Val forwards the link from her inbox
until volume justifies a transactional email service.

| Route | Auth | Behaviour |
| --- | --- | --- |
| POST `/api/client/intake` | Public | Rate-limited 5/15min/IP. CORS-allowed for atlanticandvine origins. Upserts `client_users` by email, rotates magic token (24h), logs the link, best-effort backfills `client_id` from any matching `leads` row. Returns generic 200 either way (no user-existence leak). |
| GET `/api/client/magic-link/[token]` | Public | Validates hex format + DB lookup + expiry, single-use consumes the token, signs `ah_client_session`, redirects to `/client/set-password` (first time) or `/client/dashboard`. |
| POST `/api/client/login` | Public | Rate-limited 5/15min/IP. Constant-time bcrypt regardless of user existence. Sets cookie on success. |
| POST `/api/client/set-password` | Client session | Sets bcrypt hash, min 10 chars. |
| GET `/api/client/me` | Client session | Returns user profile + most-recent `audit_content` (joined by client_id preferred, email fallback) + leads count + tier feature matrix. |
| POST `/api/client/logout` | Client session | Clears the cookie. |

NOTE on `system_events`: per Val's directive, no `logEvent` calls in these
routes. Every place a system_events emit should land is marked with a
`// TODO(system_events)` or `[client-portal:*]` console marker for the
follow-up consolidation commit.

### 4. Middleware

Updated `middleware.ts` to gate both portals with separate cookies:

- Operator pages/APIs: `ah_session` (unchanged).
- Client portal: `ah_client_session`, only on the protected sub-paths:
  - `/client/dashboard/*`, `/client/audit/*`, `/client/set-password`
  - `/api/client/me`, `/api/client/set-password`, `/api/client/logout`
- Public client paths intentionally NOT in the matcher: `/client/login`,
  `/api/client/intake`, `/api/client/magic-link/[token]`, `/api/client/login`.
- Defense-in-depth: a `client_user` JWT cannot pass the operator
  matcher even if its cookie were somehow planted there.

### 5. Pages under `/client/*`

| Page | Component type | Contents |
| --- | --- | --- |
| `/client/login` | Client | Email + password form, error pill driven by `?error=` from failed magic links. Suspense-wrapped to satisfy Next 14's `useSearchParams` rule. |
| `/client/set-password` | Client | Password + confirm form, 10-char minimum, posts to `/api/client/set-password`. |
| `/client/dashboard` | Server | Reads `client_users` + most-recent audit directly from DB (no extra HTTP roundtrip). Hello block, audit preview (480-char ellipsis + "Read full audit -&gt;"), included-features grid, locked-features grid with tier badges, "Talk to us" CTA. |
| `/client/audit` | Server | Full `audit_content` rendered as `whitespace-pre-line` (markdown-safe, no extra dep). Print-friendly. |
| Shared header | `app/client/_components/PortalHeader.tsx` | Brand mark, nav, tier pill, sign-out button. |

Design: uses the existing atlantic-hub Tailwind tokens (`bg-surface`,
`text-ink`, `text-muted`, `bg-brand`, etc.) and the `data-tenant="av"`
accent override. The standalone `client-portal.html` design from
`/Documents/Claude/Projects/Atlantic And Vine/` informed the layout
language; we stayed inside the existing system rather than reintroducing
the dark + gold palette as a parallel stylesheet.

### 6. Marketing form

`atlanticandvine.netlify.app/client-intake` form: the submit handler in
`client-intake.html` now POSTs directly to
`https://atlantic-hub.netlify.app/api/client/intake` and checks for
`result.ok` on the response. The HostGator PHP `/process-intake` relay
is bypassed entirely for this form. The PHP `audit-form.html` flow at
`/submit-audit` is untouched and unaffected.

---

## FILES TOUCHED / ADDED

New in `atlantic-hub`:
- `schema/009_client_portal.sql`
- `lib/auth/client-jwt.ts`
- `lib/auth/client-session.ts`
- `lib/auth/client-magic-token.ts`
- `lib/auth/client-user.ts`
- `lib/client-portal/tiers.ts`
- `lib/client-portal/cors.ts` (deprecation shim; canonical CORS lives at `lib/auth/client-cors.ts` from the prior portal session; OneDrive locked deletion so the file was emptied instead)
- `app/api/client/login/route.ts`
- `app/api/client/logout/route.ts`
- `app/api/client/me/route.ts`
- `app/api/client/set-password/route.ts`
- `app/client/layout.tsx`
- `app/client/login/page.tsx`
- `app/client/set-password/page.tsx`
- `app/client/dashboard/page.tsx`
- `app/client/audit/page.tsx`
- `app/client/_components/PortalHeader.tsx`
- `docs/PROJECT_STATUS_2026-05-17c.md` (this file)

Inherited from a prior portal session (used as-is because they correctly
import the helper interfaces I built):
- `app/api/client/intake/route.ts`
- `app/api/client/magic-link/[token]/route.ts`
- `lib/auth/client-cors.ts`

Modified:
- `middleware.ts` -- adds client matcher branch + cookie split
- `docs/ENV_VARS_REFERENCE.md` -- adds the optional MAGIC_LINK_BASE_URL +
  PORTAL_ALLOWED_ORIGINS notes

New in `atlanticandvine` (marketing repo):
- `client-intake.html` -- modified the submit handler only

---

## VERIFICATION CHECKLIST

Run after Val deploys + applies the migration:

1. `npx tsc --noEmit` -> exit 0 (verified pre-commit, clean).
2. Run `schema/009_client_portal.sql` in phpMyAdmin against `shhdbite_AV`.
   Confirm: `SELECT COUNT(*) FROM client_users;` returns 0.
3. Submit the live client-intake form on
   `atlanticandvine.netlify.app/client-intake` with a test email.
   Confirm: one row in `client_users` (`SELECT email, tier,
   magic_token_expires_at FROM client_users ORDER BY created_at DESC LIMIT 1`).
4. In Netlify Functions logs, grep for `[client-portal:intake]` --
   copy the `magic_link` value out of the JSON.
5. Open the magic link in a fresh browser. Expect:
   - 302 to `/client/set-password`
   - cookie `ah_client_session` set
   - one new audit row in `audit_log_global` with
     `action='magic_link_consumed'`
6. Set a password (10+ chars), expect redirect to `/client/dashboard`.
7. Sign out, sign in with the new password, expect dashboard.
8. Verify `client_users.password_hash IS NOT NULL` and
   `last_login_at` updated.

---

## OPERATIONAL NOTES

- **No new SaaS.** No Resend / Postmark / Auth0 / Supabase. Reuses
  JWT_SECRET, the existing `audit_log_global` table, and the existing
  rate-limit infrastructure.
- **Magic links live in Netlify logs.** Until we wire a real email
  provider, the operator pulls the link from function logs and forwards
  it from the atlanticandvine inbox. Search marker:
  `[client-portal:intake]`.
- **Tier defaults to `audit_only`.** New intake submissions land at the
  free tier. Manually promote a row when a client pays:
  `UPDATE client_users SET tier='starter' WHERE email = ?`.
- **CORS is allowlist-based.** Default allowlist:
  `atlanticandvine.netlify.app`, `atlanticandvine.com`,
  `www.atlanticandvine.com`. Add more via `PORTAL_ALLOWED_ORIGINS` env.
- **One outstanding rename** -- the auto-scoring/events session moved
  their migration to `schema/010_system_events.sql` per Val's
  coordination. This portal session retains `009_client_portal.sql`.
- **Pending follow-up** (separate commit, separate session): wire
  `logEvent()` calls into the four portal route trail-points where the
  console markers `[client-portal:intake]`, `[client-portal:magic-link]`,
  `[client-portal:login]`, `[client-portal:set-password]` already log.

---

## WHAT THIS UNLOCKS

The free-audit funnel now ends in a dashboard rather than an email
inbox. Every intake submission gets a portal account in the
`audit_only` tier, sees their audit, sees what the paid tiers add, and
has a "Talk to us" CTA back to the marketing site. This is the
recurring engagement surface that turns transactional audit-buyers into
tiered subscribers.

Future sessions can layer on:
- Transactional email (Resend or Postmark) replacing the console-log v1.
- A "subscribed" admin button on `/admin/av/[audit_id]` that promotes
  the matching `client_users.tier` in one click.
- Per-tier lead-view embeds inside `/client/dashboard` for Starter+
  users (so they see their pipeline, not just their audit).
- The system_events wire-up for portal events (already trail-marked).
