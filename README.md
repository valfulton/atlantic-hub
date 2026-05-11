# Atlantic Hub

The unified operator dashboard across **HunterHoney Research**, **Atlantic & Vine**, **Events by Water**, and future business lines (mortgage advisory, debt servicing, etc.).

One auth system. One audit log. One platform-level identity model. Per-tenant detail tables. Adding a new tenant later is a schema migration, not a rewrite.

## Architecture in one paragraph

A Next.js 14 app on Netlify, talking to four HostGator MySQL databases. One platform DB (`shhdbite_atlantic_hub`) holds the auth, accounts, tenant links, audit log, feature flags, rate-limit buckets, and webhook event log. Three tenant DBs (`shhdbite_hunterhoney`, `shhdbite_av`, `shhdbite_ebw`) hold per-tenant detail. The platform-level `accounts` table is the canonical record for a person; `tenant_account_link` records the relationship a person has with each tenant, with tenant-specific `account_type` values. Auth is bcrypt-12 password hashes + HS256 JWTs in an HttpOnly+Secure+SameSite=Strict cookie. Every API call writes one audit row. Inbound Netlify Forms submissions arrive at a secret-verified webhook and get normalized into the platform identity model + the appropriate detail table.

## V1 scope

- ✅ Auth (login, logout, session cookies, rate-limited)
- ✅ Cross-company home (MRR + recent activity)
- ✅ HH tab end-to-end (subscribers, FAP applications, cohort waitlist, Research API customers)
- ✅ Netlify Forms webhook ingestion (4 forms)
- ✅ Audit log on every action
- ✅ Feature flag kill switches
- ✅ Rate limiting (login, API, webhook)
- ⏳ AV + EBW tabs — v2
- ⏳ Any CRUD — v2

## Folders

```
app/              # Next.js App Router pages + API routes
components/       # Shared UI primitives
lib/              # DB pools, auth, audit, crypto, webhook ingest, rate-limit, flags
docs/             # Recovery runbook
schema/           # SQL migrations (run in order: 001 → 002 → 003)
scripts/          # Local-only utilities (generate-owner-hash.js)
tests/            # Smoke test suite
```

## First-deploy checklist

1. **Run the SQL** in HostGator phpMyAdmin: `schema/001_platform.sql` and `schema/003_seed.sql` against `shhdbite_atlantic_hub`; `schema/002_hh_detail.sql` against `shhdbite_hunterhoney`.
2. **Generate the owner password hash** locally: `node scripts/generate-owner-hash.js`. Copy the hash.
3. **Set Netlify env vars** on the `atlantic-hub` site (see `.env.example` for the full list).
4. **Push to GitHub.** Netlify auto-deploys.
5. **Run the smoke tests** against the preview URL: `BASE_URL=https://atlantic-hub.netlify.app WEBHOOK_SECRET=... bash tests/smoke.sh`.
6. **Wire Netlify Forms webhooks** in the HunterHoney site to POST to `https://atlantic-hub.netlify.app/api/webhooks/netlify-forms` with the `X-Atlantic-Hub-Webhook-Secret` header.
7. **Cut DNS** to `admin.atlanticandvine.com` once smoke tests are green.

## When something breaks

Read `docs/recovery.md`. Three procedures cover the realistic failure modes.

## Notes on growth

This namespace is `atlantic-hub`, not `hunterhoney-*`, because the architecture is platform-shaped. Adding a fourth tenant (e.g., mortgage advisory) is:

1. `INSERT INTO tenants ...` in the platform DB
2. Create `shhdbite_mortgage_v1` with its own detail tables
3. Add a `lib/db/mortgage.ts` pool
4. Add routes under `app/admin/mortgage/*`
5. Add a sidebar nav entry behind a `tab_mortgage_enabled` feature flag

The auth, audit, accounts, and feature-flag layers do not change.
