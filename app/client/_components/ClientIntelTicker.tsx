'use client';

/**
 * ClientIntelTicker — a calm "breaking news, for you" strip on the client portal.
 * Shows recent PR opportunities matched to this client so they feel first-to-know.
 * Hidden entirely when there's nothing new (no machinery/empty state — clients
 * only ever see a clean signal). Rotates items; polls every 2 min.
 */
import { useEffect, useState } from 'react';

interface Item { id: number; source: string | null; outlet: string | null; topics: string[]; createdAt: string }

function headline(it: Item): string {
  const src = it.outlet || (it.source ? it.source.replace(/_/g, ' ') : 'A new opportunity');
  const topic = it.topics[0] ? ` · ${it.topics[0]}` : '';
  return `${src}${topic}`;
}

export default function ClientIntelTicker() {
  const [items, setItems] = useState<Item[]>([]);
  const [idx, setIdx] = useState(0);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch('/api/client/ticker', { cache: 'no-store' });
        const j = await res.json();
        if (alive && Array.isArray(j.items)) setItems(j.items);
      } catch { /* quiet */ }
    };
    load();
    // Auto-refresh PAUSED to cut Netlify usage (until the HostGator move, #73).
    // Loads once on mount; reload the page for fresh intel.
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (items.length < 2) return;
    const rot = setInterval(() => setIdx((i) => (i + 1) % items.length), 6000);
    return () => clearInterval(rot);
  }, [items.length]);

  if (dismissed || items.length === 0) return null;
  const cur = items[idx % items.length];

  return (
    <div
      className="flex items-center gap-3 px-4 py-2 text-sm border-b"
      style={{ borderColor: 'var(--line)', background: 'linear-gradient(90deg, var(--emerald-mist), color-mix(in srgb, var(--emerald-mist) 40%, transparent))' }}
      role="status"
      aria-live="polite"
    >
      <span className="live-dot shrink-0" aria-hidden="true" />
      <span className="shrink-0 text-[10px] uppercase tracking-[0.16em]" style={{ color: 'var(--emerald-deep)' }}>For you</span>
      <span className="min-w-0 flex-1 truncate text-ink">
        <span className="font-medium">{headline(cur)}</span>
        <span className="text-muted"> — a fresh opportunity we&apos;re lining up for you.</span>
      </span>
      <button onClick={() => setDismissed(true)} aria-label="Dismiss" className="shrink-0 text-muted hover:text-ink text-xs px-1">✕</button>
    </div>
  );
}
