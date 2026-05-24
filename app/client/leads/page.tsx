/**
 * /client/leads
 *
 * The client's own lead pipeline, scoped strictly to their account (see
 * lib/client/leads.ts for the privacy wall). This is the first operator-grade
 * surface exposed to clients: the leads the platform discovered / imported for
 * THEIR business, with the AI Living Score and pain summary.
 *
 * Tier gate: lead discovery is a Sprint+ capability (see lib/client-portal/
 * tiers.ts). 'audit_only' clients see an upgrade prompt instead of the list.
 *
 * Lead SOURCING (which providers, which keys) is operator-only and never
 * surfaced here -- clients see results, not the machinery.
 */
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { readClientActorFromHeaders } from '@/lib/auth/client-session';
import { findClientUserById } from '@/lib/auth/client-user';
import { listClientLeads, type ClientLead } from '@/lib/client/leads';
import { ensureClientHub } from '@/lib/client/provision';
import { TIER_LABEL } from '@/lib/client-portal/tiers';
import { getClientAccessState } from '@/lib/av/client_access';
import PortalHeader from '@/app/client/_components/PortalHeader';
import AccessPaused from '@/app/client/_components/AccessPaused';
import WaveDivider from '@/app/_components/WaveDivider';
import DiscoverPanel from './DiscoverPanel';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const BAND_TONE: Record<'hot' | 'warm' | 'cool', { bg: string; fg: string; label: string }> = {
  hot: { bg: 'rgba(255,90,110,0.16)', fg: '#FF9AA8', label: 'Hot' },
  warm: { bg: 'rgba(245,158,11,0.16)', fg: '#fcd34d', label: 'Warm' },
  cool: { bg: 'rgba(91,168,255,0.16)', fg: '#a8cbff', label: 'Cool' }
};

function ScorePill({ lead }: { lead: ClientLead }) {
  const tone = lead.band ? BAND_TONE[lead.band] : null;
  return (
    <div className="flex items-center gap-2 shrink-0">
      {lead.score !== null && (
        <span className="text-2xl font-semibold tabular-nums text-ink leading-none">{Math.round(lead.score)}</span>
      )}
      {tone && (
        <span
          className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] uppercase tracking-[0.14em] font-medium"
          style={{ background: tone.bg, color: tone.fg }}
        >
          {tone.label}
        </span>
      )}
    </div>
  );
}

