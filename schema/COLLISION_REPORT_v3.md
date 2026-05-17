# COLLISION_REPORT_v3 — Path B-lite analysis

**Date:** 2026-05-12 (evening, after Path C rejection)
**Supersedes:** `COLLISION_REPORT.md` (kept in tree for review trail)
**Migration target:** `schema/004_av_detail_v3.sql`

---

## Why Path C was wrong

The afternoon's `COLLISION_REPORT.md` and `MIGRATION_STRATEGY.md` recommended Path C (new database `shhdbite_av_portal`). That recommendation prioritized *isolation* — zero risk of touching the live `shhdbite_AV` data. It was technically correct and strategically wrong.

What I missed: the portal is a **client-demo asset**. Val intends to log into the portal in front of prospects and say *"look what I'm already doing for my own business — your portal will look like this with your leads."* An empty database at demo time defeats that. The 12 audit-form leads currently in `shhdbite_AV.leads` are the demo dataset. Path C would have given the portal a sterile, empty CRM at launch and forced Val to either fake data or wait months for real portal usage to accumulate.

Path C was also wrong on a quieter axis: it would have created two parallel CRMs in two DBs that both *try to be* the single source of truth for AV leads. That ambiguity is worse than the namespace overload it tried to solve. Eventually one would win and the other would atrophy, and the migration cost would land on Val months later when the integration point mattered.

## Why Path B-lite is right

- **One database, one source of truth.** `shhdbite_AV` stays. The existing `leads` table is the single canonical lead store. The portal reads + writes that same table, picking up the 12 live rows for free.
- **Zero PHP changes.** The audit-form INSERT in `api/index.php`, the intake INSERT in `process-intake.php`, and the pop-journey UPSERTs continue running byte-identical against the same DB. Live forms on `atlanticandvine.com` are not touched.
- **Additive only.** The migration ADDs columns and ADDs tables. Nothing renames, nothing drops, nothing changes type on an existing column. The blast radius is bounded to "things that didn't exist before."
- **Demo on day one.** When the portal goes live, Val opens it and sees 12 leads already in the New / Contacted columns (mapped from the existing `lead_status` ENUM), each with their company / contact_name / industry / challenge / audit_content visible.

---

## Live `leads` schema BEFORE migration (the contract)

Source: `AV_livewebsite/database-schema.sql` lines 5-29. Verified to match Val's phpMyAdmin screenshot (12 live rows). 18 columns + 1 PK + 4 indexes.

