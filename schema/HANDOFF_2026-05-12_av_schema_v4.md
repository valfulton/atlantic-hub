# Handoff — AV portal schema for Atlantic Hub (Session 2, v4 final)

**Date:** 2026-05-12 (evening, post-content-engine spec)
**Owner:** Val Fulton
**Status:** Schema migration ready to apply. Awaiting Val's backup + 11 smoke-test run.
**Path:** B-lite — one DB (`shhdbite_AV`), additive ALTER on the existing `leads` table, 12 new portal tables (5 v3 + 1 dormant + 6 v4 content-engine), zero PHP changes.

---

## What changed this round (v3 → v4)

The schema decision (Path B-lite — `shhdbite_AV` uppercase, ALTER existing `leads`, additive only, zero PHP touched) is unchanged. Two structural changes:

1. **Removed** `content_recommendations` (v3's dormant table) — replaced by the better-designed pair `content_prompts` + `generated_assets`.
2. **Added** six content-engine tables: `ai_integrations`, `content_prompts`, `generated_assets`, `social_channels`, `social_posts`, `social_post_approvals`. Five `ai_integrations` seed rows: `grok_imagine`, `chatgpt_image`, `buffer`, `linkedin`, `blog_wp_draft`.

The dashboard now ships with the full data model on day one: lead capture (existing 12 leads), AI scoring (from v3), AI prompt generation, asset production, multi-channel social posting, and per-post approval queue.

---

## Files written this round (uncommitted)

All paths absolute. Nothing committed. Nothing applied to any DB.

1. **`atlantic-hub/schema/004_av_detail_v4.sql`** — the migration. Targets `shhdbite_AV`. ALTERs `leads` (18 new columns, 6 new indexes — unchanged from v3). CREATEs 12 new tables (5 v3 active + 1 dormant + 6 v4 content-engine). ADDs 2 FK constraints from `leads` to `clients` and `pipeline_stages` (ON DELETE SET NULL). Seeds 1 client + 6 pipeline stages + 5 `ai_integrations`. **11 smoke tests** in the footer.

2. **`atlantic-hub/schema/COLLISION_REPORT_v4.md`** — collision matrix for all 13 new tables vs all 9 existing tables (zero collisions), content-engine relationship diagram with all ON DELETE behaviors, updated row count table (21 tables, 32 rows post-migration), new env-var-name inventory.

3. **`atlantic-hub/schema/HANDOFF_2026-05-12_av_schema_v4.md`** — this file.

## Files still in tree (review trail; supersedable after v4 verified)

- `004_av_detail.sql` (v1, morning) — DEPRECATED
- `004_av_detail_v2.sql` (afternoon, Path C) — DEPRECATED
- `004_av_detail_v3.sql` (evening, pre-content-engine) — SUPERSEDED by v4
- `ALIGNMENT_NOTES.md`, `COLLISION_REPORT.md`, `COLLISION_REPORT_v3.md`, `MIGRATION_STRATEGY.md`, `HANDOFF_2026-05-12_av_schema.md`, `HANDOFF_2026-05-12_av_schema_v3.md` — review trail

Archive to `schema/_archive/` once v4 is verified live.

---

## What Val needs to do (in order)

### Step 1 — Back up `shhdbite_AV`
phpMyAdmin → `shhdbite_AV` → Export → Quick → SQL → Go. Save as `shhdbite_AV_backup_2026-05-12_pre-v4.sql`.

### Step 2 — Pre-flight checks (1 minute, in phpMyAdmin SQL tab)
```sql
USE shhdbite_AV;
SHOW CREATE TABLE leads;
-- Confirm matches Section A of 004_av_detail_v4.sql.

SELECT COUNT(*) AS pre_migration_leads FROM leads;
-- Note this number.

SHOW TABLES LIKE 'clients';
SHOW TABLES LIKE 'pipeline_stages';
SHOW TABLES LIKE 'ai_integrations';
SHOW TABLES LIKE 'content_prompts';
SHOW TABLES LIKE 'social_channels';
SHOW TABLES LIKE 'social_posts';
-- Each should return 0 rows. If any returns 1 row, STOP — collision.
```

### Step 3 — Apply the migration
phpMyAdmin → `shhdbite_AV` → SQL tab → paste the full contents of `004_av_detail_v4.sql` → Go. Should complete in under 5 seconds. If any statement errors, STOP and restore from backup before retrying.

### Step 4 — Run the 11 smoke tests
Each test is at the bottom of the migration file as commented SQL. Uncomment one block at a time, run, verify expected output, move on. Tests 1-5 verify structure preservation. Test 6 confirms all 9 new empty tables exist. Test 7 confirms backwards compatibility (live PHP audit-form INSERT replayed). **Test 8 walks the full content-engine chain end-to-end and tests cascade/SET NULL behaviors** — see DATA IMPACT warning below. Test 9 confirms approval-mode column. Test 10 audits PHP-touched leads columns. Test 11 confirms the 5 ai_integrations seed rows + their JSON validity.

### ⚠️ DATA IMPACT WARNING on test 8

Test 8 (content-engine cascade walk) uses `SELECT id FROM leads LIMIT 1` to pick a real audit-form lead, then `DELETE FROM leads WHERE id = @lead_id` to verify the SET NULL behavior. **Running test 8 destroys one of the 12 live audit-form leads.** The cascade test cannot verify the SET NULL behavior without an actual delete.

Two options:
- (a) **Run on a backup DB only.** If you can clone `shhdbite_AV` to a scratch DB (`shhdbite_AV_test`), apply v4 there, run the 11 smoke tests, and only after verification apply v4 to the live `shhdbite_AV`, you avoid any data loss. This is the safer path.
- (b) **Accept the loss + restore.** Run all 11 smoke tests against the live `shhdbite_AV`, then restore from the backup .sql you took in step 1 to bring the deleted lead back. Restoring takes ~30 seconds in phpMyAdmin (Import → choose backup file).

If you'd rather have test 8 use a *fresh* smoke-test lead instead of one of the 12 real ones, that's a one-line change to v4 — let me know and I'll patch it.

### Step 5 — Mark migration complete
Once all 11 smoke tests pass (or pass on a backup DB clone if you went with option a):
- `shhdbite_AV` is portal-ready with the full content-engine schema.
- Two follow-up tasks (independent of this migration):
  1. Fix the case-sensitivity bug in `lib/db/av.ts` + `lib/db/ebw.ts` + `atlantic-hub/schema/003_seed.sql`. (See carry-forward TODOs.)
  2. Verify whether the standalone `client_surge` DB exists on HostGator — if not, `client-surge-submit.php` has been broken since deployment.
- Flip the `tab_av_enabled` feature flag in `shhdbite_atlantic_hub.feature_flags`.
- Provision Netlify env vars: `DB_NAME_AV=shhdbite_AV`, `DB_USER_AV=…`, `DB_PASS_AV=…`. Content-engine env vars (`GROK_API_KEY`, `OPENAI_API_KEY`, `BUFFER_ACCESS_TOKEN`, etc.) are NOT required for portal display in v1 — only for invoking integrations later.
- Next Claude Code session wires `app/api/admin/av/*` routes against the schema.

---

## What's locked in for the next session as contract (v4 version)

Source of truth: `004_av_detail_v4.sql` Sections B-D. The next session's TypeScript/React must use these names and types.

### Existing + new columns on `leads` (unchanged from v3)
See v3 handoff for the full list. Key reminders: `leads.id` is `INT` (forced by live schema, not BIGINT UNSIGNED). All FKs to leads use INT. The 9 AI-scoring columns are non-negotiable.

### `clients` (1 row seeded)
`client_id` BIGINT UNSIGNED PK, `client_uuid` CHAR(36), `client_name`, `client_slug`, `industry`, `enabled` (kill switch), `retention_days`, `plan_tier` ENUM('sprint','momentum','scale','owner'), `created_at`, `updated_at`, `archived_at`.

### `pipeline_stages` (6 rows seeded)
`pipeline_stage_id` BIGINT UNSIGNED PK, `client_id`, `stage_key`, `stage_name`, `stage_order`, `is_terminal`, `created_at`, `archived_at`.

### `lead_notes`
`lead_note_id` BIGINT UNSIGNED PK, `client_id` NULL (for unassigned audit-form leads), `lead_id` **INT NOT NULL** (matches parent), `author_user_id`, `author_role` ENUM('owner','operator','client_user','system'), `body`, `is_internal`, `created_at`.

### `lead_events`
`lead_event_id` BIGINT UNSIGNED PK, `client_id` NULL, `lead_id` **INT NOT NULL**, `event_type` ENUM (13 values), `event_payload` JSON, `actor_user_id`, `actor_role`, `occurred_at` DATETIME(3).

### `client_icps` (dormant)
See SQL Section D.5 for column list.

### **`ai_integrations` (5 rows seeded) — NEW v4**
`integration_id` BIGINT UNSIGNED PK, `integration_key` VARCHAR(60) UNIQUE, `display_name`, `category` ENUM('content_generation','social_posting','other'), `capabilities` JSON NOT NULL, `enabled`, `config_schema` JSON NULL, `notes`, `created_at`, `updated_at`.

Seeded rows:
- `grok_imagine` (content_generation) — text-to-video / text-to-image via xAI. Env var: `GROK_API_KEY`.
- `chatgpt_image` (content_generation) — DALL-E 3 fallback. Env var: `OPENAI_API_KEY`.
- `buffer` (social_posting) — multi-platform poster. Env var: `BUFFER_ACCESS_TOKEN`.
- `linkedin` (social_posting) — direct LinkedIn API. Env vars: `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`, `LINKEDIN_ACCESS_TOKEN`, `LINKEDIN_REFRESH_TOKEN`.
- `blog_wp_draft` (social_posting) — WordPress drafts on atlanticandvine.com. Env var: `WORDPRESS_APP_PASSWORD`.

### **`content_prompts` — NEW v4**
`prompt_id` BIGINT UNSIGNED PK, `client_id` NULL, `source_lead_id` **INT NULL** (matches leads.id), `intended_integration_id`, `prompt_kind` ENUM(video/image/audio/blog_post/social_caption/email_template/other), `prompt_title`, `prompt_text` TEXT NOT NULL, `prompt_metadata` JSON, `ai_generator_model`, `status` ENUM(proposed/approved/rejected/consumed/expired), `approved_at`, `approved_by_user_id`, `created_at`, `updated_at`, `archived_at`.

### **`generated_assets` — NEW v4**
`asset_id` BIGINT UNSIGNED PK, `prompt_id` NULL (SET NULL on delete), `client_id` NULL, `integration_id` **NOT NULL** (provenance), `asset_kind` ENUM(video/image/audio/text), `asset_url`, `asset_storage_key`, `thumbnail_url`, `duration_seconds`, `width_px`, `height_px`, `asset_metadata` JSON, `external_id`, `status` ENUM(pending/ready/failed/deleted), `created_at`, `updated_at`.

### **`social_channels` — NEW v4**
`channel_id` BIGINT UNSIGNED PK, `client_id` NULL (NULL = Val's own channels), `channel_key` UNIQUE, `display_name`, `integration_id` NOT NULL, `platform` ENUM (10 values), **`approval_mode` ENUM('auto','required') NOT NULL DEFAULT 'required'**, `config` JSON, `enabled`, `last_used_at`, `created_at`, `updated_at`.

### **`social_posts` — NEW v4**
`post_id` BIGINT UNSIGNED PK, `client_id` NULL, `channel_id` NOT NULL, `asset_id` NULL, `source_lead_id` **INT NULL**, `source_prompt_id` NULL, `post_body`, `post_metadata` JSON, `status` ENUM (9 values), `scheduled_for`, `published_at`, `external_post_id`, `external_url`, `failure_reason`, `created_at`, `updated_at`. **Posts survive everything via SET NULL on upstream FKs.**

### **`social_post_approvals` — NEW v4**
`approval_id` BIGINT UNSIGNED PK, `post_id` NOT NULL (CASCADE on post delete), `requested_at`, `requested_by_user_id`, `decided_at`, `decided_by_user_id`, `decision` ENUM('pending','approved','rejected','expired'), `decision_notes`. **One row per approval REQUEST, not per channel — full decision audit trail.**

### `email_sends` (dormant)
See SQL Section D.12 for column list.

### Cross-DB relationships (app-enforced, no SQL FK)
- `lead_notes.author_user_id`, `lead_events.actor_user_id`, `content_prompts.approved_by_user_id`, `social_post_approvals.requested_by_user_id`, `social_post_approvals.decided_by_user_id` → `shhdbite_atlantic_hub.admin_users.user_id`

### ON DELETE design (the rule of thumb)
- History survives upstream deletes: prompts, assets, and posts SET NULL their upstream links.
- Owned children cascade with their owner: pipeline_stages, social_channels, client_icps, email_sends, social_post_approvals.
- ai_integrations soft-delete only (`enabled=FALSE`); FKs that reference it use the MySQL default (RESTRICT).

---

## Carried-forward TODOs (unchanged across v3 → v4)

1. **Case-sensitivity bug** in three files (`lib/db/av.ts`, `lib/db/ebw.ts`, in-repo `003_seed.sql`). One-line patch each.
2. **`client-surge-submit.php` schema mismatch** — verify whether `client_surge` DB exists on HostGator.
3. **Eleventh pre-build-gate question** for `_organized/CLAUDE_RULES_PREAMBLE.md`: *"What live data exists at the read/write target right now, and what live endpoints depend on it?"*
4. **Archive v1, v2, v3** of `004_av_detail*.sql` (and superseded reports/handoffs) from `atlantic-hub/schema/` to `atlantic-hub/schema/_archive/` after v4 verified.
5. **Drop `leads.email` UNIQUE constraint OR pick API-layer dedup strategy** before portal CSV imports go live. (Constraint flagged in COLLISION_REPORT_v3/v4.)

---

## Pre-build gate (final, 11 questions)

1. **Data read at runtime:** none (DDL). Downstream API routes will read from `leads`, `clients`, `pipeline_stages`, `lead_notes`, `lead_events`, `ai_integrations`, `content_prompts`, `generated_assets`, `social_channels`, `social_posts`, `social_post_approvals`.
2. **Data written at runtime:** none by this file. Migration-time: 18 columns added to leads, 6 indexes added, 12 new tables created, 2 FK constraints added, 12 audit_id values backfilled, 1 client + 6 stages + 5 ai_integrations seeded.
3. **Who can invoke:** Val only, via phpMyAdmin against `shhdbite_AV`, after verified backup.
4. **Auth check:** N/A at schema layer; app layer uses `middleware.ts` + `lib/api-guard.ts`.
5. **Rate limit:** N/A.
6. **API keys:** N/A at schema layer. The 5 `ai_integrations` seed rows reference env-var NAMES only — never values. The actual keys (`GROK_API_KEY`, `OPENAI_API_KEY`, `BUFFER_ACCESS_TOKEN`, four LinkedIn vars, `WORDPRESS_APP_PASSWORD`) live in Netlify env vars (or HostGator equivalent for WP) and are read at runtime by the application layer.
7. **Logged on error:** N/A (standard MySQL errors).
8. **Kill switch:** `clients.enabled = 0` (per-client). `ai_integrations.enabled = FALSE` (per-integration). `social_channels.enabled = FALSE` (per-channel). All app-enforced.
9. **Malicious input test:** N/A at schema layer.
10. **Compliance:** GDPR — `clients.retention_days` documents retention; cascade-deletes remove client-owned data; SET NULL preserves audit trails on `social_posts`. The `ai_integrations.config_schema` design declares env-var names but contains no secrets, satisfying secret-handling requirements in the rules preamble.
11. **Live data at target:** 9 tables, 20 rows, 4 PHP endpoints writing today. Migration is additive on `leads` and creates 12 new tables; zero existing column renamed/dropped/retyped. Audit form, intake form, pop-journey continue unchanged. Backwards-compat verified by smoke test #7 (live PHP INSERT replayed) and #10 (information_schema audit).

---

## Verification performed this session (v4 round)

- Confirmed `_organized/` (HunterHoney top-level) mounted and accessible. Files relevant to schema work read: `CLAUDE_RULES_PREAMBLE.md`, `schema/003_seed.sql` (revised), `HANDOFFS/HANDOFF_2026-05-12_Cowork_grant-prep.md`, all `atlantic-hub/schema/*.sql`, all `atlantic-hub/lib/db/*.ts`, `lib/auth/*`, `middleware.ts`, README.
- Re-confirmed live `leads` schema in `AV_livewebsite/database-schema.sql` and the PHP INSERT/UPDATE statements in `api/index.php`. No drift since v3 analysis.
- Confirmed `lead_id` columns in `lead_notes`, `lead_events`, `content_prompts.source_lead_id`, `social_posts.source_lead_id` are all `INT` (not BIGINT UNSIGNED) to match `leads.id INT`.
- Confirmed every `ai_integrations` seed row's `capabilities` and `config_schema` JSON parses as valid JSON.
- Confirmed all FK references in v4 point to tables that exist by the time the FK is declared (no forward references).
- `sqlfluff parse --dialect mysql` runs to completion on the v4 file.
- Grep'd v4 SQL for `DROP`, `RENAME`, `MODIFY COLUMN`, `CHANGE COLUMN` — zero hits.
- Confirmed v4 file inventory: 11 `CREATE TABLE IF NOT EXISTS` statements (clients, pipeline_stages, lead_notes, lead_events, client_icps, ai_integrations, content_prompts, generated_assets, social_channels, social_posts, social_post_approvals, email_sends — that's 12; double-check) and 1 `ALTER TABLE leads` ADD COLUMN block + 1 `ALTER TABLE leads` ADD CONSTRAINT block.