export default async function ClientLeadsPage() {
  const actor = readClientActorFromHeaders(headers() as unknown as Headers);
  if (!actor) redirect('/client/login');

  const user = await findClientUserById(actor.clientUserId);
  if (!user) redirect('/client/login');

  // Self-heal provisioning for accounts created before it landed.
  if (!user.client_id) {
    try {
      const cid = await ensureClientHub(user);
      if (cid) user.client_id = cid;
    } catch {
      /* non-fatal */
    }
  }

  // Access gate (same as dashboard): lapsed/revoked -> calm paused screen.
  if (user.client_id) {
    const access = await getClientAccessState(user.client_id);
    if (!access.active) {
      return (
        <>
          <PortalHeader displayName={user.display_name} email={user.email} tier={user.tier} active="leads" />
          <AccessPaused expired={access.expired} />
        </>
      );
    }
  }

  const headline = user.display_name?.split(/[ ,]/)[0] || 'there';
  const locked = user.tier === 'audit_only';

  let leads: ClientLead[] = [];
  if (!locked) {
    try {
      leads = await listClientLeads({ client_id: user.client_id });
    } catch {
      leads = [];
    }
  }

  const hot = leads.filter((l) => l.band === 'hot').length;

  return (
    <>
      <PortalHeader displayName={user.display_name} email={user.email} tier={user.tier} active="leads" />

      <main className="max-w-6xl mx-auto px-4 py-8 sm:py-10">
        <section
          className="mb-8 rounded-2xl border border-border overflow-hidden"
          style={{
            background:
              'radial-gradient(120% 140% at 0% 0%, rgba(245,158,11,0.10), transparent 55%), linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.01))'
          }}
        >
          <div className="px-6 sm:px-8 py-7">
            <div className="text-[10px] uppercase tracking-[0.22em] text-brand mb-2">Your pipeline</div>
            <h1 className="text-2xl sm:text-3xl font-semibold text-ink tracking-tight">Your leads, {headline}.</h1>
            <WaveDivider className="mt-3" width={120} />
            <p className="text-muted text-sm mt-4 max-w-xl leading-relaxed">
              {locked
                ? 'Lead discovery finds and scores prospects for your business automatically. It unlocks on the Sprint plan.'
                : leads.length > 0
                  ? `${leads.length} lead${leads.length === 1 ? '' : 's'} in your pipeline${hot > 0 ? `, ${hot} scored hot` : ''}. Ranked by our AI Living Score so the best are always on top.`
                  : 'We discover and score prospects for your business and they land right here, best-first.'}
            </p>
          </div>
        </section>

        {!locked && <DiscoverPanel />}

        {locked ? (
          <section className="rounded-2xl border border-dashed border-border bg-surface/60 p-8 text-center">
            <div className="text-3xl mb-3" aria-hidden="true">&#x1F512;</div>
            <h2 className="text-lg font-semibold text-ink">Lead discovery is a Sprint feature</h2>
            <p className="text-sm text-muted mt-2 max-w-md mx-auto leading-relaxed">
              You&apos;re on the <span className="text-ink font-medium">{TIER_LABEL[user.tier]}</span> plan. Upgrade to
              Sprint to have prospects discovered, enriched, and scored for your business &mdash; with the best surfaced
              automatically.
            </p>
            <a
              href="https://atlanticandvine.netlify.app/#pricing"
              target="_blank"
              rel="noopener"
              className="inline-flex items-center justify-center mt-5 px-4 py-2 rounded-md bg-brand text-brand-fg text-sm font-medium hover:opacity-90"
            >
              See plans
            </a>
          </section>
        ) : leads.length === 0 ? (
          <section className="rounded-2xl border border-border bg-surface p-6">
            <p className="text-sm text-ink font-medium">Your pipeline is warming up.</p>
            <p className="text-sm text-muted mt-1.5 leading-relaxed">
              We&apos;re discovering and scoring prospects for your business. As they come in, each one appears here
              ranked by its AI Living Score, so you always see your strongest opportunities first.
            </p>
          </section>
        ) : (
          <ul className="grid sm:grid-cols-2 gap-3">
            {leads.map((l) => (
              <li key={l.id} className="rounded-2xl border border-border bg-surface p-5 flex flex-col">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="text-ink font-medium leading-snug truncate">{l.company}</h3>
                    {l.industry && (
                      <div className="text-[11px] uppercase tracking-[0.12em] text-muted mt-1">{l.industry}</div>
                    )}
                  </div>
                  <ScorePill lead={l} />
                </div>

                {l.painSummary && <p className="text-sm text-muted mt-3 leading-relaxed">{l.painSummary}</p>}

                <div className="mt-3 pt-3 border-t border-border text-xs text-muted flex flex-wrap gap-x-4 gap-y-1">
                  {l.contactName && (
                    <span>
                      <span className="text-muted/70">Contact:</span> <span className="text-ink">{l.contactName}</span>
                    </span>
                  )}
                  {l.email && (
                    <span>
                      <span className="text-muted/70">Email:</span> <span className="text-ink">{l.email}</span>
                    </span>
                  )}
                  {l.phone && (
                    <span>
                      <span className="text-muted/70">Phone:</span> <span className="text-ink">{l.phone}</span>
                    </span>
                  )}
                  {l.website && (
                    <a href={l.website} target="_blank" rel="noopener" className="text-brand hover:underline">
                      Website &rarr;
                    </a>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        <footer className="border-t border-border mt-12 pt-5 text-xs text-muted text-center">
          &copy; {new Date().getFullYear()} Atlantic And Vine LLC. Signed in as{' '}
          <span className="text-ink">{user.email}</span>.
        </footer>
      </main>
    </>
  );
}
