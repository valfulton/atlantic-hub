/**
 * /admin/av/clients/[client_id]/intelligence
 *
 * OPERATOR-ONLY inventory: every piece of intel we have on this client,
 * grouped by layer (typed objects / canonical brief / raw intake) with a
 * "Read by" label on each piece so val can see what's actually being used
 * vs what was captured and ignored. Read-only.
 *
 * Three sections:
 *   1. Tagged intelligence — intelligence_objects (founder_story, proof_points,
 *      market_positioning, etc). Empty types in the registry are listed at the
 *      bottom as "Not extracted yet."
 *   2. Brief fields — canonical fields on creative_briefs.brief_payload.
 *   3. Raw intake — every field the client submitted that isn't already
 *      consumed somewhere. Unused fields surface first so the gap is visible.
 */
import { headers } from 'next/headers';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { getAvDb } from '@/lib/db/av';
import { loadIntelInventory, INTEL_OBJECT_CONSUMERS } from '@/lib/client/intel_inventory';
import type { RowDataPacket } from 'mysql2';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface ClientRow extends RowDataPacket { client_name: string | null }

function truncate(s: string, n = 220): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1).trimEnd() + '…';
}

function valueToText(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return v.map((x) => valueToText(x)).filter(Boolean).join(', ');
  try { return JSON.stringify(v, null, 2); } catch { return String(v); }
}

function ConsumerChips({ consumers, unused }: { consumers: string[]; unused: boolean }) {
  if (unused) {
    return (
      <span className="inline-flex items-center rounded-full bg-rose-500/10 text-rose-300 border border-rose-500/30 px-2 py-0.5 text-[10px] uppercase tracking-[0.18em]">
        Not currently used
      </span>
    );
  }
  return (
    <span className="flex flex-wrap gap-1.5">
      {consumers.map((c) => (
        <span key={c} className="inline-flex items-center rounded-full bg-amber-500/10 text-amber-200 border border-amber-500/30 px-2 py-0.5 text-[10px] uppercase tracking-[0.14em]">
          {c}
        </span>
      ))}
    </span>
  );
}

