'use client';

/**
 * BriefRevenueTriptych  (#544, val 2026-06-08)
 *
 * Three square (social-media format) cards rendered from brief_payload, on
 * the right rail of the Creative Brief editor. Each card tells one beat of
 * the revenue story:
 *
 *   1. WHO WE BUILT FOR — audience + insight (Q3 / Q4)
 *   2. THE PROMISE — single most important message + proof (Q5 / Q6)
 *   3. THE OPPORTUNITY — derived from ideal customer + brand_colors mood
 *
 * Mobile: stacks vertically below the form.
 * Wide screens: rides the right rail.
 * Presentation Mode: full-screen overlay enlarges all three for screenshare.
 *
 * Why this exists: val asked to fill the wasted right column with something
 * that lets her "merchandise the wow" of a client's brief — turn intake data
 * into ready-to-present social proof in 0 clicks. The Lyons / Flame case is
 * the destination — bedazzle on sign-in.
 */
import { useState, useEffect } from 'react';

interface BriefPayload {
  // Canonical 6-question keys (must match BriefEditor's QUESTIONS array + the
  // names extractBriefSeedFromIntake() reads). DO NOT rename without updating
  // both sides — the prompts read these keys directly.
  why_advertise?: string;       // Q1
  goals?: string;               // Q2
  target_audience?: string;     // Q3
  audience_insights?: string;   // Q4
  key_message?: string;         // Q5
  message_support?: string;     // Q6
  // Extras
  brand_voice?: string;
  differentiators?: string;
  brand_colors?: string;
  preferred_channels?: string;
  // Additional fields the triptych can lean on if present:
  ideal_client?: string;
  company?: string;
  // Allow any other keys without typing each one
  [key: string]: unknown;
}

