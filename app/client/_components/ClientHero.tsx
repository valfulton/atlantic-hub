/**
 * ClientHero — the outcome-led value summary at the top of /client/dashboard.
 *
 * (val 2026-06-06, rebuilt to SPEC_Dashboard_Outcome_Hero.md):
 *   Lead with the outcome ("Your pipeline · 12 leads in play · ~$48k potential"),
 *   not engine vocabulary. Then a retention-hook recap line ("This week we
 *   found 6 leads and drafted 3 posts for your approval.").
 *
 *   No jargon: never "signals", "watchlist", "distress", or any public-source
 *   name appears here. Outcomes only. The Featured Signal lives below.
 *
 * Cream + emerald headline (never black) + gold sparingly. Render shared by
 * the real /client/dashboard and the operator preview mirror.
 */

interface ClientHeroPipeline {
  total: number;
  hot: number;
  warm: number;
  cool: number;
}

interface ClientHeroThisWeek {
  leadsAdded: number;
  postsAwaitingApproval: number;
  pressMatches: number;
  callsLogged: number;
}

/** (val 2026-06-06) Watchlist has entities but pipeline is empty — engine
 *  is working, she just hasn't promoted any to leads yet. Different from the
 *  "we're still building your audit" empty state. */
interface ClientHeroSignalsWaiting {
  count: number;
}

/** Compact USD format — ~$48k, ~$1.2M, ~$2,400. Always signals approximation. */
function fmtPotential(usd: number): string {
  if (usd >= 1_000_000) {
    return `~$${(usd / 1_000_000).toFixed(usd >= 10_000_000 ? 0 : 1)}M`;
  }
  if (usd >= 10_000) {
    return `~$${Math.round(usd / 1_000)}k`;
  }
  return `~$${usd.toLocaleString('en-US')}`;
}

/** Plain-English recap from the trailing-7d counts. Only the non-zero
 *  clauses get rendered (no "and 0 posts" awkwardness). Returns null when
 *  everything is zero — caller falls through to the warm empty state. */
function buildRecap(t: ClientHeroThisWeek): string | null {
  const parts: string[] = [];
  if (t.leadsAdded > 0) {
    parts.push(`found ${t.leadsAdded} ${t.leadsAdded === 1 ? 'lead' : 'leads'}`);
  }
  if (t.postsAwaitingApproval > 0) {
    parts.push(`drafted ${t.postsAwaitingApproval} ${t.postsAwaitingApproval === 1 ? 'post' : 'posts'} for your approval`);
  }
  if (t.pressMatches > 0) {
    parts.push(`surfaced ${t.pressMatches} press ${t.pressMatches === 1 ? 'match' : 'matches'}`);
  }
  if (t.callsLogged > 0) {
    parts.push(`logged ${t.callsLogged} ${t.callsLogged === 1 ? 'call' : 'calls'}`);
  }
  if (parts.length === 0) return null;
  if (parts.length === 1) return `This week we ${parts[0]}.`;
  if (parts.length === 2) return `This week we ${parts[0]} and ${parts[1]}.`;
  // Oxford comma for 3+; reads cleaner than "we found 6, drafted 3, and logged 2".
  return `This week we ${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}.`;
}

