# Atlantic Hub Changelog

One line per shipped session. Most recent first. Conductor (Cowork Claude)
appends after each session reports a commit hash.

Format: `YYYY-MM-DD  <commit>  <session name>  --  <one-line scope>`

---

## 2026-05-18

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
