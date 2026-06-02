// OPERATOR-ONLY — reachable only via operator/investor surfaces, never public/client nav (by design).
// Absence from nav is intentional, not abandonment. Do NOT delete in a dead-code sweep.
// See Atlantic_Hub_Playbook/Hidden_Pages_Audit.md (PR A).

/**
 * /admin/av/integrations/clay
 *
 * Operator status page for the Clay enrichment webhook.
 *
 * Surfaces:
 *   - The webhook URL the operator pastes into Clay (with copy button).
 *   - Setup instructions including the X-Webhook-Secret header detail.
 *   - Outcome distribution (last 7 days + all time).
 *   - Last 50 received rows with outcome, lead id, table id, error preview.
 *
 * Auth: server-rendered, role gate via x-ah-user-role header (set by
 * middleware). Owner + staff only -- client_user redirected to /admin.
 *
 * Data fetched in-component (no extra API route) -- this is read-only
 * operator triage, not a public surface.
 */
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type { RowDataPacket } from 'mysql2';
import { getAvDb } from '@/lib/db/av';
import { CopyButton } from './CopyButton';

export const dynamic = 'force-dynamic';

type Outcome = 'inserted' | 'updated' | 'duplicate' | 'invalid' | 'error';

interface OutcomeRow extends RowDataPacket {
  outcome: Outcome;
  n: number;
}

interface ClayLogRow extends RowDataPacket {
  id: number;
  received_at: string;
  clay_table_id: string | null;
  clay_row_id: string | null;
  lead_id: number | null;
  outcome: Outcome;
  error_message: string | null;
  payload: unknown;
}

const OUTCOME_LABEL: Record<Outcome, string> = {
  inserted: 'Inserted',
  updated: 'Updated',
  duplicate: 'Duplicate',
  invalid: 'Invalid',
  error: 'Error'
};

const OUTCOME_TONE: Record<Outcome, string> = {
  inserted: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40',
  updated: 'bg-amber-500/15 text-amber-300 border-amber-500/40',
  duplicate: 'bg-blue-500/15 text-blue-300 border-blue-500/40',
  invalid: 'bg-rose-500/15 text-rose-300 border-rose-500/40',
  error: 'bg-red-500/20 text-red-300 border-red-500/50'
};

