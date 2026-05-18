# Claude Code Session Kickoff: PhantomBuster Webhook Receiver

**Purpose:** Drop into a fresh Claude Code session. Wires Atlantic Hub to receive results from PhantomBuster "phantoms" (browser-automation runs) so LinkedIn scrapes and other PB outputs flow into `shhdbite_AV.leads` automatically.

**Why now:** Val plans to trial PhantomBuster. Wiring the receiver before activation means her first run is useful instead of needing manual CSV export.

---

## PASTE THIS INTO THE NEW CLAUDE CHAT (top of message)

You are continuing the Atlantic & Vine / Atlantic Hub project. Atlantic And Vine
LLC, operated by Val Fulton. Be confident, terse, ASCII-only in shell commands
and commit messages (no em-dashes, no smart quotes, no curly punctuation).

Read these docs FIRST:
1. `docs/PROJECT_BRIEFING_2026-05-18.md` -- THE master briefing
2. `docs/CLIENT_FACING_GUARDRAILS.md` -- NEVER show per-unit API cost on client surfaces
3. `docs/SESSION_COORDINATION.md` (PhantomBuster reserves schema 013)
4. `docs/PROJECT_STATUS_2026-05-17.md` + `PROJECT_STATUS_2026-05-17c.md`
5. `docs/SYSTEM_ARCHITECTURE.md`
6. `docs/PRODUCT_VISION.md`
7. This file

After reading, ship per spec.

---

## SCOPE RESERVATIONS

- **Schema migration:** `schema/013_phantombuster_runs.sql` (reserved 013)
- **New files OWNED:**
  - `lib/phantombuster/webhook.ts` (payload validation + dispatch)
  - `lib/phantombuster/discoverer.ts` (insert-as-lead OR enrich-existing logic for PB output formats)
  - `lib/phantombuster/api.ts` (optional: PB API client for run status polling, future feature)
  - `app/api/admin/av/integrations/phantombuster-webhook/route.ts` (POST receiver)
  - `app/admin/av/integrations/phantombuster/page.tsx` (status page, view recent runs)
