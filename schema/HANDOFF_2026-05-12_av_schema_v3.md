# Handoff — AV portal schema for Atlantic Hub (Session 2, v3 final)

**Date:** 2026-05-12 (evening)
**Owner:** Val Fulton
**Status:** Schema migration ready to apply. Awaiting Val's backup + smoke-test run.
**Path:** B-lite — one DB (`shhdbite_AV`), additive ALTER on the existing `leads` table, 7 new portal tables, zero PHP changes.

---

## What changed this evening

The morning's v1 (path: lowercase `shhdbite_av`, unsafe) and the afternoon's v2 (path: new isolated `shhdbite_av_portal` DB) were both wrong for the actual product goal. Path B-lite — additive changes to the live `shhdbite_AV.leads` table so the existing 12 audit-form leads become demo data in the portal — is the design Val needs.

v3 is the migration that delivers Path B-lite. Three new files; v1 and v2 remain in the tree for review trail and will be archived after v3 is verified live.

---

## Files written this round (uncommitted)

All paths absolute. Nothing committed. Nothing applied to any DB.

1. **`atlantic-hub/schema/004_av_detail_v3.sql`** — the migration. Targets `shhdbite_AV` (uppercase, correct). ADDs 18 columns + 6 indexes to `leads`. CREATEs 7 new portal tables. ADDs 2 FK constraints from `leads` to `clients` and `pipeline_stages` with ON DELETE SET NULL. Seeds 1 client + 6 pipeline stages. 10 smoke tests in the footer.

2. **`atlantic-hub/schema/COLLISION_REPORT_v3.md`** — why Path C was wrong, why Path B-lite is right. Live `leads` column list before + after. 100% PHP-write-compatibility check (every column the live PHP touches preserved byte-for-byte). Row count expectations. Constraint flags for the next session (the `email UNIQUE` constraint and how portal CSV imports must handle it).

3. **`atlantic-hub/schema/HANDOFF_2026-05-12_av_schema_v3.md`** — this file.

## Files still in tree (kept for review trail, supersedable after v3 verified)

- `atlantic-hub/schema/004_av_detail.sql` (v1, morning) — case-mismatch bug + would silently no-op on `leads` collision. DEPRECATED. Archive to `schema/_archive/` after v3 live.
- `atlantic-hub/schema/004_av_detail_v2.sql` (afternoon, Path C) — targets non-existent `shhdbite_av_portal`. DEPRECATED. Archive to `schema/_archive/` after v3 live.
- `atlantic-hub/schema/ALIGNMENT_NOTES.md` — still accurate for the rename/typing decisions. The Path C decision in v2's header is superseded but the rest stands.
- `atlantic-hub/schema/COLLISION_REPORT.md` (afternoon) — superseded by COLLISION_REPORT_v3.md but valuable as discovery record.
- `atlantic-hub/schema/MIGRATION_STRATEGY.md` (afternoon) — the three-path analysis. Path C recommendation is wrong; the analysis itself is fine.
- `atlantic-hub/schema/HANDOFF_2026-05-12_av_schema.md` (afternoon) — superseded.

I have NOT moved or deleted any of the above. Val can review and archive them on a single sweep after v3 is verified.

---

## What Val needs to do (in order)

### Step 1 — Back up `shhdbite_AV`
- phpMyAdmin → select `shhdbite_AV` → **Export** → Quick → SQL → Go.
- Save the file as `shhdbite_AV_backup_2026-05-12_pre-v3.sql` (or similar).
- Open it in a text editor. Search for `CREATE TABLE leads`. Confirm the column list matches Section A of `004_av_detail_v3.sql`. Search for `INSERT INTO leads` — count the INSERT lines. Expect ~12 (or however many are live now).
- Backup verified.

### Step 2 — Pre-flight checks (1 minute, in phpMyAdmin SQL tab)
Run these to confirm the migration assumptions:
```sql
USE shhdbite_AV;
SHOW CREATE TABLE leads;
-- Confirm schema matches Section A of the migration file.

SELECT COUNT(*) AS pre_migration_leads FROM leads;
-- Note this number. The post-migration count must match exactly.

SHOW TABLES LIKE 'clients';
-- Expect 0 rows. If 1 row, the migration will conflict.

SHOW TABLES LIKE 'pipeline_stages';
-- Expect 0 rows.

SHOW TABLES LIKE 'lead_notes';
-- Expect 0 rows.
```

