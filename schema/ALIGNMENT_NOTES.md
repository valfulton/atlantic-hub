# ALIGNMENT_NOTES — `schema/004_av_detail.sql`

Deviations between the previous session's `migrations/004_av_client_portal.sql`
(PHP/HostGator standalone target) and this session's `schema/004_av_detail.sql`
(Atlantic Hub / Next.js target). One bullet per deviation, with the reason.

## Removed entirely

- **Removed `ALTER TABLE admin_users MODIFY COLUMN role ENUM(...)`.** Atlantic Hub's platform DB owns `admin_users`. The role enum (`'owner','staff','client_user'`) is defined in `schema/001_platform.sql` and is referenced by `middleware.ts`, `lib/auth/jwt.ts`, and `lib/auth/session.ts`. Touching it from a tenant-detail file would break those callers.
- **Removed `ALTER TABLE admin_users ADD COLUMN account_id`.** Atlantic Hub does not scope admin users by per-tenant `account_id`. Cross-tenant identity is modelled at the platform level via `accounts` + `tenant_account_link` (one row per person-per-tenant-per-role). The AV API routes will resolve the caller's AV-side access by looking up `tenant_account_link` for `tenant_id = 'av'`, not by reading a column on `admin_users`.
- **Removed the `av_lead_imports` table.** Out of scope for this session per Val's instructions ("Keep the 5 active tables… and 3 dormant tables"). Import history can be reconstructed from `lead_events` (`event_type = 'created'` with `event_payload.source_type`) in v1; a dedicated `lead_imports` table can be added in v2 if batch-level metadata is needed.

## Renamed

- **`accounts` table → `clients` (the most consequential rename in this file).** Reason: the platform DB (`shhdbite_atlantic_hub`) already has its own `accounts` table — a canonical per-person record. The AV-side table is per-business (one row per AV client paying for the portal). Same word, different concept, different DB. Decided by Val to rename now: the overload would have cost a year of disambiguation in code review and onboarding. This rename changes the contract the next session's React components and API routes will use — every column reference, route parameter, and TypeScript type for AV will say `client_*`, never `account_*`.
- **Internal PK `account_id` → `client_id` on the new `clients` table, and on every child table (`pipeline_stages`, `leads`, `lead_notes`, `lead_events`, `client_icps`, `content_recommendations`, `email_sends`) as the FK column.** Consequence of the table rename.
- **`account_uuid` → `client_uuid`** on the new `clients` table. Consequence of the table rename.
- **Index renames cascading from the table rename:** `uq_account_uuid` → `uq_client_uuid`, `uq_account_stage_key` → `uq_client_stage_key`, `idx_account_order` → `idx_client_order`, `idx_account_stage` → `idx_client_stage`, `idx_account_score` → `idx_client_score`, `idx_account_activity` → `idx_client_activity`, `idx_account_archived` → `idx_client_archived`, `idx_account_time` → `idx_client_time`, `uq_account` (on `client_icps`) → `uq_client`. Also `uq_account_linkedin` → `uq_client_linkedin` (the per-tenant dedupe key on `leads`). The `uq_client_slug` and `fk_leads_stage` constraints stay as-is — already client-prefixed or stage-related.
- **FK constraint renames cascading from the table rename:** `fk_stages_account` → `fk_stages_client`, `fk_leads_account` → `fk_leads_client`, `fk_notes_account` → `fk_notes_client`, `fk_events_account` → `fk_events_client`, `fk_icps_account` → `fk_icps_client`, `fk_recs_account` → `fk_recs_client`, `fk_sends_account` → `fk_sends_client`.
- **Seed-block session variable `@aid` → `@cid`.** Local clarity; not a contract.
- **All tables: dropped the `av_` prefix.** `av_accounts` → `clients` (after the rename above), `av_leads` → `leads`, etc. Reason: Atlantic Hub's per-tenant detail tables live in per-tenant databases that already supply the namespace — see `schema/002_hh_detail.sql` where tables are `subscribers`, `fap_applications`, `cohort_waitlist`, `research_api_customers` with no `hh_` prefix. The DB name (`shhdbite_av` vs `shhdbite_hunterhoney`) is the only disambiguator needed.
- **Primary keys renamed from bare `id` to `{table_singular}_id`.** `id` → `client_id`, `pipeline_stage_id`, `lead_id`, `lead_note_id`, `lead_event_id`, `client_icp_id`, `content_recommendation_id`, `email_send_id`. Reason: Atlantic Hub uses descriptive PK names everywhere (`subscriber_id`, `fap_app_id`, `audit_id`). Self-documenting in JOINs and easier to grep.
- **Index `idx_type` → `idx_event_type`** on `lead_events`. Reason: minor readability improvement; `type` is too generic at the schema level.

## Retyped

