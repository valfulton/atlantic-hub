# Grok Session Correction: Add Commercials to Sprint/Momentum/Scale

**TO:** The Grok Imagine cowork session
**FROM:** Cowork Claude (conductor) on behalf of Val Fulton
**DATE:** 2026-05-17

## Context (the conductor got pricing wrong, sorry)

The earlier Grok kickoff doc (`CLAUDE_KICKOFF_GROK_IMAGINE.md`) and follow-up doc (`Path A: bundle into Starter/Growth/Scale`) used pricing tier names that DO NOT EXIST in production. The conductor invented "Starter $497 / Growth $1,497 / Scale $3,997" — those are wrong.

**The real production pricing is in `AV_livewebsite/js/packages.js`** which is the canonical source of truth that syncs to Stripe via `js/setup-stripe-products.php`. The live Stripe products + payment links are in `js/stripe-products.json` and are tied to these names:

| Tier ID | Real name | Real price | Live Stripe product |
| --- | --- | --- | --- |
| `sprint` | Client Surge — Sprint | **$1,995/mo** | prod_UShF8eJ80mOBn3 |
| `momentum` | Client Surge — Momentum (Most Popular) | **$3,995/mo** | prod_UShFEa9Tc6VzKQ |
| `scale` | Client Surge — Scale | **$7,995/mo** | prod_UShFTAFXJPTf7b |

Plus add-ons (Dedicated Manager $500, Email A/B $400, Daily Social $300, Voice/SMS $800-Q4-coming), one-time services (Setup $1,500, Strategic Audit $750, Custom Brief $500), and discounts (3mo=0%, 6mo=10%, **12mo=20%**).

**Do not introduce Demo/Debut/Encore/Headliner as separate tiers. Do not introduce Starter/Growth/Scale at lower prices. The Sprint/Momentum/Scale names are tied to real Stripe products and changing them breaks billing.**

## What to do

### 1. Update `packages.js` — add commercial volume into existing tiers

Add a `commercials` field to each existing package object. Do NOT change prices, IDs, or any existing Stripe-tied fields.

```js
sprint: {
  id: 'sprint',
  // ... all existing fields stay ...
  commercials: {
    videosPerMonth: 4,
    imagesPerMonth: 8,
    model: 'grok-imagine-image',
    videoLengthSeconds: 6,
    note: 'Weekly cadence. Perfect for testing the AI commercial system.'
  }
},
momentum: {
  id: 'momentum',
  // ... all existing fields stay ...
  commercials: {
    videosPerMonth: 12,
    imagesPerMonth: 24,
    model: 'grok-imagine-image-quality',
    videoLengthSeconds: 6,
    note: 'Three-a-week cadence. Premium model. Most clients land here.'
  }
},
scale: {
  id: 'scale',
  // ... all existing fields stay ...
  commercials: {
    videosPerMonth: 30,
    imagesPerMonth: 60,
    model: 'grok-imagine-image-pro',
    videoLengthSeconds: 6,
    note: 'Daily commercial drop. Pro model. Human creative review included.'
  }
}
```

### 2. Update the `includes` array on each package

Add commercial line items to the existing `includes` array so they render in the website pricing grid AND the auto-generated contract.

**Sprint** — add at index 3 (after "Weekly Social Media Blasts"):
```
'4 AI Commercial Videos per Month (6-sec, ready-to-post)',
'8 AI Hero Images per Month (1K resolution, all aspect ratios)'
```

**Momentum** — add after "Daily Social Media Blasts":
```
'12 AI Commercial Videos per Month (6-sec, premium model)',
'24 AI Hero Images per Month (2K resolution, all aspect ratios)',
'1-click auto-post to LinkedIn / Instagram / X (when those connectors ship)'
```

**Scale** — add after "AI-Powered Calendar/Booking":
```
'30 AI Commercial Videos per Month (6-sec, pro model)',
'60 AI Hero Images per Month (2K resolution, all aspect ratios)',
'Daily commercial cadence + human creative review'
```

### 3. Add à la carte commercial add-ons

Add these new packages to the `AV_PACKAGES` object using the same structure as existing add-ons:

```js
addon_extra_videos_pack: {
  id: 'addon_extra_videos_pack',
  type: 'one_time',
  name: 'Extra Videos — 10-Pack',
  tagline: 'Add 10 AI commercial videos to any tier',
  price: 390,  // $39 per video
  currency: 'usd',
  active: true,
  addonFor: ['sprint', 'momentum', 'scale'],
  stripeProductId: null,
  stripePriceId: null,
  stripePaymentLink: null
},
addon_extra_images_pack: {
  id: 'addon_extra_images_pack',
  type: 'one_time',
  name: 'Extra Images — 20-Pack',
  tagline: 'Add 20 AI hero images to any tier',
  price: 180,  // $9 per image
  currency: 'usd',
  active: true,
  addonFor: ['sprint', 'momentum', 'scale'],
  stripeProductId: null,
  stripePriceId: null,
  stripePaymentLink: null
}
```

After adding these, **Val needs to run `js/setup-stripe-products.php` to sync the new add-ons to Stripe and generate the product/price/payment-link IDs.** Tell her this in your handoff summary.

### 4. Add a launch-promo discount

The existing `AV_DISCOUNTS` object handles 3/6/12-month commitment discounts. Add a NEW discount type for the launch promo (separate concept):

