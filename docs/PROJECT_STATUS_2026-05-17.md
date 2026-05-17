# Atlantic Hub + Atlantic & Vine — Project Status 2026-05-17

**Owner:** Atlantic And Vine LLC
**Operator:** Val Fulton
**Live URLs:**
- atlanticandvine.netlify.app (marketing site, HTML/CSS/JS)
- atlantic-hub.netlify.app (operator dashboard, Next.js)
- api.atlanticandvine.com (PHP backend on HostGator)
- atlanticandvine.com (Pixieset photos, separate)

---

## WHAT WE'VE BUILT (live as of 2026-05-17)

### Multi-tenant operator dashboard at atlantic-hub.netlify.app

Multi-source lead discovery engine across 4 channels, all writing to one
deduplicated leads table (shhdbite_AV.leads). Cross-source dedup by normalized
domain. Auto-segmentation by industry into AV / EBW / Both pipelines so
hospitality leads land in both Atlantic & Vine and Events by Water views.

**Discovery sources (all live, all deduped, all auto-target-business-tagged):**
- Apollo.io organizations/search + top-people lookup (B2B contacts by ICP)
- Google Places (New) text search + place details (local + hospitality coverage)
- Apify Instagram Profile Scraper with inline link-in-bio scraping (boutique businesses)
- Direct contact-page scraper using regex over raw HTML (websites without B2B presence)

**Enrichment layer:**
- Hunter.io email verification (daily 6 AM UTC cron, credit-guarded at 45/mo)
- Per-lead AI scoring with Hot/Warm/Cool fit bands + reasoning
- Strategic Marketing Audit auto-generated for each lead (audit_content column)
- Inline contact-page scraping during Instagram discovery
- Bulk "fill from existing websites" button to enrich Apollo leads where Hunter struck out

**Pipeline management:**
- Sortable columns with filter chips (stage, source, enrichment, target_business)
- Data-completeness filters (real email, phone, website, contact name) combinable with AND
- Per-row archive button (soft delete via archived_at)
- Per-lead detail page with notes, events, status edits

**AI content generation:**
- Per-lead "Generate social content" button — produces LinkedIn + Twitter/X + Instagram posts
  in two variants: "For their business" (deliverable for client) or "About their industry"
  (warm-up content for operator)
- Powered by OpenAI gpt-4o-mini (~$0.005/generation)

**Import:**
- CSV upload page at /admin/av/import with fuzzy header mapping
- Cross-source dedup on insert so CSV doesn't duplicate Apollo/Places/IG finds

**Database schema:**
- Migrations 001-008 in production
- target_business ENUM, normalized_domain, archived_at, enrichment_status, apollo_person_id, ai_score, audit_content, etc. all live in shhdbite_AV.leads
- Parallel tables in shhdbite_eventsbywater for EBW-specific data (bookings, revenue)
- shhdbite_hunterhoney for HH tenant
- shhdbite_atlantic_hub for platform-level data

### Marketing site at atlanticandvine.netlify.app

Updated 2026-05-17 with:
- Hero subtitle replaced: "AI-powered lead generation, strategic audits, smart websites, and automated content - all from one dashboard. Close more deals. Reclaim your time. Grow from anywhere."
- Live Results sub-line: removed brand-name references, now "wherever they are"
- Stats card: replaced unverifiable specific numbers with capability badges (TODO: revisit with Option 1 from chat - keep visual numeric weight, change labels for honesty)
- Client Surge feature bullet: "Smart lead generation + auto outreach"
- Client Surge How It Works: added Step 05 Close ("Calls, follow-ups, content, scheduling - all from one dashboard")
- Bigger Vision: Lead Generation description updated, Social Content Generation promoted from Coming Soon to Live
- Custom Solutions / Client Intake / Pop Journey: all "Val" references replaced with "our team" or "our senior strategist"

### Stack actually in use (paid + free tiers)

**Currently active (mostly free tier):**
- Hunter.io (free 50/mo)
- Apollo.io (free trial / basic)
- Apify (free $5 credit)
- Google Places API (free $200 Maps credit)
- OpenAI (pay-as-you-go, ~$5-30/mo)
- Netlify (free)
- HostGator MySQL (already paid as hosting)
- GitHub (free)

**Mentioned in architecture doc, not yet wired:**
- Clay (Val intends to trial)
- PhantomBuster (Val intends to trial)
- Instantly (defer to Phase 2 outreach)
- Twilio (defer to Phase 2 SMS)
- Taplio (defer)
- Prospeo (redundant with Hunter, skip)
- Grok Imagine API (xAI, for image/video — confirmed available, not yet integrated)
- n8n (defer until visual workflow builder needed)
- Supabase (defer until first external paying tenant needs hard data isolation)

---

## WHAT'S LEFT TO BUILD

### Phase 2A — Client Portal (Val's next ask 2026-05-17)

The vision: client intake form leads to a password-protected client dashboard
where the client can see their audit results, see what they're getting at their
current tier, and see greyed-out features they'd unlock by upgrading. This
becomes the recurring engagement surface for paying clients.

**Existing assets:**
- client-portal.html already exists in /Users/atlanticandvine/Documents/Claude/Projects/Atlantic And Vine/
  - Per prior memory: "production-quality but its DB tables were never created"
- atlantic-hub already has multi-role auth scaffolding (super_admin, internal_team, client_admin, client_user, read_only)
- Audit results already get stored in shhdbite_AV.leads.audit_content per lead
- client_id, organization_id, access_scope columns exist in some form

