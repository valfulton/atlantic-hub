# Handoff — State of the Union (atlantic-hub + AV + EBW)

**Date:** 2026-05-16 (last updated **end of day** 2026-05-16 — read EOD UPDATE section first)
**Author:** Val Fulton + Claude (Cowork session)
**Audience:** the next Claude session, or future Val
**Read time:** 10 minutes — this is the source of truth

---

## 🌊 EOD UPDATE — 2026-05-16 (after a week of debugging, IT'S WORKING)

**Atlantic Hub is partially operational. Two of three tenants verified working; HH is unverified.**

- ✅ **`/admin/av` shows 35 leads** — VERIFIED via screenshot. 12 audit-form + 23 St. Croix prospects, all with AI scoring badges (hot/warm/cool), industry classification, and the AV Phase 2 write paths (notes, events, status edits, follow-up dates) functional.
- ✅ **`/admin/ebw/inquiries` shows real charter inquiries** — VERIFIED via screenshot. 3 rows from `shhdbite_eventsbywater.charter_inquiries` render correctly. Other EBW sub-pages (bookings, revenue, partners, investors, marketing activity) render but show 0 because those tables are genuinely empty — NOT confirmed they would render data if data existed (same risk as HH below).
- 🟡 **`/admin/hh` — UNVERIFIED**. All HH tables (`subscribers`, `fap_applications`, `cohort_waitlist`, `research_api_customers`, `ad_events`) are empty per Val's phpMyAdmin check. We DO NOT have proof the HH connection works — it could have the exact same wrong-password bug AV had. Next session must verify before claiming HH is operational. To verify: refresh `/admin/hh/subscribers` and check the Netlify Functions log for `[hh:...]` error lines.
- 🟡 **Platform DB (`shhdbite_atlantic_hub`) reads** — implied working because login succeeds and pages render, but never directly tested. If the platform read path was broken via wrong-password, login itself would likely fail with 500. So this is probably fine, but un-stress-tested.

The unified multi-tenant operator dashboard described in the README of this repo is now **partially live reality** — the architecture works, two of three tenants are visibly reading data, and the foundation for the third is in place. Don't claim it's "fully working" until HH is independently verified.

### What was actually wrong (the real root cause)

The "0 rows visible" bug was NOT a host-scope issue, NOT a Remote MySQL allowlist issue, NOT a user-grant issue. It was a **wrong password in Netlify's `DB_PASS_AV` env var** — different password than what cPanel had for `shhdbite_av_remote`. Val reset the password in cPanel, copied the new value into `DB_PASS_AV` with "Same value across all deploy contexts" enabled, and 35 leads appeared immediately.

The MySQL error `Access denied for user '...' (using password: YES)` is **misleading**: `(using password: YES)` only means "the client sent a password" — NOT "the password was correct." Multiple Claude sessions (including this one) read it as "auth passed, must be grants" — wrong. Reset the password FIRST in any future `Access denied` scenario; it's the cheapest test.

Bonus diagnosis: when Netlify env vars are set as "Secret," the UI defaults to populating one context only. Some `DB_PASS_*` vars had different values in different deploy contexts. Always use "Same value across all deploy contexts" for DB passwords.

### Other things fixed end-of-day

- **EBW dashboard column mismatches** — my initial code referenced columns (`message`, `vessel_length`, `home_port`, `passenger_capacity`, `daily_rate`, `years_experience`, `home_waters`, `city`, `state`, `investment_interest`) that don't exist on the live `shhdbite_eventsbywater` tables. Fixed in commits after `3c4d29b`. Live table schemas now documented at the bottom of this file.
- **`DB_NAME_EBW` env var typo** — was set to `hhdbite_eventsbywater` (missing leading `s`). Val fixed.

### Open items (NOT blocking — for next session)

