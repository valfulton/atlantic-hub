# Claude Code Session: Client Portal Smoke Test

**Purpose:** Drop this entire file into a fresh Claude Code session. It is
self-contained -- no prior context needed. Goal is to verify that the
Client Portal that just shipped to `atlantic-hub.netlify.app/client/*`
works end-to-end, and to surface any errors clearly without trying to fix
them.

**Owner:** Atlantic And Vine LLC. Operator: Val Fulton.
**Ground rules:** ASCII-only in shell. No smart quotes, no em-dashes.
Read-only mindset -- you are testing, NOT fixing. If something fails,
REPORT the failure with file path, line, and observed-vs-expected. Do
NOT modify code, do NOT modify the database beyond the explicitly
called-out test insert + cleanup at the end.

---

## CONTEXT YOU NEED

Atlantic Hub is a Next.js 14 App Router app deployed on Netlify at
`https://atlantic-hub.netlify.app`. Source lives at
`$HOME/Library/CloudStorage/OneDrive-atlanticandvine.com/HunterHoney/_organized/atlantic-hub`.
Database is HostGator MariaDB; the relevant DB is `shhdbite_AV`, table
`client_users`.

What just shipped (today, 2026-05-17):

- New schema migration `schema/009_client_portal.sql` creating
  `client_users` table.
- Follow-up migration `schema/015_tier_rename.sql` aligning the tier
  ENUM with the Stripe-canonical names (`audit_only`, `sprint`,
  `momentum`, `scale`).
- New auth helpers under `lib/auth/client-*.ts` (cookie name
  `ah_client_session`, separate from operator `ah_session`).
- Six new public + protected API routes under `/api/client/*`:
  `intake`, `magic-link/[token]`, `login`, `logout`, `me`,
  `set-password`.
- Four new pages under `/client/*`: `login`, `set-password`,
  `dashboard`, `audit`.
- Middleware updated to gate protected client paths with the new
  cookie.
- Marketing-site form (`atlanticandvine.netlify.app/client-intake`)
  repointed from the HostGator PHP relay to the hub's
  `/api/client/intake` directly. CORS allowlist on the hub side.

Pre-conditions Val has already done:
- `npm run build` exit 0 locally.
- `schema/009_client_portal.sql` and `schema/015_tier_rename.sql`
  both run cleanly in phpMyAdmin. `client_users` exists. The `tier`
  column shows `enum('audit_only','sprint','momentum','scale')`,
  default `audit_only`.
- Code pushed to GitHub. Netlify rebuilt.

---

## TESTS TO RUN (in order)

For each test below: run the command(s), capture the result, mark PASS
or FAIL with one short observation. Use the exact commands provided so
the reporting is consistent. Do not invent test data beyond what's
specified.

### Test 1 -- Netlify deploy succeeded

```bash
# If netlify CLI is logged in
netlify api listSiteDeploys --data '{"site_id":"<atlantic-hub-site-id>"}' \
  2>/dev/null | head -50 \
  || echo "netlify CLI not available -- check the deploy log manually at app.netlify.com"
```

PASS if the most recent deploy shows `state=ready`. FAIL with the
build-error excerpt if it shows `state=error`.

### Test 2 -- Public login page renders

```bash
curl -sS -o /tmp/portal-login.html -w "HTTP %{http_code}\nLEN %{size_download}\n" \
  https://atlantic-hub.netlify.app/client/login
grep -c 'Atlantic' /tmp/portal-login.html
grep -c 'name="email"\|type="email"' /tmp/portal-login.html
```

PASS criteria:
- HTTP 200
- LEN > 1000
- Body contains the word "Atlantic"
- Body contains an email input

### Test 3 -- Protected dashboard redirects unauthed users

```bash
curl -sS -o /dev/null -w "HTTP %{http_code}\nLOCATION %{redirect_url}\n" \
  https://atlantic-hub.netlify.app/client/dashboard
```

PASS criteria:
- HTTP 302, 307, or 308
- Redirect URL contains `/client/login`

### Test 4 -- Protected API returns 401 unauthed

```bash
curl -sS -o /tmp/me.json -w "HTTP %{http_code}\n" \
  https://atlantic-hub.netlify.app/api/client/me
cat /tmp/me.json
```

