'use client';
import { useEffect, useState, useCallback } from 'react';
import { StatusBadge } from '@/components/StatusBadge';

const TABS = ['Identity', 'Audit', 'Challenge', 'AI Scoring', 'Notes', 'Events'] as const;
type Tab = (typeof TABS)[number];

interface Lead {
  id: number;
  auditId: string;
  company: string;
  contactName: string | null;
  email: string;
  phone: string | null;
  website: string | null;
  industry: string | null;
  challenge: string | null;
  auditContent: string | null;
  auditGenerated: string | null;
  isApproved: boolean;
  approvalDate: string | null;
  approvedBy: string | null;
  submissionDate: string;
  leadStatus: string;
  followUpDate: string | null;
  notes: string | null;
  aiScore: number | null;
  aiScoreBand: string | null;
  aiScoreReason: string | null;
  aiEmailSubject: string | null;
  aiEmailBody: string | null;
  aiLastScoredAt: string | null;
  aiModelVersion: string | null;
  sourceType: string;
}

interface NoteEntry {
  noteId: number;
  body: string;
  authorUserId: number | null;
  authorRole: string;
  isInternal: boolean;
  createdAt: string;
}

interface EventEntry {
  eventId: number;
  eventType: string;
  eventPayload: Record<string, unknown> | null;
  actorUserId: number | null;
  actorRole: string | null;
  occurredAt: string;
}

const VALID_STATUSES = ['new', 'contacted', 'qualified', 'converted', 'lost'] as const;
const EVENT_LABEL: Record<string, string> = {
  created: 'Lead created',
  stage_changed: 'Stage changed',
  note_added: 'Note added',
  tag_added: 'Tags updated',
  tag_removed: 'Tag removed',
  archived: 'Archived',
  exported: 'Exported',
  deleted: 'Deleted',
  ai_scored: 'AI scored',
  ai_audited: 'AI audited',
  ai_email_drafted: 'AI drafted email',
  email_opened: 'Email opened',
  email_clicked: 'Email clicked'
};

