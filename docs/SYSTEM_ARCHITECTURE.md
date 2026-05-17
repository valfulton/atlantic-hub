# Atlantic Hub - System Architecture

**Permanent reference document.** Every Claude Code session should read this
before writing infrastructure code. Updated when architecture decisions change,
not when individual features ship.

**Last reviewed:** 2026-05-17

---

## OWNERSHIP AND TENANT STRUCTURE

**Atlantic And Vine LLC** is the parent company. It owns and operates all
tenants on Atlantic Hub:

- **Atlantic & Vine** — the agency offering (lead gen, marketing, websites, content). Customer-facing brand.
- **Events by Water** — boat charter marketplace. DBA under Atlantic And Vine LLC. Separate product.
- **HunterHoney** — Val's other brand (crypto/AI education). Separate product, separate tenant.

External clients of Atlantic & Vine eventually become additional tenants on the
same platform (white-label deployment per Architecture doc Phase 4).

---

## INFRASTRUCTURE

### Hosting layer

| Layer | Provider | Why |
|-------|----------|-----|
| Operator dashboard | Netlify (Next.js 14 App Router) | Auto-deploy from GitHub, scheduled functions support |
| Marketing site | Netlify (static HTML/CSS/JS) | Same |
| PHP backend (forms, audit) | HostGator File Manager | Manual upload, legacy |
| Databases | HostGator MariaDB (MySQL-compatible) | Already paid as part of hosting, no urgent migration |
| Object storage (when needed) | TBD - S3 or Cloudflare R2 | Not yet adopted |

### Database layout

Four databases on HostGator MariaDB, all named with the `shhdbite_` prefix:

```
shhdbite_atlantic_hub  - platform-level: organizations, admin_users, audit_log
shhdbite_AV            - Atlantic & Vine: leads, lead_events, audits, clients, client_users
shhdbite_eventsbywater - EBW: bookings, revenue_entries, marketing_activity, vessel_partners
shhdbite_hunterhoney   - HH: subscribers, fap_applications, cohort_waitlist
```

Cross-tenant queries are app-layer joins, not foreign keys across databases.
Each tenant DB has its own connection pool in `lib/db/<tenant>.ts`.

### App-layer tenant isolation

- `lib/api-guard.ts` exports `guardAdminRequest({ targetResource, tenantId })`
- Every API route calls it as the first line of the handler
- Guard returns guard.actor with .role and .userId
- Role checks happen in each route: `if (guard.actor.role === 'client_user') return forbidden`
- Cross-pollination is prevented at the application layer, not at DB-level RLS

This works because all tenants have one operator (Val) right now. When external
paying tenants come online, this needs to upgrade to actual row-level isolation
(either via Postgres+RLS or via stricter app-layer scoping with audit). Plan
for that exists but is deferred until first external client signs.

---

## DEPLOYMENT TOPOLOGY

| Property | Repo | Deploy trigger | Build time |
|----------|------|----------------|------------|
| atlantic-hub.netlify.app | github.com/valfulton/atlantic-hub | Push to main | ~90s |
| atlanticandvine.netlify.app | github.com/valfulton/atlanticandvine | Push to main | ~30s |
| api.atlanticandvine.com | Not in git | Manual upload to HostGator File Manager | n/a |
| atlanticandvine.com | Pixieset | n/a | n/a |

There is a deploy-everything.sh in ~/Downloads/ that pushes both git repos at
once with a single commit message. Schema migrations run manually in
phpMyAdmin against shhdbite_AV.

---

## CORE DATA MODEL: shhdbite_AV.leads

The single most important table in the system. Every discovery source writes
here. Every UI surface reads from here.

Key columns (not exhaustive):
- `id`, `audit_id` (UUID), `client_id` (nullable, FK to clients)
- `company`, `contact_name`, `contact_title`, `email`, `phone`, `website`
- `normalized_domain` (cross-source dedup key)
- `industry` (slug from normalizers)
- `lead_status` ENUM(new, contacted, qualified, converted, lost)
- `source_type` ENUM(audit_form, csv, scrape, manual, api)
- `target_business` ENUM(av, ebw, both) - auto-set by industry heuristic
- `apollo_person_id` (UNIQUE, used for cross-source dedup tokens like 'placeid:xxx' or 'ig:foo')
- `enrichment_status`, `enriched_at`
- `ai_score`, `ai_score_band` (hot/warm/cool), `ai_score_reason`
- `audit_content` (the AI Strategic Marketing Audit, populated by the audit pipeline)
- `notes`, `tags` (JSON), `follow_up_date`
- `archived_at` (soft-delete; filtered out of all reads)
- `last_activity_at`, `created_at`, `updated_at`

Schema lives in atlantic-hub/schema/. Migrations 001-008 are applied. Run new
migrations manually in phpMyAdmin > shhdbite_AV > SQL tab.

---

## DISCOVERY + ENRICHMENT PIPELINE

```
[Discovery sources]              [Cross-source dedup]        [Enrichment]
- Apollo organizations/search    --> normalized_domain ---> Hunter.io daily cron
- Google Places (New)                 + apollo_person_id     + inline scrape on IG insert
- Apify Instagram                                            + bulk-fill button
- Direct contact-page scraper

[AI layer]
- ai_score, ai_score_band, ai_score_reason
- audit_content (Strategic Marketing Audit)
- Per-lead social content generator (LinkedIn / Twitter / Instagram drafts)
```