1. **`form_handler.php` on the EBW marketing site is out of sync** — missing handlers for `partner_accounts`, `partner_availability`, the 5 St. Croix forms, `safe_requests`. Submissions for those are landing in Formspree only, NOT in MySQL. Needs a dedicated session to add the missing PHP handlers and upload via cPanel. See `EVENTS BY WATER 2026/NEXT_SESSION_TODOS.md` for the previous attempt.
2. **AI-powered automation rollout (Val's next push)** — automated cold emails to the 35 leads, AI scoring pipeline for inbound leads, scheduled outreach sequences. The `ai_integrations` table in `shhdbite_AV` has 5 seed rows (Grok, ChatGPT/DALL-E, Buffer, LinkedIn, WordPress) ready to wire. The `lead_events` table tracks `ai_email_drafted`, `email_opened`, `email_clicked` event types. Foundation is built; needs the orchestration layer.

2b. **The "real lead-gen finder" — what AV is supposed to be (Val's explicit ask 2026-05-16 evening).** Val confirmed the use case: dogfood the same lead-gen product she'll later sell to AV clients. What exists today is the **management** side (atlantic-hub manages leads in the DB). What does NOT exist is the **discovery** side (sourcing net-new leads). Per the original AV portal handoff doc, the discovery layer was always meant to come from a third-party scraper (Phantombuster, Apollo, TexAu, or CSV upload from Sales Navigator). Build order proposed:
   1. **CSV import endpoint** — `/admin/av/import` page + `POST /api/admin/av/import` route that accepts multipart upload, dedupes by email, INSERTs with `source_type='csv'`. Universal: Sales Nav / Apollo / Phantombuster all export CSV.
   2. **Auto AI scoring** — Netlify function picks up unscored leads, calls Claude API to populate `ai_score`/`ai_score_band`/`ai_score_reason`/`ai_email_subject`/`ai_email_body`. Costs ~$0.01/lead via Anthropic API. Triggered by import OR scheduled.
   3. **Apollo trial (optional)** — sign up for Apollo's 10-day free trial; if their B2B database covers Val's verticals (especially St. Croix hospitality which may be thin), upgrade to $49/mo Basic. Otherwise stick with Sales Nav → CSV.
   4. **Client portal deploy (later)** — once #1-3 work for Val herself, wire up the existing `client-portal.html` for paying AV clients with magic-link auth + client_id scoping. The PHP routes (`Atlantic And Vine/api/portal_routes.php`) and migration (`Atlantic And Vine/migrations/004_av_client_portal.sql`) are designed but never deployed.
   What NOT to do: don't try to scrape LinkedIn directly (account ban risk), don't sign up for Apollo paid plan before testing the free trial coverage, don't build the multi-tenant client onboarding flow before solving discovery for Val's own use case.

2a. **Convert `enrich.js` from CLI script to Netlify scheduled function (Val's explicit ask 2026-05-16 evening — Option C in our discussion).** The script lives at `~/Library/CloudStorage/OneDrive-atlanticandvine.com/EVENTS BY WATER 2026/launch_st_croix/enrich.js`. Currently it's a Node CLI that reads a local `.env` for credentials. **The clean refactor:** move it to atlantic-hub repo (probably `netlify/functions/enrich-leads.ts` with a cron schedule via `@netlify/functions` scheduled exports, OR `app/api/admin/av/enrich/route.ts` for a manual-trigger admin button — design decision pending). Reuses atlantic-hub's existing Netlify env vars (`DB_USER_AV`, `DB_PASS_AV`, `DB_NAME_AV`); add `HUNTER_API_KEY` as a new Netlify env var. Delete the local `.env.example` and the launch_st_croix script once converted. Rationale Val gave: "messy passwords and multiple places like db_config are going to hurt in the long run. if i forget one then i am going to spend hours debugging." — exactly right. Open design questions to decide together at start of refactor session:
   - Manual-trigger button in atlantic-hub admin UI, OR scheduled cron (daily/weekly), OR both?
   - Batch size cap per run (Hunter free tier = 25/month, so default to e.g. 5/run with a hard limit)?
   - Where do results surface in the UI? (Events tab on each enriched lead, plus a summary banner on /admin/av?)
   - Hunter credit tracking — store last-run-count somewhere so we don't blow through credits?
3. **`client-portal.html`** — beautiful 1,760-line per-client portal sitting unbuilt in `/Atlantic And Vine/`. Decision pending: deploy as the client-facing AV view (clients log in scoped by `client_id`), OR retire.
4. **Custom domain** — `admin.atlanticandvine.com` returns NXDOMAIN. Use `atlantic-hub.netlify.app` for now. DNS work later.
5. **EBW data drift items** — the live EBW DB has `leads`, `partner_accounts`, `partner_availability` tables not currently surfaced in atlantic-hub. Worth adding sub-pages for these in a follow-up.
6. **`DB_PASS_AV` "Local development (Netlify CLI)" context** — still has the OLD wrong password. Doesn't affect production but worth cleaning up if you ever run `netlify dev`.

### What this means for the AV-as-a-product story

The dashboard you're using to track YOUR prospects (Val's-own-business pipeline) is the same dashboard you'd offer to AV clients. The 35 St. Croix leads, scored by AI, with a working pipeline → **this is the demo.** Screenshot it. The architecture explicitly supports adding more `clients` rows in `shhdbite_AV.clients` so different AV clients can log in and see only their own leads via the existing `client_id` scoping.

---

## ORIGINAL TL;DR (kept for context — has been superseded by EOD UPDATE above)

1. **atlantic-hub is live** at `https://atlantic-hub.netlify.app` (custom domain `admin.atlanticandvine.com` is NOT yet configured — DNS work pending).
2. **The Events by Water tab shipped today** — visible in the sidebar with 6 sections (Inquiries, Bookings, Revenue, Partners, Investors, Marketing activity). Code is on `main` at commit `3c4d29b`.
3. ~~BLOCKING BUG to fix first — every tab that reads HostGator MySQL returns 0 rows~~ **RESOLVED — was a wrong password in `DB_PASS_AV`, not a grants issue. See EOD UPDATE above.**
4. ~~23 St. Croix prospects are staged but not loaded~~ **DONE — all 35 leads visible.**

---

## The architecture (it works — the bug is data-access, not design)

**One Next.js app, four HostGator MySQL databases:**

| DB | Purpose | Live? | Owner User on Netlify |
|---|---|---|---|
| `shhdbite_atlantic_hub` | Platform — auth, accounts, audit, feature_flags, tenants | ✅ | `DB_USER_PLATFORM` |
| `shhdbite_hunterhoney` | HH tenant detail | ✅ Working | `DB_USER_HH` = `shhdbite_hh_user` |
| `shhdbite_AV` | AV tenant detail (atlantic-hub v4 migration applied) | ⚠️ Reads 0 rows | `DB_USER_AV` = `shhdbite_av_remote` |
| `shhdbite_eventsbywater` | EBW tenant detail (form tables + new bookings/revenue/activity) | ⚠️ Reads 0 rows | `DB_USER_EBW` = `shhdbite_eventsuser` |

**Why HH works but AV/EBW don't:** unknown — that's exactly the bug to investigate. Same Next.js code path, same connection pool pattern. The only differences are the credentials and the underlying MySQL user grants. One theory: `shhdbite_hh_user` was created with the standard cPanel workflow that auto-grants `@'%'` (remote host); the other two users may have grants restricted to `@'localhost'`.

---

## What shipped today (commit `3c4d29b`)

### AV Phase 2 — write paths
- `POST /api/admin/av/leads/[audit_id]/notes` — create a note; also writes a `lead_event`
- `GET  /api/admin/av/leads/[audit_id]/notes` — list notes for a lead
- `GET  /api/admin/av/leads/[audit_id]/events` — read the activity timeline
- `PATCH /api/admin/av/leads/[audit_id]` — update status, follow_up_date, notes, tags; writes appropriate events
- `app/admin/av/[audit_id]/LeadDetailTabs.tsx` — Notes + Events tabs now functional (no more "coming in Phase 2" placeholders); Identity tab has editable status + follow-up date

These will work as soon as the AV 0-rows bug is fixed.

### EBW tab — new end-to-end
- `lib/db/ebw.ts` — DB pool pointing at `shhdbite_eventsbywater`
- `schema/005_ebw_detail.sql` — applied to `shhdbite_eventsbywater` today; creates 3 tables:
  - `bookings` (booking_id, booked_on, customer_name, market, vessel_partner, gross_revenue, ebw_commission, status, notes, …)
  - `revenue_entries` (entry_date, stream ENUM of 10 streams, amount, source, notes)
  - `marketing_activity` (occurred_on, activity_type, prospect_label, outcome, notes)
- 6 admin pages under `app/admin/ebw/`: overview + inquiries + bookings + revenue + partners + investors + activity
- 7 API routes under `app/api/admin/ebw/`: stats, bookings (GET+POST), revenue (GET+POST), inquiries (GET), partners (GET), investors (GET), activity (GET+POST)
- `components/Sidebar.tsx` updated with EBW_NAV + showEbw prop
- `app/admin/layout.tsx` reads `tab_ebw_enabled` flag in parallel with `tab_av_enabled`
- `schema/003_seed.sql` corrected (EBW tenant `db_name` → `shhdbite_eventsbywater`, `tab_ebw_enabled` default → TRUE for fresh installs)

### Platform changes applied today
In `shhdbite_atlantic_hub` (live):
- Already-done before today: `tenants.db_name` for `ebw` tenant = `shhdbite_eventsbywater` ✓
- Applied today: `UPDATE feature_flags SET enabled=1 WHERE flag_name='tab_ebw_enabled';` ✓

### Netlify env vars added today
- `DB_USER_EBW` = `shhdbite_eventsuser`
- `DB_PASS_EBW` = (set in Netlify, all scopes)
- `DB_NAME_EBW` = `shhdbite_eventsbywater`

---

## The 0-rows bug (the only thing blocking everything else)

### Symptom

| Database | Table | Rows in phpMyAdmin (as Val's cpses_ user) | Rows shown in atlantic-hub | Delta |
|---|---|---|---|---|
| shhdbite_AV | leads | 12 | 0 | -12 |
| shhdbite_eventsbywater | charter_inquiries | 3 | 0 | -3 |
| shhdbite_eventsbywater | vessel_listings | 0 | 0 | 0 |
| shhdbite_eventsbywater | captain_applications | 0 | 0 | 0 |
| shhdbite_eventsbywater | investor_registrations | 0 | 0 | 0 |
| shhdbite_hunterhoney | subscribers etc. | (rows present) | (rows visible) | ✓ matches |

### What we already ruled out
- ❌ `archived_at IS NULL` filter excluding everything — all 12 AV leads have `archived_at = NULL` (confirmed with `SELECT COUNT(archived_at) FROM leads;`)
- ❌ DB_NAME_AV typo'd to lowercase — confirmed env var is `'shhdbite_AV'` (correct casing)
- ❌ User not attached to DB — cPanel "Add User to Database" was completed for `shhdbite_av_remote` on `shhdbite_AV` (confirmed in cPanel UI screenshot)
- ❌ My commit `3c4d29b` broke things — diff shows it doesn't touch the stats route or the AV DB pool
- ❌ Migration not applied — atlantic-hub v4 IS applied to `shhdbite_AV` (clients, leads.ai_score_band, lead_notes, lead_events, etc. all exist)

### What we did NOT yet verify (most likely causes)
1. **The MySQL user `shhdbite_av_remote` may have host-based grants only on `'localhost'`, not `'%'` (any host).** When Netlify Functions try to connect remotely they'd authenticate against a different user record (or get silently denied with empty result sets in some shared-hosting configurations).
2. **HostGator's Remote MySQL allowlist** may not include Netlify Function egress IPs. Adding `%` (any IP) as an allowed remote host would unblock — less secure but typical for serverless platforms with dynamic IPs.
3. **`shhdbite_eventsuser` may have ALL PRIVILEGES but only on the 3 new tables Val created today, not the older form tables.** Possible if the user was created with table-level grants rather than database-level.
4. **Netlify Function logs may have specific MySQL errors** (Access Denied, ECONNREFUSED, etc.) that would point to the exact cause. Not yet inspected.

### Diagnostic — try BEFORE calling HostGator

In phpMyAdmin → `shhdbite_AV` → SQL tab:

```sql
SELECT TABLE_SCHEMA, TABLE_NAME, PRIVILEGE_TYPE
FROM information_schema.TABLE_PRIVILEGES
WHERE GRANTEE LIKE "'shhdbite_av_remote'%"
ORDER BY TABLE_SCHEMA, TABLE_NAME;
```

And same for `shhdbite_eventsuser` (run against the same `information_schema`):

```sql
SELECT TABLE_SCHEMA, TABLE_NAME, PRIVILEGE_TYPE
FROM information_schema.TABLE_PRIVILEGES
WHERE GRANTEE LIKE "'shhdbite_eventsuser'%"
ORDER BY TABLE_SCHEMA, TABLE_NAME;
```

If those return rows, we'll see what each user can actually read. If they return empty, the cpses_ user can't see the grants (HostGator security default) — go straight to HostGator.

Alternatively, **try the Netlify Function logs:**
```bash
cd "$HOME/Library/CloudStorage/OneDrive-atlanticandvine.com/HunterHoney/_organized/atlantic-hub"
netlify link --id 24c6252e-a7bd-4896-8541-1e0dbab80e56
netlify functions:log --name api/admin/av/stats
```

If you see `Access denied` or `Host 'xx.xx.xx.xx' is not allowed`, the cause is confirmed.

---

## HostGator support script (call when you have 15 min)

> "Hi, I have a Next.js application hosted on Netlify trying to read data from my HostGator MySQL databases. The connection appears to succeed — no errors thrown — but every SELECT returns 0 rows even though my phpMyAdmin shows data in those tables. I'd like to verify two things:
>
> 1. **Remote MySQL allowed hosts.** I need to confirm that the IPs Netlify uses for outbound Function calls are allowed to connect to my MySQL databases. Netlify uses dynamic IPs, so the safest fix is allowing `%` (any host) on Remote MySQL for these users — or you can tell me the specific IP ranges I need to add.
>
> 2. **MySQL user host grants.** For the users `shhdbite_av_remote` (on database `shhdbite_AV`) and `shhdbite_eventsuser` (on database `shhdbite_eventsbywater`), I need to confirm they have grants for `@'%'` (any host), not just `@'localhost'`. If the grants are only for `localhost`, my Netlify Functions cannot read data even though authentication appears to succeed.
>
> My cPanel account is [your account name]. The databases are `shhdbite_AV` and `shhdbite_eventsbywater`. The third one `shhdbite_hunterhoney` (user `shhdbite_hh_user`) IS working from Netlify — so whatever you set up for that one is what I need for the other two."

**If they ask "what version of MySQL?"** — phpMyAdmin top bar says it; usually MySQL 5.7 or MariaDB 10.x on HostGator shared hosting.

**If they say "we don't support Netlify"** — you're not asking them to support Netlify. You're asking them to verify remote MySQL access works for these specific users. That's a HostGator hosting concern, not a Netlify one.

**If they fix it** — re-test by opening `https://atlantic-hub.netlify.app/admin/av`. Should immediately show 12 leads (no redeploy needed; the DB connection re-reads on every request).

---

## What still needs to happen (priority order)

### 🔴 P0 — blocking everything
- [ ] **Fix the 0-rows bug** via HostGator (script above)

### 🟠 P1 — depends on P0
- [ ] **Load the 23 St. Croix prospects** — `EVENTS BY WATER 2026/CRM/load_prospects_into_atlantic_hub.sql` → paste into phpMyAdmin → `shhdbite_AV` → SQL. After this, AV tab shows 35 leads (12 audit + 23 manual).
- [ ] **Smoke-test the AV write paths** — open one of the 35 leads → Notes tab → save a note → confirm it appears + Events tab shows "Note added".
- [ ] **Smoke-test the EBW write paths** — `/admin/ebw/bookings` → click "+ Log a new booking" → submit → confirm it appears in the list.

### 🟡 P2 — operational
- [ ] **Custom domain** — point `admin.atlanticandvine.com` at Netlify (Netlify → atlantic-hub → Domain management → Add domain; then CNAME from registrar).
- [ ] **`form_handler.php` sync** — the EBW website's PHP handler is out of date. Missing handlers for `partner_accounts`, `partner_availability`, the 5 St. Croix forms, `safe_requests`. Submissions for those are reaching Val via Formspree fallback only, NOT landing in MySQL. Needs a dedicated session to add missing handlers + upload via cPanel. See `EVENTS BY WATER 2026/NEXT_SESSION_TODOS.md` for previous attempt.
- [ ] **AV `DB_PASS_AV` non-prod contexts** — currently only set in `production` context on Netlify. Set it for all contexts so deploy-previews work (match the `DB_PASS_HH` pattern).

### 🟢 P3 — design decisions for later
- [ ] **`client-portal.html`** — sits at `~/Documents/Claude/Projects/Atlantic And Vine/`. Beautiful, production-quality 1,760-line single-page dashboard. Never deployed to any URL. PHP routes (`portal_routes.php`) were written but never wired into the live `index.php` on `api.atlanticandvine.com`. Decision needed: deploy it as the client-facing AV view (clients log in and see only THEIR leads, scoped by `client_id`), OR retire in favor of atlantic-hub's UI. If deploying: wire its data fetches to atlantic-hub's API instead of the never-deployed PHP routes, so there's one source of truth.
- [ ] **Extend EBW tab to read `leads`, `partner_accounts`, `partner_availability`** — these tables exist in `shhdbite_eventsbywater` but my current code doesn't surface them. Add new API routes + sub-pages.
- [ ] **AI scoring pipeline** — the AV leads table has `ai_score`, `ai_score_band`, `ai_score_reason` columns ready. The `ai_integrations` table has 5 seed rows for Grok, ChatGPT, Buffer, LinkedIn, WordPress. Next session: wire Claude API to score new leads as they arrive.

---

## File locations (so the next Claude doesn't have to hunt)

| What | Where |
|---|---|
| atlantic-hub repo | `~/Library/CloudStorage/OneDrive-atlanticandvine.com/HunterHoney/_organized/atlantic-hub` |
| Atlantic And Vine portal (unbuilt) | `~/Documents/Claude/Projects/Atlantic And Vine` |
| EBW website (PHP) | `~/Library/CloudStorage/OneDrive-atlanticandvine.com/EVENTS BY WATER 2026/events by water website 2026` |
| EBW prospect data | `~/Library/CloudStorage/OneDrive-atlanticandvine.com/EVENTS BY WATER 2026/CRM/` |
| ↳ `prospects_master.csv` | 23 St. Croix prospects, scored hot/warm/cool, with initial intel |
| ↳ `load_prospects_into_atlantic_hub.sql` | one-shot INSERTs targeting `shhdbite_AV.leads` |
| ↳ `templates.md` | pitch scripts + email templates by industry (wedding planner, restaurant, etc.) |
| ↳ `01_diagnose_live_db.sql` | first diagnostic — confirmed atlantic-hub v4 schema is live |
| ↳ `02_find_av_portal_tables.sql` | second diagnostic — confirmed no av_* tables exist |
| Netlify dashboard | `https://app.netlify.com` → site **atlantic-hub** |
| Site ID | `24c6252e-a7bd-4896-8541-1e0dbab80e56` |
| GitHub | `https://github.com/valfulton/atlantic-hub` |
| HostGator cPanel | `https://sh00097.hostgator.com:2083` |

---

## For the next Claude session — start here

1. Read `MEMORY.md` (auto-loaded in your context if you're in Cowork) — has the high-level pointers.
2. Read this file (`HANDOFF_2026-05-16_state_of_the_union.md`) — has the operational state.
3. Read `HANDOFF_2026-05-12_av_phase1_complete.md` — has the AV Phase 1 deploy details that this work builds on.
4. **Don't re-do anything.** The schema migrations are applied. The git commit is pushed. The Netlify env vars are set. The flag is flipped. The current bottleneck is the 0-rows bug, which probably needs a human (Val) to call HostGator — not more code.

**If Val asks "where are we?"** — paste her the TL;DR at the top of this file.

🌊💙