```js
const AV_LAUNCH_PROMO = {
  active: true,
  discountPercent: 20,
  endDate: '2026-06-15',  // Val sets the real date
  code: 'LAUNCH20',
  label: 'Launch Week — 20% Off',
  description: 'For the first wave of clients. Stacks with annual commitment.'
};

// Helper: stacked discount calculation
function calculateLaunchPlusAnnual(packageId, commitmentMonths) {
  const baseCalc = calculateDiscountedMonthlyPrice(packageId, commitmentMonths);
  if (!baseCalc) return null;
  
  const now = new Date();
  const launchActive = AV_LAUNCH_PROMO.active && now <= new Date(AV_LAUNCH_PROMO.endDate);
  
  if (!launchActive) return baseCalc;
  
  const launchDiscountedPrice = baseCalc.discountedMonthlyPrice * (1 - AV_LAUNCH_PROMO.discountPercent / 100);
  return {
    ...baseCalc,
    launchPromoActive: true,
    launchPromoEndDate: AV_LAUNCH_PROMO.endDate,
    launchPromoDiscountPercent: AV_LAUNCH_PROMO.discountPercent,
    finalMonthlyPrice: Math.round(launchDiscountedPrice),
    totalDiscountPercent: 100 - Math.round((launchDiscountedPrice / baseCalc.baseMonthlyPrice) * 100)
  };
}
```

Export `AV_LAUNCH_PROMO` and `calculateLaunchPlusAnnual` alongside the existing exports.

### 5. Rebuild the commercials pricing page

The page at `atlantic-hub/marketing/commercials-pricing.html` you built earlier needs to be redone. **Keep all the pop-tour aesthetic** — sunset gradient, Fraunces italic, polaroid mockup, marquee strip, "Ready to pop?" finale. Just swap the content:

- Tier names: Sprint / Momentum / Scale (NOT Demo/Debut/Encore/Headliner)
- Tier prices: $1,995 / $3,995 / $7,995 (full price displayed)
- Strikethrough launch price when LAUNCH_PROMO is active: ~~$1,995~~ **$1,596** during launch
- Annual price stacked: "$1,277/mo billed annually during launch week"
- Commercial volume per tier (as built above)
- À la carte options below the pricing grid
- Countdown to LAUNCH_PROMO.endDate at the top of the page

### 6. Update the operator dashboard tier names

The atlantic-hub `lib/client-portal/tiers.ts` file uses tier names `'audit_only' | 'starter' | 'growth' | 'scale'`. These are WRONG (the conductor's bug — not yours). The real names per packages.js are `'audit_only' | 'sprint' | 'momentum' | 'scale'`.

Change:
1. `lib/client-portal/tiers.ts` — `ClientTier` type and all references
2. `schema/009_client_portal.sql` — `client_users.tier` ENUM (write a migration `schema/015_tier_rename.sql` that's idempotent and renames the enum value; do NOT just edit 009 since that's already applied in production)

Use `ALTER TABLE ... MODIFY COLUMN ... ENUM(...)` with the new values. For existing rows where `tier='starter'`, migrate to `tier='sprint'` etc. Use the same idempotent `information_schema` guard pattern as migration 008.

### 7. Update the docs (atlantic-hub side)

- `docs/PRODUCT_VISION.md` — replace ALL Starter/Growth/Scale references with Sprint/Momentum/Scale at the real $1,995/$3,995/$7,995 prices. Update the scored-lead gating table similarly. Drop the legacy "Momentum $1,497" note.
- `docs/SESSION_COORDINATION.md` — mark schema 011 (Grok) and the new 015 (tier rename) when shipped
- `docs/CHANGELOG.md` — append entries

### 8. Update `client-portal/tiers.ts` feature matrix

The `TIER_FEATURES` object should now reflect commercials as included at the right volume per tier. Use the same volume numbers as packages.js.

For `audit_only` (free), `locked` items should reference Sprint as the next tier, not Starter.

For `sprint`, `included` should add the 4 videos + 8 images line. `locked` references Momentum/Scale.

Etc.

## Why this matters (positioning context for your build)

Val's competitive position vs market (research done 2026-05-17):
- AI marketing platforms DIY: $99-499/mo
- Lead gen agencies (her direct competition): $2,885-$20,000/mo, avg $3,200/mo
- HubSpot + Clay + Apollo bundle: ~$1,200/mo for just the tools, no service

Sprint at $1,995 is below the boutique agency floor ($2,885). Momentum at $3,995 is the boutique sweet spot. Scale at $7,995 is mid-market territory. All three are appropriately priced for what's being delivered.

**Critical: do NOT raise prices when adding commercials.** The conductor and Val agreed: adding commercials at the SAME price is a closing weapon, not a justification for a price hike. The sales story becomes: "Agencies charge $500-$2,000 per video. Momentum gives you 12 videos AND 24 images for $3,995 — that alone is $6,000-$24,000 in agency value at SaaS economics." That story closes deals faster than higher prices do. Re-audit pricing after 10 paying clients.

## What Val will do after you ship

1. Run `js/setup-stripe-products.php` to create new add-on Stripe products
2. Run schema/015 migration (the tier-rename) in phpMyAdmin
3. Verify the commercials-pricing.html renders correctly with the launch-week countdown
4. Update `LAUNCH_PROMO.endDate` to the real date

## What to NOT do

- Do NOT change `monthlyPrice` on sprint/momentum/scale. They are tied to live Stripe payment links that customers may already be using.
- Do NOT delete or rename existing packages. Add fields only.
- Do NOT touch `addon_voice_outreach` — that's TCPA-gated and active=false on purpose. Leave it alone.
- Do NOT introduce another set of tier names. Sprint/Momentum/Scale are the lock.
- Do NOT use smart quotes or em-dashes in commit messages.

## Done?

When complete:
1. Update `docs/PROJECT_STATUS_<date>.md` with what shipped
2. Append to `docs/CHANGELOG.md` with the commit hash
3. Update `docs/SESSION_COORDINATION.md` to mark schema 011 and 015 as shipped
4. Hand back a one-paragraph summary to Val

Ship.
