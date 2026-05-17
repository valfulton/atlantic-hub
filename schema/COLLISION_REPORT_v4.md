# COLLISION_REPORT_v4 — Path B-lite with content engine

**Date:** 2026-05-12 (evening, post-content-engine spec)
**Supersedes:** `COLLISION_REPORT_v3.md` (kept in tree for review trail)
**Migration target:** `schema/004_av_detail_v4.sql`

---

## What changed in v4 (vs v3)

The schema decision (Path B-lite — `shhdbite_AV` uppercase, ALTER existing `leads`, additive only, zero PHP touched) is unchanged. Two structural changes to the new portal tables:

1. **`content_recommendations` was dropped** from v3's dormant-table set. The pair `content_prompts` + `generated_assets` replaces it with a better design (one prompt → many candidate assets, with provenance on which AI tool produced each asset).
2. **Six new content-engine tables added:** `ai_integrations`, `content_prompts`, `generated_assets`, `social_channels`, `social_posts`, `social_post_approvals`. The portal's AI-content workflow is now schema-complete on day one.

The five tables that stay from v3 (`clients`, `pipeline_stages`, `lead_notes`, `lead_events`, `client_icps`) and the one dormant table that stays (`email_sends`) are unchanged.

---

## Live `leads` BEFORE migration — unchanged from v3 report

See `COLLISION_REPORT_v3.md` Section "Live `leads` schema BEFORE migration (the contract)" for the full 19-column table. Source remains `AV_livewebsite/database-schema.sql` lines 5-29. Verified against Val's phpMyAdmin screenshot (12 live rows). 18 columns + `id` PK + 4 indexes.

## Live `leads` AFTER migration — unchanged from v3 report

Same 19 existing columns preserved + 18 new columns (`client_id`, `pipeline_stage_id`, `audit_id`, `source_type`, `source_payload`, 9 AI-scoring columns, `tags`, `last_activity_at`, `consent_basis`, `archived_at`, `imported_by_user_id`) + 6 new indexes + 2 new FK constraints with ON DELETE SET NULL. Backfill: `UPDATE leads SET audit_id = UUID() WHERE audit_id IS NULL`.

---

## PHP-write-compatibility check — unchanged from v3

All 11 PHP-touched columns (`company, email, website, industry, contact_name, phone, challenge, submission_date, audit_content, audit_generated, is_approved`) preserved byte-for-byte. Audit-form INSERT and audit-content UPDATEs continue to execute identically.

The full per-column proof table is in `COLLISION_REPORT_v3.md`; nothing in v4 changes that conclusion.

---

## Updated collision matrix — v4's 13 new tables ↔ 9 existing AV tables

(v3 had 7 new tables; v4 has 13: same 5 active + 1 dormant + 6 new content-engine + 1 dormant from v3 minus the 1 dropped from v3 = 13.)

| New v4 table | Same name in shhdbite_AV? | Notes |
|---|---|---|
| `clients` | NO | Safe. |
| `pipeline_stages` | NO | Safe. |
| `lead_notes` | NO | Safe. Distinct from `leads.notes` TEXT column. |
| `lead_events` | NO | Safe. |
| `client_icps` | NO | Safe. Dormant. |
| **`ai_integrations`** | NO | **NEW IN v4.** Safe. Registry table; no inbound FKs from existing AV tables. |
| **`content_prompts`** | NO | **NEW IN v4.** Safe. FKs to clients (new), leads (existing), ai_integrations (new). |
| **`generated_assets`** | NO | **NEW IN v4.** Safe. FKs to content_prompts (new), clients (new), ai_integrations (new). |
| **`social_channels`** | NO | **NEW IN v4.** Safe. FKs to clients (new), ai_integrations (new). |
| **`social_posts`** | NO | **NEW IN v4.** Safe. FKs to clients (new), social_channels (new), generated_assets (new), leads (existing), content_prompts (new). |
| **`social_post_approvals`** | NO | **NEW IN v4.** Safe. FK to social_posts (new). |
| `email_sends` | NO direct collision (overlaps conceptually with empty `email_log`) | Dormant. v3 unchanged. |

