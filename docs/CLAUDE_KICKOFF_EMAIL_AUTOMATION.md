# Claude Code Session Kickoff: Email Outreach Automation (Phase 2C)

**Purpose:** Drop this entire file into a fresh Claude Code session.
**Goal:** Wire Atlantic Hub to draft, queue, send, and track cold email outreach via Instantly. Every high-scoring lead gets an AI-drafted message based on its audit content. Operator approves. System sends. Replies route back into the dashboard.

**Why this is the highest-revenue Phase 2 feature:** It closes the loop. Lead discovered + scored + audited is meaningless if no email goes out. This makes the platform a sales engine, not a research tool.

---

## PASTE THIS INTO THE NEW CLAUDE CHAT (top of message)

You are continuing the Atlantic & Vine / Atlantic Hub project. Atlantic And Vine
LLC, operated by Val Fulton. Be confident, terse, ASCII-only in shell commands
and commit messages (no em-dashes, no smart quotes, no curly punctuation).

Read these docs FIRST in this order:
1. `docs/PROJECT_BRIEFING_2026-05-18.md` -- THE master briefing, updated state of the whole platform
2. `docs/CLIENT_FACING_GUARDRAILS.md` -- non-negotiable: NEVER show per-unit API cost on client surfaces (including outbound email templates sent to clients)
3. `docs/SESSION_COORDINATION.md` -- schema registry + file-ownership protocol (Email Automation reserves schema 014)
4. `docs/PROJECT_STATUS_2026-05-17.md` + `PROJECT_STATUS_2026-05-17c.md`
5. `docs/SYSTEM_ARCHITECTURE.md`
6. `docs/PRODUCT_VISION.md` -- locked tier names sprint/momentum/scale at $1,995/$3,995/$7,995
7. `docs/COSMETIC_BASELINE.md` (read this before adding UI - the gamification components are already built, reuse them)
8. This file

All under `/Users/atlanticandvine/Library/CloudStorage/OneDrive-atlanticandvine.com/HunterHoney/_organized/atlantic-hub/`.

Ship today.

---

## SCOPE RESERVATIONS (read SESSION_COORDINATION.md first)

- **Schema migration:** `schema/014_outreach.sql` (reserved 014 in registry)
- **New files OWNED:**
  - `lib/instantly/client.ts` (Instantly API client)
  - `lib/instantly/sync.ts` (sequence + campaign sync logic)
  - `lib/ai/outreach_drafter.ts` (OpenAI-powered draft generation per lead)
  - `app/api/admin/av/outreach/campaigns/route.ts` (list + create campaigns)
  - `app/api/admin/av/outreach/campaigns/[id]/route.ts` (get + update campaign)
  - `app/api/admin/av/outreach/messages/route.ts` (list pending drafts)
  - `app/api/admin/av/outreach/messages/[id]/approve/route.ts` (approve draft to send)
  - `app/api/admin/av/outreach/messages/[id]/reject/route.ts` (reject + reason)
  - `app/api/admin/av/outreach/draft/[audit_id]/route.ts` (POST: generate a draft for one lead)
  - `app/api/admin/av/outreach/instantly-webhook/route.ts` (receive open/click/reply events from Instantly)
  - `app/admin/av/outreach/page.tsx` (campaign list + queue overview)
  - `app/admin/av/outreach/[campaign_id]/page.tsx` (per-campaign approval queue)
  - `app/admin/av/[audit_id]/OutreachPanel.tsx` (per-lead outreach status component)
- **Modified files OWNED:**
  - `app/admin/av/[audit_id]/LeadDetailTabs.tsx` (add "Outreach" tab if not already added by another session)
  - `components/Sidebar.tsx` (add "Outreach" nav link under Atlantic & Vine)
- **Cross-touch:** none
- **Will NOT touch:** any `/client/*` routes, any `/admin/events*` infrastructure, discovery routes, auth files, schema files outside 014
- **Upstream dependencies:** Auto-Scoring + Events session shipped (uses logEvent + lead audit_content)
- **Parallel-safe with:** Grok Imagine (schema 011), Clay Webhook (012), PhantomBuster Webhook (013), Accessibility Audit (no schema)

---

## CRITICAL PREREQUISITES (Val tasks, not Claude tasks)

Before this feature can SEND emails, Val must complete these. Do not block your build on them. The code ships even if Val hasn't done them yet — emails just won't physically deliver until she does.

### 1. DNS records on atlanticandvine.com

Required for cold email to land in inboxes instead of spam folders:

- **SPF record:** TXT record at root: `v=spf1 include:_spf.instantly.app include:_spf.google.com ~all` (adjust includes per actual mail providers in use)
- **DKIM:** generated per-domain by Instantly during onboarding. Copy the CNAME/TXT values they give and add at DNS registrar.
- **DMARC:** TXT record at `_dmarc.atlanticandvine.com`: `v=DMARC1; p=quarantine; rua=mailto:dmarc@atlanticandvine.com`