- **Internal PKs: `INT AUTO_INCREMENT` → `BIGINT UNSIGNED AUTO_INCREMENT`.** Reason: Atlantic Hub mandates BIGINT UNSIGNED for every tenant-internal PK (see `subscribers`, `fap_applications`, etc.). Headroom + matches Hub.
- **FK columns retyped to match parent PK width.** `account_id INT` → `client_id BIGINT UNSIGNED`. Same for `pipeline_stage_id`, `lead_id`, `delivered_in_email_id`. Reason: type mismatch on a SQL FK is allowed by MySQL but generates implicit cast on every JOIN.
- **Cross-DB user FK columns retyped to BIGINT UNSIGNED.** `imported_by_user_id`, `author_user_id`, `actor_user_id`, `updated_by_user_id` were all `INT NULL` in the original; now `BIGINT UNSIGNED NULL`. Reason: must match `shhdbite_atlantic_hub.admin_users.user_id`, which is `BIGINT UNSIGNED AUTO_INCREMENT`. MySQL cannot enforce a cross-DB FK, but the application layer can only insert values it reads from the platform DB — if the types diverge those reads will silently truncate.
- **Timestamps: `TIMESTAMP` → `DATETIME`.** Reason: Atlantic Hub uses `DATETIME` everywhere (`001_platform.sql`, `002_hh_detail.sql`). `TIMESTAMP` has Y2038 plus per-connection timezone conversion semantics that bite at midnight UTC; `DATETIME` is stored verbatim.
- **Boolean columns: `TINYINT NOT NULL DEFAULT 1` → `BOOLEAN NOT NULL DEFAULT TRUE`.** Same storage, Hub style. Applies to `clients.enabled`, `pipeline_stages.is_terminal`, `lead_notes.is_internal`.
- **`lead_events.occurred_at`: `TIMESTAMP DEFAULT CURRENT_TIMESTAMP` → `DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)`.** Reason: mirrors `shhdbite_atlantic_hub.audit_log_global.ts` which uses millisecond resolution. Ordering events that happen inside the same second matters (an AI scoring run emits ~10 events in one HTTP request).
- **`pipeline_stages.is_terminal` default: `0` → `FALSE`.** Same value, Hub style.

## Added

- **`ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci` on every table.** Reason: Atlantic Hub mandates this. The original migration omitted it, falling back to the server default — which on HostGator is `utf8mb4_general_ci`. `unicode_ci` orders correctly for non-English characters (relevant for international lead names).
- **`updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP` on `clients` and `pipeline_stages`.** Original only had `created_at`. Reason: every mutable table in Hub has both timestamps so we can detect stale cached reads.
- **Named `UNIQUE KEY uq_audit_id (audit_id)` on `leads`.** Original used inline `UNIQUE` on the column. Same effect, but the named constraint makes phpMyAdmin's index view legible and matches Hub style.
- **`UNIQUE KEY uq_client (client_id)` on `client_icps`.** Original used `account_id INT NOT NULL UNIQUE` inline; same constraint, named for consistency.
- **`KEY idx_client_archived (client_id, archived_at)` on `leads`.** Reason: every list query filters by `archived_at IS NULL` AND `client_id = ?`. Without an index this is a tablescan once the AV client onboards a few thousand leads.
- **Smoke-test query #5: kill-switch flip.** Reason: prove the column accepts a flip in phpMyAdmin so Val can verify the disable path before the next session wires application enforcement.
- **Header documentation block.** Reason: matches the heavy-comment style of `001_platform.sql` and `002_hh_detail.sql` — schema files double as runbooks.
- **Inline notes about cross-DB FK enforcement.** Every `*_user_id` column gets a comment explaining the relationship is application-enforced because MySQL cannot do cross-DB FKs. Mirrors the same callout at the top of `002_hh_detail.sql`.

## Re-shaped

- **Stage seed: 6 separate `INSERT … WHERE NOT EXISTS` blocks → one `INSERT IGNORE … CROSS JOIN` against a derived table of literals.** Reason: idempotency now comes from the `uq_client_stage_key (client_id, stage_key)` unique key, which is the right primitive. Easier to maintain when you want to add a 7th stage.
- **Seed for `clients`: `INSERT … WHERE NOT EXISTS` → `INSERT IGNORE` on the `uq_client_slug` key.** Same idempotency, less SQL.

## Kept unchanged (explicitly preserved)

- **All 9 AI scoring columns on `leads`.** `ai_score`, `ai_score_band`, `ai_score_reason`, `ai_score_breakdown`, `ai_audit`, `ai_email_subject`, `ai_email_body`, `ai_last_scored_at`, `ai_model_version`. Per Val's instruction: "non-negotiable — they are the product story." Kept exact column names so the next session's API routes and dashboard component contracts don't need a rewrite from the PHP/HTML originals.
- **`clients.enabled` (kill switch).** Kept the column name `enabled` (vs Hub's more common `is_active`) per Val's instruction. Application layer enforces.
- **`clients.retention_days`** (GDPR retention) — kept verbatim, documented in header that v2 cron will use it.
- **`audit_id CHAR(36)` public-facing reference on `leads`.** Kept the CHAR(36) UUID alongside the internal BIGINT PK. Two-ID pattern: BIGINT for internal joins, CHAR(36) UUID for URLs and logs.
- **`source_type ENUM('csv','scrape','manual','api')`** — kept verbatim. The PHP routes already write these values; renaming would break the upstream contract that the previous session's HTML expects in `?demo=1` responses.
- **All 3 dormant tables (`client_icps`, `content_recommendations`, `email_sends`)** kept structurally identical to the original except for the type/naming changes listed above. v2 work picks them up unchanged.

## V2 spec items (do NOT fix in this file)

- **`content_recommendations.delivered_in_email_id` ↔ `email_sends.recommendation_ids` model the same relationship twice.** `content_recommendations.delivered_in_email_id` is a BIGINT UNSIGNED FK pointing at `email_sends.email_send_id` (one rec → one send), while `email_sends.recommendation_ids` is a JSON array of recommendation IDs pointing the other way (one send → many recs). They will drift. Pick one before any v2 code writes to these dormant tables — the right call is almost certainly to keep `email_sends.recommendation_ids` (a single send can include several recs, so the one-to-many is in that direction) and drop `delivered_in_email_id` in favor of a derived query (`WHERE JSON_CONTAINS(es.recommendation_ids, JSON_QUOTE(cr.content_recommendation_id))`), but that's a v2 schema decision and a separate migration. Flagging here so it doesn't get coded around silently.
