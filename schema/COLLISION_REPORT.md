# COLLISION_REPORT — `shhdbite_AV` state-of-the-DB + collision matrix

**Date:** 2026-05-12
**Author:** Cowork session (after Opus 4.7 pushback)
**Purpose:** Document the live state of `shhdbite_AV` before any portal migration, and map every collision between the portal's 8 new tables and the 9 existing tables.

## What I CAN'T verify

I do not have direct MySQL access in this session. Every row of this report is sourced from:
1. The four SQL files under `AV_livewebsite/` (`database-schema.sql`, `client-intake-schema.sql`, `client-surge-schema.sql`, `sql/client_pop_journey.sql`) — these are the canonical schemas that created the live tables.
2. The four PHP endpoint files under `AV_livewebsite/api/` — these are the live writers/readers.
3. The phpMyAdmin screenshot Val provided (9 tables, row counts).

I did **NOT** run `INFORMATION_SCHEMA` queries because I have no DB credential. Val should run the verification queries in the appendix to confirm the schema matches what's documented here. Any drift between the SQL files and the live DB (manual ALTERs in phpMyAdmin, etc.) would not appear in my analysis.

---

## Deliverable 1 — State of `shhdbite_AV` (9 tables)

### Database identity
- **Name on HostGator:** `shhdbite_AV` (capital `AV`). MySQL on Linux is case-sensitive for DB names. The lowercase `shhdbite_av` referenced in `atlantic-hub/lib/db/av.ts` and `atlantic-hub/schema/004_av_detail.sql` is wrong — those would target a non-existent DB.
- **Connection host:** HostGator (`localhost` from the PHP side, since `api.atlanticandvine.com` is hosted on the same box).
- **Atlantic Hub tenant row:** corrected to `shhdbite_AV` in `_organized/schema/003_seed.sql` (revised May 11), but the in-repo `atlantic-hub/schema/003_seed.sql` still says `shhdbite_av` lowercase. This needs to be reconciled.

### Table 1 — `leads` (12 live rows — the critical one)

| Column | Type | Notes |
|---|---|---|
| id | INT AUTO_INCREMENT PK | Bare `id`, not `lead_id` |
| company | VARCHAR(255) NOT NULL | |
| website | VARCHAR(500) | |
| industry | VARCHAR(100) | |
| contact_name | VARCHAR(255) | |
| email | VARCHAR(255) NOT NULL **UNIQUE** | UNIQUE means one row per email — same person can't appear twice |
| phone | VARCHAR(20) | |
| challenge | TEXT | The "what's holding you back" free-text |
| audit_content | LONGTEXT | Claude-generated strategic audit |
| audit_generated | DATETIME | When Claude finished |
| is_approved | TINYINT DEFAULT 0 | Approval flag (set to 1 after audit generated) |
| approval_date | DATETIME | |
| approved_by | VARCHAR(255) | |
| submission_date | DATETIME DEFAULT CURRENT_TIMESTAMP | When the form was submitted |
| lead_status | ENUM('new','contacted','qualified','converted','lost') | Marketing-funnel status |
| follow_up_date | DATETIME | |
| notes | TEXT | |
| created_at | TIMESTAMP | |
| updated_at | TIMESTAMP ON UPDATE | |

**Indexes:** `idx_email (email)`, `idx_industry (industry)`, `idx_submission_date (submission_date)`, `idx_status (lead_status)`
**FKs INBOUND from other tables:** `lead_attributions.lead_id`, `email_log.lead_id`, `revenue_tracking.lead_id`
**Live writers:**
- `api/index.php :: handleAuditSubmission()` — INSERTs new audit-form submissions (the public "get a free strategic audit" form on `audit-form.html` / similar)
- `api/index.php :: generateAuditForLead()` — UPDATEs `audit_content`, `audit_generated`, `is_approved` after Claude returns
- `api/client-surge-submit.php` — *attempts* to INSERT but the column list doesn't match this schema (writes `name`, `business_name`, `biggest_challenge`, `source`, `submitted_at` which aren't in this table). Either silently failing in production or writing to a separate `client_surge` DB. **Uncertain — needs Val to confirm.**

