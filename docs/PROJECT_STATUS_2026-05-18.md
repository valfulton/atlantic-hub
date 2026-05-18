# Atlantic Hub -- Project Status 2026-05-18 (Grok Imagine)

Companion to PROJECT_STATUS_2026-05-17a/b/c.md. Captures the Grok Imagine
per-lead AI commercial generation shipment.

---

## WHAT SHIPPED (2026-05-18)

Per-lead AI commercial generation, end-to-end. Owner/staff click into any
lead, hit the new "Commercials" tab, generate an image (~10s) or a short
video (~30s-2min, polled live), download the file, post anywhere. xAI
Grok Imagine on the back end, no new SaaS, no new storage credentials.

### 1. Schema

`schema/011_grok_imagine.sql` -- idempotent (same information_schema
guard pattern as 008/009/010). Adds:

`grok_imagine_assets`
- `id`, `lead_id` (FK conceptually; not enforced cross-DB), `asset_type` ENUM(image,video)
- `model`, `prompt`, `enhanced_prompt`, `provider_request_id` (xAI async job id, video only)
- `storage_url`, `storage_path`, `mime_type`, `width`, `height`, `duration_seconds`
- `resolution_tier` ENUM(1k,2k), `aspect_ratio`, `cost_usd`
- `generation_status` ENUM(queued,running,succeeded,failed), `error_message`
- `created_at`, `completed_at`, `archived_at` (soft delete)
- `created_by_user_id`
- Indexes: `lead_id`, `generation_status`, `created_at`, `archived_at`, `provider_request_id`

`grok_imagine_log` -- one row per xAI API call (cost + latency + outcome).
- `endpoint`, `lead_id`, `asset_id`, `model`, `cost_usd`, `latency_ms`
- `outcome` ENUM(success, rate_limited, error, quota_exceeded)
- `error_message`, `actor_user_id`

### 2. lib/grok

`lib/grok/imagine.ts` -- thin fetch-based xAI client (no SDK), mirrors
`lib/openai/client.ts`. Exports `grokGenerateImage`, `grokStartVideo`,
`grokAwaitVideo`, `grokPollVideoOnce`, `grokGenerateVideo` (start + await),
plus typed errors `GrokApiKeyMissingError`, `GrokApiError`,
`GrokVideoTimeoutError`, `GrokVideoFailedError`. Reads `XAI_API_KEY`.

Pricing helpers `estimateImageCostUsd()` and `estimateVideoCostUsd()`
matching the kickoff doc's rate card ($0.02 / $0.05 / $0.07 per image
depending on model, $0.05 / second video).

**Video is async on xAI's side** (POST returns request_id, then GET poll
until done). We long-poll inline up to 50 seconds, then either return a
finished asset or persist `generation_status='running'` with the
request_id and let the GET asset endpoint resume the poll on demand. No
external queue, no background worker.

**`grok-imagine-image-pro` was deprecated 2026-05-15**, three days
before this ship. The type union still includes it (the UI dropdown
labels it "deprecated") but the default is `grok-imagine-image-quality`.

### 3. lib/grok/discoverer.ts

Per-lead orchestrator. `generateCommercialForLead(leadId, options)`:

1. SELECTs the lead (`company`, `industry`, `contact_title`, `audit_content`, `challenge`).
2. Builds a prompt suited to the asset type from the lead context. The
   prompt explicitly references the company, industry, and a 500-600
   char snippet of the strategic audit so the commercial is **on-brand,
   not generic stock-feel**. Caller can supply a `customPrompt` override.
3. Calls `grokGenerateImage` or `grokStartVideo` + `grokAwaitVideo`.
4. INSERTs into `grok_imagine_assets`. Video rows land as 'running'
   first (so the UI sees the asset immediately) and patch to 'succeeded'
   when the poll completes.
5. INSERTs one `grok_imagine_log` row per xAI call.
6. Calls `logEvent({ eventType: 'commercial.generated', ... })` -- best
   effort; logEvent already swallows its own errors, so this is safe
   even if the system_events table is somehow missing.

Also exports `resumeRunningVideoAsset(assetId)` for the GET endpoint to
finish off a video whose first poll budget elapsed.

### 4. API routes

| Route | Method | Auth | Behavior |
| --- | --- | --- | --- |
| `/api/admin/av/leads/[audit_id]/commercial` | POST | owner + staff | Generate. maxDuration=120s. Returns `generationStatus='succeeded'` for images, `'running' | 'succeeded'` for videos depending on poll budget. |
| `/api/admin/av/leads/[audit_id]/commercial` | GET | owner + staff | List all non-archived assets for the lead, newest first, max 200. |
| `/api/admin/av/leads/[audit_id]/commercial/[asset_id]` | GET | owner + staff | Single asset; transparently resumes a running video poll. |
| `/api/admin/av/leads/[audit_id]/commercial/[asset_id]` | DELETE | **owner only** | Soft delete (archived_at = NOW()). |

All four routes use the existing `guardAdminRequest` wrapper for auth +
rate limit + audit logging, and gate behind the existing
`tab_av_enabled` feature flag.

### 5. UI

