# Atlantic Hub -- Master Project Briefing (2026-05-18)

**Hand this to the conductor (Cowork Claude) at the start of every new
session.** This is the single source of truth for what is shipped, what is
queued, what is parked, and what the platform vision is converging toward.
Every kickoff doc the conductor writes after today should reference this
file by path so that all parallel Claude Code sessions stay aligned.

> Path: `/atlantic-hub/docs/PROJECT_BRIEFING_2026-05-18.md`

---

## 1. MANDATORY READING FOR EVERY KICKOFF DOC

Every new session must read these BEFORE writing any code, in order:

1. `docs/SESSION_COORDINATION.md` -- schema registry + file-ownership protocol
2. `docs/PROJECT_BRIEFING_2026-05-18.md` -- this file
3. `docs/CLIENT_FACING_GUARDRAILS.md` -- never show per-unit API cost on client surfaces
4. `docs/SYSTEM_ARCHITECTURE.md` -- the permanent reference
5. `docs/PRODUCT_VISION.md` -- the where-we-are-going
6. The kickoff doc that names the session

If a kickoff doc does not link this briefing, the conductor missed a step;
the session should ask for it before starting.

---

## 2. THE PRODUCT IN ONE PARAGRAPH

Atlantic Hub is an AI growth operating system. Run by Atlantic And Vine LLC
(operator Val Fulton) for its own three product brands (Atlantic & Vine
agency, Events by Water charter marketplace, HunterHoney crypto / AI
education) AND for external paying clients who eventually become their
own tenants. Core loop: discover leads -> enrich -> AI score -> generate
audit -> generate ON-BRAND COMMERCIALS (image + video) -> push to social
on a smart schedule -> outreach + reply tracking -> book / close. Paid
clients land in a Client Portal that shows their audit, leads, scored
pipeline, and commercial library.

---

## 3. WHAT IS SHIPPED AS OF 2026-05-18

