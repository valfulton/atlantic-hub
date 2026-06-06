/**
 * RoyaleGateFrame  (val 2026-06-04)
 *
 * Shared layout for invitation/gate surfaces in the magic-link flow.
 * Centered AV logo, eyebrow, Fraunces headline with italic accent, muted
 * lede, children = the form, footer mark.
 *
 * Two registers (val 2026-06-06):
 *   register="cream" (client/public gate) — MATCHES THE MARKETING SITE:
 *     cream ground, emerald accent, bronze eyebrow, Fraunces. This is the
 *     direction for every client-facing gate (login Door B, set-password).
 *   register="dark"  (default) — the legacy obsidian frame, kept ONLY for
 *     the operator login so the operator register stays dark.
 *
 * All visual tokens live in `royale-gate.css` (.rg base + .rg--cream).
 * To retune the gate system, edit that one file — do not patch hex
 * literals in components.
 *
 * Usage:
 *   <RoyaleGateFrame
 *     eyebrow="A private growth practice"
 *     headline={<>Welcome <em>back</em>.</>}
 *     lede="Sign in with your email and password."
 *   >
 *     <form>...</form>
 *   </RoyaleGateFrame>
 */
import './royale-gate.css';

interface Props {
  eyebrow: string;
  headline: React.ReactNode;     // wrap accent word in <em> for italic gold
  lede?: React.ReactNode;
  children: React.ReactNode;
  asideTop?: React.ReactNode;    // optional small link below the form
  /** (#418) Footer mark, editable via copy key `gate.foot`. Optional;
   *  defaults to the original "Quiet · Legible · Verifiable" when omitted. */
  foot?: React.ReactNode;
  /** (val 2026-06-06) Visual register. "cream" = marketing-site cream/emerald
   *  (every client/public gate). "dark" = legacy obsidian (operator login only). */
  register?: 'cream' | 'dark';
}

export default function RoyaleGateFrame({ eyebrow, headline, lede, children, asideTop, foot, register = 'dark' }: Props) {
  const cream = register === 'cream';
  return (
    <div className={cream ? 'rg rg--cream' : 'rg'} data-skin={cream ? 'social' : 'royale'}>
      <main className="rg-stage">
        <img
          src={cream ? '/brand/av-logo.png' : '/brand/av_logo_white1152.png'}
          alt="Atlantic & Vine"
          className="rg-logo"
          width={190}
        />
        <p className="rg-eyebrow">{eyebrow}</p>
        <h1 className="rg-h1">{headline}</h1>
        {lede && <p className="rg-lede">{lede}</p>}
        {children}
        {asideTop && <div className="rg-aside">{asideTop}</div>}
      </main>
      <p className="rg-foot">{foot ?? 'Quiet · Legible · Verifiable'}</p>
    </div>
  );
}
