'use client';

/**
 * ClientPrView  (#220)
 *
 * The client-facing PR opportunity list + approval workflow. Used by both
 * the live /client/pr surface AND the operator mirror at
 * /admin/av/clients/[client_id]/preview/pr. `mode` controls which:
 *   - 'live'    : mutating actions POST to /api/client/pr/approval
 *   - 'preview' : read-only, buttons render but are disabled with a small tag
 *
 * Render conventions match /client/leads -- same border/surface vocabulary,
 * same date-pill style, nautical/amber accents, no operator machinery
 * (scores, raw event names, "intelligence_objects", etc.).
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ClientFacingPrOpportunity, ClientPrSummary } from '@/lib/pr/client_pr_actions';

interface Props {
  opps: ClientFacingPrOpportunity[];
  stats: ClientPrSummary;
  /** First-name greeting at the top of the page. */
  headline: string;
  /** 'live' wires up POSTs; 'preview' makes the buttons read-only. */
  mode: 'live' | 'preview';
}

function DecayPill({ days }: { days: number | null }) {
  // Quiet, on-brand timing label — no alarm colors, no countdown-pressure fills
  // (ethics line: no FOMO). Muted text; gold only when it's genuinely today/closing.
  if (days == null) return <span style={{ fontSize: 11, color: 'var(--cream-muted)' }}>no deadline</span>;
  const label = days < 0 ? `closed ${-days}d ago` : days === 0 ? 'today' : `${days}d left`;
  const soon = days >= 0 && days <= 3;
  return (
    <span style={{ fontSize: 10, letterSpacing: '.12em', textTransform: 'uppercase', color: soon ? 'var(--amber-deep)' : 'var(--cream-muted)' }}>
      {label}
    </span>
  );
}

function ClientApprovalChip({ approval }: { approval: 'approved' | 'declined' | 'review_requested' | null }) {
  if (!approval) return null;
  const map = {
    approved: { bg: 'rgba(15,110,86,0.14)', fg: '#0F6E56', label: 'You approved' },
    declined: { bg: 'rgba(122,58,64,0.14)', fg: '#7A3A40', label: 'You declined' },
    review_requested: { bg: 'rgba(138,83,22,0.14)', fg: '#7E4E16', label: 'Sent for review' }
  } as const;
  const m = map[approval];
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] uppercase tracking-[0.14em] font-medium" style={{ background: m.bg, color: m.fg }}>
      {m.label}
    </span>
  );
}

function StatItem({ label, value, tone }: { label: string; value: number; tone?: 'urgent' | 'good' | 'neutral' }) {
  // V3: urgent gets a gold-outline ring (no orange/rose); good stays calm
  // emerald; default = quiet rule. No fills on tone rings.
  const ring =
    tone === 'urgent' && value > 0
      ? 'border-[#C9A961]/60 bg-transparent'
      : tone === 'good' && value > 0
      ? 'border-[#0A4D3C]/35 bg-transparent'
      : 'border-[#0A4D3C]/12 bg-white';
  return (
    <div className={`rounded-xl border ${ring} px-4 py-3`}>
      <div className="text-[10px] uppercase tracking-[0.18em] text-muted">{label}</div>
      <div className="text-2xl font-semibold text-ink tabular-nums mt-0.5">{value}</div>
    </div>
  );
}

interface CardState {
  busy: boolean;
  err: string | null;
  noteOpen: 'declined' | 'review_requested' | null;
  noteDraft: string;
}

function emptyState(): CardState {
  return { busy: false, err: null, noteOpen: null, noteDraft: '' };
}

