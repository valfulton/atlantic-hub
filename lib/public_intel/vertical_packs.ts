/**
 * lib/public_intel/vertical_packs.ts  (#376, val 2026-06-03)
 *
 * Vertical Packs — the architectural unlock that turns Atlantic Hub from
 * "SMB marketing tool" into "horizontal intelligence platform with vertical
 * pricing." A VerticalPack is a self-contained recipe for serving a whole
 * industry:
 *
 *   - signalWeights: the per-vertical tuning the Distress Engine needs
 *   - cascadeRecipeIds: which cascade chains should be active for this vertical
 *   - recommendedAdapters: which public-data sources to seed first
 *   - pitchTemplate: the "we know who needs you before they look" sentence
 *   - bestForRoles: ICPs within the vertical (e.g. "commercial credit reps")
 *   - pricingThesis: how to price this pack (the differentiation argument)
 *
 * Applying a pack to a client_id:
 *   1. Seeds the client's distress_signal_weights with the pack's weights
 *      (idempotent — INSERT IGNORE so manual overrides win on re-apply).
 *   2. Returns a structured "next steps" list val can hand the new client.
 *
 * Strategic framing (per advisor brief 2026-06-03):
 *   "Same data, different buyer." A new LLC filing means a new client to a
 *   collections agency, a lending prospect to a bank, a benefits prospect
 *   to a payroll provider. The cascade engine + signal weights are the
 *   per-vertical tuning. The platform is one product; the packs are eight.
 *
 * Adding a new vertical = add one entry to VERTICAL_PACKS. No new code, no
 * new schema. That's the leverage.
 */
import { seedDefaultsForClient, SIGNAL_LIBRARY, type SignalKind } from './distress_engine';
import { getAvDb } from '@/lib/db/av';
import type { PublicIntelKind } from './types';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { upsertSource } from './store';
import {
  sanitizePersonName,
  sanitizeCompanyName,
  addPersonName,
  addCompanyName
} from './name_sanitize';

export type VerticalPackId =
  | 'collections'              // CBB — collection agencies, legal referrals
  | 'real_estate'              // Val's RE business — distress-property hunting
  | 'b2b_sales'                // ADP / Paychex / payroll / merchant services
  | 'commercial_insurance'     // Commercial insurance brokers
  | 'commercial_lending'       // Banks, SBA lenders, equipment finance
  | 'commercial_solar'         // Chip Zenke / Circa Energy — commercial solar developers, EPCs, energy consultants
  | 'law_firm'                 // Practice-specific (employment, corporate, collections, bankruptcy)
  | 'recruiting'               // Staffing + executive search
  | 'marketing_agency'         // AV's own home turf — agencies selling marketing services
  | 'luxury_hospitality'       // Yacht / marina / luxury hotel / high-end events (val's wheelhouse)
  // (#530, val 2026-06-08) DD Report product line — investors / lenders / M&A
  // advisors / franchise vetters who pay 5-10x marketing prices for a
  // pre-engagement intelligence report on a person + their company.
  | 'client_screening'         // Pre-engagement DD — KYC-style screening for investors, lenders, advisors
  // (val 2026-06-11) Marty Insley / mpgloans.com — Maryland mortgage broker.
  // Residential + commercial mortgage origination. Distinct from commercial_lending
  // (banks + SBA) because mortgage brokers buy refi-trigger + relocation signals,
  // not credit-risk + workout signals. MD recorder adapter (#423) shipped, so MD
  // lien priority lights up day-one without waiting on CA Acclaim.
  | 'mortgage_lending'         // Mortgage brokers + originators — residential refi + purchase
  // (val 2026-06-11) Johnson family — adult children supporting aging parents
  // through legal, financial, and care decisions. Composes with case-management
  // module (schema/089) for trust/estate work + family wellness wrapper for
  // health roster, VA benefits, financial housekeeping meetings, and sibling
  // co-access scoped by parent approval. Anchor: 1657 Kingsly Dr, Pittsburg CA.
  | 'family_legacy_care';      // Adult children + aging parents — trust, estate, care, family

/**
 * (#384) Target audience: drives the score-time filter that prevents
 * corporate-only signals (e.g. corporate bankruptcies, UCC counterparties)
 * from polluting consumer-facing packs (legal aid, RE-distress, etc.), and
 * vice versa. 'both' = no filtering. Used by the distress engine when
 * deciding whether to surface an entity for this client.
 */
export type TargetAudience = 'consumer' | 'corporate' | 'both';