### 2. Instantly account + sending mailbox

- Sign up at instantly.ai
- Add `outreach@atlanticandvine.com` (or whichever sending mailbox) as a sending account
- Complete Instantly's 2-4 week email warmup BEFORE sending real volume
- Generate an API key from Instantly settings

### 3. Netlify env vars (Val sets these after Instantly account is ready)

- `INSTANTLY_API_KEY`
- `INSTANTLY_WEBHOOK_SECRET` (random hex string Val generates)

Document in `docs/ENV_VARS_REFERENCE.md`.

---

## SCHEMA TO BUILD

### `schema/014_outreach.sql`

Use the same idempotent `information_schema` guard pattern as migration 008.

```sql
USE shhdbite_AV;

-- Campaign-level metadata (one campaign per ICP/audience/sequence)
CREATE TABLE IF NOT EXISTS outreach_campaigns (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT NULL,
  instantly_campaign_id VARCHAR(128) NULL,
  target_business ENUM('av','ebw','both') NOT NULL DEFAULT 'av',
  status ENUM('draft','active','paused','archived') NOT NULL DEFAULT 'draft',
  sending_mailbox VARCHAR(255) NULL,
  sequence_json JSON NULL,
  daily_send_limit INT UNSIGNED NOT NULL DEFAULT 25,
  created_by_user_id BIGINT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  archived_at DATETIME NULL,
  KEY idx_outreach_campaigns_status (status),
  KEY idx_outreach_campaigns_target (target_business)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Per-lead per-campaign draft + send tracking
CREATE TABLE IF NOT EXISTS outreach_messages (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  campaign_id BIGINT UNSIGNED NOT NULL,
  lead_id BIGINT UNSIGNED NOT NULL,
  sequence_step TINYINT UNSIGNED NOT NULL DEFAULT 1,
  subject VARCHAR(500) NOT NULL,
  body MEDIUMTEXT NOT NULL,
  ai_model VARCHAR(64) NULL,
  ai_tokens_used INT UNSIGNED NULL,
  status ENUM('draft','pending_approval','approved','queued','sent','bounced','replied','rejected','failed') NOT NULL DEFAULT 'draft',
  rejection_reason VARCHAR(500) NULL,
  approved_by_user_id BIGINT UNSIGNED NULL,
  approved_at DATETIME NULL,
  scheduled_send_at DATETIME NULL,
  sent_at DATETIME NULL,
  instantly_message_id VARCHAR(128) NULL,
  opened_at DATETIME NULL,
  clicked_at DATETIME NULL,
  replied_at DATETIME NULL,
  bounced_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_outreach_msg_lead_step (campaign_id, lead_id, sequence_step),
  KEY idx_outreach_msg_status (status),
  KEY idx_outreach_msg_lead (lead_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Inbound replies (raw payload from Instantly webhook + parsed metadata)
CREATE TABLE IF NOT EXISTS outreach_replies (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  message_id BIGINT UNSIGNED NULL,
  lead_id BIGINT UNSIGNED NULL,
  campaign_id BIGINT UNSIGNED NULL,
  reply_from VARCHAR(255) NULL,
  reply_subject VARCHAR(500) NULL,
  reply_body MEDIUMTEXT NULL,
  classification ENUM('positive','interested','neutral','negative','autoresponder','unsubscribe','unknown') NOT NULL DEFAULT 'unknown',
  classification_confidence DECIMAL(4,3) NULL,
  received_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  raw_payload JSON NULL,
  KEY idx_outreach_replies_lead (lead_id),
  KEY idx_outreach_replies_classification (classification),
  KEY idx_outreach_replies_received (received_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

Wrap each `CREATE TABLE` in the idempotent `information_schema.TABLES` check pattern from migration 008 so re-runs are safe.

---

## WHAT TO BUILD

### `lib/instantly/client.ts` (API client)

Mirror `lib/openai/client.ts` and `lib/grok/imagine.ts` patterns. Export:
- `class InstantlyApiKeyMissingError extends Error`
- `class InstantlyApiError extends Error { status; body; }`
- `async function instantlyCreateCampaign(name, sequenceJson): Promise<{ id: string }>`
- `async function instantlyAddLeadToCampaign(campaignId, lead: { email, firstName?, lastName?, companyName?, customVars? }): Promise<{ ok: boolean }>`
- `async function instantlyPauseCampaign(campaignId): Promise<void>`
- `async function instantlyResumeCampaign(campaignId): Promise<void>`
- `async function instantlyGetCampaignStats(campaignId): Promise<{ sent; opened; clicked; replied; bounced }>`

Base URL: `https://api.instantly.ai/api/v2`. Auth: `Bearer <INSTANTLY_API_KEY>` header. Reference: https://developer.instantly.ai/

### `lib/ai/outreach_drafter.ts` (AI draft generation)

Export `generateOutreachDraft(leadId, campaignContext): Promise<{ subject, body, tokensUsed, model }>`.

