# Ownership & Org Context

**Repo:** atlantic-hub
**Owner entity:** Atlantic And Vine LLC (the legal holding company)
**Product:** Atlantic Hub — the unified operator dashboard

---

## ⚠️ About the folder location

This repo lives at:

```
~/Library/CloudStorage/OneDrive-atlanticandvine.com/HunterHoney/_organized/atlantic-hub
```

**That path is misleading.** This repo is NOT owned by HunterHoney. It lives in that folder for historical reasons — the project was originally conceived inside a HunterHoney Claude Code session, so the working copy got dropped there. The actual ownership relationship is the opposite: **HunterHoney is one of the tenants hosted INSIDE Atlantic Hub**, not the parent of it.

If/when this gets cleaned up, the repo could move to a top-level path like `~/Library/CloudStorage/OneDrive-atlanticandvine.com/AtlanticHub/`. Not urgent — just be aware folder hierarchy doesn't equal business hierarchy here.

---

## The actual business hierarchy

```
Atlantic And Vine LLC  ←  Val Fulton's legal holding company
│
├── Atlantic Hub  ←  THIS REPO. Operator dashboard owned by the LLC.
│   │              URL: https://atlantic-hub.netlify.app
│   │              Custom domain pending: admin.atlanticandvine.com
│   │
│   ├── Tenant: HunterHoney Research   →  crypto/AI education business
│   ├── Tenant: Atlantic & Vine        →  marketing/lead-gen agency (also sells the AV client-portal product separately)
│   ├── Tenant: Events by Water        →  DBA, boat-charter marketplace
│   └── Tenant: <future>               →  mortgage advisory, debt servicing, etc. (per the README)
│
├── atlanticandvine.com   ←  marketing site for the Atlantic & Vine agency (separate codebase)
├── hunterhoney.com       ←  marketing site for HunterHoney (separate codebase, separate Netlify project)
├── eventsbywater.com     ←  marketing site for EBW (separate PHP codebase on HostGator)
└── (other) sites and projects under the LLC umbrella
```

---

## Why this matters for future Claude sessions

1. **Don't say "HunterHoney's Atlantic Hub."** Atlantic Hub is owned by Atlantic And Vine LLC. HunterHoney is a tenant *inside* it.

2. **When the user says "the dashboard," they mean THIS app** — not the HunterHoney marketing site, not the AV client-portal, not the EBW marketing site. Confirm before making assumptions.

3. **Code in this repo serves all three tenants.** A change to shared infrastructure (auth, audit, sidebar, layout, feature flags) affects HH, AV, and EBW equally. Tenant-specific code lives under `app/admin/{hh,av,ebw}/` and `app/api/admin/{hh,av,ebw}/` and `lib/db/{hh,av,ebw}.ts`.

4. **The Atlantic & Vine "client portal" is a different product** that lives in `~/Documents/Claude/Projects/Atlantic And Vine` (currently unbuilt on the DB side; never deployed). When AV onboards real paying clients, that portal is what they'd log into — with scoping by `client_id` against the same `shhdbite_AV.leads` table this dashboard reads.

---

## Quick map of the four MySQL tenant DBs (all on the same HostGator cPanel account)

| Database | Tenant | Purpose | atlantic-hub pool |
|---|---|---|---|
| `shhdbite_atlantic_hub` | Platform | Auth, accounts, audit_log, feature_flags, tenants | `lib/db/platform.ts` |
| `shhdbite_hunterhoney` | HunterHoney | Subscribers, FAP applications, cohort waitlist, Research API | `lib/db/hh.ts` |
| `shhdbite_AV` | Atlantic & Vine | Leads, clients, pipeline_stages, lead_notes, lead_events, ai_integrations | `lib/db/av.ts` |
| `shhdbite_eventsbywater` | Events by Water | Charter inquiries, captain applications, vessel listings, investor registrations + atlantic-hub-managed: bookings, revenue_entries, marketing_activity | `lib/db/ebw.ts` |

---

**Bottom line:** read the architecture before the file paths. The architecture is clean — the filesystem layout is just legacy from how Claude Code sessions are organized in OneDrive.
