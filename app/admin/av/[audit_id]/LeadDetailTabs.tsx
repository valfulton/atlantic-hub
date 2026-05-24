'use client';
import { useEffect, useState, useCallback } from 'react';
import { StatusBadge } from '@/components/StatusBadge';
import { fmtDate, fmtDateTime } from '@/lib/format/datetime';
import { ScoreRadarChart } from '@/components/ScoreRadarChart';
import { ScoreSparkline } from '@/components/ScoreSparkline';
import { PainPointCallout } from './PainPointCallout';
import { CallLogPanel } from './CallLogPanel';
import { LifecycleControls } from './LifecycleControls';
import { celebrateConversion } from '@/components/ConversionConfetti';
import { CommercialPanel } from './CommercialPanel';
import { OutreachPanel } from './OutreachPanel';

const TABS = ['Identity', 'Audit', 'Challenge', 'AI Scoring', 'Calls', 'Commercials', 'Outreach', 'Notes', 'Events'] as const;
type Tab = (typeof TABS)[number];

interface Lead {
  id: number;
  auditId: string;
  company: string;
  contactName: string | null;
  contactTitle: string | null;
  enrichmentStatus: string | null;
  enrichedAt: string | null;
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
  aiScoreBreakdown: {
    fit: number;
    intent: number;
    reachability: number;
    icp_match: number;
  } | null;
  aiEmailSubject: string | null;
  aiEmailBody: string | null;
  aiLastScoredAt: string | null;
  aiModelVersion: string | null;
  aiEngagementScore?: number;
  aiCombinedScore?: number | null;
  engagementScoreUpdatedAt?: string | null;
  painPointProfile?: {
    primary_pain: string;
    urgency_signal: 'high' | 'medium' | 'low' | 'unknown';
    decision_maker_proximity: 'direct' | 'team_member' | 'unclear';
    budget_signal: 'strong' | 'possible' | 'weak' | 'unknown';
    timing_signal: 'now' | 'this_quarter' | 'later' | 'unknown';
    last_objection_seen: string | null;
    conversation_starters: string[];
    do_not_say: string[];
    extracted_at: string;
  } | null;
  painExtractedAt?: string | null;
  assignedToUserId?: number | null;
  handedToOwnerAt?: string | null;
  wakeAtDate?: string | null;
  parkedReason?: string | null;
  scoreHistory?: Array<{
    at: string;
    event_type: string;
    delta: number;
    fit: number | null;
    engagement: number;
    combined: number;
    note?: string;
  }> | null;
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
      {lead.painPointProfile && (
        <PainPointCallout
          profile={lead.painPointProfile}
          extractedAt={lead.painExtractedAt ?? null}
        />
      )}
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
          <Field label="Contact title" value={lead.contactTitle} />
          <Field label="Email" value={lead.email} />
          <Field label="Phone" value={lead.phone} />
          <Field label="Website" value={lead.website} />
          <Field label="Industry" value={lead.industry} />

          <div className="md:col-span-2 border-t border-border pt-4">
            <div className="field-label mb-2">Enrichment</div>
            {lead.enrichmentStatus === 'enriched' ? (
              <div className="bg-surface border border-border rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="inline-flex items-center gap-1.5 text-sm font-medium">
                    <span className="text-amber-400">✨</span> Enriched via Hunter.io
                  </span>
                  {lead.enrichedAt && (
                    <span className="text-xs text-muted">
                      {fmtDateTime(lead.enrichedAt)}
                    </span>
                  )}
                </div>
                <div className="text-xs text-muted leading-relaxed">
                  Hunter found{' '}
                  <span className="text-ink">{lead.contactName || 'a contact'}</span>
                  {lead.contactTitle && (
                    <>
                      {' '}as <span className="text-ink">{lead.contactTitle}</span>
                    </>
                  )}{' '}
                  at this company. The email and contact name above were populated by the enrichment
                  run; the source/timestamp is in the Events tab.
                </div>
              </div>
            ) : lead.enrichmentStatus === 'failed_no_domain' ? (
              <div className="bg-surface border border-border rounded-lg p-4 text-sm text-muted">
                <span className="text-amber-300">⚠</span> Not enriched — no website on file. Add a website to this lead and the next enrichment run will pick it up.
              </div>
            ) : lead.enrichmentStatus === 'failed_no_results' ? (
              <div className="bg-surface border border-border rounded-lg p-4 text-sm text-muted">
                <span className="text-muted">○</span> Hunter searched the website domain and found no contacts. The script will not retry this lead automatically. To override: clear <code className="bg-bg px-1 rounded">enrichment_status</code> in phpMyAdmin.
              </div>
            ) : lead.enrichmentStatus === 'in_progress' ? (
              <div className="bg-surface border border-border rounded-lg p-4 text-sm">
                <span className="text-amber-300">⟳</span> Enrichment is in progress on this lead right now.
              </div>
            ) : lead.enrichmentStatus === 'failed_permanent' ? (
              <div className="bg-surface border border-border rounded-lg p-4 text-sm text-muted">
                <span className="text-red-400">●</span> Manually stopped from being re-enriched.
              </div>
            ) : (
              <div className="bg-surface border border-border rounded-lg p-4 text-sm text-muted">
                Not yet enriched. Will run on the next manual or cron enrichment batch if a website is on file.
              </div>
            )}
          </div>

