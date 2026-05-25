import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { listClientAccounts, type ClientAccountSummary } from '@/lib/av/clients_overview';
import { getAvDb } from '@/lib/db/av';
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

  let clients: ClientAccountSummary[] = [];
  let failed = false;
  try {
    clients = await listClientAccounts();
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
                <th className="px-4 py-3 font-medium">Plan</th>
                <th className="px-4 py-3 font-medium text-right">Leads</th>
                <th className="px-4 py-3 font-medium text-right">Found this month</th>
                <th className="px-4 py-3 font-medium text-right">Errors (30d)</th>
              </tr>
            </thead>
            <tbody>
              {clients.map((c) => (
                <tr key={c.clientId} className="border-b border-border last:border-0 hover:bg-white/5 transition-colors">
                  <td className="px-4 py-3">
                    <Link href={`/admin/av/clients/${c.clientId}`} className="text-ink hover:text-brand no-underline font-medium">
                      {c.name}
                    </Link>
                    <div className="text-[11px] text-muted">
                      {c.industry || c.slug}
                      {!c.enabled && <span style={{ color: '#fca5a5' }}> · disabled</span>}
                    </div>
                    <Link href={`/admin/av/clients/${c.clientId}/preview`} className="text-[11px] text-brand hover:underline">
                      Preview their dashboard →
                    </Link>
                  </td>
                  <td className="px-4 py-3 capitalize text-muted">{c.planTier}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-ink">{c.leadCount}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-ink">{c.discoveredThisMonth}</td>
                  <td className="px-4 py-3 text-right tabular-nums">
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
