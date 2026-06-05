'use client';

/**
 * ClientLeadDetailTabs — the curated, client-facing lead detail.
 *
 * Deliberately a SUBSET of the operator's tabs (feedback_client_simplicity):
 *   Identity · Audit · AI Scoring · Commercials (soon)
 * Omitted on purpose: Challenge (empty for client-found prospects), and the
 * model/version + "scored by AI" wording (feedback_ai_verbiage — clients see the
 * result, not the machinery). Calls / Notes / Outreach arrive in increment 2.
 */
import { useState, useEffect, useCallback } from 'react';
import type { ClientLeadDetail } from '@/lib/client/lead_detail';
import { ProspectIntelPanel } from '@/app/_components/ProspectIntelPanel';
import { ClientLeadNarrativeLinesPanel } from '@/app/_components/ClientLeadNarrativeLinesPanel';
// (#300) Reject control on the detail page — was list-only before. Tim asked
// for it after walking the detail tab.
import ClientLeadReject from '@/app/client/_components/ClientLeadReject';

const TABS = ['Audit', 'Calls', 'Notes', 'AI Scoring', 'Outreach', 'Identity', 'Commercials'] as const;
type Tab = (typeof TABS)[number];

interface NoteEntry {
  noteId: number;
  body: string;
  authorRole: string;
  createdAt: string;
}

/** Call outcomes a rep picks from — value matches the API's VALID_OUTCOMES. */
const CALL_OUTCOMES: { value: string; label: string }[] = [
  { value: 'connected', label: 'Connected' },
  { value: 'voicemail', label: 'Left voicemail' },
  { value: 'no_answer', label: 'No answer' },
  { value: 'follow_up', label: 'Needs follow-up' },
  { value: 'meeting_booked', label: 'Meeting booked' },
  { value: 'converted', label: 'Converted' },
  { value: 'not_interested', label: 'Not interested' },
  { value: 'wrong_number', label: 'Wrong number' },
  { value: 'other', label: 'Other' }
];

interface CallEntry {
  callLogId: number;
  outcome: string;
  durationSeconds: number | null;
  notes: string | null;
  calledAt: string;
}

function outcomeLabel(v: string): string {
  return CALL_OUTCOMES.find((o) => o.value === v)?.label ?? v;
}

// (#300) Same Mixed-signal demotion as the list view — see /client/leads/page.tsx.
// Dashboard vocabulary on cream: hot = amber attention, warm = emerald,
// cool/mixed = quiet muted. No navy-era pastels.
const BAND_TONE: Record<'hot' | 'warm' | 'cool' | 'mixed', { bg: string; fg: string; label: string }> = {
  hot: { bg: 'rgba(181,116,43,0.14)', fg: '#8A5316', label: 'Hot' },
  warm: { bg: 'var(--emerald-mist, #E8F2EE)', fg: '#0A4D3C', label: 'Warm' },
  cool: { bg: 'rgba(10,77,60,0.06)', fg: '#4A4A4A', label: 'Cool' },
  mixed: { bg: 'rgba(10,77,60,0.06)', fg: '#6B6862', label: 'Mixed signal' }
};

function fmtDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function Field({ label, value, href }: { label: string; value: string | null; href?: string }) {
  if (!value) return null;
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.14em] text-muted mb-0.5">{label}</div>
      {href ? (
        <a href={href} target="_blank" rel="noopener" className="text-sm text-[#0A4D3C] hover:underline break-words">{value}</a>
      ) : (
        <div className="text-sm text-ink break-words">{value}</div>
      )}
    </div>
  );
}

function ScoreCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-white px-4 py-3">
      <div className="text-[10px] uppercase tracking-[0.14em] text-muted">{label}</div>
      <div className="text-2xl font-semibold tabular-nums text-ink mt-1 leading-none">{value}</div>
    </div>
  );
}

