# Claude Code Audit Prompt — Intake/Brief Wiring End-to-End (#519)

Hand this prompt to a fresh Claude Code session. It does the deep, file-by-file walk val has been asking for: every place data should land in the brief or intake, every place it's read, and every drift that's making her re-enter the same fields.

Run from: `/Users/atlanticandvine/Library/CloudStorage/OneDrive-atlanticandvine.com/HunterHoney/_organized/atlantic-hub`

---

## The Prompt

You are auditing the intake → brief → surfaces data flow of a Next.js / MySQL app called Atlantic Hub. The owner (val) has been finding the same bug pattern over and over: a panel uses data to do work but never writes the canonical fact back to the source of truth, so later panels can't see it. She just shipped #517 which fixed that for `website_url` across three scrape endpoints. Now she wants a full sweep so we find every other instance of the same pattern.

**Canonical sources of truth (don't drift, don't dupe):**

1. **`creative_briefs.brief_payload` (JSON)** — the per-client creative brief. Keyed by `(tenant_id, client_id)`. The single source of truth for client identity + offer + audience + numbers. Canonical keys are listed in `lib/client/intake_fields.ts` → `INTAKE_KEYS` (snake_case, ~57 keys).
2. **`client_users.intake_payload` (JSON)** — the client-portal intake form's submission, mirrored from the brief. Same canonical key set. Same shape.
3. Reader: `lib/client/brief_store.ts` → `getBriefPayload(tenantId, clientId)`.
4. Writer: `lib/client/brief_store.ts` → `saveBriefPayload(tenantId, clientId, payload, opts)` (upserts + snapshots a version).
5. Website URL resolver: `lib/client/website_resolver.ts` → `pickWebsiteFromBrief(brief)` / `resolveClientWebsite(tenantId, clientId)` / `stampWebsiteOnBrief(...)` (just landed in #517).

**The bug pattern to find (call it the "fetch-and-forget" pattern):**

A surface or endpoint takes a piece of data as input (URL, email, phone, social handle, address, etc.), uses it to fetch / enrich / scrape, persists the *result* of that fetch (audit snapshot, brand kit, social targets, etc.) — but never writes the *input fact* back to `brief_payload` under the canonical key. So:
- A later panel asks "does this client have a website / email / phone on file?" → reads brief → sees nothing → asks val to re-enter it.
- val re-enters, runs the same scrape, same problem.

**Concrete examples of the pattern she's hit:**

- `app/api/admin/av/clients/[client_id]/fill-intake-from-web/route.ts` preview path — fetched the URL, ran LLM, never wrote `website_url` to brief. **Fixed in #517.**
- `app/api/admin/av/clients/[client_id]/extract-brand-kit/route.ts` preview path — same. **Fixed in #517.**
- `app/api/admin/av/clients/[client_id]/social/scrape-website/route.ts` — same. **Fixed in #517.**
- Likely still broken: contact email (the create-client form, the account info editor, anywhere we accept email), phone (split-types task #506), social handles (when val confirms an OAuth target), Apollo/Hunter/Places enrichment results (lead-side, not client-side, but check whether companies enriched as leads ever bubble back to a brief if promoted).

## What to do

### Pass 1 — Catalogue the canonical writers

Find every place in the codebase that calls `saveBriefPayload()` or directly UPDATEs `creative_briefs` / `client_users.intake_payload`. List them with file:line. For each one, identify:
- What event triggered the write (form submit, scrape success, OAuth callback, etc.)
- Which `INTAKE_KEYS` it sets
- Which it should ALSO be setting but doesn't (the fetch-and-forget gaps)

### Pass 2 — Catalogue the canonical readers

Find every place that calls `getBriefPayload()` or selects from `creative_briefs.brief_payload` / `client_users.intake_payload`. For each:
- What surface displays it
- Which key(s) it reads
- Where it falls back to "no X on file" / null / dummy values

### Pass 3 — Find the fetch-and-forget gaps

For each panel under `app/admin/av/clients/[client_id]/` and each `/api/admin/av/clients/[client_id]/` endpoint, check:
- Does the endpoint accept a piece of identity data (url, email, phone, address, social handle, founder name, company name, industry, etc.) as input?
- After successful processing, does it persist that input value to `brief_payload` under the canonical key?
- If not, that's a gap. Report it.

For each, recommend the minimal fix (same pattern as `stampWebsiteOnBrief` — blanks-only, never overwrites a hand-curated value).

### Pass 4 — Find the drift

For each `INTAKE_KEYS` entry, find every place in the codebase that writes that key. If multiple writers exist, check they all use the same canonical key spelling (not camelCase vs snake_case duplicates). Report any drift.

Known drift already fixed: `website_url` had legacy `websiteUrl`, `website`, `companyWebsite` forms — `pickWebsiteFromBrief` checks all four in priority order. Look for similar in other keys: `phone` vs `phoneNumber`, `contact_name` vs `contactName`, `key_message` vs `keyMessage`, etc.

### Pass 5 — Verify the visibility loop

For each canonical key val cares about most — `website_url`, `phone`, `contact_name`, `business_description`, `key_message`, `brand_colors`, `industry`, `ideal_client`, `client_problems`, `avg_deal_value`, `revenue_baseline`, `differentiators` — verify the value, once written, surfaces in:

1. Operator `/admin/av/clients/[id]` — relevant panel
2. Operator preview `/admin/av/clients/[id]/preview/intake` (and dashboard if applicable)
3. Client portal — relevant page (`/client/dashboard`, `/client/intake`, `/client/account`)
4. Pre-flight readiness check (`lib/av/prep_preflight.ts`)
5. ICP sharpener input (`lib/client/icp_sharpener.ts` or similar)
6. PR drafter, outreach drafter, lead audit grounding (anywhere `getBriefForPrompt()` is consumed)

If the value gets written but NOT read in one of those surfaces, that's a visibility gap. Report it.

### Pass 6 — Mobile-first audit

val needs to do every operator action from her phone (no SSH, no phpMyAdmin, no Mac terminal). For each panel under `app/admin/av/clients/[client_id]/`, check:
- Does it render legibly at 380px viewport?
- Are all interactive controls (buttons, checkboxes, text fields) tappable (min 44px tap target)?
- Are diff cards / overwrite warnings horizontally scrollable or do they overflow?
- Is the "Save / Apply" affordance obvious and reachable without precision tapping?

Report panels that fail.

## Deliverable

A single markdown report titled `INTAKE_BRIEF_WIRING_AUDIT.md` at the repo root with one section per pass. Each finding gets:
- The bug pattern (one-liner)
- The file:line
- The minimal fix (don't write the fix, just describe it in 1-2 sentences)
- Severity: BLOCKER / HIGH / MEDIUM / LOW

Do not write any code. Do not push. The report is the deliverable. val will triage and queue the fixes.

## Constraints

- No speculation — every finding must be backed by a file:line you actually read.
- No "let me verify" hedging — if you couldn't find it, say so.
- No mock or dummy code — analysis only.
- Respect the existing canonical-source rule: never propose adding a NEW source of truth. Always propose writing to the EXISTING canonical key.
- Read the existing memory files referenced by val's spec — start with `Atlantic_Hub_Playbook/00_System_Map.md`, `lib/client/intake_fields.ts`, `lib/client/brief_store.ts`, `lib/client/website_resolver.ts`.
- val's principle: "if the system learns it, the client must see it learn within a week" (the visibility-gap rule). Every write must have a corresponding read in the surface where it'd be useful.
