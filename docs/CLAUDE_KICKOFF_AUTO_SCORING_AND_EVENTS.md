# Claude Code Session Kickoff: Auto AI Scoring + System Event Log

**Purpose of this doc:** Drop this entire file into a fresh Claude Code session.
It contains every fact, file path, schema reference, and deploy command needed
to ship two tightly coupled features in one focused session.

**Goal of the session:** Ship two things in one push:
1. **System event log** - unified `system_events` table that captures every important platform action. Becomes the observability layer + AI memory stream.
2. **Auto AI scoring on insert** - every new lead automatically gets scored + audited the moment it lands in the dashboard. No manual button click required.

These are bundled because the event log is what makes auto-scoring debuggable and observable. Build them together. They reinforce each other.

**Do not:**
- Trim scope. Both features ship today.
- Tell Val it's too much work. It isn't.
- Estimate hours or days. Just ship.
- Propose alternatives unless you find a hard technical blocker.

---

## PASTE THIS INTO THE NEW CLAUDE CHAT (top of message)

You are continuing the Atlantic & Vine / Atlantic Hub project. The owner is
Atlantic And Vine LLC (parent), operated by Val Fulton. Val is an experienced
founder shipping product across multiple business lines. Be confident, terse,
ASCII-only in shell commands and commit messages (no em-dashes, no smart
quotes, no curly typography of any kind).

Read these docs FIRST in this order before writing any code:
1. /Users/atlanticandvine/Library/CloudStorage/OneDrive-atlanticandvine.com/HunterHoney/_organized/atlantic-hub/docs/PROJECT_STATUS_2026-05-17.md
2. /Users/atlanticandvine/Library/CloudStorage/OneDrive-atlanticandvine.com/HunterHoney/_organized/atlantic-hub/docs/SYSTEM_ARCHITECTURE.md
3. /Users/atlanticandvine/Library/CloudStorage/OneDrive-atlanticandvine.com/HunterHoney/_organized/atlantic-hub/docs/PRODUCT_VISION.md
4. This file (CLAUDE_KICKOFF_AUTO_SCORING_AND_EVENTS.md)

After reading, build both features per the spec below. Ship today. Do not
propose phase-splitting. Do not propose timelines.

---

## CONTEXT YOU NEED

### Property layout (4 web properties)