function Bar({ label, value }: { label: string; value: number | null }) {
  if (value == null) return null;
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div>
      <div className="flex justify-between text-[11px] mb-1">
        <span className="text-muted uppercase tracking-[0.12em]">{label}</span>
        <span className="text-ink tabular-nums">{pct}</span>
      </div>
      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(10,77,60,0.10)' }}>
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: 'var(--emerald, #0A4D3C)' }} />
      </div>
    </div>
  );
}

export default function ClientLeadDetailTabs({ lead }: { lead: ClientLeadDetail }) {
  const [active, setActive] = useState<Tab>('Audit');
  // (#300) Mixed-signal reconciliation — when AV signal high but ICP fit poor,
  // demote the band display so the pill doesn't lie. Identical logic + threshold
  // to the list view so both surfaces tell the same story.
  const displayBand: 'hot' | 'warm' | 'cool' | 'mixed' | null = (() => {
    if (!lead.band) return null;
    const icp = lead.icpFitScore ?? null;
    if ((lead.band === 'hot' || lead.band === 'warm') && icp != null && icp < 40) return 'mixed';
    return lead.band;
  })();
  const tone = displayBand ? BAND_TONE[displayBand] : null;

  // Call logging
  const [calls, setCalls] = useState<CallEntry[]>([]);
  const [callsLoaded, setCallsLoaded] = useState(false);
  const [outcome, setOutcome] = useState<string>('connected');
  const [callNotes, setCallNotes] = useState('');
  const [savingCall, setSavingCall] = useState(false);
  const [callError, setCallError] = useState<string | null>(null);

  const fetchCalls = useCallback(async () => {
    try {
      const res = await fetch(`/api/client/leads/${lead.auditId}/calls`);
      if (res.ok) {
        const data = await res.json();
        setCalls(Array.isArray(data.calls) ? data.calls : []);
      }
    } catch {
      /* non-fatal */
    } finally {
      setCallsLoaded(true);
    }
  }, [lead.auditId]);

  useEffect(() => {
    if (active === 'Calls' && !callsLoaded) fetchCalls();
  }, [active, callsLoaded, fetchCalls]);

  async function logCall() {
    setSavingCall(true);
    setCallError(null);
    try {
      const res = await fetch(`/api/client/leads/${lead.auditId}/calls`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ outcome, notes: callNotes.trim() || undefined })
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.ok) throw new Error(j.error || `HTTP ${res.status}`);
      setCallNotes('');
      setCallsLoaded(false); // refetch the list
      await fetchCalls();
    } catch (e) {
      setCallError((e as Error).message);
    } finally {
      setSavingCall(false);
    }
  }

  function fmtDateTime(iso: string): string {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  // Notes
  const [notes, setNotes] = useState<NoteEntry[]>([]);
  const [notesLoaded, setNotesLoaded] = useState(false);
  const [noteBody, setNoteBody] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);

  const fetchNotes = useCallback(async () => {
    try {
      const res = await fetch(`/api/client/leads/${lead.auditId}/notes`);
      if (res.ok) {
        const data = await res.json();
        setNotes(Array.isArray(data.notes) ? data.notes : []);
      }
    } catch {
      /* non-fatal */
    } finally {
      setNotesLoaded(true);
    }
  }, [lead.auditId]);

  useEffect(() => {
    if (active === 'Notes' && !notesLoaded) fetchNotes();
  }, [active, notesLoaded, fetchNotes]);

  async function addNote() {
    const trimmed = noteBody.trim();
    if (!trimmed) return;
    setSavingNote(true);
    setNoteError(null);
    try {
      const res = await fetch(`/api/client/leads/${lead.auditId}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: trimmed })
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.note) throw new Error(j.error || `HTTP ${res.status}`);
      setNotes((prev) => [j.note as NoteEntry, ...prev]);
      setNoteBody('');
    } catch (e) {
      setNoteError((e as Error).message);
    } finally {
      setSavingNote(false);
    }
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-1">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold text-ink tracking-tight leading-snug">{lead.company}</h1>
          {lead.industry && (
            <div className="text-[11px] uppercase tracking-[0.12em] text-muted mt-1">{lead.industry}</div>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {lead.score !== null && (
            <span className="text-3xl font-semibold tabular-nums text-ink leading-none">{Math.round(lead.score)}</span>
          )}
          {tone && (
            <span
              className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] uppercase tracking-[0.14em] font-medium"
              style={{ background: tone.bg, color: tone.fg }}
            >
              {tone.label}
            </span>
          )}
        </div>
      </div>

      {/* Front-and-center: log a call without hunting for it. Reject sits
          beside it so a "this isn't a fit" call doesn't require backing out. */}
      <div className="mt-4 flex items-center gap-3 flex-wrap">
        <button
          onClick={() => setActive('Calls')}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium"
          style={{ background: 'var(--emerald, #0A4D3C)', color: 'var(--cream-pure, #F5EFE3)', border: 'none' }}
        >
          &#x1F4DE; Log a call
        </button>
        {/* (#300) Reject control on detail page (was list-only). Lifted styling
            from ClientLeadReject's chip variant so it sits visually next to
            "Log a call" as an equal-weight action without competing for focus. */}
        <ClientLeadReject leadId={lead.id} />
      </div>

      {/* (#46 Inc 5) Read-only mirror of the operator's narrative-lines
          panel. Shows ONLY linked lines + outcomes (no candidates, no
          machinery) so the client sees the story the work is advancing
          and the track record behind it. Hidden when no lines linked yet. */}
      <div className="mt-4">
        <ClientLeadNarrativeLinesPanel lines={lead.narrativeLines} />
      </div>

      {/* (#253) "About this prospect" — distilled prospect-research the LLM
          pulled from their own website. Shared component so operator + client
          surfaces can't drift. Renders nothing when intel is null/empty. */}
      <div className="mt-4">
        <ProspectIntelPanel intel={lead.prospectIntel} />
      </div>

      {/* "What to say on the call" — the highest-value thing, kept up top */}
      {lead.callScript && (lead.callScript.openers.length > 0 || lead.callScript.primaryPain) && (
        <div className="mt-4 rounded-2xl border border-border bg-white p-4">
          <div className="text-[10px] uppercase tracking-[0.14em] text-[#0A4D3C] mb-1.5">What to say on the call</div>
          {lead.callScript.primaryPain && (
            <p className="text-sm text-muted mb-2 leading-relaxed">{lead.callScript.primaryPain}</p>
          )}
          {lead.callScript.openers.length > 0 && (
            <ul className="space-y-1.5 mb-2">
              {lead.callScript.openers.slice(0, 3).map((o, i) => (
                <li key={i} className="text-sm text-ink leading-relaxed">&ldquo;{o}&rdquo;</li>
              ))}
            </ul>
          )}
          {lead.callScript.avoid.length > 0 && (
            <div className="text-[11px] text-muted">
              <span className="text-muted uppercase tracking-[0.12em] text-[10.5px] mr-1.5">Avoid</span> {lead.callScript.avoid.join('; ')}
            </div>
          )}
        </div>
      )}

      {/* Tabs */}
      <div className="flex flex-wrap gap-1.5 mt-6 mb-4 border-b border-border pb-2">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setActive(t)}
            className={[
              'text-sm px-3 py-1.5 rounded-md transition-colors',
              active === t ? 'text-ink bg-[var(--surface-2)]' : 'text-muted hover:text-ink'
            ].join(' ')}
          >
            {t}
          </button>
        ))}
      </div>

      {active === 'Identity' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Company" value={lead.company} />
          <Field label="Industry" value={lead.industry} />
          <Field label="Contact" value={lead.contactName} />
          <Field label="Title" value={lead.contactTitle} />
          <Field label="Email" value={lead.email} />
          <Field label="Phone" value={lead.phone} />
          <Field
            label="Website"
            value={
              lead.websiteStatus === 'placeholder' || lead.websiteStatus === 'dead'
                ? 'No working website'
                : lead.website
            }
            href={
              lead.website && lead.websiteStatus !== 'placeholder' && lead.websiteStatus !== 'dead'
                ? lead.website
                : undefined
            }
          />
          <Field
            label="Address"
            value={
              [lead.addressStreet, lead.addressCity, lead.addressState, lead.addressPostal]
                .filter(Boolean)
                .join(', ') || null
            }
          />
          <Field label="Status" value={lead.leadStatus} />
        </div>
      )}

      {active === 'Audit' &&
        (lead.auditContent ? (
          <div>
            <pre className="whitespace-pre-wrap text-sm leading-relaxed font-mono bg-white border border-border rounded-lg p-5 max-h-[60vh] overflow-y-auto">
              {lead.auditContent}
            </pre>
            {fmtDate(lead.auditGenerated) && (
              <p className="text-xs text-muted mt-2">Prepared {fmtDate(lead.auditGenerated)}</p>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted">Your brief for this lead is being prepared and will appear here shortly.</p>
        ))}

      {active === 'Calls' && (
        <div className="space-y-5">
          <div className="rounded-2xl border border-border bg-white p-5">
            <div className="text-[10px] uppercase tracking-[0.14em] text-[#0A4D3C] mb-3">Log a call</div>
            <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
              <label className="block sm:w-56">
                <span className="block text-[11px] text-muted mb-1">How did it go?</span>
                <select
                  value={outcome}
                  onChange={(e) => setOutcome(e.target.value)}
                  disabled={savingCall}
                  className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-ink"
                >
                  {CALL_OUTCOMES.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </label>
              <label className="block flex-1">
                <span className="block text-[11px] text-muted mb-1">Notes (optional)</span>
                <input
                  value={callNotes}
                  onChange={(e) => setCallNotes(e.target.value)}
                  disabled={savingCall}
                  placeholder="What was said, next step, who to ask for…"
                  className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-ink"
                />
              </label>
              <button
                onClick={logCall}
                disabled={savingCall}
                className="rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
                style={{ background: 'var(--emerald, #0A4D3C)', color: 'var(--cream-pure, #F5EFE3)', border: 'none' }}
              >
                {savingCall ? 'Saving…' : 'Save call'}
              </button>
            </div>
            {callError && <p className="text-[11px] text-rose-400 mt-2">Could not save: {callError}</p>}
          </div>

          <div>
            <div className="text-[10px] uppercase tracking-[0.14em] text-muted mb-2">Recent calls</div>
            {!callsLoaded ? (
              <p className="text-sm text-muted">Loading…</p>
            ) : calls.length === 0 ? (
              <p className="text-sm text-muted">No calls logged yet. Your first one will show here.</p>
            ) : (
              <ul className="space-y-2">
                {calls.map((c) => (
                  <li key={c.callLogId} className="rounded-xl border border-border bg-white p-3">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm text-ink font-medium">{outcomeLabel(c.outcome)}</span>
                      <span className="text-[11px] text-muted">{fmtDateTime(c.calledAt)}</span>
                    </div>
                    {c.notes && <p className="text-xs text-muted mt-1 leading-relaxed">{c.notes}</p>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {active === 'Notes' && (
        <div className="space-y-5">
          <div className="rounded-2xl border border-border bg-white p-5">
            <div className="text-[10px] uppercase tracking-[0.14em] text-[#0A4D3C] mb-3">Add a note</div>
            <textarea
              value={noteBody}
              onChange={(e) => setNoteBody(e.target.value)}
              disabled={savingNote}
              rows={3}
              placeholder="Anything worth remembering about this lead…"
              className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-ink"
            />
            <div className="flex items-center justify-end gap-3 mt-2">
              {noteError && <span className="text-[11px] text-rose-400">Could not save: {noteError}</span>}
              <button
                onClick={addNote}
                disabled={savingNote || !noteBody.trim()}
                className="rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
                style={{ background: 'var(--emerald, #0A4D3C)', color: 'var(--cream-pure, #F5EFE3)', border: 'none' }}
              >
                {savingNote ? 'Saving…' : 'Save note'}
              </button>
            </div>
          </div>

          <div>
            <div className="text-[10px] uppercase tracking-[0.14em] text-muted mb-2">Notes</div>
            {!notesLoaded ? (
              <p className="text-sm text-muted">Loading…</p>
            ) : notes.length === 0 ? (
              <p className="text-sm text-muted">No notes yet.</p>
            ) : (
              <ul className="space-y-2">
                {notes.map((n) => (
                  <li key={n.noteId} className="rounded-xl border border-border bg-white p-3">
                    <p className="text-sm text-ink leading-relaxed whitespace-pre-wrap">{n.body}</p>
                    <div className="text-[11px] text-muted mt-1">{fmtDateTime(n.createdAt)}</div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {active === 'Outreach' && (
        <div>
          <div className="text-[10px] uppercase tracking-[0.14em] text-muted mb-2">Outreach history</div>
          {lead.outreach.length === 0 ? (
            <p className="text-sm text-muted leading-relaxed">
              No outreach has gone out for this lead yet. When emails are sent on your behalf, they&apos;ll show here with their status and any replies.
            </p>
          ) : (
            <ul className="space-y-2">
              {lead.outreach.map((m) => (
                <li key={m.id} className="rounded-xl border border-border bg-white p-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm text-ink font-medium truncate">{m.subject || '(no subject)'}</span>
                    {m.status && (
                      <span className="text-[10px] uppercase tracking-[0.12em] text-muted shrink-0">{m.status}</span>
                    )}
                  </div>
                  <div className="text-[11px] text-muted mt-1 flex flex-wrap gap-x-4">
                    {m.sentAt && <span>Sent {fmtDateTime(m.sentAt)}</span>}
                    {m.repliedAt && <span style={{ color: '#0A4D3C' }}>Replied {fmtDateTime(m.repliedAt)}</span>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {active === 'AI Scoring' &&
        (lead.score !== null ? (
          <div className="space-y-5">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <ScoreCard label="Overall" value={String(Math.round(lead.score))} />
              {tone && <ScoreCard label="Band" value={tone.label} />}
              {lead.engagementScore != null && <ScoreCard label="Engagement" value={String(Math.round(lead.engagementScore))} />}
            </div>
            {lead.breakdown && (
              <div className="rounded-xl border border-border bg-white p-5 space-y-3">
                <div className="text-[10px] uppercase tracking-[0.14em] text-muted">How this lead scores</div>
                <Bar label="Fit" value={lead.breakdown.fit} />
                <Bar label="Intent" value={lead.breakdown.intent} />
                <Bar label="Reachability" value={lead.breakdown.reachability} />
                <Bar label="ICP match" value={lead.breakdown.icp_match} />
              </div>
            )}
            {lead.scoreReason && (
              <div className="rounded-xl border border-border bg-white p-4">
                <div className="text-[10px] uppercase tracking-[0.14em] text-muted mb-1.5">Why this score</div>
                <p className="text-sm text-ink leading-relaxed">{lead.scoreReason}</p>
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted">This lead hasn&apos;t been scored yet. It will be ranked as soon as we have enough on it.</p>
        ))}

      {active === 'Commercials' && (
        <div className="rounded-2xl border border-dashed border-border bg-white/60 p-8 text-center">
          <div className="text-2xl mb-2" aria-hidden="true">&#x1F3AC;</div>
          <h2 className="text-base font-semibold text-ink">Commercials are coming soon</h2>
          <p className="text-sm text-muted mt-2 max-w-md mx-auto leading-relaxed">
            Short, on-brand video built around this lead will live here. We&apos;ll let you know the moment it&apos;s ready for you.
          </p>
        </div>
      )}
    </div>
  );
}