**What to build:**
1. Schema migration: create shhdbite_AV.client_users table (id, client_id, email, password_hash, role, created_at)
2. Auth flow: client login at /client/login or client.atlanticandvine.com/login
3. Client-scoped dashboard at /client/dashboard showing:
   - Their own audit (read from leads.audit_content joined on client_id)
   - Live status of their current package (what they're getting)
   - Greyed-out cards for what they'd get at the next tier (upsell)
4. Magic-link or token-based first-time access: client submits intake form, gets emailed a unique URL with a temporary token, sets password on first visit
5. Wire client-intake form (atlanticandvine.netlify.app/client-intake) to create the client_users row + send the magic-link email

**Estimated complexity:** 2-3 days of focused work. Foundation exists; just connecting pieces.

### Phase 2B — Auto AI scoring on new leads (Task #26 pending)

Right now AI scoring runs manually per lead. Should run automatically on every
new lead insert (Apollo, Places, IG, CSV, scrape, audit form). Background job
or post-insert trigger.

**Estimated complexity:** Half a day. Just wiring existing AI scoring logic to
the insert hooks across all discovery routes.

### Phase 2C — Email outreach automation (architecture doc priority)

The "AI outbound automation" pillar from the architecture doc. Likely via
Instantly integration (cold email send platform). Each high-scoring lead gets
a drafted message, operator approves, system sends. Reply detection routes
back into the dashboard.

**Estimated complexity:** 3-5 days. Wires Instantly API + reply webhooks +
approval UI + per-lead message history. Includes DNS/SPF/DKIM/DMARC setup on
atlanticandvine.com before any sending.

### Phase 2D — AI commercial generation (architecture doc priority)

Per-lead or per-client AI generation of ad scripts, storyboards, image variants,
short video scripts. OpenAI for copy, Grok Imagine API for image + video.
Output downloadable as deliverable.

**Estimated complexity:** 2-4 days. New /admin/av/commercials page, Grok
Imagine integration, output gallery, download/post buttons.

### Phase 2E — Workflow monitoring (architecture doc)

Visual dashboard showing automation status, API health, cron logs, OpenAI
usage, failed jobs. Operator's "what's the system doing right now" view.

**Estimated complexity:** 1-2 days. Reads existing log tables + adds a few new
ones.

### Phase 3 — Client onboarding flow polish

Once the client portal exists, polish the onboarding journey:
- Welcome email sequence
- First-week strategy call scheduler integration (Calendly or similar)
- Auto-generated brand audit deliverable PDF
- Monthly reporting dashboard per client

### Phase 4 — Architecture doc destination state

Multi-tenant white-label SaaS deployment per the master architecture document.
Includes Supabase migration (for proper RLS isolation), n8n orchestration,
white-label theming per agency client, dedicated subdomains per tenant.

This is 6-12 months of work. Trigger by first agency client signing a
white-label contract.

---

## OPEN DECISIONS

1. **Live Results stats on the AV site** — three options proposed in chat 2026-05-17. Pending Val pick.
2. **Atlantic Hub vs separate client subdomain** — host client portal at /client/* on atlantic-hub.netlify.app, OR at client.atlanticandvine.com? Subdomain feels cleaner for branding but adds DNS setup.
3. **Magic-link vs invite-code first-time access** — magic link is friendlier, invite code is simpler to build.
4. **Pricing for the client portal access** — does it come included with every tier, or is it a paid add-on? Probably included since it doubles as the upsell surface.

---

## OPEN BUGS / KNOWN ISSUES

1. **OneDrive + git lock recurring** — workaround is "restart computer" or "fully quit OneDrive". Permanent fix would be moving repos out of OneDrive but Val has rejected this.
2. **AV marketing site contact-scraper false-positive phones** — scraper picks up tracking pixel IDs and timestamps as phone numbers in some cases. Tightening the regex is a polish item.
3. **Val's MacBook hard drive full** — saved to memory. No writes to ~/Desktop or other local-only paths.

---

## MEMORY FACTS FOR FUTURE CLAUDE SESSIONS

These are pinned in auto-memory so future Claude reads them on start:

- User profile (Val Fulton, Atlantic And Vine LLC founder)
- Atlantic Hub is the destination, not parallel CRM surfaces
- Atlantic Hub belongs to Atlantic And Vine LLC, not HunterHoney despite folder location
- AV has two competing surfaces (atlantic-hub AV tab vs client-portal.html)
- AV client portal is real code but DB tables never created
- EBW tab live in atlantic-hub at /admin/ebw
- Deploy topology — 4 properties, where each lives, how each pushes
- ASCII-only in shell commands and commit messages (no smart quotes, em-dashes)
- Never write to local disk paths (Desktop, Downloads, bare Documents)
- Don't trust hallucinated handoff dates
- OneDrive + git lock is recurring; restart computer first if stuck

---

## NEXT STEP FOR VAL TO PICK

In rough order of speed-to-revenue impact:

1. **Auto AI scoring on new leads** (half a day, makes the existing dashboard feel magical immediately)
2. **Client portal Phase 2A** (2-3 days, unlocks the recurring engagement surface — the answer to "how do I keep clients engaged after the audit")
3. **Email outreach automation Phase 2C** (3-5 days, the "freedom of automation" promise made real)
4. **AI commercial generation Phase 2D** (2-4 days, biggest demo wow-factor but lowest immediate revenue impact)
5. **Workflow monitoring Phase 2E** (1-2 days, operator hygiene, defer until something breaks)

Val to pick which to build first.