          <div className="md:col-span-2">
            <LifecycleControls
              auditId={lead.auditId}
              currentStatus={lead.leadStatus as 'new' | 'contacted' | 'qualified' | 'converted' | 'lost' | 'nurture' | 'not_now' | 'referred' | 'case_study'}
              currentWakeAtDate={lead.wakeAtDate ?? null}
              currentParkedReason={lead.parkedReason ?? null}
              companyName={lead.company}
              onConverted={(name) => celebrateConversion(name)}
            />
            {lead.wakeAtDate && (lead.leadStatus === 'nurture' || lead.leadStatus === 'not_now') && (
              <div className="mt-2 text-xs text-muted">
                Parked. Wakes {fmtDate(lead.wakeAtDate)}
                {lead.parkedReason ? ` -- ${lead.parkedReason}` : ''}
              </div>
            )}
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
                <Field label="Approval date" value={lead.approvalDate ? fmtDateTime(lead.approvalDate) : null} />
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
                  Generated {fmtDateTime(lead.auditGenerated)}
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
              <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-6 items-start">
                <div className="space-y-4">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <ScoreCard
                      label="Combined"
                      value={String(lead.aiCombinedScore ?? lead.aiScore ?? '-')}
                      hint="What the dashboard shows"
                    />
                    <ScoreCard
                      label="Fit"
                      value={String(lead.aiScore ?? '-')}
                      hint="Set by AI scorer"
                    />
                    <EngagementCard delta={lead.aiEngagementScore ?? 0} />
                    <ScoreCard label="Band" value={lead.aiScoreBand ?? '-'} />
                  </div>
                  {lead.scoreHistory && lead.scoreHistory.length >= 2 && (
                    <div className="bg-surface border border-border rounded-lg p-4">
                      <div className="flex items-center justify-between mb-2">
                        <div className="field-label">Score history</div>
                        <span className="text-[10px] text-muted">
                          {lead.scoreHistory.length} signals
                          {lead.engagementScoreUpdatedAt && (
                            <> {`-- last moved ${fmtDateTime(lead.engagementScoreUpdatedAt)}`}</>
                          )}
                        </span>
                      </div>
                      <div className="flex items-center gap-4">
                        <ScoreSparkline history={lead.scoreHistory} width={220} height={48} />
                        <div className="text-xs text-muted">
                          Most recent: <span className="text-ink">{lead.scoreHistory[0].event_type}</span>
                          {lead.scoreHistory[0].delta !== 0 && (
                            <span className={lead.scoreHistory[0].delta > 0 ? ' text-emerald-300' : ' text-rose-300'}>
                              {' '}({lead.scoreHistory[0].delta > 0 ? '+' : ''}{lead.scoreHistory[0].delta})
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                  {lead.aiScoreReason && (
                    <Section label="Score reason">
                      <p className="text-sm">{lead.aiScoreReason}</p>
                    </Section>
                  )}
                  <ScoreCard label="Model" value={lead.aiModelVersion ?? '-'} />
                </div>
                {lead.aiScoreBreakdown && (
                  <div className="bg-surface border border-border rounded-lg p-4">
                    <div className="field-label mb-2">Breakdown</div>
                    <ScoreRadarChart breakdown={lead.aiScoreBreakdown} />
                  </div>
                )}
              </div>
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
                  Scored {fmtDateTime(lead.aiLastScoredAt)}
                </p>
              )}
            </div>
          ) : (
            <Empty message="AI scoring has not run yet. Phase 2 will wire the scoring pipeline against shhdbite_AV." />
          )}
        </div>
      )}

      {active === 'Calls' && (
        <CallLogPanel auditId={lead.auditId} />
      )}

      {active === 'Commercials' && (
        <CommercialPanel auditId={lead.auditId} />
      )}

      {active === 'Outreach' && (
        <OutreachPanel auditId={lead.auditId} leadCompany={lead.company} />
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
                      <span>{fmtDateTime(n.createdAt)}</span>
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
                  <div className="text-xs text-muted whitespace-nowrap">{fmtDateTime(e.occurredAt)}</div>
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

function ScoreCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="bg-surface border border-border rounded-lg p-4">
      <div className="field-label">{label}</div>
      <div className="text-2xl font-semibold mt-1 tabular-nums">{value}</div>
      {hint && <div className="text-[10px] text-muted mt-1">{hint}</div>}
    </div>
  );
}

function EngagementCard({ delta }: { delta: number }) {
  const sign = delta > 0 ? '+' : '';
  const color =
    delta > 0
      ? 'text-emerald-300'
      : delta < 0
      ? 'text-rose-300'
      : 'text-ink';
  return (
    <div className="bg-surface border border-border rounded-lg p-4">
      <div className="field-label">Engagement</div>
      <div className={`text-2xl font-semibold mt-1 tabular-nums ${color}`}>
        {delta === 0 ? '0' : `${sign}${delta}`}
      </div>
      <div className="text-[10px] text-muted mt-1">
        {delta === 0
          ? 'No signals yet'
          : delta > 0
          ? 'Lead is warming up'
          : 'Lead is cooling off'}
      </div>
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
