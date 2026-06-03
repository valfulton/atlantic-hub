// app/client/_components/FeaturedSignalHero.tsx  (V3 social skin)
// "This week's strongest signal" — the top distress watchlist entity rendered
// as a featured story. Tap = open the existing Draft modal (cascade attribution
// chain shown inside). NOT a content/video card — no plays/likes here either.
'use client';
import type { SignalTrailNode } from './SignalCard';

export interface FeaturedSignalHeroProps {
  headline: string;            // voice-dressed, TRUE
  entity: string;              // "Meridian Holdings LLC · flagged on your CBB watchlist"
  trail: SignalTrailNode[];
  imageUrl?: string;
  ctaLabel?: string;           // default "Open the signal →"
  onOpen: () => void;          // opens existing Draft modal
}

export default function FeaturedSignalHero(p: FeaturedSignalHeroProps) {
  return (
    <button type="button" className="feat" onClick={p.onOpen} aria-label={`Open signal: ${p.entity}`}>
      <span className="feat__ph" style={p.imageUrl ? { backgroundImage: `url(${p.imageUrl})` } : undefined} />
      <span className="av-scrim feat__sc" />
      <span className="feat__b">
        <span className="feat__eb">✦ This week&apos;s strongest signal</span>
        <span className="feat__h">{p.headline}</span>
        <span className="feat__who">{p.entity}</span>
        <span className="sig-trail feat__trail">
          {p.trail.map((n, i) => (
            <span key={i} style={{ display: 'inline-flex', gap: '.4rem', alignItems: 'center' }}>
              <span className={`sig ${n.payoff ? 'sig--payoff' : ''}`}>{n.label}</span>
              {i < p.trail.length - 1 && <span className="sig-arw">→</span>}
            </span>
          ))}
        </span>
        <span className="feat__cta">{p.ctaLabel ?? 'Open the signal →'}</span>
      </span>
    </button>
  );
}