**Confirmation: zero name collisions across all 13 new tables.** A `SHOW TABLES` against `shhdbite_AV` today returns the 9 existing tables; none of the 13 new names appear. The migration's `CREATE TABLE IF NOT EXISTS` statements will therefore all create (not skip).

---

## Row count expectations — updated for v4

| Table | Before migration | After migration |
|---|---|---|
| `leads` | 12 | 12 (audit_id backfilled, source_type='audit_form', new columns NULL) |
| `ad_partners` | 2 | 2 (untouched) |
| `lead_attributions` | 0 | 0 (untouched) |
| `blog_posts` | 0 | 0 (untouched) |
| `admin_users` (AV-side) | 0 | 0 (untouched) |
| `email_log` | 0 | 0 (untouched) |
| `revenue_tracking` | 0 | 0 (untouched) |
| `client_intakes` | 4 | 4 (untouched) |
| `client_pop_journey` | 2 | 2 (untouched) |
| `clients` (new) | — | 1 (av-internal seed) |
| `pipeline_stages` (new) | — | 6 (default kanban) |
| `lead_notes` (new) | — | 0 |
| `lead_events` (new) | — | 0 |
| `client_icps` (new) | — | 0 |
| `ai_integrations` (NEW v4) | — | **5** (grok_imagine, chatgpt_image, buffer, linkedin, blog_wp_draft) |
| `content_prompts` (NEW v4) | — | 0 |
| `generated_assets` (NEW v4) | — | 0 |
| `social_channels` (NEW v4) | — | 0 |
| `social_posts` (NEW v4) | — | 0 |
| `social_post_approvals` (NEW v4) | — | 0 |
| `email_sends` (new) | — | 0 |

**Totals:** 9 existing tables (20 rows preserved) + 12 new tables (12 rows seeded — 1 client + 6 stages + 5 ai_integrations). **21 tables, 32 rows.**