`app/admin/av/[audit_id]/CommercialPanel.tsx` -- 'use client' panel
rendered on the new "Commercials" tab. Includes:

- Asset-type toggle (Image / Video).
- Image model dropdown (Quality / Standard / Pro-deprecated) with cost
  callouts. Video duration spinner with cost echo.
- Aspect-ratio dropdown (16:9, 9:16, 1:1, 4:3, 3:4).
- Resolution tier toggle (1K / 2K mapped to 480p / 720p for video).
- Optional 4000-char custom prompt textarea.
- Live-cost estimate next to the Generate button.
- Asset grid (2-column on md+, image thumbnails + native `<video controls>`
  for video, status pill, download + copy-URL + delete per card).
- **Auto-polls every 5 seconds** while any asset is `running` or
  `queued`, then stops as soon as the queue is empty. No manual refresh
  needed for the "video is still rendering on xAI" case.

`app/admin/av/[audit_id]/LeadDetailTabs.tsx` -- single edit: added
"Commercials" between "AI Scoring" and "Notes" in the TABS array and
the matching `{active === 'Commercials' && <CommercialPanel ... />}`
block. **No new header button** (kickoff doc says the header is
crowded; the tab is enough).

### 6. Env var

`XAI_API_KEY` -- needs to be set in Netlify before first call. Documented
in `docs/ENV_VARS_REFERENCE.md`. The client throws
`GrokApiKeyMissingError` on missing key, which the API route translates
to a 503 with a clear message so Val sees the right thing in the UI.

---

## FILES TOUCHED / ADDED

New:
- `schema/011_grok_imagine.sql`
- `lib/grok/imagine.ts`
- `lib/grok/discoverer.ts`
- `app/api/admin/av/leads/[audit_id]/commercial/route.ts`
- `app/api/admin/av/leads/[audit_id]/commercial/[asset_id]/route.ts`
- `app/admin/av/[audit_id]/CommercialPanel.tsx`
- `docs/PROJECT_STATUS_2026-05-18.md` (this file)
- `docs/COMMERCIAL_GOLIVE_RUNBOOK.md`

Modified:
- `app/admin/av/[audit_id]/LeadDetailTabs.tsx` -- added Commercials tab
- `docs/ENV_VARS_REFERENCE.md` -- added XAI_API_KEY row
- `docs/CHANGELOG.md` -- new 2026-05-18 entry
- `docs/SESSION_COORDINATION.md` -- schema 011 marked shipped

NOT modified (deliberate -- pricing decision deferred per Val 2026-05-18):
- `AV_livewebsite/js/packages.js` (no commercial-volume field per tier)
- `lib/client-portal/tiers.ts` (still uses legacy starter/growth)
- `schema/015_tier_rename.sql` (not written -- tier rename is its own session)
- `atlantic-hub/marketing/commercials-pricing.html` (still has Debut/Encore/Headliner names; needs full rebuild against Sprint/Momentum/Scale once Val signs off)
- `docs/PRODUCT_VISION.md` (still has legacy starter/growth references)

These are tracked in `docs/COMMERCIAL_GOLIVE_RUNBOOK.md` as the
"pending pricing decisions" punch list.

---

## VERIFICATION

- `npx tsc --noEmit` -> exit 0. Clean against `strict: true`.
- All new imports resolve (`@/lib/api-guard`, `@/lib/feature-flags`,
  `@/lib/db/av`, `@/lib/events/log`, `@/lib/grok/imagine`,
  `@/lib/grok/discoverer`).
- `npm run build` was not run in-session (~60-90s vs the sandbox's 45s
  bash cap). Val to run it locally before push -- the kickoff doc anticipates this.

---

## OPERATIONAL NOTES

- **No new storage credentials.** Per kickoff direction, we store the
  xAI-returned URL directly in `grok_imagine_assets.storage_url`. The
  URLs are reportedly long-lived, but the kickoff doc explicitly says
  "Future task: rehost to Atlantic Hub's own bucket." Plan: when a
  client downloads or auto-posts an asset, rehost on download.

- **No background queue / worker.** Video polling happens inline in the
  request handler (50s budget) and resumes on GET when a 'running'
  asset is fetched. If a video genuinely takes 5+ minutes, the running
  row will sit unresolved until the operator opens the panel (which
  triggers an auto-poll). For batch operation we'd want a small cron;
  not yet justified.

- **Cost guardrails are observability-only.** The `grok_imagine_log`
  table records cost per call but there is no hard quota enforcement at
  the route layer. To add one: count today's `cost_usd` summed across
  `grok_imagine_log` and reject when over $N before calling xAI.

- **Header is intentionally untouched.** No new button on the lead
  detail page header. The Commercials tab is the only entry point.

---

## WHAT THIS UNLOCKS

The biggest demo wow-factor on the platform: open any lead, generate an
on-brand commercial in under a minute, hand it to the client. This is
the closing weapon for the Sprint/Momentum/Scale conversation -- "we
made you a commercial as part of the audit, here it is." Pricing
integration (bundling these into the existing tiers vs selling them as
an a-la-carte add-on) is deferred to a follow-up session per Val
2026-05-18.
