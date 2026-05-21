#!/usr/bin/env node
/**
 * scripts/smoke-intake.mjs
 *
 * End-to-end smoke test for the public client-intake flow, run against the
 * LIVE hub. No dependencies -- uses Node 18+ built-in fetch.
 *
 *   node scripts/smoke-intake.mjs
 *   SMOKE_TEST_SECRET=xxxx node scripts/smoke-intake.mjs        (also checks email)
 *
 * What it checks:
 *   1. CORS preflight (OPTIONS) from the marketing-site origin is allowed.
 *      A FAIL here means PORTAL_ALLOWED_ORIGINS on the hub is wrong.
 *   2. POST /api/client/intake returns 200 + {ok:true}. This is the path that
 *      creates the client_users row, issues the magic-link token, and triggers
 *      the SMTP send.
 *   3. Email send status -- ONLY when SMOKE_TEST_SECRET is set here and matches
 *      the SMOKE_TEST_SECRET env var on the hub. The hub then echoes back the
 *      real { emailSent, emailReason, messageId } so you do not have to read
 *      the function logs.
 *
 * A PASS on step 2 creates ONE clearly-labeled test lead in shhdbite_AV
 * (source: "smoke-test") -- safe to delete.
 *
 * Overrides (optional env vars):
 *   HUB_URL            default https://atlantic-hub.netlify.app
 *   TEST_ORIGIN        default https://atlanticandvine.netlify.app
 *   TEST_EMAIL         default smoke-test+<timestamp>@atlanticandvine.com
 *                      Tip: set to val@atlanticandvine.com to also receive the
 *                      real email in your own inbox.
 *   SMOKE_TEST_SECRET  must match the hub env var to enable the email check.
 */

const HUB = process.env.HUB_URL || 'https://atlantic-hub.netlify.app';
const ORIGIN = process.env.TEST_ORIGIN || 'https://atlanticandvine.netlify.app';
const TEST_EMAIL = process.env.TEST_EMAIL || `smoke-test+${Date.now()}@atlanticandvine.com`;
const SMOKE_SECRET = process.env.SMOKE_TEST_SECRET || '';
const ENDPOINT = `${HUB}/api/client/intake`;

let failures = 0;
const line = () => console.log('-'.repeat(64));

async function preflight() {
  console.log(`1) CORS preflight   OPTIONS ${ENDPOINT}`);
  console.log(`   Origin: ${ORIGIN}`);
  const res = await fetch(ENDPOINT, {
    method: 'OPTIONS',
    headers: {
      Origin: ORIGIN,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type'
    }
  });
  const allow = res.headers.get('access-control-allow-origin');
  console.log(`   status: ${res.status}   allow-origin: ${allow ?? '(none)'}`);
  if (allow === ORIGIN || allow === '*') {
    console.log('   PASS - origin is allowed by the hub');
  } else {
    console.log(`   FAIL - hub did not allow ${ORIGIN}. Fix PORTAL_ALLOWED_ORIGINS + redeploy.`);
    failures++;
  }
}

async function submit() {
  console.log(`2) Submit intake    POST ${ENDPOINT}`);
  console.log(`   email: ${TEST_EMAIL}`);
  const headers = { 'Content-Type': 'application/json', Origin: ORIGIN };
  if (SMOKE_SECRET) headers['X-Smoke-Test'] = SMOKE_SECRET;
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      email: TEST_EMAIL,
      name: 'Smoke Test',
      company: 'Smoke Test Co',
      message: 'Automated smoke test - safe to delete this lead.',
      source: 'smoke-test'
    })
  });
  let json = {};
  try { json = await res.json(); } catch { /* non-JSON body */ }
  console.log(`   status: ${res.status}   body: ${JSON.stringify(json)}`);
  if (res.status === 200 && json.ok === true) {
    console.log('   PASS - intake accepted (lead created + magic link issued)');
  } else {
    console.log('   FAIL - intake did not return ok:true');
    failures++;
    return;
  }

  // Step 3 - email status (requires the shared secret).
  console.log('');
  console.log('3) Email send status');
  if (!SMOKE_SECRET) {
    console.log('   SKIP - set SMOKE_TEST_SECRET (matching the hub env) to check email here.');
    return;
  }
  const smoke = json._smoke;
  if (!smoke) {
    console.log('   FAIL - hub did not echo _smoke. Either SMOKE_TEST_SECRET is not set');
    console.log('          + deployed on the hub, or it does not match the value used here.');
    failures++;
    return;
  }
  console.log(`   emailSent: ${smoke.emailSent}   reason: ${smoke.emailReason ?? '(none)'}   messageId: ${smoke.messageId ?? '(none)'}`);
  if (smoke.emailSent === true) {
    console.log('   PASS - the server sent the email.');
  } else {
    console.log('   FAIL - email did NOT send. The reason above is the exact cause.');
    failures++;
  }
}

(async () => {
  line();
  console.log('CLIENT INTAKE SMOKE TEST');
  console.log(`hub: ${HUB}`);
  console.log(`email check: ${SMOKE_SECRET ? 'ON' : 'OFF (set SMOKE_TEST_SECRET to enable)'}`);
  line();
  try {
    await preflight();
    line();
    await submit();
    line();
  } catch (err) {
    console.log(`ERROR: ${err.message}`);
    failures++;
  }
  if (failures === 0) {
    console.log('RESULT: PASS');
    if (!SMOKE_SECRET) {
      console.log('(Email not verified - run with SMOKE_TEST_SECRET to check delivery.)');
    }
  } else {
    console.log(`RESULT: FAIL - ${failures} check(s) failed (see above).`);
    process.exit(1);
  }
})();