| Area | What's live | Owning files / schema |
| --- | --- | --- |
| Operator auth + RBAC | owner / staff / client_user roles, JWT cookie sessions, audit_log_global | lib/api-guard.ts, lib/auth/* |
| Lead pipeline core | leads table with cross-source dedup, target_business heuristic, archive soft-delete | schema 001-008 |
| Discovery | Apollo + Google Places + Apify Instagram + contact-page scraper | lib/apollo/* lib/google_places/* lib/apify/* lib/scraper/* |
| Enrichment | Hunter.io daily cron + inline scrape on insert | lib/enrichment/* netlify/functions/enrich-cron.mts |
| AI scoring + audit | gpt-4o-mini scoring, audit generation, fire-and-forget on insert, owner Re-score button | schema 010, lib/ai/score_and_audit.ts |
| Unified event log | system_events table, logEvent helper, /admin/events page, score-sweep cron | schema 010, lib/events/log.ts |
| Client portal | magic-link auth, dashboard, audit view, tier-gated feature matrix | schema 009 + 015, lib/auth/client-*, app/client/* |
| Tier rename | starter/growth -> sprint/momentum to match production Stripe products | schema 015, lib/client-portal/tiers.ts |
| **Per-lead AI commercials** | **Grok Imagine image + video generation per lead, owner+staff only, async video poll with resume, asset library on the lead** | **schema 011, lib/grok/*, app/api/admin/av/leads/[audit_id]/commercial/*, app/admin/av/[audit_id]/CommercialPanel.tsx** |
| **Visual brief layer** | **gpt-4o-mini per-lead visual brief (heroShot / mood / palette / motifs / persona / donts / pacing) feeding the Grok prompts. First-class creative direction, replaces audit-as-prompt** | **schema 016, lib/ai/visual_brief.ts** |
| Marketing pricing page | Sprint / Momentum / Scale at $1,995 / $3,995 / $7,995, launch promo countdown, a-la-carte 10-pack and 20-pack, free-first-commercial hook | marketing/commercials-pricing.html |
| Cosmetic / gamification | AnimatedScoreReveal, ScoreRadarChart, LeadOfTheDay, HotLeadConfetti, lead-detail tabs polish | components/*, app/admin/av/* |
| Clay enrichment webhook | shared-secret POST receiver, cross-source dedup + fill-missing-only, auto score on insert, owner+staff status page with copyable URL | schema 012, lib/clay/*, app/api/admin/av/integrations/clay-webhook/*, app/admin/av/integrations/clay/* |

---

## 4. WHAT IS QUEUED (in priority order)

| # | Session name | Status | Owns |
| --- | --- | --- | --- |
| 1 | **Social Posting Connectors** -- LinkedIn + IG + X + Threads + TikTok OAuth, scheduled push, smart timing from lead heat | **kickoff doc ready: `docs/CLAUDE_KICKOFF_SOCIAL_POSTING.md`** | schema 017, lib/social/*, app/api/admin/social/*, app/admin/social/*, app/client/social/* |
| 2 | Visual brief admin UI | not yet specced | A small panel on the lead detail to view + regenerate the brief |
| 3 | "Make a commercial for this post" wiring | not yet specced | The existing SocialContentButton modal needs a 1-click bridge to the Commercial panel |
| 4 | Pricing surface sync to AV_livewebsite/js/packages.js | **pending Val's manual edit + Stripe re-sync** | See section 5 of `docs/COMMERCIAL_GOLIVE_RUNBOOK.md` for the exact paste-in blocks |
| 5 | Clay webhook | SHIPPED 2026-05-21 (schema 012) | lib/clay/*, app/api/admin/av/integrations/clay-webhook/*, app/admin/av/integrations/clay/* |
| 6 | PhantomBuster webhook | reserved schema 013 | lib/phantombuster/* |
| 7 | Email automation | partially specced in `docs/CLAUDE_KICKOFF_EMAIL_AUTOMATION.md` | lib/email/*, schema 014 (currently unreserved) |
| 8 | Accessibility + PWA pass | specced in `docs/CLAUDE_KICKOFF_ACCESSIBILITY_AND_PWA.md` | Theming + manifest + a11y audit |
| 9 | Asset rehosting | parked | Move xAI-served URLs onto an Atlantic Hub bucket so they survive provider-side expiry. Not urgent until a client downloads an expired asset. |

---

## 5. WHAT IS PARKED (intentionally not built)

- **Supabase migration.** Hard no. Stay on HostGator MariaDB / MySQL.
- **n8n adoption.** Use Netlify scheduled functions until a use case
  genuinely needs branching workflow.
- **Background queue / worker for video polling.** The current inline-poll +
  resume-on-GET design is good enough for the SMB volume; revisit if Val
  ships a batch generator.
- **Per-tenant row-level isolation in MySQL.** App-layer guard via
  `guardAdminRequest` is sufficient until the first external paying tenant
  comes online.

---

## 6. CRITICAL RULES THAT APPLY TO EVERY SESSION

1. **NEVER show per-unit API / inference cost on client-facing surfaces.**
   The detailed rule lives in `docs/CLIENT_FACING_GUARDRAILS.md`. Banned
   strings: "$0.30 per video", "$0.05 per image", "$X in API cost", token
   counts. Allowed on client surfaces: tier price ($1,995 etc), monthly
   volume ("12 videos / month"), a-la-carte pack price ($390 for 10 extras).

2. **Tier names are LOCKED to `audit_only / sprint / momentum / scale`.**
   Real prices: Free / $1,995 / $3,995 / $7,995. Don't invent Starter,
   Growth, Debut, Encore, Headliner -- those break Stripe billing.

3. **ASCII-only in shell commands and commit messages.** No em-dashes,
   no smart quotes, no curly punctuation anywhere in CLI / git copy.

4. **Schema registry is the lock.** Read `SESSION_COORDINATION.md` before
   reserving a number. Reserve before coding. Mark shipped after merging.

5. **No founder name on customer-facing copy.** Brand voice is plural.

6. **HostGator MySQL is classic MySQL, not MariaDB.** No
   `ADD COLUMN IF NOT EXISTS` syntax in migrations. `CREATE TABLE IF NOT
   EXISTS` is fine. For idempotent column adds, check
   `information_schema.COLUMNS` first.

7. **Cost-passthrough model.** No SaaS subscriptions until a paying client
   justifies them. Use what's already in the stack.

8. **Direct push over download.** The platform's North Star is
   commercials and content that PUBLISH from the dashboard, not files the
   user downloads. Treat any new "Download" button as a temporary
   scaffold, not the desired end state.

---

## 7. ENV VARS CURRENTLY EXPECTED IN NETLIFY

See `docs/ENV_VARS_REFERENCE.md` for the canonical list. As of 2026-05-18:

- DB_HOST, DB_PORT, DB_USER_*, DB_PASS_*, DB_NAME_*
- JWT_SECRET, JWT_ISSUER, OWNER_BOOTSTRAP_EMAIL, OWNER_BOOTSTRAP_PASSWORD_HASH
- EMAIL_ENCRYPTION_KEY, IP_SALT
- HUNTER_API_KEY, APOLLO_API_KEY, APIFY_API_TOKEN, GOOGLE_PLACES_API_KEY
- OPENAI_API_KEY
- **XAI_API_KEY** (Grok Imagine, added 2026-05-18)
- ENRICHMENT_CRON_SECRET, NETLIFY_FORMS_WEBHOOK_SECRET
- (Optional) MAGIC_LINK_BASE_URL, PORTAL_ALLOWED_ORIGINS

---

## 8. WHAT VAL OWES THE PROJECT (manual tasks the conductor cannot do)

Open as of 2026-05-18:

1. **Edit `AV_livewebsite/js/packages.js`** with the commercial volume
   fields per tier + the two new add-on objects + the LAUNCH_PROMO export.
   Exact paste-in blocks live in
   `docs/COMMERCIAL_GOLIVE_RUNBOOK.md` section 9. After saving, run
   `js/setup-stripe-products.php` from that repo to sync new add-ons to
   Stripe and capture the generated `stripeProductId` / `stripePriceId` /
   `stripePaymentLink`.
2. **Run schema/016 in phpMyAdmin** (visual_brief table) on `shhdbite_AV`.
3. **Mount `AV_livewebsite` for Claude** if she wants the conductor to
   make the packages.js edits herself in a future session.
4. **Provide social-platform credentials and approval** -- see the social
   posting kickoff doc for the full list.

---

## 9. SESSION CADENCE PROPOSAL

To ship the next phase fast:

- **Session A (next up): Social Posting Connectors v1** -- LinkedIn + X
  only, since those have the cleanest APIs. Multi-tenant by design.
  Connects on `/admin/integrations/social`. Posts immediately, scheduled
  pushes next. ~half day for the first two platforms.
- **Session B (parallel-safe): Visual brief admin UI** -- 2 hours.
- **Session C (after A): IG + Threads via Meta Graph** -- requires Meta
  Business app approval. ~half day code + 2-5 days waiting on Meta.
- **Session D (after A): TikTok** -- requires TikTok for Developers
  approval. ~half day code + 1-2 weeks waiting on TikTok.
- **Session E (after A or B): Smart timing engine** -- reads hot leads
  + lead heat decay + audience timezone + best-time-by-platform research
  and produces a posting schedule per tenant. Drives Session A's queue.

The social-posting kickoff doc covers Sessions A, C, D, E in detail.

---

## 10. THE NORTH STAR FOR THE NEXT FOUR WEEKS

> A client takes a 3-minute audit. Five minutes later they see a dashboard
> with their first AI commercial, 25 scored leads, and a one-button
> "Connect my LinkedIn and post this every Tuesday at 9am" workflow.
> Two weeks in, the dashboard is posting on its own, daily, on brand,
> driven by their freshest hot leads, and the operator has not touched it.

Every session should ask "does my work move us closer to that demo?"
If yes, ship. If no, push it to backlog.
