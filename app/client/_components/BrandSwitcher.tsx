'use client';

/**
 * BrandSwitcher — for an owner who runs multiple brands under one login (#101).
 * Renders nothing for single-brand logins. Switching sets the active-brand
 * cookie server-side, then refreshes so every scoped surface follows along.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Brand {
  clientId: number;
  clientName: string | null;
  role: 'owner' | 'rep' | 'viewer';
}

export default function BrandSwitcher({
  brands,
  activeClientId
}: {
  brands: Brand[];
  activeClientId: number | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<number | null>(null);

  if (!brands || brands.length < 2) return null;

  async function switchTo(clientId: number) {
    if (clientId === activeClientId || busy) return;
    setBusy(clientId);
    try {
      const res = await fetch('/api/client/active-brand', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ clientId })
      });
      if (res.ok) router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="w-full border-b border-border bg-black/20">
      <div className="mx-auto max-w-6xl px-4 py-2 flex items-center gap-2 flex-wrap">
        <span className="text-[11px] uppercase tracking-[0.14em] text-muted mr-1">Your businesses</span>
        {brands.map((b) => {
          const active = b.clientId === activeClientId;
          return (
            <button
              key={b.clientId}
              onClick={() => switchTo(b.clientId)}
              disabled={busy !== null}
              className={
                'rounded-full px-3 py-1 text-sm transition border ' +
                (active
                  ? 'border-brand bg-brand/15 text-ink font-medium'
                  : 'border-border text-muted hover:text-ink hover:border-brand/50') +
                (busy === b.clientId ? ' opacity-60' : '')
              }
              aria-current={active ? 'true' : undefined}
            >
              {b.clientName || `Brand #${b.clientId}`}
            </button>
          );
        })}
      </div>
    </div>
  );
}