export default function ClientHero({
  pipeline,
  potentialUsd,
  thisWeek,
  signalsWaiting
}: {
  pipeline: ClientHeroPipeline;
  potentialUsd: number | null;
  thisWeek: ClientHeroThisWeek;
  /** (val 2026-06-06) Number of unpromoted entities on the watchlist.
   *  When > 0 AND pipeline is empty, the hero shows a "ready to fill"
   *  message that points at the watchlist below — not the "we're still
   *  building" copy, which reads wrong when the engine is clearly firing. */
  signalsWaiting?: ClientHeroSignalsWaiting;
}) {
  const totalZero = pipeline.total === 0;
  const weekZero =
    thisWeek.leadsAdded === 0 &&
    thisWeek.postsAwaitingApproval === 0 &&
    thisWeek.pressMatches === 0 &&
    thisWeek.callsLogged === 0;
  const waiting = signalsWaiting?.count ?? 0;

  // (val 2026-06-06) Pipeline empty BUT engine is firing — point at the
  // available action instead of saying "we're still building." Reads
  // correctly when the watchlist below has signals ready to promote.
  if (totalZero && waiting > 0) {
    return (
      <section
        className="mb-6 rounded-2xl overflow-hidden"
        style={{
          background: 'var(--paper, #FFFDF8)',
          border: '1px solid color-mix(in srgb, var(--emerald-deep, #0A4D3C) 12%, transparent)',
          boxShadow: '0 12px 30px -22px var(--card-shadow, rgba(10, 77, 60, 0.4))'
        }}
      >
        <div className="px-5 sm:px-7 py-6 sm:py-7">
          <div
            className="text-[10.5px] uppercase tracking-[0.22em] mb-2"
            style={{ color: 'var(--emerald-deep, #0A4D3C)' }}
          >
            Your pipeline
          </div>
          <h1
            className="text-[22px] sm:text-[28px] leading-tight tracking-tight"
            style={{
              fontFamily: 'var(--font-fraunces, "Fraunces", "Cormorant Garamond", Georgia, serif)',
              color: 'var(--emerald-deep, #0A4D3C)',
              fontWeight: 500
            }}
          >
            Ready to fill — {waiting} {waiting === 1 ? 'opportunity' : 'opportunities'} worth a move this week.
          </h1>
          <p
            className="mt-2 text-[14px] leading-relaxed"
            style={{ color: 'var(--muted, #5C6862)' }}
          >
            Pick one below and add it to your pipeline. Once a name is in play, your week-by-week wins land here.
          </p>
        </div>
      </section>
    );
  }

  // (SPEC §4) Warm empty state — never reads as "quiet." A brand-new client
  // sees work-in-progress, not absence. Borrows the AccessPaused tone.
  if (totalZero && weekZero) {
    return (
      <section
        className="mb-6 rounded-2xl overflow-hidden"
        style={{
          background: 'var(--paper, #FFFDF8)',
          border: '1px solid color-mix(in srgb, var(--emerald-deep, #0A4D3C) 12%, transparent)',
          boxShadow: '0 12px 30px -22px var(--card-shadow, rgba(10, 77, 60, 0.4))'
        }}
      >
        <div className="px-5 sm:px-7 py-6 sm:py-7">
          <div
            className="text-[10.5px] uppercase tracking-[0.22em] mb-2"
            style={{ color: 'var(--emerald-deep, #0A4D3C)' }}
          >
            Your pipeline
          </div>
          <h1
            className="text-[22px] sm:text-[28px] leading-tight tracking-tight"
            style={{
              fontFamily: 'var(--font-fraunces, "Fraunces", "Cormorant Garamond", Georgia, serif)',
              color: 'var(--emerald-deep, #0A4D3C)',
              fontWeight: 500
            }}
          >
            Your pipeline is taking shape.
          </h1>
          <p
            className="mt-2 text-[14px] leading-relaxed"
            style={{ color: 'var(--muted, #5C6862)' }}
          >
            We&rsquo;re building your audit and scoring your first leads &mdash; they&rsquo;ll land here within a few days.
          </p>
        </div>
      </section>
    );
  }

  const recap = buildRecap(thisWeek);

  return (
    <section
      className="mb-6 rounded-2xl overflow-hidden"
      style={{
        background: 'var(--paper, #FFFDF8)',
        border: '1px solid color-mix(in srgb, var(--emerald-deep, #0A4D3C) 12%, transparent)',
        boxShadow: '0 12px 30px -22px var(--card-shadow, rgba(10, 77, 60, 0.4))'
      }}
    >
      <div className="px-5 sm:px-7 py-6 sm:py-7">
        {/* (SPEC §2) Eyebrow — "Your pipeline" in emerald small-caps. */}
        <div
          className="text-[10.5px] uppercase tracking-[0.22em] mb-2"
          style={{ color: 'var(--emerald-deep, #0A4D3C)' }}
        >
          Your pipeline
        </div>

        {/* (SPEC §2) Headline — value first. "{N} leads in play · ~${X} potential
            (forecast)". Fraunces, emerald, never black. */}
        <h1
          className="text-[24px] sm:text-[32px] leading-tight tracking-tight break-words"
          style={{
            fontFamily: 'var(--font-fraunces, "Fraunces", "Cormorant Garamond", Georgia, serif)',
            color: 'var(--emerald-deep, #0A4D3C)',
            fontWeight: 500
          }}
        >
          {pipeline.total} {pipeline.total === 1 ? 'lead' : 'leads'} in play
          {potentialUsd != null && potentialUsd > 0 && (
            <>
              <span style={{ color: 'color-mix(in srgb, var(--emerald-deep, #0A4D3C) 35%, transparent)' }}> · </span>
              <span title="Forecast based on your pipeline and average deal value. Not booked revenue.">
                {fmtPotential(potentialUsd)} potential{' '}
                <span
                  className="text-[12px] sm:text-[14px] align-baseline"
                  style={{ color: 'var(--muted, #5C6862)', fontStyle: 'italic', fontWeight: 400 }}
                >
                  (forecast)
                </span>
              </span>
            </>
          )}
        </h1>

        {/* (SPEC §2) Band row — only non-zero clauses appear. Garnet/amber-sig/harbor
            on cream (AA, replaces navy-era rose/gold/sky pastels). */}
        {pipeline.total > 0 && (pipeline.hot + pipeline.warm + pipeline.cool) > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13.5px]">
            {pipeline.hot > 0 && (
              <span style={{ color: 'var(--ink, #14201B)' }}>
                <span className="font-semibold">{pipeline.hot}</span> hot
              </span>
            )}
            {pipeline.warm > 0 && (
              <span style={{ color: 'var(--ink, #14201B)' }}>
                <span className="font-semibold">{pipeline.warm}</span> warm
              </span>
            )}
            {pipeline.cool > 0 && (
              <span style={{ color: 'var(--ink, #14201B)' }}>
                <span className="font-semibold">{pipeline.cool}</span> cool
              </span>
            )}
          </div>
        )}

        {/* (SPEC §2) Recap line — the retention hook. Plain-English, muted ink,
            only the non-zero clauses. Italic Fraunces for the warmth. */}
        {recap && (
          <p
            className="mt-3 text-[14.5px] leading-relaxed"
            style={{
              fontFamily: 'var(--font-fraunces, "Fraunces", "Cormorant Garamond", Georgia, serif)',
              color: 'var(--ink, #14201B)',
              fontStyle: 'italic',
              fontWeight: 400
            }}
          >
            {recap}
          </p>
        )}
      </div>
    </section>
  );
}