- **Modified files OWNED:** none (pure additive)
- **Cross-touch:** none
- **Will NOT touch:** existing discovery routes, auth, /client/*, any other schema files
- **Upstream dependencies:** none
- **Parallel-safe with:** every other in-flight session

---

## HOW PHANTOMBUSTER WEBHOOKS WORK

PhantomBuster phantoms can be configured with a webhook URL that fires when the phantom finishes. The webhook POST contains the phantom run metadata + the output CSV URL (or JSON URL).

The receiver needs to:
1. Verify the request came from PhantomBuster
2. Fetch the output file from the URL PhantomBuster provides
3. Parse it (CSV or JSON depending on phantom type)
4. Iterate each row through the dedup + insert pipeline

Auth pattern: PhantomBuster supports a `X-PhantomBuster-Token` header you set in the phantom config. Use a shared secret approach via `PHANTOMBUSTER_WEBHOOK_SECRET` env var. Validate header on every request.

---

## SCHEMA TO BUILD

### `schema/013_phantombuster_runs.sql`

```sql
USE shhdbite_AV;

SET @col_exists := (SELECT COUNT(*) FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = 'shhdbite_AV' AND TABLE_NAME = 'phantombuster_runs_log');
SET @sql := IF(@col_exists = 0,
  "CREATE TABLE phantombuster_runs_log (
     id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
     received_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
     phantom_id VARCHAR(128) NULL,
     phantom_name VARCHAR(255) NULL,
     run_id VARCHAR(128) NULL,
     output_url VARCHAR(1024) NULL,
     output_format ENUM('csv','json','unknown') NOT NULL DEFAULT 'unknown',
     rows_received INT UNSIGNED NOT NULL DEFAULT 0,
     rows_inserted INT UNSIGNED NOT NULL DEFAULT 0,
     rows_updated INT UNSIGNED NOT NULL DEFAULT 0,
     rows_duplicate INT UNSIGNED NOT NULL DEFAULT 0,
     rows_invalid INT UNSIGNED NOT NULL DEFAULT 0,
     outcome ENUM('success','partial','failed') NOT NULL DEFAULT 'success',
     error_message VARCHAR(500) NULL,
     KEY idx_pb_log_received (received_at),
     KEY idx_pb_log_phantom (phantom_id),
     KEY idx_pb_log_outcome (outcome)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
  "SELECT 'phantombuster_runs_log already exists' AS info");
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
```

---

## WHAT TO BUILD

### `lib/phantombuster/webhook.ts`
- `verifyPhantomBusterToken(req)` — checks `X-PhantomBuster-Token` against `process.env.PHANTOMBUSTER_WEBHOOK_SECRET`
- `parsePhantomBusterPayload(body)` — extracts: phantomId, phantomName, runId, outputUrl, format

### `lib/phantombuster/discoverer.ts`
- `ingestPhantomBusterRun(payload)`:
  1. Fetch the output URL (use built-in `fetch`)
  2. Parse CSV (use existing `lib/csv/parser.ts:parseCsv` + `mapHeaders`) or JSON depending on output_format
  3. For each row:
     - Dedup via `findExistingLead`
     - INSERT new with source_type='api', source_payload includes the phantom_id + run_id + raw row
     - Update existing with missing fields if dedup hits
  4. Track counts (inserted / updated / duplicate / invalid)
  5. Log one summary row to `phantombuster_runs_log`
  6. For each new lead, call `scoreAndAuditLeadBackground` if auto-scoring session has shipped, else skip
  7. Log `lead.created` event per row if events session has shipped, else skip

Use the same fuzzy header-mapping pattern as CSV import. PhantomBuster outputs have field names like `firstName`, `lastName`, `company`, `linkedInUrl`, `email`, `companyWebsite`, `jobTitle`. The existing `mapHeaders` function will fuzzy-match these.

LinkedIn-specific handling: if a row has `linkedInUrl`, store it in `source_payload.linkedin_url` and use it as a strong identity signal. Strip to lowercase username for dedup token (e.g., `li:johnsmith`).

### API route `app/api/admin/av/integrations/phantombuster-webhook/route.ts`

POST handler:
1. Verify token header
2. Parse payload
3. Spawn `ingestPhantomBusterRun` (await it for v1 since runs are typically small)
4. Return 200 with summary `{ ok, inserted, updated, duplicate, invalid }`

Webhook endpoints SHOULD NOT use `guardAdminRequest` — they're called by PB servers, not authenticated users. Use the shared secret.

Add rate limiting: one run per minute per phantom_id (prevents accidental duplicate-fire).

### Status page `app/admin/av/integrations/phantombuster/page.tsx`

- Lists last 50 rows from `phantombuster_runs_log`
- Shows aggregate stats: total leads created from PhantomBuster, top phantoms by yield
- Webhook URL displayed for copy-paste into PhantomBuster
- Setup instructions: "Paste this URL in PhantomBuster > Phantom > Settings > Webhooks > URL. Set X-PhantomBuster-Token header to PHANTOMBUSTER_WEBHOOK_SECRET value."

Owner + staff only.

---

## ENV VARS TO ADD

- `PHANTOMBUSTER_WEBHOOK_SECRET` — generate random 32-char hex (`openssl rand -hex 32`)
- `PHANTOMBUSTER_API_KEY` — only if you build the optional API polling fallback. Not required for v1 webhook-only.

Document in `docs/ENV_VARS_REFERENCE.md`.

---

## VERIFICATION BEFORE COMMIT

1. `npx tsc --noEmit` returns exit 0
2. `npm run build` returns "Compiled successfully"
3. Schema 013 runs idempotently
4. Curl test with invalid token returns 401
5. Curl test with valid token + small mock JSON payload returns 200 with summary

---

## DEPLOY

```
cd "$HOME/Library/CloudStorage/OneDrive-atlanticandvine.com/HunterHoney/_organized/atlantic-hub"
git add -A
git commit -m "phantombuster: webhook receiver and status page, schema 013"
git push origin main
```

Val runs schema 013 in phpMyAdmin. Sets env vars. Configures webhook URL in PhantomBuster phantom settings.

---

## ON FINISH

Update `docs/PROJECT_STATUS_2026-05-17.md`. Append to `docs/CHANGELOG.md`. Mark 013 as shipped in `SESSION_COORDINATION.md`. Hand back a one-paragraph summary.
