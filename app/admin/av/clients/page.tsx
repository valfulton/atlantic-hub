import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { fetchCockpitClients, relativeTime, type CockpitClient } from '@/lib/av/cockpit';
import { getAvDb } from '@/lib/db/av';
import { formatUsd } from '@/lib/sales/deal_model';
import NewClientForm from './NewClientForm';
import ConvertLeadToClient from './ConvertLeadToClient';
import MiniStageStrip from './MiniStageStrip';
import { loadOnboardingStatus, type OnboardingStatus } from '@/lib/av/onboarding_status';
import { spendByClientLastDays, totalSpendLastDays } from '@/lib/llm/spend';
import { CostBadge } from '@/app/_components/CostBadge';
import type { RowDataPacket } from 'mysql2';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface ConvertibleRow extends RowDataPacket {
  audit_id: string;
  company: string;
  contact_name: string | null;
  email: string;
  industry: string | null;
  ai_score: number | string | null;
  ai_score_band: string | null;
}

/**
 * /admin/av/clients -- operator-only roster of every client hub.
 *
 * Cross-client cockpit: each client runs their own scoped hub; here the
 * operator sees them all, with lead counts, this-month discovery, and an
 * error flag (errors clients never see). Click through for the detail.
 */
export default async function ClientsPage() {
  const role = headers().get('x-ah-user-role') as 'owner' | 'staff' | 'client_user' | null;
  if (role === 'client_user') redirect('/admin');

  let clients: CockpitClient[] = [];
  let failed = false;
  try {
    clients = await fetchCockpitClients();
  } catch {
    failed = true;
  }

  // (val 2026-06-02) Cross-client roll-up: compute the 13-stage onboarding
  // status for every client in parallel so the table renders a mini-strip
  // per row. Soft-fail per client — a missing brief on one row shouldn't
  // blank the whole table.
  const onboardingByClient: Map<number, OnboardingStatus> = new Map();
  await Promise.all(
    clients.map(async (c) => {
      try {
        const s = await loadOnboardingStatus(c.clientId);
        onboardingByClient.set(c.clientId, s);
      } catch {
        /* leave unset; row will fall back to '—' */
      }
    })
  );

  // (#367) LLM spend rollup — per-client over 30d + tenant-wide total over 30d.
  // Cheap aggregate queries; both auto-hide under Presentation Mode in the UI.
  const [spendByClient, totalSpend] = await Promise.all([
    spendByClientLastDays(30),
    totalSpendLastDays(30)
  ]);

  // Active leads available to convert into a client (no retyping — their info carries over).
  let convertible: { auditId: string; company: string; contactName: string | null; email: string; industry: string | null; score: number | null; band: string | null }[] = [];
  try {
    const db = getAvDb();
    const [rows] = await db.execute<ConvertibleRow[]>(
      `SELECT audit_id, company, contact_name, email, industry, ai_score, ai_score_band
         FROM leads
        WHERE archived_at IS NULL AND email IS NOT NULL AND email <> ''
          AND lead_status NOT IN ('converted', 'lost')
        ORDER BY (ai_score IS NULL), ai_score DESC, id DESC
        LIMIT 200`
    );
    convertible = rows.map((r) => ({
      auditId: r.audit_id,
      company: r.company,
      contactName: r.contact_name,
      email: r.email,
      industry: r.industry,
      score: r.ai_score == null ? null : Number(r.ai_score),
      band: r.ai_score_band
    }));
  } catch {
    /* non-fatal: convert picker shows an empty state */
  }

  return (
    <div className="max-w-5xl">
      <div className="flex items-center justify-between gap-3 mb-1 flex-wrap">
        <h1 className="text-3xl font-semibold tracking-tight">Clients</h1>
        {/* (#367) Tenant-wide LLM spend over the last 30 days. CostBadge auto-hides
            under Presentation Mode so this disappears on investor demos. */}
        <div className="flex items-center gap-2 text-[11px] text-muted">
          <span className="uppercase tracking-[0.14em]">LLM 30d</span>
          <CostBadge microcents={totalSpend.liveMicrocents} />
          {totalSpend.cacheHitCount > 0 && (
            <span className="text-emerald-300">+ {totalSpend.cacheHitCount} cache hits</span>
          )}
        </div>
      </div>
      <p className="text-sm text-muted mb-6 max-w-2xl">
        Every client hub. Each client runs their own scoped pipeline; you see them all here. Open one to
        review their leads, discovery activity, and any errors.
      </p>

      <div className="flex flex-wrap items-start">
        <NewClientForm />
        <ConvertLeadToClient leads={convertible} />
      </div>

      {failed ? (
        <div className="rounded-2xl border border-border bg-surface p-6 text-muted">Could not load clients right now.</div>
      ) : clients.length === 0 ? (
        <div className="rounded-2xl border border-border bg-surface p-6">
          <p className="text-ink font-medium">No client accounts yet.</p>
          <p className="text-muted text-sm mt-1">Client hubs are created automatically when a client signs in.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border bg-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-[0.12em] text-muted border-b border-border">
                <th className="px-4 py-3 font-medium">Client</th>
                <th className="px-4 py-3 font-medium" title="13-stage onboarding — green=done, amber=needs you, dim=not started. Hover dots for detail.">
                  Onboarding
                </th>
                <th className="px-4 py-3 font-medium text-right">Hot fits</th>
                <th className="px-4 py-3 font-medium text-right">Total leads</th>
                <th className="px-4 py-3 font-medium text-right">Pipeline / mo</th>
                <th className="px-4 py-3 font-medium text-right" title="LLM spend on this client over the last 30 days. Cache hits cost $0.">
                  LLM&nbsp;30d
                </th>
                <th className="px-4 py-3 font-medium text-right" title="Last weekly digest sent">
                  Last digest
                </th>
                <th className="px-4 py-3 font-medium text-right">Errors&nbsp;30d</th>
              </tr>
            </thead>
            <tbody>
              {clients.map((c) => (
                <tr key={c.clientId} className="border-b border-border last:border-0 hover:bg-white/5 transition-colors">
                  <td className="px-4 py-3 align-top">
                    <Link href={`/admin/av/clients/${c.clientId}`} className="text-ink hover:text-brand no-underline font-medium">
                      {c.name}
                    </Link>
                    <div className="text-[11px] text-muted capitalize">
                      {c.planTier}
                      {c.industry ? ` · ${c.industry}` : ''}
                      {!c.enabled && <span style={{ color: '#fca5a5' }}> · disabled</span>}
                    </div>
                    <Link href={`/admin/av/clients/${c.clientId}/preview`} className="text-[11px] text-brand hover:underline">
                      Preview their dashboard →
                    </Link>
                  </td>

                  {/* (val 2026-06-02) Mini stage strip — 13 dots showing
                      onboarding state, hover for per-stage details. Click row
                      for the full StageStrip + Prep button on the detail page. */}
                  <td className="px-4 py-3 align-middle">
                    {onboardingByClient.has(c.clientId) ? (
                      <MiniStageStrip
                        stages={onboardingByClient.get(c.clientId)!.stages}
                        doneCount={onboardingByClient.get(c.clientId)!.doneCount}
                        totalCount={onboardingByClient.get(c.clientId)!.totalCount}
                      />
                    ) : (
                      <span className="text-muted text-xs">—</span>
                    )}
                  </td>

                  <td className="px-4 py-3 text-right align-top tabular-nums">
                    {c.hotFitCount > 0 ? (
                      <span style={{ color: '#fcd34d', fontWeight: 600 }}>{c.hotFitCount}</span>
                    ) : (
                      <span className="text-muted">0</span>
                    )}
                  </td>

                  <td className="px-4 py-3 text-right align-top tabular-nums text-ink">
                    {c.leadCount}
                    {c.discoveredThisMonth > 0 && (
                      <div className="text-[10.5px] text-muted">
                        +{c.discoveredThisMonth} this month
                      </div>
                    )}
                  </td>

                  <td className="px-4 py-3 text-right align-top tabular-nums">
                    {c.pipelineCents && c.pipelineCents > 0 ? (
                      <span style={{ color: '#FFC73D', fontWeight: 600 }}>{formatUsd(c.pipelineCents)}</span>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>

                  {/* (#367) LLM spend on this client over the last 30 days. */}
                  <td className="px-4 py-3 text-right align-top tabular-nums">
                    {spendByClient.has(c.clientId) ? (
                      <div className="flex items-center justify-end gap-1.5">
                        <CostBadge microcents={spendByClient.get(c.clientId)!.liveMicrocents} />
                        {spendByClient.get(c.clientId)!.cacheHitCount > 0 && (
                          <span className="text-[10px] text-emerald-300">
                            +{spendByClient.get(c.clientId)!.cacheHitCount} cache
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>

                  <td className="px-4 py-3 text-right align-top text-[11px] tabular-nums">
                    {c.lastDigestSentAt ? (
                      <span className="text-muted">{relativeTime(c.lastDigestSentAt)}</span>
                    ) : (
                      <span style={{ color: '#fcd34d' }}>never</span>
                    )}
                  </td>

                  <td className="px-4 py-3 text-right align-top tabular-nums">
                    {c.recentErrorCount > 0 ? (
                      <span style={{ color: '#fca5a5' }}>{c.recentErrorCount}</span>
                    ) : (
                      <span className="text-muted">0</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
