# Claude Code Session Kickoff: Build the Atlantic & Vine Client Portal

**Purpose of this doc:** Drop this entire file into a fresh Claude Code session.
It contains every fact, file path, schema reference, and deploy command needed
to build the client portal in one focused session. No back-channel context required.

**Goal of the session:** Wire up the existing client-portal.html so that any
prospect who submits the client-intake form gets a magic-link to a password-
protected dashboard showing their AI audit, their active tier, and greyed-out
upsell cards for paid features.

**Time budget:** One focused session. Down-and-dirty done.

---

## PASTE THIS INTO THE NEW CLAUDE CHAT (top of message)

You are continuing the Atlantic & Vine / Atlantic Hub project. The owner is
Atlantic And Vine LLC (parent), operated by Val Fulton. Val is an experienced
founder shipping product across multiple business lines. Be confident, terse,
ASCII-only in shell commands and commit messages (no em-dashes, no smart quotes).

Read these docs FIRST in this order before writing any code:
1. /Users/atlanticandvine/Library/CloudStorage/OneDrive-atlanticandvine.com/HunterHoney/_organized/atlantic-hub/docs/PROJECT_STATUS_2026-05-17.md
2. /Users/atlanticandvine/Library/CloudStorage/OneDrive-atlanticandvine.com/HunterHoney/_organized/atlantic-hub/docs/SYSTEM_ARCHITECTURE.md
3. /Users/atlanticandvine/Library/CloudStorage/OneDrive-atlanticandvine.com/HunterHoney/_organized/atlantic-hub/docs/PRODUCT_VISION.md
4. This file (CLAUDE_KICKOFF_CLIENT_PORTAL.md)

After reading, build the client portal per the spec below. Do not redesign.
Do not propose alternatives unless you find a hard blocker.

---

## CONTEXT YOU NEED

### Property layout (4 web properties)

| URL | Purpose | Source code location | Deploy mechanism |
|-----|---------|----------------------|------------------|
| atlanticandvine.com | Pixieset photo gallery, sentimental | Pixieset (not in git) | n/a |
| atlanticandvine.netlify.app | Marketing site (HTML/CSS/JS) | github.com/valfulton/atlanticandvine | Push to GitHub, Netlify auto-builds |
| api.atlanticandvine.com | PHP backend (forms, audit endpoint) | HostGator File Manager at /home2/shhdbite/api.atlanticandvine.com/ | Manual upload, no git |
| atlantic-hub.netlify.app | Operator dashboard (Next.js) | github.com/valfulton/atlantic-hub | Push to GitHub, Netlify auto-builds |

### File locations on disk

- **AV marketing site:** /Users/atlanticandvine/Library/CloudStorage/OneDrive-atlanticandvine.com/AtlanticandVine/ATLANTIC AND VINE management/AV website build/AV_web_2026/Claude/AV_livewebsite/
- **Atlantic Hub (operator dashboard):** /Users/atlanticandvine/Library/CloudStorage/OneDrive-atlanticandvine.com/HunterHoney/_organized/atlantic-hub/
- **Existing client portal HTML (production-quality but not deployed):** /Users/atlanticandvine/Documents/Claude/Projects/Atlantic And Vine/client-portal.html
- **Existing client-portal schema (already created in HostGator):** /Users/atlanticandvine/Documents/Claude/Projects/Atlantic And Vine/migrations/ (per Val 2026-05-17, the schema exists; verify by reading the .sql files)

### Databases (HostGator MySQL)

- `shhdbite_AV` — Atlantic & Vine leads, audits, client data
- `shhdbite_hunterhoney` — HunterHoney tenant
- `shhdbite_eventsbywater` — Events by Water tenant
- `shhdbite_atlantic_hub` — Platform-level data (auth, organizations)

Key tables in `shhdbite_AV`:
- `leads` — every prospect, fully enriched, with audit_content column
- `lead_events` — domain-specific events on leads
- `apollo_search_log`, `hunter_credit_log` — API call audit trails

Schema migrations 001-008 are in atlantic-hub/schema/. The 008 migration
added target_business, normalized_domain, archived_at indexes.

### Tech stack

- Next.js 14 App Router on Netlify
- TypeScript strict
- Tailwind CSS
- mysql2 for HostGator MySQL
- bcryptjs for password hashing
- jose for JWT
- No Supabase, no Postgres. Stay on MariaDB.

### Auth scaffolding that already exists

- `lib/api-guard.ts` exports `guardAdminRequest` with role checking
- **Real role enum in code (three values, not five):** `'owner' | 'staff' | 'client_user'`
  - Defined in `lib/api-guard.ts:19`, `lib/auth/jwt.ts:16`, `lib/auth/session.ts:41`
  - Owner = Val. Staff = internal team. Client_user = external paying client.
