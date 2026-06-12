/**
 * lib/av/products.ts  (val 2026-06-11)
 *
 * The Atlantic & Vine product registry. Each product is a packaged offering
 * sold under a vertical pack. The underlying engine pieces (cascade, watchlist,
 * KYC sweep, DD report, brief, cockpit) deliver the work; products are the
 * pricing + customer-facing positioning layer.
 *
 * Why a registry instead of a database table:
 *   v1 keeps these as TypeScript constants so the team can edit pricing +
 *   marketing copy via PR with code review. When custom pricing per buyer
 *   starts (clients.custom_price_cents work), the constants here become the
 *   defaults; per-client overrides come from the billing block on the
 *   operator client row.
 *
 * Sold under the same vertical_pack each product references:
 *   - 'collections' → Adriana / CBB / CLDA
 *   - 'real_estate' → property + investor work
 *   - 'b2b_sales' / 'lending' → mortgage brokers like Marty
 *   - (more verticals codified as packs ship in lib/public_intel/vertical_packs.ts)
 *
 * The public surface is /products/[slug] for the detail page and
 * /products/collections-intelligence (and similar vertical landing pages)
 * for grouped marketing.
 */

export type ProductStatus = 'live' | 'beta' | 'coming_soon';

export interface ProductPricingTier {
  /** Price label shown publicly. Use the format "$499/mo" or "$2,000–10,000/mo". */
  label: string;
  /** Internal monthly low end in USD cents (for forecasting + ICP scoring). */
  lowMonthlyCents: number;
  /** Internal monthly high end in USD cents. */
  highMonthlyCents: number;
  /** What a buyer at this tier gets. One line each. */
  includes: string[];
}

export interface Product {
  /** URL slug — also stable key. Never rename without a redirect. */
  slug: string;
  /** Public-facing product name. */
  name: string;
  /** Vertical pack this product belongs to (matches VerticalPackId in
   *  lib/public_intel/vertical_packs.ts). */
  verticalPackId: string;
  /** Who buys this. One sentence. */
  customer: string;
  /** Headline pitch. One sentence, no jargon. */
  oneLiner: string;
  /** Tagline for the A&V marketing surface. Used as the hero copy on
   *  /products/[slug] and in the grouped landing page card. */
  marketingTagline: string;
  /** Pricing tiers — usually one entry; multi-tier products list all. */
  pricing: ProductPricingTier[];
  /** Which engine pieces deliver this product. Each entry is a short label
   *  pointing at code areas — used internally to verify nothing ships without
   *  its underlying engine being live. */
  engineCapabilities: string[];
  /** What additional engine work needs to ship before this product is fully
   *  delivered. Empty array = ready today. */
  pendingDependencies: string[];
  /** Live / beta / coming-soon flag. Controls public visibility + the badge
   *  on the marketing card. */
  status: ProductStatus;
  /** Optional defensibility note — explains why this is hard to copy. */
  moat?: string;
}

/**
 * THE CANONICAL PRODUCT REGISTRY.
 *
 * Adding a new product:
 *   1. Append an entry below with a unique slug + populated copy.
 *   2. Ensure the verticalPackId exists in vertical_packs.ts.
 *   3. Confirm engineCapabilities reference real shipped code.
 *   4. List any pendingDependencies honestly — don't ship "live" if it's not.
 */
