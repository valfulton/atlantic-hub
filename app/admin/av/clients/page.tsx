import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { fetchCockpitClients, relativeTime, type CockpitClient } from '@/lib/av/cockpit';
import { getAvDb } from '@/lib/db/av';
import { formatUsd } from '@/lib/sales/deal_model';
import NewClientForm from './NewClientForm';
import ConvertLeadToClient from './ConvertLeadToClient';
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
      <h1 className="text-3xl font-semibold tracking-tight mb-1">Clients</h1>
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
                <th className="px-4 py-3 font-medium text-center" title="ICP populated · Brand kit set">
                  Autopilot
                </th>
                <th className="px-4 py-3 font-medium text-right">Hot fits</th>
                <th className="px-4 py-3 font-medium text-right">Total leads</th>
                <th className="px-4 py-3 font-medium text-right">Pipeline / mo</th>
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

                  {/* Autopilot health: two tiny chips, ICP and Brand kit. */}
                  <td className="px-4 py-3 align-top">
                    <div className="flex items-center justify-center gap-1.5">
                      <span
                        title={c.icpPopulated ? 'ICP populated' : 'ICP empty — Sharpen from intake'}
                        className="inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9.5px] font-medium uppercase tracking-wider"
                        style={
                          c.icpPopulated
                            ? { borderColor: 'rgba(110,231,183,0.4)', background: 'rgba(110,231,183,0.10)', color: '#6ee7b7' }
                            : { borderColor: 'rgba(255,154,168,0.4)', background: 'rgba(255,154,168,0.08)', color: '#FF9AA8' }
                        }
                      >
                        ICP
                      </span>
                      <span
                        title={c.brandKitSet ? 'Brand kit extracted' : 'Brand kit empty — Extract brand kit'}
                        className="inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9.5px] font-medium uppercase tracking-wider"
                        style={
                          c.brandKitSet
                            ? { borderColor: 'rgba(167,139,250,0.4)', background: 'rgba(167,139,250,0.10)', color: '#c4b5fd' }
                            : { borderColor: 'rgba(255,154,168,0.4)', background: 'rgba(255,154,168,0.08)', color: '#FF9AA8' }
                        }
                      >
                        Brand
                      </span>
                    </div>
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