PASS if HTTP 401 and body is `{"error":"unauthorized"}`.

### Test 5 -- CORS preflight on intake

```bash
curl -sS -X OPTIONS \
  -H "Origin: https://atlanticandvine.netlify.app" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: Content-Type" \
  -o /dev/null -w "HTTP %{http_code}\n" -D /tmp/cors-headers.txt \
  https://atlantic-hub.netlify.app/api/client/intake
grep -i 'access-control' /tmp/cors-headers.txt
```

PASS if HTTP 204 and response headers include
`Access-Control-Allow-Origin: https://atlanticandvine.netlify.app`.

### Test 6 -- Bad-origin CORS is rejected

```bash
curl -sS -X OPTIONS \
  -H "Origin: https://evil.example.com" \
  -H "Access-Control-Request-Method: POST" \
  -o /dev/null -w "HTTP %{http_code}\n" -D /tmp/cors-bad.txt \
  https://atlantic-hub.netlify.app/api/client/intake
grep -i 'access-control-allow-origin' /tmp/cors-bad.txt || \
  echo "no ACAO header (correct)"
```

PASS if no `Access-Control-Allow-Origin` is echoed back, OR if the
echoed origin is something on the allowlist (the implementation may
fall back to the first allowed origin -- either way is acceptable AS
LONG AS it is NOT `https://evil.example.com`).

### Test 7 -- Intake creates a row

This is the only test that writes data. Pick a throwaway email like
`smoketest+<unix-timestamp>@example.com` so cleanup is unambiguous.

```bash
SMOKE_EMAIL="smoketest+$(date +%s)@example.com"
echo "Test email: $SMOKE_EMAIL"
curl -sS -X POST \
  -H "Origin: https://atlanticandvine.netlify.app" \
  -H "Content-Type: application/json" \
  -o /tmp/intake-resp.json -w "HTTP %{http_code}\n" \
  -d "{\"email\":\"$SMOKE_EMAIL\",\"name\":\"Smoke Test\",\"company\":\"SmokeCo\",\"message\":\"smoke test from claude code\"}" \
  https://atlantic-hub.netlify.app/api/client/intake
cat /tmp/intake-resp.json
echo "$SMOKE_EMAIL" > /tmp/smoke-email.txt
```

PASS if HTTP 200 and body is `{"ok":true,...}` (a message field is
also acceptable).

### Test 8 -- Rate limit kicks in

```bash
for i in 1 2 3 4 5 6 7; do
  curl -sS -X POST \
    -H "Origin: https://atlanticandvine.netlify.app" \
    -H "Content-Type: application/json" \
    -o /dev/null -w "Attempt $i: HTTP %{http_code}\n" \
    -d '{"email":"ratelimit-test@example.com"}' \
    https://atlantic-hub.netlify.app/api/client/intake
done
```

PASS if at least one of the 7 attempts returns HTTP 429. (The limit is
5 per 15 minutes per IP.)

### Test 9 -- Row landed in DB with magic token

Hand this SQL block back to Val to run in phpMyAdmin (SQL tab,
`shhdbite_AV`). Do NOT attempt to run SQL yourself unless mysql CLI is
configured locally with credentials.

```sql
SELECT client_user_id, email, display_name, tier,
       LEFT(magic_token, 12) AS token_prefix,
       magic_token_expires_at,
       email_verified_at, last_login_at, created_at
FROM client_users
WHERE email LIKE 'smoketest+%@example.com'
ORDER BY created_at DESC
LIMIT 5;
```

PASS criteria:
- One row exists with the email from Test 7
- `tier` is `audit_only`
- `magic_token` is set (token_prefix is 12 hex chars)
- `magic_token_expires_at` is ~24 hours in the future
- `email_verified_at` is NULL
- `last_login_at` is NULL

### Test 10 -- Magic link URL is in Netlify function logs

Search the most recent Netlify function logs for the marker string.
Either via netlify CLI or by visiting
`https://app.netlify.com/sites/atlantic-hub/logs/functions` in the
browser.

```bash
netlify functions:log --site atlantic-hub --limit 200 2>/dev/null \
  | grep -A 1 '\[client-portal:intake\]' \
  || echo "netlify CLI not configured -- check function logs manually"
```

