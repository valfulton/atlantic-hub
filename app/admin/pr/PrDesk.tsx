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
      const [oRes, rRes] = await Promise.all([
        fetch('/api/admin/pr/opportunities', { cache: 'no-store' }),
        fetch('/api/admin/pr/releases', { cache: 'no-store' })
      ]);
      const oJson = await oRes.json();
      const rJson = await rRes.json();
      if (!oRes.ok) throw new Error(oJson.error || 'failed to load opportunities');
      setOpps(oJson.items || []);
      setReleases(rJson.items || []);
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

  const orchestrate = useCallback(async (oppId: number) => {
    setOrchestrating(oppId);
    setError(null);
    try {
      const res = await fetch(`/api/admin/pr/opportunities/${oppId}/orchestrate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ makeCommercial: true, assetType: 'image', mode: modeArg(oppId) })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'orchestrate failed');
      const parts: string[] = ['Pitch drafted.'];
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

      {/* ---- Opportunities ---- */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold tracking-wide uppercase text-muted">Opportunity inbox</h2>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={runDiscovery}
              disabled={discovering}
              aria-label="Find opportunities from your data"
              data-loading={discovering ? 'true' : 'false'}
              className="ah-action-sparkle inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-brand"
              style={{ background: 'rgba(255,156,91,0.16)', color: '#FFD9BE', border: '1px solid rgba(255,156,91,0.35)' }}
            >
              <span>{discovering ? 'Scanning your data' : 'Find opportunities'}</span>
              <span className="ah-sparkle-pair" aria-hidden="true"><span>&#10022;</span><span>&#10023;</span></span>
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

        {loading ? (
          <div className="text-sm text-muted">Loading...</div>
        ) : opps.length === 0 ? (
          <div className="text-sm text-muted" style={cardStyle as React.CSSProperties}>
            <div className="p-4">No opportunities yet. Paste a journalist request above to get started.</div>
          </div>
        ) : (
          <ul className="space-y-4">
            {opps.map((o) => (
              <li key={o.id} style={cardStyle} className="p-4">
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <span
                    className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium"
                    style={{ background: 'rgba(255,255,255,0.06)', color: '#e5e7eb' }}
                  >
                    {PR_SOURCE_LABELS[o.source] ?? o.source}
                  </span>
                  <StatusBadge status={o.status} />
                  {o.suggested && (
                    <span
                      className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium"
                      style={{ background: 'rgba(255,156,91,0.16)', color: '#FFD9BE', border: '1px solid rgba(255,156,91,0.35)' }}
                      title="We surfaced this from your own data"
                    >
                      Suggested{o.relevanceScore != null ? ` ${o.relevanceScore}` : ''}
                    </span>
                  )}
                  {o.deadline && (
                    <span className="text-[11px] text-amber-300">Deadline: {formatDate(o.deadline)}</span>
                  )}
                  {o.matchedCompany && (
                    <span className="text-[11px] text-muted">
                      Matched: <span className="text-emerald-300">{o.matchedCompany}</span>
                    </span>
                  )}
                </div>

                {(o.outlet || o.journalist) && (
                  <p className="text-xs text-muted mb-1">
                    {[o.journalist, o.outlet].filter(Boolean).join(' - ')}
                  </p>
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
                    onClick={() => void orchestrate(o.id)}
                    disabled={orchestrating === o.id}
                    aria-label="Draft pitch, generate commercial, and queue a social post"
                    data-loading={orchestrating === o.id ? 'true' : 'false'}
                    className="ah-action-sparkle inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-brand"
                    style={{ background: 'linear-gradient(120deg, #FF5A6E 0%, #FF9C5B 100%)', color: '#1a0a0a' }}
                  >
                    <span>{orchestrating === o.id ? 'Building campaign' : 'Pitch + commercial + queue'}</span>
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
                  {queued[o.id]?.published && (
                    <span className="text-[12px]" style={{ color: '#34d399' }}>Posted</span>
                  )}
                </div>
                {orchestrateMsg[o.id] && (
                  <p className="text-[12px] mt-2" style={{ color: '#9AE6B4' }} aria-live="polite">
                    {orchestrateMsg[o.id]}
                  </p>
                )}
              </li>
            ))}
          </ul>
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
    </div>
  );
}

function formatDate(s: string): string {
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
