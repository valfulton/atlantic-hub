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
  lending: 'Lending + Mortgage Intelligence',
  political_campaign: 'Political Campaign Operations',
  defense_pr: 'Defense PR Operations',
  luxury_hospitality: 'Luxury Hospitality Operations'
};

/** Unifying tagline per vertical — used on grouped landing pages. */
export const VERTICAL_TAGLINES: Record<string, string> = {
  collections: 'Collections agencies do not need more leads. They need to know which collections will actually pay.',
  real_estate: 'The agent who knows about the listing before there is a listing.',
  b2b_sales: 'Which businesses are most likely to buy this quarter — before they ask.',
  law_firm: 'Every case opens with the whole picture. Your paralegals stop pulling records.',
  lending: 'Know which borrowers are about to need you — before they search.',
  political_campaign: 'Your district. Your message. Your green-light. One operator, full press desk.',
  defense_pr: 'Defense PR as a service. Counsel approves every release inside the dashboard.',
  luxury_hospitality: 'Each port a chapter. Each guest a story worth telling.'
};
