# Atlantic Hub Changelog

One line per shipped session. Most recent first. Conductor (Cowork Claude)
appends after each session reports a commit hash.

Format: `YYYY-MM-DD  <commit>  <session name>  --  <one-line scope>`

---

## 2026-05-18

- `<pending>`  Email Outreach Automation  --  schema/014 outreach_mailboxes + outreach_campaigns + outreach_messages + outreach_replies + outreach_send_log. lib/email/ driver layer (HostGator SMTP via nodemailer, Microsoft Graph OAuth, Gmail API OAuth) with AES-256-GCM credential encryption (lib/email/encrypt.ts), router + per-mailbox + per-tier daily caps. lib/ai/outreach_drafter.ts (audit-grounded personalized drafts, plural voice, no-cost-leak prompts), lib/ai/reply_classifier.ts (positive/interested/neutral/negative/autoresponder/unsubscribe with heuristic fast-path), lib/email/send_pipeline.ts (approve -> driver send -> log -> auto-advance lead_status new->contacted on send / contacted->qualified on positive reply / ->lost on unsubscribe). API routes: mailboxes CRUD + test + Microsoft/Google OAuth start/callback, campaigns CRUD with pause/resume, draft generator per lead, messages list + approve + reject, replies list, replies poll (cron + manual). Netlify cron outreach-poll-cron.mts (every 15 min). UI: /admin/av/outreach overview with live polling + once-per-day positive-reply celebration, /admin/av/outreach/new campaign wizard, /admin/av/outreach/[campaign_id] detail + edit + pause, /admin/av/outreach/mailboxes connect HostGator + OAuth handoff. OutreachPanel tab on every lead with sparkle Generate button + audit-excerpt callout. Sidebar Outreach link. Per val: NO third-party cold-email SaaS (Instantly not used) -- multi-driver architecture lets the operator and each client send from mailboxes they already own.
- `<pending>`  Grok Imagine  --  schema/011 grok_imagine_assets + grok_imagine_log, lib/grok/imagine.ts (xAI image + async video client), lib/grok/discoverer.ts (per-lead orchestrator with audit-driven prompt), POST + GET + DELETE routes at /api/admin/av/leads/[audit_id]/commercial[/[asset_id]], CommercialPanel.tsx + new "Commercials" tab on lead detail. Pricing surfaces intentionally untouched per Val (decision pending).

## 2026-05-17

- `e8ee628`  Auto-Scoring + Events  --  schema/010 system_events table, lib/events/log.ts, lib/ai/score_and_audit.ts, fire-and-forget scoring on every lead insert across Apollo / Google Places / Instagram / CSV / scrape, /admin/events observability page, owner Re-score button, daily 07:00 UTC score-sweep cron, Sidebar link
- `50bc550`  Client Portal  --  schema/009 client_users table, magic-link auth, /client/dashboard, /client/audit, /client/login, /client/set-password pages, middleware.ts client-route routing, lib/auth/client-*, lib/client-portal/tiers.ts

## Earlier shipped (pre-changelog)

- 2026-05-17  schema/008 target_business + normalized_domain + archive index
- 2026-05-16  schema/007 Apollo integration + apollo_search_log
- 2026-05-16  schema/006 enrichment + Hunter credit log
- 2026-05-16  schema/005 EBW detail tables
- 2026-05-12  schema/004 AV detail tables (v1 through v4)
- 2026-05-11  schema/001-003 platform + HH detail + seed
