/**
 * CreativeBrief — the client's operating space at a glance.
 *
 * Presentational server component. Shows the story we're telling (active
 * narrative line), who to talk to next (top leads), what's ready to approve,
 * and quick links to the rest of the hub (leads, calendar, sales team). Data is
 * assembled in lib/client/brief.ts. Luxury-nautical, calm, never noisy.
 */
import Link from 'next/link';
import WaveDivider from '@/app/_components/WaveDivider';
import type { CreativeBrief as Brief } from '@/lib/client/brief';

const BAND_PILL: Record<string, string> = {
  hot: 'bg-rose-500/15 text-rose-300',
  warm: 'bg-amber-500/15 text-amber-300',
  cool: 'bg-sky-500/15 text-sky-300'
};

export default function CreativeBrief({
  brief,
  firstName,
  leadsHref = '/client/leads'
}: {
  brief: Brief;
  firstName: string;
  /** Where the "See all leads" / "Your leads" links point. Defaults to the
   *  client portal; the operator preview overrides this to the operator client
   *  page so the preview never jumps into the live (session-scoped) portal. */
  leadsHref?: string;
}) {
  const { activeLines, nextLeads, awaitingApproval, awaitingCount } = brief;

  return (
    <section aria-labelledby="brief-h" className="mb-10">
      <h2 id="brief-h" className="text-lg font-semibold text-ink mb-1">Your creative brief</h2>
      <p className="text-sm text-muted">The story we&apos;re telling for you right now, who to reach next, and what&apos;s ready for your eyes.</p>
      <WaveDivider className="mt-3 mb-4" width={104} />

      <div className="grid gap-4 md:grid-cols-3">
        {/* The story (active narrative line) */}
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 md:col-span-2">
          <div className="text-xs uppercase tracking-wide text-muted mb-2">The story we&apos;re telling</div>
          {activeLines.length === 0 ? (
            <p className="text-sm text-muted">
              Your narrative line is being shaped — the single story that will run through your social, blog, and commercials. It&apos;ll appear here once it&apos;s set.
            </p>
          ) : (
            <ul className="space-y-3">
              {activeLines.map((l) => (
                <li key={l.id}>
                  <div className="text-ink font-medium leading-snug">{l.name}</div>
                  {l.thesis && <div className="text-sm text-muted mt-0.5">{l.thesis}</div>}
                  {l.emotionalDriver && <div className="text-xs text-muted/80 mt-1">Tone: {l.emotionalDriver}</div>}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Ready to approve */}
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
          <div className="text-xs uppercase tracking-wide text-muted mb-2">Ready for your approval</div>
          {awaitingCount === 0 ? (
            <p className="text-sm text-muted">Nothing waiting on you right now.</p>
          ) : (
            <>
              <div className="text-2xl font-semibold text-ink">{awaitingCount}</div>
              <ul className="mt-2 space-y-1">
                {awaitingApproval.slice(0, 4).map((c) => (
                  <li key={c.id} className="text-sm text-muted truncate">{c.typeLabel}: {c.title}</li>
                ))}
              </ul>
              <a href="#campaigns-h" className="inline-block mt-3 text-sm text-amber-300 hover:underline">Review &amp; approve →</a>
            </>
          )}
        </div>
      </div>

      {/* Next leads */}
      <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.03] p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="text-xs uppercase tracking-wide text-muted">Your next leads</div>
          <Link href={leadsHref} className="text-sm text-amber-300 hover:underline">See all leads →</Link>
        </div>
        {nextLeads.length === 0 ? (
          <p className="text-sm text-muted">No leads yet — find your next customers from the Leads page.</p>
        ) : (
          <ul className="divide-y divide-white/5">
            {nextLeads.map((l) => (
              <li key={l.id} className="py-2 flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-ink font-medium leading-snug truncate">{l.company}</div>
                  {l.painSummary && <div className="text-sm text-muted truncate">{l.painSummary}</div>}
                </div>
                {l.band && (
                  <span className={`shrink-0 text-xs px-2 py-0.5 rounded-full ${BAND_PILL[l.band] ?? 'bg-white/10 text-muted'}`}>
                    {l.band}{l.score != null ? ` · ${l.score}` : ''}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Quick links — leads live; calendar + sales team are coming, shown so the hub feels whole */}
      <div className="mt-4 flex flex-wrap gap-2">
        <Link href={leadsHref} className="text-sm rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-ink hover:bg-white/[0.08]">Your leads</Link>
        <span className="text-sm rounded-lg border border-white/10 bg-white/[0.02] px-3 py-1.5 text-muted/70 cursor-default" title="Coming soon">Calendar · soon</span>
        <span className="text-sm rounded-lg border border-white/10 bg-white/[0.02] px-3 py-1.5 text-muted/70 cursor-default" title="Coming soon">Sales team · soon</span>
      </div>
    </section>
  );
}