Inputs from the lead: company, contact_name, contact_title, industry, audit_content (this is the GOLD), website.

Prompt structure: build a system prompt that establishes Val's voice (warm, specific, audit-as-hook). User prompt includes the lead's audit_content + campaign context (offer, CTA, sender name).

Output JSON: `{ subject: string, body: string }`. Use `response_format: { type: 'json_object' }`. Temperature 0.7.

Subject length: 35-60 characters ideal. Body length: 80-150 words. Single specific observation from the audit + clear CTA + signature.

After generation, `logEvent({ eventType: 'outreach.drafted', leadId, source: 'openai', payload: { campaign_id, tokens_used } })`.

### API routes (all owner/staff only, forbid client_user)

**POST `/api/admin/av/outreach/campaigns`** — create a new campaign. Body includes name, sequence JSON, target_business. Returns campaign id.

**GET `/api/admin/av/outreach/campaigns`** — list campaigns with stats.

**POST `/api/admin/av/outreach/draft/[audit_id]`** — generate a draft for a specific lead. Body: `{ campaign_id }`. Returns the draft for review (NOT yet sent).

**POST `/api/admin/av/outreach/messages/[id]/approve`** — operator approves draft, schedules send via Instantly.

**POST `/api/admin/av/outreach/messages/[id]/reject`** — operator rejects with optional reason. Status -> 'rejected'.

**POST `/api/admin/av/outreach/instantly-webhook`** — receives Instantly events (opens, clicks, replies, bounces). Validates `X-Instantly-Signature` header against `INSTANTLY_WEBHOOK_SECRET`. Updates `outreach_messages` and inserts `outreach_replies` rows. Calls `logEvent` per event type (`outreach.opened`, `outreach.clicked`, `outreach.replied`, `outreach.bounced`). Webhook endpoints do NOT use `guardAdminRequest` — secret header only.

### UI: `/admin/av/outreach`

Three-section page:
1. **Active campaigns** — card grid of in-flight campaigns with sent/opened/replied counts
2. **Pending approval queue** — table of drafts awaiting operator action. Inline approve/reject buttons. Click a row to preview the full email.
3. **Recent replies** — sortable list of inbound replies with AI classification (positive/interested/neutral/negative).

### UI: `/admin/av/outreach/[campaign_id]`

Per-campaign view:
- Campaign metadata + status
- Pause/resume/archive controls
- Approval queue for THIS campaign
- Send-rate chart over time
- Reply funnel: drafted -> sent -> opened -> clicked -> replied

### UI: lead detail page Outreach panel

`app/admin/av/[audit_id]/OutreachPanel.tsx` shows for one lead:
- "Generate outreach" button per available campaign (uses the sparkle pattern from `RescoreButton`)
- List of historical messages sent to this lead (subject, sent date, opened/clicked/replied status)
- Inline reply thread if any replies came back

Add this as a new "Outreach" tab in `LeadDetailTabs.tsx`.

### Sidebar

Add "Outreach" link in `components/Sidebar.tsx` under the Atlantic & Vine section, below "Import CSV".

---

## DESIGN LANGUAGE REQUIREMENTS

Read `docs/COSMETIC_BASELINE.md` before adding UI. Specifically:
- Use the sparkle pattern for the "Generate outreach" button (same as Re-score)
- Status pills use the established color palette (sent=success, replied=hot, bounced=red, draft=muted)
- Approval-queue table uses the same DataTable component used elsewhere
- New rows in the queue page get a brief highlight when they fade in (mirror events live-mode pattern)
- WCAG AA contrast on all status badges + body text
- `aria-live="polite"` on the pending-approval count so screen readers announce updates
- Honor `prefers-reduced-motion`

---

## VERIFICATION BEFORE COMMIT

1. `npx tsc --noEmit` returns exit 0
2. `npm run build` returns "Compiled successfully"
3. Schema 014 runs idempotently in phpMyAdmin
4. Mock test: insert a campaign, generate a draft, approve it, verify the schedule path. (Won't actually deliver without Instantly account set up — that's expected.)
5. Webhook receiver test: curl POST with valid signature returns 200, invalid returns 401

---

## DEPLOY

```
cd "$HOME/Library/CloudStorage/OneDrive-atlanticandvine.com/HunterHoney/_organized/atlantic-hub"
git add -A
git commit -m "outreach: instantly integration, ai drafter, approval queue, schema 014"
git push origin main
```

Netlify auto-builds in ~90s. Val runs schema 014 in phpMyAdmin.

If git push fails with mysterious lock errors, Val restarts her computer.

---

## ON FINISH

Update `docs/PROJECT_STATUS_2026-05-17.md`. Append to `docs/CHANGELOG.md`. Mark 014 as shipped in `SESSION_COORDINATION.md`. Hand back a one-paragraph summary to Val including: what shipped, what Val must still do (DNS setup, Instantly account, env vars) before live sending works.
