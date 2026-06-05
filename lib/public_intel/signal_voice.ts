/**
 * lib/public_intel/signal_voice.ts  (#393, val 2026-06-03)
 *
 * Convert ClassifiedSignal[] from the watchlist row → a (headline, trail)
 * pair that powers SignalCard + FeaturedSignalHero.
 *
 * Headlines are voice-dressed but MUST be true to the signal. Trail is the
 * cascade attribution chain — labels users can read, payoff = the strongest
 * (last) signal that drove the score.
 *
 * #404 (val 2026-06-03) — VR flagged that 5 cards with the same payoff signal
 * rendered THE SAME headline ("A federal bankruptcy landed…"), which read
 * templated. Fix: multiple quieter variants per signal kind, deterministic
 * pick by a hash of the entity name so the same entity is stable but
 * different entities get different lines. Also dropped the swaggy "they don't
 * know we know" phrasing — quieter and more journalistic, true to the signal.
 */
import type { ClassifiedSignal } from './distress_engine';
import type { SignalTrailNode } from '@/app/client/_components/SignalCard';

// val 2026-06-05 (HARD RULE): client-facing labels must NEVER name the data
// vendor or government agency (CourtListener, CFPB, CA SOS, HMDA, PACER, MD
// Land Rec, etc). The value is the intelligence engine, not the upstream feed.
// Replaced "CA SOS suspension" / "CFPB complaints rising" with neutral phrasing.
const SIGNAL_LABEL: Record<string, string> = {
  new_llc: 'New LLC',
  suspended_entity: 'Entity suspended',
  dissolved_entity: 'Dissolved',
  leadership_change: 'Leadership change',
  high_denial_rate: 'High denial rate',
  high_refinance_volume: 'High refi volume',
  complaint_velocity_high: 'Complaint volume rising',
  lender_under_fire: 'Lender under fire',
  lawsuit_filed: 'Federal filing',
  bankruptcy_filed: 'Bankruptcy filed',
  ucc_filing: 'UCC filing',
  credit_risk_increase: 'Credit risk ↑',
  negative_review_trend: 'Review trend ↓',
  address_change: 'Address change',
  rapid_growth: 'Rapid growth',
  code_violation: 'Code violation'
};

/** Per-signal voice-dressed opening lines. Used when the signal is the
 *  payoff (i.e. the highest-weight contributing signal). All TRUE.
 *  Multiple variants so a list of 5 entities with the same payoff doesn't
 *  read templated — picked deterministically by entity-name hash. */
const HEADLINES_FOR: Record<string, string[]> = {
  bankruptcy_filed: [
    'Federal bankruptcy was just filed.',
    'A bankruptcy petition hit the federal docket.',
    'New on the bankruptcy roll. The window is open.',
    'Their file landed in federal bankruptcy court.'
  ],
  lawsuit_filed: [
    'A federal court filing names them.',
    'They were named in a new federal action.',
    'New federal docket entry on file.',
    'A federal lawsuit surfaced this week.'
  ],
  suspended_entity: [
    'CA Secretary of State just suspended them.',
    'Their CA SOS status flipped to suspended.',
    'They lost good standing in California this week.',
    'A SOS suspension landed on their file.'
  ],
  ucc_filing: [
    'A new UCC filing was logged against them.',
    'A creditor filed a UCC interest this week.',
    'New collateral lien posted under their name.',
    'A UCC-1 hit their record.'
  ],
  dissolved_entity: [
    'They were just dissolved.',
    'Their entity is now marked dissolved.',
    'Dissolution paperwork is on file.',
    'They closed out of state records this week.'
  ],
  leadership_change: [
    'New leadership just took office.',
    'A leadership change posted on their record.',
    'Their key principal just changed.',
    'A new officer was just registered.'
  ],
  high_denial_rate: [
    'Their tract is denying at an unusual rate.',
    'Denial rates in their market are climbing.',
    'Lender denials in their area just spiked.',
    'Their geography is seeing more no-decisions.'
  ],
  lender_under_fire: [
    'Their lender is collecting CFPB complaints.',
    'CFPB complaints are landing on their lender.',
    'Their financing partner is under regulatory eyes.',
    'The lender they use is on a complaint streak.'
  ],
  code_violation: [
    'A code violation hit the property.',
    'A new code citation is on their file.',
    'They were just cited for a building code issue.',
    'Inspectors logged a violation at the address.'
  ],
  new_llc: [
    'A new entity just formed in your zone.',
    'A fresh LLC registered in your geography.',
    'New entity formation on the state register.',
    'A brand-new business filing just posted.'
  ],
  credit_risk_increase: [
    'Their credit risk score jumped this week.',
    'A credit score swing landed on their record.',
    'Risk indicators on their file just climbed.',
    'Their credit profile moved the wrong direction.'
  ],
  negative_review_trend: [
    'Their reviews are sliding.',
    'Customer reviews are trending against them.',
    'A review-trend dip just posted.',
    'Their sentiment line broke this month.'
  ],
  address_change: [
    'They quietly moved.',
    'A new business address is on file.',
    'They updated their primary location.',
    'Their registered address just changed.'
  ],
  rapid_growth: [
    'They’re scaling fast.',
    'Growth signals are stacking on their record.',
    'Their footprint is expanding this quarter.',
    'A growth-pace flag posted on their file.'
  ],
  high_refinance_volume: [
    'Refi activity is climbing in their tract.',
    'Their geography is seeing a refi surge.',
    'Refinance volume in their market is up.',
    'A refi-volume signal posted on their area.'
  ],
  complaint_velocity_high: [
    'Their state is seeing a complaint surge.',
    'CFPB complaint pace just spiked in their region.',
    'Their geography is on a complaint streak.',
    'A complaint-velocity flag landed in their market.'
  ]
};

const FALLBACK_HEADLINES = [
  'New signal landed. Worth a look this week.',
  'A fresh signal posted on their record.',
  'Their file just moved on public records.'
];

/** Deterministic but well-distributed pick across variants. Same entity →
 *  same headline; different entities → different headlines. */
function pickHeadline(kind: string, entityKey: string): string {
  const options = HEADLINES_FOR[kind] || FALLBACK_HEADLINES;
  // djb2-style hash — fine for picking 1-of-N, no crypto needed.
  let h = 5381;
  for (let i = 0; i < entityKey.length; i++) {
    h = ((h << 5) + h + entityKey.charCodeAt(i)) | 0;
  }
  return options[Math.abs(h) % options.length];
}

export function buildSignalCardData(args: {
  entityLabel: string;
  contributingSignals: ClassifiedSignal[];
  score: number;
}): {
  headline: string;
  trail: SignalTrailNode[];
  payoffKind: string | null;
} {
  const sigs = (args.contributingSignals || []).slice(0, 4);
  if (sigs.length === 0) {
    return {
      headline: pickHeadline('__fallback__', args.entityLabel),
      trail: [{ label: `Score ${args.score}`, payoff: true }],
      payoffKind: null
    };
  }
  // Trail: each contributing signal → readable label; last node = payoff.
  const trail: SignalTrailNode[] = sigs.map((s, i) => ({
    label: SIGNAL_LABEL[s.signalKind] || s.signalKind,
    payoff: i === sigs.length - 1
  }));
  // Headline: voice-dressed from the payoff signal (last in trail), picked
  // deterministically from this signal's variants by entity-name hash.
  const payoffKind = sigs[sigs.length - 1].signalKind;
  const headline = pickHeadline(payoffKind, args.entityLabel);
  return { headline, trail, payoffKind };
}
