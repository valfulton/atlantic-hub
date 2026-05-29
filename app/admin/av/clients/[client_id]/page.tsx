import { headers } from 'next/headers';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { getClientAccountDetail } from '@/lib/av/clients_overview';
import { getClientAccessState } from '@/lib/av/client_access';
import { getAvDb } from '@/lib/db/av';
import AccessControls from './AccessControls';
import AccountInfoEditor from './AccountInfoEditor';
import ExtractIntelButton from './ExtractIntelButton';
import MagicLinkButton from './MagicLinkButton';
import PortalAccessToggle from './PortalAccessToggle';
import PrefilledIntakeLink from './PrefilledIntakeLink';
import FindLeadsForClient from './FindLeadsForClient';
import IcpEditor from './IcpEditor';
import EnrichClientLeadsButton from './EnrichClientLeadsButton';
import RefreshIntelPanel from './RefreshIntelPanel';
import { ClientPrPanel } from './ClientPrPanel';
import { getBriefPayload } from '@/lib/client/brief_store';
import { getClientIcpWithProvenance } from '@/lib/client/icp';
import { signIntakeShareToken } from '@/lib/auth/intake-share';
import ClientPipelineList from './ClientPipelineList';
import AssignLeadsPanel from './AssignLeadsPanel';
import ReleaseLeadsPanel from './ReleaseLeadsPanel';
import AddBrandPanel from './AddBrandPanel';
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
  const { icp, provenance: icpProvenance } = await getClientIcpWithProvenance(clientId);
  const currentTier = (d.members[0]?.tier as ClientTier) || 'sprint';

  // Intake-gate state for the toggle: the operator override (portal_full_access)
  // AND whether the client completed their own intake (client_completed_at). EITHER
  // unlocks the hub, so the badge must reflect both — not just the override.
  let portalFullAccess = false;
  let intakeCompleted = false;
  try {
    const bp = (await getBriefPayload('av', clientId)) as Record<string, unknown> | null;
    portalFullAccess = bp?.portal_full_access === true;
    const stamp = bp?.client_completed_at;
    intakeCompleted = typeof stamp === 'string' && stamp.trim().length > 0;
  } catch { /* default: intake required */ }

  // Prefilled-intake share link -> the live website intake form, prefilled via token.
  const intakeShareUrl = `https://atlanticandvine.netlify.app/client-intake?t=${await signIntakeShareToken(clientId)}`;

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
        <Link href={`/admin/av/clients/${clientId}/intelligence`} className="text-brand hover:underline">Intelligence inventory →</Link>
        <Link href={`/admin/av/clients/${clientId}/timeline`} className="text-brand hover:underline">Activity timeline →</Link>
      </div>

      {/* No-login prefilled intake link — the "just send it" link. */}
      <PrefilledIntakeLink url={intakeShareUrl} />

      {/* Generate / re-issue this client's magic-link (full portal login). */}
      <div className="mb-5">
        <MagicLinkButton clientId={clientId} />
      </div>

      {/* Intake -> canonical intelligence (one visible-prompt pass). */}
      <div className="mb-5">
        <ExtractIntelButton clientId={clientId} />
      </div>

      {/* Multi-brand (#101): give this same login another brand (e.g. Adriana's CBB + CLDA). */}
      <AddBrandPanel clientId={clientId} ownerName={d.members[0]?.displayName || d.name} />

      {/* Account info editor (name / industry / contact) — no SQL needed. */}
      <AccountInfoEditor
        clientId={clientId}
        initialClientName={d.name}
        initialIndustry={d.industry ?? ''}
        contactEmail={d.members[0]?.email ?? null}
        initialContactName={d.members[0]?.displayName ?? ''}
      />

      {/* Intake gate override: grant full portal access, or require intake first. */}
      <PortalAccessToggle clientId={clientId} initialFullAccess={portalFullAccess} intakeCompleted={intakeCompleted} />

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

      {/* Editable ICP — who discovery targets (fix off-target leads, exclude noise). */}
      <IcpEditor clientId={clientId} initial={icp} provenance={icpProvenance} />

      {/* Find leads scoped to THIS client (their hub only — never the AV pipeline). */}
      <FindLeadsForClient clientId={clientId} clientName={d.name} />

      {/* (#213 Part A) Their PR pipeline -- opportunities matched to this
          client's leads. Was previously only visible in the global PR inbox. */}
      <ClientPrPanel clientId={clientId} clientName={d.name} />

      {/* Bulk lead handoff: assign unassigned prospects to this client. */}
      <AssignLeadsPanel clientId={clientId} clientName={d.name} leads={unassigned} />

      {/* Bulk take-back: return this client's leads to the house pipeline (#96).
          Ownership flips only; enrichment/scores/audits stay on the lead. */}
      <ReleaseLeadsPanel
        clientId={clientId}
        clientName={d.name}
        leads={d.leads
          .filter((l): l is typeof l & { auditId: string } => typeof l.auditId === 'string' && l.auditId.length > 0)
          .map((l) => ({
            auditId: l.auditId,
            company: l.company,
            industry: l.industry,
            contactName: l.contactName,
            score: l.score,
            band: l.band
          }))}
      />

      {/* Enrich this client's leads on their behalf (Hunter contact details). */}
      <EnrichClientLeadsButton clientId={clientId} clientName={d.name} />

      {/* (#203) Force-regenerate AI intel for this client's leads (replaces
          phpMyAdmin SQL pattern). Audits + call scripts + outreach drafts. */}
      <RefreshIntelPanel clientId={clientId} clientName={d.name} />

      {/* Their pipeline — with per-row Delete to clear strays. */}
      <div className="rounded-2xl border border-border bg-surface p-4">
        <div className="text-[11px] uppercase tracking-[0.12em] text-muted mb-3">Their pipeline</div>
        <ClientPipelineList
          clientId={clientId}
          leads={d.leads.slice(0, 30).map((l) => ({
            id: l.id,
            auditId: l.auditId,
            company: l.company,
            industry: l.industry,
            contactName: l.contactName,
            score: l.score,
            band: l.band
          }))}
        />
      </div>
    </div>
  );
}