export const PRODUCTS: Product[] = [
  // ── COLLECTIONS VERTICAL PACK (Adriana / CBB / CLDA) ─────────────────────
  {
    slug: 'portfolio-risk-monitoring',
    name: 'Portfolio Risk Monitoring',
    verticalPackId: 'collections',
    customer: 'Banks, suppliers, and small lenders with 50–500 active AR accounts.',
    oneLiner: 'Monitor your existing accounts. We alert when any shows distress signals — with the receipts.',
    marketingTagline: 'Your existing accounts, monitored daily. Alerts before delinquency, not after.',
    pricing: [
      {
        label: '$499/mo',
        lowMonthlyCents: 49900,
        highMonthlyCents: 49900,
        includes: [
          'Up to 50 accounts under continuous monitoring',
          'Bankruptcy, lawsuit, UCC, suspended-entity alerts',
          'Weekly digest of new distress signals',
          'Signal-by-signal evidence trail (the "receipts")'
        ]
      },
      {
        label: '$1,499/mo',
        lowMonthlyCents: 149900,
        highMonthlyCents: 149900,
        includes: [
          'Up to 500 accounts under continuous monitoring',
          'All alerts above + cascade-attribution context per account',
          'Per-account dossier with KYC + address history + lien activity',
          'Weekly digest + daily real-time alerts on high-severity signals'
        ]
      }
    ],
    engineCapabilities: [
      'distress_engine (signal weights + scoring)',
      'distress_watchlist (per-client surfacing)',
      'cascade_attribution (link signals to entities)',
      'weekly digest cron (#244)',
      'KYC sweep + dossier (#524)',
      'address history (schema 084)'
    ],
    pendingDependencies: [],
    status: 'live',
    moat: 'Cascade attribution links every alert back to its originating signals, so the customer can audit why an account flagged — not just that it did.'
  },
  {
    slug: 'vendor-cascade-alerts',
    name: 'Vendor Cascade Alerts',
    verticalPackId: 'collections',
    customer: 'Commercial collections agencies + B2B credit firms hunting net-new business.',
    oneLiner: 'When a big regional company starts to fail, we surface every supplier about to get stiffed. You call them before the bankruptcy hits the news.',
    marketingTagline: 'Every other agency reads about the bankruptcy. You called the suppliers an hour ago.',
    pricing: [
      {
        label: '$999–2,499/mo',
        lowMonthlyCents: 99900,
        highMonthlyCents: 249900,
        includes: [
          'Real-time cascade alerts when distress signals fire on a major entity',
          'Auto-surfaced supplier list using UCC + GBP + court filings',
          'Pre-staged outreach drafts for each surfaced supplier',
          'Premium add-on to Portfolio Risk Monitoring'
        ]
      }
    ],
    engineCapabilities: [
      'cascade_pipeline (#374)',
      'suspended_entity_vendor_exposure recipe (collections pack)',
      'UCC adapter (#379)',
      'cockpit_approvals + body generator for outreach drafts'
    ],
    pendingDependencies: [],
    status: 'live',
    moat: 'Nobody else is wiring the cascade. Every agency reads the bankruptcy news after filing. This product calls the suppliers before the filing hits.'
  },
  {
    slug: 'recovery-probability-scoring',
    name: 'Recovery Probability Scoring',
    verticalPackId: 'collections',
    customer: 'In-house AR teams + smaller collections agencies wasting hours on dead files.',
    oneLiner: 'Hand us your collection list. We score each account by likelihood of recovery — assets visible, other creditors active, entity status — so you focus where ROI is highest.',
    marketingTagline: 'Stop wasting hours on dead files. Know which collections will pay before you make the first call.',
    pricing: [
      {
        label: '$0.50–2.00 per account',
        lowMonthlyCents: 50,
        highMonthlyCents: 200,
        includes: [
          'Bulk upload of collection list (CSV)',
          'Recovery-probability score per account (0–100)',
          'Underlying signals visible per account',
          'Pay-as-you-go pricing — no minimum'
        ]
      },
      {
        label: '$799/mo unlimited',
        lowMonthlyCents: 79900,
        highMonthlyCents: 79900,
        includes: [
          'Unlimited scoring across all uploaded lists',
          'Monthly re-score automation as new signals fire',
          'Recovery-probability dashboard per client portfolio',
          'API access for in-house systems'
        ]
      }
    ],
    engineCapabilities: [
      'distress_engine signal weights',
      'cascade_attribution (creditor count + position)',
      'public_intel_records (asset visibility)',
      'KYC sweep (entity operating status)'
    ],
    pendingDependencies: [],
    status: 'live'
  },
  {
    slug: 'creditor-law-firm-intelligence',
    name: 'White-Label Intelligence for Creditor Law Firms',
    verticalPackId: 'collections',
    customer: 'Small to mid-sized creditor-rights, collections, and bankruptcy law firms (5–50 attorneys).',
    oneLiner: 'Every case opens with a full intelligence snapshot — current liens, court history, asset signals — instead of a paralegal manually pulling records.',
    marketingTagline: "Your paralegal's morning research, automated. Your case opens with the whole picture.",
    pricing: [
      {
        label: '$2,000–10,000/firm/mo',
        lowMonthlyCents: 200000,
        highMonthlyCents: 1000000,
        includes: [
          'Branded client portal (firm-name + logo on every screen)',
          'Per-case intelligence dossier (KYC + DD report + lien history)',
          'Cascade attribution surfaced in every dossier',
          'Unlimited case lookups under firm seat count',
          'Quarterly intelligence training for paralegals'
        ]
      }
    ],
    engineCapabilities: [
      'KYC sweep (#524)',
      'DD Report generator (#525)',
      'client_dossier + red flags',
      'address history',
      'cascade_attribution',
      'brand-kit ingest for firm white-labeling (#208)'
    ],
    pendingDependencies: [
      'White-label dashboard skin per firm — extends existing data-skin="royale" pattern'
    ],
    status: 'beta',
    moat: 'Network effect — each firm using the product improves the underlying signals via their case data. High ACV, sticky, recurring revenue. Each firm replaces 1–3 paralegal hours per case.'
  },
  {
    slug: 'ca-lien-priority-intelligence',
    name: 'CA Lien Priority Intelligence',
    verticalPackId: 'collections',
    customer: 'Bank workouts, construction creditors, and judgment creditors with California exposure.',
    oneLiner: "California's lien system is brutally complex. We map the priority timeline. You know who has claim and in what order.",
    marketingTagline: 'In California, claim priority decides recovery. We map the priority. You move first.',
    pricing: [
      {
        label: '$1,499/mo base + $50 per property deep-dive',
        lowMonthlyCents: 149900,
        highMonthlyCents: 149900,
        includes: [
          'Daily CA SOS + UCC monitoring across portfolio',
          'Lien priority timeline per property (when CA Acclaim adapter ships)',
          'Cross-county recorder cross-reference',
          'Construction lien + mechanic lien alerts',
          'Per-property deep-dive on demand ($50 each)'
        ]
      }
    ],
    engineCapabilities: [
      'CA SOS adapter (shipped)',
      'UCC CA adapter (shipped)',
      'recorder cross-reference (shipped for MD; CA pending)',
      'cascade attribution',
      'KYC sweep'
    ],
    pendingDependencies: [
      'CA Acclaim platform adapter (#425)',
      'Remaining CA county recorder adapters (#427, #461)'
    ],
    status: 'beta',
    moat: 'Most agencies cannot navigate California lien priority. When CA Acclaim ships, this is the only intelligence provider with the timeline mapped county-by-county.'
  },

  // ── MORTGAGE LENDING VERTICAL PACK (Marty Insley / MPG Loans) ─────────────
  // Five products mirror the collections shape: monitor → cascade → score →
  // white-label → state-specific moat. Day-one moat is the MD recorder
  // adapter (#423) — every Maryland deed transfer hits the watchlist before
  // any other broker can see it.
  {
    slug: 'mortgage-portfolio-refi-monitoring',
    name: 'Mortgage Portfolio Refi Monitoring',
    verticalPackId: 'mortgage_lending',
    customer: 'Mortgage brokers + loan originators with a closed book of 100–2,000 borrowers they want to retain through the next rate cycle.',
    oneLiner: 'Monitor every borrower you have closed. We alert the moment a refi window opens — new lien, address change, equity event, or rate-environment shift.',
    marketingTagline: 'Every borrower you closed is monitored daily. You hear about the refi opportunity before Rocket calls them.',
    pricing: [
      {
        label: '$299/mo',
        lowMonthlyCents: 29900,
        highMonthlyCents: 29900,
        includes: [
          'Up to 100 borrowers under continuous refi-trigger monitoring',
          'Address change + lien filing + property transfer alerts',
          'Weekly digest of refi-window opportunities',
          'Borrower-by-borrower signal trail'
        ]
      },
      {
        label: '$999/mo',
        lowMonthlyCents: 99900,
        highMonthlyCents: 99900,
        includes: [
          'Up to 2,000 borrowers under continuous monitoring',
          'All alerts above + per-borrower equity-event scoring',
          'Auto-staged outreach drafts when a refi window opens',
          'Daily real-time alerts on high-priority refi triggers'
        ]
      }
    ],
    engineCapabilities: [
      'distress_engine (refi-trigger signal weights)',
      'distress_watchlist (per-client surfacing)',
      'MD Land Records adapter (#423) for in-state deed events',
      'cascade_attribution (link triggers to borrowers)',
      'cockpit_approvals + body generator for borrower outreach',
      'weekly digest cron (#244)'
    ],
    pendingDependencies: [
      'CSV borrower-list import flow (mirrors Adriana portfolio upload)',
      'Rate-environment integration (Freddie Mac PMMS feed)'
    ],
    status: 'beta',
    moat: 'Most brokers lose retained customers to whichever lender markets first. We give the originator who closed the loan a 60-day head start on every refi opportunity in their own book.'
  },
  {
    slug: 'refi-trigger-cascade-alerts',
    name: 'Refi-Trigger Cascade Alerts',
    verticalPackId: 'mortgage_lending',
    customer: 'Mortgage brokers + refi specialists hunting net-new borrowers across a state or metro market.',
    oneLiner: 'When rates shift or a homeowner stacks debt, we surface every borrower in your territory entering a refi window — before they search.',
    marketingTagline: 'The competitor reads the rate news. You called the borrowers an hour ago.',
    pricing: [
      {
        label: '$499–1,499/mo',
        lowMonthlyCents: 49900,
        highMonthlyCents: 149900,
        includes: [
          'Real-time cascade alerts when refi-relevant signals fire in your territory',
          'Auto-surfaced borrower list from property transfer + lien + address events',
          'Pre-staged outreach drafts for each surfaced borrower',
          'Premium add-on to Portfolio Refi Monitoring'
        ]
      }
    ],
    engineCapabilities: [
      'cascade_pipeline (#374)',
      'MD Land Records adapter (#423) — day-one for MD originators',
      'HMDA refi-volume signal',
      'cockpit_approvals + body generator for outreach drafts'
    ],
    pendingDependencies: [
      'Multi-state recorder rollout (#427) for non-MD territories'
    ],
    status: 'beta',
    moat: 'No other broker tool ties Maryland recorder data to a daily cascade. Every other shop is buying Zillow leads after the borrower has already started shopping.'
  },
  {
    slug: 'borrower-closing-probability-scoring',
    name: 'Borrower Closing Probability Scoring',
    verticalPackId: 'mortgage_lending',
    customer: 'Mortgage originators with a queue of inbound leads who are wasting hours on borrowers who will not close.',
    oneLiner: 'Hand us your inbound leads. We score each by likelihood of closing — credit signals, prior denials by other lenders, property attachment, entity status — so you focus where ROI is highest.',
    marketingTagline: 'Stop wasting hours on dead leads. Know which borrowers will close before you make the first call.',
    pricing: [
      {
        label: '$0.40–1.50 per lead',
        lowMonthlyCents: 40,
        highMonthlyCents: 150,
        includes: [
          'Bulk upload of inbound lead list (CSV)',
          'Closing-probability score per lead (0–100)',
          'Underlying signals visible per lead',
          'Pay-as-you-go pricing — no minimum'
        ]
      },
      {
        label: '$599/mo unlimited',
        lowMonthlyCents: 59900,
        highMonthlyCents: 59900,
        includes: [
          'Unlimited scoring across all uploaded lead lists',
          'Monthly re-score automation as new signals fire',
          'Closing-probability dashboard per originator',
          'API access for in-house LOS integration'
        ]
      }
    ],
    engineCapabilities: [
      'distress_engine signal weights (lender_under_fire, high_denial_rate)',
      'cascade_attribution (prior denial trail)',
      'public_intel_records (property attachment visibility)',
      'KYC sweep (borrower entity / co-applicant status)'
    ],
    pendingDependencies: [
      'CSV inbound-lead import flow',
      'Probability calibration against MPG historical close-rate data'
    ],
    status: 'coming_soon'
  },
  {
    slug: 'mortgage-originator-white-label',
    name: 'White-Label Intelligence for Mortgage Originator Shops',
    verticalPackId: 'mortgage_lending',
    customer: 'Small to mid-sized mortgage shops (3–25 originators) who want their own intelligence portal under their brand.',
    oneLiner: 'Every borrower file opens with a full intelligence snapshot — current liens, property history, refi-trigger signals — instead of an LOA manually pulling records.',
    marketingTagline: "Your loan officer assistant's morning research, automated. Every file opens with the whole picture.",
    pricing: [
      {
        label: '$1,500–7,500/firm/mo',
        lowMonthlyCents: 150000,
        highMonthlyCents: 750000,
        includes: [
          'Branded broker portal (shop-name + logo on every screen)',
          'Per-borrower intelligence dossier (KYC + property history + lien activity)',
          'Cascade attribution surfaced in every dossier',
          'Unlimited borrower lookups under originator seat count',
          'Quarterly intelligence training for loan officer assistants'
        ]
      }
    ],
    engineCapabilities: [
      'KYC sweep (#524)',
      'DD Report generator (#525) — repurposed as borrower dossier',
      'client_dossier + red flags',
      'address history',
      'cascade_attribution',
      'brand-kit ingest for shop white-labeling (#208)'
    ],
    pendingDependencies: [
      'White-label dashboard skin per shop — extends existing data-skin="royale" pattern',
      'LOS integration (Encompass / LendingPad webhook receivers)'
    ],
    status: 'coming_soon',
    moat: 'Network effect — each shop using the product improves the underlying signals via their borrower data. High ACV, sticky, recurring revenue. Each shop replaces 1–2 LOA hours per file.'
  },
  {
    slug: 'md-lien-priority-mortgage-intelligence',
    name: 'MD Lien Priority Mortgage Intelligence',
    verticalPackId: 'mortgage_lending',
    customer: 'Maryland-licensed mortgage brokers and bridge / hard-money lenders with exposure to MD residential and commercial property.',
    oneLiner: "Maryland's lien priority decides whether a refi closes. We map the timeline county-by-county. You know who has claim and in what order before underwriting.",
    marketingTagline: 'In Maryland, lien priority decides the loan. We map the priority. You move first.',
    pricing: [
      {
        label: '$999/mo base + $35 per property deep-dive',
        lowMonthlyCents: 99900,
        highMonthlyCents: 99900,
        includes: [
          'Daily MD Land Records monitoring across portfolio (#423)',
          'Lien priority timeline per property — every MD jurisdiction',
          'Cross-county recorder cross-reference',
          'Mechanic + judgment lien alerts',
          'Per-property deep-dive on demand ($35 each)'
        ]
      }
    ],
    engineCapabilities: [
      'MD Land Records adapter (#423, shipped)',
      'recorder cross-reference (shipped for MD)',
      'cascade attribution',
      'KYC sweep'
    ],
    pendingDependencies: [
      'Lien priority timeline UI (mirrors CA priority panel)'
    ],
    status: 'beta',
    moat: 'No other mortgage intelligence provider has MD recorder fully wired. While competitors are still buying single-county data, we surface the full state on day one.'
  },

  // ── FAMILY LEGACY CARE VERTICAL PACK (Johnson family / Adriana CLDA) ──────
  // Five products mirror the collections + mortgage shape: shared command
  // center · legal decision drafts · financial housekeeping · senior care
  // coordination · veterans services tracker. The Johnson family is the
  // anchor case (Home-Ranch Trust dispute, 1657 Kingsly Dr Pittsburg CA).
  // Adriana / CLDA Services is the legal-delivery partner; Rebecca Johnson
  // is the primary family caregiver. Reusable for any family supporting
  // aging parents through trust/estate/elder-advocacy/guardianship needs.
  //
  // PRICING INTENTIONALLY EMPTY ARRAYS — val owns pricing per HARD RULE
  // feedback_no_invented_pricing. The label/cents structure is preserved
  // (existing interface unchanged) but no dollars are populated until val
  // sets them. See draft package at /AtlanticandVine/ATLANTIC AND VINE
  // management/Clients/Johnson Family/07_New_Hub_Products_Family_Legacy.md
  // for the proposed product set narrative.
  {
    slug: 'family-command-center',
    name: 'Family Command Center',
    verticalPackId: 'family_legacy_care',
    customer: 'A primary family caregiver (often the adult child closest to the parents) who needs a shared, parent-approved place to track legal, financial, and care decisions.',
    oneLiner: 'One shared place for every document, every decision, every appointment, every dollar — with the parents always in control.',
    marketingTagline: 'One place for everything that matters. Mom and Dad stay in control.',
    pricing: [],
    engineCapabilities: [
      'case-management module (schema 089)',
      'document vault with SHA-256 provenance',
      'case timeline (append-only event log)',
      'case parties (trustors / trustees / beneficiaries / heirs)',
      'wellness check log with concern flags',
      'sibling co-access with parent-approved invites',
      'mobile-friendly client surface'
    ],
    pendingDependencies: [
      'C2PA content credentials on case documents (planned)',
      'Mobile push for parent-approval flow (planned)'
    ],
    status: 'beta',
    moat: 'Parent-first design with parent-approved sibling invites is the legibility difference. Other tools default to "let the eldest child decide"; we default to "the parents stay in charge as long as they are competent."'
  },
  {
    slug: 'trust-estate-decision-drafts',
    name: 'Trust + Estate Decision Drafts',
    verticalPackId: 'family_legacy_care',
    customer: 'A family facing a trust amendment, revocation, or fiduciary issue who needs plain-English drafts the parents can read and the family attorney can refine.',
    oneLiner: 'Plain-English options for the parents. Attorney-refinable drafts for the family lawyer.',
    marketingTagline: 'Drafts that talk like a kitchen-table conversation, refined into instruments that hold up in court.',
    pricing: [],
    engineCapabilities: [
      'structured trust-clause library (revocation §5.A, amendment §5.B, residential §5.F patterns)',
      'parents\' decision sheet generator (plain English)',
      'POA revocation draft generator (financial + healthcare)',
      'trustee accounting demand letter generator (Probate §16060)',
      'attorney handoff packet'
    ],
    pendingDependencies: [
      'State-by-state trust statute coverage (CA + MD covered today)',
      'Probate court e-filing integration (later)'
    ],
    status: 'beta',
    moat: 'The drafts ground in the actual trust instrument (read by AV) plus AV\'s structured clause library, then hand off to the family\'s attorney for refinement. No other product reads the trust and prepares plain-English parent-friendly options in one pass.'
  },
  {
    slug: 'family-financial-housekeeping',
    name: 'Family Financial Housekeeping',
    verticalPackId: 'family_legacy_care',
    customer: 'A primary caregiver running periodic financial review meetings with siblings, who needs to track income, expenses, projected runway, and approval logs.',
    oneLiner: 'Monthly housekeeping meetings with the math, the agenda, the decisions, and Mom and Dad\'s approval all in one place.',
    marketingTagline: 'Monthly meetings that prevent arguments. Mom and Dad sign off on every major decision.',
    pricing: [],
    engineCapabilities: [
      'monthly financial summary with running balance',
      'projected runway calculation (months at current burn)',
      'meeting notes with attendee + decision log',
      'parent approval workflow on flagged decisions',
      'sibling visibility scoped by parent-set permissions'
    ],
    pendingDependencies: [
      'Bank-feed integration for auto-running totals (manual entry today)',
      'Spending threshold alerts (planned)'
    ],
    status: 'beta'
  },
  {
    slug: 'senior-care-coordination',
    name: 'Senior Care Coordination',
    verticalPackId: 'family_legacy_care',
    customer: 'Families coordinating medical care across multiple providers, including upcoming appointments, current medications, current doctors, current conditions, and known needs.',
    oneLiner: 'Every doctor, every appointment, every prescription, visible to the family members the parents choose.',
    marketingTagline: 'Every doctor, every appointment, every prescription — visible to the family members the parents choose.',
    pricing: [],
    engineCapabilities: [
      'health roster (providers, medications, conditions, allergies, insurance)',
      'care calendar with transport-responsible chips',
      'wellness check log',
      'HIPAA-conscious permission scoping per sibling',
      'parent-controlled access tiers'
    ],
    pendingDependencies: [
      'HL7 / FHIR integration for provider-side data exchange (planned)',
      'Pharmacy refill reminders (planned)'
    ],
    status: 'beta'
  },
  {
    slug: 'veterans-services-tracker',
    name: 'Veterans Services Tracker',
    verticalPackId: 'family_legacy_care',
    customer: 'Veteran families navigating VA benefits, applications in flight, current disability ratings, and case worker coordination.',
    oneLiner: 'Every VA benefit that\'s owed, every benefit that could be unlocked, every application in flight, in one tracked view.',
    marketingTagline: 'Every VA benefit that\'s owed, every benefit that could be unlocked, in one tracked view.',
    pricing: [],
    engineCapabilities: [
      'service-record summary',
      'disability rating tracker',
      'benefits-in-play monitor',
      'applications-in-flight tracker',
      'VA case worker contact card'
    ],
    pendingDependencies: [
      'VA-public-data adapter for benefit-eligibility prompts (Aid & Attendance, Survivor\'s Pension, etc.)',
      'Veteran-service-record verification automation (today: manual entry)'
    ],
    status: 'coming_soon'
  }
];