export function LeadDetailTabs({ lead }: { lead: Lead }) {
  const [active, setActive] = useState<Tab>('Identity');
  const [legacyOpen, setLegacyOpen] = useState(false);

  // Identity tab — editable status + follow-up date
  const [status, setStatus] = useState(lead.leadStatus);
  const [followUp, setFollowUp] = useState(lead.followUpDate ? lead.followUpDate.slice(0, 10) : '');
  const [savingIdent, setSavingIdent] = useState(false);
  const [identSavedAt, setIdentSavedAt] = useState<string | null>(null);
  const [identError, setIdentError] = useState<string | null>(null);

  // Notes tab
  const [notes, setNotes] = useState<NoteEntry[]>([]);
  const [notesLoaded, setNotesLoaded] = useState(false);
  const [noteBody, setNoteBody] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);

  // Events tab
  const [events, setEvents] = useState<EventEntry[]>([]);
  const [eventsLoaded, setEventsLoaded] = useState(false);

  const fetchNotes = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/av/leads/${lead.auditId}/notes`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setNotes(data.notes || []);
    } catch (e) {
      setNoteError((e as Error).message);
    } finally {
      setNotesLoaded(true);
    }
  }, [lead.auditId]);

  const fetchEvents = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/av/leads/${lead.auditId}/events`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setEvents(data.events || []);
    } catch {
      // Surface inline if needed; for now silent
    } finally {
      setEventsLoaded(true);
    }
  }, [lead.auditId]);

  useEffect(() => {
    if (active === 'Notes' && !notesLoaded) fetchNotes();
    if (active === 'Events' && !eventsLoaded) fetchEvents();
  }, [active, notesLoaded, eventsLoaded, fetchNotes, fetchEvents]);

  async function saveIdentity() {
    setSavingIdent(true);
    setIdentError(null);
    try {
      const body: Record<string, unknown> = {};
      if (status !== lead.leadStatus) body.leadStatus = status;
      body.followUpDate = followUp || null;
      const res = await fetch(`/api/admin/av/leads/${lead.auditId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${res.status}`);
      }
      setIdentSavedAt(new Date().toLocaleTimeString());
      // Refresh events so the change shows in the timeline next time it's opened
      setEventsLoaded(false);
    } catch (e) {
      setIdentError((e as Error).message);
    } finally {
      setSavingIdent(false);
    }
  }

  async function saveNote() {
    const trimmed = noteBody.trim();
    if (!trimmed) return;
    setSavingNote(true);
    setNoteError(null);
    try {
      const res = await fetch(`/api/admin/av/leads/${lead.auditId}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: trimmed })
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setNotes((prev) => [data.note, ...prev]);
      setNoteBody('');
      setEventsLoaded(false);
    } catch (e) {
      setNoteError((e as Error).message);
    } finally {
      setSavingNote(false);
    }
  }

  return (
    <div>
      <div className="flex gap-0 border-b border-border mb-6 overflow-x-auto">
        {TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setActive(tab)}
            className={[
              'px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap',
              active === tab
                ? 'border-brand text-ink'
                : 'border-transparent text-muted hover:text-ink'
            ].join(' ')}
          >
            {tab}
          </button>
        ))}
      </div>

      {active === 'Identity' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <Field label="Company" value={lead.company} />
          <Field label="Contact name" value={lead.contactName} />
          <Field label="Email" value={lead.email} />
          <Field label="Phone" value={lead.phone} />
          <Field label="Website" value={lead.website} />
          <Field label="Industry" value={lead.industry} />

          <div>
            <div className="field-label">Stage</div>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="mt-1 w-full border border-border rounded-md px-3 py-1.5 text-sm bg-surface"
            >
              {VALID_STATUSES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          <div>
            <div className="field-label">Follow-up date</div>
            <input
              type="date"
              value={followUp}
              onChange={(e) => setFollowUp(e.target.value)}
              className="mt-1 w-full border border-border rounded-md px-3 py-1.5 text-sm bg-surface"
            />
          </div>

          <div>
            <div className="field-label">AI score band</div>
            {lead.aiScoreBand ? (
              <StatusBadge value={lead.aiScoreBand} />
            ) : (
              <span className="text-muted text-sm">pending</span>
            )}
          </div>

          <div className="md:col-span-2 flex items-center gap-3">
            <button
              onClick={saveIdentity}
              disabled={savingIdent}
              className="px-4 py-2 bg-brand text-white text-sm font-medium rounded-md hover:opacity-90 disabled:opacity-50"
            >
              {savingIdent ? 'Saving…' : 'Save changes'}
            </button>
            {identSavedAt && !identError && (
              <span className="text-xs text-muted">Saved at {identSavedAt}</span>
            )}
            {identError && (
              <span className="text-xs text-red-600">Error: {identError}</span>
            )}
          </div>

          <div className="col-span-full border-t border-border pt-4">
            <button
              onClick={() => setLegacyOpen((o) => !o)}
              className="text-xs text-muted hover:text-ink flex items-center gap-1.5 transition-colors"
            >
              <span>{legacyOpen ? '▾' : '▸'}</span>
              Legacy operator fields
            </button>
            {legacyOpen && (
              <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-4 border border-border rounded-lg p-4">
                <Field label="Approved" value={lead.isApproved ? 'Yes' : 'No'} />
                <Field label="Approval date" value={lead.approvalDate ? new Date(lead.approvalDate).toLocaleString() : null} />
                <Field label="Approved by" value={lead.approvedBy} />
                <Field label="Source type" value={lead.sourceType} />
                <Field label="Internal id" value={String(lead.id)} />
                <div className="col-span-full">
                  <Field label="Legacy notes (free-text on leads.notes)" value={lead.notes} />
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {active === 'Audit' && (
        <div>
          {lead.auditContent ? (
            <>
              <pre className="whitespace-pre-wrap text-sm leading-relaxed font-mono bg-surface border border-border rounded-lg p-5 max-h-[65vh] overflow-y-auto">
                {lead.auditContent}
              </pre>
              {lead.auditGenerated && (
                <p className="text-xs text-muted mt-2">
                  Generated {new Date(lead.auditGenerated).toLocaleString()}
                </p>
              )}
            </>
          ) : (
            <Empty message="No audit content yet. The AI audit generates after the lead is scored in Phase 2." />
          )}
        </div>
      )}

      {active === 'Challenge' && (
        <div>
          {lead.challenge ? (
            <div className="bg-surface border border-border rounded-lg p-5 text-sm leading-relaxed">
              {lead.challenge}
            </div>
          ) : (
            <Empty message="No challenge statement recorded for this lead." />
          )}
        </div>
      )}

      {active === 'AI Scoring' && (
        <div>
          {lead.aiScore !== null ? (
            <div className="space-y-5">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <ScoreCard label="Score" value={String(lead.aiScore)} />
                <ScoreCard label="Band" value={lead.aiScoreBand ?? '—'} />
                <ScoreCard label="Model" value={lead.aiModelVersion ?? '—'} />
              </div>
              {lead.aiScoreReason && (
                <Section label="Score reason">
                  <p className="text-sm">{lead.aiScoreReason}</p>
                </Section>
              )}
              {lead.aiEmailSubject && (
                <Section label="Draft subject line">
                  <p className="text-sm font-medium">{lead.aiEmailSubject}</p>
                </Section>
              )}
              {lead.aiEmailBody && (
                <Section label="Draft email body">
                  <pre className="whitespace-pre-wrap text-sm bg-surface border border-border rounded-lg p-4 max-h-72 overflow-y-auto">
                    {lead.aiEmailBody}
                  </pre>
                </Section>
              )}
              {lead.aiLastScoredAt && (
                <p className="text-xs text-muted">
                  Scored {new Date(lead.aiLastScoredAt).toLocaleString()}
                </p>
              )}
            </div>
          ) : (
            <Empty message="AI scoring has not run yet. Phase 2 will wire the scoring pipeline against shhdbite_AV." />
          )}
        </div>
      )}

      {active === 'Notes' && (
        <div className="space-y-5">
          <div className="bg-surface border border-border rounded-lg p-4">
            <div className="field-label mb-2">Add a note</div>
            <textarea
              value={noteBody}
              onChange={(e) => setNoteBody(e.target.value)}
              placeholder="What did they say? Objections? Decision-maker info? Anything you want to remember next time."
              rows={4}
              className="w-full border border-border rounded-md px-3 py-2 text-sm bg-white"
            />
            <div className="flex items-center gap-3 mt-2">
              <button
                onClick={saveNote}
                disabled={savingNote || !noteBody.trim()}
                className="px-4 py-2 bg-brand text-white text-sm font-medium rounded-md hover:opacity-90 disabled:opacity-50"
              >
                {savingNote ? 'Saving…' : 'Save note'}
              </button>
              <span className="text-xs text-muted">{noteBody.length} / 8000</span>
              {noteError && <span className="text-xs text-red-600">Error: {noteError}</span>}
            </div>
          </div>

          <div>
            <div className="field-label mb-2">Past notes</div>
            {!notesLoaded ? (
              <p className="text-sm text-muted">Loading…</p>
            ) : notes.length === 0 ? (
              <Empty message="No notes yet — be the first." />
            ) : (
              <ul className="space-y-3">
                {notes.map((n) => (
                  <li key={n.noteId} className="bg-surface border border-border rounded-lg p-4">
                    <div className="flex items-center justify-between text-xs text-muted mb-2">
                      <span>{n.authorRole}{n.isInternal ? ' · internal' : ''}</span>
                      <span>{new Date(n.createdAt).toLocaleString()}</span>
                    </div>
                    <p className="text-sm whitespace-pre-wrap leading-relaxed">{n.body}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {active === 'Events' && (
        <div>
          {!eventsLoaded ? (
            <p className="text-sm text-muted">Loading…</p>
          ) : events.length === 0 ? (
            <Empty message="No events recorded for this lead yet." />
          ) : (
            <ul className="space-y-2">
              {events.map((e) => (
                <li key={e.eventId} className="flex items-start gap-3 bg-surface border border-border rounded-lg px-4 py-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium">{EVENT_LABEL[e.eventType] || e.eventType}</div>
                    {e.eventPayload && (
                      <pre className="mt-1 text-xs text-muted whitespace-pre-wrap break-words">{JSON.stringify(e.eventPayload, null, 0)}</pre>
                    )}
                  </div>
                  <div className="text-xs text-muted whitespace-nowrap">{new Date(e.occurredAt).toLocaleString()}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <div className="field-label">{label}</div>
      <div className="text-sm mt-0.5">{value ?? <span className="text-muted">—</span>}</div>
    </div>
  );
}

function ScoreCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-surface border border-border rounded-lg p-4">
      <div className="field-label">{label}</div>
      <div className="text-2xl font-semibold mt-1">{value}</div>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="field-label mb-2">{label}</div>
      {children}
    </div>
  );
}

function Empty({ message }: { message: string }) {
  return (
    <div className="px-6 py-12 text-center text-sm text-muted bg-surface border border-border rounded-lg">
      {message}
    </div>
  );
}