PASS if there is a recent log line beginning with
`[client-portal:intake]` containing the smoke email and a
`magic_link` URL of shape
`https://atlantic-hub.netlify.app/api/client/magic-link/<64-hex>`.

Capture the URL into `/tmp/smoke-magic-link.txt` for the next test.

### Test 11 -- Magic link consumption sets cookie + redirects

Replace `<MAGIC_LINK>` with the URL from Test 10.

```bash
MAGIC_LINK="<MAGIC_LINK>"
curl -sS -c /tmp/smoke-cookies.txt -o /dev/null \
  -w "HTTP %{http_code}\nLOCATION %{redirect_url}\n" \
  "$MAGIC_LINK"
echo "---"
grep ah_client_session /tmp/smoke-cookies.txt
```

PASS criteria:
- HTTP 302/307/308
- Location includes `/client/set-password` (first-time user)
- A cookie named `ah_client_session` is present, marked HttpOnly

### Test 12 -- Replaying the magic link fails (single-use)

```bash
curl -sS -o /dev/null -w "HTTP %{http_code}\nLOCATION %{redirect_url}\n" \
  "$MAGIC_LINK"
```

PASS if HTTP 302 and Location includes `/client/login?error=`
(the token has been consumed).

### Test 13 -- Authenticated /me works with the cookie

```bash
curl -sS -b /tmp/smoke-cookies.txt \
  -o /tmp/me-authed.json -w "HTTP %{http_code}\n" \
  https://atlantic-hub.netlify.app/api/client/me
cat /tmp/me-authed.json | head -200
```

PASS criteria:
- HTTP 200
- JSON body contains `"ok":true`
- `user.email` matches the smoke email
- `user.tier` is `"audit_only"`
- `user.password_set` is `false`
- `tier_features.included` is a non-empty array
- `tier_features.locked` is a non-empty array

### Test 14 -- Set password endpoint

```bash
curl -sS -b /tmp/smoke-cookies.txt -X POST \
  -H "Content-Type: application/json" \
  -o /tmp/setpw.json -w "HTTP %{http_code}\n" \
  -d '{"password":"smoke-test-pw-1234"}' \
  https://atlantic-hub.netlify.app/api/client/set-password
cat /tmp/setpw.json
```

PASS if HTTP 200 and body is `{"ok":true}`. FAIL the test (do NOT
retry) if any other status -- just report.

### Test 15 -- Re-login with the password

```bash
SMOKE_EMAIL=$(cat /tmp/smoke-email.txt)
curl -sS -c /tmp/smoke-cookies2.txt -X POST \
  -H "Content-Type: application/json" \
  -o /tmp/login.json -w "HTTP %{http_code}\n" \
  -d "{\"email\":\"$SMOKE_EMAIL\",\"password\":\"smoke-test-pw-1234\"}" \
  https://atlantic-hub.netlify.app/api/client/login
cat /tmp/login.json
grep ah_client_session /tmp/smoke-cookies2.txt
```

PASS criteria:
- HTTP 200, body `{"ok":true}`
- Fresh `ah_client_session` cookie set in cookie jar

### Test 16 -- Wrong password is rejected (no user-existence leak)

```bash
curl -sS -X POST \
  -H "Content-Type: application/json" \
  -o /tmp/badpw.json -w "HTTP %{http_code}\n" \
  -d "{\"email\":\"$SMOKE_EMAIL\",\"password\":\"definitely-wrong\"}" \
  https://atlantic-hub.netlify.app/api/client/login
cat /tmp/badpw.json
echo "---"
curl -sS -X POST \
  -H "Content-Type: application/json" \
  -o /tmp/nouser.json -w "HTTP %{http_code}\n" \
  -d '{"email":"definitely-not-a-user@example.com","password":"x"}' \
  https://atlantic-hub.netlify.app/api/client/login
cat /tmp/nouser.json
```

PASS if both return HTTP 401 with the identical error message
(generic `"invalid credentials"` or similar). A different message for
"bad password" vs "no such user" is a FAIL (user-existence leak).

### Test 17 -- Dashboard page renders authed