### Source dedup tokens stored in `apollo_person_id`

To share the UNIQUE constraint on a single column, dedup keys from different
sources use prefixes:
- Apollo person: `<apollo_person_uuid>`
- Apollo company shell: `<apollo_org_uuid>`
- Google Places: `placeid:<place_id>`
- Instagram: `ig:<handle>`

Cross-source dedup THEN runs on normalized_domain + phone before any insert.
Same physical business across sources merges to one row.

---

## SERVICES LAYER (logical organization)

Code is organized by service responsibility in `lib/`:

```
lib/
  apollo/           Apollo.io search + discoverer
  google_places/    Places API + discoverer
  apify/            Instagram scraper + discoverer
  scraper/          Contact-page regex scraper
  enrichment/       Hunter.io enrichment + cron logic
  leads/            Core lead utilities (dedup, target_business heuristic)
  openai/           OpenAI client (chat, JSON parsing)
  csv/              CSV parser, header mapping
  db/               Per-tenant connection pools (av.ts, hh.ts, ebw.ts, platform.ts)
  api-guard.ts      Auth + rate limit + audit wrapper
  feature-flags.ts  isFlagEnabled() against shhdbite_atlantic_hub.feature_flags
  server-fetch.ts   Server-side internal fetch wrapper
```

Even if these all live in one repo today, treat them as distinct services
when designing. Each should be self-contained, testable, replaceable.

---

## AUTH MODEL

- JWT-based, signed with `JWT_SECRET`
- Issuer set via `JWT_ISSUER`
- Roles (real enum in code, three values): `'owner' | 'staff' | 'client_user'`
  - Defined in `lib/api-guard.ts:19`, `lib/auth/jwt.ts:16`, `lib/auth/session.ts:41`
  - `owner` = Val (full access, multi-tenant)
  - `staff` = internal team members (full access except tenant management)
  - `client_user` = external paying clients (scoped to their own data only)
- Owner bootstrap via `OWNER_BOOTSTRAP_EMAIL` + `OWNER_BOOTSTRAP_PASSWORD_HASH`
- bcryptjs for password hashing
- Session cookie set on login, HttpOnly + Secure + SameSite=Lax

When client portal ships: client_users sit in `shhdbite_AV.client_users`
(separate from internal users in `shhdbite_atlantic_hub.admin_users`).

---

## EVENT LOGGING (planned, not yet built)

Per architectural review 2026-05-17: build a unified `system_events` table.
Current state has domain-specific event tables (lead_events, apollo_search_log,
hunter_credit_log) but no unified analytics surface.

Proposed schema (when built):
```
system_events
  id, event_type, organization_id, lead_id, user_id, source,
  payload (JSON), status, execution_time_ms, created_at
```

Event types to capture:
- lead.created, lead.enriched, lead.scored
- audit.generated
- outreach.generated, outreach.sent, outreach.replied
- commercial.generated
- workflow.failed, api.rate_limited, api.cost_threshold_hit

This becomes the observability layer + AI memory stream + debugging
infrastructure. Should be built early to avoid retrofitting.

---

## EXTERNAL APIs IN USE

| API | Purpose | Plan |
|-----|---------|------|
| Hunter.io | Email verification | Free 50/mo - upgrading to paid when justified |
| Apollo.io | B2B contacts | Master API key, current plan covers organizations/search + organization_top_people |
| Apify | Instagram + future scrapers | $5/mo free credit |
| Google Places API (New) | Local business discovery | Free under $200/mo Maps credit |
| OpenAI | AI scoring, audits, social content | Pay-as-you-go, ~$5-30/mo |
| Grok (xAI) | Image + video generation (planned) | Imagine API at $0.02/image, $0.05/sec video |

Env var names live in /docs/ENV_VARS_REFERENCE.md.

---

## SCHEDULED JOBS

Currently one:
- `netlify/functions/enrich-cron.mts` — daily 6 AM UTC. Calls
  /api/admin/av/enrich which iterates over leads needing Hunter enrichment.

When more scheduled jobs land (auto-scoring sweep, outreach send queue),
revisit n8n adoption. For now Netlify scheduled functions are sufficient.

---

## KNOWN ARCHITECTURAL DEBTS

1. **No unified event log.** Domain-specific tables exist; unified `system_events` not yet built.
2. **App-layer tenant isolation only.** Will need row-level isolation before first external paying tenant.
3. **No retry / queue layer.** Failed Hunter calls just log and continue. No automatic retry.
4. **No rate-limit observability.** API rate limit hits log but don't surface in dashboard.
5. **No file storage.** When AI commercial generation ships, need S3 or similar.

---

## NON-NEGOTIABLES (decisions Val has locked in)

- Stay on HostGator MariaDB. No Supabase migration.
- Keep git repos in OneDrive. No moving to ~/Documents/Code.
- No SaaS subscriptions until a paying client justifies the cost (cost-passthrough model).
- ASCII-only in shell commands and commit messages.
- No founder name on customer-facing copy. Brand voice plural.
