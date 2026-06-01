/**
 * /admin/av/clients/[client_id]/preview/leads
 *
 * OPERATOR-ONLY mirror of /client/leads — same data, same lead cards, but lead
 * links route to the operator preview/leads/[audit_id] sibling instead of the
 * live /client portal.
 *
 * Interactive controls that require a client session (DiscoverPanel, lead
 * reject) are intentionally omitted in preview — they'd 401 against
 * /api/client/* without the client cookie. A note on the banner explains.
 */
import { headers } from 'next/headers';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { getAvDb } from '@/lib/db/av';
import { findClientUserById } from '@/lib/auth/client-user';
import { listClientLeads, type ClientLead } from '@/lib/client/leads';
import { TIER_LABEL } from '@/lib/client-portal/tiers';
import WaveDivider from '@/app/_components/WaveDivider';
import LeadQuickActions from './LeadQuickActions';
import IcpFitPill from '@/app/_components/IcpFitPill';
import AuditStalePill from '@/app/_components/AuditStalePill';
import type { RowDataPacket } from 'mysql2';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface ClientRow extends RowDataPacket { client_name: string | null }

// (#300) Same 'mixed' demotion as the live /client/leads view — keep the
// operator preview honest. See effectiveBand notes on the live page.
const BAND_TONE: Record<'hot' | 'warm' | 'cool' | 'mixed', { bg: string; fg: string; label: string }> = {
  hot: { bg: 'rgba(255,90,110,0.16)', fg: '#FF9AA8', label: 'Hot' },
  warm: { bg: 'rgba(245,158,11,0.16)', fg: '#fcd34d', label: 'Warm' },
  cool: { bg: 'rgba(91,168,255,0.16)', fg: '#a8cbff', label: 'Cool' },
  mixed: { bg: 'rgba(148,163,184,0.18)', fg: '#cbd5e1', label: 'Mixed signal' }
};
function effectiveBand(
  band: 'hot' | 'warm' | 'cool' | null,
  icpFitScore: number | null
): 'hot' | 'warm' | 'cool' | 'mixed' | null {
  if (!band) return null;
  if ((band === 'hot' || band === 'warm') && icpFitScore != null && icpFitScore < 40) {
    return 'mixed';
  }
  return band;
}

function ScorePill({ lead }: { lead: ClientLead }) {
  const displayBand = effectiveBand(lead.band, lead.icpFitScore);
  const tone = displayBand ? BAND_TONE[displayBand] : null;
  return (
    <div className="flex items-center gap-2 shrink-0">
      {lead.score !== null && (
        <span className="text-2xl font-semibold tabular-nums text-ink leading-none">{Math.round(lead.score)}</span>
      )}
      {tone && (
        <span
          className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] uppercase tracking-[0.14em] font-medium"
          style={{ background: tone.bg, color: tone.fg }}
          title={
            displayBand === 'mixed'
              ? 'AV signal is high but the lead does not match this client\'s ICP. See the fit reasoning below.'
              : undefined
          }
        >
          {tone.label}
        </span>
      )}
    </div>
  );
}

