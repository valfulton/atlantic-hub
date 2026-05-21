#!/usr/bin/env node
/**
 * scripts/smoke-intake.mjs
 *
 * End-to-end smoke test for the public client-intake flow, run against the
 * LIVE hub. No dependencies -- uses Node 18+ built-in fetch.
 *
 *   node scripts/smoke-intake.mjs
 *
 * What it checks:
 *   1. CORS preflight (OPTIONS) from the marketing-site origin is allowed.
 *      A FAIL here means PORTAL_ALLOWED_ORIGINS on the hub is wrong.
 *   2. POST /api/client/intake returns 200 + {ok:true}. This is the path that
 *      creates the client_users row, issues the magic-link token, and triggers
 *      the SMTP send.
 *
 * What it CANNOT check: whether the email actually landed (no inbox access).
 * After a PASS, confirm email one of two ways:
 *   - set TEST_EMAIL to a real inbox you can read (see below) and check it, or
 *   - read the Netlify function log line [client-portal:magic-link] and look
 *     for "emailSent":true.
 *
 * A PASS creates ONE clearly-labeled test lead in shhdbite_AV (source:
 * "smoke-test") -- safe to delete.
 *
 * Overrides (optional env vars):
 *   HUB_URL      default https://atlantic-hub.netlify.app
 *   TEST_ORIGIN  default https://atlanticandvine.netlify.app
 *   TEST_EMAIL   default smoke-test+<timestamp>@atlanticandvine.com
 *                Tip: set this to val@atlanticandvine.com to get the real
 *                email in your own inbox as the definitive delivery check.
 */

const HUB = process.env.HUB_URL || 'https://atlantic-hub.netlify.app';
const ORIGIN = process.env.TEST_ORIGIN || 'https://atlanticandvine.netlify.app';
const TEST_EMAIL = process.env.TEST_EMAIL || `smoke-test+${Date.now()}@atlanticandvine.com`;
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
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
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
    console.log('   PASS - intake accepted (lead created + magic link issued + email triggered)');
  } else {
    console.log('   FAIL - intake did not return ok:true');
    failures++;
  }
}

(async () => {
  line();
  console.log('CLIENT INTAKE SMOKE TEST');
  console.log(`hub: ${HUB}`);
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
    console.log('RESULT: PASS - the form path works end to end.');
    console.log('Email delivery is not checked here. Confirm it by reading the');
    console.log('inbox of the test address above, or the Netlify function log');
    console.log('line [client-portal:magic-link] for "emailSent":true.');
  } else {
    console.log(`RESULT: FAIL - ${failures} check(s) failed (see above).`);
    process.exit(1);
  }
})();
