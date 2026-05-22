'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  PR_SOURCES,
  PR_SOURCE_LABELS,
  DISTRIBUTION_CHANNELS,
  PITCH_MODES,
  PITCH_MODE_LABELS,
  type PitchMode,
  type PrSource
} from '@/lib/pr/types';
import { ArtifactsSection } from './ArtifactsSection';

type VoiceChoice = 'auto' | PitchMode;

// ---- view models (mirror the API responses) ------------------------------

interface LatestPitch {
  id: number;
  bodyText: string | null;
  status: string | null;
}
interface Opportunity {
  id: number;
  source: PrSource;
  outlet: string | null;
  journalist: string | null;
  queryText: string | null;
  topicTags: string[];
  whyItMatters: string | null;
  deadline: string | null;
  matchedLeadId: number | null;
  matchedCompany: string | null;
  status: string;
  createdAt: string;
  origin: string;
  suggested: boolean;
  relevanceScore: number | null;
  latestPitch: LatestPitch | null;
}
interface Release {
  id: number;
  leadId: number | null;
  title: string | null;
  bodyText: string | null;
  status: string;
}

interface Connection {
  id: number;
  provider: string;
  displayName: string | null;
}

interface DiscoverySource {
  id: number;
  kind: string;
  config: Record<string, unknown>;
  isActive: boolean;
  lastRunAt: string | null;
  lastStatus: string | null;
  lastDetail: string | null;
}

const STATUS_TONE: Record<string, { label: string; bg: string; fg: string }> = {
  new: { label: 'New', bg: 'rgba(59,130,246,0.16)', fg: '#93c5fd' },
  drafted: { label: 'Drafted', bg: 'rgba(245,158,11,0.16)', fg: '#fcd34d' },
  submitted: { label: 'Submitted', bg: 'rgba(16,185,129,0.16)', fg: '#6ee7b7' },
  won: { label: 'Won', bg: 'rgba(16,185,129,0.22)', fg: '#34d399' },
  passed: { label: 'Passed', bg: 'rgba(148,163,184,0.16)', fg: '#cbd5e1' },
  draft: { label: 'Draft', bg: 'rgba(245,158,11,0.16)', fg: '#fcd34d' },
  approved: { label: 'Approved', bg: 'rgba(16,185,129,0.16)', fg: '#6ee7b7' },
  published: { label: 'Published', bg: 'rgba(16,185,129,0.22)', fg: '#34d399' }
};

const ORIGIN_LABELS: Record<string, string> = {
  email_inbox: 'PR inbox',
  reddit: 'Reddit',
  rss: 'RSS',
  internal_signal: 'From your data',
  manual: 'Manual'
};

function StatusBadge({ status }: { status: string }) {
  const t = STATUS_TONE[status] ?? { label: status, bg: 'rgba(148,163,184,0.16)', fg: '#cbd5e1' };
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium"
      style={{ background: t.bg, color: t.fg }}
    >
      {t.label}
    </span>
  );
}

const cardStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,0.03)',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 14
};

