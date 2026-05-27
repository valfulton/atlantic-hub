/**
 * /admin/av/clients/[client_id]/preview
 *
 * OPERATOR-ONLY preview of what a client sees on their dashboard, for a given
 * client_id — WITHOUT the client logging in. Solves the chicken-and-egg: val can
 * perfect a client's dashboard before sending their magic link.
 *
 * Read-only and safe: it reuses the same data function as the real client
 * dashboard (getClientCreativeBrief) scoped by client_id, plus the audit query,
 * and the same presentational CreativeBrief component. It does NOT touch the live
 * /client/dashboard page or any client auth.
 *
 * NOTE: this lives under [client_id] (param name client_id) to match the sibling
 * client-detail route — Next.js forbids two different slug names at one path level.
 */
import { headers } from 'next/headers';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { getAvDb } from '@/lib/db/av';
import { getClientCreativeBrief, type CreativeBrief as CreativeBriefData } from '@/lib/client/brief';
import CreativeBrief from '@/app/client/_components/CreativeBrief';
import WaveDivider from '@/app/_components/WaveDivider';
import type { RowDataPacket } from 'mysql2';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface ClientRow extends RowDataPacket { client_name: string | null }
interface MemberRow extends RowDataPacket { email: string; display_name: string | null }
interface AuditRow extends RowDataPacket {
  company: string | null;
  audit_content: string | null;
  audit_generated: Date | null;
  created_at: Date | null;
}

function auditPreview(text: string | null, maxChars = 480): string {
  if (!text) return '';
  const t = text.trim().replace(/\r\n/g, '\n');
  return t.length <= maxChars ? t : t.slice(0, maxChars).replace(/\s+\S*$/, '') + '...';
}

export default async function ClientDashboardPreview({ params }: { params: { client_id: string } }) {
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

  // A representative member (for the email-scoped fallbacks the brief uses).
  const [mrows] = await db.execute<MemberRow[]>(
    `SELECT email, display_name FROM client_users WHERE client_id = ? ORDER BY client_user_id ASC LIMIT 1`,
    [clientId]
  );
  const email = mrows[0]?.email ?? '';
  const firstName = (mrows[0]?.display_name || clientName).split(/[ ,]/)[0] || 'there';

  let brief: CreativeBriefData = { activeLines: [], nextLeads: [], awaitingApproval: [], awaitingCount: 0, pipeline: { total: 0, hot: 0, warm: 0, cool: 0 } };
  try {
    brief = await getClientCreativeBrief({ client_id: clientId, email });
  } catch { /* keep empty */ }

  // Mirror the real client dashboard exactly: the client's OWN business audit is
  // the lead matching THEIR email, never a prospect scoped to their hub (client_id).
  // (Previously this matched client_id and showed a prospect's audit — e.g. Carrier
  // HVAC — as the client's own. See the matching fix in /client/dashboard.)
  let audit: AuditRow | null = null;
  if (email) {
    const [auditRows] = await db.execute<AuditRow[]>(
      `SELECT company, audit_content, audit_generated, created_at
         FROM leads
        WHERE archived_at IS NULL AND audit_content IS NOT NULL AND email = ?
        ORDER BY COALESCE(audit_generated, created_at) DESC
        LIMIT 1`,
      [email]
    );
    audit = auditRows[0] ?? null;
  }

  return (
    <div>
      {/* Operator preview banner — clearly not the client's own login. */}
      <div className="mb-4 rounded-lg border border-amber-400/40 bg-amber-400/10 px-4 py-2.5 text-sm text-amber-200 flex items-center justify-between gap-3">
        <span>
          <span className="font-semibold">Operator preview</span> — this is what{' '}
          <span className="font-semibold">{clientName}</span> sees on their dashboard. Read-only.
        </span>
        <span className="shrink-0 flex items-center gap-4">
          <Link href={`/admin/av/brief?clientId=${clientId}`} className="text-amber-100 hover:underline">Edit creative brief →</Link>
          <Link href={`/admin/av/clients/${clientId}`} className="text-amber-100 hover:underline">Back to client</Link>
        </span>
      </div>

      <main className="max-w-6xl mx-auto">
        <section
          className="mb-8 rounded-2xl border border-border overflow-hidden"
          style={{ background: 'radial-gradient(120% 140% at 0% 0%, rgba(245,158,11,0.10), transparent 55%), linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.01))' }}
        >
          <div className="px-6 sm:px-8 py-7">
            <div className="text-[10px] uppercase tracking-[0.22em] text-brand mb-2">Your campaign, live</div>
            <h1 className="text-2xl sm:text-3xl font-semibold text-ink tracking-tight">Welcome back, {firstName}.</h1>
            <WaveDivider className="mt-3" width={120} />
            <div className="mt-5 flex flex-wrap items-end gap-x-8 gap-y-3">
              <div>
                <div className="text-[10px] uppercase tracking-[0.18em] text-muted mb-1">Live pipeline</div>
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl sm:text-4xl font-semibold text-ink leading-none">{brief.pipeline.total}</span>
                  <span className="text-sm text-muted">{brief.pipeline.total === 1 ? 'lead' : 'leads'} in play</span>
                </div>
              </div>
              {brief.pipeline.total > 0 && (
                <div className="flex items-center gap-4 text-sm">
                  {brief.pipeline.hot > 0 && <span className="text-rose-300"><span className="font-semibold">{brief.pipeline.hot}</span> hot</span>}
                  {brief.pipeline.warm > 0 && <span className="text-amber-300"><span className="font-semibold">{brief.pipeline.warm}</span> warm</span>}
                  {brief.pipeline.cool > 0 && <span className="text-sky-300"><span className="font-semibold">{brief.pipeline.cool}</span> cool</span>}
                </div>
              )}
            </div>
            {brief.pipeline.total === 0 && (
              <p className="text-muted text-sm mt-4 max-w-xl leading-relaxed">
                No leads in their pipeline yet — assign prospects to this client from any lead&apos;s
                &quot;Client&quot; dropdown, and they&apos;ll appear here.
              </p>
            )}
          </div>
        </section>

        <CreativeBrief brief={brief} firstName={firstName} leadsHref={`/admin/av/clients/${clientId}`} />

        <section className="mb-8 rounded-2xl border border-border bg-surface p-6">
          <div className="text-[10px] uppercase tracking-[0.16em] text-muted">Strategic Marketing Audit</div>
          <h2 className="text-lg font-semibold text-ink mt-1">{audit?.company || clientName}</h2>
          {audit ? (
            <div className="text-sm text-ink whitespace-pre-line leading-relaxed mt-3">{auditPreview(audit.audit_content)}</div>
          ) : (
            <div className="text-sm text-muted mt-3">No audit generated for this client yet.</div>
          )}
        </section>
      </main>
    </div>
  );
}