### Step 3 — Apply the migration
- phpMyAdmin → `shhdbite_AV` → SQL tab → paste the entire contents of `004_av_detail_v3.sql` → Go.
- Watch for errors. The migration runs ~6 statements (1 ALTER, 1 UPDATE, 7 CREATEs, 1 ALTER for FKs, 2 seed INSERTs). Should complete in under 5 seconds.
- If ANY statement fails: STOP. Do not run the smoke tests. Restore from the backup. Reach out before retrying.

### Step 4 — Run the 10 smoke tests
- Each test is at the bottom of the migration file as commented SQL. Uncomment one block at a time, run, verify expected output, move on.
- Tests 1-6 confirm structure + data preservation.
- Test 7 confirms backwards compatibility with the live PHP (writes a fresh row using the exact INSERT statement the audit form runs).
- Test 8 verifies the cascade behavior (notes + events vanish when their parent lead is deleted).
- Tests 9-10 verify kill switch + final PHP-write-compatibility audit.
- If any test fails: document which one + the actual output. Restore from backup if data integrity is at risk.

### Step 5 — Mark the path complete
Once all 10 smoke tests pass:
- `shhdbite_AV` is portal-ready. The portal API routes in the next session can read from `leads` directly.
- Two follow-up tasks (independent of this migration):
  1. Fix the case-sensitivity bug in `lib/db/av.ts` (default `'shhdbite_av'` → `'shhdbite_AV'`). Same for `lib/db/ebw.ts` and `atlantic-hub/schema/003_seed.sql`. The revised seed at `_organized/schema/003_seed.sql` already has the correct values — port that fix into the in-repo file.
  2. Verify whether the standalone `client_surge` DB exists on HostGator (see `COLLISION_REPORT_v3.md` "Independent bugs" section). If not, `client-surge-submit.php` has been broken since deployment and needs either a column-mapping fix or a DB redirect.
- After both follow-ups land, flip the `tab_av_enabled` feature flag in `shhdbite_atlantic_hub.feature_flags`.
- After the flag flip, provision the Netlify env vars (`DB_NAME_AV=shhdbite_AV`, `DB_USER_AV=…`, `DB_PASS_AV=…`).
- Next Claude Code session can then start wiring `app/api/admin/av/*` routes against the new schema.

---

## What's locked in for the next session as contract

Column names and types the next session's TypeScript / React must use. Source of truth: `004_av_detail_v3.sql` Sections B-D.

**On `leads` (existing + new combined):**
- Existing PHP-managed: `id`, `company`, `email`, `website`, `industry`, `contact_name`, `phone`, `challenge`, `submission_date`, `audit_content`, `audit_generated`, `is_approved`
- Existing operator-managed: `approval_date`, `approved_by`, `lead_status`, `follow_up_date`, `notes`, `created_at`, `updated_at`
- Portal-managed (new): `client_id`, `pipeline_stage_id`, `audit_id`, `source_type`, `source_payload`, all 9 AI scoring columns (`ai_score`, `ai_score_band`, `ai_score_reason`, `ai_score_breakdown`, `ai_audit`, `ai_email_subject`, `ai_email_body`, `ai_last_scored_at`, `ai_model_version`), `tags`, `last_activity_at`, `consent_basis`, `archived_at`, `imported_by_user_id`

**`leads.id` is `INT AUTO_INCREMENT`** (not BIGINT UNSIGNED). The portal API must use INT in TypeScript types for lead IDs, or coerce carefully. `lead_notes.lead_id` and `lead_events.lead_id` are also INT to match.

**`clients`:** `client_id` BIGINT UNSIGNED PK, `client_uuid`, `client_name`, `client_slug`, `industry`, `enabled` (kill switch), `retention_days`, `plan_tier`, `created_at`, `updated_at`, `archived_at`.

**`pipeline_stages`:** `pipeline_stage_id` BIGINT UNSIGNED PK, `client_id`, `stage_key`, `stage_name`, `stage_order`, `is_terminal`, `created_at`, `archived_at`.

**`lead_notes`:** `lead_note_id` BIGINT UNSIGNED PK, `client_id` (nullable for audit-form leads), `lead_id` INT NOT NULL, `author_user_id`, `author_role` ENUM, `body`, `is_internal`, `created_at`.

**`lead_events`:** `lead_event_id` BIGINT UNSIGNED PK, `client_id` (nullable), `lead_id` INT NOT NULL, `event_type` ENUM (13 values), `event_payload` JSON, `actor_user_id`, `actor_role`, `occurred_at` DATETIME(3).

