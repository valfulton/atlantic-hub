'use client';

/**
 * ArtifactsSection -- the "Owned content & artifacts" surface on the PR desk.
 *
 * One-click ("no typing") generation of the broader artifact types (schema 029):
 * blog post, SEO article, own-brand post, client deliverable. Every artifact is
 * built by the Intelligence Loop drafter (lib/pr/artifacts.ts): it reads the
 * shared graph and strengthens it back. Drafts are editable + Save; own-brand
 * posts queue to the Campaign timeline (publisher cron fires them).
 *
 * Aesthetic mirrors PrDesk.tsx (COSMETIC_BASELINE): no per-unit AI cost shown.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  ARTIFACT_TYPES,
  ARTIFACT_TYPE_LABELS,
  ARTIFACT_ACTION_LABELS,
  PITCH_MODE_LABELS,
  type ArtifactType,
  type PitchMode
} from '@/lib/pr/types';
import {
  PUBLISH_DESTINATIONS,
  NEWSROOM_DESTINATION_ID,
  getDestination
} from '@/lib/publishing/destinations';

interface ArtifactMeta {
  slug?: string | null;
  meta_description?: string | null;
  target_query?: string | null;
  keyword_cluster?: string[];
  suggested_headings?: string[];
  hashtags?: string[];
  suggested_channel?: string | null;
  [k: string]: unknown;
}
interface Artifact {
  id: number;
  tenantId: string;
  artifactType: ArtifactType;
  leadId: number | null;
  voiceMode: PitchMode;
  title: string | null;
  bodyText: string | null;
  metaJson: ArtifactMeta | null;
  status: string;
  linkedOutboxId: number | null;
  matchedCompany: string | null;
}
interface Connection {
  id: number;
  provider: string;
  displayName: string | null;
}

const TENANTS: Array<{ id: string; label: string }> = [
  { id: 'av', label: 'Atlantic & Vine' },
  { id: 'ebw', label: 'Events by Water' },
  { id: 'hh', label: 'HunterHoney' }
];

const STATUS_TONE: Record<string, { label: string; bg: string; fg: string }> = {
  draft: { label: 'Draft', bg: 'rgba(245,158,11,0.16)', fg: '#fcd34d' },
  approved: { label: 'Approved', bg: 'rgba(16,185,129,0.16)', fg: '#6ee7b7' },
  published: { label: 'Published', bg: 'rgba(16,185,129,0.22)', fg: '#34d399' },
  passed: { label: 'Dismissed', bg: 'rgba(148,163,184,0.16)', fg: '#cbd5e1' }
};

const cardStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,0.03)',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 14
};

function Badge({ status }: { status: string }) {
  const t = STATUS_TONE[status] ?? { label: status, bg: 'rgba(148,163,184,0.16)', fg: '#cbd5e1' };
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium" style={{ background: t.bg, color: t.fg }}>
      {t.label}
    </span>
  );
}

export function ArtifactsSection() {
  const [items, setItems] = useState<Artifact[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // generation inputs (optional steers -- one-click otherwise)
  const [leadId, setLeadId] = useState('');
  const [tenant, setTenant] = useState('av');
  const [topic, setTopic] = useState('');
  const [creating, setCreating] = useState<ArtifactType | null>(null);

  // per-artifact edit + action state
  const [editBody, setEditBody] = useState<Record<number, string>>({});
  const [savingId, setSavingId] = useState<number | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [schedWhen, setSchedWhen] = useState<Record<number, string>>({});
  const [schedSel, setSchedSel] = useState<Record<number, number[]>>({});
  const [queueMsg, setQueueMsg] = useState<Record<number, string>>({});
  // per-artifact publishing destination (defaults to the live newsroom)
  const [destId, setDestId] = useState<Record<number, string>>({});
  // live URL returned after publishing to an external site
  const [siteUrl, setSiteUrl] = useState<Record<number, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [aRes, cRes] = await Promise.all([
        fetch('/api/admin/pr/artifacts', { cache: 'no-store' }),
        fetch('/api/admin/social/connections?tenant=av', { cache: 'no-store' })
      ]);
      const aJson = await aRes.json();
      if (!aRes.ok) throw new Error(aJson.error || 'failed to load artifacts');
      setItems(aJson.items || []);
      if (cRes.ok) {
        const cJson = await cRes.json();
        setConnections(cJson.items || []);
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

  // Batch drafting on the PR desk dispatches this event so the Owned-content
  // list reflects the new drafts without the operator hitting reload.
  useEffect(() => {
    const onRefresh = () => {
      void load();
    };
    window.addEventListener('pr:artifacts:refresh', onRefresh);
    return () => window.removeEventListener('pr:artifacts:refresh', onRefresh);
  }, [load]);

  const create = useCallback(
    async (artifactType: ArtifactType) => {
      setCreating(artifactType);
      setError(null);
      try {
        const payload: Record<string, unknown> = { artifactType };
        if (artifactType === 'own_brand_post') {
          payload.tenant = tenant;
        } else if (leadId.trim()) {
          payload.leadId = Number(leadId.trim());
        }
        if (topic.trim()) payload.topic = topic.trim();
        const res = await fetch('/api/admin/pr/artifacts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'draft failed');
        setItems((prev) => [json.item as Artifact, ...prev]);
        setEditBody((b) => ({ ...b, [json.item.id]: json.item.bodyText ?? '' }));
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setCreating(null);
      }
    },
    [leadId, tenant, topic]
  );

  const save = useCallback(async (id: number, text: string) => {
    setSavingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/pr/artifacts/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bodyText: text })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'save failed');
      setItems((prev) => prev.map((a) => (a.id === id ? { ...a, bodyText: text } : a)));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSavingId(null);
    }
  }, []);

  const setStatus = useCallback(async (id: number, status: 'approved' | 'published' | 'passed') => {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/pr/artifacts/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'update failed');
      setItems((prev) => prev.map((a) => (a.id === id ? { ...a, status } : a)));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }, []);

  // Publish to an external brand/client site (commits to the repo -> Netlify rebuilds).
  const publishToSite = useCallback(async (id: number, destinationId: string) => {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/pr/artifacts/${id}/publish-site`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ destinationId })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) throw new Error(json.error || 'site publish failed');
      setItems((prev) => prev.map((a) => (a.id === id ? { ...a, status: 'published' } : a)));
      setSiteUrl((m) => ({ ...m, [id]: json.url }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }, []);

  // Bulk-dismiss every DRAFT (clears a batch of unwanted drafts in one click).
  const [bulkDismissing, setBulkDismissing] = useState(false);
  const dismissAllDrafts = useCallback(async () => {
    const drafts = items.filter((a) => a.status === 'draft');
    if (drafts.length === 0) return;
    setBulkDismissing(true);
    setError(null);
    for (const a of drafts) {
      try {
        const res = await fetch(`/api/admin/pr/artifacts/${a.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'passed' })
        });
        if (res.ok) setItems((prev) => prev.map((x) => (x.id === a.id ? { ...x, status: 'passed' } : x)));
      } catch {
        /* skip */
      }
    }
    setBulkDismissing(false);
  }, [items]);

  const toggleProfile = useCallback((id: number, connId: number) => {
    setSchedSel((s) => {
      const cur = s[id] ?? [];
      return { ...s, [id]: cur.includes(connId) ? cur.filter((x) => x !== connId) : [...cur, connId] };
    });
  }, []);

  const queue = useCallback(
    async (id: number) => {
      const sel = schedSel[id] ?? [];
      if (!sel.length) {
        setError('Select at least one profile to queue this post to.');
        return;
      }
      setBusyId(id);
      setError(null);
      try {
        const when = schedWhen[id];
        const payload: Record<string, unknown> = { connectionIds: sel };
        if (when) payload.scheduledFor = new Date(when).toISOString();
        const res = await fetch(`/api/admin/pr/artifacts/${id}/queue`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'queue failed');
        setQueueMsg((m) => ({ ...m, [id]: json.note || `Queued to ${json.queued} profile(s).` }));
        setItems((prev) => prev.map((a) => (a.id === id ? { ...a, linkedOutboxId: json.linkedOutboxId ?? a.linkedOutboxId } : a)));
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusyId(null);
      }
    },
    [schedSel, schedWhen]
  );

  return (
    <section>
      <h2 className="text-sm font-semibold tracking-wide uppercase text-muted mb-1">Owned content &amp; artifacts</h2>
      <p className="text-xs text-muted mb-3 max-w-2xl">
        One click turns the intelligence we have already accumulated into longer-form owned content -- blog posts, SEO
        articles, posts for our own brands, and client deliverables. Each draft is grounded in the shared graph and makes
        the next one smarter. Edit any draft, then approve, publish, or queue an own-brand post to the timeline.
      </p>

      {items.some((a) => a.status === 'draft') && (
        <button
          type="button"
          onClick={() => void dismissAllDrafts()}
          disabled={bulkDismissing}
          className="mb-3 inline-flex items-center rounded-lg px-3 py-1.5 text-[13px] disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-brand"
          style={{ background: 'transparent', color: '#cbd5e1', border: '1px solid rgba(255,255,255,0.14)' }}
        >
          {bulkDismissing ? 'Dismissing…' : `Dismiss all drafts (${items.filter((a) => a.status === 'draft').length})`}
        </button>
      )}

      {error && (
        <div
          role="alert"
          className="text-sm rounded-lg px-3 py-2 mb-3"
          style={{ background: 'rgba(239,68,68,0.12)', color: '#fca5a5', border: '1px solid rgba(239,68,68,0.3)' }}
        >
          {error}
        </div>
      )}

      {/* ---- generation controls ---- */}
      <div style={cardStyle} className="p-4 mb-4">
        <div className="flex flex-wrap items-end gap-3 mb-3">
          <div>
            <label htmlFor="art-lead" className="block text-xs text-muted mb-1">Client / prospect lead id (optional)</label>
            <input
              id="art-lead"
              value={leadId}
              onChange={(e) => setLeadId(e.target.value)}
              inputMode="numeric"
              placeholder="e.g. 1423"
              className="w-40 rounded-lg px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-brand"
              style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.12)', color: '#fff' }}
            />
          </div>
          <div>
            <label htmlFor="art-tenant" className="block text-xs text-muted mb-1">Own brand (for own-brand posts)</label>
            <select
              id="art-tenant"
              value={tenant}
              onChange={(e) => setTenant(e.target.value)}
              className="w-52 rounded-lg px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-brand"
              style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.12)', color: '#fff' }}
            >
              {TENANTS.map((t) => (
                <option key={t.id} value={t.id} style={{ color: '#000' }}>{t.label}</option>
              ))}
            </select>
          </div>
          <div className="flex-1 min-w-[200px]">
            <label htmlFor="art-topic" className="block text-xs text-muted mb-1">Topic / angle (optional)</label>
            <input
              id="art-topic"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="Leave blank to let the intelligence pick the angle"
              className="w-full rounded-lg px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-brand"
              style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.12)', color: '#fff' }}
            />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {ARTIFACT_TYPES.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => void create(t)}
              disabled={creating !== null}
              aria-label={ARTIFACT_ACTION_LABELS[t]}
              data-loading={creating === t ? 'true' : 'false'}
              className="ah-action-sparkle inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-brand"
              style={{ background: 'linear-gradient(120deg, #FF5A6E 0%, #FF9C5B 100%)', color: '#1a0a0a' }}
            >
              <span>{creating === t ? 'Writing...' : ARTIFACT_ACTION_LABELS[t]}</span>
              <span className="ah-sparkle-pair" aria-hidden="true"><span>&#10022;</span><span>&#10023;</span></span>
            </button>
          ))}
        </div>
      </div>

      {/* ---- artifacts list ---- */}
      {loading ? (
        <div className="text-sm text-muted">Loading...</div>
      ) : items.length === 0 ? (
        <div className="text-sm text-muted" style={cardStyle}>
          <div className="p-4">No owned content yet. Use a button above to draft your first piece.</div>
        </div>
      ) : (
        <ul className="space-y-4">
          {items.map((a) => {
            const isPost = a.artifactType === 'own_brand_post';
            const editable = a.status === 'draft' || a.status === 'approved';
            const body = editBody[a.id] ?? a.bodyText ?? '';
            return (
              <li key={a.id} style={cardStyle} className="p-4">
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <span
                    className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium"
                    style={{ background: 'rgba(255,255,255,0.06)', color: '#e5e7eb' }}
                  >
                    {ARTIFACT_TYPE_LABELS[a.artifactType]}
                  </span>
                  <Badge status={a.status} />
                  <span className="text-[11px] text-muted" title="Voice this was written in">
                    {PITCH_MODE_LABELS[a.voiceMode]}
                  </span>
                  {isPost && (
                    <span className="text-[11px] text-muted">Brand: {a.tenantId}</span>
                  )}
                  {a.matchedCompany && (
                    <span className="text-[11px] text-muted">For: <span className="text-emerald-300">{a.matchedCompany}</span></span>
                  )}
                </div>

                {a.title && <h3 className="text-sm font-semibold mb-2" style={{ color: '#fff' }}>{a.title}</h3>}

                {/* meta: SEO cluster / hashtags */}
                {a.metaJson?.target_query && (
                  <p className="text-[11px] text-muted mb-1">Target query: <span style={{ color: '#cbd5e1' }}>{a.metaJson.target_query}</span></p>
                )}
                {(a.metaJson?.keyword_cluster?.length || a.metaJson?.hashtags?.length) ? (
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {(a.metaJson?.keyword_cluster ?? []).map((k) => (
                      <span key={`kw-${k}`} className="text-[10.5px] px-2 py-0.5 rounded-full" style={{ background: 'rgba(255,255,255,0.05)', color: '#cbd5e1' }}>{k}</span>
                    ))}
                    {(a.metaJson?.hashtags ?? []).map((h) => (
                      <span key={`tag-${h}`} className="text-[10.5px] px-2 py-0.5 rounded-full" style={{ background: 'rgba(59,130,246,0.14)', color: '#93c5fd' }}>#{h}</span>
                    ))}
                  </div>
                ) : null}

                {editable ? (
                  <div className="rounded-lg px-3 py-2 mb-2" style={{ background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.08)' }}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] uppercase tracking-[0.12em] text-muted">Draft (editable)</span>
                      <button
                        type="button"
                        onClick={() => void save(a.id, body)}
                        disabled={savingId === a.id || body === (a.bodyText ?? '')}
                        className="text-[11px] underline disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-brand rounded"
                        style={{ color: '#9AE6B4' }}
                      >
                        {savingId === a.id ? 'Saving' : 'Save edits'}
                      </button>
                    </div>
                    <textarea
                      value={body}
                      onChange={(e) => setEditBody((b) => ({ ...b, [a.id]: e.target.value }))}
                      rows={isPost ? 5 : 12}
                      aria-label="Edit artifact text"
                      className="w-full rounded text-sm whitespace-pre-wrap focus-visible:ring-2 focus-visible:ring-brand"
                      style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.1)', color: '#e5e7eb', padding: '8px' }}
                    />
                  </div>
                ) : (
                  a.bodyText && <p className="text-sm whitespace-pre-wrap mb-2" style={{ color: '#cbd5e1' }}>{a.bodyText}</p>
                )}

                {/* status actions */}
                <div className="flex flex-wrap items-center gap-2">
                  {a.status === 'draft' && (
                    <button type="button" onClick={() => void setStatus(a.id, 'approved')} disabled={busyId === a.id}
                      className="rounded-lg px-3 py-1.5 text-sm disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-brand"
                      style={{ background: 'rgba(16,185,129,0.16)', color: '#6ee7b7', border: '1px solid rgba(16,185,129,0.3)' }}>
                      Approve
                    </button>
                  )}
                  {a.status === 'approved' && (() => {
                    const chosen = destId[a.id] ?? NEWSROOM_DESTINATION_ID;
                    const dest = getDestination(chosen);
                    const connected = dest?.connected ?? false;
                    return (
                      <span className="inline-flex items-center gap-2">
                        <label className="sr-only" htmlFor={`dest-${a.id}`}>Publish destination</label>
                        <select
                          id={`dest-${a.id}`}
                          value={chosen}
                          onChange={(e) => setDestId((d) => ({ ...d, [a.id]: e.target.value }))}
                          className="rounded-lg px-2 py-1.5 text-[13px] focus-visible:ring-2 focus-visible:ring-brand"
                          style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.12)', color: '#fff' }}
                        >
                          {PUBLISH_DESTINATIONS.map((d) => (
                            <option key={d.id} value={d.id} style={{ color: '#000' }}>
                              {d.label}{d.connected ? '' : ' (connect to enable)'}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => {
                            if (!connected) return;
                            if (dest?.repo) void publishToSite(a.id, chosen);
                            else void setStatus(a.id, 'published');
                          }}
                          disabled={busyId === a.id || !connected}
                          title={connected ? dest?.note : dest?.note}
                          className="rounded-lg px-3 py-1.5 text-sm disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-brand"
                          style={{ background: 'rgba(16,185,129,0.22)', color: '#34d399', border: '1px solid rgba(16,185,129,0.4)' }}
                        >
                          {busyId === a.id ? 'Publishing…' : connected ? (dest?.repo ? 'Publish to site' : 'Publish') : 'Set up blog page'}
                        </button>
                      </span>
                    );
                  })()}
                  {siteUrl[a.id] && (
                    <a href={siteUrl[a.id]} target="_blank" rel="noopener"
                      className="text-sm focus-visible:ring-2 focus-visible:ring-brand"
                      style={{ color: '#fcd34d' }}>
                      View live -&gt;
                    </a>
                  )}
                  {a.status !== 'passed' && a.status !== 'published' && (
                    <button type="button" onClick={() => void setStatus(a.id, 'passed')} disabled={busyId === a.id}
                      className="rounded-lg px-3 py-1.5 text-sm disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-brand"
                      style={{ background: 'rgba(148,163,184,0.12)', color: '#cbd5e1', border: '1px solid rgba(148,163,184,0.3)' }}>
                      Dismiss
                    </button>
                  )}
                  {/* Published public content is live on the newsroom -- link straight to it. */}
                  {a.status === 'published' &&
                    (a.artifactType === 'blog_article' ||
                      a.artifactType === 'seo_article' ||
                      a.artifactType === 'own_brand_post') && (
                      <a
                        href={`/newsroom/${a.id}`}
                        target="_blank"
                        rel="noopener"
                        className="rounded-lg px-3 py-1.5 text-sm focus-visible:ring-2 focus-visible:ring-brand"
                        style={{ background: 'rgba(245,158,11,0.16)', color: '#fcd34d', border: '1px solid rgba(245,158,11,0.4)' }}
                      >
                        View live -&gt;
                      </a>
                    )}
                  {a.status === 'published' && (
                    <button type="button" onClick={() => void setStatus(a.id, 'passed')} disabled={busyId === a.id}
                      className="rounded-lg px-3 py-1.5 text-sm disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-brand"
                      style={{ background: 'rgba(148,163,184,0.12)', color: '#cbd5e1', border: '1px solid rgba(148,163,184,0.3)' }}>
                      Unpublish
                    </button>
                  )}
                </div>

                {/* own-brand post: queue to the timeline */}
                {isPost && a.status !== 'passed' && (
                  <div className="mt-3 rounded-lg px-3 py-2" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
                    <span className="block text-[10px] uppercase tracking-[0.12em] mb-2 text-muted">Queue to the Campaign timeline</span>
                    {connections.length === 0 ? (
                      <p className="text-[12px] text-muted">
                        No connected profiles yet. Connect accounts at <a href="/admin/social" className="underline">/admin/social</a>.
                      </p>
                    ) : (
                      <>
                        <div className="flex flex-wrap items-center gap-3 mb-2">
                          <input
                            type="datetime-local"
                            value={schedWhen[a.id] ?? ''}
                            onChange={(e) => setSchedWhen((w) => ({ ...w, [a.id]: e.target.value }))}
                            aria-label="Date and time to post (optional)"
                            className="rounded-lg px-2 py-1.5 text-[13px] focus-visible:ring-2 focus-visible:ring-brand"
                            style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.12)', color: '#fff' }}
                          />
                          <button
                            type="button"
                            onClick={() => void queue(a.id)}
                            disabled={busyId === a.id}
                            aria-label="Queue this own-brand post"
                            className="inline-flex items-center rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-brand"
                            style={{ background: 'rgba(59,130,246,0.2)', color: '#93c5fd', border: '1px solid rgba(59,130,246,0.4)' }}
                          >
                            {busyId === a.id ? 'Queueing' : schedWhen[a.id] ? 'Schedule' : 'Queue as draft'}
                          </button>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {connections.map((c) => {
                            const checked = (schedSel[a.id] ?? []).includes(c.id);
                            return (
                              <button
                                key={c.id}
                                type="button"
                                onClick={() => toggleProfile(a.id, c.id)}
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
                    {queueMsg[a.id] && (
                      <p className="text-[12px] mt-2" style={{ color: '#93c5fd' }} aria-live="polite">{queueMsg[a.id]}</p>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
