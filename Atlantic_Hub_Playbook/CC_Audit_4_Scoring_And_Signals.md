# CC Audit #4 — Scoring & Signals (the brain)

The hub scores three different things: distress entities (the watchlist), lead ICP fit (which prospects match a client's profile), and lead audits (the rep brief). Each has its own scoring layer, its own signals, its own weights, its own consumer.

This audit answers: **for every score that appears in the UI, what produces it, what data feeds in, and is the scoring driven by signal or by hardcoded constants.**

Run from: `/Users/atlanticandvine/Library/CloudStorage/OneDrive-atlanticandvine.com/HunterHoney/_organized/atlantic-hub`

---

## The Prompt

You're auditing every scoring system in Atlantic Hub. The promise: scores are real and explainable. The risk: some scores are hardcoded magic numbers, some weights are dead (no signal ever fires for them), some scores are computed but never used.

### Read first

- `lib/public_intel/distress_engine.ts` — the classifier + scorer for the watchlist
- `lib/public_intel/signal_voice.ts` — signal copy + display labels
- `lib/client/icp_sharpener.ts` (or similar) — ICP fit scoring
- `lib/leads/audits.ts` or `lib/lead_audits.ts` — lead audit generation
- `schema/0*.sql` — every signal-related table
- `app/admin/av/clients/[client_id]/DistressWatchlistPanel.tsx` — UI showing scores
- `app/admin/av/clients/[client_id]/IcpEditor.tsx` (or similar)

### Pass 1 — Enumerate every signal kind

From `distress_engine.ts` and any signal classifier, list every `signal_kind` the system can produce:
- `new_llc`, `suspended_entity`, `bankruptcy_filed`, `ucc_filing`, `high_denial_rate`, etc.

For each:
- Where is it CLASSIFIED (which adapter's records can produce it)?
- Where is it SCORED (the weight that converts it to score points)?
- Where is it DISPLAYED (UI labels in `SIGNAL_LABEL`, `SIGNAL_KIND_COPY`)?
- Where is it CONSUMED (outreach drafter prompt, call script, etc.)?

Output a table: signal × stage (classify / score / display / consume). Any row with empty cells is a partial wire.

### Pass 2 — Dead weights

A weight is "dead" when:
- The pack assigns a weight to a signal_kind, but no adapter actually produces that signal_kind
- The signal_kind exists in code but no classifier ever returns it
- The classifier returns the signal but the scorer doesn't have a weight for it

Find every dead weight. Output: weight name, where defined, why it's dead.

### Pass 3 — Hardcoded constants vs data-driven

For each scoring path, identify magic numbers:
- Score multipliers / decay factors / thresholds
- "Recent" windows (last 14d / 30d / 90d)
- Region modifiers
- Default weights when no per-client override exists

Are these constants:
- Adjustable per-client via a settings table?
- Driven by per-pack defaults?
- Pure code constants (you change the score by editing the file)?

Flag constants that SHOULD be data-driven but aren't (e.g. "what counts as a recent filing" should differ by pack — collections vs real estate).

### Pass 4 — ICP fit scoring

`client_icp_fit` columns on leads were added (#248). Trace the scoring path:
- What inputs does ICP fit use? (industry, title, geo, employee count, revenue band, etc.)
- Where is the score COMPUTED (auto-score on insert per #240)?
- Where is it INVALIDATED (#314 stale-reason — when ICP changes)?
- Where is it DISPLAYED (lead card, lead detail, pipeline filter)?
- Where is it CONSUMED (does it gate any decision automatically)?

Report any input field that's collected by intake but NOT used in ICP scoring (waste).

### Pass 5 — Lead audit scoring

Lead audits (#84, #201) generate a rep brief per lead. Trace:
- What goes IN the prompt (which brief fields, ICP, public intel records, call history)?
- What COMES OUT (a score? a recommended action? both?)
- Where is the output stored (`lead_audits` table)?
- Where is it surfaced (lead detail UI, cockpit)?
- Is the prompt visible + editable per val's directive (#80)?

Flag any audit consumer that reads from a STALE audit (no auto-refresh trigger).

### Pass 6 — The weight UI

Per-client weight tuning exists (UI hint: "Tune signal weights" link in watchlist). Verify:
- Is there a panel where val can adjust per-client weights?
- Do changes persist to a table (which one)?
- Do changes trigger a `rescoreClient(...)` automatically?
- Are the defaults visible alongside the current values?

Report whether weight-tuning is real or a "we'll wire that later" link.

### Pass 6.5 — Explainability

For every score that shows on screen, is there an "explain this score" path?
- Watchlist row score → expanded row signals + dossier page (just landed in #520)
- ICP fit score → fit_reasoning text (was rewritten per val's directive)
- Lead audit score → the audit markdown itself

Flag any score with no explainability.

### Pass 7 — The Adriana sanity check

Adriana (CBB collections, client_id 9) had her seven weights seeded. Verify:
- What's in `public_intel_sources` for client 9?
- What signal weights apply to her scoring?
- Is her watchlist populated with signals that match those weights?
- Are her scores actually responsive to her weight settings (would changing a weight change the score)?

The Adriana case will surface whether weights are real or decorative.

### Pass 8 — Drift between scoring engines

The hub has THREE scoring systems (distress, ICP fit, lead audits). Do they:
- Agree on a single "this lead is hot" definition?
- Have overlapping signals with inconsistent labels (e.g. "bankruptcy" vs "bankruptcy_filed" vs "Bk filing")?
- Share a common weighting framework, or each invent their own?

Report drift between the three scoring layers.

## Deliverable

`SCORING_AUDIT.md` at the repo root. Structure:

```
# Scoring & Signals Audit (#526)

## Signal lifecycle table
[Pass 1 output]

## Dead weights
[Pass 2 list]

## Hardcoded vs data-driven constants
[Pass 3 with severity]

## Per-scorer findings
- Distress engine: X
- ICP fit: Y
- Lead audits: Z

## Drift between scorers
[Pass 8]

## Recommended queue
Top 5 fixes — what's a one-line change that makes a score real instead of decorative.
```

No code changes. Analysis only.

## Constraints

- A "real" weight must have evidence: a signal that classifies + a scoring application + a score that responds to it.
- A "dead" weight is one where flipping it from 0 to 100 wouldn't change any client's score.
- Don't propose new signals — focus on whether the existing ones are actually working.
- Per val's directive: every prompt must be visible (#80). Flag any scorer that uses an LLM prompt that isn't editable from `/admin/av/prompts`.