- `lib/auth/session.ts` handles session signing + parsing
- `lib/auth/bootstrap.ts` handles first-time owner setup
- JWT_SECRET and JWT_ISSUER env vars are set in Netlify
- Owner login at /admin works (Val's account)

---

## WHAT TO BUILD

### Phase 1: Schema (verify or create)

Check if `shhdbite_AV.client_users` table exists already (Val says she created
the schema weeks ago). If yes, document its columns. If no, create migration
schema/009_client_portal.sql with:

```sql
USE shhdbite_AV;

CREATE TABLE IF NOT EXISTS client_users (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  client_id BIGINT UNSIGNED NOT NULL,
  email VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) DEFAULT NULL,
  magic_token VARCHAR(64) DEFAULT NULL,
  magic_token_expires_at DATETIME DEFAULT NULL,
  email_verified_at DATETIME DEFAULT NULL,
  last_login_at DATETIME DEFAULT NULL,
  tier ENUM('audit_only','starter','growth','scale') NOT NULL DEFAULT 'audit_only',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_client_users_email (email),
  KEY idx_client_users_client_id (client_id),
  KEY idx_client_users_magic_token (magic_token)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

The tier ENUM matches the pricing tiers on the AV marketing site (Starter,
Growth, Scale). audit_only = free tier just for free-audit submitters.

### Phase 2: API routes in atlantic-hub

Create these routes:

1. **POST /api/client/intake** — public endpoint, called from the
   marketing-site client-intake form. Creates a `clients` row if new,
   creates a `client_users` row with a magic_token (random 64-char hex)
   that expires in 24 hours. Sends a magic-link email (use a simple
   transactional email — Resend, Postmark, or even just log to console
   for v1 and Val sends manually if needed).

2. **GET /api/client/magic-link/[token]** — public endpoint, validates the
   magic_token, sets a session cookie (signed JWT), redirects to
   /client/dashboard. Token is single-use; clear it after consumption.

3. **POST /api/client/set-password** — authenticated client_user only.
   Sets the password_hash for first-time portal setup.

4. **POST /api/client/login** — public endpoint, email + password, returns
   session JWT.

5. **GET /api/client/me** — authenticated, returns the logged-in client's
   info + their audit (read from leads.audit_content joined on client_id).

### Phase 3: Client-facing pages in atlantic-hub at /client/*

Create these pages:

1. **/client/login** — email + password form. Magic-link tokens hit
   /api/client/magic-link/[token] which redirects here on first time to
   set password.

2. **/client/dashboard** — the main client view. Shows:
   - Their company name and tier badge
   - Their AI audit (rendered from leads.audit_content; markdown-safe)
   - Active features: list of what's included at their tier
   - Greyed-out cards: features they'd unlock at the next tier (upsell)
     Each card has a "Talk to us" CTA that opens client-intake or books a call

3. **/client/audit** — full-page view of the audit_content for printing/sharing

### Phase 4: Marketing-site wiring

The existing client-intake form at atlanticandvine.netlify.app/client-intake
currently POSTs to a PHP endpoint on api.atlanticandvine.com. Either:
- Update that PHP endpoint to also call POST /api/client/intake on atlantic-hub, OR
- Update the form to POST directly to atlantic-hub's /api/client/intake

Whichever is faster. Test with a real submission.

### Phase 5: Existing client-portal.html

Per memory: /Users/atlanticandvine/Documents/Claude/Projects/Atlantic And Vine/client-portal.html
is production-quality but never deployed. Read it. Either port its UI into
the new /client/dashboard page or use it as design inspiration. Don't
rebuild from scratch — Val already designed the look.

---

## DEPLOY FLOW (memorize this)

After building, push from Val's terminal:

```
cd "$HOME/Library/CloudStorage/OneDrive-atlanticandvine.com/HunterHoney/_organized/atlantic-hub"
git add -A
git commit -m "client portal: schema migration plus magic-link auth plus dashboard"
git push origin main
```

Netlify auto-builds in ~90 seconds. Live at atlantic-hub.netlify.app/client/login

If git push fails with mysterious lock errors: have Val restart her computer.
Do not propose moving repos out of OneDrive (Val has explicitly rejected this).
Restart fixes it.

For schema migration: Val runs the .sql file in phpMyAdmin at HostGator,
shhdbite_AV database, SQL tab.

---

## ENV VARS YOU MAY NEED TO ADD

If sending real magic-link emails, add to Netlify:
- `RESEND_API_KEY` (if using Resend) or `POSTMARK_TOKEN` (if Postmark)
- `MAGIC_LINK_BASE_URL` — e.g. https://atlantic-hub.netlify.app

For v1: skip the email send. Just log the magic link to the console and Val
will send it manually. Ship faster.

---

## VERIFICATION BEFORE YOU CLAIM DONE

1. TypeScript compiles clean: `cd atlantic-hub && npx tsc --noEmit` returns exit 0
2. Schema migration runs idempotently in phpMyAdmin without errors
3. Submit the client-intake form on the live marketing site. A client_users
   row is created. A magic_token is generated.
4. Click the magic link. Lands on /client/login or sets password if first time.
5. After login, /client/dashboard renders with the user's audit content visible.
6. Logout works. Re-login works.

Write a CHANGELOG.md entry summarizing what shipped. Commit and push. Done.

---

## WHAT YOU SHOULD NOT DO

- Do not migrate to Supabase. Val rejected this.
- Do not add n8n. Not needed yet.
- Do not redesign the URL structure of the marketing site.
- Do not touch atlanticandvine.com (Pixieset, separate property).
- Do not invent stats or features that don't exist. Stick to spec.
- Do not use smart quotes or em-dashes in commit messages or shell commands.

---

## CONTACT BACK

When you finish or hit a blocker, hand back:
- What shipped (file paths, commit hash)
- What's still pending
- Any decision points where you needed Val's input

Then update /docs/PROJECT_STATUS_2026-05-17.md (or create
PROJECT_STATUS_<today>.md) with the new state.

---

LFG.
