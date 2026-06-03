// app/client/_components/SignalCard.tsx  (V3 social skin)
// The playful-but-true watchlist/lead card. ONE primary CTA. Cascade signal
// trail instead of likes/plays. Secondary actions live behind the ⋯ reveal.
//
// Data note: `trail` is the cascade attribution chain from the Distress
// Intelligence / Cascade pipeline — pass the REAL emitted trail, last node is
// the payoff. `headline` is voice-dressed but must be TRUE to the signal.
'use client';
import { useState } from 'react';

export type SignalTrailNode = { label: string; payoff?: boolean };
export type SignalAction = { label: string; icon?: string; onClick?: () => void };

export interface SignalCardProps {
  entity: string;
  logoUrl?: string;            // optional; scrim covers it so sparse data still looks intentional
  monogram?: string;           // fallback letter(s) shown under the scrim
  chip?: string;               // e.g. "New · filed yesterday" or "94 fit · warm"
  chipKind?: 'signal' | 'fit'; // 'signal' = amber distress, 'fit' = emerald score
  headline: string;            // voice-dressed, TRUE to the signal
  trail: SignalTrailNode[];    // cascade attribution chain (real)
  primary: SignalAction;       // exactly ONE
  secondary?: SignalAction[];  // revealed under ⋯ (press-and-hold / menu)
}

export default function SignalCard(p: SignalCardProps) {
  const [open, setOpen] = useState(false);
  return (
    <article className="sigcard">
      <div className="sigcard__hd">
        <div className="sigcard__logo" style={p.logoUrl ? { backgroundImage: `url(${p.logoUrl})` } : undefined}>
          <span className="av-scrim" />
          <b>{p.monogram ?? p.entity.charAt(0)}</b>
        </div>
        <div className="sigcard__nm">
          <b title={p.entity}>{p.entity}</b>
          {p.chip && <span className={`chip chip--${p.chipKind ?? 'signal'}`}>{p.chip}</span>}
        </div>
        {p.secondary?.length ? (
          <button type="button" className="sigcard__more" aria-label="More actions" aria-expanded={open}
                  onClick={() => setOpen((v) => !v)}>⋯</button>
        ) : null}
      </div>

      <p className="sigcard__ln">{p.headline}</p>

      <div className="sig-trail">
        {p.trail.map((n, i) => (
          <span key={i} style={{ display: 'inline-flex', gap: '.35rem', alignItems: 'center' }}>
            <span className={`sig ${n.payoff ? 'sig--payoff' : ''}`}>{n.label}</span>
            {i < p.trail.length - 1 && <span className="sig-arw">→</span>}
          </span>
        ))}
      </div>

      <div className="sigcard__foot">
        <button type="button" className="pcta" onClick={p.primary.onClick}>
          {p.primary.icon && <span aria-hidden>{p.primary.icon}</span>}{p.primary.label}
        </button>
      </div>

      {open && p.secondary?.length ? (
        <div className="sigcard__reveal" role="menu">
          {p.secondary.map((a, i) => (
            <button key={i} type="button" role="menuitem" className="sigcard__reveal-item" onClick={a.onClick}>
              {a.icon && <span aria-hidden>{a.icon}</span>}{a.label}
            </button>
          ))}
        </div>
      ) : null}
    </article>
  );
}
