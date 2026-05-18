# Atlantic & Vine - Product Vision

**Permanent reference.** Every Claude Code session should read this before
adding features, writing copy, or making product decisions. Prevents feature
drift across sessions.

**Last reviewed:** 2026-05-17

---

## ONE-LINE POSITIONING

Atlantic & Vine is an **AI-native marketing intelligence platform** that
finds your customers, scores them, audits them, generates the content, and
runs the outreach - automatically. One dashboard replaces a stack of six
SaaS tools.

The buyer-side promise: **power up your business with AI, take back your
time, increase revenue from anywhere.**

---

## CATEGORY POSITIONING

| Category | Description | Atlantic & Vine fits here? |
|----------|-------------|----------------------------|
| Lead-gen agency | Sells time | No |
| Lead-gen SaaS | Sells software seats | No |
| **AI-native platform company** | Sells access to capability that compounds | **Yes - this is the destination** |

The distinction matters. An agency sells time. A SaaS company sells software.
An AI-native platform company sells **operational intelligence** - the moat is
the **intelligence graph** that accumulates over time: which audits get replies,
which outreach angles convert, which industries spike when, which signals
predict close-rate.

Every customer makes the platform smarter for every future customer. That's
the asset.

---

## WHO IT'S FOR

Atlantic & Vine targets businesses where the founder or operator is currently
doing marketing themselves with patchwork tools (or not at all). Specifically:

1. **Service-business founders running their own marketing**
   They have no marketing team, no stack, and no time. They want results
   without learning a new SaaS tool every quarter.

2. **Small-to-midsize businesses that have NOT yet adopted AI**
   This is the largest segment and the most important to remember. They are
   NOT replacing a stack. They are starting from scratch. The platform must
   feel like a real-world expert, not a developer tool.

3. **Boutique agencies serving 5-25 clients**
   They want a white-label deployment so they can offer Atlantic & Vine as
   their own product without learning 6 SaaS interfaces per client account.

