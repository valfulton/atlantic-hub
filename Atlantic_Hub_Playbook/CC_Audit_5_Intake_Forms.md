# CC Audit #5 — Intake Forms (every field, every save, every consumer)

The intake form is the front door — it captures everything downstream depends on. There are at least three surfaces that play "intake":

1. **Marketing-site intake** — `AV_livewebsite/client-intake.html` (separate repo)
2. **Hub portal intake** — `app/client/intake/page.tsx` (and the prefilled-token variant)
3. **Operator-side editable intake** — `app/admin/av/clients/[client_id]/` editable intake panel

This audit answers: **for every field on every intake surface, where does it land, what reads it, and does the value actually drive anything downstream.**

Run from: `/Users/atlanticandvine/Library/CloudStorage/OneDrive-atlanticandvine.com/HunterHoney/_organized/atlantic-hub`

---

## The Prompt

You're auditing the intake form system. The canonical field set is `INTAKE_KEYS` in `lib/client/intake_fields.ts` (~57 fields across ~9 groups). Every form, every save path, every consumer should align with that list.

### Read first

- `lib/client/intake_fields.ts` — the canonical field definitions + groupings
- `lib/client/brief_store.ts` — `saveBriefPayload` + the writer pattern
- `lib/client/intake_brief.ts` — `extractBriefSeedFromIntake`
- `app/client/intake/page.tsx` — the client-portal intake
- `app/client/intake/[token]/page.tsx` — the prefilled-token intake
- `app/api/client/intake/submit/route.ts` (or wherever intake submission lands)
- `app/api/admin/av/clients/[client_id]/intake/route.ts` (or the operator editable intake save)
- `AV_livewebsite/client-intake.html` — the marketing-site form (different repo, separate fetch)

### Pass 1 — Field inventory per surface

For each intake surface, list every field rendered. Output a comparison table:

| Field key | In INTAKE_KEYS | On marketing form | On portal intake | On operator editor | Renders correctly |
|---|---|---|---|---|---|

Flag fields that:
- Are in INTAKE_KEYS but missing from a surface (gap)
- Are on a surface but NOT in INTAKE_KEYS (drift — the form is asking for something the system has no key for)
- Have different labels / hints / examples across surfaces (inconsistency)
- Don't render correctly (camelCase vs snake_case bugs from past #501-pattern)

### Pass 2 — Save path tracing

For each surface, trace the submit path:
1. What does the submit handler call?
2. What endpoint receives it?
3. Does that endpoint call `saveBriefPayload(...)`?
4. Does it pre-load + merge, or just pass the patch (the prep-all bug pattern)?
5. Does it write to `client_users.intake_payload` as a mirror?
6. Does it trigger autopilot (ICP sharpener, brand-kit autopilot, etc.)?

Flag any surface whose save path is missing one of these steps.

### Pass 3 — Per-field consumer audit

For each `INTAKE_KEYS` entry, find every place in the codebase that READS that key from brief_payload / intake_payload. Then categorize:

- **Hot fields** — read in 5+ places (prompts, scoring, UI display): high-value, must be reliable
- **Warm fields** — read in 1-4 places: working but limited use
- **Cold fields** — collected by intake but NEVER read: dead intake (the worst case — we're asking clients for data we don't use)

For the COLD fields, recommend: drop from intake, or wire to a consumer.

Per val's directive: every field we ask for must have a use. Cold fields fail her test.

### Pass 4 — Required vs optional

For each field, check:
- Is it marked required in the schema (`required: true` or similar)?
- Is it actually enforced at submit (server-side validation)?
- Is it labeled as required in the UI?

Drift between these three states means clients can submit briefs that downstream code assumes are complete.

### Pass 5 — Prefill paths

The hub has multiple prefill paths:
- Fill-intake-from-web (LLM extracts from website)
- Brand-kit extractor (extracts colors, logos)
- ICP sharpener (writes to client_icps)
- Auto-stamp website URL on scrape (#517)
- Account info editor mirror (#519, just landed)
- Operator manual edits

For each prefill path:
- Which keys does it write?
- Does it merge or overwrite?
- Does the UI show which keys it touched (diff preview)?
- Does it respect blanks-only when val intends it?

Flag any prefill path that's too aggressive (overwrites without opt-in) or too shy (won't write even when val expects it to).

### Pass 6 — The "Your numbers" group (#500)

The 6 KPI fields (`avg_deal_value`, `revenue_baseline`, `close_rate`, `sales_cycle`, `customer_ltv`, `deal_type`) were shipped but the audit (#519) flagged they're "read by no prompt anywhere." Verify:
- Are they on every intake surface?
- Where SHOULD they be consumed (deal_model.ts, ROI math, proposal sizing)?
- Are those consumers reading them, or hardcoded?

Report what's still cold from this group.

### Pass 7 — Token-prefilled intake security

The prefilled-intake JWT flow lets val share a link that pre-populates the form. Verify:
- Can the token be reused after submit?
- Does it scope correctly to one client?
- Does it expire?
- Is there a path where a token could carry data into a DIFFERENT client's brief (cross-client bleed)?

### Pass 8 — Visibility loop per val's directive

Per `feedback_visibility_gap`: every field the system learns must surface to the client within a week. For each `clientFacing: true` field:
- Is the value displayed back to the client somewhere in `/client/*`?
- Is there a "we know this about you" surface they can edit?

Cold-on-the-client-side fields create the same trust gap as cold-on-the-system-side fields.

### Pass 9 — The Mark Francis snapshot

Mark Francis (client_id 12) currently has 13 brief fields. Walk through:
- Which 13 keys are populated?
- Which keys is val explicitly trying to fill via the operator UI?
- Are there blocks (form not visible, save path broken, key not in INTAKE_KEYS)?
- What's the shortest path to get him from 13 → 30 fields?

The concrete case will surface real gaps.

## Deliverable

`INTAKE_FORMS_AUDIT.md` at the repo root. Structure:

```
# Intake Forms Audit (#527)

## Surface inventory
[Pass 1 comparison table]

## Hot / warm / cold fields
- Hot (used everywhere): N fields
- Warm (used some places): N fields  
- Cold (never read): N fields — list these explicitly

## Save path findings
- Surface X uses the patch-without-merge anti-pattern
- Surface Y skips autopilot trigger

## Prefill audit
[per prefill path]

## The "Your numbers" status
Where the 6 KPI fields actually land downstream

## Security findings
Any token/scope issues

## Recommended queue
Top 5 fixes — what's high-leverage to wire (a cold field that's actually critical, a prefill path that's missing a key, etc.)
```

No code changes. Analysis only.

## Constraints

- A "cold" field is one with ZERO read sites. Cold by definition fails val's "every field must have a use" test.
- Don't recommend NEW intake fields — focus on what we already ask for that doesn't land downstream.
- Per val's directive #501-pattern: drift between camelCase and snake_case is a BUG, not a style choice. Flag every instance.
