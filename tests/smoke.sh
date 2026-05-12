#!/usr/bin/env bash
# =====================================================================
# Atlantic Hub — Smoke Test Suite
# =====================================================================
# The seven curl tests that gate every deploy.
# Each test prints PASS or FAIL with the actual vs expected status.
# Exit code is non-zero if any test failed.
#
# Usage:
#   BASE_URL=https://atlantic-hub.netlify.app \
#   WEBHOOK_SECRET="$(grep NETLIFY_FORMS_WEBHOOK_SECRET .env.local | cut -d= -f2)" \
#   bash tests/smoke.sh
#
# Or for local dev:
#   BASE_URL=http://localhost:3000 bash tests/smoke.sh
#
# IMPORTANT: never paste WEBHOOK_SECRET into a chat. Source it from
# your local .env or read it from Netlify directly. The variable is
# used by tests #4 and #5, which generate a Netlify-shaped JWS
# (X-Webhook-Signature / HS256) to exercise the webhook auth path.
# =====================================================================

set -u

BASE_URL="${BASE_URL:-http://localhost:3000}"
WEBHOOK_SECRET="${WEBHOOK_SECRET:-}"

pass=0
fail=0

red()    { printf "\033[31m%s\033[0m" "$*"; }
green()  { printf "\033[32m%s\033[0m" "$*"; }
yellow() { printf "\033[33m%s\033[0m" "$*"; }

# Generate a compact JWS (HS256) matching the Netlify Forms signing contract.
# Args: $1 = shared secret  $2 = raw request body string
generate_jws() {
  local secret="$1"
  local body="$2"
  JWS_SECRET="$secret" JWS_BODY="$body" node -e "
    const crypto = require('crypto');
    const secret = process.env.JWS_SECRET;
    const body = process.env.JWS_BODY;
    function b64url(buf) {
      return buf.toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
    }
    const sha256 = crypto.createHash('sha256').update(body,'utf8').digest('hex');
    const hdr = b64url(Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})));
    const pld = b64url(Buffer.from(JSON.stringify({iss:'netlify',sha256})));
    const si = hdr+'.'+pld;
    const sig = b64url(crypto.createHmac('sha256',secret).update(si).digest());
    console.log(si+'.'+sig);
  "
}

# Each test: assert the HTTP status matches expectations.
expect_status() {
  local name="$1"
  local expected="$2"
  local actual="$3"
  if [[ "$actual" == "$expected" ]]; then
    echo "  $(green PASS)  $name  ($actual)"
    pass=$((pass + 1))
  else
    echo "  $(red FAIL)  $name  expected=$expected got=$actual"
    fail=$((fail + 1))
  fi
}

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Atlantic Hub smoke tests"
echo "  BASE_URL = $BASE_URL"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# =====================================================================
# Test 1 — Admin API rejects unauthenticated requests
# =====================================================================
echo ""
echo "1. Admin API rejects unauthenticated requests"
status=$(curl -s -o /dev/null -w "%{http_code}" \
  "$BASE_URL/api/admin/hh/subscribers")
expect_status "no-auth → 401" "401" "$status"

# =====================================================================
# Test 2 — Bad JWT in session cookie rejected
# =====================================================================
echo ""
echo "2. Bad JWT in session cookie is rejected"
status=$(curl -s -o /dev/null -w "%{http_code}" \
  -H "Cookie: ah_session=this.is.garbage" \
  "$BASE_URL/api/admin/hh/subscribers")
expect_status "bad-jwt → 401" "401" "$status"

# =====================================================================
# Test 3 — SQL injection in login email rejected by Zod (400, not DB hit)
# =====================================================================
echo ""
echo "3. SQL-injection-shaped login email rejected before DB"
status=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST "$BASE_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"x'\'' OR 1=1 --","password":"x"}')
# Zod email validation fails → 400. Acceptable: 400 or 401 (both block the attack).
if [[ "$status" == "400" || "$status" == "401" ]]; then
  echo "  $(green PASS)  sqli-login → 400/401  ($status)"
  pass=$((pass + 1))
else
  echo "  $(red FAIL)  sqli-login expected=400|401 got=$status"
  fail=$((fail + 1))
fi

