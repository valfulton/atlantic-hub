/**
 * ClientPrPanel  (#213 Part A)
 *
 * Per-client PR opportunity surface on the operator client page. Replaces
 * "val has to dig through the global /admin/pr inbox to find what's running
 * for John White right now." Shows every opportunity matched to one of this
 * client's leads, with status / score / deadline / pitch state at a glance,
 * plus a link straight to the operator PR detail page for action.
 *
 * Server component -- reads data directly via listPrOpportunitiesForClient.
 */
import Link from 'next/link';
import { listPrOpportunitiesForClient, summarize, type ClientPrOpportunity } from '@/lib/pr/per_client';

function StatusBadge({ status, pitchStatus }: { status: string; pitchStatus: string | null }) {
  // Pitch status (more specific) wins over opportunity status if both present.
  const effective = pitchStatus === 'sent'
    ? 'submitted'
    : pitchStatus === 'draft' || pitchStatus === 'approved'
    ? 'drafted'
    : status;
  const map: Record<string, string> = {
    new: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
    drafted: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
    submitted: 'bg-violet-500/15 text-violet-300 border-violet-500/30',
    won: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    passed: 'bg-white/10 text-white/50 border-white/15'
  };
  const cls = map[effective] || map.new;
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wider border ${cls}`}>
      {effective}
    </span>
  );
}

function DecayPill({ days }: { days: number | null }) {
  if (days == null) {
    return <span className="text-[11px] text-white/30">no deadline</span>;
  }
  if (days < 0) {
    return <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wider border bg-rose-500/15 text-rose-300 border-rose-500/30">
      expired {-days}d ago
    </span>;
  }
  let cls = 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30';
  if (days <= 3) cls = 'bg-rose-500/15 text-rose-300 border-rose-500/30';
  else if (days <= 7) cls = 'bg-amber-500/15 text-amber-300 border-amber-500/30';
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wider border ${cls}`}>
      {days === 0 ? 'today' : `${days}d left`}
    </span>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'urgent' | 'good' }) {
  const ring =
    tone === 'urgent' && value > 0
      ? 'border-rose-400/40 bg-rose-400/5'
      : tone === 'good' && value > 0
      ? 'border-emerald-400/40 bg-emerald-400/5'
      : 'border-white/10 bg-black/15';
  return (
    <div className={`rounded-lg border ${ring} px-3 py-2`}>
      <div className="text-[10px] uppercase tracking-[0.12em] text-white/50">{label}</div>
      <div className="text-xl font-semibold text-white mt-0.5 tabular-nums">{value}</div>
    </div>
  );
}

function titleFor(opp: ClientPrOpportunity): string {
  if (opp.outlet && opp.journalist) return `${opp.outlet} — ${opp.journalist}`;
  if (opp.outlet) return opp.outlet;
  if (opp.journalist) return opp.journalist;
  if (opp.queryText) return opp.queryText.slice(0, 80);
  return `Opportunity #${opp.id}`;
}

export async function ClientPrPanel({ clientId, clientName }: { clientId: number; clientName: string }) {
  let opps: ClientPrOpportunity[] = [];
  try {
    opps = await listPrOpportunitiesForClient(clientId, { limit: 30 });
  } catch (err) {
    // Non-fatal -- the panel just shows an honest error and the client page
    // keeps rendering the rest.
    return (
      <div className="rounded-2xl border border-rose-500/30 bg-rose-500/5 p-4 text-sm text-rose-200">
        Could not load PR for {clientName}: {(err as Error).message}
      </div>
    );
  }
  const stats = summarize(opps);

  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <div className="flex items-baseline justify-between gap-4 mb-3">
        <div>
          <div className="text-[11px] uppercase tracking-[0.12em] text-muted">Their PR pipeline</div>
          <div className="text-[13px] text-white/70 mt-0.5">
            Opportunities matched to {clientName}&apos;s leads — drafts, status, and deadlines.
          </div>
        </div>
        <Link
          href="/admin/pr"
          className="text-[11px] text-white/50 hover:text-amber-300 transition shrink-0"
        >
          Global PR inbox →
        </Link>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-4">
        <Stat label="Total" value={stats.total} />
        <Stat label="Awaiting draft" value={stats.awaitingDraft} tone="urgent" />
        <Stat label="Drafted" value={stats.drafted} />
        <Stat label="Submitted" value={stats.submitted} />
        <Stat label="Won" value={stats.won} tone="good" />
      </div>

      {opps.length === 0 ? (
        <div className="rounded-md border border-white/10 bg-black/20 px-4 py-6 text-center text-[12.5px] text-white/50">
          No PR opportunities matched to {clientName}&apos;s leads yet.
          <div className="text-[11px] text-white/35 mt-1">
            Forward journalist requests to the PR inbox, or wait for the next discovery sweep to surface matches.
          </div>
        </div>
      ) : (
        <ul className="divide-y divide-white/5">
          {opps.map((opp) => (
            <li key={opp.id} className="py-3 first:pt-0 last:pb-0">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <StatusBadge status={opp.status} pitchStatus={opp.pitchStatus} />
                    <DecayPill days={opp.decayDays} />
                    {opp.relevanceScore != null && (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wider border bg-white/5 text-white/60 border-white/10">
                        score {opp.relevanceScore}
                      </span>
                    )}
                    {opp.suggested && (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wider border bg-indigo-500/15 text-indigo-300 border-indigo-500/30">
                        suggested
                      </span>
                    )}
                  </div>
                  <Link
                    href={`/admin/pr?opp=${opp.id}`}
                    className="text-[13px] text-white font-medium hover:text-amber-300 transition"
                  >
                    {titleFor(opp)}
                  </Link>
                  {opp.queryText && opp.outlet && (
                    <div className="text-[11.5px] text-white/55 mt-1 line-clamp-2">{opp.queryText}</div>
                  )}
                  {opp.whyItMatters && (
                    <div className="text-[11px] text-amber-300/65 mt-1 italic line-clamp-2">
                      Why it matters: {opp.whyItMatters}
                    </div>
                  )}
                  {opp.matchedLeadCompany && (
                    <div className="text-[10.5px] text-white/40 mt-1">
                      Matched to: <span className="text-white/65">{opp.matchedLeadCompany}</span>
                    </div>
                  )}
                  {opp.pitchPreview && (
                    <div className="mt-2 rounded-md border border-amber-400/15 bg-amber-400/[0.03] px-2 py-1.5 text-[11px] text-white/65 line-clamp-3">
                      <span className="text-amber-300/70 uppercase tracking-wider text-[9.5px] mr-1.5">Draft</span>
                      {opp.pitchPreview}…
                    </div>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