**Dormant tables** (`client_icps`, `content_recommendations`, `email_sends`): see SQL for column lists. Not used in v1.

**ON DELETE behaviors:**
- `leads.client_id` → SET NULL (deleting a client unassigns their leads, doesn't delete them)
- `leads.pipeline_stage_id` → SET NULL
- `lead_notes.lead_id`, `lead_events.lead_id` → CASCADE (deleting a lead deletes its notes + events)
- `lead_notes.client_id`, `lead_events.client_id` → SET NULL
- `pipeline_stages.client_id`, `client_icps.client_id`, `content_recommendations.client_id`, `email_sends.client_id` → CASCADE

---

## Carried-forward TODOs (independent of v3)

1. **Case-sensitivity bug** in three files. One-line patch each. Out of v3 scope; should be the next cleanup PR.
2. **`client-surge-submit.php` schema mismatch** — verify whether `client_surge` DB exists on HostGator before assuming the form works.
3. **Eleventh pre-build-gate question** for `_organized/CLAUDE_RULES_PREAMBLE.md`: *"What live data exists at the read/write target right now, and what live endpoints depend on it?"* — this is the gate that would have caught my morning error and will protect future HH/EBW migrations (both have live tables today).
4. **Archive v1 and v2** from `atlantic-hub/schema/` to `atlantic-hub/schema/_archive/` once Val has verified v3 lands cleanly. Keep them — review trail is valuable.

---

## Pre-build gate (final answers — the 11-question version)

1. **Data read at runtime:** none (DDL); downstream API routes will read from `leads` + the 7 new tables.
2. **Data written at runtime:** none by this file; migration-time: 18 columns added, 6 indexes added, 7 tables created, 2 FK constraints added, 12 leads' `audit_id` backfilled, 1 client + 6 pipeline stages seeded.
3. **Who can invoke:** Val only, via phpMyAdmin against `shhdbite_AV`, after a verified backup. No automated path.
4. **Auth check:** N/A at schema layer; app layer uses existing `middleware.ts` + `lib/api-guard.ts`.
5. **Rate limit:** N/A.
6. **API keys:** N/A.
7. **Logged on error:** N/A (standard MySQL errors). Migration failures must be diagnosed by the operator from the phpMyAdmin output.
8. **Kill switch:** `clients.enabled = 0`. Application-layer enforcement.
9. **Malicious input test:** N/A at schema layer.
10. **Compliance:** GDPR — `clients.retention_days` documents per-client retention; `lead_notes` and `lead_events` cascade-delete when their parent lead is deleted; deleting a client SET-NULLs their lead assignments (leads themselves survive).
11. **Live data at target:** 9 tables, 20 rows, 4 PHP endpoints writing today. The migration is additive on `leads` and creates 7 new tables; no existing column is renamed, dropped, or retyped. The audit form, intake form, and pop-journey endpoints continue working unchanged. Backwards-compat verified by smoke test #7 (live PHP INSERT replayed verbatim against the migrated schema) and smoke test #10 (information_schema audit of every PHP-touched column).

---

## Verification performed this session (v3 round)

- Re-read `AV_livewebsite/database-schema.sql` lines 1-29 to confirm the live `leads` column list, types, and indexes.
- Re-read `api/index.php` `handleAuditSubmission()` + `generateAuditForLead()` to confirm exact INSERT and UPDATE column lists.
- Confirmed the live PK is `id INT AUTO_INCREMENT`, not `lead_id BIGINT UNSIGNED` — this drives the FK type choice in `lead_notes.lead_id` and `lead_events.lead_id` (both INT NOT NULL, not BIGINT UNSIGNED).
- Verified the `email UNIQUE` constraint on `leads` — flagged as a portal-API design constraint (CSV imports can't duplicate audit-form emails).
- `sqlfluff parse --dialect mysql 004_av_detail_v3.sql` runs to completion.
- Grep'd v3 SQL for the strings `DROP`, `RENAME`, `MODIFY COLUMN`, `CHANGE COLUMN` — zero hits. Confirmed nothing destructive.
- Grep'd v3 SQL for every existing `leads` column name — confirmed each appears only in (a) Section A's reference comment, (b) Section B's preserved-column commentary, and (c) smoke tests #7 + #10. Zero appearances inside ALTER ADD/DROP statements.
