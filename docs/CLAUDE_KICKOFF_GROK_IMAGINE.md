# Claude Code Session Kickoff: Grok Imagine - AI Commercial Generation

**Purpose:** Drop this entire file into a fresh Claude Code session.
**Goal:** Ship AI-generated ad commercials (images + short videos) per-lead, with download/post options. The platform's biggest demo wow-factor.

---

## PASTE THIS INTO THE NEW CLAUDE CHAT (top of message)

You are continuing the Atlantic & Vine / Atlantic Hub project. Atlantic And Vine
LLC, operated by Val Fulton. Be confident, terse, ASCII-only in shell commands
and commit messages (no em-dashes, no smart quotes, no curly punctuation).

Read these docs FIRST in this order:
1. `/Users/atlanticandvine/Library/CloudStorage/OneDrive-atlanticandvine.com/HunterHoney/_organized/atlantic-hub/docs/SESSION_COORDINATION.md`
2. `/Users/atlanticandvine/Library/CloudStorage/OneDrive-atlanticandvine.com/HunterHoney/_organized/atlantic-hub/docs/PROJECT_STATUS_2026-05-17.md`
3. `/Users/atlanticandvine/Library/CloudStorage/OneDrive-atlanticandvine.com/HunterHoney/_organized/atlantic-hub/docs/SYSTEM_ARCHITECTURE.md`
4. `/Users/atlanticandvine/Library/CloudStorage/OneDrive-atlanticandvine.com/HunterHoney/_organized/atlantic-hub/docs/PRODUCT_VISION.md`
5. This file

After reading, build per spec. Ship today.

---

## SCOPE RESERVATIONS (read SESSION_COORDINATION.md first)

- **Schema migration:** `schema/011_grok_imagine.sql` (reserved 011 in registry)
- **New files OWNED:**
  - `lib/grok/imagine.ts` (xAI Grok Imagine API client)
  - `lib/grok/discoverer.ts` (per-lead commercial generation orchestrator)
  - `app/api/admin/av/leads/[audit_id]/commercial/route.ts` (POST endpoint to generate)
  - `app/api/admin/av/leads/[audit_id]/commercial/[asset_id]/route.ts` (GET asset, DELETE asset)
  - `app/admin/av/[audit_id]/CommercialPanel.tsx` (UI panel showing generated assets)
- **Modified files OWNED:**
  - `app/admin/av/[audit_id]/LeadDetailTabs.tsx` (add a "Commercials" tab — DO NOT add another header button, the header is crowded)
- **Cross-touch (read + careful write):** none
- **Will NOT touch:** any `/client/*` routes (portal session), any `/admin/events*` (events session), any discovery route under `/api/admin/av/discover/*`, any auth files
- **Upstream dependencies:** Client Portal + Auto-Scoring sessions can run in parallel — your files don't overlap
- **Parallel-safe with:** Client Portal, Auto-Scoring + Events, Cosmetic Gamification (different files)

---

## CONTEXT YOU NEED

### File locations
- Atlantic Hub repo: `/Users/atlanticandvine/Library/CloudStorage/OneDrive-atlanticandvine.com/HunterHoney/_organized/atlantic-hub/`
- Schema: `atlantic-hub/schema/`
- Existing libraries: `lib/openai/client.ts`, `lib/apollo/*`, `lib/google_places/*`, `lib/apify/*`, `lib/scraper/*`

### Tech stack
- Next.js 14 App Router, TypeScript strict, mysql2, Netlify hosting
- Stay on HostGator MariaDB. No Supabase.

### Auth (three roles)
`'owner' | 'staff' | 'client_user'`. Defined in `lib/api-guard.ts:19`.

### Grok Imagine API (xAI)
- Docs: https://docs.x.ai/developers/models
- Base URL: `https://api.x.ai/v1`
- Auth: `Authorization: Bearer <XAI_API_KEY>` header
- Image generation: `grok-imagine-image` at $0.02/image, `grok-imagine-image-pro` at $0.07/image, `grok-imagine-image-quality` at $0.05/image
- Video generation: `grok-imagine-video` at $0.05/sec
- All modes support generation + editing
- Resolutions: 1K and 2K
- Endpoints follow OpenAI image API conventions for the image side; check x.ai docs for the exact video endpoint shape before coding

---

## SCHEMA TO BUILD

### `schema/011_grok_imagine.sql`

```sql
USE shhdbite_AV;

-- Idempotent guards using the same information_schema pattern as 008.
SET @col_exists := (SELECT COUNT(*) FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = 'shhdbite_AV' AND TABLE_NAME = 'grok_imagine_assets');
SET @sql := IF(@col_exists = 0,
  "CREATE TABLE grok_imagine_assets (
     id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
     lead_id BIGINT UNSIGNED NOT NULL,
     asset_type ENUM('image','video') NOT NULL,
     model VARCHAR(64) NOT NULL,
     prompt TEXT NOT NULL,
     enhanced_prompt TEXT NULL,
     storage_url VARCHAR(1024) NULL,
     storage_path VARCHAR(512) NULL,
     mime_type VARCHAR(64) NULL,
     width INT UNSIGNED NULL,
     height INT UNSIGNED NULL,
     duration_seconds DECIMAL(5,2) NULL,
     resolution_tier ENUM('1k','2k') NOT NULL DEFAULT '1k',
     cost_usd DECIMAL(8,4) NULL,
     generation_status ENUM('queued','running','succeeded','failed') NOT NULL DEFAULT 'queued',
     error_message VARCHAR(500) NULL,
     created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
     completed_at DATETIME NULL,
     archived_at DATETIME NULL,
     KEY idx_grok_assets_lead (lead_id),
     KEY idx_grok_assets_status (generation_status),
     KEY idx_grok_assets_created (created_at)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
  "SELECT 'grok_imagine_assets already exists' AS info");
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Cost + rate-limit audit log
SET @col_exists := (SELECT COUNT(*) FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = 'shhdbite_AV' AND TABLE_NAME = 'grok_imagine_log');
SET @sql := IF(@col_exists = 0,
  "CREATE TABLE grok_imagine_log (
     id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
     called_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
     endpoint VARCHAR(80) NOT NULL,
     lead_id BIGINT UNSIGNED NULL,
     asset_id BIGINT UNSIGNED NULL,
     model VARCHAR(64) NOT NULL,
     cost_usd DECIMAL(8,4) NULL,
     outcome ENUM('success','rate_limited','error','quota_exceeded') NOT NULL DEFAULT 'success',
     error_message VARCHAR(500) NULL,
     actor_user_id BIGINT UNSIGNED NULL,
     KEY idx_grok_log_called (called_at),
     KEY idx_grok_log_outcome (outcome)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
  "SELECT 'grok_imagine_log already exists' AS info");
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
```

