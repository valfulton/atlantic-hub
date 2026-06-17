#!/usr/bin/env node
/**
 * audit_client_nav.mjs  (val 2026-06-17, #697 — nav-orphan guard)
 *
 * Fails the build when a client page.tsx ships without a NAV_ITEMS entry
 * AND without an explicit allowlist reason. The drift this stops:
 *
 *   - I create app/client/<route>/page.tsx for a new surface
 *   - I forget to add it to NAV_ITEMS in client_nav_items.ts
 *   - The page deploys, val can navigate to it only by typing the URL
 *   - She asks "why is there no nav here?" — this audit catches it BEFORE
 *     the page reaches her
 *
 * Run via:        npm run nav:audit
 * Wired into:     prebuild  (next build fails if orphans are detected)
 *
 * Adding a page:  add it to NAV_ITEMS in app/client/_components/
 *                 client_nav_items.ts  — done, audit passes.
 *
 * Page that ISNT meant for top-nav (auth, set-password, intake-by-magic-
 * link, etc.): add it to UTILITY_ROUTES below with a one-line reason. The
 * audit then knows it's intentional, not forgotten.
 */
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..');
const CLIENT_ROOT = join(REPO_ROOT, 'app', 'client');
const NAV_FILE = join(REPO_ROOT, 'app', 'client', '_components', 'client_nav_items.ts');

/**
 * Routes that DELIBERATELY don't appear in the client top nav. Each entry
 * MUST carry a reason so the next person (or me, next session) can tell
 * whether it should still be hidden.
 */
const UTILITY_ROUTES = {
  '/client/login':
    'auth surface — pre-login, no nav chrome by design',
  '/client/set-password':
    'auth surface — landed via emailed link, no nav chrome',
  '/client/intake':
    'operator-only intake editor; public intake flow runs on a tokenized magic link',
  '/client/apply':
    'IC application landing — reachable from the "Earn with A&V" card on the dashboard',
  '/client/audit':
    'client-facing lead-audit form — reached from a lead detail, not a top-nav room',
  '/client/social/review':
    'subroute of /client/content; reached from a draft card, not a top-nav peer'
};

function listClientRoutes() {
  const out = [];
  const entries = readdirSync(CLIENT_ROOT, { withFileTypes: true });
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (e.name.startsWith('_')) continue;
    if (e.name.startsWith('[')) continue;
    walk(join(CLIENT_ROOT, e.name), `/client/${e.name}`);
  }
  return out;

  function walk(dir, urlPrefix) {
    let hasPage = false;
    let children = [];
    try { children = readdirSync(dir); } catch { return; }
    for (const c of children) {
      const full = join(dir, c);
      if (c === 'page.tsx' || c === 'page.ts' || c === 'page.jsx') {
        hasPage = true;
      } else if (statSync(full).isDirectory()) {
        if (!c.startsWith('[') && !c.startsWith('_')) {
          walk(full, `${urlPrefix}/${c}`);
        }
      }
    }
    if (hasPage) out.push(urlPrefix);
  }
}

function extractNavHrefs() {
  const src = readFileSync(NAV_FILE, 'utf8');
  const hrefs = new Set();
  const re = /href:\s*['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(src))) hrefs.add(m[1]);
  return Array.from(hrefs);
}

function main() {
  const routes = listClientRoutes();
  const navHrefs = new Set(extractNavHrefs());
  const utilityRoutes = new Set(Object.keys(UTILITY_ROUTES));

  const orphans = [];
  for (const route of routes) {
    if (navHrefs.has(route)) continue;
    if (utilityRoutes.has(route)) continue;
    orphans.push(route);
  }

  const danglingNav = [];
  for (const href of navHrefs) {
    if (!href.startsWith('/client/')) continue;
    if (!routes.includes(href)) danglingNav.push(href);
  }

  const lines = [];
  lines.push('[nav:audit] client routes scanned: ' + routes.length);
  lines.push('[nav:audit] NAV_ITEMS hrefs:      ' + navHrefs.size);
  lines.push('[nav:audit] utility allowlist:    ' + utilityRoutes.size);

  if (orphans.length) {
    lines.push('');
    lines.push('[nav:audit] X ORPHAN ROUTES (page exists, no nav entry, no utility reason):');
    for (const r of orphans) lines.push('  - ' + r);
    lines.push('');
    lines.push('Fix:');
    lines.push('  - add it to NAV_ITEMS in app/client/_components/client_nav_items.ts');
    lines.push('  - OR add it to UTILITY_ROUTES in scripts/audit_client_nav.mjs with a one-line reason');
  }

  if (danglingNav.length) {
    lines.push('');
    lines.push('[nav:audit] X NAV ENTRIES POINT NOWHERE (href has no matching page.tsx):');
    for (const r of danglingNav) lines.push('  - ' + r);
  }

  console.log(lines.join('\n'));

  if (orphans.length || danglingNav.length) process.exit(1);
  console.log('[nav:audit] OK — all client routes accounted for');
}

main();
