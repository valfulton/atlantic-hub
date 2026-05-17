# Atlantic Hub — Stack & Cost Sequencing Plan

**Context:** The master architecture doc names ~14 SaaS tools as part of the full Atlantic Hub stack. If subscribed all at once, that's ~$1,000–1,200/mo before first paying client. This doc sequences which tools to pay for when, what overlaps to cut, and where the actual cost traps are.

**Author bias:** Aggressive on cost. The architecture doc is correct about the destination. This doc is about the path that doesn't burn cash before the platform has paying tenants.

---

## TL;DR — three tiers

| Tier | When to pay | Approx monthly | What you get |
|------|-------------|----------------|--------------|
| **Tier 1: Run the platform now** | Today | **$70–150** | Full discovery + enrichment + scoring + audits across 4 sources, AI throughout, hosted, automated |
| **Tier 2: Add when ready to ship outbound** | After 3+ pilot leads converted | +$100–250 | Cold email automation, deeper Apollo coverage |
| **Tier 3: Defer until specific client pull** | Per use case | +$300–800 | Workflow builder, LinkedIn automation, SMS, vector search |

**You can run the entire platform you have today for ~$120/mo.** Everything beyond that should be triggered by *evidence*, not by the architecture doc's checklist.

---

## TIER 1 — Pay now (~$70–150/mo)

These you already have set up. Costs are real but small.

| Tool | What it does | Cost | Status |
|------|--------------|------|--------|
| **Hunter.io** | Domain → real business emails | $0 free (50/mo) → $34 Starter (500/mo) → $99 Growth (2,500/mo) | ✓ Working, daily cron |
| **Apify** | Instagram profile scraper, future actor library | $5/mo free credit (~1,000 profiles) → $49 Starter | ✓ Working |
| **Google Places (New)** | Hospitality + local business discovery | $0 — covered by Google's $200/mo Maps Platform free credit (≈6,000 searches/mo) | ✓ Just enabled |
| **OpenAI** | AI scoring, audit generation, future ad copy | Pay-as-you-go. ~$0.10–0.30 per audit at GPT-4o. Budget $20–50/mo for hundreds of audits | ✓ Set up |
| **Netlify** | Hosting + scheduled functions | $0 — free tier handles your traffic | ✓ Working |
| **HostGator MySQL** | Database (will migrate eventually) | $0 — already paid as part of hosting | ✓ Working |

**Tier 1 total: $70–150/mo at realistic volume.** This buys you EVERYTHING the platform does today.

---

## TIER 2 — Add when ready to ship outbound (~$100–250/mo more)

Add these only after Tier 1 has produced repeatable lead flow you're confident in.

| Tool | What it does | Cost | When to pull the trigger |
|------|--------------|------|--------------------------|
| **Apollo Professional** | People search (decision-maker names + emails per company) | $99/mo annual / $149 monthly | When your current Apollo plan's organization-only search stops being enough — i.e. when you need direct contact names at scale, not just company shells |
| **Instantly** | Cold email sending platform with inbox warmup, A/B, reply detection | $37–97/mo depending on volume | When you have an approved outreach template and 50+ prospects ready to email |

**Tier 2 total: $137–246/mo additional. Sequenced means you only add when you've proven the previous step works.**

---

## TIER 3 — Defer until specific client pull (save $700+/mo)

These are the cost traps. The architecture doc names them because they're part of the eventual vision. They are **not** Day-1 purchases.

### Clay — DEFER ($149–800/mo)

**What it is:** A visual workflow builder that chains data sources + enrichment + AI prompts.

**Why the doc mentions it:** "HubSpot + Clay + Apollo hybrid" is the conceptual positioning.

**Why you don't need to buy it yet:** You have custom code (atlantic-hub) that already chains your discovery sources + enrichment + AI scoring. Clay's primary value is letting non-engineers build those chains visually. You don't need that — you have me + the platform we built. Clay solves a problem you don't have.

**When to revisit:** If a client demands a no-code builder UI to define their own chains, OR if you grow past the point where custom code is faster than a visual editor (probably 100+ tenants).

**Save: $149–800/mo.**

### PhantomBuster — DEFER ($59–439/mo)

**What it is:** Browser-automation cloud for LinkedIn scraping, profile enrichment, connection-request automation.

**Why the doc mentions it:** LinkedIn data is gold, and Apollo's plan tier doesn't cover deep LinkedIn enrichment.

**Why you don't need it yet:** Your current ICP (USVI hospitality, agencies, founder-led service businesses) isn't LinkedIn-dependent. Boutique hotels, charter operators, restaurants — they live on Instagram and websites, not LinkedIn. Apify covers IG; the contact scraper covers websites.