export function PrDesk() {
  const [opps, setOpps] = useState<Opportunity[]>([]);
  const [releases, setReleases] = useState<Release[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // intake box
  const [rawText, setRawText] = useState('');
  const [source, setSource] = useState<PrSource>('qwoted');
  const [parsing, setParsing] = useState(false);

  // per-opportunity draft state
  const [drafting, setDrafting] = useState<number | null>(null);

  // dismiss (P3)
  const [dismissing, setDismissing] = useState<number | null>(null);

  // discovery sources (P6: Reddit / RSS + cross-layer performance sweep)
  const [sources, setSources] = useState<DiscoverySource[]>([]);
  const [runningSources, setRunningSources] = useState(false);
  const [sourcesMsg, setSourcesMsg] = useState<string | null>(null);
  const [showSources, setShowSources] = useState(false);
  const [newSourceKind, setNewSourceKind] = useState<'reddit' | 'rss'>('reddit');
  const [newSourceTargets, setNewSourceTargets] = useState('');
  const [newSourceKeywords, setNewSourceKeywords] = useState('');
  const [addingSource, setAddingSource] = useState(false);

  // discovery + orchestration state
  const [discovering, setDiscovering] = useState(false);
  const [orchestrating, setOrchestrating] = useState<number | null>(null);
  const [orchestrateMsg, setOrchestrateMsg] = useState<Record<number, string>>({});
  // oppId -> queued outbox row that can be published; cleared once posted
  const [queued, setQueued] = useState<Record<number, { outboxId: number; published: boolean }>>({});
  const [publishing, setPublishing] = useState<number | null>(null);

  // per-opportunity voice choice + editable pitch buffer
  const [voice, setVoice] = useState<Record<number, VoiceChoice>>({});
  const [editBody, setEditBody] = useState<Record<number, string>>({});
  const [savingPitch, setSavingPitch] = useState<number | null>(null);

  // scheduling across profiles
  const [connections, setConnections] = useState<Connection[]>([]);
  const [schedWhen, setSchedWhen] = useState<Record<number, string>>({});
  const [schedSel, setSchedSel] = useState<Record<number, number[]>>({});
  const [scheduling, setScheduling] = useState<number | null>(null);
  const [schedMsg, setSchedMsg] = useState<Record<number, string>>({});

  const voiceFor = useCallback((oppId: number): VoiceChoice => voice[oppId] ?? 'auto', [voice]);
  const modeArg = useCallback(
    (oppId: number): PitchMode | undefined => {
      const v = voice[oppId] ?? 'auto';
      return v === 'auto' ? undefined : v;
    },
    [voice]
  );

  // release box
  const [announcement, setAnnouncement] = useState('');
  const [releaseLeadId, setReleaseLeadId] = useState('');
  const [creatingRelease, setCreatingRelease] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [oRes, rRes, cRes, sRes] = await Promise.all([
        fetch('/api/admin/pr/opportunities', { cache: 'no-store' }),
        fetch('/api/admin/pr/releases', { cache: 'no-store' }),
        fetch('/api/admin/social/connections?tenant=av', { cache: 'no-store' }),
        fetch('/api/admin/pr/sources?tenant=av', { cache: 'no-store' })
      ]);
      const oJson = await oRes.json();
      const rJson = await rRes.json();
      if (!oRes.ok) throw new Error(oJson.error || 'failed to load opportunities');
      setOpps(oJson.items || []);
      setReleases(rJson.items || []);
      if (cRes.ok) {
        const cJson = await cRes.json();
        setConnections(cJson.items || []);
      }
      if (sRes.ok) {
        const sJson = await sRes.json();
        setSources(sJson.items || []);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const parseAndLog = useCallback(async () => {
    if (rawText.trim().length < 5) return;
    setParsing(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/pr/opportunities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'parse', rawText, source })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'parse failed');
      setOpps((prev) => [json.item as Opportunity, ...prev]);
      setRawText('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setParsing(false);
    }
  }, [rawText, source]);

  const draftPitch = useCallback(async (oppId: number) => {
    setDrafting(oppId);
    setError(null);
    try {
      const res = await fetch(`/api/admin/pr/opportunities/${oppId}/draft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: modeArg(oppId) })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'draft failed');
      setEditBody((b) => ({ ...b, [oppId]: json.pitch.bodyText ?? '' }));
      setOpps((prev) =>
        prev.map((o) =>
          o.id === oppId
            ? {
                ...o,
                status: o.status === 'new' ? 'drafted' : o.status,
                whyItMatters: json.whyItMatters || o.whyItMatters,
                latestPitch: { id: json.pitch.id, bodyText: json.pitch.bodyText, status: 'draft' }
              }
            : o
        )
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDrafting(null);
    }
  }, []);

  const runDiscovery = useCallback(async () => {
    setDiscovering(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/pr/discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'discovery failed');
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDiscovering(false);
    }
  }, [load]);

  const dismiss = useCallback(async (oppId: number) => {
    setDismissing(oppId);
    setError(null);
    try {
      const res = await fetch(`/api/admin/pr/opportunities/${oppId}/dismiss`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'dismiss failed');
      // Drop it from the desk; it is now status 'passed'.
      setOpps((prev) => prev.filter((o) => o.id !== oppId));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDismissing(null);
    }
  }, []);

  const runSources = useCallback(async () => {
    setRunningSources(true);
    setError(null);
    setSourcesMsg(null);
    try {
      const res = await fetch('/api/admin/pr/sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'run' })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'source run failed');
      const laneParsed = Array.isArray(json.lanes) ? json.lanes.reduce((n: number, l: { parsed: number }) => n + (l.parsed || 0), 0) : 0;
      const perf = json.performance?.suggestionsCreated ?? 0;
      const topInd = json.performance?.topIndustries?.[0];
      const parts = [`Found ${laneParsed} new request${laneParsed === 1 ? '' : 's'} from web sources.`];
      if (perf > 0) parts.push(`${perf} idea${perf === 1 ? '' : 's'} from what is converting.`);
      if (topInd) parts.push(`Top converting vertical: ${topInd.industry} (${topInd.wins}).`);
      if (laneParsed === 0 && perf === 0) parts.push('No new items this run.');
      setSourcesMsg(parts.join(' '));
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunningSources(false);
    }
  }, [load]);

  const addSource = useCallback(async () => {
    const targets = newSourceTargets
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!targets.length) {
      setError(newSourceKind === 'reddit' ? 'Enter at least one subreddit.' : 'Enter at least one feed URL.');
      return;
    }
    const keywords = newSourceKeywords
      .split(/[\n,]+/)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    const config =
      newSourceKind === 'reddit'
        ? { subreddits: targets, ...(keywords.length ? { keywords } : {}) }
        : { feeds: targets, ...(keywords.length ? { keywords } : {}) };
    setAddingSource(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/pr/sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'upsert', kind: newSourceKind, config })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'could not save source');
      setNewSourceTargets('');
      setNewSourceKeywords('');
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAddingSource(false);
    }
  }, [newSourceKind, newSourceTargets, newSourceKeywords, load]);

  const toggleSource = useCallback(async (id: number, isActive: boolean) => {
    setError(null);
    try {
      const res = await fetch('/api/admin/pr/sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'toggle', id, isActive })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'toggle failed');
      setSources((prev) => prev.map((s) => (s.id === id ? { ...s, isActive } : s)));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  const orchestrate = useCallback(async (oppId: number, makeCommercial: boolean) => {
    setOrchestrating(oppId);
    setError(null);
    try {
      const res = await fetch(`/api/admin/pr/opportunities/${oppId}/orchestrate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ makeCommercial, assetType: 'image', mode: modeArg(oppId) })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'orchestrate failed');
      const parts: string[] = ['Pitch ready.'];
      if (json.commercial) parts.push(`Commercial ${json.commercial.generationStatus}.`);
      if (json.social) parts.push(`Post queued to the timeline (${json.social.status}).`);
      if (json.needsConnection) parts.push('Connect a social account at /admin/social to queue the post.');
      if (Array.isArray(json.notes)) parts.push(...json.notes);
      setOrchestrateMsg((m) => ({ ...m, [oppId]: parts.join(' ') }));
      if (json.social?.outboxId) {
        setQueued((q) => ({ ...q, [oppId]: { outboxId: json.social.outboxId, published: false } }));
      }
      setEditBody((b) => ({ ...b, [oppId]: json.bodyText ?? '' }));
      setOpps((prev) =>
        prev.map((o) =>
          o.id === oppId
            ? { ...o, status: o.status === 'new' ? 'drafted' : o.status, latestPitch: { id: json.pitchId, bodyText: json.bodyText, status: 'draft' } }
            : o
        )
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setOrchestrating(null);
    }
  }, []);

  const publishPost = useCallback(async (oppId: number, outboxId: number) => {
    setPublishing(oppId);
    setError(null);
    try {
      const res = await fetch(`/api/admin/social/publish/${outboxId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || 'publish failed');
      setQueued((q) => ({ ...q, [oppId]: { outboxId, published: true } }));
      setOrchestrateMsg((m) => ({
        ...m,
        [oppId]: json.providerUrl ? `Posted: ${json.providerUrl}` : 'Posted to the connected account.'
      }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPublishing(null);
    }
  }, []);

  const scheduleAcross = useCallback(async (oppId: number) => {
    const when = schedWhen[oppId];
    const sel = schedSel[oppId] ?? [];
    if (!when) {
      setError('Pick a date and time to schedule.');
      return;
    }
    if (!sel.length) {
      setError('Select at least one profile to post to.');
      return;
    }
    setScheduling(oppId);
    setError(null);
    try {
      const res = await fetch(`/api/admin/pr/opportunities/${oppId}/schedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectionIds: sel, scheduledFor: new Date(when).toISOString() })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'schedule failed');
      setSchedMsg((m) => ({
        ...m,
        [oppId]: `Scheduled to ${json.scheduled} profile${json.scheduled === 1 ? '' : 's'} -- now on the Campaign timeline.`
      }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setScheduling(null);
    }
  }, [schedWhen, schedSel]);

  const toggleSchedProfile = useCallback((oppId: number, connId: number) => {
    setSchedSel((s) => {
      const cur = s[oppId] ?? [];
      return { ...s, [oppId]: cur.includes(connId) ? cur.filter((x) => x !== connId) : [...cur, connId] };
    });
  }, []);

  const savePitch = useCallback(async (oppId: number, pitchId: number, text: string) => {
    setSavingPitch(oppId);
    setError(null);
    try {
      const res = await fetch(`/api/admin/pr/pitches/${pitchId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bodyText: text })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'save failed');
      setOpps((prev) =>
        prev.map((o) =>
          o.id === oppId && o.latestPitch
            ? { ...o, latestPitch: { ...o.latestPitch, bodyText: text } }
            : o
        )
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSavingPitch(null);
    }
  }, []);

  const createRelease = useCallback(async () => {
    if (announcement.trim().length < 5) return;
    setCreatingRelease(true);
    setError(null);
    try {
      const leadId = releaseLeadId.trim() ? Number(releaseLeadId.trim()) : null;
      const res = await fetch('/api/admin/pr/releases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ announcement, leadId })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'release draft failed');
      setReleases((prev) => [json.item as Release, ...prev]);
      setAnnouncement('');
      setReleaseLeadId('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCreatingRelease(false);
    }
  }, [announcement, releaseLeadId]);

  const advanceRelease = useCallback(async (id: number, status: 'approved' | 'published') => {
    setError(null);
    try {
      const res = await fetch(`/api/admin/pr/releases/${id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'update failed');
      setReleases((prev) => prev.map((r) => (r.id === id ? { ...r, status } : r)));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  const renderOpp = (o: Opportunity) => (
    <li key={o.id} style={cardStyle} className="p-4">
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <span
          className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium"
          style={{ background: 'rgba(255,255,255,0.06)', color: '#e5e7eb' }}
        >
          {PR_SOURCE_LABELS[o.source] ?? o.source}
        </span>
        <StatusBadge status={o.status} />
        {o.origin && o.origin !== 'paste' && (
          <span
            className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium"
            style={{ background: 'rgba(59,130,246,0.14)', color: '#bfdbfe', border: '1px solid rgba(59,130,246,0.3)' }}
            title="How this opportunity reached the desk"
          >
            {ORIGIN_LABELS[o.origin] ?? o.origin}
          </span>
        )}
        {o.suggested && (
          <span
            className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium"
            style={{ background: 'rgba(255,156,91,0.16)', color: '#FFD9BE', border: '1px solid rgba(255,156,91,0.35)' }}
            title="We surfaced this from your own data"
          >
            Idea{o.relevanceScore != null ? ` ${o.relevanceScore}` : ''}
          </span>
        )}
        {o.deadline && <span className="text-[11px] text-amber-300">Deadline: {formatDate(o.deadline)}</span>}
        {o.matchedCompany && (
          <span className="text-[11px] text-muted">
            Matched: <span className="text-emerald-300">{o.matchedCompany}</span>
          </span>
        )}
      </div>

      {(o.outlet || o.journalist) && (
        <p className="text-xs text-muted mb-1">{[o.journalist, o.outlet].filter(Boolean).join(' - ')}</p>
      )}

      <p className="text-sm mb-2" style={{ color: '#e5e7eb' }}>{o.queryText}</p>

      {o.topicTags?.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {o.topicTags.map((t) => (
            <span key={t} className="text-[10.5px] px-2 py-0.5 rounded-full"
              style={{ background: 'rgba(255,255,255,0.05)', color: '#cbd5e1' }}>
              {t}
            </span>
          ))}
        </div>
      )}

      {o.whyItMatters && (
        <div
          className="text-[13px] rounded-lg px-3 py-2 mb-3"
          style={{ background: 'rgba(255,199,61,0.08)', border: '1px solid rgba(255,199,61,0.2)', color: '#FDE9C8' }}
        >
          <span className="block text-[10px] uppercase tracking-[0.12em] mb-1" style={{ color: '#FFC73D' }}>
            Why it matters
          </span>
          {o.whyItMatters}
        </div>
      )}

      {o.latestPitch ? (
        <div className="rounded-lg px-3 py-2 mb-2" style={{ background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] uppercase tracking-[0.12em] text-muted">Draft (editable)</span>
            <button
              type="button"
              onClick={() => void savePitch(o.id, o.latestPitch!.id, editBody[o.id] ?? o.latestPitch!.bodyText ?? '')}
              disabled={savingPitch === o.id || (editBody[o.id] ?? o.latestPitch.bodyText ?? '') === (o.latestPitch.bodyText ?? '')}
              className="text-[11px] underline disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-brand rounded"
              style={{ color: '#9AE6B4' }}
            >
              {savingPitch === o.id ? 'Saving' : 'Save edits'}
            </button>
          </div>
          <textarea
            value={editBody[o.id] ?? o.latestPitch.bodyText ?? ''}
            onChange={(e) => setEditBody((b) => ({ ...b, [o.id]: e.target.value }))}
            rows={6}
            aria-label="Edit draft text"
            className="w-full rounded text-sm whitespace-pre-wrap focus-visible:ring-2 focus-visible:ring-brand"
            style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.1)', color: '#e5e7eb', padding: '8px' }}
          />
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <label className="sr-only" htmlFor={`voice-${o.id}`}>Voice</label>
        <select
          id={`voice-${o.id}`}
          value={voiceFor(o.id)}
          onChange={(e) => setVoice((v) => ({ ...v, [o.id]: e.target.value as VoiceChoice }))}
          title="Who is this written as? Leads get advisory/congratulatory (our voice, to them)."
          className="rounded-lg px-2 py-1.5 text-[12px] focus-visible:ring-2 focus-visible:ring-brand"
          style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.12)', color: '#fff' }}
        >
          <option value="auto" style={{ color: '#000' }}>Voice: Auto</option>
          {PITCH_MODES.map((m) => (
            <option key={m} value={m} style={{ color: '#000' }}>{PITCH_MODE_LABELS[m]}</option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => void draftPitch(o.id)}
          disabled={drafting === o.id}
          aria-label="Draft pitch"
          data-loading={drafting === o.id ? 'true' : 'false'}
          className="ah-action-sparkle inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-brand"
          style={{ background: 'rgba(255,255,255,0.06)', color: '#fff', border: '1px solid rgba(255,255,255,0.14)' }}
        >
          <span>{drafting === o.id ? 'Drafting' : o.latestPitch ? 'Re-draft pitch' : 'Draft pitch'}</span>
          <span className="ah-sparkle-pair" aria-hidden="true"><span>&#10022;</span><span>&#10023;</span></span>
        </button>
        <button
          type="button"
          onClick={() => void orchestrate(o.id, false)}
          disabled={orchestrating === o.id}
          aria-label="Queue this pitch to the timeline"
          className="inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-brand"
          style={{ background: 'rgba(255,255,255,0.06)', color: '#fff', border: '1px solid rgba(255,255,255,0.14)' }}
        >
          {orchestrating === o.id ? 'Queueing' : 'Queue post'}
        </button>
        <button
          type="button"
          onClick={() => void orchestrate(o.id, true)}
          disabled={orchestrating === o.id}
          aria-label="Generate a commercial for this and queue it"
          data-loading={orchestrating === o.id ? 'true' : 'false'}
          className="ah-action-sparkle inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-brand"
          style={{ background: 'linear-gradient(120deg, #FF5A6E 0%, #FF9C5B 100%)', color: '#1a0a0a' }}
        >
          <span>{orchestrating === o.id ? 'Generating' : 'Add commercial + queue'}</span>
          <span className="ah-sparkle-pair" aria-hidden="true"><span>&#10022;</span><span>&#10023;</span></span>
        </button>
        {queued[o.id] && !queued[o.id].published && (
          <button
            type="button"
            onClick={() => void publishPost(o.id, queued[o.id].outboxId)}
            disabled={publishing === o.id}
            aria-label="Publish the queued post now"
            className="inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-brand"
            style={{ background: 'rgba(16,185,129,0.18)', color: '#6ee7b7', border: '1px solid rgba(16,185,129,0.4)' }}
          >
            {publishing === o.id ? 'Posting' : 'Publish now'}
          </button>
        )}
        {queued[o.id]?.published && <span className="text-[12px]" style={{ color: '#34d399' }}>Posted</span>}
        <button
          type="button"
          onClick={() => void dismiss(o.id)}
          disabled={dismissing === o.id}
          aria-label="Dismiss this opportunity"
          title="Move to passed and remove from the desk"
          className="ml-auto inline-flex items-center rounded-lg px-3 py-1.5 text-[12px] disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-brand"
          style={{ background: 'transparent', color: '#94a3b8', border: '1px solid rgba(148,163,184,0.3)' }}
        >
          {dismissing === o.id ? 'Dismissing' : 'Dismiss'}
        </button>
      </div>
      {orchestrateMsg[o.id] && (
        <p className="text-[12px] mt-2" style={{ color: '#9AE6B4' }} aria-live="polite">{orchestrateMsg[o.id]}</p>
      )}

      {o.latestPitch && (
        <div className="mt-3 rounded-lg px-3 py-2" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <span className="block text-[10px] uppercase tracking-[0.12em] mb-2 text-muted">Schedule across profiles</span>
          {connections.length === 0 ? (
            <p className="text-[12px] text-muted">
              No connected profiles yet. Connect accounts at{' '}
              <a href="/admin/social" className="underline">/admin/social</a>.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-3 mb-2">
                <input
                  type="datetime-local"
                  value={schedWhen[o.id] ?? ''}
                  onChange={(e) => setSchedWhen((w) => ({ ...w, [o.id]: e.target.value }))}
                  aria-label="Date and time to post"
                  className="rounded-lg px-2 py-1.5 text-[13px] focus-visible:ring-2 focus-visible:ring-brand"
                  style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.12)', color: '#fff' }}
                />
                <button
                  type="button"
                  onClick={() => void scheduleAcross(o.id)}
                  disabled={scheduling === o.id}
                  aria-label="Schedule this post across the selected profiles"
                  className="inline-flex items-center rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-brand"
                  style={{ background: 'rgba(59,130,246,0.2)', color: '#93c5fd', border: '1px solid rgba(59,130,246,0.4)' }}
                >
                  {scheduling === o.id ? 'Scheduling' : 'Schedule'}
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {connections.map((c) => {
                  const checked = (schedSel[o.id] ?? []).includes(c.id);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => toggleSchedProfile(o.id, c.id)}
                      aria-pressed={checked}
                      className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] focus-visible:ring-2 focus-visible:ring-brand"
                      style={
                        checked
                          ? { background: 'rgba(16,185,129,0.18)', color: '#6ee7b7', border: '1px solid rgba(16,185,129,0.45)' }
                          : { background: 'rgba(255,255,255,0.05)', color: '#cbd5e1', border: '1px solid rgba(255,255,255,0.12)' }
                      }
                    >
                      <span aria-hidden="true">{checked ? '✓' : '+'}</span>
                      {c.displayName || c.provider} ({c.provider})
                    </button>
                  );
                })}
              </div>
            </>
          )}
          {schedMsg[o.id] && (
            <p className="text-[12px] mt-2" style={{ color: '#93c5fd' }} aria-live="polite">{schedMsg[o.id]}</p>
          )}
        </div>
      )}
    </li>
  );

  const inboxOpps = opps.filter((o) => !o.suggested);
  const ideaOpps = opps.filter((o) => o.suggested);

  return (
    <div className="space-y-8">
      {error && (
        <div
          role="alert"
          className="text-sm rounded-lg px-3 py-2"
          style={{ background: 'rgba(239,68,68,0.12)', color: '#fca5a5', border: '1px solid rgba(239,68,68,0.3)' }}
        >
          {error}
        </div>
      )}

      {/* ---- Intake ---- */}
      <section style={cardStyle} className="p-4">
        <h2 className="text-sm font-semibold tracking-wide uppercase text-muted mb-3">Log an opportunity</h2>
        <label htmlFor="pr-source" className="block text-xs text-muted mb-1">Source</label>
        <select
          id="pr-source"
          value={source}
          onChange={(e) => setSource(e.target.value as PrSource)}
          className="mb-3 w-full sm:w-64 rounded-lg px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-brand"
          style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.12)', color: '#fff' }}
        >
          {PR_SOURCES.map((s) => (
            <option key={s} value={s} style={{ color: '#000' }}>
              {PR_SOURCE_LABELS[s]}
            </option>
          ))}
        </select>
        <label htmlFor="pr-raw" className="block text-xs text-muted mb-1">
          Paste the journalist request / call for guests / community post
        </label>
        <textarea
          id="pr-raw"
          value={rawText}
          onChange={(e) => setRawText(e.target.value)}
          rows={4}
          placeholder="e.g. Looking for small-business owners to comment on AI in hospitality marketing by Friday. - Jane Doe, Skift"
          className="w-full rounded-lg px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-brand"
          style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.12)', color: '#fff' }}
        />
        <div className="mt-3 flex items-center gap-3">
          <button
            type="button"
            onClick={parseAndLog}
            disabled={parsing || rawText.trim().length < 5}
            aria-label="Parse and log opportunity"
            className="ah-action-sparkle inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-brand"
            data-loading={parsing ? 'true' : 'false'}
            style={{ background: 'linear-gradient(120deg, #FF5A6E 0%, #FF9C5B 100%)', color: '#1a0a0a' }}
          >
            <span>{parsing ? 'Reading the request' : 'Parse + log opportunity'}</span>
            <span className="ah-sparkle-pair" aria-hidden="true"><span>&#10022;</span><span>&#10023;</span></span>
          </button>
          <span className="text-xs text-muted" aria-live="polite">
            {parsing ? 'Matching a client and writing the strategic read...' : ''}
          </span>
        </div>
      </section>

      {/* ---- Opportunity inbox (real/external requests: suggested=0) ---- */}
      <section>
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <h2 className="text-sm font-semibold tracking-wide uppercase text-muted">Opportunity inbox</h2>
          <div className="flex items-center gap-3 flex-wrap">
            <button
              type="button"
              onClick={runDiscovery}
              disabled={discovering}
              aria-label="Find ideas from your own data"
              data-loading={discovering ? 'true' : 'false'}
              className="ah-action-sparkle inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-brand"
              style={{ background: 'rgba(255,156,91,0.16)', color: '#FFD9BE', border: '1px solid rgba(255,156,91,0.35)' }}
            >
              <span>{discovering ? 'Scanning your data' : 'Find ideas in your data'}</span>
              <span className="ah-sparkle-pair" aria-hidden="true"><span>&#10022;</span><span>&#10023;</span></span>
            </button>
            <button
              type="button"
              onClick={runSources}
              disabled={runningSources}
              aria-label="Check configured web sources for new requests"
              data-loading={runningSources ? 'true' : 'false'}
              className="ah-action-sparkle inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-brand"
              style={{ background: 'rgba(59,130,246,0.16)', color: '#bfdbfe', border: '1px solid rgba(59,130,246,0.35)' }}
            >
              <span>{runningSources ? 'Checking web sources' : 'Check web sources'}</span>
            </button>
            <button
              type="button"
              onClick={() => setShowSources((v) => !v)}
              aria-expanded={showSources}
              className="text-xs text-muted underline focus-visible:ring-2 focus-visible:ring-brand rounded"
            >
              {showSources ? 'Hide sources' : 'Configure sources'}
            </button>
            <button
              type="button"
              onClick={() => void load()}
              className="text-xs text-muted underline focus-visible:ring-2 focus-visible:ring-brand rounded"
            >
              Refresh
            </button>
          </div>
        </div>

        {sourcesMsg && (
          <p className="text-[12px] mb-3" style={{ color: '#93c5fd' }} aria-live="polite">{sourcesMsg}</p>
        )}

        {showSources && (
          <div style={cardStyle} className="p-4 mb-4">
            <span className="block text-[10px] uppercase tracking-[0.12em] mb-2 text-muted">
              Discovery sources (Reddit / RSS)
            </span>
            {sources.filter((s) => s.kind === 'reddit' || s.kind === 'rss').length === 0 ? (
              <p className="text-[12px] text-muted mb-3">
                No web sources yet. Add a subreddit set or RSS feeds below, then &quot;Check web sources&quot;
                pulls fresh requests into the inbox. The deeper sweep also surfaces ideas from what is converting.
              </p>
            ) : (
              <ul className="space-y-1.5 mb-3">
                {sources
                  .filter((s) => s.kind === 'reddit' || s.kind === 'rss')
                  .map((s) => (
                    <li key={s.id} className="flex items-center justify-between gap-3 text-[12px]" style={{ color: '#cbd5e1' }}>
                      <span>
                        <strong style={{ color: '#fff' }}>{s.kind}</strong> {describeSourceConfig(s)}
                        {s.lastStatus ? <span className="text-muted"> - last: {s.lastStatus}</span> : null}
                      </span>
                      <button
                        type="button"
                        onClick={() => void toggleSource(s.id, !s.isActive)}
                        className="underline focus-visible:ring-2 focus-visible:ring-brand rounded"
                        style={{ color: s.isActive ? '#6ee7b7' : '#94a3b8' }}
                      >
                        {s.isActive ? 'Active' : 'Paused'}
                      </button>
                    </li>
                  ))}
              </ul>
            )}
            <div className="flex flex-wrap items-end gap-2">
              <select
                value={newSourceKind}
                onChange={(e) => setNewSourceKind(e.target.value as 'reddit' | 'rss')}
                aria-label="Source kind"
                className="rounded-lg px-2 py-1.5 text-[12px] focus-visible:ring-2 focus-visible:ring-brand"
                style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.12)', color: '#fff' }}
              >
                <option value="reddit" style={{ color: '#000' }}>Reddit</option>
                <option value="rss" style={{ color: '#000' }}>RSS</option>
              </select>
              <input
                value={newSourceTargets}
                onChange={(e) => setNewSourceTargets(e.target.value)}
                aria-label={newSourceKind === 'reddit' ? 'Subreddits' : 'Feed URLs'}
                placeholder={newSourceKind === 'reddit' ? 'subreddits: smallbusiness, marketing' : 'feed URLs (comma or newline separated)'}
                className="flex-1 min-w-[220px] rounded-lg px-3 py-1.5 text-[13px] focus-visible:ring-2 focus-visible:ring-brand"
                style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.12)', color: '#fff' }}
              />
              <input
                value={newSourceKeywords}
                onChange={(e) => setNewSourceKeywords(e.target.value)}
                aria-label="Keywords (optional)"
                placeholder="keywords (optional)"
                className="min-w-[160px] rounded-lg px-3 py-1.5 text-[13px] focus-visible:ring-2 focus-visible:ring-brand"
                style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.12)', color: '#fff' }}
              />
              <button
                type="button"
                onClick={() => void addSource()}
                disabled={addingSource}
                className="inline-flex items-center rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-brand"
                style={{ background: 'rgba(255,255,255,0.06)', color: '#fff', border: '1px solid rgba(255,255,255,0.14)' }}
              >
                {addingSource ? 'Saving' : 'Add source'}
              </button>
            </div>
            <p className="text-[11px] text-muted mt-2">
              Reddit needs REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET in the environment; without them the Reddit lane
              reports itself paused. RSS works with any public feed URL (industry news, Google Alerts).
            </p>
          </div>
        )}

        {loading ? (
          <div className="text-sm text-muted">Loading...</div>
        ) : inboxOpps.length === 0 ? (
          <div className="text-sm text-muted" style={cardStyle as React.CSSProperties}>
            <div className="p-4">
              No incoming opportunities yet. Paste a journalist request above, point the PR inbox
              (PR@api.atlanticandvine.com) at this desk, or add a web source.
            </div>
          </div>
        ) : (
          <ul className="space-y-4">{inboxOpps.map(renderOpp)}</ul>
        )}
      </section>

      {/* ---- Ideas from your data (suggested=1) ---- */}
      <section>
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <h2 className="text-sm font-semibold tracking-wide uppercase text-muted">Ideas from your data</h2>
          <span className="text-[11px] text-muted">Auto-suggested angles - not real journalist requests</span>
        </div>
        {loading ? null : ideaOpps.length === 0 ? (
          <div className="text-sm text-muted" style={cardStyle as React.CSSProperties}>
            <div className="p-4">
              No ideas yet. Use &quot;Find ideas in your data&quot; to surface proactive angles from your pipeline
              and from what is converting.
            </div>
          </div>
        ) : (
          <ul className="space-y-4">{ideaOpps.map(renderOpp)}</ul>
        )}
      </section>

      {/* ---- Releases ---- */}
      <section>
        <h2 className="text-sm font-semibold tracking-wide uppercase text-muted mb-3">Press releases</h2>
        <div style={cardStyle} className="p-4 mb-4">
          <label htmlFor="rel-lead" className="block text-xs text-muted mb-1">Client lead id (optional)</label>
          <input
            id="rel-lead"
            value={releaseLeadId}
            onChange={(e) => setReleaseLeadId(e.target.value)}
            inputMode="numeric"
            placeholder="e.g. 1423"
            className="mb-3 w-full sm:w-48 rounded-lg px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-brand"
            style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.12)', color: '#fff' }}
          />
          <label htmlFor="rel-ann" className="block text-xs text-muted mb-1">Announcement (the win / launch to write up)</label>
          <textarea
            id="rel-ann"
            value={announcement}
            onChange={(e) => setAnnouncement(e.target.value)}
            rows={3}
            placeholder="e.g. The venue just booked its 100th wedding and launched an AI-assisted planning concierge."
            className="w-full rounded-lg px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-brand"
            style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.12)', color: '#fff' }}
          />
          <button
            type="button"
            onClick={createRelease}
            disabled={creatingRelease || announcement.trim().length < 5}
            aria-label="Draft press release"
            data-loading={creatingRelease ? 'true' : 'false'}
            className="ah-action-sparkle mt-3 inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-brand"
            style={{ background: 'linear-gradient(120deg, #FF5A6E 0%, #FF9C5B 100%)', color: '#1a0a0a' }}
          >
            <span>{creatingRelease ? 'Drafting release' : 'Draft release'}</span>
            <span className="ah-sparkle-pair" aria-hidden="true"><span>&#10022;</span><span>&#10023;</span></span>
          </button>
        </div>

        {releases.length === 0 ? (
          <div className="text-sm text-muted">No releases yet.</div>
        ) : (
          <ul className="space-y-3">
            {releases.map((r) => (
              <li key={r.id} style={cardStyle} className="p-4">
                <div className="flex items-center justify-between gap-3 mb-2">
                  <h3 className="text-sm font-semibold" style={{ color: '#fff' }}>{r.title || '(untitled release)'}</h3>
                  <StatusBadge status={r.status} />
                </div>
                {r.bodyText && (
                  <p className="text-sm whitespace-pre-wrap mb-3" style={{ color: '#cbd5e1' }}>{r.bodyText}</p>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  {r.status === 'draft' && (
                    <button type="button" onClick={() => void advanceRelease(r.id, 'approved')}
                      className="rounded-lg px-3 py-1.5 text-sm focus-visible:ring-2 focus-visible:ring-brand"
                      style={{ background: 'rgba(16,185,129,0.16)', color: '#6ee7b7', border: '1px solid rgba(16,185,129,0.3)' }}>
                      Approve
                    </button>
                  )}
                  {r.status === 'approved' && (
                    <button type="button" onClick={() => void advanceRelease(r.id, 'published')}
                      className="rounded-lg px-3 py-1.5 text-sm focus-visible:ring-2 focus-visible:ring-brand"
                      style={{ background: 'rgba(16,185,129,0.22)', color: '#34d399', border: '1px solid rgba(16,185,129,0.4)' }}>
                      Mark published
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        <p className="text-xs text-muted mt-4">
          Distribution channels: {DISTRIBUTION_CHANNELS.map((c) => `${c.label} (${c.mode})`).join(', ')}.
          Guided channels are completed by the operator and logged here; no integrations are faked.
        </p>
      </section>

      {/* ---- Owned content & artifacts (schema 029) ---- */}
      <ArtifactsSection />
    </div>
  );
}

function formatDate(s: string): string {
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function describeSourceConfig(s: DiscoverySource): string {
  const cfg = (s.config ?? {}) as Record<string, unknown>;
  if (s.kind === 'reddit' && Array.isArray(cfg.subreddits)) {
    return (cfg.subreddits as unknown[]).map((x) => `r/${x}`).join(', ').slice(0, 120);
  }
  if (s.kind === 'rss' && Array.isArray(cfg.feeds)) {
    const feeds = cfg.feeds as unknown[];
    return `${feeds.length} feed${feeds.length === 1 ? '' : 's'}`;
  }
  return '';
}
