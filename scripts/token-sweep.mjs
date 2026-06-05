#!/usr/bin/env node
/* ====================================================================
   token-sweep.mjs  —  literal → token codemod (UX/UI unification)
   --------------------------------------------------------------------
   Routes the two big remaining color/font literals through the canonical
   tokens added to app/_styles/brand-tokens.css:
     1. #EBCB6B  (logo gold, ~524 occurrences) -> var(--gold-bright)
     2. 'Cormorant Garamond' font literals      -> var(--serif)  (Fraunces)

   WHY A SCRIPT, NOT A HAND-EDIT: a naive find/replace of #EBCB6B breaks
   ~197 Tailwind opacity utilities (`text-[#EBCB6B]/35`) because an alpha
   modifier can't apply to a var(). This codemod handles each syntactic
   form correctly and leaves token DEFINITIONS untouched.

   USAGE (run from repo root):
     node scripts/token-sweep.mjs            # DRY RUN — prints a report, writes nothing
     node scripts/token-sweep.mjs --apply    # writes changes
     node scripts/token-sweep.mjs --apply --only=client   # limit to app/client/**
   After --apply: `npm run build` (val), eyeball the demo-path pages, then push.

   SAFE BY DESIGN:
     - Skips token-definition files (brand-tokens.css, globals.css, demo/demo.css)
       and any line that DEFINES a token (`--name: #EBCB6B`).
     - Skips the functional-ugly operator tools per the brief
       (selftest, prompts, intel-freshness) unless --include-ugly.
   ==================================================================== */

import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const APPLY = process.argv.includes('--apply');
const INCLUDE_UGLY = process.argv.includes('--include-ugly');
const ONLY = (process.argv.find(a => a.startsWith('--only=')) || '').split('=')[1] || '';

const GOLD = '235,203,107'; // #EBCB6B as rgb, for color-mix/rgba fallbacks

// Files whose #EBCB6B is a DEFINITION, not a usage — never touch.
const DEFN_FILES = ['app/_styles/brand-tokens.css', 'app/globals.css', 'app/demo/demo.css'];
// Operator tools val wants left functional-ugly (brief: do NOT prettify).
const UGLY = ['app/admin/av/selftest/', 'app/admin/av/prompts/', 'app/admin/av/intel-freshness/'];

const EXT = /\.(tsx?|css)$/;
const SKIP_DIRS = new Set(['node_modules', '.next', '.git', 'public', 'schema', 'docs', 'tests']);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, out);
    else if (EXT.test(name)) out.push(p);
  }
  return out;
}

function classify(rel) {
  if (DEFN_FILES.includes(rel)) return 'definition-file (skip)';
  if (!INCLUDE_UGLY && UGLY.some(u => rel.startsWith(u))) return 'operator-ugly (skip)';
  if (ONLY && !rel.startsWith(`app/${ONLY}`)) return 'out-of-scope (skip)';
  return 'eligible';
}

const stats = {
  filesChanged: 0,
  twOpacity: 0,   // text-[#EBCB6B]/35  -> color-mix (alpha-preserving)
  twBare: 0,      // text-[#EBCB6B]     -> var(--gold-bright)
  strHex: 0,      // '#EBCB6B' / "#EBCB6B" / : #EBCB6B  -> var(--gold-bright)
  cormorant: 0,   // 'Cormorant Garamond'... -> var(--serif)
  skipped: {},
};

function sweep(src, rel) {
  let s = src;

  // 1. Tailwind arbitrary WITH opacity:  -[#EBCB6B]/NN  ->  color-mix (keeps the alpha, tokenized)
  s = s.replace(/\[#EBCB6B\]\/(\d{1,3})/gi, (_m, pct) => {
    stats.twOpacity++;
    return `[color-mix(in_srgb,var(--gold-bright)_${pct}%,transparent)]`;
  });

  // 2. Tailwind arbitrary WITHOUT opacity:  -[#EBCB6B]  ->  -[var(--gold-bright)]
  s = s.replace(/\[#EBCB6B\]/gi, () => { stats.twBare++; return '[var(--gold-bright)]'; });

  // 3. Inline-style / JS string / CSS property value, but NOT a token definition line.
  s = s.split('\n').map(line => {
    if (/--[\w-]+\s*:\s*#EBCB6B/i.test(line)) return line; // definition — leave it
    return line.replace(/(['"]?)#EBCB6B\1/gi, (m) => {
      stats.strHex++;
      // preserve surrounding quotes if present
      return m.startsWith("'") ? "'var(--gold-bright)'"
           : m.startsWith('"') ? '"var(--gold-bright)"'
           : 'var(--gold-bright)';
    });
  }).join('\n');

  // 4. Cormorant Garamond font literals -> var(--serif).  Handles the common stacks.
  s = s.replace(/'Cormorant Garamond'(?:\s*,\s*Georgia)?(?:\s*,\s*serif)?/gi, () => {
    stats.cormorant++; return "var(--serif)";
  });
  s = s.replace(/"Cormorant Garamond"(?:\s*,\s*Georgia)?(?:\s*,\s*serif)?/gi, () => {
    stats.cormorant++; return 'var(--serif)';
  });

  return s;
}

const files = walk(join(ROOT, 'app'));
const changedFiles = [];
for (const abs of files) {
  const rel = relative(ROOT, abs);
  const cls = classify(rel);
  if (cls !== 'eligible') {
    if (/#EBCB6B|Cormorant Garamond/i.test(readFileSync(abs, 'utf8')))
      stats.skipped[cls] = (stats.skipped[cls] || 0) + 1;
    continue;
  }
  const src = readFileSync(abs, 'utf8');
  if (!/#EBCB6B|Cormorant Garamond/i.test(src)) continue;
  const out = sweep(src, rel);
  if (out !== src) {
    changedFiles.push(rel);
    stats.filesChanged++;
    if (APPLY) writeFileSync(abs, out);
  }
}

const mode = APPLY ? 'APPLIED' : 'DRY RUN (no files written — pass --apply to write)';
console.log(`\n=== token-sweep · ${mode} ===`);
console.log(`files changed: ${stats.filesChanged}`);
console.log(`  Tailwind opacity  -[#EBCB6B]/NN -> color-mix : ${stats.twOpacity}`);
console.log(`  Tailwind bare     -[#EBCB6B]    -> var()     : ${stats.twBare}`);
console.log(`  string / inline   '#EBCB6B'     -> var()     : ${stats.strHex}`);
console.log(`  Cormorant Garamond              -> var(--serif): ${stats.cormorant}`);
console.log(`  skipped files:`, stats.skipped);
console.log(`\nchanged files:\n${changedFiles.map(f => '  ' + f).join('\n')}\n`);
console.log(`NEXT: npm run build  ·  eyeball demo-path pages  ·  git add -p  ·  push as one wave.`);
console.log(`NOTE: color-mix() needs a 2023+ browser (all evergreen OK). If you prefer rgba,`);
console.log(`      change the opacity branch to: rgba(${GOLD},0.NN).\n`);
