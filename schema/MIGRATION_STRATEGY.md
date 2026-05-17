# MIGRATION_STRATEGY — three paths for the AV portal schema

**Date:** 2026-05-12
**Author:** Cowork session (after Opus 4.7 pushback)
**Prerequisite reading:** `COLLISION_REPORT.md`
**Decision needed from Val:** which of paths A, B, or C to apply. **My recommendation is at the bottom.**

---

## Path A — Namespace the new portal tables

Prefix every new portal table with `portal_`. Existing AV marketing-site tables are untouched. The two systems coexist in the same DB.

### SQL changes
- Rename in `004_av_detail_v2.sql`:
  - `clients` → `portal_clients`
  - `pipeline_stages` → `portal_pipeline_stages`
  - `leads` → `portal_leads`
  - `lead_notes` → `portal_lead_notes`
  - `lead_events` → `portal_lead_events`
  - `client_icps` → `portal_client_icps`
  - `content_recommendations` → `portal_content_recommendations`
  - `email_sends` → `portal_email_sends`
- All FK constraints rename (`fk_stages_client` → `fk_portal_stages_client`, etc.).
- All indexes rename (`uq_client_uuid` → `uq_portal_client_uuid`, etc.).
- `USE shhdbite_AV;` (uppercase, matches live).

### Application-layer changes in `atlantic-hub/`
- `lib/db/av.ts`: fix `DB_NAME_AV` default from `'shhdbite_av'` to `'shhdbite_AV'`. Update `.env.example`.
- All future API routes in `app/api/admin/av/*` query `portal_*` tables.
- TypeScript types use `portal_*` names (or are abstracted via a `PortalClient`, `PortalLead` interface so the table prefix is hidden from the rest of the app).

### Application-layer changes in `AV_livewebsite/`
- **None.** This is the win of Path A. Zero touch on existing PHP.

### Migration sequence
1. Val applies `schema/004_av_detail_v2.sql` against `shhdbite_AV` in phpMyAdmin.
2. Run the smoke tests at the bottom of that file.
3. Update `lib/db/av.ts` casing fix. Push to Netlify.
4. Provision `DB_NAME_AV=shhdbite_AV`, `DB_USER_AV=...`, `DB_PASS_AV=...` env vars.
5. Flip the `tab_av_enabled` feature flag.

### Rollback
- `DROP TABLE portal_leads, portal_lead_notes, …` in dependency order. Existing tables untouched, so no data risk.

### Smoke tests
- `SELECT COUNT(*) FROM leads; SELECT COUNT(*) FROM portal_leads;` — should be 12 and 0 respectively.
- Submit the audit form on `atlanticandvine.com` — should write to `leads`, NOT `portal_leads`.
- Create a portal client + lead via API route — should write to `portal_clients`/`portal_leads`.

### Cost
- Long-term: two parallel CRMs in the same DB. The audit-form `leads` and the portal `leads` will diverge — eventually you may want to unify them and then you're refactoring with live data. Mild ongoing confusion ("which table do I query?") that good naming and docs partially mitigate.
- Engineering: lowest (just the rename pass).

### Benefit
- Zero risk to existing live data.
- One DB, one connection pool, one set of credentials.
- Can later be reorganized into Path B (merge) without changing DBs.

---

## Path B — Migrate existing data into the new schema

Backfill the 12 audit-form leads, 4 client_intakes, and 2 client_pop_journey rows into the new portal schema. Update the live PHP endpoints to write to the new tables. Eventually drop the legacy ones.

### SQL changes
- `004_av_detail_v2.sql` keeps the unprefixed names (`clients`, `pipeline_stages`, `leads`, …).
- A separate `005_av_data_migration.sql` does the backfill:
  - Insert one `clients` row representing Val's own internal AV-internal client (already in the seed).
  - For each existing `leads` row: INSERT into the new `leads` table with mapped columns:
    - `company` → `company`
    - `contact_name` → `full_name`
    - `email` → `email`
    - `phone` → `phone`
    - `challenge` → `ai_score_reason`? Probably better: drop into `source_payload.challenge`.
    - `audit_content` → `source_payload.audit_content`
    - `lead_status` → map to a new `pipeline_stage_id` (need 5 new stages: new/contacted/qualified/converted/lost)
    - `client_id` → set to the av-internal client's id
    - `source_type` → 'manual' (or a new enum value 'audit_form')
  - For each existing `client_intakes` row: this is a different lifecycle — these are people who *hired* AV. Probably create a separate `intakes` table in the portal schema, or treat them as another `client` row in `clients`. **Modeling decision required from Val.**
  - For each existing `client_pop_journey` row: this is the proposal funnel. It doesn't fit the portal's lead model at all. Either keep as-is or build a portal feature for it.