---

## WHAT TO BUILD

### `lib/grok/imagine.ts` (API client)

Mirror the pattern of `lib/openai/client.ts`. Export:
- `class GrokApiKeyMissingError extends Error`
- `class GrokApiError extends Error { status; body; }`
- `interface GrokImageRequest { prompt: string; model?: 'grok-imagine-image' | 'grok-imagine-image-pro' | 'grok-imagine-image-quality'; resolution?: '1k' | '2k'; n?: number; }`
- `interface GrokImageResult { imageUrl: string; base64?: string; revisedPrompt?: string; }`
- `async function grokGenerateImage(req: GrokImageRequest): Promise<GrokImageResult[]>`
- `interface GrokVideoRequest { prompt: string; durationSeconds?: number; resolution?: '1k' | '2k'; }`
- `interface GrokVideoResult { videoUrl: string; durationSeconds: number; revisedPrompt?: string; }`
- `async function grokGenerateVideo(req: GrokVideoRequest): Promise<GrokVideoResult>`
- Read `XAI_API_KEY` from `process.env`. Throw `GrokApiKeyMissingError` if missing.
- Compute estimated cost client-side and return it for logging.

### `lib/grok/discoverer.ts` (orchestrator)

Export `generateCommercialForLead(leadId, options)` that:
1. SELECTs the lead from `shhdbite_AV.leads`
2. Pulls company name, industry, audit_content, contact_title for prompt context
3. Builds a prompt suited to the asset type (image hero shot for the business OR 6-10 second video commercial)
4. Calls `grokGenerateImage` or `grokGenerateVideo`
5. Inserts into `grok_imagine_assets` with status='succeeded' and the returned URL
6. Logs to `grok_imagine_log`
7. Calls `logEvent({ eventType: 'commercial.generated', leadId, ... })` if events table exists (check first - if `system_events` table missing, skip this call gracefully)
8. Returns the new asset_id + URL

### API routes

**POST `/api/admin/av/leads/[audit_id]/commercial`**
- Body: `{ assetType: 'image' | 'video', model?: string, customPrompt?: string }`
- Owner + staff only. Forbid client_user.
- Returns: `{ ok: true, assetId, url, costUsd, model }`

**GET `/api/admin/av/leads/[audit_id]/commercial/[asset_id]`**
- Returns the asset metadata + URL. Owner + staff only.

**DELETE `/api/admin/av/leads/[audit_id]/commercial/[asset_id]`**
- Soft delete (set `archived_at = NOW()`). Owner only.

### UI

Add a **"Commercials" tab** to `app/admin/av/[audit_id]/LeadDetailTabs.tsx`.
- Lists existing assets in a grid (thumbnails for images, video previews for video)
- "Generate image" + "Generate video" buttons (model selector dropdown for image)
- Custom-prompt textarea (optional override)
- Per-asset download + delete buttons
- Cost shown per asset

---

## ENV VARS TO ADD

In Netlify > atlantic-hub > Environment variables:
- `XAI_API_KEY` (Grok API key from console.x.ai)

Document this in `docs/ENV_VARS_REFERENCE.md` in the "VARIABLES ADDED" section.

---

## VERIFICATION BEFORE COMMIT

1. `npx tsc --noEmit` returns exit 0
2. `npm run build` returns "Compiled successfully" (run locally before push)
3. Schema 011 runs idempotently in phpMyAdmin
4. Click "Generate image" on a lead with audit_content populated. Within 30 seconds: new asset URL renders, cost logged, asset visible in the tab

---

## DEPLOY

From Val's terminal:

```
cd "$HOME/Library/CloudStorage/OneDrive-atlanticandvine.com/HunterHoney/_organized/atlantic-hub"
git add -A
git commit -m "grok imagine: ai commercial generation per lead, schema 011"
git push origin main
```

Netlify auto-builds in ~90s. Val runs schema 011 in phpMyAdmin.

If git push fails with mysterious lock errors, Val restarts her computer.

---

## DO NOT

- Migrate to Supabase. Hard No.
- Use any storage solution that requires new credentials. For v1, store the Grok-returned URL directly. Future task: rehost to Atlantic Hub's own bucket.
- Estimate days or hours back to Val.
- Use smart quotes, em-dashes anywhere.

---

## ON FINISH

Update `docs/PROJECT_STATUS_2026-05-17.md` with what shipped. Append to
`docs/CHANGELOG.md`. Update `SESSION_COORDINATION.md` schema registry to mark
011 as shipped.

Hand back a one-paragraph summary to Val.