// ── HELPERS ─────────────────────────────────────────────────────────────────

/** Get a product by slug. Returns null if not found. */
export function getProductBySlug(slug: string): Product | null {
  return PRODUCTS.find((p) => p.slug === slug) ?? null;
}

/** All products for one vertical pack. Used by grouped landing pages. */
export function listProductsByVertical(verticalPackId: string): Product[] {
  return PRODUCTS.filter((p) => p.verticalPackId === verticalPackId);
}

/** All products, optionally filtered to a status. Used by the public index. */
export function listProducts(opts?: { status?: ProductStatus }): Product[] {
  if (!opts?.status) return PRODUCTS.slice();
  return PRODUCTS.filter((p) => p.status === opts.status);
}

/** Group products by vertical pack — convenience for the public index page. */
export function groupProductsByVertical(): Record<string, Product[]> {
  const m: Record<string, Product[]> = {};
  for (const p of PRODUCTS) {
    if (!m[p.verticalPackId]) m[p.verticalPackId] = [];
    m[p.verticalPackId].push(p);
  }
  return m;
}

/** Public display name for a vertical pack — for landing page titles. */
export const VERTICAL_DISPLAY_NAMES: Record<string, string> = {
  collections: 'Collections Intelligence',
  real_estate: 'Real Estate Intelligence',
  b2b_sales: 'B2B Sales Intelligence',
  law_firm: 'Law Firm Intelligence',
  // (val 2026-06-11) mortgage_lending is the canonical pack ID in
  // vertical_packs.ts. 'lending' is kept as a soft alias for the
  // pre-existing landing copy + URL slug.
  mortgage_lending: 'Mortgage Broker Intelligence',
  lending: 'Mortgage Broker Intelligence',
  political_campaign: 'Political Campaign Operations',
  defense_pr: 'Defense PR Operations',
  luxury_hospitality: 'Luxury Hospitality Operations',
  // (val 2026-06-11) Johnson family anchor — adult children supporting aging parents.
  family_legacy_care: 'Family Legacy Care'
};

/** Unifying tagline per vertical — used on grouped landing pages. */
export const VERTICAL_TAGLINES: Record<string, string> = {
  collections: 'Collections agencies do not need more leads. They need to know which collections will actually pay.',
  real_estate: 'The agent who knows about the listing before there is a listing.',
  b2b_sales: 'Which businesses are most likely to buy this quarter — before they ask.',
  law_firm: 'Every case opens with the whole picture. Your paralegals stop pulling records.',
  mortgage_lending: 'Know which borrowers are about to need you — before they search.',
  lending: 'Know which borrowers are about to need you — before they search.',
  political_campaign: 'Your district. Your message. Your green-light. One operator, full press desk.',
  defense_pr: 'Defense PR as a service. Counsel approves every release inside the dashboard.',
  luxury_hospitality: 'Each port a chapter. Each guest a story worth telling.',
  // (val 2026-06-11) Johnson family anchor — adult children supporting aging parents.
  family_legacy_care: 'One shared place for every document, every decision, every appointment, every dollar — with the parents always in control.'
};
