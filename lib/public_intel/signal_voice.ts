/**
 * lib/public_intel/signal_voice.ts  (#393, val 2026-06-03)
 *
 * Convert ClassifiedSignal[] from the watchlist row → a (headline, trail)
 * pair that powers SignalCard + FeaturedSignalHero.
 *
 * Headlines are voice-dressed but MUST be true to the signal. Trail is the
 * cascade attribution chain — labels users can read, payoff = the strongest
 * (last) signal that drove the score.
 */
import type { ClassifiedSignal } from './distress_engine';
import type { SignalTrailNode } from '@/app/client/_components/SignalCard';

const SIGNAL_LABEL: Record<string, string> = {
  new_llc: 'New LLC',
  suspended_entity: 'CA SOS suspension',
  dissolved_entity: 'Dissolved',
  leadership_change: 'Leadership change',
  high_denial_rate: 'High denial rate',
  high_refinance_volume: 'High refi volume',
  complaint_velocity_high: 'CFPB complaints rising',
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

/** Per-signal voice-dressed opening line. Used when the signal is the
 *  payoff (i.e. the highest-weight contributing signal). All TRUE. */
const HEADLINE_FOR: Record<string, string> = {
  bankruptcy_filed: 'A federal bankruptcy landed. They don’t know we know.',
  lawsuit_filed: 'A federal court filing names them. Window is open.',
  suspended_entity: 'CA Secretary of State just suspended them.',
  ucc_filing: 'A new UCC filing was logged against them.',
  dissolved_entity: 'They were just dissolved. Creditor work to do.',
  leadership_change: 'New leadership just took office. Buying season.',
  high_denial_rate: 'Their tract is denying at an unusual rate.',
  lender_under_fire: 'Their lender is collecting CFPB complaints.',
  code_violation: 'A code violation hit the property yesterday.',
  new_llc: 'A new entity just formed in your zone.',
  credit_risk_increase: 'Their credit risk score jumped this week.',
  negative_review_trend: 'Their reviews are sliding. Operations under stress.',
  address_change: 'They quietly moved. Worth a visit.',
  rapid_growth: 'They’re scaling fast. The buyer is ready.',
  high_refinance_volume: 'Refi activity is climbing in their tract.',
  complaint_velocity_high: 'Their state is seeing a complaint surge.'
};

const FALLBACK_HEADLINE = 'New signal landed. Worth a look this week.';

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
      headline: FALLBACK_HEADLINE,
      trail: [{ label: `Score ${args.score}`, payoff: true }],
      payoffKind: null
    };
  }
  // Trail: each contributing signal → readable label; last node = payoff.
  const trail: SignalTrailNode[] = sigs.map((s, i) => ({
    label: SIGNAL_LABEL[s.signalKind] || s.signalKind,
    payoff: i === sigs.length - 1
  }));
  // Headline: voice-dressed from the payoff signal (last in trail).
  const payoffKind = sigs[sigs.length - 1].signalKind;
  const headline = HEADLINE_FOR[payoffKind] || FALLBACK_HEADLINE;
  return { headline, trail, payoffKind };
}
