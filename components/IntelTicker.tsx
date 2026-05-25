'use client';

/**
 * IntelTicker — the hub's heartbeat. A thin "breaking news" bar across every
 * operator page showing the newest PR intelligence as it comes in (rotating),
 * with a link into the PR desk. Polls every 90s; rotates every 5s. Dismissible
 * for the session. When nothing's new, shows a calm "monitoring" pulse so the
 * hub always feels alive. Operator-only.
 */
import { useEffect, useState } from 'react';

interface TickerItem {
  id: number;
  source: string | null;
  outlet: string | null;
  topics: string[];
  whyItMatters: string | null;
  company: string | null;
  createdAt: string;
}

const SOURCE_LABEL: Record<string, string> = {
  qwoted: 'Qwoted', featured: 'Featured', sourcebottle: 'SourceBottle',
  help_a_b2b_writer: 'HARO', reddit: 'Reddit', linkedin: 'LinkedIn',
  podcast: 'Podcast', manual: 'Added', other: 'Source'
};

function headline(it: TickerItem): string {
  const src = it.outlet || (it.source ? SOURCE_LABEL[it.source] ?? it.source : 'New');
  const topic = it.topics[0] ? ` · ${it.topics[0]}` : '';
  const who = it.company ? ` → ${it.company}` : '';
  return `${src}${topic}${who}`;
}

export function IntelTicker() {
  const [items, setItems] = useState<TickerItem[]>([]);
  const [idx, setIdx] = useState(0);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch('/api/admin/pr/ticker', { cache: 'no-store' });
        const j = await res.json();
        if (alive && Array.isArray(j.items)) setItems(j.items);
      } catch { /* stay quiet */ }
    };
    load();
    const poll = setInterval(load, 90_000);
    return () => { alive = false; clearInterval(poll); };
  }, []);

  useEffect(() => {
    if (items.length < 2) return;
    const rot = setInterval(() => setIdx((i) => (i + 1) % items.length), 5000);
    return () => clearInterval(rot);
  }, [items.length]);

  if (dismissed) return null;

  const cur = items[idx % Math.max(1, items.length)];

  return (
    <div
      className="mb-5 flex items-center gap-3 rounded-lg border px-3 py-2 text-sm"
      style={{ borderColor: 'rgba(255,156,91,0.35)', background: 'linear-gradient(90deg, rgba(255,90,110,0.10), rgba(255,156,91,0.06))' }}
      role="status"
      aria-live="polite"
    >
      <span className="live-dot shrink-0" aria-hidden="true" />
      <span className="shrink-0 text-[10px] uppercase tracking-[0.16em]" style={{ color: '#FFC73D' }}>
        {items.length ? 'New intel' : 'Monitoring'}
      </span>
      <div className="min-w-0 flex-1 truncate text-ink">
        {items.length ? (
          <span title={cur?.whyItMatters ?? ''}>
            <span className="font-medium">{cur ? headline(cur) : ''}</span>
            {cur?.whyItMatters ? <span className="text-muted"> — {cur.whyItMatters}</span> : null}
          </span>
        ) : (
          <span className="text-muted">Listening for new opportunities across your PR sources…</span>
        )}
      </div>
      {items.length > 0 && (
        <a href="/admin/pr" className="shrink-0 text-brand hover:underline text-xs">View in PR →</a>
      )}
      <button onClick={() => setDismissed(true)} aria-label="Dismiss" className="shrink-0 text-muted hover:text-ink text-xs px-1">✕</button>
    </div>
  );
}
