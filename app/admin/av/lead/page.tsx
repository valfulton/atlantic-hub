/**
 * /admin/av/lead — entry point for the "leads that dont suck ass" view.
 *
 * This is the doorway val asked for from the start and I missed. A sidebar
 * link lands here. This page lists recent leads with their company name +
 * score, and each one links to the NEW minimal lead detail page at
 * /admin/av/lead/[audit_id]. So she can peek at the new view side-by-side
 * with the old cockpit (/admin/av) without redirecting any of her existing
 * workflow.
 *
 * Deliberately small. No filters, no fancy table, no controls — just the
 * 50 most recent active leads. The cockpit is for filtering and bulk work;
 * this page is for peeking.
 */
import Link from 'next/link';
import { getAvDb } from '@/lib/db/av';
import type { RowDataPacket } from 'mysql2';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface LeadRow extends RowDataPacket {
  audit_id: string;
  company: string | null;
  industry: string | null;
  ai_score: number | null;
  ai_combined_score: number | null;
  ai_score_band: string | null;
  lead_status: string | null;
  submission_date: string | null;
}

async function recentLeads(): Promise<LeadRow[]> {
  try {
    const db = getAvDb();
    const [rows] = await db.execute<LeadRow[]>(
      `SELECT audit_id, company, industry, ai_score, ai_combined_score,
              ai_score_band, lead_status, submission_date
         FROM leads
        WHERE archived_at IS NULL
        ORDER BY last_activity_at DESC, submission_date DESC
        LIMIT 50`
    );
    return rows;
  } catch (err) {
    console.error('[lead-index]', (err as Error).message);
    return [];
  }
}

const BAND_LABEL: Record<string, string> = {
  hot: 'HOT',
  warm: 'WARM',
  cool: 'COOL'
};

export default async function NewLeadIndexPage() {
  const leads = await recentLeads();

  return (
    <div className="max-w-4xl">
      <header className="mb-6">
        <h1 className="text-3xl font-semibold text-ink leading-tight">
          Leads (new view)
        </h1>
        <p className="mt-2 text-base text-muted leading-relaxed max-w-2xl">
          A side-by-side preview of the new readable lead page — bigger labels,
          one column, edit fields in place. Pick any lead below to open it in
          the new view. Your normal cockpit at{' '}
          <Link href="/admin/av" className="text-brand hover:underline">
            /admin/av
          </Link>{' '}
          is unchanged and still works the same way.
        </p>
      </header>

      {leads.length === 0 ? (
        <div className="bg-surface border border-border rounded-xl p-6 text-base text-muted">
          No active leads yet. Once leads exist they&apos;ll show here.
        </div>
      ) : (
        <ul className="bg-surface border border-border rounded-xl divide-y divide-border overflow-hidden">
          {leads.map((l) => {
            const score = l.ai_combined_score ?? l.ai_score;
            const band = l.ai_score_band ? BAND_LABEL[l.ai_score_band] || l.ai_score_band.toUpperCase() : null;
            return (
              <li key={l.audit_id}>
                <Link
                  href={`/admin/av/lead/${l.audit_id}`}
                  className="flex items-center justify-between gap-4 px-5 py-4 hover:bg-[var(--surface-2)] transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-base font-medium text-ink break-words">
                      {l.company || <span className="text-muted italic">Untitled lead</span>}
                    </div>
                    <div className="mt-1 text-sm text-muted">
                      {l.industry || 'no industry'}
                      {l.lead_status && ` · ${l.lead_status.replace(/_/g, ' ')}`}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    {score != null && (
                      <span className="text-base font-semibold text-ink">{score}</span>
                    )}
                    {band && (
                      <span className="text-sm font-medium uppercase tracking-wide text-muted">
                        {band}
                      </span>
                    )}
                    <span className="text-sm text-muted">→</span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