function webhookUrl(req: Headers): string {
  // Prefer NEXT_PUBLIC_APP_BASE_URL so previews report the right host; fall
  // back to host header so dev / local-tunnel deploys still show something
  // sane. The actual route is always /api/admin/av/integrations/clay-webhook.
  const explicit = process.env.NEXT_PUBLIC_APP_BASE_URL;
  if (explicit) return `${explicit.replace(/\/$/, '')}/api/admin/av/integrations/clay-webhook`;
  const host = req.get('x-forwarded-host') ?? req.get('host') ?? 'atlantic-hub.netlify.app';
  const proto = req.get('x-forwarded-proto') ?? 'https';
  return `${proto}://${host}/api/admin/av/integrations/clay-webhook`;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

function previewPayload(p: unknown): string {
  if (p === null || p === undefined) return '';
  try {
    const s = typeof p === 'string' ? p : JSON.stringify(p);
    return s.length > 200 ? s.slice(0, 200) + '...' : s;
  } catch {
    return String(p);
  }
}

export default async function ClayIntegrationStatusPage() {
  const hdrs = headers();
  const role = hdrs.get('x-ah-user-role') as 'owner' | 'staff' | 'client_user' | null;
  if (role === 'client_user') {
    redirect('/admin');
  }

  const secretIsSet = Boolean(process.env.CLAY_WEBHOOK_SECRET);
  const url = webhookUrl(hdrs);

  // Pull distribution + recent rows in parallel. Tolerate the table being
  // absent (schema 012 not yet run) so the page still loads with a clear
  // setup hint.
  let outcomeAllTime: Partial<Record<Outcome, number>> = {};
  let outcome7d: Partial<Record<Outcome, number>> = {};
  let recent: ClayLogRow[] = [];
  let tableMissing = false;

  try {
    const db = getAvDb();
    const [allTimeRows, weekRows, recentRows] = await Promise.all([
      db.execute<OutcomeRow[]>(
        `SELECT outcome, COUNT(*) AS n FROM clay_enrichment_log GROUP BY outcome`
      ),
      db.execute<OutcomeRow[]>(
        `SELECT outcome, COUNT(*) AS n
           FROM clay_enrichment_log
          WHERE received_at >= (NOW() - INTERVAL 7 DAY)
          GROUP BY outcome`
      ),
      db.execute<ClayLogRow[]>(
        `SELECT id, received_at, clay_table_id, clay_row_id, lead_id, outcome,
                error_message, payload
           FROM clay_enrichment_log
          ORDER BY received_at DESC
          LIMIT 50`
      )
    ]);
    for (const r of allTimeRows[0]) outcomeAllTime[r.outcome] = Number(r.n);
    for (const r of weekRows[0]) outcome7d[r.outcome] = Number(r.n);
    recent = recentRows[0];
  } catch (err) {
    // ER_NO_SUCH_TABLE / Unknown table -- schema 012 has not been applied yet.
    const msg = (err as Error).message;
    if (/clay_enrichment_log/i.test(msg) || /Unknown table/i.test(msg) || /ER_NO_SUCH_TABLE/i.test(msg)) {
      tableMissing = true;
    } else {
      console.error('[clay:status]', msg);
    }
  }

  const ORDER: Outcome[] = ['inserted', 'updated', 'duplicate', 'invalid', 'error'];

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold mb-1">Clay enrichment receiver</h1>
        <p className="text-sm text-muted max-w-2xl">
          Clay tables POST one row at a time to this endpoint when enrichment completes. Rows are deduped
          against the existing pipeline, then either filled into an existing lead or inserted as a new one.
        </p>
      </header>

      {/* --- Setup card --- */}
      <section className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-5">
        <h2 className="text-sm font-semibold text-amber-300 mb-3 uppercase tracking-wide">Setup</h2>
        <div className="space-y-4 text-sm">
          <div>
            <div className="text-xs text-muted mb-1">Webhook URL (paste into Clay -&gt; Table -&gt; Webhook)</div>
            <div className="flex items-center gap-2 flex-wrap">
              <code className="px-3 py-2 rounded-lg bg-black/30 border border-white/10 font-mono text-[12px] break-all flex-1 min-w-[260px]">
                {url}
              </code>
              <CopyButton value={url} label="Copy URL" />
            </div>
          </div>
          <div>
            <div className="text-xs text-muted mb-1">Required header</div>
            <code className="px-3 py-2 rounded-lg bg-black/30 border border-white/10 font-mono text-[12px] break-all inline-block">
              X-Webhook-Secret: &lt;your CLAY_WEBHOOK_SECRET value&gt;
            </code>
          </div>
          <ol className="list-decimal list-inside text-sm space-y-1 text-ink/90">
            <li>Generate a random 32-char hex string locally: <code className="font-mono">openssl rand -hex 32</code></li>
            <li>Paste it into Netlify -&gt; Site -&gt; Environment variables as <code className="font-mono">CLAY_WEBHOOK_SECRET</code> and redeploy.</li>
            <li>In Clay, open the table -&gt; Webhook destination, paste the URL above, then add the header <code className="font-mono">X-Webhook-Secret</code> with the SAME value.</li>
            <li>Send a single test row from Clay and refresh this page. A row should appear below.</li>
          </ol>
          <div className="flex items-center gap-2 pt-2 text-xs">
            <span
              className={
                'inline-flex items-center gap-2 px-2 py-1 rounded-full border ' +
                (secretIsSet
                  ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
                  : 'bg-rose-500/15 text-rose-300 border-rose-500/40')
              }
              aria-live="polite"
            >
              <span aria-hidden="true">{secretIsSet ? '●' : '○'}</span>
              {secretIsSet ? 'CLAY_WEBHOOK_SECRET is set' : 'CLAY_WEBHOOK_SECRET is NOT set (receiver returns 401)'}
            </span>
          </div>
        </div>
      </section>

      {tableMissing && (
        <section className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-200">
          <strong className="block mb-1">Schema 012 not applied yet.</strong>
          Run <code className="font-mono">schema/012_clay_enrichment.sql</code> in phpMyAdmin against <code className="font-mono">shhdbite_AV</code>. The
          receiver will still 200 once it inserts a lead, but the audit log rows will not persist until the table exists.
        </section>
      )}

      {/* --- Outcome distribution --- */}
      <section>
        <h2 className="text-sm font-semibold text-ink mb-3 uppercase tracking-wide">Outcome distribution</h2>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {ORDER.map((o) => {
            const total = outcomeAllTime[o] ?? 0;
            const week = outcome7d[o] ?? 0;
            return (
              <div
                key={o}
                className={
                  'rounded-xl border p-4 ' + OUTCOME_TONE[o]
                }
              >
                <div className="text-xs uppercase tracking-wide opacity-80">{OUTCOME_LABEL[o]}</div>
                <div className="text-2xl font-semibold mt-1" aria-label={`${OUTCOME_LABEL[o]} all-time`}>{total}</div>
                <div className="text-[11px] opacity-70 mt-1">last 7d: {week}</div>
              </div>
            );
          })}
        </div>
      </section>

      {/* --- Recent rows --- */}
      <section>
        <h2 className="text-sm font-semibold text-ink mb-3 uppercase tracking-wide">Last 50 received rows</h2>
        {recent.length === 0 ? (
          <div className="rounded-xl border border-white/10 bg-white/[0.02] p-6 text-sm text-muted">
            No Clay rows received yet. Send a test row from Clay to confirm wiring.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-white/10">
            <table className="min-w-full text-sm">
              <thead className="bg-white/[0.03] text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">When</th>
                  <th className="text-left px-3 py-2 font-medium">Outcome</th>
                  <th className="text-left px-3 py-2 font-medium">Lead</th>
                  <th className="text-left px-3 py-2 font-medium">Clay table / row</th>
                  <th className="text-left px-3 py-2 font-medium">Payload preview</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((r) => (
                  <tr key={r.id} className="border-t border-white/5 align-top">
                    <td className="px-3 py-2 whitespace-nowrap text-xs text-muted">{formatTime(r.received_at)}</td>
                    <td className="px-3 py-2">
                      <span
                        className={
                          'inline-block px-2 py-1 rounded-full text-[11px] border ' +
                          OUTCOME_TONE[r.outcome]
                        }
                      >
                        {OUTCOME_LABEL[r.outcome]}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {r.lead_id !== null ? (
                        <a
                          href={`/admin/av/${r.lead_id}`}
                          className="text-amber-300 hover:underline focus-visible:outline-2 focus-visible:outline-amber-400"
                        >
                          #{r.lead_id}
                        </a>
                      ) : (
                        <span className="text-muted">--</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-[11px] font-mono text-muted">
                      <div>{r.clay_table_id ?? '--'}</div>
                      <div className="opacity-70">{r.clay_row_id ?? ''}</div>
                    </td>
                    <td className="px-3 py-2 max-w-md">
                      {r.error_message && (
                        <div className="text-xs text-rose-300 mb-1 break-words">{r.error_message}</div>
                      )}
                      <code className="text-[11px] text-muted break-all">{previewPayload(r.payload)}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
