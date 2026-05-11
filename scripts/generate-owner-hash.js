#!/usr/bin/env node
/**
 * =====================================================================
 * Atlantic Hub — Owner Password Hash Generator
 * =====================================================================
 *
 * Run this LOCALLY (never in CI, never paste output into chat or commit
 * the result). It prompts for a password (input hidden), confirms,
 * and prints the bcrypt-12 hash you should paste into the Netlify env
 * var OWNER_BOOTSTRAP_PASSWORD_HASH.
 *
 * Usage:
 *   cd path/to/atlantic-hub
 *   npm install            # only needed once, to pull bcryptjs
 *   node scripts/generate-owner-hash.js
 *
 * The script writes nothing to disk. It only prints to stdout.
 * Clear your terminal scrollback after copying the hash.
 *
 * Security notes:
 *   - The hash, not the password, goes into Netlify.
 *   - bcrypt cost factor is 12 (~250ms per hash on modest hardware).
 *   - Even if the hash leaks, brute-forcing a strong password at
 *     bcrypt-12 is impractical. Use a real password manager + 16+
 *     chars + mixed classes.
 * =====================================================================
 */
'use strict';

const readline = require('readline');
const { Writable } = require('stream');

let bcrypt;
try {
  bcrypt = require('bcryptjs');
} catch (e) {
  console.error('\n❌ bcryptjs is not installed.\n');
  console.error('Run this first:\n');
  console.error('    npm install\n');
  process.exit(1);
}

const COST_FACTOR = 12;
const MIN_LENGTH = 12;

// A muted stdout for hidden password entry.
const mutedStdout = new Writable({
  write(_chunk, _enc, cb) {
    // Swallow output so the password doesn't echo.
    cb();
  }
});

function promptHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: mutedStdout,
      terminal: true
    });
    // Manually emit the prompt to the real stdout.
    process.stdout.write(question);
    rl.question('', (answer) => {
      process.stdout.write('\n');
      rl.close();
      resolve(answer);
    });
  });
}

function checkPasswordStrength(pw) {
  const issues = [];
  if (pw.length < MIN_LENGTH) issues.push(`at least ${MIN_LENGTH} characters`);
  if (!/[a-z]/.test(pw)) issues.push('a lowercase letter');
  if (!/[A-Z]/.test(pw)) issues.push('an uppercase letter');
  if (!/[0-9]/.test(pw)) issues.push('a digit');
  if (!/[^A-Za-z0-9]/.test(pw)) issues.push('a symbol');
  return issues;
}

async function main() {
  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  Atlantic Hub — Owner password hash generator');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');
  console.log('  Enter the password you want to use for the OWNER account.');
  console.log('  Minimum 12 chars, mixed case, digit, symbol.');
  console.log('');

  const pw1 = await promptHidden('  Password: ');
  const issues = checkPasswordStrength(pw1);
  if (issues.length > 0) {
    console.error('\n❌ Password is missing: ' + issues.join(', ') + '.\n');
    process.exit(2);
  }

  const pw2 = await promptHidden('  Confirm:  ');
  if (pw1 !== pw2) {
    console.error('\n❌ Passwords do not match.\n');
    process.exit(3);
  }

  console.log('  Hashing (this takes a moment at cost factor ' + COST_FACTOR + ')…');
  const hash = await bcrypt.hash(pw1, COST_FACTOR);

  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  Paste this value into Netlify env var:');
  console.log('  OWNER_BOOTSTRAP_PASSWORD_HASH');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');
  console.log('  ' + hash);
  console.log('');
  console.log('  Then clear your terminal scrollback:');
  console.log('    Cmd+K   (macOS Terminal / iTerm)');
  console.log('');
  console.log('  Verify by signing in to your Atlantic Hub deploy with:');
  console.log('    email:    (whatever you set OWNER_BOOTSTRAP_EMAIL to)');
  console.log('    password: (the password you just entered)');
  console.log('');
}

main().catch((err) => {
  console.error('\n❌ Unexpected error:', err.message);
  process.exit(1);
});
