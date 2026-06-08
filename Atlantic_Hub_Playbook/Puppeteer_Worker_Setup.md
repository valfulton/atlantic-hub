# Browser-Automation Worker Setup (#422 / #531)

**Status update 2026-06-08:** val confirmed she's on HostGator **Business
Plan** (shared hosting), SSH IP 50.6.19.240 / username shhdbite, shell
access enabled. Shared hosting **blocks native Chromium install** (no root,
no `apt install`). Pivoting from "self-host Puppeteer on HostGator" to a
**managed browser pool** — same outcome, $0/mo, no HostGator changes.

## The new path: Browserless.io

**Browserless** (https://www.browserless.io) runs the headless Chromium for
us. The hub stays on Netlify, calls Browserless via a WebSocket URL, and
gets back rendered page contents. We never have to install or maintain
Chromium ourselves.

### Why this is better than the original HostGator plan

- **$0** on the free tier (1,000 scrape requests per month, plenty for
  early KYC + per-property lookups).
- **No HostGator changes** — Business Plan is fine as-is.
- **Anti-detection built in** — Browserless rotates User-Agents, manages
  cookies, handles common bot-detection. Better scrape success than
  bare Chromium.
- **Scales the day we outgrow free** — paid tiers are $50-200/mo for
  10K-50K requests, still cheaper than upgrading to HostGator VPS ($30/mo
  for the host + we'd still have to maintain the worker).

### Setup checklist (~30 min total, 0 of it on HostGator)

1. **Sign up** at https://www.browserless.io/sign-up. Free tier, no credit
   card required. Save the API token they generate.

2. **Add the token to Netlify** environment variables:
   - Site → Site configuration → Environment variables
   - Add `BROWSERLESS_TOKEN` = the value from step 1
   - Trigger a rebuild

3. **I drop in the client lib + first adapter.** Single PR:
   - `lib/scrape/browserless.ts` — connects via Puppeteer's standard
     `connect()` API to the Browserless WebSocket URL
   - `lib/public_intel/adapters/forsyth_qpublic.ts` — first county adapter,
     drives qpublic.schneidercorp.com search box, scrapes parcel + owner +
     assessed value + last sale + mortgage history
   - Hook into the address-screen route: when val clicks "Screen each
     address", the route enqueues the per-address property job

4. **Smoke test with Mark's address.** First job: 6105 Polo Club Drive,
   Cumming GA 30040. If qPublic returns the parcel, the pattern is proven
   and I roll the rest of the county/state adapters out.

### What lights up the moment Browserless is wired

- **#430** Anne Arundel County (MD) tax assessor — parcel cross-reference
- **#431** Anne Arundel Circuit Court (MD) — no-login county route
- **#424** Maryland Judiciary Case Search — foreclosure court proceedings
- **#425** California Acclaim platform — Nevada County + ~15 sister
  counties
- **#426** Virginia statewide via Virginia Judicial System Online + circuit
  court portals
- **#427** Remaining California platforms — Tyler/Eagle (Los Angeles County
  et al), Granicus / Laserfiche counties
- **Georgia Secretary of State (GA SOS)** automated lookups — entity status
  no longer requires manual paste
- **Forsyth County qPublic** — the actual per-property loan-to-value
  signal that fills out the address-stress screen for Mark
- **Georgia Composite Medical Board** — license status + board actions on
  GA doctors (per the healthcare-source memo, this is the gold for KYC on
  clinicians like Mark)
- **DEA Diversion** — practitioner registration / revocation lookups

### The DD Report's property records section

Currently a `"📋 pending worker"` stub. Once Browserless is connected and
the first county adapter (Forsyth qPublic) runs successfully, the report
gets a real "Property Records" block showing owner + assessed value +
last sale price + open mortgage balance for each address.

### Fallback if Browserless free tier isn't enough

- **Render.com free worker** (750 hours/month free, deploys from GitHub,
  Chromium runs natively) — 1-2 hour pivot if we ever outgrow Browserless.
- **Fly.io free tier** (3 shared VMs, no sleep) — same idea, slightly more
  setup, same $0 price.
- **HostGator VPS upgrade** — only worth it if we end up running 10K+
  scrapes/month and want everything on one bill. $30-50/mo.

---

## What I need from val to actually start

Just one thing: a **Browserless.io account + API token**. Sign up at
https://www.browserless.io/sign-up (takes ~2 minutes, no credit card),
paste the token to me here OR add it directly to Netlify as
`BROWSERLESS_TOKEN`. I'll do the rest — drop the client lib, build the
Forsyth adapter, smoke-test with Mark's address.

---

**Original HostGator-VPS path:** retired. Business Plan won't support
native install. If we ever want everything self-hosted, we can revisit
with a VPS upgrade — but for the foreseeable future, Browserless is the
right call.
