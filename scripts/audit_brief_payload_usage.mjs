#!/usr/bin/env node
/**
 * audit_brief_payload_usage  (#553)
 *
 * The architectural rule val cares most about: every AI prompt that speaks AS
 * or ABOUT a client must be grounded in that client's brief_payload — no
 * hardcoded "Atlantic & Vine is a marketing agency" framing leaking into
 * client-facing output. "Each pass goes through elements on the creative
 * brief." This script enforces that, statically.
 *
 * What it does:
 *   1. Finds every call site of the LLM entrypoint runLlm() under lib/.
 *   2. For each, checks:
 *        a. reads the brief  (getBriefForPrompt / getBriefPayload / getBriefSeed
 *           / a buildBriefContext* helper)
 *        b. uses brief fields in the prompt (interpolates block/seed/brief/voice/
 *           audience), i.e. the brief actually reaches the model
 *        c. carries hardcoded AV agency framing that is NOT guarded by a
 *           "do not mention Atlantic & Vine / on behalf of the client" note
 *   3. Prints a report (prompt file | reads brief | uses fields | hardcoded
 *      framing | verdict) and writes it to AUDIT_BRIEF_PAYLOAD.md.
 *   4. Exits non-zero if any RED row remains, so CI / the PR gate can block.
 *
 * Run:  node scripts/audit_brief_payload_usage.mjs
 *       node scripts/audit_brief_payload_usage.mjs --quiet   (report file only)
 *
 * NOTE on file type: written as .mjs (not .ts) because this repo has no TS
 * script runner (scripts/*.mjs run under plain node); .mjs also keeps the
 * analyzer out of the app's tsc gate. The deliverable is the green report.
 */
import { readFileSync, readdirSync, writeFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const SCAN_DIRS = ['lib/ai', 'lib/client', 'lib/av', 'lib/pr', 'lib/campaigns'];
const QUIET = process.argv.includes('--quiet');

// Call sites that legitimately do NOT speak as/about the client and so do not
// need brief grounding. Each must justify itself — this is the ONLY way a
// runLlm() site is exempt from the brief rule. Keep this list short + honest.
const BRIEF_EXEMPT = {
  'lib/ai/reply_classifier.ts': 'Classifies an inbound reply (positive/negative/OOO). No client voice in the output.',
  'lib/client/brand_kit_extractor.ts': 'Extracts colors/voice FROM a page — the brief is the output, not an input.',
  'lib/ai/visual_brief.ts': 'Visual moodboard hints; pulls voice/colors directly, not the full brief block.'
};

function walk(dir) {
  const abs = join(ROOT, dir);
  let out = [];
  let entries = [];
  try {
    entries = readdirSync(abs);
  } catch {
    return out;
  }
  for (const name of entries) {
    const p = join(abs, name);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) out = out.concat(walk(relative(ROOT, p)));
    else if (name.endsWith('.ts') && !name.endsWith('.d.ts')) out.push(relative(ROOT, p));
  }
  return out;
}

const CALL_RE = /\brunLlm\s*\(/;
const BRIEF_READ_RE = /getBriefForPrompt|getBriefPayload|getBriefSeed|extractBriefSeedFromIntake|buildBriefContext|tenantOfferDescription/;
// Brief content reaching the prompt: interpolation of a brief-derived value.
const BRIEF_FIELD_RE = /\$\{[^}]*\b(block|seed|brief|voice|audience|identity|grounded|offer|painProfile|brandName)\b/i;
// AV positioned as the SPEAKER / identity (the thing we must not hardcode).
const FRAMING_RE = /(you are|we are|i am|as (a|the)|on behalf of)\b[^.\n]{0,60}(atlantic\s*&\s*vine|marketing (agency|platform|company))|(atlantic\s*&\s*vine|marketing agency)\s+(is|are)\b/i;
// A guard that explicitly grounds in the client / suppresses AV framing.
const GUARD_RE = /do not mention|don'?t mention|never mention|on behalf of (an? )?(actual )?client|the client'?s (own )?(words|voice|offer)/i;

function analyze(file) {
  const src = readFileSync(join(ROOT, file), 'utf8');
  if (!CALL_RE.test(src)) return null; // not a call site
  const readsBrief = BRIEF_READ_RE.test(src);
  const usesFields = readsBrief && BRIEF_FIELD_RE.test(src);
  const hasFraming = FRAMING_RE.test(src);
  const hasGuard = GUARD_RE.test(src);
  const exemptReason = BRIEF_EXEMPT[file] || null;

  // Verdict:
  //  - exempt sites are OK as long as they carry no UNGUARDED framing.
  //  - otherwise a site must read the brief AND not leak unguarded framing.
  const framingLeak = hasFraming && !hasGuard;
  let verdict, reason;
  if (exemptReason) {
    verdict = framingLeak ? 'RED' : 'OK';
    reason = framingLeak ? 'Exempt from brief, but carries UNGUARDED AV framing.' : `Exempt — ${exemptReason}`;
  } else if (!readsBrief) {
    verdict = 'RED';
    reason = 'Generative client prompt does NOT load the brief.';
  } else if (framingLeak) {
    verdict = 'RED';
    reason = 'Loads brief but carries UNGUARDED hardcoded AV framing.';
  } else {
    verdict = 'OK';
    reason = usesFields ? 'Reads brief and interpolates brief fields.' : 'Reads brief (no obvious field interpolation — review).';
  }
  return { file, readsBrief, usesFields, hasFraming, hasGuard, verdict, reason };
}

const files = SCAN_DIRS.flatMap(walk);
const rows = files.map(analyze).filter(Boolean).sort((a, b) => a.file.localeCompare(b.file));
const red = rows.filter((r) => r.verdict === 'RED');

const mark = (b) => (b ? '✓' : '·');
const line = (r) => `| ${r.file} | ${mark(r.readsBrief)} | ${mark(r.usesFields)} | ${r.hasFraming ? (r.hasGuard ? 'guarded' : 'UNGUARDED') : '·'} | ${r.verdict} |`;

const reportLines = [
  '# brief_payload usage audit (#553)',
  '',
  `Generated by \`scripts/audit_brief_payload_usage.mjs\`. Scanned: ${SCAN_DIRS.join(', ')}.`,
  '',
  `**${rows.length} runLlm() call sites — ${red.length} red.**`,
  '',
  '| prompt file | reads brief | uses fields | AV framing | verdict |',
  '| --- | :---: | :---: | :---: | :---: |',
  ...rows.map(line),
  '',
  '## Notes',
  ...rows.map((r) => `- \`${r.file}\` — ${r.reason}`),
  ''
];
const report = reportLines.join('\n');
writeFileSync(join(ROOT, 'AUDIT_BRIEF_PAYLOAD.md'), report);

if (!QUIET) {
  console.log(report);
  console.log(red.length === 0 ? '\n✅ GREEN — every client prompt traces back to the brief.' : `\n❌ ${red.length} RED row(s) — see above.`);
}

process.exit(red.length === 0 ? 0 : 1);