# =====================================================================
# Test 4 — XSS-shaped webhook payload accepted with correct secret,
#          stored as escaped data (we just verify the 200 here; the
#          DataTable component HTML-encodes on render)
# =====================================================================
echo ""
echo "4. XSS-shaped webhook payload stored safely (valid JWS)"
if [[ -z "$WEBHOOK_SECRET" ]]; then
  echo "  $(yellow SKIP)  WEBHOOK_SECRET env var not set; skipping"
else
  ts=$(date +%s)
  body='{"id":"smoke-test-xss-'"$ts"'","form_name":"hh_subscribe","data":{"email":"xss-smoke+'"$ts"'@example.com","name":"<script>alert(1)</script>"}}'
  jws=$(generate_jws "$WEBHOOK_SECRET" "$body")
  status=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST "$BASE_URL/api/webhooks/netlify-forms" \
    -H "Content-Type: application/json" \
    -H "X-Webhook-Signature: $jws" \
    --data-raw "$body")
  expect_status "xss-payload-valid-jws → 200" "200" "$status"
fi

# =====================================================================
# Test 5 — Webhook with WRONG secret is rejected
# =====================================================================
echo ""
echo "5. Tampered JWS is rejected"
if [[ -z "$WEBHOOK_SECRET" ]]; then
  echo "  $(yellow SKIP)  WEBHOOK_SECRET env var not set; skipping"
else
  body='{"id":"smoke-tamper-test","form_name":"hh_subscribe","data":{"email":"tamper@example.com"}}'
  jws=$(generate_jws "$WEBHOOK_SECRET" "$body")
  # Overwrite last 4 chars of the signature segment — must trigger 401.
  tampered="${jws:0:${#jws}-4}XXXX"
  status=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST "$BASE_URL/api/webhooks/netlify-forms" \
    -H "Content-Type: application/json" \
    -H "X-Webhook-Signature: $tampered" \
    --data-raw "$body")
  expect_status "tampered-jws → 401" "401" "$status"
fi

# =====================================================================
# Test 6 — Login rate-limit kicks in after 5 attempts in 15 minutes
# =====================================================================
echo ""
echo "6. Login rate limit returns 429 after 5 failures"
echo "  (sending 6 rapid login attempts with bad credentials…)"
codes=()
for i in 1 2 3 4 5 6; do
  s=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST "$BASE_URL/api/auth/login" \
    -H "Content-Type: application/json" \
    -d '{"email":"ratelimit-smoke@example.com","password":"wrong-password-123"}')
  codes+=("$s")
done
last="${codes[5]}"
if [[ "$last" == "429" ]]; then
  echo "  $(green PASS)  6th attempt → 429  (sequence: ${codes[*]})"
  pass=$((pass + 1))
else
  echo "  $(red FAIL)  6th attempt expected=429 got=$last  (sequence: ${codes[*]})"
  fail=$((fail + 1))
fi

# =====================================================================
# Test 7 — CORS: no Access-Control-Allow-Origin for arbitrary origins
# =====================================================================
echo ""
echo "7. CORS does not echo arbitrary Origin headers"
allow_origin=$(curl -s -i -X OPTIONS "$BASE_URL/api/admin/hh/subscribers" \
  -H "Origin: https://evil.example.com" \
  -H "Access-Control-Request-Method: GET" \
  | grep -i '^access-control-allow-origin:' | tr -d '\r' || true)
if [[ -z "$allow_origin" ]]; then
  echo "  $(green PASS)  no Access-Control-Allow-Origin for evil.example.com"
  pass=$((pass + 1))
elif echo "$allow_origin" | grep -qi 'evil.example.com'; then
  echo "  $(red FAIL)  echoed back evil.example.com: $allow_origin"
  fail=$((fail + 1))
else
  echo "  $(green PASS)  ACAO present but not for evil.example.com: $allow_origin"
  pass=$((pass + 1))
fi

# =====================================================================
# Summary
# =====================================================================
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
total=$((pass + fail))
if [[ $fail -eq 0 ]]; then
  echo "  $(green "ALL TESTS PASSED")  ($pass / $total)"
  exit 0
else
  echo "  $(red "TESTS FAILED")  ($fail of $total)"
  exit 1
fi
