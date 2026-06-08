# HANDOFF — #521 Dossier panel + #522 Personal Risk Screen button

## Context

val asked (2026-06-08) to be able to do due diligence on prospects BEFORE deciding to take them on as clients: bankruptcy history, court records, prior dissolved entities, personal address (to make sure she gets paid + knows who she's working for). The data flow is:

1. **Existing engine** (`lib/public_intel/distress_engine.ts` + `lib/public_intel/activate_pack.ts`) — already runs PACER, CourtListener, CFPB, UCC, CA SOS adapters against an entity name. Cached in `public_intel_records.record_json`.
2. **Existing dossier detail page** at `/admin/av/clients/[client_id]/distress/[entity_key]` — already renders structured fields + raw JSON for any entity.
3. **NEW: operator-only "Due Diligence" file** per client (#521) — `client_dossier` table landed in schema/081. Holds the PII val doesn't want on the creative brief (personal address, DOB year, prior entities, spouse/co-signer, free-form notes, red-flag log).
4. **NEW: "Run personal risk screen" button** (#522) — fires the existing engine against the CLIENT themselves (contact_name + company), surfacing what comes back as red-flag entries in the dossier. NO hard block — visible warning only.

## What's already shipped this chat (#520)

Watchlist row expand-on-click now actually renders content (the chevron was flipping but nothing appeared). Tapping any entity name in `DistressWatchlistPanel` shows:
- Per-signal explanation (signal label + source)
- Prominent gold "📂 Open full intel →" button to the dossier detail page

Schema 081 has landed. Table is empty. No UI reads from it yet.

## What this handoff is for

Build the operator dossier panel + the personal-risk-screen button. Two increments, shippable separately.

---

## Increment 521-A — Dossier panel (manual entry)

**Files to create:**

- `lib/av/client_dossier.ts` — `getDossier(clientId)`, `saveDossier(clientId, patch, opts)`. Reads/writes the `client_dossier` table. `red_flags_json` is `Array<{ label: string; source: string; severity: 'low'|'medium'|'high'; surfaced_at: string; dossier_url?: string }>`.
- `app/api/admin/av/clients/[client_id]/dossier/route.ts` — `GET` (operator-only, role check) returns the row; `POST` accepts a partial update body, merges, sets `updated_by` from `guard.actor.userId`.
- `app/admin/av/clients/[client_id]/OperatorDossierPanel.tsx` — operator-only client component. Form fields:
  - **Personal address** (textarea)
  - **DOB year** (number input, 1900-2010)
  - **Prior entities** (textarea, comma list)
  - **Spouse / co-signer name** (text)
  - **Free-form notes** (markdown textarea)
  - **Red-flag log** (list of red flags with severity color; each entry has a "Remove" button)
  - **"Add red flag" inline form** at the bottom of the list
  - **"Apply" button** (gold, val's trained verb — NOT "Save")
- Mount the panel on `app/admin/av/clients/[client_id]/page.tsx` between AccountInfoEditor and the existing intelligence panels. Server-side load via `getDossier(clientId)`.

**Server-side role guard:** the API route MUST `if (guard.actor.role === 'client_user') return 403`. The panel is operator-only — NEVER renders on `/admin/av/clients/[id]/preview/*` mirrors. The mirror should pass `mode="client_preview"` and the panel returns `null` in that mode.

**Mobile-first:** every input full-width on narrow viewports. Apply button as a sticky-bottom button on mobile, inline on desktop.

**Memory linked:** [[feedback_client_mobile_advocate]] · [[feedback_no_purple]] · the brand palette tokens.

## Increment 522-A — "Run personal risk screen" button

**The hard part:** the existing `activate_pack` runs adapters scoped to a geo + sweep config. For a personal risk screen we want adapters that take a NAME and search against that name. Most adapters today are sweep-style (PACER full-state, CourtListener full-state, CFPB full-state) — they don't accept a name input.

**Two viable approaches:**

### Approach A — Filter the sweep results

Run the existing sweep adapters, then post-filter `public_intel_records.record_json` for rows whose `parties` / `respondent` / `debtor_name` / `company_name` field matches the client's `contact_name` OR `company` (fuzzy match, case-insensitive). Surface matches as red flags.

**Pros:** uses what's already there. No new adapter code.
**Cons:** sweeps are wide; lots of records to filter; may miss things if the person filed in a different state.

### Approach B — Add a "lookup-by-name" mode to adapters

Extend PACER, CourtListener, UCC, CA SOS to support `{ mode: 'lookup', name: 'John Smith', state?: 'CA' }`. Run those serially per-source. Each adapter writes hits as records and the API returns them.

**Pros:** precise. Fast. Matches what mortgage brokers / loan officers would actually want as a billable feature later (#522 becomes a SaaS line item).
**Cons:** real adapter work. Each adapter is a separate change.

### Recommendation

Start with **Approach A** for the v1 screen, then progressively migrate to Approach B per adapter as we hit limits. The "Approach A" version is:

- `lib/av/personal_risk_screen.ts` exports `runPersonalRiskScreen(clientId)`.
- It reads the client's `contact_name`, `company`, `personal_address` (from dossier), `prior_entities` (from dossier).
- It calls existing `activate_pack` if `last_screened_at` is null or > 7 days old.
- It then queries `public_intel_records` for rows whose `record_json` contains any of those names (use JSON_SEARCH for case-insensitive substring).
- For each match it appends to `client_dossier.red_flags_json` with `{ label: '<case_name or instrument>', source: <source_kind>, severity: 'medium', surfaced_at: NOW(), dossier_url: '/admin/av/clients/.../distress/...' }`.
- Updates `last_screened_at`.

**UI:**
- "Run personal risk screen" button in `OperatorDossierPanel`. Gold. Shows "Running…" while busy.
- On success: refresh the panel via `router.refresh()`. Red-flag log now has new entries.
- On client page: if `red_flags_json.length > 0`, show a red ribbon at top: "⚠ Due diligence flagged N items — review the operator notes before invoicing." Never blocks any action.

**Pre-flight gate:** if `contact_name` is empty in the brief, the button is disabled with hint "Add a contact name on the account info panel first."

**Memory linked:** [[project_distress_intelligence_engine]] · [[feedback_all_clients_default]] · [[project_revenue_intelligence_directive]]

## Acceptance criteria

- [ ] Schema 081 is applied (val ran it once in phpMyAdmin)
- [ ] Dossier panel renders on every operator client page
- [ ] Dossier panel does NOT render on `/admin/av/clients/[id]/preview/*` mirrors
- [ ] "Apply" button persists to `client_dossier` row
- [ ] Manual red-flag entry works (add, remove)
- [ ] tsc clean
- [ ] Mobile pass: every interactive control tappable at 380px

When 522-A is done:
- [ ] Run screen button visible only when contact_name is set
- [ ] Run screen actually creates red-flag entries from existing sweep data
- [ ] Red ribbon on client page when red_flags_json.length > 0
- [ ] No bleed to client portal (verified by previewing as client)

## Out of scope for this handoff

- Cron / scheduled re-screen (manual button only for now)
- Approach B (per-adapter lookup-by-name modes)
- Sharing dossier data with employees (operator-only for now; later we can per-row ACL it via brand_members)
- Web3 / encrypted sealed dossier (queued separately under #491 secure case-file collection)