- Drop legacy tables: `DROP TABLE leads_legacy, client_intakes_legacy, ad_partners_legacy, ...` only after verifying the live PHP writes have been redirected.

### Application-layer changes in `atlantic-hub/`
- All the same as Path A, plus a full set of UI for clients/intakes/pop-journey.

### Application-layer changes in `AV_livewebsite/`
- Rewrite the four PHP endpoints to write to the new schema:
  - `api/index.php :: handleAuditSubmission()` — INSERT into new `leads` with `client_id = av-internal`, `source_type = 'audit_form'`, etc. Mapping `challenge` → `source_payload.challenge`, etc.
  - `api/process-intake.php :: handleClientIntake()` — INSERT into new `clients` or a new `intakes` table.
  - `api/pop-journey-backend.php` — three POP handlers, all writing to new tables.
  - `api/client-surge-submit.php` — same as audit form path.
- Either:
  - (Option B1) Hard cutover: rewrite the PHP, drop the legacy tables, ship. Risk: any data drift breaks live forms.
  - (Option B2) Write-through compatibility: the legacy PHP keeps writing to legacy tables, and a nightly cron syncs them into new tables. Risk: nightly delay, sync drift.

### Migration sequence (B1 hard cutover)
1. Apply schema (creates new tables alongside old).
2. Run data backfill script — copies 12+4+2 rows into new schema. **Verify counts.**
3. Pre-deploy the new PHP files to a staging path on HostGator.
4. Atomically swap (overwrite old PHP files).
5. Smoke test live forms.
6. After 48h burn-in, `DROP TABLE` the legacy tables. **Past this point, rollback is restore-from-backup.**

### Rollback (during sequence)
- Steps 1-3 are reversible (just `DROP` the new tables).
- Step 4+ requires restoring the old PHP files. If you ALSO already dropped the legacy tables (step 6), rollback requires a database restore from backup.

### Smoke tests
- All form submissions on `atlanticandvine.com` land in the new schema.
- The 12 historic leads are present and queryable.
- `lead_attributions`, `email_log`, `revenue_tracking` FKs either dropped or repointed.

