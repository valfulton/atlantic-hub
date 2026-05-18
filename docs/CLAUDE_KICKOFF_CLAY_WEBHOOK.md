# Claude Code Session Kickoff: Clay Webhook Receiver

**Purpose:** Drop into a fresh Claude Code session. Wires Atlantic Hub to receive enrichment results from Clay so when a Clay table finishes processing, the enriched contact data flows into `shhdbite_AV.leads` automatically.

**Why now:** Val plans to trial Clay. Wiring the receiver before she activates means her first Clay run is useful instead of stuck in a CSV export loop.

---

## PASTE THIS INTO THE NEW CLAUDE CHAT (top of message)

You are continuing the Atlantic & Vine / Atlantic Hub project. Atlantic And Vine
LLC, operated by Val Fulton. Be confident, terse, ASCII-only in shell commands
and commit messages (no em-dashes, no smart quotes, no curly punctuation).

Read these docs FIRST:
1. `/Users/atlanticandvine/Library/CloudStorage/OneDrive-atlanticandvine.com/HunterHoney/_organized/atlantic-hub/docs/SESSION_COORDINATION.md`
2. `/Users/atlanticandvine/Library/CloudStorage/OneDrive-atlanticandvine.com/HunterHoney/_organized/atlantic-hub/docs/PROJECT_STATUS_2026-05-17.md`
3. `/Users/atlanticandvine/Library/CloudStorage/OneDrive-atlanticandvine.com/HunterHoney/_organized/atlantic-hub/docs/SYSTEM_ARCHITECTURE.md`
4. This file

After reading, build per spec. Ship today.

---

## SCOPE RESERVATIONS

- **Schema migration:** `schema/012_clay_enrichment.sql` (reserved 012)
- **New files OWNED:**
  - `lib/clay/webhook.ts` (payload validation + dispatch)
  - `lib/clay/discoverer.ts` (insert-as-lead OR enrich-existing-lead logic)
  - `app/api/admin/av/integrations/clay-webhook/route.ts` (POST receiver)
  - `app/admin/av/integrations/clay/page.tsx` (status page, view recent runs)
- **Modified files OWNED:** none (pure additive)
- **Cross-touch:** none
- **Will NOT touch:** existing discovery routes, auth, /client/*, schema files outside 012
- **Upstream dependencies:** none
- **Parallel-safe with:** every other in-flight session

---

## HOW CLAY WEBHOOKS WORK

Clay tables can be configured to POST to a webhook URL when a row finishes processing. You'll publish a URL like:

```
https://atlantic-hub.netlify.app/api/admin/av/integrations/clay-webhook
```

Val sets this URL inside Clay table settings. Every enriched row in that Clay table fires a POST with the row data as JSON. Your endpoint authenticates via a shared secret header.

Authentication pattern: `X-Clay-Signature: <hmac-sha256 of body>` OR simpler `X-Webhook-Secret: <CLAY_WEBHOOK_SECRET>`. Use the secret-header approach for v1 — simpler, no HMAC complexity, security-equivalent given HTTPS.

---

## SCHEMA TO BUILD

### `schema/012_clay_enrichment.sql`

```sql
USE shhdbite_AV;

SET @col_exists := (SELECT COUNT(*) FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = 'shhdbite_AV' AND TABLE_NAME = 'clay_enrichment_log');
SET @sql := IF(@col_exists = 0,
  "CREATE TABLE clay_enrichment_log (
     id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
     received_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
     clay_table_id VARCHAR(128) NULL,
     clay_row_id VARCHAR(128) NULL,
     lead_id BIGINT UNSIGNED NULL,
     outcome ENUM('inserted','updated','duplicate','invalid','error') NOT NULL DEFAULT 'inserted',
     payload JSON NULL,
     error_message VARCHAR(500) NULL,
     KEY idx_clay_log_received (received_at),
     KEY idx_clay_log_outcome (outcome),
     KEY idx_clay_log_lead (lead_id)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
  "SELECT 'clay_enrichment_log already exists' AS info");
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
```

---

## WHAT TO BUILD

### `lib/clay/webhook.ts`
- `verifyClaySignature(req)` — checks `X-Webhook-Secret` header against `process.env.CLAY_WEBHOOK_SECRET`. Returns boolean.
- `parseClayPayload(body)` — extracts the fields we care about: company, email, phone, website, linkedin_url, contact_name, contact_title, industry, location, plus any custom-named fields Clay can send. Use fuzzy keys (Clay's column names are user-defined).

### `lib/clay/discoverer.ts`
- `ingestClayRow(payload)` — runs cross-source dedup using `findExistingLead` from `lib/leads/dedup.ts`:
  - If existing lead found by domain → UPDATE missing fields (email/phone/contact_name) without overwriting real data
  - If new → INSERT new lead with source_type='api', target_business inferred from industry
- Calls `scoreAndAuditLeadBackground` for new inserts (if auto-scoring session has shipped, otherwise skip gracefully)
- Logs to `clay_enrichment_log` with outcome
- Calls `logEvent({ eventType: 'lead.enriched_clay', leadId, source: 'clay', ... })` if events table exists, else skip gracefully

### API route `app/api/admin/av/integrations/clay-webhook/route.ts`

POST handler:
1. Verify secret header — return 401 if invalid
2. Parse payload — return 400 if no recognizable fields
3. Call `ingestClayRow`
4. Return 200 with `{ ok: true, outcome, leadId? }`

Webhook endpoints SHOULD NOT use `guardAdminRequest` because they're called by Clay servers, not authenticated users. Use the shared secret instead.

Add rate limiting: max 100 requests / minute / clay_table_id to avoid runaway costs. Use a simple in-memory rate limit map or check `clay_enrichment_log` for recent count.

### Status page `app/admin/av/integrations/clay/page.tsx`

- Lists last 50 rows from `clay_enrichment_log`
- Shows outcome distribution (inserted / updated / duplicate counts)
- Has "Webhook URL" displayed at top so Val can copy it into Clay
- Has setup instructions: "Paste this URL in Clay > Table > Webhook. Set secret header X-Webhook-Secret to your CLAY_WEBHOOK_SECRET value."

Owner + staff only.

---

## ENV VARS TO ADD

- `CLAY_WEBHOOK_SECRET` — generate a random 32-char hex string (Val does this herself: `openssl rand -hex 32`)

Document in `docs/ENV_VARS_REFERENCE.md`.

---

## VERIFICATION BEFORE COMMIT

1. `npx tsc --noEmit` returns exit 0
2. `npm run build` returns "Compiled successfully"
3. Schema 012 runs idempotently
4. Curl test: `curl -X POST https://atlantic-hub.netlify.app/api/admin/av/integrations/clay-webhook -H "X-Webhook-Secret: bad" -H "Content-Type: application/json" -d '{}'` returns 401
5. Curl test with valid secret + valid payload returns 200 with leadId

---

## DEPLOY

```
cd "$HOME/Library/CloudStorage/OneDrive-atlanticandvine.com/HunterHoney/_organized/atlantic-hub"
git add -A
git commit -m "clay: webhook receiver and status page, schema 012"
git push origin main
```

Val runs schema 012 in phpMyAdmin. Sets `CLAY_WEBHOOK_SECRET` in Netlify env vars. Sets up the webhook URL in her Clay account.

---

## ON FINISH

Update `docs/PROJECT_STATUS_2026-05-17.md`, append to `docs/CHANGELOG.md`, mark 012 as shipped in `SESSION_COORDINATION.md`. Hand back a one-paragraph summary.
