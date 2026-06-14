# CC Audit #3 — Connections & Adapters (the engine layer)

The hub talks to many external data sources: PACER, CourtListener, CFPB, Census ACS, HMDA, CA SOS, UCC, GBP, Apollo, Hunter, Clay, Google Places, OpenRouter (LLM provider), USPTO PatentsView, plus county-level recorders (Maryland Land Records, DataSF, etc.).

This audit answers: **for every external connection, what works, what's a stub, what's misconfigured.**

Run from: `/Users/atlanticandvine/Library/CloudStorage/OneDrive-atlanticandvine.com/HunterHoney/_organized/atlantic-hub`

---

## The Prompt

You're auditing every external connection in Atlantic Hub. Each connection has: an adapter file, optionally an API key in env, a registry entry, call sites that fire it, and downstream consumers of its output.

### Read first

- `lib/public_intel/adapters/` — every adapter
- `lib/public_intel/registry.ts` — adapter registry
- `lib/public_intel/store.ts` — source CRUD
- `lib/llm/router.ts` — LLM provider router
- `.env.example` (and any non-secret env documentation in the Playbook) — what keys are expected
- `app/api/admin/av/clients/[client_id]/intelligence/activate-pack/route.ts` — entry point that fires multiple adapters

### Pass 1 — Inventory every adapter

List every file in `lib/public_intel/adapters/` plus any standalone connectors elsewhere (`lib/social/*`, `lib/enrichment/*`, `lib/av/uspto_patents.ts`, etc.). For each:

| Adapter | Purpose | Status | API key env var | Real or stub | Last verified |
|---|---|---|---|---|---|

`Status` is one of:
- **LIVE** — successfully fetches real data from the source
- **STUB** — function exists, returns empty / fake / TODO
- **AUTH-BLOCKED** — code is real, but API key isn't configured
- **DEPRECATED** — file exists but no call sites
- **BROKEN** — call sites exist but the source has rate-limited / blocked / changed shape

### Pass 2 — API key audit

For each adapter that needs auth:
- What env var does it read?
- Is that env var documented anywhere (`.env.example`, Playbook docs)?
- Are there fallback code paths if the key is missing?
- Does the adapter log a clear error when the key is absent?

Report any adapter that silently no-ops when its key is missing (worst pattern — val thinks it's running, it's returning empty).

### Pass 3 — Call site map

For each LIVE adapter, find every place in code that fires it:
- The activate-pack endpoint
- Direct cron handlers
- The cascade pipeline
- Manual operator-triggered runs
- HostGator worker scripts (if accessible)

Output one table row per adapter showing every call site.

### Pass 4 — Output consumers

For each adapter, trace the data it produces:
- Does it write to `public_intel_records.record_json`?
- Is the record_json shape consistent with what the dossier page (`app/admin/av/clients/[client_id]/distress/[entity_key]/page.tsx`) expects?
- Are the structured-field hints in that dossier page up to date for this adapter? (Look at the `STRUCTURED_HINTS` map.)
- Does the distress engine `classifyRecord(...)` produce signals from this adapter's output?

Report adapters whose output is captured but never surfaced (records save to DB but no UI shows them).

### Pass 5 — The "credits + cost" gap

The hub has #44 pending (credit + cost tracking) and various credit-log tables (`hunter_credit_log`, `clay_enrichment_log`, etc.). For each paid adapter:
- Does it log cost / credit usage per call?
- Is there an aggregation surface showing total spend per adapter?
- Is there a remaining-credits / quota check before firing?

Report adapters firing real money without telemetry.

### Pass 6 — Rate limiting + dedup

For each adapter that hits a third party:
- Does it have a timeout?
- Does it dedup via `public_intel_records.uk_kind_entity`?
- Does it bail early if `expires_at` hasn't passed (cache reuse)?
- Does it respect a per-adapter rate limit?

Flag adapters that could hammer a source unintentionally.

### Pass 7 — The HostGator worker

The repo references a HostGator worker for heavy sweeps (#225 done). Verify:
- Where does the worker live (file path or external repo)?
- Which adapters are supposed to run on the worker vs in-app?
- Are the worker handlers actually scheduled / running?
- Is there a way to tell from the hub UI whether a worker run succeeded?

Report any worker-dependent adapter whose worker integration is unverified.

### Pass 8 — LLM provider router

Special case — every paid LLM call routes through `lib/llm/router.ts` (#371 done). Verify:
- Every model used (Sonnet, Opus, Haiku, GPT, Gemini) is configured with a working provider
- The cost ledger logs every call with token counts
- The presentation-mode toggle (#363) actually hides costs in the UI
- The content-hash cache (#361) actually short-circuits identical prompts

Flag any LLM call site that BYPASSES `runLlm(...)` and goes direct to a provider SDK.

## Deliverable

`CONNECTIONS_AUDIT.md` at the repo root. Structure:

```
# Connections & Adapters Audit (#525)

## Adapter scorecard
[full table from Pass 1]

## Missing keys / silent no-ops
- Adapter X reads env Y, env Y is undocumented, adapter silently returns empty

## Captured but unsurfaced
- Adapter X writes records, no UI shows them

## Cost telemetry gaps
- Adapter X fires paid API calls with no cost log

## Recommended queue
Top 5 connection-layer fixes — what's 80% wired and just needs the last cable.
```

No code changes. Analysis only.

## Constraints

- A "live" adapter must have evidence — a call site that runs in normal operation AND records in `public_intel_records` from the last 30 days.
- A "stub" is anything that returns empty or mock without making an external HTTP call.
- API keys: don't print actual values. Reference env var names only.
- If an adapter file imports a third-party SDK but is not in the registry, treat it as DEAD CODE and report.