### Cost
- Real engineering: 1-2 weeks. The column mapping is non-trivial (audit-form leads don't map cleanly to LinkedIn-prospect leads).
- Real risk: live forms break if mapping is wrong. Loss of historical data if rollback fails.
- Sequencing: must coordinate PHP deploy on HostGator with SQL migration in phpMyAdmin — these are two separate hosts.

### Benefit
- One canonical CRM. Atlantic Hub owns all AV data end-to-end.
- Eliminates the legacy `leads` / `lead_attributions` / `email_log` / `revenue_tracking` tables (currently 12 rows of data + 0 in the others).
- Long-term cleanest end state.

---

## Path C — New database for the portal

Leave `shhdbite_AV` entirely untouched. Create a new DB (e.g., `shhdbite_av_portal`) and put the 8 portal tables there. Atlantic Hub reads/writes the new DB. Legacy AV marketing site keeps writing to `shhdbite_AV`.

### SQL changes
- Create new DB on HostGator (cPanel → MySQL Databases). **HostGator has a DB count limit per cPanel account (typically 25 or 100 depending on plan). Need to verify Val isn't near the cap.**
- `004_av_detail_v2.sql` targets `shhdbite_av_portal` instead of `shhdbite_AV`.
- All tables unprefixed (`clients`, `pipeline_stages`, `leads`, …) — the DB name is the namespace.

### Application-layer changes in `atlantic-hub/`
- `lib/db/av.ts` is renamed conceptually (still serves the AV product) but its `DB_NAME_AV` default changes to `'shhdbite_av_portal'`.
- Update tenant row in `shhdbite_atlantic_hub.tenants` for `tenant_id='av'`: `db_name = 'shhdbite_av_portal'`.
- API routes in `app/api/admin/av/*` query the new DB pool.

### Application-layer changes in `AV_livewebsite/`
- **None.** The legacy PHP keeps doing exactly what it does today, against `shhdbite_AV`.

### Cross-DB read needs (likely future, not v1)
- If the Atlantic Hub home page needs to aggregate MRR across AV's marketing-site clients AND portal clients, it'll need to query both DBs and reconcile. Cross-DB joins are not possible in MySQL — each pool queries its own DB and the app merges in memory.
- If the portal ever needs to surface an audit-form lead as a portal lead (e.g., a prospect filled out the audit form, then became a client and Val wants to import them as a portal lead): an explicit import step would copy the row, not a live JOIN.

### Migration sequence
1. Val creates `shhdbite_av_portal` in HostGator cPanel.
2. Val creates a new MySQL user with permissions on that DB only.
3. Apply `schema/004_av_detail_v2.sql` against `shhdbite_av_portal`.
4. Run smoke tests.
5. Update `shhdbite_atlantic_hub.tenants` row for `'av'` to point at the new DB name (`UPDATE tenants SET db_name = 'shhdbite_av_portal' WHERE tenant_id = 'av';`).
6. Provision Netlify env vars: `DB_NAME_AV=shhdbite_av_portal`, `DB_USER_AV=...`, `DB_PASS_AV=...`.
7. Flip the `tab_av_enabled` feature flag.

### Rollback
- `DROP DATABASE shhdbite_av_portal`. The live AV marketing site is unaffected. Rollback time: seconds.

### Smoke tests
- Same as Path A but against `shhdbite_av_portal`.
- Confirm the legacy AV site's audit form still writes to `shhdbite_AV.leads`.

### Cost
- Two DBs to manage, two pools (already true — Atlantic Hub manages 4 DB pools today, adding a 5th is marginal).
- Cross-DB joins are impossible in MySQL; aggregations across both must happen in app memory.
- HostGator DB-count limit may bite. Check the plan limit.

### Benefit
- **Zero risk to the 12 live leads + 4 intakes + 2 pop-journey rows.** Strongest isolation.
- Rollback is trivial.
- Defers the "unify the CRMs" decision indefinitely — you can decide later, when the portal has its own production data, whether to absorb the legacy AV CRM.
- Cleanest mental model: "marketing-site CRM lives in `shhdbite_AV`; client-portal CRM lives in `shhdbite_av_portal`."

---

## Deliverable 4 — My honest recommendation

**Path C (new DB) is what I'd choose, with Path A (namespace) as the strong fallback if HostGator's DB count limit blocks creating a fifth DB.**

Reasoning:

1. **The two systems are different products, not different views of the same data.** Audit-form leads are "people who want to hire AV." Portal leads are "people AV's clients want to reach out to." Lumping them into one DB invites confusion every time someone writes a query. Two DBs makes the conceptual boundary physical.

2. **The marketing-site CRM is mature live infrastructure.** 12 leads, 4 intakes, 2 pop-journey rows is small in absolute terms but it's running every day. The cost of breaking the audit form on `atlanticandvine.com` (which would silently lose new leads until detected) is large relative to the upside of "one DB vs two."

3. **HostGator's existing pattern already supports multi-DB.** Your three tenant DBs in Atlantic Hub (`shhdbite_hunterhoney`, `shhdbite_AV`, `shhdbite_eventsbywater`) plus the platform DB makes 4. Adding a 5th is the same architecture, not a new one. (Provided you're not at HostGator's plan limit.)

4. **Rollback cost is asymmetric.** Path C rolls back in seconds with zero data risk. Path B rolls back from a backup if past step 6. Path A rolls back cleanly but leaves you stuck with two parallel CRMs forever (or doing Path B later anyway, with more code on both sides to untangle).

5. **It buys time for the real decision.** Six months from now, you'll know whether the portal's `leads` and the marketing site's `leads` truly are different products (in which case Path C was right) or whether they should have been merged (in which case Path B becomes a known, scoped data-migration project with clear semantics — by then the column mappings will be obvious).

**The one thing I'd check before committing to Path C:** HostGator cPanel → MySQL Databases page should show your current DB count vs. plan limit. If you're near the cap, fall back to Path A. (Path A is still better than Path B for v1 — the column-mapping cost of Path B isn't justified yet.)

### What I'd specifically NOT do regardless of path

- Do not run the existing `atlantic-hub/schema/004_av_detail.sql` against any DB. The case-sensitivity bug + the `leads` collision make it unsafe.
- Do not drop the legacy `leads` / `lead_attributions` / `email_log` / `revenue_tracking` tables in v1. They're dormant but they document the original system's design intent. Leave them.
- Do not modify any PHP file in `AV_livewebsite/` in this session or the next. That codebase has its own deploy path (`deploy.sh` + manual HostGator upload) and is out of scope for the portal work.

### Question for Val before I write the v2 SQL

**Which path do you want?** Default (if no reply): I'll generate `004_av_detail_v2.sql` for **Path C** (target `shhdbite_av_portal`). If you want Path A, I'll regenerate against `shhdbite_AV` with `portal_` prefixes — the regeneration is mechanical and ~10 minutes.
