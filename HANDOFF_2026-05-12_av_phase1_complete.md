# Handoff — AV Tab Phase 1 Complete

**Date:** 2026-05-12  
**Commit:** e4fd924  
**Branch:** main  
**Author:** Val Fulton + Claude Sonnet 4.6  
**Status:** Pushed to GitHub. Awaiting Netlify deploy.

---

## What shipped in this session

Phase 1 of the AV (Atlantic & Vine) tab: a read-only dashboard that lets Val log into Atlantic Hub and see the 12 live audit-form leads stored in `shhdbite_AV.leads`.

### Files changed — 14 total

#### Bug fixes (2)
| File | Fix |
|---|---|
| `lib/db/av.ts` | Default DB name `'shhdbite_av'` → `'shhdbite_AV'` (line 27) |
| `schema/003_seed.sql` | DB name in tenants INSERT + `tab_av_enabled` flipped to `TRUE` for future fresh installs |

#### Shared nav (4)
| File | Change |
|---|---|
| `app/admin/layout.tsx` | Made async; reads `tab_av_enabled` flag + user role from middleware headers; passes `showAv` to Sidebar |
| `components/Sidebar.tsx` | Added `showAv` prop; AV nav entry appended after HH entries (conditionally) |
| `components/StatusBadge.tsx` | Added AV-specific badge values: `converted`, `won`, `contacted`, `qualified`, `warm`, `lost`, `hot` |
| `app/globals.css` | Added `.field-label` utility class used by lead detail tabs |

#### New AV pages (3)
| File | What it does |
|---|---|
| `app/admin/av/page.tsx` | Landing page: stats rail (total/new/in-pipeline/AI-scored) + leads table with stage and source_type filter form. Header: "Atlantic & Vine — Audit-form leads (your business)". All 12 leads visible immediately. |
| `app/admin/av/[audit_id]/page.tsx` | Detail page: server component; fetches lead by UUID from API; renders breadcrumb + status badges + tabs panel |
| `app/admin/av/[audit_id]/LeadDetailTabs.tsx` | Client component: 6-tab view (Identity, Audit, Challenge, AI Scoring, Notes, Events). Legacy fields collapsible in Identity tab. Notes + Events are empty placeholders for Phase 2. |

#### New API routes (5)
| File | Endpoint | Returns |
|---|---|---|
| `app/api/admin/av/stats/route.ts` | `GET /api/admin/av/stats` | `{ stats: { total, byStage, aiScored } }` |
| `app/api/admin/av/stages/route.ts` | `GET /api/admin/av/stages` | `{ stages: [...] }` — 6 pipeline stages for av-internal |
| `app/api/admin/av/integrations/route.ts` | `GET /api/admin/av/integrations` | `{ integrations: [...] }` — 5 ai_integrations registry rows |
| `app/api/admin/av/leads/route.ts` | `GET /api/admin/av/leads[?stage=&source_type=]` | `{ leads: [...] }` — up to 500, submission_date DESC |
| `app/api/admin/av/leads/[audit_id]/route.ts` | `GET /api/admin/av/leads/:audit_id` | `{ lead: { ...full row } }` — lookup by UUID; non-UUID → 400 |

All routes: `guardAdminRequest` (rate limit + audit log) → `client_user` role check (403) → `tab_av_enabled` flag check (403) → `getAvDb()`.

---

## Manual SQL Val must run in phpMyAdmin after deploy goes green

These update the **live** `shhdbite_atlantic_hub` DB. The `003_seed.sql` fixes only apply to future fresh installs.

```sql
-- Run in shhdbite_atlantic_hub:
UPDATE shhdbite_atlantic_hub.tenants
  SET db_name = 'shhdbite_AV'
  WHERE tenant_id = 'av';

UPDATE shhdbite_atlantic_hub.feature_flags
  SET enabled = 1
  WHERE flag_name = 'tab_av_enabled';
```

After running these, the AV tab will appear in the sidebar for owner/staff users and all 12 leads will be visible.

---

## Deploy confirmation

- **Commit SHA:** e4fd924  
- **Push target:** `origin/main` → `https://github.com/valfulton/atlantic-hub.git`  
- **Netlify deploy:** triggered automatically on push. Watch the Netlify dashboard for green.  
- **Build output (local verification):** `npm run build` exited 0, 0 TypeScript errors, all 5 AV API routes and 2 AV pages appear as dynamic (`ƒ`) routes in the build manifest.

---

## Security gates on all AV routes

| Gate | Mechanism |
|---|---|
| Auth | `middleware.ts` verifies `ah_session` JWT (HS256) — bad/missing → 401 |
| Actor extraction | `guardAdminRequest` reads `x-ah-user-id/role/session` from middleware-stamped headers |
| Rate limit | 60 req/min per session via `checkAndConsume` — 429 on breach |
| Role | `client_user` → 403 on every AV route |
| Feature flag | `tab_av_enabled` → 403 if false (30s cache) |
| Input validation | `[audit_id]` path param validated against UUID regex before any SQL; filter query params validated against allowlists |
| SQL injection | All user-supplied values passed as parameterized arguments to `db.execute()` |
| PII in logs | Error responses expose only `(err as Error).name`, never message/stack/email/company |

---

## Phase 2 scope (queued for next session)

These were explicitly out of scope for Phase 1 and are ready to plan:

1. **Mutations** — stage changes, note creation, tag management, archived_at soft-delete
2. **AI scoring pipeline** — wire Claude API against `leads` rows; populate `ai_score`, `ai_score_band`, `ai_score_reason`, `ai_email_subject`, `ai_email_body`, `ai_model_version`, `ai_last_scored_at`
3. **CSV import** — bulk lead ingest with dedup strategy (see COLLISION_REPORT_v4 constraint: `leads.email` is UNIQUE; need pick-or-upsert)
4. **Notes tab** — `lead_notes` table is live; wire `POST /api/admin/av/leads/[audit_id]/notes` + render in Notes tab
5. **Events tab** — `lead_events` table is live; render event timeline
6. **Content engine display** — the integrations panel on the AV landing page could show the 5 `ai_integrations` registry rows (already accessible via `GET /api/admin/av/integrations`)

---

## Schema docs still untracked

These files from the previous schema-design session are in the repo tree but not committed. Archive to `schema/_archive/` or commit them separately — they're not needed to run the app but are useful reference:

- `schema/004_av_detail.sql` (v1, deprecated)
- `schema/004_av_detail_v2.sql` (deprecated)
- `schema/004_av_detail_v3.sql` (superseded)
- `schema/004_av_detail_v4.sql` — **this is the live migration** (already applied to `shhdbite_AV`)
- `schema/ALIGNMENT_NOTES.md`, `COLLISION_REPORT.md`, `COLLISION_REPORT_v3.md`, `COLLISION_REPORT_v4.md`, `MIGRATION_STRATEGY.md`, `HANDOFF_2026-05-12_av_schema.md`, `HANDOFF_2026-05-12_av_schema_v3.md`, `HANDOFF_2026-05-12_av_schema_v4.md`
