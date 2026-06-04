/**
 * RoyaleGateFrame  (val 2026-06-04)
 *
 * Shared layout for invitation/gate surfaces in the magic-link flow.
 * Matches the "By invitation." designer mockup exactly: obsidian ground,
 * centered AV logo, gold eyebrow, Cormorant headline with italic accent,
 * italic muted lede, children = the form, "QUIET · LEGIBLE · VERIFIABLE"
 * footer mark.
 *
 * All visual tokens live in `royale-gate.css`. To retune the gate system,
 * edit that one file — do not patch hex literals in components.
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
}

export default function RoyaleGateFrame({ eyebrow, headline, lede, children, asideTop, foot }: Props) {
  return (
    <div className="rg" data-skin="royale">
      <main className="rg-stage">
        <img
          src="/brand/av_logo_white1152.png"
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
