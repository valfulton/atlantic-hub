# CC Audit #2 — Vertical Packs (end-to-end completeness)

The hub repositions as a horizontal Revenue Intelligence platform with N vertical packs (collections, real estate, B2B sales, insurance, lending, law, recruiting, marketing, luxury hospitality, commercial solar). Each pack is supposed to be: a set of signal weights + a recipe of adapters + a vertical pack picker on the create-client form + investor-narrative framing.

This audit answers: **for each vertical pack, what's actually wired, and what's just a label?**

Run from: `/Users/atlanticandvine/Library/CloudStorage/OneDrive-atlanticandvine.com/HunterHoney/_organized/atlantic-hub`

---

## The Prompt

You're auditing the vertical pack system in Atlantic Hub. The promise: pick a vertical at client creation, the system auto-configures signal weights + activates the right adapters + seeds the cascade pipeline + tailors the intake. The reality: some packs are fully wired, some are stubs. This audit names every gap.

### Read first

- `lib/public_intel/vertical_packs.ts` — the pack definitions
- `lib/public_intel/activate_pack.ts` — the activation entry point
- `lib/billing/tiers.ts` — pricing tier × pack matrix
- `app/admin/av/clients/new/NewClientForm.tsx` — the pack picker UI
- `app/api/admin/av/clients/[client_id]/intelligence/activate-pack/route.ts` — the activation endpoint
- `lib/public_intel/cascade/` (if it exists) — the cascade recipes
- `lib/public_intel/adapters/` — every adapter file

### Pass 1 — Enumerate the packs

List every pack defined in `vertical_packs.ts`. For each, capture:
- Pack ID (e.g. `collections`, `real_estate`)
- Display name
- Recommended adapters (`recommendedAdapters` field)
- Signal weights (`signalWeights` field)
- Cascade recipes (if defined)
- Tier this pack appears in (Sprint / Momentum / Scale)
- Consumer / corporate target flag (from #384)

Output a table. One row per pack.

### Pass 2 — Per-adapter wiring check

For each adapter referenced in any pack's `recommendedAdapters`:
- Does the adapter file exist at `lib/public_intel/adapters/<adapter>.ts`?
- Is it registered in `lib/public_intel/registry.ts`?
- Does it have a `run(...)` function that actually fetches data (vs returning empty)?
- Does it have a `lookup(...)` mode if the pack expects per-entity lookup?
- Is there an API key declared but not configured?
- When was it last successfully run? (Check `public_intel_sources.last_run_at` if you can grep usage.)

Flag any adapter that's referenced by a pack but is a stub.

### Pass 3 — Signal weights → engine

For each pack's `signalWeights`:
- Are the signal kinds referenced (`new_llc`, `bankruptcy_filed`, etc.) actually classified by `lib/public_intel/distress_engine.ts`?
- If a pack references a signal kind that the classifier doesn't produce, that's a dead weight — the weight will never fire.

Flag every dead weight reference.

### Pass 4 — Cascade recipe completeness

For each pack with cascade recipes:
- Does each step in the recipe reference a real adapter?
- Does each adapter step have its prerequisite met (e.g. UCC lookup needs a debtor name from an upstream source)?
- If a recipe step's adapter is a stub, the whole cascade silently breaks at that step

Flag every cascade with a broken or partial chain.

### Pass 5 — Activation flow (the user journey)

Trace what happens when val picks a pack on `NewClientForm` and clicks Apply:

1. `NewClientForm.tsx` submits → which route?
2. That route calls `applyVerticalPackToClient(...)` → does this actually write the weights?
3. `activate_pack.ts` → which adapters does it provision via `upsertSource(...)`?
4. Does it call `rescoreClient(...)` after?
5. Does the UI re-render with the new pack's UI hints?

Report any break in this chain — places where the pack is "picked" but doesn't propagate.

### Pass 6 — Pack-aware UI hints

The whole point of a vertical pack is that the UI changes for that vertical:
- Adriana (collections) should see distress-collection language
- Real estate clients should see property-flow language
- Mark Francis (healthcare tech) should see HIPAA / medical-board signals

Grep the codebase for "if pack === 'X'" or "client.pack === 'X'" patterns. For each pack:
- Does the operator client page change UI based on pack?
- Does the client portal change UI based on pack?
- Do the watchlist signal labels translate per pack?
- Does the outreach drafter prompt include pack context?

Report packs that exist as data but have NO UI differentiation.

### Pass 7 — Investor-facing claims vs reality

The investor doc claims 9 packs. Compare claims to code:
- Read any investor positioning doc in `Atlantic_Hub_Playbook/`
- For each claim about pack capability, find the code that delivers it
- Flag every claim with no code backing

### Pass 8 — The Mark Francis case

Mark Francis is healthcare tech. Walk through:
- Was a healthcare tech pack applied to him?
- If yes, what adapters fired for his client_id?
- What weights were set?
- What did his watchlist surface?
- If no pack was applied, why — was the picker disabled, did the apply fail silently, or is there no healthcare pack at all?

This concrete case will surface the most useful gaps.

## Deliverable

`VERTICAL_PACKS_AUDIT.md` at the repo root. Structure:

```
# Vertical Packs Audit (#524)

## Pack-by-pack scorecard
| Pack | Adapters wired | Weights live | Cascade complete | UI differentiation | Investor claim backed |

## Critical gaps
- Pack X: claims feature Y, code doesn't deliver
- Adapter Z: stubbed, blocks pack A and pack B

## Recommended queue
Top 5 wires to land — biggest visible impact, smallest code change.
```

No code changes. Analysis only. The report IS the deliverable.

## Constraints

- Each finding backed by a file:line you actually read.
- Don't pad the report with "could be better someday" — focus on "claimed live, actually broken."
- The 9 packs in `lib/billing/tiers.ts` are the canonical list. Anything else in code or docs is drift.