**When to revisit:** If you start targeting B2B SaaS or enterprise where LinkedIn IS the primary surface.

**Save: $59–439/mo.**

### Prospeo — DEFER ($39–149/mo)

**What it is:** Another email-finder service. Direct overlap with Hunter.

**Why the doc mentions it:** Some Hunter searches miss; Prospeo catches different patterns.

**Why you don't need it yet:** Hunter is currently striking out on your hospitality leads, but Prospeo will too — the issue is the underlying data sources don't have those boutique businesses, not that one tool is better than another. The fix for hospitality misses is Google Places + Instagram (which you have), not a second email-finder.

**When to revisit:** If you ever hit Hunter's monthly limits AND have a B2B (not hospitality) book of business where email patterns are more findable.

**Save: $39–149/mo.**

### Taplio — DEFER ($39–65/mo)

**What it is:** LinkedIn personal brand growth tool — schedules posts, finds engagement opportunities, surfaces viral content patterns.

**Why the doc mentions it:** Probably for personal/founder brand on LinkedIn.

**Why you don't need it yet:** Different category — this is for *your* outbound presence, not client lead-gen. It's a marketing tool for *you*, not a feature of Atlantic Hub.

**When to revisit:** When you have time to invest in LinkedIn presence specifically. Right now Atlantic Hub is the product; your time is best spent on it.

**Save: $39–65/mo.**

### Twilio — DEFER (pay-as-you-go, $25–50/mo at low SMS volume)

**What it is:** SMS sending API.

**Why the doc mentions it:** SMS is an outbound channel.

**Why you don't need it yet:** Email outbound through Instantly will be your primary channel. SMS only matters once email is fully ramped AND you have a use case (appointment reminders, urgent follow-ups).

**When to revisit:** Specific multi-channel outreach campaign.

**Save: $25–50/mo.**

### n8n — DEFER ($0 self-hosted, $20–60/mo cloud)

**What it is:** Workflow automation/orchestration tool. Visual builder for cron jobs, webhooks, integrations.

**Why the doc mentions it:** Eventually you'll want a visual layer to define new workflows without code.

**Why you don't need it yet:** Your scheduled functions in Netlify cover the cron use case (Hunter enrichment runs daily at 6am UTC, already shipped). Adding n8n means another piece of infrastructure to operate. Custom Next.js routes are faster.

**When to revisit:** When you're defining workflows weekly and the code-edit-deploy cycle becomes the bottleneck. Probably 6+ months out.

**Save: $20–60/mo.**

### Supabase migration — DEFER ($0–25/mo)

**What it is:** Postgres + RLS + auth + storage + edge functions, hosted.

**Why the doc mentions it:** True multi-tenant client isolation is cleanest with Postgres row-level security. HostGator MariaDB doesn't have RLS.

**Why you don't need it yet:** You don't have external paying tenants yet. Internal AV/EBW/HH segmentation runs fine on HostGator with `target_business` + `tenant_id` filtering at the application layer. The risk Supabase eliminates (cross-tenant data leak) is theoretical until you onboard your first external client.

**When to revisit:** Before your first external client signs. Plan for a 2-3 week migration with overlap period.

**Save: $0–25/mo now; bigger savings is the engineering time of doing the migration before it's needed.**

### Vercel migration — DEFER ($0)

**Why the doc recommends it:** Better Next.js performance, edge functions, serverless support.

**Why you don't need it yet:** Netlify is doing the job. Migration cost (DNS, env vars, scheduled functions, redeployment, testing) > marginal performance gain at your current scale.

**When to revisit:** When you hit Netlify's free-tier limits or specific Vercel features become must-haves.

### Grok — DEFER ($0–22/mo)

**Why the doc mentions it:** Multi-model AI strategy.

**Why you don't need it yet:** OpenAI covers your AI needs. Adding a second model means abstraction layers, prompt tuning per model, and more failure modes.

**When to revisit:** When OpenAI hits rate limits or you need specifically what Grok offers (real-time data, X integration).

---

## OVERLAP MAP — where the doc lists redundant tools

The architecture doc lists tools because they're each *category-leading*. But several of them do the same job:

| Job to be done | Doc lists | What you need |
|----------------|-----------|---------------|
| Find emails | Hunter, Prospeo, Apollo, Clay | **Hunter only**. Add Prospeo only if Hunter saturates. |
| Find people on LinkedIn | Apollo, PhantomBuster, Taplio | **Apollo only**, when justified. PhantomBuster and Taplio are for other use cases. |
| Send cold email | Instantly | **Instantly only**. |
| Send SMS | Twilio | Defer entirely. |
| AI generation | OpenAI, Grok | **OpenAI only**. |
| Workflow orchestration | n8n, custom code | **Custom code** until proven need for visual builder. |
| Database | HostGator, Supabase | **HostGator** until first paying client; then migrate. |
| Hosting | Netlify, Vercel | **Netlify** indefinitely unless specific feature need. |