| # | Column | Type | Nullable | Default | Notes |
|--|--|--|--|--|--|
| 1 | `id` | INT AUTO_INCREMENT | NOT NULL | — | PRIMARY KEY |
| 2 | `company` | VARCHAR(255) | NOT NULL | — | Written by audit form |
| 3 | `website` | VARCHAR(500) | NULL | — | Written by audit form |
| 4 | `industry` | VARCHAR(100) | NULL | — | Written by audit form |
| 5 | `contact_name` | VARCHAR(255) | NULL | — | Written by audit form |
| 6 | `email` | VARCHAR(255) | NOT NULL | — | **UNIQUE** — one row per email globally |
| 7 | `phone` | VARCHAR(20) | NULL | — | Written by audit form |
| 8 | `challenge` | TEXT | NULL | — | Written by audit form (the free-text "what's holding you back") |
| 9 | `audit_content` | LONGTEXT | NULL | — | Written async by `generateAuditForLead()` (Claude's strategic audit text) |
| 10 | `audit_generated` | DATETIME | NULL | — | Written async, timestamp of audit completion |
| 11 | `is_approved` | TINYINT | NULL | 0 | Written async (set to 1 after audit emails out) |
| 12 | `approval_date` | DATETIME | NULL | — | Operator-only (set in phpMyAdmin) |
| 13 | `approved_by` | VARCHAR(255) | NULL | — | Operator-only |
| 14 | `submission_date` | DATETIME | NULL | CURRENT_TIMESTAMP | Written by audit form (explicit `NOW()`) |
| 15 | `lead_status` | ENUM('new','contacted','qualified','converted','lost') | NULL | 'new' | Operator-only — manually advanced in phpMyAdmin today; will be portal-managed going forward |
| 16 | `follow_up_date` | DATETIME | NULL | — | Operator-only |
| 17 | `notes` | TEXT | NULL | — | Operator-only (free-text). Distinct from the new `lead_notes` table. |
| 18 | `created_at` | TIMESTAMP | NULL | CURRENT_TIMESTAMP | Auto |
| 19 | `updated_at` | TIMESTAMP | NULL | CURRENT_TIMESTAMP ON UPDATE | Auto |

**Indexes (4):** `PRIMARY KEY (id)`, `UNIQUE (email)`, `idx_email`, `idx_industry`, `idx_submission_date`, `idx_status (lead_status)`.

**Columns written by live PHP (these MUST remain unchanged in name, type, and writability):**

| Endpoint | Statement type | Columns written |
|---|---|---|
| `api/index.php :: handleAuditSubmission()` line 187 | INSERT | `company, email, website, industry, contact_name, phone, challenge, submission_date` |
| `api/index.php :: generateAuditForLead()` line 245 | UPDATE | `audit_content, audit_generated` |
| `api/index.php :: generateAuditForLead()` line 256 | UPDATE | `is_approved` |

**Total: 10 distinct columns. All 10 must survive this migration with identical names, types, nullability, and defaults.**

---

## Live `leads` schema AFTER migration

The same 19 columns (PK + 18) preserved unchanged, PLUS 18 new columns and 6 new indexes. 37 columns total.

| New columns added (18) | Type | Purpose |
|---|---|---|
| `client_id` | BIGINT UNSIGNED NULL | FK → clients.client_id; NULL = audit-form lead (Val's own pipeline) |
| `pipeline_stage_id` | BIGINT UNSIGNED NULL | FK → pipeline_stages.pipeline_stage_id |
| `audit_id` | CHAR(36) NULL | Public-facing UUID for portal URLs; backfilled for 12 existing rows |
| `source_type` | ENUM('audit_form','csv','scrape','manual','api') NOT NULL DEFAULT 'audit_form' | Existing 12 rows default to 'audit_form' (correct) |
| `source_payload` | JSON NULL | Raw inbound row for forensic audit |
| `ai_score` | TINYINT UNSIGNED NULL | 0-100 portal AI score |
| `ai_score_band` | ENUM('hot','warm','cool') NULL | |
| `ai_score_reason` | TEXT NULL | |
| `ai_score_breakdown` | JSON NULL | |
| `ai_audit` | JSON NULL | Portal-side AI audit. Distinct from legacy `audit_content` (which is the marketing-site strategic audit). |
| `ai_email_subject` | VARCHAR(255) NULL | |
| `ai_email_body` | TEXT NULL | |
| `ai_last_scored_at` | DATETIME NULL | |
| `ai_model_version` | VARCHAR(60) NULL | |
| `tags` | JSON NULL | Operator-supplied tags |
| `last_activity_at` | DATETIME NULL | |
| `consent_basis` | VARCHAR(60) NULL | |
| `archived_at` | DATETIME NULL | Soft-delete flag |
| `imported_by_user_id` | BIGINT UNSIGNED NULL | platform admin_users.user_id (cross-DB, app-enforced) |

| New indexes added (6) | Columns |
|---|---|
| `uq_audit_id` (UNIQUE) | `audit_id` |
| `idx_client_stage` | `(client_id, pipeline_stage_id)` |
| `idx_client_score` | `(client_id, ai_score)` |
| `idx_client_activity` | `(client_id, last_activity_at)` |
| `idx_client_archived` | `(client_id, archived_at)` |
| `idx_source_type` | `(source_type)` |

| New FK constraints added (2) | References | On delete |
|---|---|---|
| `fk_leads_client` | `clients(client_id)` | SET NULL |
| `fk_leads_stage` | `pipeline_stages(pipeline_stage_id)` | SET NULL |

**Backfill statement applied:** `UPDATE leads SET audit_id = UUID() WHERE audit_id IS NULL;` — populates the 12 existing rows with deterministic UUIDs.

---

## 100% PHP-write-compatibility check

Every column the live PHP writes is preserved. Confirmed below:

| PHP-written column | Pre-migration type | Post-migration type | Renamed? | Type changed? | Status |
|---|---|---|---|---|---|
| `company` | VARCHAR(255) NOT NULL | VARCHAR(255) NOT NULL | NO | NO | ✓ |
| `email` | VARCHAR(255) NOT NULL UNIQUE | VARCHAR(255) NOT NULL UNIQUE | NO | NO | ✓ |
| `website` | VARCHAR(500) | VARCHAR(500) | NO | NO | ✓ |
| `industry` | VARCHAR(100) | VARCHAR(100) | NO | NO | ✓ |
| `contact_name` | VARCHAR(255) | VARCHAR(255) | NO | NO | ✓ |
| `phone` | VARCHAR(20) | VARCHAR(20) | NO | NO | ✓ |
| `challenge` | TEXT | TEXT | NO | NO | ✓ |
| `submission_date` | DATETIME DEFAULT CURRENT_TIMESTAMP | DATETIME DEFAULT CURRENT_TIMESTAMP | NO | NO | ✓ |
| `audit_content` | LONGTEXT | LONGTEXT | NO | NO | ✓ |
| `audit_generated` | DATETIME | DATETIME | NO | NO | ✓ |
| `is_approved` | TINYINT DEFAULT 0 | TINYINT DEFAULT 0 | NO | NO | ✓ |

All 11 PHP-write/read columns preserved byte-for-byte. The audit-form INSERT, the audit-content UPDATE, and the is_approved UPDATE will all continue to execute identically.

---

## Collision matrix — new portal tables ↔ existing AV tables

| New table | Same name in shhdbite_AV? | Notes |
|---|---|---|
| `clients` | NO | Safe. Distinct from the legacy `clients` mentioned in `client-surge-schema.sql` (which lives in a separate `client_surge` DB, if it exists). |
| `pipeline_stages` | NO | Safe. |
| `lead_notes` | NO | Safe. Distinct from `leads.notes` column (single TEXT field, operator-only). |
| `lead_events` | NO | Safe. |
| `client_icps` | NO | Safe. |
| `content_recommendations` | NO | Safe. |
| `email_sends` | NO | Conceptually overlaps with the existing empty `email_log` table. Both can coexist; future decision: deprecate `email_log` (currently 0 rows, no PHP writes to it). |

No name collisions. The migration adds 7 new tables without touching any of the 9 existing tables (except `leads`, which gains additive columns).

---

## Row count expectations

| Table | Before | After (immediately post-migration) |
|---|---|---|
| `leads` | 12 | 12 (audit_id populated, source_type='audit_form', all other new columns NULL) |
| `ad_partners` | 2 | 2 (untouched) |
| `lead_attributions` | 0 | 0 (untouched) |
| `blog_posts` | 0 | 0 (untouched) |
| `admin_users` (AV-side) | 0 | 0 (untouched) |
| `email_log` | 0 | 0 (untouched) |
| `revenue_tracking` | 0 | 0 (untouched) |
| `client_intakes` | 4 | 4 (untouched) |
| `client_pop_journey` | 2 | 2 (untouched) |
| `clients` (new) | — | 1 (av-internal seed) |
| `pipeline_stages` (new) | — | 6 (default kanban stages for av-internal) |
| `lead_notes` (new) | — | 0 |
| `lead_events` (new) | — | 0 |
| `client_icps` (new) | — | 0 |
| `content_recommendations` (new) | — | 0 |
| `email_sends` (new) | — | 0 |

**Totals:** 9 existing tables (20 rows preserved) + 7 new tables (7 rows seeded). 16 tables, 27 rows.

---

## What the existing 12 leads will look like in the portal

After the migration, each of the 12 audit-form leads has:
- `client_id = NULL` — meaning "Val's own audit-form pipeline" (not assigned to any portal client)
- `pipeline_stage_id = NULL` — but `lead_status` still holds the legacy ENUM value ('new'/'contacted'/etc.)
- `audit_id` populated with a fresh UUID
- `source_type = 'audit_form'`
- All AI scoring columns NULL — Val can run a scoring pass from the portal UI to populate them
- All other new columns NULL — populated as Val uses the portal

**Portal UI implication (out of scope this session):** the next session's API routes need to handle the `client_id IS NULL` case for display. Options:
1. Treat `client_id IS NULL` as Val's "personal pipeline" view and show those leads under a virtual "AV (audit form)" client. Recommended — preserves the legacy lead_status without forcing a migration.
2. Auto-assign all `client_id IS NULL` leads to the `av-internal` client on first portal load. Simpler but destructive.
3. Require a "claim leads" UI action where Val explicitly assigns audit-form leads to clients (or to herself). Slowest UX but the most explicit. Val's direction in the v3 brief points to this option.

---

## Constraint to flag for the next session

**`leads.email` is UNIQUE globally.** Portal CSV imports (from Sales Navigator, etc.) will fail with "Duplicate entry" if the same email already exists as an audit-form lead. The API layer needs a strategy:

- (a) Detect the conflict and surface "this email is already a lead in Val's audit-form pipeline — claim it or skip?"
- (b) UPSERT — overwrite the source_type and client_id of the existing row.
- (c) Drop the UNIQUE constraint and allow duplicate emails across `source_type`. **This would require an ALTER on `leads` and is out of scope for v3.**

The previous v2 design used `UNIQUE (client_id, linkedin_url)` for dedup, which doesn't help here because (i) linkedin_url isn't in the existing schema and (ii) Val didn't ask v3 to add it. The next session should pick one of (a)/(b) for the API layer.

---

## Independent bugs from v2 — still open, carrying forward

These were discovered in the v2 collision report and remain unfixed (out of v3 scope):

1. **Case mismatch:** `atlantic-hub/lib/db/av.ts` defaults `DB_NAME_AV` to `'shhdbite_av'` (lowercase) and `atlantic-hub/schema/003_seed.sql` line 31 also uses lowercase. Live DB is `shhdbite_AV`. Similar issue likely in `lib/db/ebw.ts` (default `'shhdbite_ebw'` vs live `'shhdbite_eventsbywater'`). The revised seed at `_organized/schema/003_seed.sql` already corrects this for AV and EBW, but the in-repo seed file was never synced. Three-place patch.
2. **`client-surge-submit.php` may be silently failing:** writes columns matching a separate `client_surge` DB schema rather than `shhdbite_AV.leads`. Either the `client_surge` DB exists separately on HostGator (not shown in the screenshot sidebar) or the form has been broken. Verification query in this file's earlier `COLLISION_REPORT.md` appendix #4.
3. **`admin_users` namespace overlap:** both `shhdbite_atlantic_hub.admin_users` and `shhdbite_AV.admin_users` exist with different schemas. Cosmetic, not breaking. Atlantic Hub auth uses the platform one; AV-side is dormant.

These should be batched into a follow-up cleanup migration after v3 is live and demonstrably stable.
