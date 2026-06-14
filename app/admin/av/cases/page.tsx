/**
 * /admin/av/cases  (val 2026-06-11)
 *
 * Operator-only universal case index. Lists every open case across every
 * client. Each row links to /admin/av/clients/[client_id]/cases/[caseId]
 * for the full case dashboard.
 *
 * Anchor case: Johnson family Home-Ranch Trust dispute. The list is
 * client-agnostic — Ron's defense_pr cases, John's political_campaign
 * legal matters, Adriana's CLDA cases, and Johnson family cases all
 * surface here when they have a cases row.
 */
import Link from 'next/link';
import { listAllOpenCases } from '@/lib/case/case_store';
import { getAvDb } from '@/lib/db/av';
import type { RowDataPacket } from 'mysql2';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Cases (all clients) · Atlantic & Vine'
};

interface ClientNameRow extends RowDataPacket {
  client_id: number;
  client_name: string;
  short_name: string | null;
}

async function getClientNameMap(clientIds: number[]): Promise<Map<number, { name: string; shortName: string | null }>> {
  const map = new Map<number, { name: string; shortName: string | null }>();
  if (!clientIds.length) return map;
  try {
    const db = getAvDb();
    const placeholders = clientIds.map(() => '?').join(',');
    const [rows] = await db.execute<ClientNameRow[]>(
      `SELECT client_id, client_name, short_name FROM clients WHERE client_id IN (${placeholders})`,
      clientIds
    );
    for (const r of rows) {
      map.set(r.client_id, { name: r.client_name, shortName: r.short_name });
    }
  } catch (err) {
    console.error('getClientNameMap failed', err);
  }
  return map;
}

function caseKindLabel(k: string): string {
  switch (k) {
    case 'trust_dispute': return 'Trust dispute';
    case 'elder_advocacy': return 'Elder advocacy';
    case 'estate_litigation': return 'Estate litigation';
    case 'malpractice_defense': return 'Malpractice defense';
    case 'campaign_legal': return 'Campaign legal';
    case 'guardianship': return 'Guardianship';
    case 'family_law': return 'Family law';
    case 'business_litigation': return 'Business litigation';
    case 'general_litigation':
    default:
      return 'General litigation';
  }
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return iso.slice(0, 10);
  }
}

export default async function OperatorCasesIndexPage() {
  const cases = await listAllOpenCases();
  const clientIds = Array.from(new Set(cases.map((c) => c.clientId)));
  const clientMap = await getClientNameMap(clientIds);

  // (val 2026-06-14) Return a content div, NOT a main — the shared operator
  // layout (app/admin/layout.tsx) already provides the main element + the flex
  // row with the left Sidebar. A nested main with min-h-screen + a full surface
  // bg broke the flex and hid the sidebar ("where's the rest of the navigation?").
  return (
    <div className="text-ink">
      <div className="max-w-6xl mx-auto">
        <header className="mb-8">
          <div className="text-[11px] tracking-[0.18em] uppercase text-muted mb-2">
            Atlantic &amp; Vine · Operator catalog
          </div>
          <h1 className="text-3xl font-medium mb-3" style={{ fontFamily: 'Fraunces, Cormorant Garamond, Georgia, serif' }}>
            Cases
          </h1>
          <p className="text-sm text-muted max-w-2xl">
            Every open case across every client. Trust disputes, defense PR matters, political-campaign legal,
            elder advocacy, and any other legal-needs engagement live here. Click a row for the full case dashboard.
          </p>
        </header>

        {cases.length === 0 ? (
          <div className="rounded-xl border border-border bg-[var(--surface-2)] p-8 text-center">
            <div className="text-muted">No open cases yet.</div>
            <div className="text-xs text-muted mt-2">
              Cases get created from /admin/av/clients/[client_id] → "Open a case".
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-[var(--surface-2)] overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-[var(--surface-3)] text-left text-xs uppercase tracking-wider text-muted">
                <tr>
                  <th className="px-4 py-3">Client</th>
                  <th className="px-4 py-3">Case</th>
                  <th className="px-4 py-3">Kind</th>
                  <th className="px-4 py-3">Opened</th>
                  <th className="px-4 py-3">Wellness</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {cases.map((c) => {
                  const clientInfo = clientMap.get(c.clientId);
                  const clientLabel = clientInfo?.shortName || clientInfo?.name || `Client #${c.clientId}`;
                  return (
                    <tr key={c.caseId} className="hover:bg-[var(--surface-3)] transition-colors">
                      <td className="px-4 py-3">
                        <Link
                          href={`/admin/av/clients/${c.clientId}`}
                          className="text-ink hover:text-brand"
                        >
                          {clientLabel}
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <Link
                          href={`/admin/av/clients/${c.clientId}/cases/${c.caseId}`}
                          className="text-brand hover:underline font-medium"
                        >
                          {c.caseName}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-muted">{caseKindLabel(c.caseKind)}</td>
                      <td className="px-4 py-3 text-muted">{formatDate(c.openedAt)}</td>
                      <td className="px-4 py-3 text-xs">
                        {c.wellnessEnabled ? (
                          <span className="inline-block px-2 py-0.5 rounded-md bg-emerald-900/30 text-emerald-300 border border-emerald-700/40">
                            Family wellness on
                          </span>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
