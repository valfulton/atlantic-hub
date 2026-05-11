# Atlantic Hub — Recovery Runbook

**Read this when something is wrong.**
Three procedures. Each has exact SQL or terminal commands. Don't improvise — improvising at 11pm is how mistakes happen.

---

## Procedure 1 — I'm locked out of my owner account

**Symptom:** You can't log in to `admin.atlanticandvine.com` (or `atlantic-hub.netlify.app`). Either you forgot the password, or the bootstrap upsert didn't run, or somehow `is_active` got flipped to `FALSE`.

### Steps

**1. Generate a fresh bcrypt hash on your laptop.**

```
cd "/Users/atlanticandvine/Library/CloudStorage/OneDrive-atlanticandvine.com/HunterHoney/atlantic-hub"
```

```
node scripts/generate-owner-hash.js
```

Copy the hash it prints.

**2. Open HostGator cPanel → phpMyAdmin → `shhdbite_atlantic_hub` → SQL tab. Run:**

```sql
UPDATE admin_users
SET password_hash = 'PASTE_THE_HASH_HERE',
    role = 'owner',
    is_active = TRUE
WHERE email = 'info@atlanticandvine.com';
```

(Replace the email if your `OWNER_BOOTSTRAP_EMAIL` is different.)

Expect: `1 row affected`. If you see `0 rows affected`, the owner row never got created — run this instead:

```sql
INSERT INTO admin_users (email, password_hash, role, is_active, display_name)
VALUES (
  'info@atlanticandvine.com',
  'PASTE_THE_HASH_HERE',
  'owner',
  TRUE,
  'Owner'
);
```

