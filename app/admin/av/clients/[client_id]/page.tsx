import { headers } from 'next/headers';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { getClientAccountDetail } from '@/lib/av/clients_overview';
import { getClientAccessState } from '@/lib/av/client_access';
import { getAvDb } from '@/lib/db/av';
import AccessControls from './AccessControls';
import AccountInfoEditor from './AccountInfoEditor';
import ExtractIntelButton from './ExtractIntelButton';
import AssignLeadsPanel from './AssignLeadsPanel';
import type { ClientTier } from '@/lib/client-portal/tiers';
import type { RowDataPacket } from 'mysql2';

interface UnassignedRow extends RowDataPacket {
  audit_id: string;
  company: string;
  industry: string | null;
  email: string | null;
  ai_score: number | string | null;
  ai_score_band: string | null;
}

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * /admin/av/clients/[client_id] -- operator-only client account detail.
 *
 * Shows the client's account, pipeline, ICP, and discovery activity/errors.
 * This is where the operator sees what the client never does: raw errors and
 * the machinery behind their hub.
 */
export default async function ClientDetailPage({ params }: { params: { client_id: string } }) {
  const role = headers().get('x-ah-user-role') as 'owner' | 'staff' | 'client_user' | null;
  if (role === 'client_user') redirect('/admin');

  const clientId = Number.parseInt(params.client_id, 10);
  if (!Number.isFinite(clientId) || clientId <= 0) notFound();

  const d = await getClientAccountDetail(clientId);
  if (!d) notFound();

  const access = await getClientAccessState(clientId);
  const currentTier = (d.members[0]?.tier as ClientTier) || 'sprint';

  // Unassigned leads available to hand to this client (bulk handoff #79).
  let unassigned: { auditId: string; company: string; industry: string | null; email: string | null; score: number | null; band: string | null }[] = [];
  try {
    const db = getAvDb();
    const [rows] = await db.execute<UnassignedRow[]>(
      `SELECT audit_id, company, industry, email, ai_score, ai_score_band
         FROM leads
        WHERE client_id IS NULL AND archived_at IS NULL
        ORDER BY (ai_score IS NULL), ai_score DESC, id DESC
        LIMIT 60`
    );
    unassigned = rows.map((r) => ({
      auditId: r.audit_id,
      company: r.company,
      industry: r.industry,
      email: r.email,
      score: r.ai_score == null ? null : Number(r.ai_score),
      band: r.ai_score_band
    }));
  } catch {
    /* non-fatal: panel shows an empty state */
  }

  const icpBits = [
    d.icp.industries.length ? `Industries: ${d.icp.industries.join(', ')}` : null,
    d.icp.geographies.length ? `Locations: ${d.icp.geographies.join(', ')}` : null,
    d.icp.companySizeMin || d.icp.companySizeMax
      ? `Size: ${d.icp.companySizeMin ?? 1}–${d.icp.companySizeMax ?? '∞'}`
      : null
  ].filter(Boolean);

  return (
    <div className="max-w-5xl">
      <div className="text-sm text-muted mb-4">
        <Link href="/admin/av/clients" className="hover:text-ink transition-colors">Clients</Link>
        <span className="mx-1.5">/</span>
        <span className="text-ink">{d.name}</span>
      </div>

      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-semibold">{d.name}</h1>
          <p className="text-sm text-muted mt-1 capitalize">
            {d.planTier} plan{d.industry ? ` · ${d.industry}` : ''}
            {!d.enabled && <span style={{ color: '#fca5a5' }}> · disabled</span>}
          </p>
        </div>
      </div>

      {/* Quick links into this client's brief + dashboard preview. */}
      <div className="flex flex-wrap gap-4 mb-5 text-sm">
        <Link href={`/admin/av/intake?clientId=${clientId}`} className="text-brand hover:underline">Edit full intake →</Link>
        <Link href={`/admin/av/brief?clientId=${clientId}`} className="text-brand hover:underline">Edit creative brief →</Link>
        <Link href={`/admin/av/clients/${clientId}/preview`} className="text-brand hover:underline">Preview their dashboard →</Link>
      </div>

      {/* Intake -> canonical intelligence (one visible-prompt pass). */}
      <div className="mb-5">
        <ExtractIntelButton clientId={clientId} />
      </div>

      {/* Account info editor (name / industry / contact) — no SQL needed. */}
      <AccountInfoEditor
        clientId={clientId}
        initialClientName={d.name}
        initialIndustry={d.industry ?? ''}
        contactEmail={d.members[0]?.email ?? null}
        initialContactName={d.members[0]?.displayName ?? ''}
      />

      {/* Access & tier controls */}
      <AccessControls clientId={clientId} initialState={access} currentTier={currentTier} />

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6">
        {[
          { label: 'Leads in pipeline', value: d.leadCount },
          { label: 'Found this month', value: d.discoveredThisMonth },
          { label: 'Discovery errors logged', value: d.recentErrors.filter((e) => e.status === 'failure').length }
        ].map((s) => (
          <div key={s.label} className="rounded-2xl border border-border bg-surface p-4">
            <div className="text-2xl font-semibold text-ink tabular-nums">{s.value}</div>
            <div className="text-[11px] uppercase tracking-[0.12em] text-muted mt-1">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Account holders + ICP */}
      <div className="grid sm:grid-cols-2 gap-3 mb-6">
        <div className="rounded-2xl border border-border bg-surface p-4">
          <div className="text-[11px] uppercase tracking-[0.12em] text-muted mb-2">Account</div>
          {d.members.length === 0 ? (
            <p className="text-sm text-muted">No users on this account.</p>
          ) : (
            <ul className="space-y-1.5">
              {d.members.map((m) => (
                <li key={m.email} className="text-sm">
                  <span className="text-ink">{m.displayName || m.email}</span>
                  <span className="text-muted text-xs"> · {m.tier}{m.lastLoginAt ? ` · last in ${m.lastLoginAt.slice(0, 10)}` : ''}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="rounded-2xl border border-border bg-surface p-4">
          <div className="text-[11px] uppercase tracking-[0.12em] text-muted mb-2">Their ICP</div>
          {icpBits.length === 0 ? (
            <p className="text-sm text-muted">No ideal-client profile set yet.</p>
          ) : (
            <ul className="text-sm text-ink space-y-1">
              {icpBits.map((b) => <li key={b}>{b}</li>)}
            </ul>
          )}
          {d.icp.description && <p className="text-xs text-muted mt-2 leading-relaxed">{d.icp.description}</p>}
        </div>
      </div>

      {/* Discovery activity / errors */}
      <div className="rounded-2xl border border-border bg-surface p-4 mb-6">
        <div className="text-[11px] uppercase tracking-[0.12em] text-muted mb-3">Discovery activity (operator-only)</div>
        {d.recentErrors.length === 0 ? (
          <p className="text-sm text-muted">No discovery errors logged. All clean.</p>
        ) : (
          <ul className="space-y-2">
            {d.recentErrors.map((e, i) => (
              <li key={i} className="flex items-start gap-3 text-sm">
                <span
                  className="mt-1 inline-block w-2 h-2 rounded-full shrink-0"
                  style={{ background: e.status === 'failure' ? '#fca5a5' : '#6ee7b7' }}
                  aria-hidden="true"
                />
                <div className="min-w-0">
                  <div className="text-ink">
                    {e.stage ? <span className="uppercase text-[10px] tracking-[0.12em] text-muted mr-2">{e.stage}</span> : null}
                    {e.message || (e.status === 'failure' ? 'Discovery error' : 'Discovery run')}
                  </div>
                  {e.at && <div className="text-[11px] text-muted">{e.at.replace('T', ' ').slice(0, 16)}</div>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Bulk lead handoff: assign unassigned prospects to this client. */}
      <AssignLeadsPanel clientId={clientId} clientName={d.name} leads={unassigned} />

      {/* Their pipeline */}
      <div className="rounded-2xl border border-border bg-surface p-4">
        <div className="text-[11px] uppercase tracking-[0.12em] text-muted mb-3">Their pipeline</div>
        {d.leads.length === 0 ? (
          <p className="text-sm text-muted">No leads yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {d.leads.slice(0, 30).map((l) => (
              <li key={l.id} className="py-2 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm text-ink truncate">{l.company}</div>
                  <div className="text-[11px] text-muted">{l.industry || '—'}{l.contactName ? ` · ${l.contactName}` : ''}</div>
                </div>
                <div className="text-sm tabular-nums text-ink shrink-0">
                  {l.score !== null ? Math.round(l.score) : '—'}
                  {l.band && <span className="text-[10px] uppercase tracking-[0.12em] text-muted ml-2">{l.band}</span>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