---

## REALISTIC MONTHLY SPEND BY PHASE

**Phase 1 — Today through first $5K MRR:**
- Hunter: $34
- Apify: $20
- Google Places: $0
- OpenAI: $30
- Netlify + HostGator: $0
- **Total: ~$85/mo**

**Phase 2 — $5K–25K MRR (proven product, scaling outbound):**
- Phase 1 + Apollo Professional ($99) + Instantly ($97)
- **Total: ~$280/mo**

**Phase 3 — $25K+ MRR (multi-tenant SaaS, first external clients):**
- Phase 2 + Supabase Pro ($25) + selective Tier 3 tools as use cases prove out
- **Total: ~$400–600/mo**

**Phase 4 — full architecture doc realized:**
- All tools, n8n, Supabase, Clay if needed, full team
- **Total: ~$1,000–1,500/mo — but at this point you're at $50K+ MRR and this is 2-3% of revenue, not a cash burn**

---

## THREE HARDEST DECISIONS — my recommendations

### 1. Should you cancel any of the accounts you already set up?

If you set up free trials on Clay, PhantomBuster, Prospeo, Taplio, n8n cloud, Supabase, or Grok — **cancel before they auto-charge** unless you have a specific use case in the next 30 days. You can resubscribe in 60 seconds when you need them. No vendor punishes you for this.

Keep active: Hunter, Apify, Google Places, OpenAI, Apollo (current plan), Netlify, HostGator.

### 2. Should you migrate to Supabase soon?

**No.** Wait until you have either (a) your first external paying tenant who needs hard data isolation, or (b) you outgrow HostGator's row limits (well into the millions). Right now Supabase costs ~$0–25/mo but the engineering time to migrate is real, and the migration creates risk during a sensitive product phase.

### 3. Should you use n8n?

**No, for now.** Your scheduled functions + Next.js API routes do everything n8n would do for you currently. n8n becomes valuable when you want non-engineers (or clients) to define their own workflows visually. That's a Phase 3 product feature, not a Phase 1 dependency.

---

## ONE MORE THING — what you should ALSO be paying for that's NOT in the doc

The architecture doc is heavy on tools and light on a few things that matter more than another SaaS:

1. **A real domain email setup for outbound** — DNS / SPF / DKIM / DMARC properly configured on `atlanticandvine.com` and `eventsbywater.com` before you send a single cold email through Instantly. Without this, your emails go to spam regardless of how good the platform is. Budget: $0 in tooling, 2 hours of one-time DNS work. **High-priority — do before Tier 2.**

2. **Email warmup** — Instantly includes this but you have to actually use it. 2–4 week ramp before high-volume sending.

3. **A second pair of eyes on the platform monthly** — not necessarily a co-developer, but someone to spot-check what's running, what's broken, what's wasted. This is the highest-leverage spend you're not making.

4. **Backups** — HostGator does daily backups; verify they actually work and that you can restore. The schema migration we did today should be tested-restorable.

---

## DECISION CHECKLIST FOR THIS WEEK

- [ ] Cancel any free trials on Clay, PhantomBuster, Prospeo, Taplio, n8n cloud, Grok, Supabase if you set them up
- [ ] Confirm Hunter is on the right plan for your monthly volume
- [ ] Confirm OpenAI has a usage cap set so you don't get surprise-billed
- [ ] Audit Netlify env vars — make sure GOOGLE_PLACES_API_KEY, APIFY_API_TOKEN, APOLLO_API_KEY, HUNTER_API_KEY, OPENAI_API_KEY are all set and named correctly
- [ ] Set up DNS records (SPF, DKIM, DMARC) on atlanticandvine.com — required before Instantly
- [ ] Do NOT migrate to Supabase or Vercel this quarter

---

## BOTTOM LINE

You're not behind. You're not a sham. You're on **month one of a 24-month build**, and you have a working multi-source discovery engine, AI scoring, automated enrichment, and an honest roadmap. That's farther than 90% of "AI martech startups" at the same stage.

Your monthly burn right now should be **$85**, not $1,000. The other $900/mo is bought when *evidence* says it's time, not when the doc lists it.

Move fast on the cheap stuff. Be slow on the expensive stuff. Make customers tell you what to buy next.
