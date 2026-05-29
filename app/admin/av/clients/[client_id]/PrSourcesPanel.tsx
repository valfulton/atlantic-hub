'use client';

/**
 * PrSourcesPanel  (#214)
 *
 * Per-client PR discovery source manager. Lists every RSS feed tagged to
 * this client and lets val add new ones. The discovery runner picks them
 * up on the next sweep; matched opportunities surface on the per-client
 * PR section (#213) automatically.
 *
 * Server fetches the initial source list so the panel renders without an
 * extra round-trip.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export interface PrSourceRow {
  id: number;
  kind: 'rss' | 'reddit';
  label: string | null;
  url?: string | null;
  isActive: boolean;
  lastRunAt: string | null;
  lastStatus: string | null;
}

interface ApiSource {
  id: number;
  kind: 'rss' | 'reddit';
  label: string | null;
  configJson?: { url?: string } | null;
  isActive: boolean;
  lastRunAt: string | null;
  lastStatus: string | null;
}

export default function PrSourcesPanel({
  clientId,
  clientName,
  initial
}: {
  clientId: number;
  clientName: string;
  initial: PrSourceRow[];
}) {
  const router = useRouter();
  const [sources, setSources] = useState<PrSourceRow[]>(initial);
  const [url, setUrl] = useState('');
  const [label, setLabel] = useState('');
  const [adding, setAdding] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function configUrl(s: ApiSource): string | null {
    if (!s.configJson || typeof s.configJson !== 'object') return null;
    const u = (s.configJson as { url?: unknown }).url;
    return typeof u === 'string' ? u : null;
  }

  async function refresh() {
    try {
      const res = await fetch(`/api/admin/av/clients/${clientId}/pr-sources`, { cache: 'no-store' });
      const data = await res.json();
      if (Array.isArray(data?.sources)) {
        setSources(
          (data.sources as ApiSource[]).map((s) => ({
            id: s.id,
            kind: s.kind,
            label: s.label,
            url: configUrl(s),
            isActive: s.isActive,
            lastRunAt: s.lastRunAt,
            lastStatus: s.lastStatus
          }))
        );
      }
    } catch { /* non-fatal */ }
  }

  async function add() {
    if (!url.trim()) {
      setErr('Paste an RSS feed URL first.');
      return;
    }
    setAdding(true);
    setErr(null);
    try {
      const res = await fetch(`/api/admin/av/clients/${clientId}/pr-sources`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim(), label: label.trim() || null })
      });
      const rawText = await res.text();
      let data: { error?: string; message?: string; source?: ApiSource } | null = null;
      try { data = JSON.parse(rawText); }
      catch { throw new Error(`Server returned HTTP ${res.status} (non-JSON)`); }
      if (!res.ok) throw new Error(data?.error || data?.message || `HTTP ${res.status}`);
      setUrl('');
      setLabel('');
      await refresh();
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setAdding(false);
    }
  }

  async function toggle(s: PrSourceRow) {
    try {
      await fetch(`/api/admin/av/clients/${clientId}/pr-sources/${s.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !s.isActive })
      });
      await refresh();
    } catch { /* non-fatal */ }
  }

  async function remove(s: PrSourceRow) {
    if (!window.confirm(`Remove ${s.label || s.url || `source #${s.id}`} from ${clientName}'s PR sources?`)) return;
    try {
      await fetch(`/api/admin/av/clients/${clientId}/pr-sources/${s.id}`, { method: 'DELETE' });
      await refresh();
      router.refresh();
    } catch { /* non-fatal */ }
  }

  const inputCls =
    'w-full rounded-md bg-black/30 border border-white/10 px-2.5 py-1.5 text-[12px] text-white/90 ' +
    'placeholder-white/30 focus:outline-none focus:border-amber-400/50';

  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <div className="text-[11px] uppercase tracking-[0.12em] text-muted mb-1">
        Per-client PR sources
      </div>
      <div className="text-[13px] text-white/70 mb-3">
        RSS feeds tuned to {clientName}&apos;s world. Each one gets pulled on the next discovery sweep;
        matched opportunities show up on their PR pipeline above. Use this for what they actually
        care about (e.g. political journalism for a congressional candidate; legal trade press for a
        legal-services client; healthcare press for a medical client).
      </div>

      {/* Add form */}
      <div className="rounded-md border border-amber-400/20 bg-amber-400/[0.04] p-2.5 mb-3 space-y-1.5">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <input
            className={inputCls + ' sm:col-span-2'}
            placeholder="RSS URL — e.g. https://thehill.com/feed/"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={adding}
          />
          <input
            className={inputCls}
            placeholder="Label (optional) — e.g. The Hill"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            disabled={adding}
          />
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={add}
            disabled={adding || !url.trim()}
            className={
              'rounded-md px-3 py-1 text-[11.5px] font-medium transition ' +
              (adding || !url.trim()
                ? 'bg-white/10 text-white/40 cursor-not-allowed'
                : 'bg-amber-400/90 text-black hover:bg-amber-300')
            }
          >
            {adding ? 'Adding…' : 'Add RSS source'}
          </button>
          {err && <span className="text-[10.5px] text-rose-300">{err}</span>}
        </div>
      </div>

      {/* Existing sources */}
      {sources.length === 0 ? (
        <div className="text-[11.5px] text-white/40 italic">
          No client-specific sources yet. The tenant-wide PR inbox + global Reddit/RSS feeds
          still run as before.
        </div>
      ) : (
        <ul className="space-y-1.5">
          {sources.map((s) => (
            <li
              key={s.id}
              className="flex items-center gap-2 rounded-md border border-white/10 bg-black/15 px-2.5 py-1.5"
            >
              <span
                className={
                  'inline-flex items-center px-1.5 py-0.5 rounded text-[9.5px] font-medium uppercase tracking-wider border ' +
                  (s.isActive
                    ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                    : 'bg-white/10 text-white/40 border-white/15')
                }
              >
                {s.isActive ? s.kind : `${s.kind} · off`}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[12px] text-white/90 truncate">
                  {s.label || s.url || `Source #${s.id}`}
                </div>
                {s.url && s.label && (
                  <div className="text-[10.5px] text-white/40 truncate font-mono">{s.url}</div>
                )}
                {s.lastRunAt && (
                  <div className="text-[10px] text-white/35">
                    Last run {new Date(s.lastRunAt).toLocaleString()} · {s.lastStatus || 'unknown'}
                  </div>
                )}
              </div>
              <button
                onClick={() => toggle(s)}
                className="text-[10px] uppercase tracking-wider text-white/50 hover:text-white/85"
              >
                {s.isActive ? 'pause' : 'resume'}
              </button>
              <button
                onClick={() => remove(s)}
                className="text-[10px] uppercase tracking-wider text-rose-300/70 hover:text-rose-300"
              >
                remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