```bash
curl -sS -b /tmp/smoke-cookies2.txt \
  -o /tmp/dashboard.html -w "HTTP %{http_code}\n" \
  https://atlantic-hub.netlify.app/client/dashboard
grep -c 'Welcome back' /tmp/dashboard.html
grep -c 'Strategic Marketing Audit\|audit' /tmp/dashboard.html
```

PASS if HTTP 200 and the dashboard body contains "Welcome back" and
a reference to the audit.

### Test 18 -- Logout clears cookie

```bash
curl -sS -b /tmp/smoke-cookies2.txt -c /tmp/smoke-cookies3.txt -X POST \
  -o /tmp/logout.json -w "HTTP %{http_code}\n" \
  https://atlantic-hub.netlify.app/api/client/logout
cat /tmp/logout.json
echo "---"
# After logout, dashboard should bounce to login again
curl -sS -b /tmp/smoke-cookies3.txt -o /dev/null \
  -w "HTTP %{http_code}\nLOCATION %{redirect_url}\n" \
  https://atlantic-hub.netlify.app/client/dashboard
```

PASS if logout returns HTTP 200 and the subsequent dashboard request
returns a 3xx redirecting to `/client/login`.

### Test 19 -- Marketing form posts to the right endpoint

```bash
curl -sS https://atlanticandvine.netlify.app/client-intake \
  | grep -i 'atlantic-hub.netlify.app/api/client/intake\|/process-intake' \
  | head -5
```

PASS if the result includes the line referencing
`atlantic-hub.netlify.app/api/client/intake`. FAIL if it still
references the legacy `AV_API.url + '/process-intake'`.

### Test 20 -- Cleanup the test rows

Hand this SQL back to Val (or run if you have DB creds):

```sql
DELETE FROM client_users
WHERE email LIKE 'smoketest+%@example.com'
   OR email = 'ratelimit-test@example.com';
SELECT COUNT(*) FROM client_users WHERE email LIKE 'smoketest+%';
```

PASS if the SELECT returns 0.

---

## REPORTING

After all tests, output a single block in this exact shape:

```
SMOKE TEST RESULTS -- Client Portal -- <ISO timestamp>

PASS: <count>/20
FAIL: <count>/20

PER-TEST:
  Test 1  Netlify deploy:           [PASS / FAIL: <one-line reason>]
  Test 2  Login page renders:       [...]
  Test 3  Dashboard redirect:       [...]
  Test 4  /me 401 unauthed:         [...]
  Test 5  CORS preflight allow:     [...]
  Test 6  CORS reject bad origin:   [...]
  Test 7  Intake creates row:       [...]
  Test 8  Rate limit triggers:      [...]
  Test 9  Row in DB:                [PASS / FAIL / DEFERRED-TO-VAL]
  Test 10 Magic link in logs:       [PASS / FAIL / DEFERRED-TO-VAL]
  Test 11 Magic link sets cookie:   [...]
  Test 12 Magic link single-use:    [...]
  Test 13 Authed /me works:         [...]
  Test 14 Set password:             [...]
  Test 15 Re-login with password:   [...]
  Test 16 Bad password rejected:    [...]
  Test 17 Dashboard renders authed: [...]
  Test 18 Logout clears cookie:     [...]
  Test 19 Marketing form repointed: [...]
  Test 20 Cleanup:                  [PASS / FAIL / DEFERRED-TO-VAL]

BLOCKERS (anything that stops a real user from completing the flow):
  - <list, or "none">

NON-BLOCKERS (suggestions, polish items):
  - <list, or "none">
```

---

## WHAT YOU SHOULD NOT DO

- Do not modify ANY source file, schema file, or migration file.
- Do not run any DDL (ALTER, DROP, CREATE) on the database.
- Do not push to git.
- Do not change Netlify env vars.
- Do not try to "fix" anything that fails. Report and stop.
- Do not invent additional tests. Run these 20, in order, and report.
- Do not retry failed tests automatically more than once.

If the magic link cannot be retrieved (Test 10 deferred), tests 11-18
are also DEFERRED-TO-VAL. Report what you observed up to that point
and STOP.

When you finish, hand Val a clean summary in the format above. That's
it.