What Atlantic & Vine is NOT for:
- Enterprises with existing marketing ops teams (different sales motion)
- Pure consumer marketing (we're B2B + service-business focused)
- Pre-revenue startups with no product-market fit (no leads to qualify yet)

---

## CORE PROMISE

Three things every customer gets:

1. **Find your next customer automatically.** Multi-source discovery across
   B2B databases, local business listings, social platforms, and direct
   website intelligence. Deduplicated, scored, segmented before it hits your
   dashboard.

2. **Know exactly what to say.** Every prospect gets an AI-generated
   strategic audit of their business. What's working, what's broken, where
   the opportunity is. The platform tells you the angle. You bring the
   relationship.

3. **Hand off the content.** Generate LinkedIn posts, Twitter threads,
   Instagram captions, ad hooks, outreach drafts on demand. Your social
   calendar fills itself.

---

## PRICING ARCHITECTURE

Four tiers under the Client Surge brand. All include the full platform plus
a built-in monthly AI commercial allotment (schema/011 grok_imagine). Tier
IDs (sprint / momentum / scale) match the live Stripe products in
`AV_livewebsite/js/packages.js` and `js/stripe-products.json`; renaming
them breaks billing.

| Tier ID | Display name | Monthly | Best for |
|---------|--------------|---------|----------|
| sprint | Client Surge -- Sprint | $1,995 | Founder-led businesses running their own outreach. 4 video commercials + 8 hero images per month. |
| momentum | Client Surge -- Momentum (most loved) | $3,995 | Small businesses ready to scale outreach. 12 video commercials + 24 hero images per month, premium model. |
| scale | Client Surge -- Scale | $7,995 | Established businesses with multiple revenue lines or agencies. 30 video commercials + 60 hero images per month, daily cadence, human creative review. |
| Enterprise / Agency White-Label | Custom | Custom | Agencies serving 5-25 clients under their brand |

Discounts: 3-month commit 0% off, 6-month commit 10% off, 12-month commit
20% off. Launch promo (`LAUNCH20`, ends 2026-06-15 unless extended) adds
20% off any tier and stacks with annual commitment for 36% combined off.

Full tier feature matrix in atlanticandvine.netlify.app/#pricing and the
new commercials landing page at atlantic-hub/marketing/commercials-pricing.html.

Platform cost per active client is ~$60 at scale (Hunter + Apollo + Apify +
OpenAI + Google Places + Grok Imagine + Instantly when added). Gross margin
per Sprint client at full price is ~95%. Even at the launch + annual
combined 36% discount, gross margin stays above 92%.

### Scored-lead gating per tier (updated 2026-05-18)

The client portal surfaces scored leads as the visible value of the platform.
Free and trial users see real scored leads in their dashboard with the rest
greyed out behind an upgrade CTA.

| Tier | Scored leads visible | Why |
|------|----------------------|-----|
| Free audit (no signup) | 5 | Enough to feel the AI quality. Costs ~$0.05 in OpenAI + ~$0.30 in Grok per free commercial. The greyed-out 6th+ cards are the upgrade pitch. |
| 7-day trial (magic-link, no card) | 25 | Felt-volume of a real pipeline before they pay $1,995/mo. Goes read-only after day 7 if not converted. |
| Sprint ($1,995/mo) | 50 / month | Sized so one converted lead at any reasonable LTV covers the tier. Includes 4 videos + 8 images of commercial generation. |
| Momentum ($3,995/mo) | 200 / month | Multi-channel discovery, deeper pipeline. 12 videos + 24 images. |
| Scale ($7,995/mo) | 1,000 / month | Multi-region or multi-line clients. 30 videos + 60 images, daily cadence. |
| Enterprise / White-label | Unlimited | Per-tenant pricing, no cap. |

Caps reset on the first of each calendar month. The free-audit count is
lifetime (5 total, ever), not monthly — that's the wedge, not a recurring
service.

Reasoning recorded for future sessions:
- $0.01 OpenAI cost per scoring call * 5 leads = $0.05 per free signup. At
  even 1 in 100 free signups converting to Sprint at $1,995/mo, ROI is
  ~40,000x cost.
- 5 is the minimum number where a human brain registers "wow, these are
  real and specific" instead of "this is a demo."
- The 7-day trial without credit card is intentional friction reduction --
  SMB buyers need to feel volume before paying $1,995/mo. Magic-link signup
  uses the same auth flow the client portal already uses for audit access.

---

## ROADMAP (capabilities, not features)

### Live now (May 2026)
- Multi-source lead discovery (4 sources)
- Automated enrichment (Hunter + scraping)
- AI scoring + AI audits
- AI social content generation
- CSV import + bulk pipeline management
- Operator dashboard at atlantic-hub.netlify.app

### Next 90 days
- **Client portal** (Phase 2A) - audit results behind login + tiered upsell surface
- **Auto AI scoring on insert** (Phase 2B) - every new lead scored automatically
- **Event logging infrastructure** (foundation for analytics + retry + AI memory)
- **Email outreach automation** (Phase 2C) - Instantly integration
- **AI commercial generation** (Phase 2D) - Grok Imagine + OpenAI scripts

### Next 180 days
- Workflow monitoring + observability dashboard
- Multi-tenant white-label deployment (first external agency client)
- Vector search / embedding-based lead similarity
- Closed-loop learning: AI improves prompts from reply data

### Destination state (12-18 months)
The closed-loop intelligence pipeline:
```
Lead enters
  v
AI enriches
  v
AI scores
  v
AI audits
  v
AI drafts outreach
  v
Human approves
  v
Campaign runs
  v
Results tracked
  v
AI learns what converts
  v
(loops back, smarter)
```

This is the moat. Every additional customer feeds it.

---

## NON-FEATURES (things we deliberately do not build)

- Native social media scheduling (use existing schedulers; we generate content)
- A separate CRM UI for client-facing reps (the operator dashboard IS the CRM)
- Custom website builder (Client Surge includes website build but as a service, not a builder tool)
- Funnel A/B testing platform (out of scope, refer to other tools)

If a customer requests one of these, sell them on integration instead of
ownership.

---

## BRAND VOICE

- **Plural.** "Our team," "our platform," "we." Never "I" or founder name.
- **Confident, not boastful.** State capabilities, don't oversell.
- **No locality language.** Works everywhere. No "USVI specialists" or
  "Annapolis-based" framing.
- **No brand-name dropping** for tools we pay for (Apollo, Hunter, Clay, etc.)
  unless they are a sponsor. We don't advertise other vendors.
- **Outcome-focused.** Close more deals. Reclaim your time. Grow from anywhere.
  Not "use our 4-source discovery engine."

---

## STRATEGIC ASSUMPTIONS

These are bets, not facts. Update if proven wrong.

1. **SMBs are NOT currently using AI for marketing.** We assume the typical
   buyer has never used Apollo, Hunter, or Clay. The pitch is "AI for businesses
   that haven't started yet," not "replace your stack."

2. **The audit is the wedge.** Free AI audit drives intake form fills. Audit
   delivers real value, which earns the right to pitch tiers.

3. **Retention comes from the client portal.** Without a recurring engagement
   surface, agencies churn at 30%+ annually. The portal turns transactional
   audit-buyers into recurring tier-payers.

4. **White-label is the second product.** Once 5-10 direct clients pay, the
   same platform deploys for boutique agencies as their own offering. That's
   the SaaS expansion path.

5. **AI commercial generation is bigger than it looks.** Most agencies offer
   audits OR creative, not both. Doing both at AI speed positions Atlantic &
   Vine as "AI Growth Operating System," not "audit shop."

---

## DECISIONS THE OPERATOR HAS LOCKED IN

- Stay on HostGator MariaDB. No Supabase migration.
- Pricing visible on the marketing site, not gated behind a sales call.
- Free audit is forever free. Never gate it.
- No founder name in customer-facing copy.
- ASCII only in shell commands and commit messages.
- No SaaS subscription until a client justifies the cost.
- No moving git repos out of OneDrive.
