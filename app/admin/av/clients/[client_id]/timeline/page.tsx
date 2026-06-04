/**
 * /admin/av/clients/[client_id]/timeline
 *
 * Visual prompt-history walker (#185). Per-client timeline of every AI call,
 * piece of guidance, content artifact, intelligence-object write, and logged
 * call — newest first. The surface val can sit beside Skip or Mike and say
 * "here's everything the system did for you, in order."
 *
 * Read-only. Operator-only. Pure DB read via lib/client/timeline.ts.
 */
import { headers } from 'next/headers';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { getAvDb } from '@/lib/db/av';
import { loadClientTimeline, type TimelineItem, type TimelineKind } from '@/lib/client/timeline';
import type { RowDataPacket } from 'mysql2';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface ClientRow extends RowDataPacket { client_name: string | null }

// ─── Visual taxonomy ─────────────────────────────────────────────────────

const KIND_LABEL: Record<TimelineKind, string> = {
  ai_call:   'AI call',
  discovery: 'Discovery',
  content:   'Content',
  intel:     'Tagged intel',
  outreach:  'Outreach',
  system:    'System',
  other:     'Other'
};

// Tailwind colors per kind — small, calm palette.
const KIND_STYLE: Record<TimelineKind, { dot: string; chip: string }> = {
  ai_call:   { dot: 'bg-[#EBCB6B]',  chip: 'border-[#EBCB6B]/40 text-[#EBCB6B] bg-[#EBCB6B]/10' },
  discovery: { dot: 'bg-sky-400',    chip: 'border-sky-400/40    text-sky-200    bg-sky-400/10' },
  content:   { dot: 'bg-violet-400', chip: 'border-violet-400/40 text-violet-200 bg-violet-400/10' },
  intel:     { dot: 'bg-emerald-400',chip: 'border-emerald-400/40 text-emerald-200 bg-emerald-400/10' },
  outreach:  { dot: 'bg-rose-300',   chip: 'border-rose-300/40   text-rose-200   bg-rose-300/10' },
  system:    { dot: 'bg-slate-300',  chip: 'border-slate-400/30  text-slate-300  bg-slate-400/10' },
  other:     { dot: 'bg-slate-400',  chip: 'border-slate-400/30  text-slate-300  bg-slate-400/10' }
};

const STATUS_STYLE: Record<TimelineItem['status'], string> = {
  success: 'text-emerald-300/90',
  failure: 'text-rose-300/90',
  partial: 'text-[#EBCB6B]/90',
  pending: 'text-sky-300/90',
  info:    'text-muted'
};

// ─── Date helpers ────────────────────────────────────────────────────────

function dayBucket(iso: string): string {
  // 2026-05-28 (UTC) — coarse enough for human grouping.
  return iso.slice(0, 10);
}

function dayHeading(iso: string): string {
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  if (iso === today) return 'Today';
  if (iso === yesterday) return 'Yesterday';
  try {
    return new Date(iso + 'T00:00:00Z').toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
    });
  } catch { return iso; }
}

function timeOfDay(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  } catch { return ''; }
}

// ─── Page ───────────────────────────────────────────────────────────────