**Live readers:** None confirmed in v1 code beyond writers. The 12 rows are presumably read in phpMyAdmin manually for now. (Future: this is where the Atlantic Hub home page MRR widget could pull from, but it doesn't yet.)

**Active vs legacy:** ACTIVE. 12 rows of live prospect data. Cannot be dropped or renamed without breaking the audit form on `atlanticandvine.com`.

### Table 2 — `ad_partners` (2 live rows)

| Column | Type | Notes |
|---|---|---|
| id | INT AUTO_INCREMENT PK | |
| name | VARCHAR(255) NOT NULL | |
| industry | VARCHAR(100) | |
| website | VARCHAR(500) | |
| contact_email | VARCHAR(255) | |
| contact_phone | VARCHAR(20) | |
| ad_placement | VARCHAR(100) | sidebar/email/blog/events |
| monthly_fee | DECIMAL(10,2) | |
| revenue_share_percent | DECIMAL(5,2) | |
| start_date | DATE | |
| end_date | DATE | |
| is_active | TINYINT DEFAULT 1 | |
| notes | TEXT | |
| created_at, updated_at | TIMESTAMP | |

**Indexes:** `idx_active (is_active)`
**Seed data confirmed:** 2 rows = '1ecs' (Catering) and 'MPG Loan' (Mortgages) — these match the `INSERT` at the bottom of `database-schema.sql`.
**Live writers/readers:** None of the four PHP endpoints touch this table. Likely read manually or by a future blog ads system.
**Active vs legacy:** SCHEMA-PRESENT, NOT YET WIRED. Don't touch — Val seeded these intentionally.

### Table 3 — `lead_attributions` (0 rows)

| Column | Type | Notes |
|---|---|---|
| id | INT AUTO_INCREMENT PK | |
| lead_id | INT NOT NULL FK → leads(id) | |
| ad_partner_id | INT NOT NULL FK → ad_partners(id) | |
| attribution_date | DATETIME | |
| closed_deal | TINYINT | |
| deal_value | DECIMAL(12,2) | |
| commission_owed | DECIMAL(10,2) | |
| commission_paid | TINYINT | |
| payment_date | DATETIME | |

**Indexes:** `idx_lead`, `idx_partner`, `idx_closed`
**Live writers:** None.
**Active vs legacy:** SCHEMA-PRESENT, NOT YET WIRED. But it has a hard FK to `leads(id)` — if we rename or drop `leads`, this table's constraint breaks even though it's empty.

### Table 4 — `blog_posts` (0 rows)

| Column | Type | Notes |
|---|---|---|
| id, title, slug UNIQUE, content LONGTEXT, excerpt TEXT, featured_image, author, category, published_at, is_published, views, created_at, updated_at | | |

**Live writers/readers:** None confirmed. No PHP touches it.
**Active vs legacy:** SCHEMA-PRESENT, NOT YET WIRED. Don't touch.

### Table 5 — `admin_users` (0 rows)

| Column | Type | Notes |
|---|---|---|
| id, username UNIQUE, email UNIQUE, password_hash, role ENUM('admin','moderator','viewer') DEFAULT 'moderator', is_active, last_login, created_at, updated_at | | |

**Seed data:** `database-schema.sql` inserts a default admin `info@atlanticandvine.com` with bcrypt hash for password `admin123`. But the live count is 0 rows — Val has either deleted that seed row (per `sql/SECURITY-fix-default-admin.sql`) or never ran the seed `INSERT`. Either way, the table is currently empty.

**Live writers/readers:** None. No PHP endpoint authenticates against it yet.
**Active vs legacy:** SCHEMA-PRESENT, NOT YET WIRED. This is a per-tenant admin user table separate from `shhdbite_atlantic_hub.admin_users`. **Atlantic Hub's auth uses the platform DB's admin_users, not this one.** This table is dormant.

### Table 6 — `email_log` (0 rows)

| Column | Type | Notes |
|---|---|---|
| id, lead_id FK → leads(id), recipient_email, subject, email_type ENUM('audit','follow_up','promotion'), sent_at, opened, opened_at, clicked, clicked_at | | |

**Live writers:** None confirmed. The audit email sender in `api/index.php :: sendAuditEmail()` does NOT log into `email_log` — it just calls PHP `mail()` and moves on. **This is a logging gap in production.**
**Active vs legacy:** SCHEMA-PRESENT, NOT YET WIRED. Has hard FK to `leads(id)`.

### Table 7 — `revenue_tracking` (0 rows)

| Column | Type | Notes |
|---|---|---|
| id, lead_id FK → leads(id), project_name, project_type ENUM('audit','prompt','project','retainer'), deal_amount, deal_date, status ENUM('quoted','proposed','signed','paid','completed'), vertical, created_at, updated_at | | |

**Live writers/readers:** None.
**Active vs legacy:** SCHEMA-PRESENT, NOT YET WIRED. Hard FK to `leads(id)`.

### Table 8 — `client_intakes` (4 live rows)

| Column | Type | Notes |
|---|---|---|
| id, company NOT NULL, contact_name NOT NULL, email NOT NULL, phone, industry, services_requested VARCHAR(255), intake_data LONGTEXT (raw JSON of the form), claude_analysis LONGTEXT, submission_date, analyzed_at, status ENUM('new','analyzed','proposal_sent','signed','in_progress','completed') | | |

**Indexes:** `idx_email`, `idx_status`, `idx_services`
**Live writers:**
- `api/process-intake.php :: handleClientIntake()` (via `require_once '../index.php'`) — INSERTs new intake then UPDATEs with Claude analysis.

**Live readers:** None confirmed in code. Read manually in phpMyAdmin.
**Active vs legacy:** ACTIVE. 4 rows of live client intake data. Cannot be touched.

### Table 9 — `client_pop_journey` (2 live rows)

| Column | Type | Notes |
|---|---|---|
| id, email UNIQUE NOT NULL, company, contact_name, vertical, pop1_completed BOOLEAN + pop1_completed_at + pop1_insight LONGTEXT + pop1_insight_sent BOOLEAN, pop2_completed + pop2_completed_at + pop2_services JSON + pop2_other_notes + pop2_strategy LONGTEXT + pop2_strategy_sent, pop3_completed + pop3_completed_at + pop3_timeline + pop3_budget + pop3_call_preference BOOLEAN, proposal_generated BOOLEAN + proposal_package + proposal_monthly_price DECIMAL + proposal_data LONGTEXT + proposal_revealed_at, payment_status ENUM('unpaid','paid','trial','cancelled') + stripe_customer_id + stripe_subscription_id + paid_at, source + industry + phone + website + notes + created_at + updated_at | | |

**Indexes:** `idx_email`, `idx_company`, `idx_vertical`, `idx_payment_status`, `idx_created`
**Live writers:**
- `api/pop-journey-backend.php :: handlePop1Submission()` — UPSERT on email
- `api/pop-journey-backend.php :: handlePop2Submission()` — UPDATE where email matches
- `api/pop-journey-backend.php :: handlePop3Submission()` — UPDATE + generate proposal
- `api/pop-journey-backend.php :: generatePop1Insight()` — UPDATE async after Claude returns
- `api/pop-journey-backend.php :: generatePop2Strategy()` — UPDATE async after Claude returns

**Live readers:** Same file does `SELECT * FROM client_pop_journey WHERE email = ?` to build the proposal payload before emailing Val.
**Active vs legacy:** ACTIVE. 2 rows of live funnel data. Cannot be touched.

---

## Deliverable 2 — Collision matrix (new portal tables ↔ existing AV tables)

The portal's 8 new tables vs `shhdbite_AV`'s 9 existing tables:

| New portal table | Same name exists? | Hard collision? | Notes |
|---|---|---|---|
| **`clients`** | NO in `shhdbite_AV` | NO direct collision in this DB. *But* `client-surge-schema.sql` creates a separate `client_surge` DB with its own `clients` table. If that DB exists, then naming `shhdbite_AV.clients` is fine — different DB. | Safe to create. |
| **`pipeline_stages`** | NO | NO | Safe to create. |
| **`leads`** | **YES — 12 live rows** | **YES — `CREATE TABLE IF NOT EXISTS leads` will silently no-op, leaving the existing 12-row table. Then `lead_notes.fk_notes_lead FOREIGN KEY (lead_id) REFERENCES leads(lead_id)` will FAIL because the existing table's PK is `id INT`, not `lead_id BIGINT UNSIGNED`. Migration would abort or, worse, half-apply.** | **This is the breaking collision.** |
| **`lead_notes`** | NO | NO direct name collision, but its FK to `leads(lead_id)` is the hard fail point. | Cannot create until `leads` collision is resolved. |
| **`lead_events`** | NO | Same as above — FK to `leads(lead_id)`. | Cannot create until `leads` collision is resolved. |
| **`client_icps`** | NO | NO | Safe to create. |
| **`content_recommendations`** | NO | NO | Safe to create. |
| **`email_sends`** | NO direct collision, but `email_log` exists with conceptual overlap (same purpose: log every email sent). | Soft semantic collision. Two email logs in one DB is sloppy but not broken. | Safe to create; consider deprecating `email_log` later. |

### Column-level analysis of the `leads` collision

The existing `leads` table and the portal's planned `leads` table are **semantically different products**:

| | Existing `leads` | Portal `leads` |
|---|---|---|
| Purpose | Inbound prospects who filled out the AV audit form to get a free strategic audit | Outbound LinkedIn prospects that AV's own clients are reaching out to |
| PK | `id INT` | `lead_id BIGINT UNSIGNED` |
| Identity | `company`, `contact_name`, `email` (UNIQUE — one row per email) | `full_name`, `company`, `email` (NOT unique; dedupe is by `(client_id, linkedin_url)`) |
| Multi-tenant? | No — implicitly all leads belong to AV itself | Yes — every row is scoped to an AV client via `client_id` |
| AI columns | `audit_content` LONGTEXT, `audit_generated` DATETIME, `is_approved` | `ai_score`, `ai_score_band`, `ai_score_reason`, `ai_score_breakdown`, `ai_audit`, `ai_email_subject`, `ai_email_body`, `ai_last_scored_at`, `ai_model_version` |
| Funnel | `lead_status` ENUM('new','contacted','qualified','converted','lost') | `pipeline_stage_id` FK → `pipeline_stages` (per-client custom funnel) |
| Linked tables | `lead_attributions`, `email_log`, `revenue_tracking` (all FK → leads.id) | `lead_notes`, `lead_events` (both FK → leads.lead_id) |

**These cannot be merged into one table without losing meaning.** The audit-form `leads` is "people who want to hire AV." The portal `leads` is "people AV's clients want to reach out to." Two different concepts that happen to share a name.

### Cross-DB collisions to flag

- **`shhdbite_atlantic_hub.admin_users`** vs **`shhdbite_AV.admin_users`**: both exist, different schemas, different role enums. Atlantic Hub auth uses the platform DB's table. The AV-side `admin_users` is dormant. No action needed in this migration but worth noting that the namespace overlap exists.
- **`shhdbite_atlantic_hub.accounts`** vs the portal's `clients` table: I already renamed `accounts` → `clients` in the previous session per Val's call. Confirmed the portal will use `clients`, no collision with platform DB.

---

## Appendix — verification queries for Val to run in phpMyAdmin

Paste these into phpMyAdmin against `shhdbite_AV` to confirm this report:

```sql
-- 1. Confirm the 9 expected tables exist:
SELECT table_name, table_rows
FROM information_schema.tables
WHERE table_schema = 'shhdbite_AV'
ORDER BY table_name;
-- expect: admin_users(0), ad_partners(2), blog_posts(0), client_intakes(4),
-- client_pop_journey(2), email_log(0), lead_attributions(0), leads(12), revenue_tracking(0)

-- 2. Confirm `leads` schema matches what this report describes:
SHOW CREATE TABLE leads\G

-- 3. Confirm the FKs inbound to `leads`:
SELECT table_name, column_name, constraint_name
FROM information_schema.key_column_usage
WHERE table_schema = 'shhdbite_AV' AND referenced_table_name = 'leads';
-- expect: lead_attributions.lead_id, email_log.lead_id, revenue_tracking.lead_id

-- 4. Confirm `client_surge` DB exists (or doesn't):
SHOW DATABASES LIKE 'client_surge';
-- If it returns 0 rows: client-surge-submit.php has been broken / writing nowhere.
-- If it returns 1 row: it exists separately and client-surge submissions go there.

-- 5. Confirm `shhdbite_AV` casing in the live env:
SHOW DATABASES LIKE 'shhdbite\_AV';
SHOW DATABASES LIKE 'shhdbite\_av';
-- expect: first returns shhdbite_AV, second returns nothing (proves case sensitivity)

-- 6. Sample the live leads data WITHOUT exposing PII:
SELECT id, industry, lead_status, submission_date, is_approved,
       (audit_content IS NOT NULL) AS has_audit
FROM leads
ORDER BY submission_date DESC
LIMIT 12;
-- expect: 12 rows, recent submissions, most with has_audit=1

-- 7. Confirm divergence between in-repo seed and revised seed:
USE shhdbite_atlantic_hub;
SELECT tenant_id, db_name FROM tenants WHERE tenant_id IN ('av','ebw');
-- if db_name shows 'shhdbite_av' or 'shhdbite_ebw' (lowercase): the OLD seed ran
-- if db_name shows 'shhdbite_AV' or 'shhdbite_eventsbywater': the revised seed ran
```