export interface VerticalPack {
  id: VerticalPackId;
  displayName: string;
  /** One-sentence positioning. */
  shortPositioning: string;
  /** (#384) Who does this pack serve? Drives consumer/corporate routing. */
  targetAudience: TargetAudience;
  /** Per-vertical signal weight tuning. Missing kinds keep library defaults. */
  signalWeights: Partial<Record<SignalKind, number>>;
  /** Cascade recipes that should be prioritized for this vertical. */
  cascadeRecipeIds: string[];
  /** Adapters val should enable first for this vertical. */
  recommendedAdapters: PublicIntelKind[];
  /** "Best for" — ICPs within the vertical. */
  bestForRoles: string[];
  /** The pitch template — verbatim sentence for cold outreach + decks. */
  pitchTemplate: string;
  /** Pricing thesis — why this pack supports premium pricing. */
  pricingThesis: string;
  /** Suggested monthly price band per seat (USD). For internal sales reference. */
  suggestedPriceUsd: { low: number; high: number };
}

export const VERTICAL_PACKS: Record<VerticalPackId, VerticalPack> = {
  collections: {
    id: 'collections',
    displayName: 'Collections agencies + legal referrals',
    shortPositioning: 'Predictive intelligence on businesses about to need collections support.',
    targetAudience: 'corporate',
    signalWeights: {
      new_llc: 10,
      ucc_filing: 20,
      negative_review_trend: 15,
      lawsuit_filed: 30,
      bankruptcy_filed: 50,
      credit_risk_increase: 40,
      leadership_change: 15,
      suspended_entity: 30,
      dissolved_entity: 25
    },
    cascadeRecipeIds: [
      'courtlistener_defendant_distress',
      'new_llc_credit_opportunity',
      'suspended_entity_vendor_exposure',
      'bankruptcy_creditor_extraction'
    ],
    recommendedAdapters: ['ca_sos', 'courtlistener', 'ucc_ca', 'pacer_docket'],
    bestForRoles: ['Commercial collections agencies', 'Legal referral networks', 'Credit recovery firms'],
    pitchTemplate:
      'Protect your cash flow before your first delinquent account. We identify businesses about to have a collections problem before they know they need help — using federal court filings, state suspensions, and UCC activity. You see the names this week; you call before anyone else has the chance.',
    pricingThesis:
      'A $99/mo lead list is replaceable. A $499/mo Revenue Distress Monitoring stream with signal-attribution receipts is not — because the customer can audit which signals fired on which entity. Reps close more because every call opens with "I noticed X just happened."',
    suggestedPriceUsd: { low: 499, high: 1499 }
  },

  real_estate: {
    id: 'real_estate',
    displayName: 'Real estate investors + agents (distress hunting)',
    shortPositioning: 'The agent who knows about the listing before there is a listing.',
    targetAudience: 'consumer',
    signalWeights: {
      suspended_entity: 20,
      lawsuit_filed: 25,
      leadership_change: 10,
      address_change: 15,
      // (#388) DataSF adapter now live — code violations are a leading
      // motivated-seller signal for SF properties.
      code_violation: 35,
      // RE-specific signals expand when CA recorder adapter ships.
      // Placeholder weights here cover the cross-cutting signals.
      new_llc: 5
    },
    cascadeRecipeIds: [
      // Cascades that activate when CA recorder + tax-collector adapters ship:
      'probate_filing_heir_outreach',
      'nod_to_auction_window',
      'divorce_to_forced_sale',
      'code_violation_motivated_seller',
      'tax_lien_absentee_cashout'
    ],
    recommendedAdapters: ['ca_sos', 'courtlistener', 'ca_recorder', 'census_acs', 'datasf'],
    bestForRoles: ['Real estate investors (probate / NOD / divorce specialists)', 'Cash-buyer agents', 'Wholesale RE'],
    pitchTemplate:
      'I do not compete on commission. I compete on time-to-the-property. Probate, divorce, default, vacancy — by the time the heirs are figuring out who to call, the cascade engine has surfaced the property and pre-drafted my outreach.',
    pricingThesis:
      'Replaces $500-2000/mo absentee-owner lead lists (PropStream, REIPro, BatchLeads) with a transparent receipt for why each property surfaced. RE investors already spend on lead lists; this is a category swap, not a new spend.',
    suggestedPriceUsd: { low: 499, high: 1999 }
  },

  b2b_sales: {
    id: 'b2b_sales',
    displayName: 'B2B sales teams (payroll / merchant / software)',
    shortPositioning: 'We know which businesses are most likely to buy this quarter — before they ask.',
    targetAudience: 'corporate',
    signalWeights: {
      new_llc: 30,
      leadership_change: 20,
      address_change: 25,
      rapid_growth: 25
    },
    cascadeRecipeIds: [
      'new_llc_credit_opportunity',
      // Future cascades for "new location" and "hiring surge" once adapters ship.
    ],
    recommendedAdapters: ['ca_sos', 'ca_sos_v2'],
    bestForRoles: ['ADP / Paychex regional reps', 'Merchant services account execs', 'B2B SaaS field sales'],
    pitchTemplate:
      'Your reps stop hunting. We surface the businesses that just registered, just opened a new location, or just had a leadership change in your territory — the moments when they are most likely to buy. You arrive with a specific reason to call, not a cold pitch.',
    pricingThesis:
      'B2B sales orgs already spend $200-800/seat/month on ZoomInfo, Apollo, Cognism. We replace the "find me anyone" approach with "find me the ones changing right now" — higher conversion, same spend.',
    suggestedPriceUsd: { low: 299, high: 999 }
  },

  commercial_insurance: {
    id: 'commercial_insurance',
    displayName: 'Commercial insurance brokers',
    shortPositioning: 'Daily alerts on businesses with new insurable exposure.',
    targetAudience: 'corporate',
    signalWeights: {
      new_llc: 30,
      rapid_growth: 25,
      address_change: 20,
      leadership_change: 15
    },
    cascadeRecipeIds: ['new_llc_credit_opportunity'],
    recommendedAdapters: ['ca_sos', 'ca_sos_v2', 'census_acs'],
    bestForRoles: ['Commercial P&C producers', 'Workers comp brokers', 'EPLI / D&O specialists'],
    pitchTemplate:
      '"42 businesses opened locations in your territory this week. 17 hired over 50 employees." Producers stop chasing renewals and start showing up the day the insurable event happens. The benefits broker who calls the day after a 50-person hiring round is the broker who gets the book.',
    pricingThesis:
      'A commission on one mid-market book pays the annual subscription. Insurance brokers already lose to whoever shows up first — we make them first.',
    suggestedPriceUsd: { low: 499, high: 1499 }
  },

  commercial_lending: {
    id: 'commercial_lending',
    displayName: 'Banks + SBA lenders + equipment finance',
    shortPositioning: 'Growth AND distress signals — borrowers AND defaults — in one feed.',
    targetAudience: 'both',
    signalWeights: {
      new_llc: 20,
      ucc_filing: 35,
      rapid_growth: 25,
      credit_risk_increase: 40,
      lawsuit_filed: 25,
      bankruptcy_filed: 50,
      suspended_entity: 30
    },
    cascadeRecipeIds: [
      'new_llc_credit_opportunity',
      'courtlistener_defendant_distress',
      'bankruptcy_creditor_extraction'
    ],
    recommendedAdapters: ['ca_sos', 'courtlistener', 'ucc_ca', 'hmda', 'cfpb'],
    bestForRoles: ['SBA loan officers', 'Equipment finance', 'Commercial bankers', 'Workout / special assets'],
    pitchTemplate:
      'One feed, two sides of your portfolio. New formations + expansion signals point to your next book of business. Distress signals point to the loans you need to action this week. Your relationship managers and your workout team work from the same intelligence layer.',
    pricingThesis:
      'Lenders pay $50-200K/year for FIS / Moody\'s commercial intelligence. We deliver per-market regional intelligence at 1/10 the cost with cascade attribution they can show their credit committee.',
    suggestedPriceUsd: { low: 999, high: 4999 }
  },

  commercial_solar: {
    id: 'commercial_solar',
    displayName: 'Commercial solar + renewable energy services',
    shortPositioning: 'We surface commercial properties at the exact moment an energy decision is on the table.',
    targetAudience: 'corporate',
    signalWeights: {
      // Property changed hands or took on new debt — new owner's 90-day
      // opex review is the sweet-spot window for solar pitch.
      property_transfer: 40,
      // New commercial LLC = new lease / location / utility contract being set up.
      new_llc: 30,
      // Expanding business = larger kWh load = bigger solar ROI conversation.
      rapid_growth: 35,
      // Relocation = utility contract reset.
      address_change: 30,
      // New CFO / Director of Facilities re-evaluates opex line items first 90 days.
      leadership_change: 25,
      // Building permit / code violation = forced retrofit window (HVAC + electrical
      // often pair with solar upgrades). DataSF for SF; future county adapters
      // will expand coverage.
      code_violation: 20,
      // Already deploying capex = open to solar capex.
      ucc_filing: 15
    },
    cascadeRecipeIds: [
      // Maps to existing recipes that fit solar's "moment of energy decision" framing.
      // Future solar-specific recipes (building-permit → solar pitch, PJM
      // interconnection → competitor visibility) activate when those adapters ship.
      'new_llc_credit_opportunity',
      'suspended_entity_vendor_exposure'
    ],
    recommendedAdapters: [
      'ca_sos',         // CA businesses — useful for CA solar pros
      'md_land_rec',    // MD statewide property transfers — the primary signal for Chip
      'datasf',         // SF code violations = retrofit window
      'census_acs',     // Tract-level commercial density
      'gbp',            // Find businesses by category
      'courtlistener'   // Federal cases involving commercial real estate / energy
    ],
    bestForRoles: [
      'Commercial solar developers + EPCs',
      'Energy management consultants',
      'PPA / solar tax-equity arrangers',
      'Renewable energy account execs',
      'Building decarbonization consultants',
      'Commercial HVAC/electrical retrofit firms'
    ],
    pitchTemplate:
      'Stop chasing every business with a roof. Surface the commercial properties making energy decisions RIGHT NOW — new ownership, expansion signals, leadership changes, building permits — with the specific reason to call. Your reps open with "I noticed you just moved into a 40K sqft facility — what is your kWh spend looking like?" not a cold pitch.',
    pricingThesis:
      'Commercial solar reps drown in cold prospecting (100 calls to 1 meeting industry avg). Per-signal intelligence with a documented opex-review window cuts sales cycle 4-6 months. One mid-market PPA closes pays the year.',
    suggestedPriceUsd: { low: 799, high: 2999 }
  },

  law_firm: {
    id: 'law_firm',
    displayName: 'Law firms (practice-specific intelligence)',
    shortPositioning: 'Practice-specific alerts that match what each partner actually does.',
    targetAudience: 'both',
    signalWeights: {
      // Per-practice would be a sub-pack. Defaults below cover collections law +
      // corporate law as the most common book.
      lawsuit_filed: 30,
      bankruptcy_filed: 45,
      leadership_change: 25,
      suspended_entity: 25,
      dissolved_entity: 20,
      new_llc: 15
    },
    cascadeRecipeIds: [
      'courtlistener_defendant_distress',
      'bankruptcy_creditor_extraction',
      'new_llc_credit_opportunity',
      'suspended_entity_vendor_exposure'
    ],
    recommendedAdapters: ['courtlistener', 'ca_sos', 'pacer_docket', 'ucc_ca'],
    bestForRoles: [
      'Collections law firms',
      'Bankruptcy practitioners',
      'Corporate / M&A partners',
      'Employment law (with hiring-surge adapter)'
    ],
    pitchTemplate:
      'Your partners stop relying on referrals. Daily alerts match their practice: collections sees the new judgments + UCC activity; bankruptcy sees the new Chapter 11 + creditor lists; corporate sees the new formations + agent changes. Each practice gets a different feed; one engine runs them all.',
    pricingThesis:
      'Law firms already pay $1-5K/seat/month for Lex Machina, Bloomberg Law, Westlaw. We are not replacing legal research — we are giving them the prospects to research. New category, additive spend.',
    suggestedPriceUsd: { low: 799, high: 2999 }
  },

  recruiting: {
    id: 'recruiting',
    displayName: 'Staffing + executive recruiting',
    shortPositioning: 'Companies likely to hire in the next 90 days — surfaced before the JD is posted.',
    targetAudience: 'corporate',
    signalWeights: {
      new_llc: 25,
      rapid_growth: 35,
      address_change: 15,
      leadership_change: 25
    },
    cascadeRecipeIds: ['new_llc_credit_opportunity'],
    recommendedAdapters: ['ca_sos', 'ca_sos_v2'],
    bestForRoles: ['Staffing agencies', 'Executive recruiters', 'Industry-specific recruiting firms'],
    pitchTemplate:
      'Stop waiting for the JD. Companies hiring next quarter are visible NOW in the signals — funding events, leadership changes, expansion filings. The recruiter who calls the new VP of Sales the day they start placing the team — wins the placements.',
    pricingThesis:
      'Recruiters already pay LinkedIn Recruiter $10-15K/year per seat. We surface intent BEFORE the LinkedIn job-post phase, when no other recruiter has the lead yet.',
    suggestedPriceUsd: { low: 399, high: 1299 }
  },

  marketing_agency: {
    id: 'marketing_agency',
    displayName: 'Marketing agencies (the AV home turf)',
    shortPositioning: 'We know who needs marketing before they start looking.',
    targetAudience: 'corporate',
    signalWeights: {
      new_llc: 25,
      address_change: 20,
      rapid_growth: 25,
      leadership_change: 15,
      negative_review_trend: 30
    },
    cascadeRecipeIds: ['new_llc_credit_opportunity', 'review_drop_operational_stress'],
    recommendedAdapters: ['ca_sos', 'ca_sos_v2', 'gbp'],
    bestForRoles: ['Full-service agencies', 'Branding consultancies', 'Performance marketing shops'],
    pitchTemplate:
      'Stop selling marketing services. Sell knowing-who-needs-marketing-first. New CMO arrived this month? Rebrand signal. Review velocity dropped? Reputation work. Three new locations opened? Local + paid + brand. Agencies that arrive on day one of the need win the engagement.',
    pricingThesis:
      'Agencies already invest in BD time. We compress the BD cycle by handing them pre-qualified opportunities with cascade-attributed reasons-to-call. The pricing argument is "one engagement closed pays the year."',
    suggestedPriceUsd: { low: 299, high: 1499 }
  },

  luxury_hospitality: {
    id: 'luxury_hospitality',
    displayName: 'Luxury hospitality intelligence (yacht / marina / hotel / event)',
    shortPositioning: 'Specialized intelligence for a smaller, wealthier, relationship-driven market.',
    targetAudience: 'both',
    signalWeights: {
      new_llc: 20,
      leadership_change: 25,
      address_change: 30,
      rapid_growth: 30
    },
    cascadeRecipeIds: [
      'new_llc_credit_opportunity'
      // Future: yacht_documentation_change, marina_permit_filed, luxury_hotel_opening
    ],
    recommendedAdapters: ['ca_sos', 'ca_sos_v2', 'census_acs'],
    bestForRoles: [
      'Luxury brand activation agencies',
      'Yacht brokers',
      'High-end concierge companies',
      'Marina + yacht-management operators',
      'Hospitality consultants',
      'Luxury PR firms'
    ],
    pitchTemplate:
      'The luxury market does not respond to broad lead lists. It responds to "we knew before anyone else." New marina expansion in the area, new yacht registered to a local LLC, new luxury hotel ownership change — these are the moments when a $50K activation contract becomes possible. Generic lead-gen tools cannot see these signals; we built the engine that does.',
    pricingThesis:
      'Smaller market, wealthier customers, higher per-deal value. Luxury market generic tools are weakest here precisely because the data is fragmented across yacht registries, marina permits, hotel filings. Specialization commands premium pricing. This is the niche the advisor flagged as the best fit for AV given Events by Water + nautical brand position.',
    suggestedPriceUsd: { low: 999, high: 4999 }
  },

  // (#530, val 2026-06-08) Pre-Engagement Intelligence Report — the DD product
  // line val identified while screening Mark Francis. Same engine, different
  // audience: investors / lenders / M&A / franchise vetters who pay 5-10x
  // marketing prices for a polished pre-engagement report on a person + their
  // company. Output is the DD Report markdown (#525). This pack tunes weights
  // and recipes so the watchlist surfaces the SIGNALS THAT MATTER for that
  // audience (dissolution, bankruptcy, lawsuits, IP gaps) rather than the
  // marketing-prospect signals other packs prioritize.
  client_screening: {
    id: 'client_screening',
    displayName: 'Pre-engagement DD (investors, lenders, advisors)',
    shortPositioning: 'The polished intelligence report that lets you walk away — or in — with confidence.',
    targetAudience: 'both',
    signalWeights: {
      // KYC weights — what investors actually care about, ranked.
      dissolved_entity: 50,    // corporate dissolution = top-line "do not invest" signal
      suspended_entity: 40,
      bankruptcy_filed: 60,
      lawsuit_filed: 35,
      credit_risk_increase: 30,
      negative_review_trend: 15,
      leadership_change: 20,   // mid-deal leadership turnover is a yellow flag
      new_llc: 5               // a brand-new entity isn't risk; it's just data
    },
    cascadeRecipeIds: [
      // Re-uses existing cascade recipes that produce DD-relevant signal.
      // The DD Report endpoint (#525) consumes the resulting watchlist rows.
      'courtlistener_defendant_distress',
      'bankruptcy_creditor_extraction',
      'suspended_entity_vendor_exposure'
    ],
    recommendedAdapters: [
      'courtlistener',   // litigation + bankruptcy by name
      'cfpb',            // consumer-finance complaints by company
      'census_acs',      // address-area context
      'hmda',            // mortgage-market context by address
      'ca_sos'           // entity status (CA today; multi-state via #422 Puppeteer)
    ],
    bestForRoles: [
      'Angel investors (the Mike Bannister case)',
      'Family offices + small VCs without dedicated DD teams',
      'M&A advisors + business brokers',
      'Banks / SBA lenders doing pre-loan diligence',
      'Franchise vetting agencies',
      'Board nomination + executive screening'
    ],
    pitchTemplate:
      'Before you write the check — or sign the partnership — you deserve to know what the public record says. A Pre-Engagement Intelligence Report aggregates federal court filings, state corporate registries, consumer complaints, IP defensibility, and address-history signals into one confidential dossier. Same depth a top-tier investor would commission, delivered in 48 hours instead of three weeks.',
    pricingThesis:
      'Different audience, different price point. A marketing engagement is $300-$2K/mo; a single pre-engagement DD report is $1,995-$7,995 because the buyer is making a $50K-$5M decision. The same engine produces both — investors pay for the polished deliverable + the speed. Bundleable as add-on to marketing engagements ("DD-as-a-service for any client you refer in").',
    suggestedPriceUsd: { low: 1995, high: 7995 }
  },

  // (val 2026-06-11) Marty Insley / mpgloans.com — Maryland mortgage broker.
  // Residential + commercial originator. Distinct from commercial_lending
  // (banks + SBA + equipment finance) because mortgage brokers buy
  // refi-trigger + relocation + market-gap signals, not credit-risk +
  // workout signals. The MD recorder adapter (#423) is the day-one moat:
  // every Maryland mortgage filing flows into the watchlist on day one,
  // letting Marty see purchase + refi windows opening across the state
  // before any other broker is on the lead.
  mortgage_lending: {
    id: 'mortgage_lending',
    displayName: 'Mortgage brokers + originators',
    shortPositioning: 'Know which borrowers are about to need you — before they search.',
    targetAudience: 'both',
    signalWeights: {
      // Strongest mortgage signal: a property just changed hands → refi
      // window opens at 6–18 months, and the originator who's been in
      // touch from day one wins the refi business.
      property_transfer: 35,
      // Someone moved → either they just bought (refi pipeline) or they
      // rented and will buy in 12–36 months (purchase pipeline).
      address_change: 30,
      // HMDA market intelligence: high refi volume in an area = rate
      // environment is moving + competitors are originating; Marty needs
      // to be on every borrower in that zip BEFORE they call Rocket.
      high_refinance_volume: 30,
      // HMDA denial intelligence: where banks reject borrowers is where
      // brokers win — broker shops place loans banks won't touch.
      high_denial_rate: 25,
      // CFPB: a lender under fire = competitor weakness = poach window
      // for borrowers stuck with that lender.
      lender_under_fire: 20,
      // New LLC near a transferred property = investor entity buying
      // rentals → commercial mortgage opportunity (BRRRR, DSCR loans).
      new_llc: 10,
      // Distressed property = listing opportunity for the buyer's agent
      // and bridge/hard-money origination opportunity for Marty.
      code_violation: 5
    },
    cascadeRecipeIds: [
      // Investor LLC formation near a recent property transfer = high
      // intent commercial mortgage shopper. Recipe already exists.
      'new_llc_credit_opportunity'
      // Future recipes (tracked in #423 follow-up):
      //   property_transfer_refi_window      — fires 9 months post-deed
      //   high_denial_zip_broker_opportunity — fires on HMDA quarterly load
    ],
    recommendedAdapters: [
      'md_land_rec',  // (#423) day-one moat for MD originators
      'hmda',         // refi volume + denial rate by zip
      'cfpb',         // competitor lender complaint velocity
      'census_acs',   // homeowner / area demographics
      'courtlistener',// foreclosure / lis-pendens signals
      'ca_sos'        // investor-entity catch for the commercial side
    ],
    bestForRoles: [
      'Independent mortgage brokers (MD, VA, DC corridor first)',
      'Mortgage loan originators (MLOs)',
      'Refi specialists',
      'Commercial mortgage brokers (DSCR / BRRRR / bridge)',
      'Small mortgage shops white-labeling intelligence'
    ],
    pitchTemplate:
      'Maryland mortgage brokers compete on two minutes of timing. The borrower who just signed a deed enters a refi window in 9 months — call them at month 7 and you own the relationship. The renter who just moved across town enters a purchase cycle in 18-36 months — be the broker they know. We turn every Maryland property transfer, every refi-heavy zip, every denied-borrower opportunity into a watchlist row, the day the public record updates.',
    pricingThesis:
      'Mortgage originators already spend $200-1,500/mo on lead-gen (Zillow Premier Agent, LendingTree, BoldLeads). We replace cold lead lists with timing intelligence on borrowers already in their geographic territory — same spend, far higher close rate. MD recorder gives us the rare day-one moat: no other broker tool surfaces MD deed transfers in near-real-time.',
    suggestedPriceUsd: { low: 499, high: 1999 }
  },

  // (val 2026-06-11) Johnson family — Gordon + Maria Angelina, Rebecca caregiver.
  // The pack composes with the case-management module (schema/089) and the
  // family wellness wrapper to give adult children supporting aging parents
  // through legal/financial/care decisions a shared, parent-first command
  // center. Distinct from client_screening (which is DD ON a person) because
  // family_legacy_care is FOR the family — multi-party access, parent approval
  // gates, health/financial/sibling visibility. Anchor case: Johnson family
  // Home-Ranch Trust dispute, 1657 Kingsly Dr Pittsburg CA. Reusable for any
  // family in trust/estate/elder-advocacy/guardianship/general-litigation
  // situations with parent-control + multi-party-visibility needs.
  //
  // Pricing: left intentionally blank per HARD RULE feedback_no_invented_pricing.
  // val owns pricing; this pack does not invent dollars.
  family_legacy_care: {
    id: 'family_legacy_care',
    displayName: 'Family Legacy Care (aging parents + family co-visibility)',
    shortPositioning: 'A shared, parent-first command center for families supporting aging parents through legal, financial, and care decisions.',
    targetAudience: 'consumer',
    signalWeights: {
      // Parent residence is the centerpiece — any deed activity is critical.
      // The recorder adapters classify all deed types (NOD, NTS, Trustee Deed,
      // Grant Deed, etc.) under property_transfer until a lien-specific signal
      // is added in Phase 3.
      property_transfer: 50,
      // A parent moving mid-case is a major flag (per the Johnson scenario).
      address_change: 25,
      // Lawsuit filings — probate disputes, trust contests, elder-abuse cases.
      lawsuit_filed: 15,
      // Local distress patterns help anticipate care/transport needs.
      code_violation: 5,
      // Investor entities forming near a parent residence (potential heir
      // setting up a flip vehicle) are worth surfacing.
      new_llc: 5
    },
    cascadeRecipeIds: [
      // Reuses existing recipes. A follow-on recipe (parent_residence_deed_alert)
      // is queued for the next pass but not blocking — the wellness module
      // surfaces the same deed events directly via the case_property + recorder.
      'new_llc_credit_opportunity'
    ],
    recommendedAdapters: [
      'ca_contra_costa_recorder', // Johnson anchor (built in same bundle)
      'md_land_rec',              // MD families
      'courtlistener',            // probate / litigation tracking
      'census_acs'                // area demographic context
    ],
    bestForRoles: [
      'Adult children supporting aging parents',
      'Family caregivers coordinating multi-sibling care',
      'Families navigating trust or estate disputes',
      'Veterans\' families coordinating VA benefits + care'
    ],
    pitchTemplate:
      'When a family is supporting aging parents through legal or financial transitions, the hardest part is keeping everyone on the same page without drama. We give the parents, their primary caregiver, the family\'s attorney, and any siblings the parents choose to include a shared, real-time view of every document, every decision, every healthcare appointment, and every dollar — with the parents always in control.',
    pricingThesis:
      'val to own — see /AtlanticandVine/ATLANTIC AND VINE management/Clients/Johnson Family/07_New_Hub_Products_Family_Legacy.md for product set proposal. Pricing not invented per HARD RULE.',
    suggestedPriceUsd: { low: 0, high: 0 }
  }
};

