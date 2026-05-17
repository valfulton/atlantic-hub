# Atlantic Hub -- Project Status 2026-05-17 (b)

Companion to PROJECT_STATUS_2026-05-17.md. Captures the auto-AI-scoring +
system-event-log shipment.

---

## WHAT SHIPPED (2026-05-17b)

Two tightly coupled features landed in one push.

### 1. System event log (cross-cutting observability)

A new unified `system_events` table in `shhdbite_AV`. It supplements (does
NOT replace) the existing domain-specific log tables -- `lead_events`,
`apollo_search_log`, `hunter_credit_log` all keep working unchanged.

`system_events` is the cross-cutting analytics surface that captures
events spanning multiple domains: every lead insert across all 5
discovery sources, every AI scoring run, every enrichment attempt
(success and failure), every OpenAI / Apollo API error, every rate-limit
hit, every cron run.

Schema columns: `id`, `event_type`, `organization_id`, `lead_id`,
`user_id`, `source`, `payload` (JSON), `status` (success/failure/partial/
pending), `execution_time_ms`, `error_message`, `created_at` (millisecond
precision). Indexed on event_type, lead_id, status, source, created_at.

New observability surface at `/admin/events`. Owner + staff only.
Filterable by event_type, status, source. Read-only DataTable showing
the 200 most recent events (configurable via `?limit=` up to 500).

Sidebar gets a new "System events" link at the platform-level section.

### 2. Auto AI scoring on every new lead insert

Every newly inserted lead now gets scored + audited automatically in the
background -- no manual button click required. Fire-and-forget pattern so
the discovery batch response returns immediately; scoring continues until
the Netlify function promise settles.

Insert paths wired:
- Apollo organization shell inserts (`lib/apollo/discoverer.ts`)
- Apollo top-people inserts (`lib/apollo/discoverer.ts`)
- Google Places inserts (`lib/google_places/discoverer.ts`)
- Instagram (Apify) inserts (`lib/apify/discoverer.ts`)
- CSV import inserts (`app/api/admin/av/leads/import-csv/route.ts`)
- Direct contact-page scrape new-mode inserts (`app/api/admin/av/discover/scrape/route.ts`)

The PHP-side audit-form pipeline is untouched. The new TypeScript path
handles every OTHER insert source.

The scoring service `lib/ai/score_and_audit.ts` uses gpt-4o-mini at
temperature 0.4, requests strict JSON output, and writes back to
`leads.ai_score`, `ai_score_band`, `ai_score_reason`, `ai_score_breakdown`,
`ai_audit` (full forensic JSON), `audit_content`, `audit_generated`,
`ai_last_scored_at`, `ai_model_version`. Insufficient-data leads (no
real email, no website, no industry) are skipped with a partial-status
event.

### 3. Safety net: daily cron sweep

`netlify/functions/score-cron.mts` runs daily at 07:00 UTC, one hour
after the existing enrichment cron at 06:00 UTC. Calls the new
`/api/admin/av/score-sweep` endpoint which picks up leads where
`ai_last_scored_at IS NULL AND archived_at IS NULL`, limit 50 per run.

Reuses the existing `ENRICHMENT_CRON_SECRET` env var so deploy
operators don't manage a second secret.

Includes a soft 55-second deadline inside the sweep so the function
returns gracefully rather than hard-timeout if the batch runs long.

### 4. Owner / staff "Re-score" button

New button on `/admin/av/[audit_id]` lead detail page header, next to
the existing "Generate social content" button. Calls
`POST /api/admin/av/leads/[audit_id]/score` synchronously and triggers
`router.refresh()` on success so the new score / band / audit content
all render fresh without a manual reload. Forbidden for `client_user`.

---

## FILES TOUCHED / ADDED

New:
- `schema/010_system_events.sql` -- idempotent migration
- `lib/events/log.ts` -- single `logEvent()` helper (never throws)
- `lib/ai/score_and_audit.ts` -- scoreAndAuditLead + scoreAndAuditLeadBackground
- `app/api/admin/events/route.ts` -- GET handler for the events page
- `app/admin/events/page.tsx` -- server component
- `app/admin/events/EventsTable.tsx` -- client filter + table
- `app/api/admin/av/leads/[audit_id]/score/route.ts` -- Re-score endpoint
- `app/admin/av/[audit_id]/RescoreButton.tsx` -- header button
- `app/api/admin/av/score-sweep/route.ts` -- cron sweep endpoint
- `netlify/functions/score-cron.mts` -- daily 07:00 UTC schedule

