# Atlantic Hub — Smoke Tests

The seven curl tests that gate every deploy. If any fail, the build doesn't ship.

## Running against a deployed preview

After the first push, Netlify will give you a preview URL like `https://atlantic-hub.netlify.app`. Run:

```bash
export BASE_URL="https://atlantic-hub.netlify.app"
export WEBHOOK_SECRET="<paste from Apple Note where you saved Netlify env vars>"
bash tests/smoke.sh
```

## Running against localhost

```bash
export BASE_URL="http://localhost:3000"
# WEBHOOK_SECRET is optional locally; tests #4 will SKIP if missing.
bash tests/smoke.sh
```

## What each test proves

| # | Name | What's being verified |
|---|---|---|
| 1 | no-auth → 401 | Middleware blocks unauthenticated requests to `/api/admin/*` |
| 2 | bad-jwt → 401 | Tampered session cookie is rejected before any handler runs |
| 3 | sqli-login → 400/401 | Zod rejects malformed email; DB never sees the injection string |
| 4 | xss-payload → 200 | Webhook accepts the payload; the React renderer (not the DB) is what escapes it on display |
| 5 | bad-webhook-secret → 401 | Wrong `X-Atlantic-Hub-Webhook-Secret` header is rejected |
| 6 | login rate limit → 429 | 6th login attempt in 15 minutes from same IP is throttled |
| 7 | CORS | Arbitrary origins do not get `Access-Control-Allow-Origin` echoed back |

## What to do if a test fails

1. Don't push to production.
2. Check `audit_log_global` for what your test actually triggered:

   ```sql
   SELECT ts, action, error_class, status_code
   FROM audit_log_global
   ORDER BY ts DESC
   LIMIT 20;
   ```
3. Fix the underlying issue, redeploy preview, re-run.

## Don't forget

After running smoke tests, especially against production, the test data will land in `webhook_events` and `accounts`. To clean up:

```sql
-- Inspect first
SELECT * FROM webhook_events WHERE external_id LIKE 'smoke-test-%';
SELECT a.account_id, a.first_seen_at
FROM accounts a
JOIN tenant_account_link l ON l.account_id = a.account_id
WHERE l.source = 'netlify_form:hh_subscribe'
  AND l.linked_at >= NOW() - INTERVAL 1 HOUR;

-- Then delete cleanly (this cascades to tenant_account_link)
DELETE FROM accounts WHERE account_id IN ('...', '...');
DELETE FROM subscribers WHERE account_id IN ('...', '...');
DELETE FROM webhook_events WHERE external_id LIKE 'smoke-test-%';
```