export default async function ClientTimelinePage({ params }: { params: { client_id: string } }) {
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

  let items: TimelineItem[] = [];
  let loadError: string | null = null;
  try {
    items = await loadClientTimeline({ clientId, limit: 80 });
  } catch (e) {
    loadError = (e as Error).message;
    console.error('[timeline:page]', loadError);
  }

  // Group by day.
  const groups = new Map<string, TimelineItem[]>();
  for (const it of items) {
    const day = dayBucket(it.at);
    const arr = groups.get(day) ?? [];
    arr.push(it);
    groups.set(day, arr);
  }
  const orderedDays = Array.from(groups.keys()).sort((a, b) => (a > b ? -1 : a < b ? 1 : 0));

  // Counts per kind for the header summary chips.
  const kindCounts: Record<TimelineKind, number> = {
    ai_call: 0, discovery: 0, content: 0, intel: 0, outreach: 0, system: 0, other: 0
  };
  for (const it of items) kindCounts[it.kind]++;

  return (
    <main className="max-w-4xl mx-auto px-4 py-6 sm:py-8">
      {/* Header */}
      <div className="mb-6 flex items-end justify-between gap-4 flex-wrap">
        <div>
          <div className="text-[10px] uppercase tracking-[0.22em] text-brand mb-1">Activity timeline</div>
          <h1 className="text-2xl sm:text-3xl font-semibold text-ink tracking-tight">{clientName}</h1>
          <p className="text-muted text-sm mt-2 max-w-xl leading-relaxed">
            Every meaningful thing the system has done for this client, in order. The story you can sit beside them and walk through.
          </p>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <Link href={`/admin/av/clients/${clientId}`} className="text-brand hover:underline">&larr; Back to client</Link>
          <Link href={`/admin/av/clients/${clientId}/intelligence`} className="text-brand hover:underline">Intel inventory &rarr;</Link>
        </div>
      </div>

      {/* Summary chips — how many of each kind */}
      <div className="flex flex-wrap gap-2 mb-6">
        {(Object.keys(KIND_LABEL) as TimelineKind[])
          .filter((k) => kindCounts[k] > 0)
          .map((k) => (
            <span
              key={k}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] uppercase tracking-[0.14em] ${KIND_STYLE[k].chip}`}
            >
              <span className={`inline-block h-1.5 w-1.5 rounded-full ${KIND_STYLE[k].dot}`} />
              {KIND_LABEL[k]} <span className="opacity-70">· {kindCounts[k]}</span>
            </span>
          ))}
      </div>

      {/* Load error state */}
      {loadError && (
        <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-5 mb-6 text-sm">
          <div className="text-rose-200 font-semibold mb-1">Timeline couldn&apos;t load all streams.</div>
          <div className="text-rose-200/80 text-xs leading-relaxed">{loadError}</div>
        </div>
      )}

      {/* Empty state */}
      {!loadError && items.length === 0 && (
        <div className="rounded-2xl border border-dashed border-border bg-surface/40 p-8 text-center">
          <div className="text-sm text-muted leading-relaxed">
            Nothing on the wire yet. Once leads land, AI calls fire, or content gets drafted for{' '}
            <span className="text-ink">{clientName}</span>, it will appear here.
          </div>
        </div>
      )}

      {/* Day-grouped timeline */}
      <div className="space-y-8">
        {orderedDays.map((day) => {
          const dayItems = groups.get(day) ?? [];
          return (
            <section key={day}>
              <div className="flex items-center gap-3 mb-3">
                <h2 className="text-sm font-semibold text-ink">{dayHeading(day)}</h2>
                <div className="h-px flex-1 bg-border" />
                <div className="text-[10px] uppercase tracking-[0.18em] text-muted">
                  {dayItems.length} item{dayItems.length === 1 ? '' : 's'}
                </div>
              </div>

              <ol className="relative border-l border-border pl-5 space-y-3">
                {dayItems.map((it) => {
                  const style = KIND_STYLE[it.kind];
                  return (
                    <li key={it.key} className="relative">
                      {/* node dot on the timeline rail */}
                      <span
                        aria-hidden="true"
                        className={`absolute -left-[27px] top-2 inline-block h-2.5 w-2.5 rounded-full ring-4 ring-bg ${style.dot}`}
                      />

                      <div className="rounded-xl border border-border bg-surface px-4 py-3">
                        <div className="flex items-start justify-between gap-3 flex-wrap">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] ${style.chip}`}>
                                {KIND_LABEL[it.kind]}
                              </span>
                              <span className={`text-[11px] uppercase tracking-[0.12em] ${STATUS_STYLE[it.status]}`}>
                                {it.status}
                              </span>
                              {it.leadId != null && (
                                <span className="text-[11px] text-muted">lead #{it.leadId}</span>
                              )}
                            </div>
                            <p className="text-sm text-ink mt-1.5 leading-snug">{it.title}</p>
                            {it.detail && (
                              <p className="text-xs text-muted mt-0.5">{it.detail}</p>
                            )}
                          </div>
                          <div className="text-[11px] text-muted whitespace-nowrap">{timeOfDay(it.at)}</div>
                        </div>

                        {it.preview && (
                          <pre className="mt-2 text-xs text-ink/80 whitespace-pre-wrap bg-black/20 rounded-md p-2 border border-border/50 max-h-32 overflow-auto">
{it.preview}
                          </pre>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ol>
            </section>
          );
        })}
      </div>

      <p className="text-xs text-muted/70 mt-12 leading-relaxed border-t border-border pt-4">
        Source streams: <code className="text-ink/70">system_events</code>, <code className="text-ink/70">content_artifacts</code>,{' '}
        <code className="text-ink/70">intelligence_objects</code>, <code className="text-ink/70">call_log</code> — all scoped to this client&apos;s currently-owned leads (no-bleed). Capped at 80 per stream, newest first.
      </p>
    </main>
  );
}