export default async function ClientIntelligencePage({ params }: { params: { client_id: string } }) {
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

  const inv = await loadIntelInventory(clientId);

  return (
    <main className="max-w-5xl mx-auto px-4 py-6 sm:py-8">
      {/* Header */}
      <div className="mb-6 flex items-end justify-between gap-4 flex-wrap">
        <div>
          <div className="text-[10px] uppercase tracking-[0.22em] text-brand mb-1">Intelligence inventory</div>
          <h1 className="text-2xl sm:text-3xl font-semibold text-ink tracking-tight">{clientName}</h1>
          <p className="text-muted text-sm mt-2 max-w-xl leading-relaxed">
            Every piece of intel we have on this client, with a label on each one showing what part of the system reads it.
            Unused fields are flagged in red — captured by intake, not consumed anywhere yet.
          </p>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <Link href={`/admin/av/clients/${clientId}`} className="text-brand hover:underline">&larr; Back to client</Link>
          <Link href={`/admin/av/clients/${clientId}/preview`} className="text-brand hover:underline">Preview client view &rarr;</Link>
        </div>
      </div>

      {/* Section 1 — Tagged intelligence */}
      <section className="mb-10">
        <div className="flex items-baseline justify-between gap-3 mb-3">
          <h2 className="text-lg font-semibold text-ink">1. Tagged intelligence <span className="text-muted text-sm font-normal">(intelligence_objects)</span></h2>
          <span className="text-xs text-muted">
            {inv.intelligenceObjects.length} extracted · {inv.missingIntelTypes.length} type(s) not yet extracted
          </span>
        </div>

        {inv.intelligenceObjects.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-surface/40 p-5 text-sm text-muted">
            No intelligence objects extracted for this client yet. Use the <span className="text-ink">Extract intel</span>{' '}
            button on the client page to run the intake through the categorization pipeline.
          </div>
        ) : (
          <ul className="space-y-3">
            {inv.intelligenceObjects.map((o) => (
              <li key={o.id} className="rounded-2xl border border-border bg-surface p-4">
                <div className="flex items-start justify-between gap-4 mb-2 flex-wrap">
                  <div>
                    <div className="text-[10px] uppercase tracking-[0.22em] text-brand">{o.object_type}</div>
                    <div className="text-[11px] text-muted mt-0.5">
                      {o.source && <>Source: <span className="text-ink/80">{o.source}</span> · </>}
                      {o.confidence !== null && <>Confidence: <span className="text-ink/80">{o.confidence}</span> · </>}
                      Updated: <span className="text-ink/80">{o.updated_at.slice(0, 16).replace('T', ' ')}</span>
                    </div>
                  </div>
                  <ConsumerChips consumers={INTEL_OBJECT_CONSUMERS[o.object_type] ?? []} unused={(INTEL_OBJECT_CONSUMERS[o.object_type] ?? []).length === 0} />
                </div>
                <pre className="text-xs text-ink/90 whitespace-pre-wrap bg-black/20 rounded-md p-3 border border-border/50 max-h-60 overflow-auto">
{truncate(valueToText(o.object_json), 1600)}
                </pre>
              </li>
            ))}
          </ul>
        )}

        {inv.missingIntelTypes.length > 0 && (
          <div className="mt-4 rounded-2xl border border-border bg-surface/40 p-4">
            <div className="text-[10px] uppercase tracking-[0.2em] text-muted mb-2">Not extracted yet (canonical types)</div>
            <div className="flex flex-wrap gap-1.5">
              {inv.missingIntelTypes.map((t) => (
                <span key={t} className="inline-flex items-center rounded-full bg-black/30 text-muted border border-border px-2 py-0.5 text-[11px]">
                  {t}
                </span>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Section 1.5 — PR engine output for THIS client (#182).
          Tenant-level intel (lead_id IS NULL, tenant 'av', source 'pr_discovery')
          filtered to this client's industries. Previously invisible: the per-
          client inventory only queried client-scoped tenants, and guidance.ts
          deliberately excludes tenant-level intel to avoid leftover-test-artifact
          bleed. This surface restores observability without removing that guard
          and answers the question "is the PR engine actually producing intel
          relevant to this client?" */}
      <section className="mb-10">
        <div className="flex items-baseline justify-between gap-3 mb-3 flex-wrap">
          <h2 className="text-lg font-semibold text-ink">
            1b. PR engine output for this industry{' '}
            <span className="text-muted text-sm font-normal">(tenant-level, source=pr_discovery)</span>
          </h2>
          <span className="text-xs text-muted">
            {inv.prDiscoveryObjects.length} matched · industries: {inv.clientIndustries.length > 0 ? inv.clientIndustries.join(', ') : 'none recorded'}
          </span>
        </div>

        {inv.clientIndustries.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-surface/40 p-5 text-sm text-muted">
            No industry recorded for this client (intake or brief). The PR engine groups its industry-pain output by
            industry — without one, we can&apos;t match its output to this client. Set <span className="text-ink">industry</span>{' '}
            on the brief or intake to enable matching.
          </div>
        ) : inv.prDiscoveryObjects.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-surface/40 p-5 text-sm text-muted">
            <p>
              The PR engine hasn&apos;t produced any <code className="text-ink">media_friendly_topics</code> intel matching{' '}
              <span className="text-ink/85">{inv.clientIndustries.join(', ')}</span> yet.
            </p>
            <p className="mt-2 text-xs text-muted">
              The engine writes one row per industry-pain cluster when it sees ≥2 leads in the same industry share a
              pain. If this client is the only lead in their industry, expect zero output until the pipeline grows.
            </p>
          </div>
        ) : (
          <ul className="space-y-3">
            {inv.prDiscoveryObjects.map((o) => (
              <li key={o.id} className="rounded-2xl border border-amber-500/20 bg-amber-500/[0.04] p-4">
                <div className="flex items-start justify-between gap-4 mb-2 flex-wrap">
                  <div>
                    <div className="text-[10px] uppercase tracking-[0.22em] text-amber-300">{o.object_type}</div>
                    <div className="text-[11px] text-muted mt-0.5">
                      Source: <span className="text-ink/80">{o.source}</span>
                      {o.confidence !== null && <> · Confidence: <span className="text-ink/80">{o.confidence}</span></>}
                      {' '}· Updated: <span className="text-ink/80">{o.updated_at.slice(0, 16).replace('T', ' ')}</span>
                    </div>
                  </div>
                  <span className="inline-flex items-center rounded-full bg-amber-500/15 text-amber-200 border border-amber-500/30 px-2 py-0.5 text-[10px] uppercase tracking-[0.14em]">
                    PR engine
                  </span>
                </div>
                <pre className="text-xs text-ink/90 whitespace-pre-wrap bg-black/25 rounded-md p-3 border border-border/50 max-h-60 overflow-auto">
{truncate(valueToText(o.object_json), 1600)}
                </pre>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Section 2 — Canonical brief */}
      <section className="mb-10">
        <div className="flex items-baseline justify-between gap-3 mb-3">
          <h2 className="text-lg font-semibold text-ink">2. Canonical brief <span className="text-muted text-sm font-normal">(creative_briefs.brief_payload)</span></h2>
          <span className="text-xs text-muted">{inv.briefFields.length} field(s)</span>
        </div>

        {!inv.briefHas ? (
          <div className="rounded-2xl border border-dashed border-border bg-surface/40 p-5 text-sm text-muted">
            No brief payload on file. Either the client hasn&apos;t completed intake, or the brief hasn&apos;t been derived yet.
          </div>
        ) : (
          <ul className="space-y-2">
            {inv.briefFields.map((f) => (
              <li key={f.key} className="rounded-xl border border-border bg-surface p-3.5">
                <div className="flex items-start justify-between gap-4 flex-wrap mb-1.5">
                  <div className="text-[12px] uppercase tracking-[0.16em] text-brand font-medium">{f.key}</div>
                  <ConsumerChips consumers={f.consumers} unused={f.unused} />
                </div>
                <div className="text-sm text-ink/85 whitespace-pre-wrap leading-relaxed">{truncate(valueToText(f.value), 360)}</div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Section 3 — Raw intake (and the gap) */}
      <section>
        <div className="flex items-baseline justify-between gap-3 mb-3">
          <h2 className="text-lg font-semibold text-ink">3. Raw intake <span className="text-muted text-sm font-normal">(client_users.intake_payload)</span></h2>
          <span className="text-xs text-muted">
            {inv.rawIntakeFields.length} field(s) ·{' '}
            <span className="text-rose-300">{inv.rawIntakeFields.filter((f) => f.unused).length} unused</span>
          </span>
        </div>

        {!inv.intakeHas ? (
          <div className="rounded-2xl border border-dashed border-border bg-surface/40 p-5 text-sm text-muted">
            No raw intake payload on file for this client. (Either they came from a different path, or the intake landed in another table — try the audit-form leads list if this client was an early audit-form submission.)
          </div>
        ) : (
          <ul className="space-y-2">
            {inv.rawIntakeFields.map((f) => (
              <li
                key={f.key}
                className={`rounded-xl border bg-surface p-3.5 ${f.unused ? 'border-rose-500/30' : 'border-border'}`}
              >
                <div className="flex items-start justify-between gap-4 flex-wrap mb-1.5">
                  <div className={`text-[12px] uppercase tracking-[0.16em] font-medium ${f.unused ? 'text-rose-300/90' : 'text-brand'}`}>
                    {f.key}
                  </div>
                  <ConsumerChips consumers={f.consumers} unused={f.unused} />
                </div>
                <div className="text-sm text-ink/85 whitespace-pre-wrap leading-relaxed">{truncate(valueToText(f.value), 360)}</div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="text-xs text-muted/70 mt-10 leading-relaxed border-t border-border pt-4">
        The &ldquo;Read by&rdquo; labels are a static map maintained in <code className="text-ink/70">lib/client/intel_inventory.ts</code>.
        Update that file when a consumer moves. The map covers the codebase as of the time this panel was built, not a live runtime trace.
      </p>
    </main>
  );
}