| URL | Purpose | Source code | Deploy |
|-----|---------|-------------|--------|
| atlanticandvine.com | Pixieset photos | Pixieset | n/a |
| atlanticandvine.netlify.app | Marketing site | github.com/valfulton/atlanticandvine | Push to GitHub, Netlify auto-builds in ~30s |
| api.atlanticandvine.com | PHP backend | HostGator File Manager | Manual upload |
| atlantic-hub.netlify.app | Operator dashboard (this is what you'll edit) | github.com/valfulton/atlantic-hub | Push to GitHub, Netlify auto-builds in ~90s |

### File locations

- **Atlantic Hub repo on disk:** `/Users/atlanticandvine/Library/CloudStorage/OneDrive-atlanticandvine.com/HunterHoney/_organized/atlantic-hub/`
- **Schema migrations:** `atlantic-hub/schema/` (last applied is 008)
- **lib/ services:** organized by domain (apollo, google_places, apify, scraper, enrichment, openai, leads, csv)
- **Auth scaffolding:** `lib/api-guard.ts`, `lib/auth/session.ts`, `lib/auth/jwt.ts`

### Databases

Four HostGator MariaDB databases, prefix `shhdbite_`:
- `shhdbite_AV` - leads, lead_events, audits
- `shhdbite_atlantic_hub` - platform-level
- `shhdbite_eventsbywater` - EBW
- `shhdbite_hunterhoney` - HH

For this session you'll be working primarily in `shhdbite_AV`.

### Auth (the real enum)

Three roles: `'owner' | 'staff' | 'client_user'`. Defined in `lib/api-guard.ts:19`.
NOT the five-role list mentioned in older docs.

### Existing AI scoring logic

There IS already an AI scoring path in the codebase but it runs MANUALLY:
- Schema columns on `leads`: `ai_score`, `ai_score_band`, `ai_score_reason`, `ai_score_breakdown` (JSON), `ai_audit` (JSON), `ai_last_scored_at`, `ai_model_version`, `audit_content`, `audit_generated`
- These get populated by an existing audit pipeline that runs on the marketing site's PHP backend (audit-form submission triggers it)
- Audit content for those leads exists today (Val confirmed 2026-05-17)
- BUT: leads inserted via Apollo, Google Places, Instagram, CSV, scrape do NOT auto-score yet

Your job: extend the scoring/audit logic to fire on EVERY new lead insert, not just audit-form submissions. Plus log everything to the new event table.

### Existing domain-specific event tables (to be supplemented, not replaced)

- `lead_events` - status changes, notes added, tags on individual leads
- `apollo_search_log` - Apollo API call audit
- `hunter_credit_log` - Hunter API call audit

These stay. Your new `system_events` is the unified analytics surface that ALSO captures cross-cutting events (api.rate_limited, ai.scored, workflow.failed) that don't fit the domain-specific tables.

---

## FEATURE 1: SYSTEM EVENT LOG

### Migration: schema/009_system_events.sql

```sql
USE shhdbite_AV;

CREATE TABLE IF NOT EXISTS system_events (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  event_type VARCHAR(64) NOT NULL,
  organization_id BIGINT UNSIGNED NULL,
  lead_id BIGINT UNSIGNED NULL,
  user_id BIGINT UNSIGNED NULL,
  source VARCHAR(64) NULL,
  payload JSON NULL,
  status ENUM('success','failure','partial','pending') NOT NULL DEFAULT 'success',
  execution_time_ms INT UNSIGNED NULL,
  error_message VARCHAR(1000) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_event_type (event_type),
  KEY idx_lead_id (lead_id),
  KEY idx_status (status),
  KEY idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

Idempotent migration pattern (use the same `IF (col_exists = 0) THEN ALTER...` style from migration 008 for any indexes that might already exist).

### Library: lib/events/log.ts

Create a single exported helper:

```ts
export async function logEvent(args: {
  eventType: string;
  leadId?: number | null;
  userId?: number | null;
  organizationId?: number | null;
  source?: string;
  payload?: object;
  status?: 'success' | 'failure' | 'partial' | 'pending';
  executionTimeMs?: number;
  errorMessage?: string;
}): Promise<void>
```

Implementation: INSERT INTO `shhdbite_AV.system_events` using the existing `getAvDb()` pool. Wrap the actual db call in try/catch and silently swallow errors - event logging should NEVER break the calling code path. Log failures to console.error so they're visible in Netlify function logs.

### Event types to instrument

In this session, instrument these call sites. Use ASCII-safe event_type strings (dot-namespaced):

| Call site | event_type | Notes |
|-----------|-----------|-------|
| `lib/apollo/discoverer.ts` insertApolloOrgAsLead success | `lead.created` | source='apollo' |
| `lib/apollo/discoverer.ts` insertApolloPersonAsLead success | `lead.created` | source='apollo' |
| `lib/google_places/discoverer.ts` insertOnePlace success | `lead.created` | source='google_places' |
| `lib/apify/discoverer.ts` insertOneProfile success | `lead.created` | source='instagram' |
| `app/api/admin/av/leads/import-csv/route.ts` per inserted row | `lead.created` | source='csv' |
| `app/api/admin/av/discover/scrape/route.ts` per inserted row | `lead.created` | source='scrape' |
| `lib/enrichment/enricher.ts` per enrichment attempt | `lead.enriched` or `lead.enrichment_failed` | source='hunter' |
| `app/api/admin/av/leads/[audit_id]/social-content/route.ts` | `ai.social_content_generated` | source='openai' |
| `app/api/admin/av/discover/scrape-bulk/route.ts` per processed lead | `lead.bulk_enrichment_attempted` | source='scraper' |
| `lib/openai/client.ts` errors thrown | `api.openai_error` | log status='failure' |
| `lib/apollo/search.ts` errors thrown | `api.apollo_error` | log status='failure' |
| All `*.ApiError` thrown classes | `api.rate_limited` or `api.error` | log status='failure', include status code in payload |

Include the auto-scoring events from Feature 2 below.

### UI: /admin/events page

Build a simple read-only page at `app/admin/events/page.tsx` that shows the most recent 200 events with filters by event_type, status, source. Use the same DataTable component used elsewhere. Add a sidebar link "System events" under HunterHoney section (since it's a cross-tenant view, put it under the platform-level section, not under AV/EBW/HH).

Owner + staff roles only. Forbidden for client_user.

---

## FEATURE 2: AUTO AI SCORING ON LEAD INSERT

### Step 1: Find the existing scoring/audit logic

The audit-form (`atlanticandvine.netlify.app/audit-form`) currently produces ai_score, audit_content, etc. via the PHP backend. The actual prompt + model logic likely lives in `api/audit-process.php` or similar on HostGator. You can NOT call the PHP endpoint directly from Netlify functions (different host, different auth).

Solution: port the AI scoring + audit generation into a TypeScript service inside atlantic-hub that uses the existing `lib/openai/client.ts`. Call this from every lead-insert path.

### Step 2: Create lib/ai/score_and_audit.ts

```ts
import { openaiChatCompletion, parseOpenAIJson } from '@/lib/openai/client';
import { logEvent } from '@/lib/events/log';

export interface ScoreAndAuditResult {
  aiScore: number | null;
  aiScoreBand: 'hot' | 'warm' | 'cool' | null;
  aiScoreReason: string | null;
  aiScoreBreakdown: object | null;
  auditContent: string | null;
  auditGenerated: string | null;
  modelVersion: string;
  tokensUsed: number;
}

export async function scoreAndAuditLead(leadId: number): Promise<ScoreAndAuditResult | null> {
  // 1. SELECT the lead from shhdbite_AV.leads
  // 2. If lead has no website AND no real email AND no industry -> return null (insufficient data)
  // 3. Build a prompt that asks gpt-4o-mini to return JSON:
  //    {
  //      "ai_score": 0-100,
  //      "ai_score_band": "hot" | "warm" | "cool",
  //      "ai_score_reason": "1-2 sentences",
  //      "ai_score_breakdown": { "fit": 0-100, "intent": 0-100, "reachability": 0-100, "icp_match": 0-100 },
  //      "audit_content": "Markdown strategic marketing audit, 300-600 words"
  //    }
  // 4. UPDATE the lead with the result columns. Set ai_last_scored_at = NOW().
  // 5. logEvent({ eventType: 'ai.lead_scored', leadId, ... })
  // 6. logEvent({ eventType: 'ai.audit_generated', leadId, ... })
  // 7. Return the parsed result
}
```

Use `gpt-4o-mini` model. Temperature 0.4 for scoring (low for consistency). Max tokens 1500.

### Step 3: Wire into every insert path

After each successful `INSERT INTO leads` in:
- `lib/apollo/discoverer.ts` (both insertApolloOrgAsLead and insertApolloPersonAsLead)
- `lib/google_places/discoverer.ts` (insertOnePlace)
- `lib/apify/discoverer.ts` (insertOneProfile)
- `app/api/admin/av/leads/import-csv/route.ts` (per row insert)
- `app/api/admin/av/discover/scrape/route.ts` (handleNewMode)
- Existing audit-form submission path (touch only if you find it in the Next.js codebase; if it's on the PHP side, skip - leave that pipeline intact)

Pattern:
```ts
const insertResult = await db.execute(`INSERT INTO leads ...`);
const newLeadId = insertResult[0].insertId;

// Fire-and-forget AI scoring. Don't block the discovery response.
scoreAndAuditLead(newLeadId).catch(err => {
  console.error('[auto-score]', err);
  // logEvent will already have captured this
});
```

Critical: do NOT await. Fire and forget. The discovery batch response should return immediately. Scoring runs in the background. Netlify function will keep running until the promise settles.

### Step 4: Cron sweep for missed leads

Some leads might fail to score on insert (rate limit, transient error). Add a daily sweep:
- Netlify scheduled function at `netlify/functions/score-cron.mts`
- Schedule: `0 7 * * *` (daily 7 AM UTC, one hour after the existing enrichment cron at 6 AM)
- Logic: SELECT leads WHERE ai_last_scored_at IS NULL AND archived_at IS NULL LIMIT 50. Call scoreAndAuditLead on each.
- Use the existing `ENRICHMENT_CRON_SECRET` env var or create `SCORING_CRON_SECRET`.

### Step 5: UI badge on leads list

Already exists. AvLeadsTable already shows `ai_score_band` as a StatusBadge. No UI change needed.

### Step 6: Owner override "Re-score" button

On `/admin/av/[audit_id]` lead detail page header, next to the existing buttons, add a "Re-score" button that calls `POST /api/admin/av/leads/[audit_id]/score` which triggers `scoreAndAuditLead(leadId)` and returns the result. Owner + staff only.

---

## ENV VARS TO ADD (may not need new ones)

The OpenAI client already reads `OPENAI_API_KEY`. The new cron will use either `ENRICHMENT_CRON_SECRET` (reusable) or a new `SCORING_CRON_SECRET`. Pick reusable.

No new external API keys required.

---

## TYPESCRIPT MUST COMPILE CLEAN

Before commit:

```
cd "$HOME/Library/CloudStorage/OneDrive-atlanticandvine.com/HunterHoney/_organized/atlantic-hub"
npx tsc --noEmit
```

Exit code 0 or no ship.

---

## DEPLOY (after build)

```
cd "$HOME/Library/CloudStorage/OneDrive-atlanticandvine.com/HunterHoney/_organized/atlantic-hub"
git add -A
git commit -m "av: system event log plus auto AI scoring on every lead insert"
git push origin main
```

Netlify auto-builds in ~90s. Then Val runs `schema/009_system_events.sql` in phpMyAdmin against `shhdbite_AV`.

If git push fails with mysterious lock errors: Val restarts her computer. Restart fixes it. Do not propose moving repos out of OneDrive (Val has rejected this).

---

## VERIFICATION BEFORE YOU CLAIM DONE

1. `npx tsc --noEmit` returns exit 0
2. Schema 009 runs idempotently in phpMyAdmin without error
3. Trigger a real Google Places search from /admin/av/discover. Within 30 seconds, verify in phpMyAdmin:
   - new rows in `leads` with `source_type='scrape'`
   - new rows in `system_events` with `event_type='lead.created'`
   - within ~10 more seconds, new rows in `system_events` with `event_type='ai.lead_scored'`
   - leads table now has populated `ai_score`, `ai_score_band`, `audit_content` columns
4. Navigate to `/admin/events` - see the event log rendering
5. Click into a freshly-scored lead - see the AI audit content displayed
6. Manually click "Re-score" - new ai_last_scored_at timestamp, new system_events row

---

## WHAT YOU SHOULD NOT DO

- Do not propose Supabase. Val has rejected this.
- Do not propose n8n. Not needed yet.
- Do not propose breaking this into multiple sessions. Both features ship in this session.
- Do not estimate hours or days in your messages back to Val.
- Do not use smart quotes or em-dashes anywhere.
- Do not migrate the PHP audit pipeline. Leave it intact. Build a parallel TypeScript path that handles every OTHER insert source.
- Do not block discovery responses on scoring. Fire and forget.

---

## WHEN YOU FINISH

Update `/docs/PROJECT_STATUS_2026-05-17.md` (or append `_2026-05-17b.md`) with:
- What shipped (file paths, commit hash)
- New system_events table is live
- Auto AI scoring is now firing on every Apollo / Places / Instagram / CSV / scrape insert
- Daily 7 AM UTC sweep cron picks up any that missed
- /admin/events is the new observability surface

Commit and push. Done. Hand back a one-paragraph summary to Val.

---

LFG. Ship it.
