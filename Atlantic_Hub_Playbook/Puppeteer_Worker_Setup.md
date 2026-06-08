# Puppeteer Worker Setup (#422 / #531)

**What this is:** a one-time setup to bring a headless Chromium-driven worker
online on the HostGator account. Once it's running, every county-records,
state-recorder, and assessor adapter that's been queued can ship — including
the Forsyth County qPublic property lookup that turns Mark's address into
real owner / assessed-value / mortgage data.

**What it costs:** $0 in new fees. Uses the HostGator we already pay for.
The only "cost" is one-time setup time.

---

## What I need from val to begin

These three answers unblock the whole rollout. Reply with them when ready.

1. **HostGator plan tier.** Log in at `portal.hostgator.com` → click the
   account → there'll be a plan label. We need **VPS** (any size) or
   **Dedicated**. If it says **Shared / Hatchling / Baby / Business**, we have
   to upgrade before Puppeteer will run — shared plans block the system-level
   `apt install` that Chromium needs.

2. **SSH access.** On VPS/Dedicated plans this is enabled by default but
   sometimes needs a one-click toggle in the portal under "Security → SSH
   Access." Confirm it's on; share the hostname (looks like `1.2.3.4` or
   `gatorXXXX.hostgator.com`). I don't need the password — when we provision
   I'll have you paste a public SSH key instead.

3. **A subdirectory I can write to.** I suggest `/home/<user>/workers/puppeteer/`.
   This is where the worker code, the queue, and the cached scrapes live.
   Anywhere outside `public_html` is fine.

---

## What I'll do once those answers are in (one session, ~half a day)

1. **System packages.** SSH in, install Node 20 + Chromium + the X-server
   stubs Chromium needs. Single command on Ubuntu: `apt install chromium-browser
   libgbm1 libnss3` plus the Node 20 setup script. About 4-5 minutes.

2. **Worker scaffold.** Drop a small Node service at `/workers/puppeteer/`
   that polls a queue table in the hub's MySQL (`puppeteer_jobs`). On each job
   it opens Chromium headless, drives the target site, scrapes the result,
   writes back to `public_intel_records` keyed by job. ~80 lines of code,
   I've done this before.

3. **Queue protection.** Concurrency cap of 1 at first so we don't burn
   bandwidth. Rate-limit per target site (e.g. don't hit qPublic more than
   once every 3 seconds — they don't publish a rate but I've never gotten
   blocked at that pace). User-Agent string identifies as research traffic.

4. **First adapter: Forsyth County qPublic.** Test with Mark's address as the
   first job. If it returns owner + assessed value + last sale, the pattern
   is proven and we can roll out the other county adapters that are queued
   (#430, #431, #424, #425, #426, #427).

5. **Hook into the address-screen route.** When val hits "Screen each address"
   the route now also enqueues a per-address property-record job. The
   "📋 pending worker" stub note flips off the moment the job completes.

---

## What's blocked behind this

- **#430** Anne Arundel Assessor adapter
- **#431** Anne Arundel Circuit Court adapter
- **#424** Maryland Judiciary Case Search adapter
- **#425** CA Acclaim platform adapter (Nevada County + ~15 sister counties)
- **#426** VA statewide adapter via Virginia Judicial System
- **#427** Remaining CA platforms (Tyler/Eagle for LA, Granicus/Laserfiche)
- **GA SOS adapter** — automated entity status lookups (right now you manually
  paste the GA SOS payload into the dossier)
- **Forsyth County qPublic** — the actual per-property LTV signal that fills
  out the address-screen result
- **The DD Report's property records section** — once any of the above ships,
  the report gets a real "Property Records" block instead of the manual notes

---

## If the HostGator plan is shared and we don't want to upgrade

Two fallback paths, both still free:

- **Render.com free tier** — 750 hours/month free, supports Puppeteer
  natively, deploys from the same GitHub repo. The catch: free tier sleeps
  after 15 min of no requests, so jobs that get queued during the sleep
  wait until the next poll wakes it. Fine for KYC sweeps; not ideal for
  high-volume distress watchlists.

- **Fly.io free tier** — 3 shared VMs free, no sleep, Puppeteer works.
  Slightly more setup than Render. Best of the free options.

Either of these is a 1-2 hour pivot if the HostGator path is blocked.

---

**Status:** waiting on plan-tier + SSH confirmation from val (questions 1-3
above). Ping me here when ready.