export default function ClientPrView({ opps, stats, headline, mode }: Props) {
  const router = useRouter();
  const readonly = mode === 'preview';

  // Per-card UI state, keyed by pitch id (and 'opp:<id>' for opps without a
  // pitch yet, so the awaiting-draft cards still render predictably).
  const [cards, setCards] = useState<Record<string, CardState>>({});
  function cardKey(o: ClientFacingPrOpportunity) { return o.pitchId ? `p:${o.pitchId}` : `o:${o.id}`; }
  function setCard(key: string, patch: Partial<CardState>) {
    setCards((prev) => ({ ...prev, [key]: { ...emptyState(), ...prev[key], ...patch } }));
  }

  async function act(o: ClientFacingPrOpportunity, decision: 'approved' | 'declined' | 'review_requested', note?: string) {
    if (readonly) return;
    if (!o.pitchId) return; // No pitch to act on yet.
    const key = cardKey(o);
    setCard(key, { busy: true, err: null });
    try {
      const res = await fetch('/api/client/pr/approval', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pitchId: o.pitchId, decision, note: note || null })
      });
      const raw = await res.text();
      let data: { error?: string } | null = null;
      try { data = JSON.parse(raw); } catch { throw new Error(`HTTP ${res.status} (non-JSON)`); }
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      router.refresh();
    } catch (e) {
      setCard(key, { busy: false, err: (e as Error).message });
    }
  }

  if (opps.length === 0) {
    return (
      <section className="rounded-2xl border border-[#0A4D3C]/12 bg-white p-8 text-center">
        <div className="text-[10px] uppercase tracking-[0.22em] text-[#0A4D3C] mb-2">Your PR pipeline</div>
        <p className="text-ink font-medium text-base">Nothing in the press queue yet, {headline}.</p>
        <p className="text-sm text-muted mt-2 max-w-md mx-auto leading-relaxed">
          When a journalist puts out a request that fits your story, you&apos;ll see it here with a drafted pitch
          ready for your one-click approval.
        </p>
      </section>
    );
  }

  return (
    <>
      {/* Glance stats. */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-6">
        <StatItem label="In your queue" value={stats.total} />
        <StatItem label="Awaiting you" value={stats.awaitingMyApproval} tone="urgent" />
        <StatItem label="You approved" value={stats.iApproved} tone="good" />
        <StatItem label="Urgent (≤7 days)" value={stats.urgent} tone="urgent" />
      </div>

      <ul className="space-y-3">
        {opps.map((o) => {
          const key = cardKey(o);
          const state = cards[key] || emptyState();
          const hasPitch = !!o.pitchId && !!o.pitchBody;
          const alreadyActed = !!o.clientApproval;
          const operatorSent = o.pitchStatus === 'sent';

          return (
            <li key={key} className="rounded-2xl border border-[#0A4D3C]/12 bg-white p-5">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <DecayPill days={o.decayDays} />
                    <ClientApprovalChip approval={o.clientApproval} />
                    {operatorSent && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] uppercase tracking-[0.14em] font-medium" style={{ background: 'rgba(44,87,119,0.14)', color: '#2C5777' }}>
                        Submitted
                      </span>
                    )}
                  </div>
                  <h3 className="text-ink font-medium leading-snug text-base">{o.title}</h3>
                  {o.outlet && o.journalist && (
                    <div className="text-[11px] uppercase tracking-[0.12em] text-muted mt-1">
                      {o.outlet} &middot; {o.journalist}
                    </div>
                  )}
                </div>
              </div>

              {o.matchedLeadCompany && (
                <div className="mt-3 text-xs text-muted">
                  Matched to <span className="text-ink">{o.matchedLeadCompany}</span> in your pipeline.
                </div>
              )}

              {o.queryText && (
                <div className="mt-3 rounded-xl border border-[#0A4D3C]/12 bg-[#0A4D3C]/[0.05] p-3">
                  <div className="text-[10px] uppercase tracking-[0.14em] text-[#0A4D3C] mb-1.5">What the journalist asked</div>
                  <p className="text-sm text-ink/85 leading-relaxed whitespace-pre-wrap">{o.queryText}</p>
                </div>
              )}

              {o.whyItMatters && (
                <div className="mt-3 text-xs text-muted italic leading-relaxed">
                  Why this matters for you: <span className="text-ink/85 not-italic">{o.whyItMatters}</span>
                </div>
              )}

              {hasPitch ? (
                <div className="mt-4 rounded-xl border border-[#C9A961]/45 bg-[#C9A961]/[0.07] p-3">
                  <div className="text-[10px] uppercase tracking-[0.14em] text-[#0A4D3C] mb-1.5">Drafted pitch in your voice</div>
                  <p className="text-sm text-ink/90 leading-relaxed whitespace-pre-wrap">{o.pitchBody}</p>
                </div>
              ) : (
                <div className="mt-4 rounded-xl border border-dashed border-[#0A4D3C]/20 bg-[#0A4D3C]/[0.04] p-3 text-[12px] text-muted italic">
                  Pitch in progress — we&apos;ll draft this for you and you&apos;ll see it here before it goes out.
                </div>
              )}

              {/* Action bar */}
              {hasPitch && !operatorSent && !alreadyActed && (
                <div className="mt-4 flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={() => act(o, 'approved')}
                    disabled={readonly || state.busy}
                    className="rounded-md px-3 py-1.5 text-[12px] font-medium transition disabled:cursor-not-allowed disabled:opacity-50"
                    style={{ background: '#0A4D3C', color: '#F5EFE3' }}
                  >
                    {state.busy ? 'Saving…' : 'Approve & send'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setCard(key, { noteOpen: 'review_requested', noteDraft: '' })}
                    disabled={readonly || state.busy}
                    className="rounded-md border border-[#0A4D3C]/40 bg-transparent text-[#0A4D3C] px-3 py-1.5 text-[12px] font-medium hover:bg-[#0A4D3C]/[0.06] transition disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Show me first
                  </button>
                  <button
                    type="button"
                    onClick={() => setCard(key, { noteOpen: 'declined', noteDraft: '' })}
                    disabled={readonly || state.busy}
                    className="rounded-md border border-[#0A4D3C]/15 bg-transparent text-muted hover:text-ink hover:border-[#0A4D3C]/30 px-3 py-1.5 text-[12px] font-medium transition disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Pass
                  </button>
                  {readonly && (
                    <span className="text-[10px] uppercase tracking-[0.12em] text-[#0A4D3C]/70 ml-1">
                      preview — read-only
                    </span>
                  )}
                </div>
              )}

              {/* Note capture for decline / review_requested */}
              {state.noteOpen && (
                <div className="mt-3 rounded-xl border border-[#0A4D3C]/12 bg-[#0A4D3C]/[0.04] p-3">
                  <label className="text-[10px] uppercase tracking-[0.14em] text-muted block mb-1">
                    {state.noteOpen === 'declined' ? 'Why pass? (optional)' : 'What should we look at? (optional)'}
                  </label>
                  <textarea
                    value={state.noteDraft}
                    onChange={(e) => setCard(key, { noteDraft: e.target.value })}
                    rows={3}
                    placeholder={state.noteOpen === 'declined' ? 'Not a fit, wrong angle, etc.' : 'Tone, angle, something specific to add…'}
                    className="w-full rounded-md bg-white border border-[#0A4D3C]/15 px-2.5 py-1.5 text-[12px] text-ink/90 placeholder-muted/60 focus:outline-none focus:border-[#0A4D3C]/50"
                  />
                  <div className="flex items-center gap-2 mt-2">
                    <button
                      type="button"
                      onClick={() => act(o, state.noteOpen!, state.noteDraft)}
                      disabled={readonly || state.busy}
                      className="rounded-md bg-brand text-brand-fg px-3 py-1 text-[11.5px] font-medium hover:opacity-90 transition disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {state.busy ? 'Saving…' : state.noteOpen === 'declined' ? 'Confirm pass' : 'Send for review'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setCard(key, { noteOpen: null, noteDraft: '' })}
                      className="text-[11px] text-muted hover:text-ink px-2"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {state.err && (
                <div className="mt-2 text-[11px] text-muted italic">Couldn&apos;t save: {state.err}</div>
              )}

              {/* Already-acted summary, with the client's prior note if any. */}
              {alreadyActed && !state.noteOpen && (
                <div className="mt-3 text-[11px] text-muted">
                  {o.clientApproval === 'approved' && 'Approved — Atlantic & Vine has the green light to send.'}
                  {o.clientApproval === 'review_requested' && 'Held for review — we&apos;ll take another pass before it goes out.'}
                  {o.clientApproval === 'declined' && 'Passed — we won&apos;t send this one.'}
                  {o.clientNote && (
                    <div className="mt-1 text-ink/75 italic">&ldquo;{o.clientNote}&rdquo;</div>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}
