# Handoff — AV portal schema for Atlantic Hub (Session 2, post-pushback)

**Date:** 2026-05-12
**Owner:** Val Fulton
**Scope this session:** SCHEMA + DISCOVERY ONLY. No TypeScript, no React, no API routes. No commits. No migrations applied. No PHP files in `AV_livewebsite/` modified.

**What changed since the morning's handoff:** Opus 4.7 reviewed the schema and caught the category of error: I designed the migration without reading the live system. `shhdbite_AV` is NOT empty — it has 9 tables, 20 rows of live production data, and a `leads` table with 12 rows that would have hard-collided with the portal's planned `leads` table. The morning's `004_av_detail.sql` is now superseded by `004_av_detail_v2.sql` (Path C). Discovery, collision analysis, and a three-path strategy doc are produced.

---

## Files written this session

All paths absolute. **Nothing committed.** All artifacts live in `atlantic-hub/schema/`.

### Morning (pre-pushback, now superseded but kept for review trail)
1. `atlantic-hub/schema/004_av_detail.sql` — **DEPRECATED.** Targets `shhdbite_av` (wrong case) and would silently no-op on `leads` collision. Do not apply. Archive after Val approves v2.
2. `atlantic-hub/schema/ALIGNMENT_NOTES.md` — still accurate for the rename/typing decisions. The Path C decision in v2 supersedes the "target DB = shhdbite_av" line in the header.

### Afternoon (post-pushback, the actual deliverables)
3. **`atlantic-hub/schema/COLLISION_REPORT.md`** — Deliverables 1 + 2 from the pushback. Full state-of-`shhdbite_AV` report (all 9 tables with column lists, FKs, live writers/readers, active-vs-legacy status). Collision matrix for all 8 portal tables vs all 9 existing tables. Verification queries for Val to run in phpMyAdmin to confirm the report matches the live DB.
4. **`atlantic-hub/schema/MIGRATION_STRATEGY.md`** — Deliverables 3 + 4. Three named paths (A namespace, B migrate, C new DB), each with required SQL changes, atlantic-hub changes, AV_livewebsite changes, migration sequence, rollback plan, smoke tests, and cost/benefit. Honest recommendation at the bottom.
5. **`atlantic-hub/schema/004_av_detail_v2.sql`** — Path C migration. Targets `shhdbite_av_portal` (new DB, must be created in cPanel first). Same 8 tables, same column contract as v1, but in a separate DB so the legacy `shhdbite_AV` cannot be touched. Includes 6 smoke tests at the bottom (the 6th confirms the legacy DB row counts are unchanged after migration).
6. **This file (`HANDOFF_2026-05-12_av_schema.md`)** — rewritten to reflect the new state.

---

## Decision required from Val before next session

**Which of the three paths do you want?**

- **Path A — Namespace** (`portal_clients`, `portal_leads`, …): keep one DB (`shhdbite_AV`), prefix the new tables. Lowest engineering cost.
- **Path B — Migrate** the 12 live audit-form leads + 4 intakes + 2 pop-journey rows into the new schema, rewrite the AV_livewebsite PHP to write to the new schema, drop legacy. Highest cost, cleanest end state.
- **Path C — New DB** (`shhdbite_av_portal`): the portal lives in its own DB, the legacy AV marketing site keeps writing to `shhdbite_AV`. Strongest isolation. **My recommendation.**

If you pick C, `004_av_detail_v2.sql` is ready to apply (after the cPanel pre-step). If you pick A, I'll regenerate `004_av_detail_v2.sql` with `portal_` prefixes (~10 minute mechanical edit). If you pick B, that's a bigger session to scope — column mappings + PHP rewrite + sequenced cutover.

Read `MIGRATION_STRATEGY.md` for the trade-offs. Read `COLLISION_REPORT.md` for the evidence behind the recommendation.

---

## Pre-build gate (the corrected one — used for v2)

Question 11 was the gap in the morning. The full 11 now:

1. What data does this read?
2. What data does this write?
3. Who can invoke this?
4. What auth check guards the entry point?
5. What's the rate limit?
6. Where do API keys live?
7. What's logged on error?
8. What's the kill switch? — `clients.enabled = 0`, app-enforced.
9. What test proves it rejects malicious input? — N/A at schema layer.
10. What compliance regime applies? — GDPR via `clients.retention_days` + ON DELETE CASCADE.
11. **What live data exists at the read/write target right now, and what live endpoints depend on it?** — See `COLLISION_REPORT.md`. 9 tables, 20 rows, 4 PHP endpoints in `AV_livewebsite/` write to `shhdbite_AV` today. Path C avoids them entirely.

**Suggested action for Val (out of scope this session):** add this 11th question to `_organized/CLAUDE_RULES_PREAMBLE.md`. One-line patch. This question would have caught my morning error and will protect future HH/EBW migrations from the same category of mistake (both `shhdbite_hunterhoney` and `shhdbite_eventsbywater` have live tables today — visible in your phpMyAdmin sidebar).

---

## Critical bugs found during discovery (separate from path decision)

These are independent of A/B/C and need fixing regardless:

### Bug 1 — Case mismatch on AV DB name (in two places)
- **`atlantic-hub/lib/db/av.ts` line 16:** `process.env.DB_NAME_AV || 'shhdbite_av'` — should be `'shhdbite_AV'` to match HostGator.
- **`atlantic-hub/schema/003_seed.sql` line 31:** `('av', 'Atlantic & Vine', 'shhdbite_av', ...)` — should be `'shhdbite_AV'`.
- The revised `_organized/schema/003_seed.sql` (dated May 11) already corrected both AV and EBW DB names, but that revision was never copied into the in-repo `atlantic-hub/schema/003_seed.sql`. The two files have diverged.
- **Fix later (not this session):** copy the revised tenant INSERT + UPDATE into the in-repo file. Also patch `lib/db/av.ts`. Same casing issue likely affects `lib/db/ebw.ts` (defaults to `'shhdbite_ebw'` but the live DB is `'shhdbite_eventsbywater'`).

### Bug 2 — `client-surge-submit.php` may be silently failing
- The PHP endpoint writes columns `(name, business_name, biggest_challenge, source, submitted_at)` that match the standalone `client_surge` DB schema, not the `shhdbite_AV.leads` schema (which has `company, contact_name, challenge`).
- Either: (a) the `client_surge` DB exists separately on HostGator (not visible in Val's phpMyAdmin screenshot but might exist), or (b) every submission from the Client Surge form is producing a MySQL error and the user sees a generic "Lead submitted successfully" toast because `try/catch` returns success unconditionally in the JS-facing path. **Worth Val checking the form's actual delivery before next investor demo.**
- Verification query in `COLLISION_REPORT.md` appendix #4 will confirm whether `client_surge` DB exists.

### Bug 3 — `admin_users` namespace overlap (cosmetic, not breaking)
- Both `shhdbite_atlantic_hub.admin_users` and `shhdbite_AV.admin_users` exist with different schemas. Atlantic Hub auth uses the platform DB's table; the AV-side one is dormant (0 rows). No action needed but worth knowing the two exist.

---

## Files NOT written / NOT touched this session

- No edits to `app/`, `components/`, `lib/`, `middleware.ts` in `atlantic-hub/`. Read-only on those.
- No edits to any file in `AV_livewebsite/` — PHP, JS, HTML, or SQL.
- No edits to `_organized/CLAUDE_RULES_PREAMBLE.md`. The 11th-question patch is a one-liner Val should do separately.
- No edits to `atlantic-hub/schema/003_seed.sql` (still has the lowercase bug; flagged above).
- No `.env*` files were read.
- No migrations applied to any live database.
- No git commits.
- No phpMyAdmin / Netlify env var changes (per Val's instruction "Don't touch phpMyAdmin, the feature flag, or the Netlify env vars until Cowork comes back with the 4 deliverables").

---

## Verification performed this session

- Read in full: `AV_livewebsite/database-schema.sql`, `client-intake-schema.sql`, `client-surge-schema.sql`, `sql/client_pop_journey.sql`, `sql/SECURITY-fix-default-admin.sql`.
- Read in full: `AV_livewebsite/api/index.php`, `api/process-intake.php`, `api/client-surge-submit.php`, `api/pop-journey-backend.php`.
- Read in full: `AV_livewebsite/js/setup-stripe-products.php` (confirmed no DB writes), `js/api-config.js`, `deploy.sh`.
- Verified the three duplicate SQL files in `AV_livewebsite/` and `AV_livewebsite/sql/` are byte-identical via `diff -q`.
- Read in full: `_organized/CLAUDE_RULES_PREAMBLE.md` (to understand the existing pre-build gate).
- Read in full: `_organized/schema/003_seed.sql` (revised — uses `shhdbite_AV` correctly; the in-repo one doesn't).
- Confirmed via `sqlfluff parse --dialect mysql 004_av_detail_v2.sql` that the v2 SQL parses without errors.
- Grep'd `AV_livewebsite/` for all PHP files with DB activity — confirmed only the 4 known endpoints touch MySQL.
- Cross-checked Val's phpMyAdmin screenshot (9 tables, 20 rows) against the schemas in the SQL files — they match.

## What's UNCERTAIN (Val needs to verify)

- Does the standalone `client_surge` DB exist on HostGator? Verification query in `COLLISION_REPORT.md` appendix.
- Is the live `shhdbite_atlantic_hub.tenants` row for `'av'` currently `'shhdbite_AV'` (corrected) or `'shhdbite_av'` (uncorrected)? Verification query in `COLLISION_REPORT.md` appendix.
- Is HostGator's MySQL DB-count limit being approached (relevant if Path C is chosen and we need to create a fifth DB)? Check cPanel → MySQL Databases page.

## What the NEXT session needs to do

1. Read Val's path decision (A / B / C).
2. If C confirmed: this session's `004_av_detail_v2.sql` is the contract. Val applies after creating `shhdbite_av_portal` in cPanel. Next Claude session can start wiring API routes against `getAvDb()` once it's pointed at the new DB.
3. If A: regenerate `004_av_detail_v2.sql` with `portal_` prefixes (~10 minute mechanical edit). Then same as C downstream.
4. If B: scope a separate session for the column-mapping work, the PHP rewrite, and the sequenced cutover. This is multi-hour work.
5. Independent of path: fix the case-sensitivity bug in `lib/db/av.ts` + `atlantic-hub/schema/003_seed.sql`. Fix `lib/db/ebw.ts` for the same reason. ~15 minute patch.
6. Independent of path: patch `CLAUDE_RULES_PREAMBLE.md` to add the 11th gate question.