export function listPacks(): VerticalPack[] {
  return Object.values(VERTICAL_PACKS);
}

export function getPack(id: VerticalPackId): VerticalPack | null {
  return VERTICAL_PACKS[id] ?? null;
}

/**
 * Apply a vertical pack to a client: seeds the distress signal weights from
 * the pack. Idempotent — uses INSERT IGNORE so manual weight overrides win.
 * Returns the count of new weights inserted + a "next steps" list val can
 * hand the new client.
 */
export interface ApplyPackResult {
  ok: boolean;
  packId: VerticalPackId;
  weightsSeeded: number;
  recommendedAdapters: PublicIntelKind[];
  cascadeRecipesActivated: string[];
  nextSteps: string[];
}

/**
 * (#533) Read the client's brief and derive name+state for the screening
 * panels. Returns null if there's no brief or no usable identity.
 *
 * Format: courtlistener takes person+company names; cfpb takes the company
 * name only (consumer-finance complaints are filed against companies).
 */
async function deriveClientScreeningConfigs(clientId: number): Promise<{
  courtlistener: Record<string, unknown>;
  cfpb: Record<string, unknown> | null;
} | null> {
  try {
    const db = getAvDb();
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT brief_payload FROM creative_briefs
        WHERE tenant_id = 'av' AND client_id = ? LIMIT 1`,
      [clientId]
    );
    const raw = rows[0]?.brief_payload as string | Record<string, unknown> | null;
    if (!raw) return null;
    const brief = (typeof raw === 'string' ? JSON.parse(raw) : raw) as Record<string, unknown>;

    const contact = typeof brief.contact_name === 'string' ? brief.contact_name.trim() : '';
    const companyRaw = typeof brief.company === 'string' ? brief.company.trim() : '';
    // (#537) owner_name is the LEGAL OWNER (Adriana, Mark Francis). Separate
    // from contact_name which may be a marketing POC. KYC screens owner first.
    const owner = typeof brief.owner_name === 'string' ? brief.owner_name.trim() : '';
    // (val 2026-06-10) Political-campaign: candidate_name + sitting_incumbent
    // + opponents[] feed additional KYC sweeps so the operator sees the
    // competitive landscape — not just the candidate's own record.
    const candidate = typeof brief.candidate_name === 'string' ? brief.candidate_name.trim() : '';
    const sittingIncumbent = typeof brief.sitting_incumbent === 'string' ? brief.sitting_incumbent.trim() : '';
    const opponentsRaw = typeof brief.opponents === 'string' ? brief.opponents.trim() : '';
    if (!contact && !companyRaw && !owner && !candidate) return null;

    // (val 2026-06-10) Name sanitizers live in lib/public_intel/name_sanitize.ts
    // so both this pack-apply path AND the run-kyc-sweep endpoint route through
    // identical logic — no copy-paste, no drift.
    // Parse opponents block (intake stores one per line). Each line is
    //   "Name · party · description" — keep just the name (up to first delimiter).
    const opponentNames: string[] = opponentsRaw
      .split(/[\r\n]+/)
      .map((line) => line.trim().split(/\s*[·\|—\-]\s*/)[0]?.trim() ?? '')
      .filter((n) => n.length > 1);
    const company = sanitizeCompanyName(companyRaw);

    // State hint — same order as KYC sweep deriveStateHint.
    const stateCandidates: Array<unknown> = [
      brief.business_state, brief.address_state, brief.state, brief.state_code, brief.billing_state
    ];
    let state: string | null = null;
    for (const c of stateCandidates) {
      if (typeof c === 'string') {
        const t = c.trim().toUpperCase();
        if (/^[A-Z]{2}$/.test(t)) { state = t; break; }
      }
    }
    if (!state) {
      // Try to parse a "..., GA, 30040" form out of a free-text address field.
      const addrCands: Array<unknown> = [brief.business_address, brief.address];
      for (const c of addrCands) {
        if (typeof c === 'string') {
          const m = c.match(/,\s*([A-Z]{2})\s*,?\s*\d{5}/);
          if (m) { state = m[1]; break; }
        }
      }
    }

    // (#537 + val 2026-06-10) Names go through sanitizers: candidate first
    // when present (political_campaign target), then owner (KYC target), then
    // contact (marketing POC), then company, then sitting incumbent + each
    // opponent. Last-name fallback added per person name. Dedup case-
    // insensitively.
    const seenLc = new Set<string>();
    const names: string[] = [];
    if (candidate) addPersonName(names, seenLc, candidate);
    if (owner)     addPersonName(names, seenLc, owner);
    if (contact)   addPersonName(names, seenLc, contact);
    if (company)   addCompanyName(names, seenLc, company);
    if (sittingIncumbent) addPersonName(names, seenLc, sittingIncumbent);
    for (const op of opponentNames) addPersonName(names, seenLc, op);

    const courtlistener: Record<string, unknown> = {
      name: names,
      sinceDays: 0
    };
    if (state) courtlistener.states = [state];

    // CFPB: company-only, since complaints are filed against companies.
    const cfpb: Record<string, unknown> | null = company
      ? { name: [company], sinceDays: 0, ...(state ? { states: [state] } : {}) }
      : null;

    return { courtlistener, cfpb };
  } catch {
    return null;
  }
}

export async function applyVerticalPackToClient(clientId: number, packId: VerticalPackId): Promise<ApplyPackResult> {
  const pack = getPack(packId);
  if (!pack) {
    return {
      ok: false,
      packId,
      weightsSeeded: 0,
      recommendedAdapters: [],
      cascadeRecipesActivated: [],
      nextSteps: [`Unknown pack id: ${packId}`]
    };
  }
  const seeded = await seedDefaultsForClient(clientId, pack.signalWeights);
  // (val 2026-06-07) Pack is now an INCLUDE list, not a positive-only seed.
  // Insert enabled=0 rows for every signal NOT in the pack — that way
  // library defaults can't leak (e.g. corporate-targeted CBB no longer
  // fires CFPB consumer signals: lender_under_fire, complaint_velocity_high).
  // Idempotent: existing rows are unchanged (INSERT IGNORE), so a manual
  // operator override of a non-pack signal still wins on the next re-apply.
  let disabled = 0;
  try {
    const db = getAvDb();
    for (const kind of Object.keys(SIGNAL_LIBRARY) as SignalKind[]) {
      if (pack.signalWeights[kind] != null) continue; // pack uses this signal — leave it
      const [res] = await db.execute<ResultSetHeader>(
        `INSERT IGNORE INTO distress_signal_weights (client_id, signal_kind, weight, enabled, description)
         VALUES (?, ?, 0, 0, ?)`,
        [clientId, kind, `Disabled by ${pack.id} pack — not in pack's signalWeights`]
      );
      if (res.affectedRows > 0) disabled++;
    }
  } catch { /* non-fatal — disables can be applied later via pack re-apply */ }
  // (#533, val 2026-06-08) Auto-populate CourtListener + CFPB panel configs
  // when client_screening pack is applied. Derives name list (contact + company)
  // and state hint from the brief so val doesn't have to retype JSON per client.
  const autoConfigured: string[] = [];
  if (packId === 'client_screening') {
    try {
      const cfg = await deriveClientScreeningConfigs(clientId);
      if (cfg) {
        // CourtListener — person + company in one query, state-scoped, all-time
        await upsertSource({
          clientId,
          sourceKind: 'courtlistener',
          enabled: true,
          config: cfg.courtlistener
        });
        autoConfigured.push('courtlistener');
        // CFPB — company name only (it's a corporate complaint registry),
        // state scope, all-time
        if (cfg.cfpb) {
          await upsertSource({
            clientId,
            sourceKind: 'cfpb',
            enabled: true,
            config: cfg.cfpb
          });
          autoConfigured.push('cfpb');
        }
      }
    } catch { /* non-fatal — operator can still set the config manually */ }
  }

  const nextSteps: string[] = [
    `Vertical: ${pack.displayName}`,
    `Pitch: ${pack.pitchTemplate}`,
    autoConfigured.length > 0
      ? `Auto-configured: ${autoConfigured.join(' + ')} with name + state from brief`
      : `Next: enable adapters → ${pack.recommendedAdapters.join(', ')}`,
    `Then: Run cascades → Rescore distress watchlist`,
    `Pricing: $${pack.suggestedPriceUsd.low}-${pack.suggestedPriceUsd.high}/mo per seat`
  ];
  return {
    ok: true,
    packId,
    weightsSeeded: seeded,
    recommendedAdapters: pack.recommendedAdapters,
    cascadeRecipesActivated: pack.cascadeRecipeIds,
    nextSteps
  };
}