export default async function ClientLeadsPreview({ params }: { params: { client_id: string } }) {
  const role = headers().get('x-ah-user-role') as 'owner' | 'staff' | 'client_user' | null;
  if (role === 'client_user') redirect('/admin');

  const clientId = Number.parseInt(params.client_id, 10);
  if (!Number.isFinite(clientId) || clientId <= 0) notFound();

  const db = getAvDb();
  const [crows] = await db.execute<ClientRow[]>(
    `SELECT client_name FROM clients WHERE client_id = ? LIMIT 1`,
    [clientId]
  );
  if (!crows[0]) notFound();
  const clientName = crows[0].client_name || `Client #${clientId}`;

  // Resolve a representative client_user the same way the dashboard preview does.
  const [mrows] = await db.execute<(RowDataPacket & { client_user_id: number })[]>(
    `SELECT client_user_id FROM client_users WHERE client_id = ? ORDER BY client_user_id ASC LIMIT 1`,
    [clientId]
  );
  let memberUserId = mrows[0]?.client_user_id ?? null;
  if (!memberUserId) {
    const [orows] = await db.execute<(RowDataPacket & { client_user_id: number })[]>(
      `SELECT client_user_id FROM brand_members
        WHERE client_id = ? AND role = 'owner'
        ORDER BY client_user_id ASC LIMIT 1`,
      [clientId]
    );
    memberUserId = orows[0]?.client_user_id ?? null;
  }
  const member = memberUserId ? await findClientUserById(memberUserId) : null;
  const tier = member?.tier ?? 'sprint';
  const locked = tier === 'audit_only';

  const headline = member?.display_name?.split(/[ ,]/)[0] || clientName.split(/[ ,]/)[0] || 'there';

  let leads: ClientLead[] = [];
  if (!locked) {
    try {
      leads = await listClientLeads({ client_id: clientId });
    } catch {
      leads = [];
    }
  }
  const hot = leads.filter((l) => l.band === 'hot').length;

  const previewLeadHref = (auditId: string) =>
    `/admin/av/clients/${clientId}/preview/leads/${auditId}`;

  return (
    <div>
      {/* Operator preview banner */}
      <div className="mb-4 rounded-lg border border-amber-400/40 bg-amber-400/10 px-4 py-2.5 text-sm text-amber-200 flex items-center justify-between gap-3">
        <span>
          <span className="font-semibold">Operator preview</span> — {clientName}&apos;s leads list. Find-leads and reject controls are hidden here (they need the client&apos;s own session).
        </span>
        <span className="shrink-0 flex items-center gap-4">
          <Link href={`/admin/av/clients/${clientId}/preview`} className="text-amber-100 hover:underline">&larr; Dashboard preview</Link>
          <Link href={`/admin/av/clients/${clientId}`} className="text-amber-100 hover:underline">Back to client</Link>
        </span>
      </div>

      <main className="max-w-6xl mx-auto px-4 py-6">
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

        {locked ? (
          <section className="rounded-2xl border border-dashed border-border bg-surface/60 p-8 text-center">
            <div className="text-3xl mb-3" aria-hidden="true">&#x1F512;</div>
            <h2 className="text-lg font-semibold text-ink">Lead discovery is a Sprint feature</h2>
            <p className="text-sm text-muted mt-2 max-w-md mx-auto leading-relaxed">
              You&apos;re on the <span className="text-ink font-medium">{TIER_LABEL[tier]}</span> plan. Upgrade to Sprint
              to have prospects discovered, enriched, and scored for your business.
            </p>
          </section>
        ) : leads.length === 0 ? (
          <section className="rounded-2xl border border-border bg-surface p-6">
            <p className="text-sm text-ink font-medium">Your pipeline is warming up.</p>
            <p className="text-sm text-muted mt-1.5 leading-relaxed">
              We&apos;re discovering and scoring prospects for your business. As they come in, each one appears here ranked
              by its AI Living Score, so you always see your strongest opportunities first.
            </p>
          </section>
        ) : (
          <ul className="grid sm:grid-cols-2 gap-3">
            {leads.map((l) => (
              <li key={l.id} className="rounded-2xl border border-border bg-surface p-5 flex flex-col">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    {l.auditId ? (
                      <a href={previewLeadHref(l.auditId)} className="text-ink font-medium leading-snug truncate hover:text-brand hover:underline block">
                        {l.company}
                      </a>
                    ) : (
                      <h3 className="text-ink font-medium leading-snug truncate">{l.company}</h3>
                    )}
                    {l.industry && (
                      <div className="text-[11px] uppercase tracking-[0.12em] text-muted mt-1">{l.industry}</div>
                    )}
                  </div>
                  <ScorePill lead={l} />
                </div>

                {/* (#95) ICP fit signal — mirrors what the client sees.
                    (#90) Audit-stale pill: in the operator mirror the tooltip
                    points val at the RefreshIntelPanel as the action. */}
                {(l.icpFitScore != null || l.auditStale) && (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {l.icpFitScore != null && (
                      <IcpFitPill score={l.icpFitScore} reasoning={l.icpFitReasoning} />
                    )}
                    <AuditStalePill stale={l.auditStale} actionable auditId={l.auditId} />
                    {l.icpFitReasoning && (
                      <span className="text-[11px] text-muted/85 italic">{l.icpFitReasoning}</span>
                    )}
                  </div>
                )}

                {l.painSummary && <p className="text-sm text-muted mt-3 leading-relaxed">{l.painSummary}</p>}

                {l.callScript && (l.callScript.openers.length > 0 || l.callScript.avoid.length > 0) && (
                  <div className="mt-3 rounded-xl border border-border bg-black/20 p-3">
                    <div className="text-[10px] uppercase tracking-[0.14em] text-brand mb-1.5">What to say on the call</div>
                    {l.callScript.primaryPain && (
                      <p className="text-xs text-muted mb-2 leading-relaxed">{l.callScript.primaryPain}</p>
                    )}
                    {l.callScript.openers.length > 0 && (
                      <ul className="space-y-1.5 mb-2">
                        {l.callScript.openers.slice(0, 3).map((o, i) => (
                          <li key={i} className="text-xs text-ink leading-relaxed">&ldquo;{o}&rdquo;</li>
                        ))}
                      </ul>
                    )}
                    {l.callScript.avoid.length > 0 && (
                      <div className="text-[11px] text-muted">
                        <span className="text-rose-300/80">Avoid:</span> {l.callScript.avoid.join('; ')}
                      </div>
                    )}
                  </div>
                )}

                <div className="mt-3 pt-3 border-t border-border text-xs text-muted flex flex-wrap gap-x-4 gap-y-1">
                  {l.contactName && (
                    <span>
                      <span className="text-muted/70">Contact:</span>{' '}
                      <span className="text-ink">{l.contactName}</span>
                      {l.contactTitle && (
                        <span className="text-muted"> · {l.contactTitle}</span>
                      )}
                    </span>
                  )}
                  {l.email && (
                    <span><span className="text-muted/70">Email:</span> <span className="text-ink">{l.email}</span></span>
                  )}
                  {l.phone && (
                    <span><span className="text-muted/70">Phone:</span> <span className="text-ink">{l.phone}</span></span>
                  )}
                  {l.website && (
                    <a href={l.website} target="_blank" rel="noopener" className="text-brand hover:underline">Website &rarr;</a>
                  )}
                </div>

                {/* (#207 follow-up) Address line at the bottom of each card --
                    matches the live /client/leads view so operator preview
                    mirrors what the client sees. */}
                {(l.addressStreet || l.addressCity) && (
                  <div className="mt-1 text-[11px] text-muted/80">
                    <span className="text-muted/60">Address:</span>{' '}
                    <span className="text-ink/85">
                      {[l.addressStreet, l.addressCity, l.addressState, l.addressPostal, l.addressCountry]
                        .filter((v): v is string => !!(v && v.trim()))
                        .join(', ')}
                    </span>
                  </div>
                )}

                {/* (#222) Inline log-call / log-email / draft-email actions.
                    Stays on the card so val + reps never have to navigate to
                    log effort. */}
                {l.auditId && (
                  <LeadQuickActions
                    auditId={l.auditId}
                    company={l.company}
                    contactEmail={l.email}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