Modified:
- `lib/apollo/discoverer.ts` -- logEvent on lead.created + workflow.failed + api.apollo_error / api.rate_limited; fire-and-forget scoring
- `lib/google_places/discoverer.ts` -- logEvent on lead.created + workflow.failed; fire-and-forget scoring
- `lib/apify/discoverer.ts` -- same instrumentation for Instagram inserts
- `lib/enrichment/enricher.ts` -- logEvent on lead.enriched / lead.enrichment_failed (success, no_results, api_error, no_domain)
- `app/api/admin/av/leads/import-csv/route.ts` -- logEvent + fire-and-forget scoring per row
- `app/api/admin/av/discover/scrape/route.ts` -- logEvent + fire-and-forget scoring on handleNewMode insert
- `app/api/admin/av/discover/scrape-bulk/route.ts` -- logEvent lead.bulk_enrichment_attempted per processed lead
- `app/api/admin/av/leads/[audit_id]/social-content/route.ts` -- logEvent on ai.social_content_generated + api.openai_error / api.rate_limited
- `app/admin/av/[audit_id]/page.tsx` -- mount the new RescoreButton
- `components/Sidebar.tsx` -- added "System events" link under Home

Total: 10 new files, 10 modified files.

---

## VERIFICATION CHECKLIST

Run after Val deploys + applies the migration:

1. `npx tsc --noEmit` -> exit 0 (already verified pre-commit).
2. Run `schema/010_system_events.sql` in phpMyAdmin against `shhdbite_AV`.
   Confirm: `SELECT COUNT(*) FROM system_events;` returns 0.
3. Trigger a real Google Places search from `/admin/av/discover`. Within
   30 seconds, verify in phpMyAdmin:
   - new rows in `leads` with `source_type='scrape'`
   - new rows in `system_events` with `event_type='lead.created'` and
     `source='google_places'`
   - within ~10 more seconds, new rows in `system_events` with
     `event_type='ai.lead_scored'` and `event_type='ai.audit_generated'`
   - those `leads` rows now have populated `ai_score`, `ai_score_band`,
     `audit_content`, `ai_last_scored_at`
4. Navigate to `/admin/events` -- see the event log rendering with
   filter controls.
5. Click into a freshly-scored lead -- see the AI audit content displayed.
6. Click the new "Re-score" button -- new `ai_last_scored_at` timestamp,
   new `system_events` rows for the manual re-run.

---

## OPERATIONAL NOTES

- **No new env vars required.** OpenAI client already reads
  `OPENAI_API_KEY`. The cron reuses `ENRICHMENT_CRON_SECRET`.
- **Cost guardrails.** gpt-4o-mini at ~$0.005-0.015 per scoring call.
  A full daily 50-lead sweep costs ~$0.25-0.75. Insert bursts that
  generate dozens of leads at once will spike OpenAI usage temporarily;
  the existing OpenAI billing alerts (if configured) catch this.
- **PHP audit pipeline untouched.** Leads inserted by the marketing-site
  audit form still flow through `api.atlanticandvine.com` as before.
  The new auto-scoring only covers leads inserted via Apollo / Places /
  Instagram / CSV / scrape -- i.e. every OTHER source.
- **Fire-and-forget caveat.** If the Netlify function ends before the
  scoring promise settles, the lead lands but the score does not. The
  daily 07:00 UTC sweep picks it up the next morning. The two events
  `ai.lead_scored` + `ai.audit_generated` are visible in
  `/admin/events` for triage if it does fail.
- **`system_events` is append-only.** No retention policy yet. Revisit
  if the table grows past ~10M rows (probably not for 12+ months at
  current insert volume).

---

## WHAT THIS UNLOCKS

The event log is the foundation for Phase 2E (Workflow monitoring) and
the destination-state closed-loop intelligence pipeline. Future sessions
can:

- Stream `system_events` into the AI memory layer (vector embeddings of
  audit_content + score history -> retrieve "similar past leads" when
  scoring a new one).
- Build per-source health dashboards (Apollo error rate, OpenAI rate-
  limit frequency, Hunter no-results rate over time).
- Wire automated retries on `workflow.failed` events.
- Surface `api.cost_threshold_hit` events from OpenAI billing webhooks
  once instrumented.

Auto-scoring on insert makes the existing dashboard feel magical: every
new lead lands already scored and audited, with the audit ready to send
to the prospect.
