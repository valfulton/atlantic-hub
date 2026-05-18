# Claude Code Session Kickoff: Social Posting Connectors

**Purpose:** Drop into a fresh Claude Code session. Goal: Let every tenant
(Atlantic & Vine, Events by Water, HunterHoney, plus each external client)
connect LinkedIn, X, Instagram, Threads, and TikTok inside the Atlantic
Hub dashboard, then publish AI-generated images and videos directly --
zero downloads, zero copy-paste, zero leaving the platform.

> Path: `/atlantic-hub/docs/CLAUDE_KICKOFF_SOCIAL_POSTING.md`

---

## MANDATORY READING (in order, before any code)

1. `docs/SESSION_COORDINATION.md`
2. `docs/PROJECT_BRIEFING_2026-05-18.md`
3. `docs/CLIENT_FACING_GUARDRAILS.md`
4. `docs/SYSTEM_ARCHITECTURE.md`
5. `docs/PRODUCT_VISION.md`
6. This file

If you do not see those linked above in your kickoff context, stop and ask
the conductor.

---

## SCOPE RESERVATIONS

- **Schema migration:** `schema/017_social_posting.sql` (reserve 017 in
  `SESSION_COORDINATION.md` schema registry before coding)
- **New files OWNED:**
  - `lib/social/types.ts`
  - `lib/social/oauth.ts` (OAuth helpers shared across providers)
  - `lib/social/providers/linkedin.ts`
  - `lib/social/providers/x.ts` (Twitter / X)
  - `lib/social/providers/meta.ts` (IG + FB Pages + Threads via Graph)
  - `lib/social/providers/tiktok.ts`
  - `lib/social/publisher.ts` (the post-now-or-schedule dispatcher)
  - `lib/social/scheduler.ts` (smart-timing engine, lead-heat driven)
  - `app/api/admin/social/connect/[provider]/route.ts` (OAuth start)
  - `app/api/admin/social/oauth/[provider]/callback/route.ts` (OAuth callback)
  - `app/api/admin/social/connections/route.ts` (list)
  - `app/api/admin/social/connections/[id]/route.ts` (GET, DELETE)
  - `app/api/admin/social/posts/route.ts` (POST a draft, list scheduled)
  - `app/api/admin/social/posts/[id]/route.ts` (GET, PATCH, DELETE)
  - `app/api/admin/social/posts/[id]/publish/route.ts` (force-publish now)
  - `app/admin/social/page.tsx` (Integrations + connected accounts page)
  - `app/admin/social/SocialConnectionsPanel.tsx`
  - `app/admin/social/PostQueueTable.tsx`
  - `netlify/functions/social-publish-cron.mts` (runs every 5 min, publishes due posts)
- **Modified files OWNED:**
  - `middleware.ts` -- add the OAuth callback paths to the auth matcher
  - `app/admin/_components/Sidebar.tsx` (or wherever the operator nav lives) --
    add a "Social" entry
  - `lib/grok/discoverer.ts` -- on successful asset generation, OPTIONALLY
    enqueue a draft post (gated by per-lead setting)
- **Will NOT touch:** any `/client/*` route, any `/api/client/*` route,
  any auth file in `lib/auth/`, any existing `lib/openai/*` or `lib/grok/*`
  beyond the single hook above.
- **Cross-touch (read + careful write):** None expected.
- **Upstream dependencies:** Schema 011 (grok_imagine) already shipped --
  social posts reference `grok_imagine_assets.id` as the asset they
  publish. Schema 016 (visual_brief) helps but is not required.
- **Parallel-safe with:** Visual Brief Admin UI session, Clay webhook
  session, PhantomBuster webhook session.

---

## ARCHITECTURE

### Multi-tenancy

Every connection belongs to a tenant. Tenants today are:

- `av` -- Atlantic & Vine (Val's agency brand, the operator dashboard sees this by default)
- `ebw` -- Events by Water
- `hh` -- HunterHoney
- `client:<client_id>` -- any external client (rendered via their own
  Client Portal sub-tree once that ships)

The operator (Val) can switch which tenant she's posting as from the top
of the Social page. Owner role can see and post for every tenant. Staff
can be scoped to specific tenants in a later session (out of scope here).
Client users can only see + post for their own `client:<id>` tenant.

### Provider matrix and the friction reality

| Provider | API | Friction to ship v1 | Friction to publish |
| --- | --- | --- | --- |
| LinkedIn (personal + company pages) | LinkedIn REST + UGC Posts API | OAuth app creation (~30 min) + verification (~1 day) | Clean. Supports text, image, video. |
| X / Twitter | X API v2 | Paid Basic plan required ($100/mo) for write access | Clean. 280 char + media. |
| Meta (Instagram Business, Facebook Pages, Threads) | Meta Graph API | Meta Business app + app review (~3-10 days) + business verification (~1 week) | Clean once approved. IG requires a connected FB Page. |
| TikTok | TikTok for Developers | App registration + review (~1-2 weeks) | Clean. Supports image carousels + video. |
| YouTube Shorts (optional v2) | YouTube Data API v3 | Google Cloud OAuth (~1 hour) | Clean. |

**v1 deliverable:** ship LinkedIn + X first. Wire the abstractions so IG /
Threads / TikTok plug in later without architectural changes. Do not let
Meta app review block v1.

### Token storage and security

Tokens live in `social_connections` (schema 017). Encrypt access tokens
and refresh tokens at rest using `EMAIL_ENCRYPTION_KEY` style helper, or
add a dedicated `SOCIAL_TOKEN_ENCRYPTION_KEY` env var (preferred -- key
rotation is independent of email encryption).

OAuth state is signed with `JWT_SECRET` and includes:
- tenant_id (av / ebw / hh / client:<id>)
- provider
- actor user id
- 10-minute expiry

Never store raw client_secret in the DB. Use Netlify env vars per
provider:
- LINKEDIN_CLIENT_ID, LINKEDIN_CLIENT_SECRET
- X_CLIENT_ID, X_CLIENT_SECRET
- META_APP_ID, META_APP_SECRET
- TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET

Document additions in `docs/ENV_VARS_REFERENCE.md`.

---

## SCHEMA 017 (sketch)

```sql
USE shhdbite_AV;

CREATE TABLE IF NOT EXISTS social_connections (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL,                -- 'av' | 'ebw' | 'hh' | 'client:<n>'
  provider ENUM('linkedin','x','instagram','facebook','threads','tiktok','youtube') NOT NULL,
  provider_account_id VARCHAR(255) NOT NULL,     -- the platform's stable user/page ID
  display_name VARCHAR(255) NULL,                -- "Atlantic & Vine LinkedIn"
  avatar_url VARCHAR(1024) NULL,
  scopes_json TEXT NULL,                         -- JSON array of granted scopes
  access_token_enc TEXT NOT NULL,                -- encrypted at rest
  refresh_token_enc TEXT NULL,                   -- encrypted at rest
  access_token_expires_at DATETIME NULL,
  refresh_token_expires_at DATETIME NULL,
  status ENUM('active','revoked','expired','error') NOT NULL DEFAULT 'active',
  last_error VARCHAR(500) NULL,
  connected_by_user_id BIGINT UNSIGNED NULL,
  connected_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at DATETIME NULL,
  UNIQUE KEY uq_tenant_provider_account (tenant_id, provider, provider_account_id),
  KEY idx_tenant (tenant_id),
  KEY idx_provider_status (provider, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS social_posts (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL,
  connection_id BIGINT UNSIGNED NOT NULL,        -- FK conceptually
  lead_id BIGINT UNSIGNED NULL,                  -- if posted on a lead's behalf
  asset_id BIGINT UNSIGNED NULL,                 -- FK to grok_imagine_assets.id (optional)
  body_text TEXT NULL,                           -- post copy
  media_url VARCHAR(1024) NULL,                  -- final media URL pushed to platform
  media_type ENUM('none','image','video','carousel') NOT NULL DEFAULT 'none',
  status ENUM('draft','scheduled','publishing','published','failed','canceled') NOT NULL DEFAULT 'draft',
  scheduled_for DATETIME NULL,                   -- when scheduler should publish
  published_at DATETIME NULL,
  provider_post_id VARCHAR(255) NULL,            -- platform's ID once published
  provider_url VARCHAR(1024) NULL,
  error_message VARCHAR(500) NULL,
  retries INT UNSIGNED NOT NULL DEFAULT 0,
  created_by_user_id BIGINT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  archived_at DATETIME NULL,
  KEY idx_tenant_status (tenant_id, status),
  KEY idx_connection (connection_id),
  KEY idx_status_scheduled (status, scheduled_for),
  KEY idx_lead (lead_id),
  KEY idx_asset (asset_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS social_publish_log (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  post_id BIGINT UNSIGNED NOT NULL,
  attempted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  outcome ENUM('success','retry','permanent_failure') NOT NULL,
  http_status INT UNSIGNED NULL,
  latency_ms INT UNSIGNED NULL,
  error_message VARCHAR(500) NULL,
  KEY idx_post (post_id),
  KEY idx_attempted (attempted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

---

## UI

### `/admin/social` (Integrations page)

Top: tenant selector chip ("Posting as: Atlantic & Vine" with dropdown
to swap to EBW / HH / a specific client).

Section 1: **Connected accounts.** Cards per provider with status pill,
last-used timestamp, "Disconnect" button. Empty state: a "Connect"
button per provider that kicks off OAuth.

Section 2: **Post queue.** Table of drafts / scheduled / published /
failed posts. Filters by status, tenant, provider, lead. Per-row:
preview, target accounts, scheduled time, publish-now button, edit,
cancel.

Section 3: **Smart timing settings.** Per-tenant toggle "Auto-schedule
new posts based on lead heat" + the timezones / preferred-windows config.

### Per-lead "Push to social"

On the lead detail page Commercials tab (existing UI), each successfully
generated asset card gets a **Push to social** button. Click -> dialog
asks: which connections, what caption (pre-filled from the existing AI
social content generator output if available), when (now / smart schedule
/ pick datetime). Submit -> creates `social_posts` row(s).

### Per-asset on the lead

Optional: a small section at the top of the Commercials tab "Auto-push
this lead's commercials to: [chips of selected connections]" with an
on/off toggle so future generations queue themselves automatically.

---

## SMART TIMING ENGINE

`lib/social/scheduler.ts` exports `proposeScheduleSlot(opts)`.

Inputs:
- tenant_id
- connection_id (so we can look up provider + audience timezone)
- lead heat (`leads.ai_score_band`: hot / warm / cool) -- hot leads
  schedule SOONER and at platform-prime-time
- existing queued posts on the same connection (avoid >1 post per platform per 2h)
- platform best-times (e.g. LinkedIn: Tue/Wed/Thu 7-9am or 12-1pm local;
  X: any weekday 8-10am or 6-8pm)

Output: a UTC datetime + reason string ("LinkedIn prime morning slot for
your hot lead's timezone"). The reason string is INTERNAL (admin only) --
never echoed to client surfaces in raw form.

Phase 1 implementation: a rule table per provider, no ML. Phase 2 can
read post-engagement back from each platform and tune.

---

## CRON

`netlify/functions/social-publish-cron.mts` runs every 5 minutes (Netlify
scheduled function). Selects `social_posts WHERE status='scheduled' AND
scheduled_for <= NOW()`, locks row by flipping to `publishing`, calls the
appropriate provider, then patches to `published` or `failed`. On
failure, increment retries; permanent_failure after 3.

---

## TESTING / VERIFY BEFORE COMMIT

1. `npx tsc --noEmit` exit 0
2. `npm run build` succeeds
3. Schema 017 runs idempotently on shhdbite_AV
4. Connect a LinkedIn personal account from /admin/social -- row lands in
   social_connections with status='active'
5. Manually create a post with body text only, schedule for 1 minute
   from now. After cron fires, status flips to 'published' and the
   provider_url opens to the live LinkedIn post.
6. Repeat with an image (`asset_id` set to a real grok_imagine_assets row).
7. Repeat with X / Twitter.
8. Disconnect the LinkedIn account -- status flips to 'revoked', cron
   stops attempting to use it.

---

## CLIENT-FACING ETIQUETTE

Per `docs/CLIENT_FACING_GUARDRAILS.md`:

- On `/admin/social` (operator-only) it's fine to show error details,
  retry counts, provider IDs, etc.
- Never expose "$0.X per post," token counts, or model-cost language in
  any future client-portal version of this surface.
- Client-facing language: "5 of 12 commercials scheduled this month --
  next post Tuesday 9am EDT." Not: "$1.50 in API cost this month."

---

## ON FINISH

1. Update `docs/PROJECT_STATUS_<date>.md` with what shipped.
2. Append to `docs/CHANGELOG.md`.
3. Mark schema 017 shipped in `docs/SESSION_COORDINATION.md`.
4. Move "Social Posting Connectors" from section 4 (queued) to section 3
   (shipped) in `docs/PROJECT_BRIEFING_2026-05-18.md`.
5. Hand back a one-paragraph summary to Val.

Ship.