export default function BriefRevenueTriptych({
  brandName,
  payload,
  wide = false
}: {
  brandName: string;
  payload: BriefPayload;
  /** (#545) When the parent BriefEditor's "Drafting table" mode is on, the
   *  cards take the full width of the page and render 3-across at full size.
   *  Inline preview of presentation mode, no overlay needed. */
  wide?: boolean;
}) {
  const [presenting, setPresenting] = useState(false);

  // Escape closes presentation mode.
  useEffect(() => {
    if (!presenting) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPresenting(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [presenting]);

  // Parse brand_colors hint (e.g. "navy + amber" or "#0a1f3d, #d4a253") into
  // two tokens; fall back to AV brand tokens.
  const colors = parseBrandColors(payload.brand_colors);

  const cards: TriptychCard[] = [
    {
      eyebrow: 'Who we built for',
      body: payload.target_audience || payload.ideal_client || 'Add Q3 (Audience) to fill this card.',
      tagline: trim(payload.audience_insights, 140),
      surface: colors.deep,
      ink: colors.lightInk,
      accent: colors.accent
    },
    {
      eyebrow: 'The promise',
      body: payload.key_message || 'Add Q5 (Single most important message) to fill this card.',
      tagline: trim(payload.message_support, 140),
      surface: colors.cream,
      ink: colors.darkInk,
      accent: colors.accent
    },
    {
      eyebrow: 'The opportunity',
      body: deriveOpportunity(payload, brandName),
      tagline: payload.differentiators ? `Why us · ${trim(payload.differentiators, 100)}` : undefined,
      surface: colors.accent,
      ink: colors.darkInk,
      accent: colors.deep
    }
  ];

  return (
    <>
      {/* Right-rail panel (or stacked when narrow). Header + three cards.
          (#545 val 2026-06-08) FLIPPED from dark surface → cream. The dark
          card felt like a black surface against the rest of the page (which
          IS still dark, sigh — that's #545's other half). For NOW: rail is
          cream w/ dark ink so the cards read as luxe gallery objects. */}
      <aside className="rounded-2xl border border-[color-mix(in_srgb,var(--gold-bright)_22%,transparent)] bg-[#FFFDF5] text-[#0A0A0A] p-3 sm:p-4 space-y-3 shadow-[0_2px_24px_rgba(0,0,0,0.18)]">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-[10px] uppercase tracking-[0.16em] text-[#7A5A18]">
              Revenue story
            </div>
            <div className="text-[13px] text-[#0A0A0A]/80 mt-0.5">
              Three social-ready cards from this brief.
            </div>
          </div>
          <button
            type="button"
            onClick={() => setPresenting(true)}
            className="shrink-0 rounded-md border border-[#0A0A0A]/15 bg-white hover:bg-[#FFF8DC] text-[#0A0A0A] text-[11px] px-2.5 py-1 inline-flex items-center gap-1.5 transition"
            title="Pop out for screen share / presentation"
            aria-label="Open presentation mode"
          >
            <span aria-hidden>⤢</span>
            <span className="hidden sm:inline">Presentation mode</span>
            <span className="sm:hidden">Present</span>
          </button>
        </div>

        {/* (#545) In wide/drafting-table mode the cards lay out 3-across at
            full size (compact=false). Otherwise they stack in the rail. */}
        <div className={wide
          ? 'grid grid-cols-1 md:grid-cols-3 gap-4'
          : 'space-y-3'
        }>
          {cards.map((c, i) => (
            <Card key={i} brand={brandName} card={c} compact={!wide} />
          ))}
        </div>

        <div className="text-[10px] text-[#0A0A0A]/55 leading-snug">
          Built from this brief. Edit Q3–Q6 + brand colors on the left and the cards refresh.
          {' '}When a VIP client signs in, this gallery is theirs.
        </div>
      </aside>

      {/* Presentation mode — fullscreen overlay, large cards, dark vignette. */}
      {presenting && (
        <div
          className="fixed inset-0 z-[100] bg-black/95 backdrop-blur-sm p-6 sm:p-10 overflow-auto"
          onClick={(e) => { if (e.target === e.currentTarget) setPresenting(false); }}
          role="dialog"
          aria-modal="true"
        >
          <div className="mx-auto max-w-[1400px]">
            <div className="flex items-center justify-between mb-6">
              <div>
                <div className="text-[10px] uppercase tracking-[0.18em] text-[color-mix(in_srgb,var(--gold-bright)_80%,transparent)]">
                  {brandName} · revenue story
                </div>
                <div className="text-white/90 text-sm mt-1">
                  Built from this brief at {new Date().toLocaleString()}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setPresenting(false)}
                className="rounded-md border border-white/15 bg-white/5 hover:bg-white/10 text-white/85 text-xs px-3 py-1.5"
              >
                Close · Esc
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {cards.map((c, i) => (
                <Card key={i} brand={brandName} card={c} compact={false} />
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/* ──────────────────────────────────────────────────────────────────────── */
/* Card                                                                   */
/* ──────────────────────────────────────────────────────────────────────── */

interface TriptychCard {
  eyebrow: string;
  body: string;
  tagline?: string;
  surface: string;
  ink: string;
  accent: string;
}

function Card({ brand, card, compact }: { brand: string; card: TriptychCard; compact: boolean }) {
  return (
    <div
      className={
        'relative rounded-xl overflow-hidden shadow-lg ' +
        (compact ? 'aspect-square' : 'aspect-square w-full')
      }
      style={{ background: card.surface, color: card.ink }}
    >
      {/* Gold corner sparkle */}
      <div
        aria-hidden
        className="absolute top-0 right-0 w-14 h-14 opacity-90"
        style={{
          background: `radial-gradient(circle at top right, ${card.accent} 0%, transparent 70%)`
        }}
      />
      <div className={'h-full w-full flex flex-col justify-between ' + (compact ? 'p-4' : 'p-6 sm:p-8')}>
        <div>
          <div
            className={'uppercase tracking-[0.18em] ' + (compact ? 'text-[9.5px]' : 'text-[11px]')}
            style={{ color: card.accent }}
          >
            {card.eyebrow}
          </div>
          <div
            className={
              'mt-2 font-medium leading-snug ' +
              (compact ? 'text-[13.5px]' : 'text-[20px] sm:text-[26px]')
            }
            style={{ fontFamily: 'Fraunces, Cormorant Garamond, serif' }}
          >
            {card.body}
          </div>
          {card.tagline && (
            <div
              className={'mt-3 italic ' + (compact ? 'text-[10.5px] opacity-80' : 'text-[12.5px] opacity-85')}
            >
              {card.tagline}
            </div>
          )}
        </div>
        <div className="flex items-center justify-between">
          <div
            className={'uppercase tracking-[0.22em] ' + (compact ? 'text-[9px]' : 'text-[11px]')}
            style={{ color: card.accent }}
          >
            {brand}
          </div>
          <div
            className={'flex items-center gap-1 ' + (compact ? 'text-[9px]' : 'text-[11px]')}
            style={{ color: card.accent }}
          >
            <span aria-hidden>✦</span>
            <span>Atlantic &amp; Vine</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────── */
/* Helpers                                                                */
/* ──────────────────────────────────────────────────────────────────────── */

interface ColorSet {
  deep: string;
  cream: string;
  accent: string;
  lightInk: string;
  darkInk: string;
}

/**
 * Parse the brand_colors hint string. Accepts:
 *   - "#0a1f3d, #d4a253"  → uses both hex values
 *   - "navy + amber"      → maps named pairs
 * Falls back to A&V cream + emerald-deep + champagne.
 */
function parseBrandColors(raw?: string): ColorSet {
  const fallback: ColorSet = {
    deep: '#0A4D3C',     // A&V emerald-deep
    cream: '#FFFDF5',
    accent: '#EBCB6B',   // A&V champagne gold
    lightInk: '#FFFDF5',
    darkInk: '#0A0A0A'
  };
  if (!raw || typeof raw !== 'string') return fallback;
  // Try hex first
  const hexes = raw.match(/#([0-9a-f]{6}|[0-9a-f]{3})\b/gi);
  if (hexes && hexes.length >= 2) {
    return { ...fallback, deep: hexes[0], accent: hexes[1] };
  }
  // Named-pair shortcuts
  const lower = raw.toLowerCase();
  const NAMED: Record<string, string> = {
    navy: '#0a1f3d', emerald: '#0A4D3C', forest: '#0A4D3C',
    amber: '#d4a253', gold: '#EBCB6B', champagne: '#EBCB6B',
    burgundy: '#6B1A2C', garnet: '#6B1A2C', rose: '#C97E8B',
    cream: '#FFFDF5', ivory: '#F7F1E1'
  };
  const tokens = Object.keys(NAMED).filter((n) => lower.includes(n));
  if (tokens.length >= 2) {
    return { ...fallback, deep: NAMED[tokens[0]], accent: NAMED[tokens[1]] };
  }
  if (tokens.length === 1) {
    return { ...fallback, deep: NAMED[tokens[0]] };
  }
  return fallback;
}

function trim(s: string | undefined | null, max: number): string | undefined {
  if (!s || typeof s !== 'string') return undefined;
  const t = s.trim();
  if (!t) return undefined;
  return t.length <= max ? t : t.slice(0, max - 1).trimEnd() + '…';
}

/**
 * (#544) Derive a single-line opportunity statement from the brief. This is
 * the placeholder for the future revenue-intelligence rollup — for now it
 * leans on whatever's in the brief to give the third card real content.
 */
function deriveOpportunity(p: BriefPayload, brand: string): string {
  if (typeof p.goals === 'string' && p.goals.trim()) {
    return p.goals.trim();
  }
  if (typeof p.why_advertise === 'string' && p.why_advertise.trim()) {
    return p.why_advertise.trim();
  }
  return `Bring ${brand}'s next chapter to the people most ready to hear it.`;
}
