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
  /** (#207) Address columns (#180) already feed the AI prompts; now also rendered. */
  addressStreet?: string | null;
  addressCity?: string | null;
  addressState?: string | null;
  addressPostal?: string | null;
  addressCountry?: string | null;
  /** (#212) Estimated employee count from Apollo enrichment (source_payload). */
  employeeCount?: number | null;
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
  clientId?: number | null;
  dealUnitCount?: number | null;
  dealFlatCents?: number | null;
  dealModel?: { mode: 'per_head' | 'flat'; rateCents: number | null; unitLabel: string } | null;
  dealMonthlyCents?: number | null;
  dealAnnualCents?: number | null;
  auditLenses?: Array<{ lens: string; auditContent: string | null; aiScore: number | null; aiScoreBand: string | null; generatedAt: string | null }>;
}

function lensLabel(lens: string): string {
  if (lens === 'av') return 'Atlantic & Vine';
  if (lens === 'ebw') return 'Events by Water';
  if (lens === 'hh') return 'HunterHoney';
  if (lens.startsWith('client:')) return `Client #${lens.slice(7)}`;
  return lens;
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
  const [auditLens, setAuditLens] = useState<string | null>(null);
  const [lensList, setLensList] = useState<NonNullable<Lead['auditLenses']>>(lead.auditLenses ?? []);
  const [genLens, setGenLens] = useState<string>('av');
  const [genBusy, setGenBusy] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);

  // Identity tab — editable status + follow-up date + identity fields
  const [status, setStatus] = useState(lead.leadStatus);
  const [followUp, setFollowUp] = useState(lead.followUpDate ? lead.followUpDate.slice(0, 10) : '');
  const [savingIdent, setSavingIdent] = useState(false);
  const [identSavedAt, setIdentSavedAt] = useState<string | null>(null);
  const [identError, setIdentError] = useState<string | null>(null);
  // (#267) Editable identity fields — once val learns the real values she
  // overwrites the placeholders (NDVIP came in as "Ndvip", needs real name).
  // Initial state is the lead's current value; dirty-detection is at save time
  // by comparing against the original `lead.*` prop.
  const [companyEdit, setCompanyEdit] = useState<string>(lead.company ?? '');
  const [contactNameEdit, setContactNameEdit] = useState<string>(lead.contactName ?? '');
  const [contactTitleEdit, setContactTitleEdit] = useState<string>(lead.contactTitle ?? '');
  const [emailEdit, setEmailEdit] = useState<string>(lead.email ?? '');
  const [phoneEdit, setPhoneEdit] = useState<string>(lead.phone ?? '');
  const [websiteEdit, setWebsiteEdit] = useState<string>(lead.website ?? '');
  const [industryEdit, setIndustryEdit] = useState<string>(lead.industry ?? '');

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
      // (#267) Identity field edits — only send fields that changed so we
      // don't no-op-stomp values another process just updated (e.g. an
      // in-flight enrichment writing email while val saves contact name).
      const nullEq = (a: string, b: string | null | undefined) =>
        (a.trim() === '' && (b == null || b === '')) || a.trim() === (b ?? '').trim();
      if (!nullEq(companyEdit, lead.company)) body.company = companyEdit.trim() || null;
      if (!nullEq(contactNameEdit, lead.contactName)) body.contactName = contactNameEdit.trim() || null;
      if (!nullEq(contactTitleEdit, lead.contactTitle)) body.contactTitle = contactTitleEdit.trim() || null;
      if (!nullEq(emailEdit, lead.email)) body.email = emailEdit.trim() || null;
      if (!nullEq(phoneEdit, lead.phone)) body.phone = phoneEdit.trim() || null;
      if (!nullEq(websiteEdit, lead.website)) body.website = websiteEdit.trim() || null;
      if (!nullEq(industryEdit, lead.industry)) body.industry = industryEdit.trim() || null;
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

  const refreshLenses = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/av/leads/${lead.auditId}`);
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data?.lead?.auditLenses)) setLensList(data.lead.auditLenses);
    } catch {
      /* non-fatal: keep the current lens list */
    }
  }, [lead.auditId]);

  // Generate an audit + call script for an explicit seller lens. Stored ONLY
  // under that lens (no-drift) — never touches the owner's audit.
  async function generateForLens() {
    setGenBusy(true);
    setGenError(null);
    try {
      const res = await fetch(`/api/admin/av/leads/${lead.auditId}/generate-lens`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lens: genLens })
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.ok) throw new Error(j.error || `HTTP ${res.status}`);
      await refreshLenses();
      setAuditLens(genLens); // jump the picker to the lens we just generated
    } catch (e) {
      setGenError((e as Error).message);
    } finally {
      setGenBusy(false);
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
          {/* (#267) Editable identity fields. Each input keeps its own local
              state; saveIdentity sends only the deltas vs the lead's current
              value, so we don't stomp concurrent enrichment writes. */}
          <EditableField label="Company" value={companyEdit} onChange={setCompanyEdit} placeholder="e.g. NDVIP" />
          <EditableField label="Contact name" value={contactNameEdit} onChange={setContactNameEdit} placeholder="Full name" />
          <EditableField label="Contact title" value={contactTitleEdit} onChange={setContactTitleEdit} placeholder="e.g. CEO" />
          <EditableField label="Email" value={emailEdit} onChange={setEmailEdit} placeholder="name@company.com" type="email" />
          <EditableField label="Phone" value={phoneEdit} onChange={setPhoneEdit} placeholder="+1 …" type="tel" />
          <EditableField label="Website" value={websiteEdit} onChange={setWebsiteEdit} placeholder="https://…" type="url" />
          <EditableField label="Industry" value={industryEdit} onChange={setIndustryEdit} placeholder="e.g. Healthcare Technology" />
          {/* (#212) Employee count from Apollo enrichment. Shows nothing when
              the lead wasn't Apollo-sourced or Apollo didn't size the org. */}
          {typeof lead.employeeCount === 'number' && lead.employeeCount > 0 && (
            <Field label="Employees (est.)" value={lead.employeeCount.toLocaleString()} />
          )}

          {/* (#207) Address rendered at the bottom of the identity grid. The
              same geography is what feeds the AI prompts (#180 / #196) -- now
              visible to the operator too. Joined into one human-readable
              line. Spans both columns. */}
          {(() => {
            const parts = [
              lead.addressStreet,
              lead.addressCity,
              lead.addressState,
              lead.addressPostal,
              lead.addressCountry
            ].filter((v): v is string => !!(v && v.trim()));
            if (parts.length === 0) return null;
            return (
              <div className="md:col-span-2">
                <Field label="Address" value={parts.join(', ')} />
              </div>
            );
          })()}

          <div className="md:col-span-2 border-t border-border pt-4">
            <div className="field-label mb-2">Enrichment</div>
            {lead.enrichmentStatus === 'enriched' ? (
              <div className="bg-surface border border-border rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="inline-flex items-center gap-1.5 text-sm font-medium">
                    <span className="text-amber-400">✨</span> Contact details verified
                  </span>
                  {lead.enrichedAt && (
                    <span className="text-xs text-muted">
                      {fmtDateTime(lead.enrichedAt)}
                    </span>
                  )}
                </div>
                <div className="text-xs text-muted leading-relaxed">
                  Found{' '}
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

          <div className="md:col-span-2">
            <DealValueEditor lead={lead} />
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
              className="px-4 py-2 bg-brand text-black text-sm font-medium rounded-md hover:opacity-90 disabled:opacity-50"
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

      {active === 'Audit' && (() => {
        const lenses = lensList;
        const ownerLens = lead.clientId ? `client:${lead.clientId}` : 'av';
        const selected = auditLens
          ?? (lenses.find((l) => l.lens === ownerLens)?.lens)
          ?? lenses[0]?.lens
          ?? null;
        const current = selected ? (lenses.find((l) => l.lens === selected) ?? null) : null;
        const content = current?.auditContent ?? lead.auditContent;
        const generatedAt = current?.generatedAt ?? lead.auditGenerated;
        const genOptions = Array.from(new Set<string>(['av', 'ebw', 'hh', ownerLens]));
        return (
          <div>
            {lenses.length > 0 && (
              <>
                <div className="text-[10px] uppercase tracking-[0.14em] text-muted mb-1.5">Seller lens</div>
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {lenses.map((l) => (
                    <button
                      key={l.lens}
                      onClick={() => setAuditLens(l.lens)}
                      className={[
                        'text-xs px-3 py-1.5 rounded-full border transition-colors',
                        selected === l.lens
                          ? 'border-brand text-ink bg-[var(--surface-2)]'
                          : 'border-border text-muted hover:text-ink'
                      ].join(' ')}
                    >
                      {lensLabel(l.lens)}{l.aiScore != null ? ` · ${l.aiScore}` : ''}
                    </button>
                  ))}
                </div>
              </>
            )}
            {content ? (
              <>
                <pre className="whitespace-pre-wrap text-sm leading-relaxed font-mono bg-surface border border-border rounded-lg p-5 max-h-[65vh] overflow-y-auto">
                  {content}
                </pre>
                {generatedAt && (
                  <p className="text-xs text-muted mt-2">Generated {fmtDateTime(generatedAt)}</p>
                )}
                {lenses.length > 1 && selected && (
                  <p className="text-[11px] text-muted mt-2">
                    This lead has {lenses.length} seller lenses, each kept separately — you&apos;re viewing the{' '}
                    <span className="text-ink">{lensLabel(selected)}</span> lens. Re-scoring under a given owner updates only that lens.
                  </p>
                )}
              </>
            ) : (
              <Empty message="No audit content yet. The AI audit generates after the lead is scored." />
            )}

            <div className="mt-5 border-t border-border pt-4">
              <div className="text-[10px] uppercase tracking-[0.14em] text-muted mb-1.5">
                Generate for another lens
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={genLens}
                  onChange={(e) => setGenLens(e.target.value)}
                  disabled={genBusy}
                  className="text-xs bg-surface border border-border rounded-md px-2.5 py-1.5 text-ink"
                >
                  {genOptions.map((l) => (
                    <option key={l} value={l}>
                      {lensLabel(l)}
                      {lenses.some((x) => x.lens === l) ? ' (regenerate)' : ''}
                    </option>
                  ))}
                </select>
                <button
                  onClick={generateForLens}
                  disabled={genBusy}
                  className="text-xs px-3 py-1.5 rounded-md border border-brand text-ink bg-[var(--surface-2)] hover:opacity-90 disabled:opacity-50"
                >
                  {genBusy ? 'Generating…' : 'Generate'}
                </button>
              </div>
              <p className="text-[11px] text-muted mt-2">
                Builds an audit + call script from that seller&apos;s vantage (e.g. pitch this lead as
                Events by Water) and saves it under that lens only — the owner&apos;s audit is untouched.
              </p>
              {genError && <p className="text-[11px] text-rose-400 mt-1.5">Could not generate: {genError}</p>}
            </div>
          </div>
        );
      })()}

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
                className="px-4 py-2 bg-brand text-black text-sm font-medium rounded-md hover:opacity-90 disabled:opacity-50"
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

/** (#267) Editable lead identity field. Same visual rhythm as Field, but with
 *  a thin underline input. Local state lives in the parent so saveIdentity
 *  can read all fields at once. */
function EditableField({
  label,
  value,
  onChange,
  placeholder,
  type = 'text'
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: 'text' | 'email' | 'url' | 'tel';
}) {
  return (
    <div>
      <div className="field-label">{label}</div>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-0.5 w-full text-sm bg-transparent border-b border-border focus:border-amber-400/50 focus:outline-none py-1 transition-colors"
      />
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

function fmtUsd(cents: number | null | undefined): string {
  if (cents == null) return '—';
  return Math.round(cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

/**
 * DealValueEditor — enter the metric that drives a lead's value under the owning
 * client's deal model (per-head count, or a flat monthly amount), and see the
 * monthly + annual value live. Saves via PATCH (dealUnitCount / dealFlatCents).
 */
function DealValueEditor({ lead }: { lead: Lead }) {
  const model = lead.dealModel ?? null;
  const [count, setCount] = useState<string>(lead.dealUnitCount != null ? String(lead.dealUnitCount) : '');
  const [flat, setFlat] = useState<string>(lead.dealFlatCents != null ? String(Math.round(lead.dealFlatCents / 100)) : '');
  const [busy, setBusy] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  let monthlyCents: number | null = null;
  if (model?.mode === 'per_head' && model.rateCents != null) {
    const n = parseInt(count, 10);
    monthlyCents = Number.isFinite(n) && n >= 0 ? model.rateCents * n : null;
  } else if (model?.mode === 'flat') {
    const d = parseFloat(flat);
    monthlyCents = Number.isFinite(d) && d >= 0 ? Math.round(d * 100) : null;
  }
  const annual = monthlyCents == null ? null : monthlyCents * 12;

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      const body: Record<string, unknown> = {};
      if (model?.mode === 'per_head') {
        const n = parseInt(count, 10);
        body.dealUnitCount = count.trim() === '' ? null : Number.isFinite(n) ? n : 0;
      } else {
        const d = parseFloat(flat);
        body.dealFlatCents = flat.trim() === '' ? null : Number.isFinite(d) ? Math.round(d * 100) : 0;
      }
      const res = await fetch(`/api/admin/av/leads/${lead.auditId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      setSavedAt(new Date().toLocaleTimeString());
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!model) {
    return (
      <div className="border-t border-border pt-4">
        <div className="field-label mb-1">Deal value</div>
        <p className="text-sm text-muted">
          {lead.clientId
            ? 'This client has no deal model set yet — set one on the client page (per-head rate or flat) to value this lead.'
            : 'Deal value applies to client-owned leads. Assign this lead to a client whose deal model is set to value it.'}
        </p>
      </div>
    );
  }

  return (
    <div className="border-t border-border pt-4">
      <div className="field-label mb-2">Deal value</div>
      <div className="flex flex-wrap items-end gap-3">
        {model.mode === 'per_head' ? (
          <div>
            <label className="block text-[11px] uppercase tracking-wider text-muted mb-1"># {model.unitLabel}s</label>
            <input
              type="number"
              min={0}
              value={count}
              onChange={(e) => setCount(e.target.value)}
              placeholder="0"
              className="w-32 px-3 py-2 rounded-md border border-border bg-surface text-ink text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            />
            <div className="text-[11px] text-muted mt-1">× {fmtUsd(model.rateCents)}/{model.unitLabel}/mo</div>
          </div>
        ) : (
          <div>
            <label className="block text-[11px] uppercase tracking-wider text-muted mb-1">Monthly value ($)</label>
            <input
              type="number"
              min={0}
              value={flat}
              onChange={(e) => setFlat(e.target.value)}
              placeholder="0"
              className="w-36 px-3 py-2 rounded-md border border-border bg-surface text-ink text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            />
          </div>
        )}
        <div className="px-4 py-2 rounded-md bg-surface border border-border">
          <div className="text-[10px] uppercase tracking-wider text-muted">Monthly</div>
          <div className="text-lg font-semibold text-ink tabular-nums">{fmtUsd(monthlyCents)}</div>
        </div>
        <div className="px-4 py-2 rounded-md bg-surface border border-border">
          <div className="text-[10px] uppercase tracking-wider text-muted">Annual</div>
          <div className="text-lg font-semibold text-ink tabular-nums">{fmtUsd(annual)}</div>
        </div>
        <button
          onClick={save}
          disabled={busy}
          className="px-4 py-2 bg-brand text-black text-sm font-medium rounded-md hover:opacity-90 disabled:opacity-50"
        >
          {busy ? 'Saving…' : 'Save value'}
        </button>
        {savedAt && !err && <span className="text-xs text-muted">Saved {savedAt}</span>}
        {err && <span className="text-xs text-rose-300">Error: {err}</span>}
      </div>
    </div>
  );
}