*(Correction from Val's spec brief: Val said "21 tables, 27 rows" but the corrected total is 32 because the av-internal client + 6 pipeline stages + 5 ai_integrations = 12 new rows, on top of the 20 preserved.)*

---

## Content-engine relationship diagram (text)

```
ai_integrations (registry, 5 seeded)
       │
       ├── content_prompts.intended_integration_id  (SET NULL)
       ├── generated_assets.integration_id          (NO ON DELETE — soft-delete only)
       └── social_channels.integration_id           (NO ON DELETE — soft-delete only)

clients (1 seeded: av-internal)
       │
       ├── content_prompts.client_id      (SET NULL)
       ├── generated_assets.client_id     (SET NULL)
       ├── social_channels.client_id      (CASCADE)
       ├── social_posts.client_id         (SET NULL)
       ├── leads.client_id                (SET NULL) ← v3 carry-forward
       ├── pipeline_stages.client_id      (CASCADE)  ← v3
       ├── lead_notes.client_id           (SET NULL) ← v3
       ├── lead_events.client_id          (SET NULL) ← v3
       ├── client_icps.client_id          (CASCADE)  ← v3
       └── email_sends.client_id          (CASCADE)  ← v3

leads (12 existing rows preserved)
       │
       ├── lead_notes.lead_id        (CASCADE)     ← v3, INT type to match parent
       ├── lead_events.lead_id       (CASCADE)     ← v3, INT type to match parent
       ├── content_prompts.source_lead_id  (SET NULL, INT type)  ← NEW v4
       └── social_posts.source_lead_id     (SET NULL, INT type)  ← NEW v4

content_prompts → generated_assets.prompt_id           (SET NULL)
content_prompts → social_posts.source_prompt_id        (SET NULL)
generated_assets → social_posts.asset_id               (SET NULL)
social_channels  → social_posts.channel_id             (NO ON DELETE — soft-delete only)
social_posts     → social_post_approvals.post_id       (CASCADE)
```

**ON DELETE design summary (the rule of thumb):**
- **History survives upstream deletes.** Prompts, assets, and posts all use SET NULL on their upstream links because the audit trail matters even when the originating entity is gone. A published social post must persist even if the lead, prompt, and asset that produced it are deleted.
- **Owned children cascade with their owner.** A client's `pipeline_stages`, `social_channels`, `client_icps`, and `email_sends` are *owned* by that client and have no meaning without them — they cascade. Same for `social_post_approvals` ← `social_posts` (approval has no meaning without its post).
- **Integrations are soft-delete only.** `ai_integrations` rows are never hard-deleted; use `enabled = FALSE` instead. No ON DELETE behavior is declared on the FK columns that reference `ai_integrations` (MySQL defaults to RESTRICT, which is what we want — the DELETE would fail).

---

## Independent bugs from v3 — still open, carry forward

Unchanged from v3 report. The three bugs are independent of any v4 changes:

1. **Case mismatch** in `atlantic-hub/lib/db/av.ts` (`'shhdbite_av'` default → should be `'shhdbite_AV'`), `atlantic-hub/schema/003_seed.sql` line 31 (`'shhdbite_av'` → `'shhdbite_AV'`), and likely `lib/db/ebw.ts` (`'shhdbite_ebw'` → `'shhdbite_eventsbywater'`). The revised seed at `_organized/schema/003_seed.sql` already has the corrections — port them into the in-repo file.
2. **`client-surge-submit.php` column-mismatch** — writes `name`/`business_name`/`biggest_challenge` columns that don't exist on `shhdbite_AV.leads`. Either a separate `client_surge` DB exists (not visible in the phpMyAdmin screenshot) or the form has been failing. Verification query in `COLLISION_REPORT.md` appendix #4.
3. **`admin_users` namespace overlap** — both `shhdbite_atlantic_hub.admin_users` and `shhdbite_AV.admin_users` exist. Cosmetic only; Hub auth uses the platform one.

Batch these into a follow-up cleanup PR after v4 is verified live.

---

## Constraint to flag for the next session — unchanged from v3

**`leads.email` is UNIQUE globally.** Portal CSV imports (Sales Navigator etc.) will fail with "Duplicate entry" if an email already exists as an audit-form lead. API-layer strategy is required:
- (a) Detect + surface "this email is already a lead in Val's pipeline — claim or skip?"
- (b) UPSERT — overwrite source_type and client_id on the existing row.
- (c) DROP the UNIQUE constraint to allow duplicates across source_type. **Requires a follow-up ALTER on leads. Not in v4.**

The previous v2 design assumed a per-(client_id, linkedin_url) UNIQUE which doesn't apply here. Pick (a) or (b) in the API layer.

---

## New constraint introduced by v4 — env-var secret management

Every `config_schema` JSON in the 5 seeded `ai_integrations` rows references env-var NAMES, never values. The application layer must:
- Read each integration's `config_schema.env_vars` to discover which env vars to fetch at runtime.
- Validate env vars are populated before attempting to invoke an integration. Missing env var = log + skip that integration (don't crash).
- Never log the value of any env var. Logging the *name* is fine.

Names referenced by the 5 seeded rows (the env vars Val needs to provision before any integration is invoked):
- `GROK_API_KEY` — Grok Imagine
- `OPENAI_API_KEY` — ChatGPT Image
- `BUFFER_ACCESS_TOKEN` — Buffer
- `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`, `LINKEDIN_ACCESS_TOKEN`, `LINKEDIN_REFRESH_TOKEN` — LinkedIn direct API
- `WORDPRESS_APP_PASSWORD` — Blog drafts

For v1 demo purposes, none of these need to be set immediately — the integrations are *registered* but won't be invoked until the next session wires the executors. The portal can render the integration list (read-only) without any env var populated.
