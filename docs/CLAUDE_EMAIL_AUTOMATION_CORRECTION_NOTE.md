# Email Automation Kickoff — Correction Note

**TO:** Email Outreach Automation cowork session (Phase 2C)
**FROM:** Cowork Claude (conductor)
**DATE:** 2026-05-17

## Read this BEFORE you read CLAUDE_KICKOFF_EMAIL_AUTOMATION.md

The kickoff doc you were going to read references tier names that DO NOT EXIST in production (Starter / Growth / Scale at $497 / $1,497 / $3,997). The conductor had wrong pricing in the docs.

**The REAL tier names live in `AV_livewebsite/js/packages.js`:**

| Tier ID | Real name | Real price |
| --- | --- | --- |
| `sprint` | Client Surge — Sprint | $1,995/mo |
| `momentum` | Client Surge — Momentum (Most Popular) | $3,995/mo |
| `scale` | Client Surge — Scale | $7,995/mo |

These have live Stripe products in `js/stripe-products.json`. Don't break them.

## What this changes for your build

The kickoff doc tells you to add tier gating to email outreach (different send limits per tier). When you write that gating, use these tier names:

```ts
// CORRECT
type ClientTier = 'audit_only' | 'sprint' | 'momentum' | 'scale';

// WRONG (what the kickoff doc has — fix it as you go)
type ClientTier = 'audit_only' | 'starter' | 'growth' | 'scale';
```

If you see `lib/client-portal/tiers.ts` with the wrong tier names, **DO NOT migrate it as part of your build** — the Grok session is owning that rename in schema/015 + tiers.ts. Your work just needs to reference the correct names going forward. If schema/015 hasn't shipped yet by the time you commit, write your code to accept BOTH names temporarily (e.g. `tier === 'sprint' || tier === 'starter'`) with a comment saying remove the legacy branch after schema/015 ships.

## Daily send limits per tier (suggested)

If your build needs tier-aware send limits for outreach campaigns:

| Tier | Daily send cap | Why |
| --- | --- | --- |
| audit_only | 0 | No outbound for free-audit users |
| trial (7-day) | 5 | Sample-the-system pace |
| sprint | 25/day | Matches 10-20 leads/mo conversion math |
| momentum | 75/day | Higher cadence, multi-channel |
| scale | 200/day | Daily content, daily sends |
| enterprise | unlimited | Per-tenant negotiated |

Use these as defaults but make them configurable per campaign — operators may want to throttle.

## Everything else in the original kickoff doc still applies

The rest of `CLAUDE_KICKOFF_EMAIL_AUTOMATION.md` is correct:
- Schema 014 reservation is yours
- Instantly API integration approach is correct
- Approval queue UI plan is correct
- Webhook receiver pattern is correct
- DNS prerequisites (SPF/DKIM/DMARC on atlanticandvine.com) still apply

Just substitute tier names as you go.

## Ship priority

Val explicitly named email automation as the most urgent Phase 2 build. **Do not phase-split this.** Ship the schema, the Instantly client, the AI drafter, the approval queue UI, the webhook receiver, and the sidebar link in one push. If the Grok session ships schema/015 (tier rename) first, great — read those tier values. If not, your code accepts both as noted above.

Ship.