**3. Update the Netlify env var to match (so future cold starts don't overwrite your manual fix).**

- Netlify dashboard → `atlantic-hub` site → **Site settings → Environment variables**
- Edit `OWNER_BOOTSTRAP_PASSWORD_HASH` → paste the same hash
- Click **"Trigger deploy → Clear cache and deploy site"** (otherwise the running build keeps the old hash in memory)

**4. Sign in at `/login`.**

If still failing, check the `audit_log_global` table for what's actually rejecting you:

```sql
SELECT ts, action, error_class, status_code, ip_hash
FROM audit_log_global
WHERE target_resource = '/api/auth/login'
ORDER BY ts DESC
LIMIT 20;
```

Common failure modes:
- `action = 'login_disabled'` → flip `admin_login_enabled` to `TRUE` (see Procedure 2 pattern below)
- `action = 'login_rate_limited'` → wait 15 minutes or `DELETE FROM rate_limit_buckets WHERE bucket_key LIKE 'login:%';`
- `action = 'login_failed'` → hash mismatch; redo step 1 carefully

---

## Procedure 2 — Suspicious webhook traffic

**Symptom:** `audit_log_global` shows a spike of `webhook_bad_secret` rows, OR `webhook_events` table is growing fast with `ingestion_status = 'failed'`, OR you see weird payloads in HH form submissions, OR a bot is hammering the webhook endpoint.

### Step 1 — Kill webhook ingestion IMMEDIATELY

phpMyAdmin → `shhdbite_atlantic_hub` → SQL tab:

```sql
UPDATE feature_flags
SET enabled = FALSE,
    notes = CONCAT('Disabled ', NOW(), ' due to suspicious traffic')
WHERE flag_name = 'webhook_ingestion_enabled';
```

Within 30 seconds (the in-memory flag cache TTL), all incoming Netlify Forms webhooks will return `503` and bounce. **No new rows will be written to `accounts`, `tenant_account_link`, or any per-tenant detail table.**

### Step 2 — Investigate

```sql
SELECT
  DATE_FORMAT(ts, '%Y-%m-%d %H:%i') AS minute,
  action,
  error_class,
  COUNT(*) AS hits
FROM audit_log_global
WHERE target_resource = '/api/webhooks/netlify-forms'
  AND ts >= NOW() - INTERVAL 2 HOUR
GROUP BY minute, action, error_class
ORDER BY minute DESC;
```

Look for:
- Repeated `webhook_bad_secret` → someone is probing without the secret. Confirm Netlify still has the right secret header configured.
- Repeated `webhook_rate_limited` → you're getting hammered. Note the `ip_hash` (one hash = one source).
- `webhook_ingest_failed` → the ingestion code is throwing. Check `webhook_events.error_message`:

```sql
SELECT external_id, form_name, error_message, received_at
FROM webhook_events
WHERE ingestion_status = 'failed'
ORDER BY received_at DESC
LIMIT 20;
```

### Step 3 — Rotate the webhook secret (if `webhook_bad_secret` was the issue, this is **mandatory**; if it was just code throwing, skip to step 4)

```
openssl rand -base64 48
```

Copy the new value. Then:

- Netlify dashboard → `atlantic-hub` site → **Site settings → Environment variables** → edit `NETLIFY_FORMS_WEBHOOK_SECRET` → paste new value
- Netlify dashboard → the **HunterHoney** site (separate site) → **Forms** → for each of the four forms (`hh_subscribe`, `hh_fap_apply`, `hh_cohort_waitlist`, `hh_research_api_inquiry`), update the outgoing webhook header `X-Atlantic-Hub-Webhook-Secret` to the new value
- Trigger a "Clear cache and deploy site" on `atlantic-hub`

### Step 4 — Re-enable webhook ingestion

```sql
UPDATE feature_flags
SET enabled = TRUE,
    notes = CONCAT('Re-enabled ', NOW(), ' after secret rotation')
WHERE flag_name = 'webhook_ingestion_enabled';
```

### Step 5 — Replay any legitimate submissions you missed

Submissions that came in while the flag was off were rejected with `503`. Netlify Forms **will not auto-retry indefinitely** — usually a few retries over a few hours. To recover them: in the HunterHoney site's Netlify Forms dashboard, export submissions from the outage window as CSV. You can manually re-POST them to the webhook endpoint, or backfill them via `INSERT` statements into `accounts` + `tenant_account_link` + the appropriate detail table. (v2: build a one-click "replay missed submissions" button. For now, do it manually if it matters.)

---

## Procedure 3 — Delete an EU resident's data (GDPR Article 17 / CCPA)

**Symptom:** A user has emailed asking for their data to be deleted. You must comply within 30 days (GDPR) or 45 days (CCPA).

### Step 1 — Verify the request is real

Reply from `info@atlanticandvine.com`:
> Confirming your request to delete all personal data we hold under the email address `<their email>`. To verify identity, please reply to this email from the same address. Once we have your confirmation, deletion completes within 7 business days.

Do not proceed until they reply from the same email address.

### Step 2 — Find the account_id

```sql
-- Run in shhdbite_atlantic_hub
SELECT account_id, first_seen_at, last_seen_at
FROM accounts
WHERE email_hash = SHA2(LOWER(TRIM('their.email@example.com')), 256);
```

Note the `account_id`.

### Step 3 — Find every tenant they touched

```sql
SELECT tenant_id, account_type, detail_table, detail_row_id, status
FROM tenant_account_link
WHERE account_id = 'PASTE_ACCOUNT_ID_HERE';
```

This tells you which per-tenant detail tables have their data. Note them.

### Step 4 — Delete from per-tenant detail tables FIRST (no FK cascade across DBs)

For HunterHoney, the four possible detail tables are in `shhdbite_hunterhoney`:

```sql
USE shhdbite_hunterhoney;

DELETE FROM subscribers              WHERE account_id = 'PASTE_ACCOUNT_ID_HERE';
DELETE FROM fap_applications         WHERE account_id = 'PASTE_ACCOUNT_ID_HERE';
DELETE FROM cohort_waitlist          WHERE account_id = 'PASTE_ACCOUNT_ID_HERE';
DELETE FROM research_api_customers   WHERE account_id = 'PASTE_ACCOUNT_ID_HERE';
```

(When AV and EBW ship in v2, repeat the pattern in their DBs.)

### Step 5 — Delete from the platform DB (the FK on `tenant_account_link` cascades automatically)

```sql
USE shhdbite_atlantic_hub;

-- This single DELETE cascades to tenant_account_link via the FK
-- defined in 001_platform.sql (ON DELETE CASCADE).
DELETE FROM accounts
WHERE account_id = 'PASTE_ACCOUNT_ID_HERE';
```

Verify cascade fired:

```sql
SELECT COUNT(*) AS remaining
FROM tenant_account_link
WHERE account_id = 'PASTE_ACCOUNT_ID_HERE';
-- Expect: 0
```

### Step 6 — The audit log stays

`audit_log_global` rows that reference this user contain only hashed IPs and user-agents — **no PII**. They stay for compliance evidence (SOC 2 / SEC examinations / audit trail).

If for some reason an `actor_user_id` foreign-keys to a deleted `admin_users` row (e.g., a former staff member you're also deleting), the audit row's `actor_user_id` will dangle. That's fine — it's append-only and the user_id is just a number.

### Step 7 — Log the deletion (manual entry)

```sql
INSERT INTO audit_log_global (target_resource, action, ip_hash, status_code)
VALUES ('manual:gdpr_deletion', 'gdpr_delete_complete',
        SHA2(CONCAT('manual:', NOW()), 256), 200);
```

### Step 8 — Email the requester

Reply confirming deletion is complete. Keep the email thread for 7 years (statute of limitations on most GDPR claims).

---

## What to do AFTER any of these procedures

1. Add an entry to your daily log: what happened, what you did, when, why.
2. If you rotated any secret: update the Apple Note that tracks current env vars.
3. If you changed a feature flag: confirm it's back to the expected state by running `SELECT flag_name, enabled FROM feature_flags;` and comparing to `schema/003_seed.sql`.
4. Sleep. The system is logged, audited, and self-healing on the next deploy.
