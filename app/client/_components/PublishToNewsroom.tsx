'use client';

/**
 * Client-side "Publish to newsroom" action for an approved campaign piece.
 * Calls the client-guarded endpoint; on success swaps to a live link.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function PublishToNewsroom({ artifactId }: { artifactId: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [slug, setSlug] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function publish() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch('/api/client/campaign/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ artifactId })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) {
        setErr(json.error || `Could not publish (${res.status})`);
        return;
      }
      setSlug(json.slug ?? null);
      setTimeout(() => router.refresh(), 1200);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (slug) {
    return (
      <a href={`/newsroom/${slug}`} target="_blank" rel="noopener" className="mt-3 text-sm text-brand hover:underline">
        Published — view it live -&gt;
      </a>
    );
  }

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => void publish()}
        disabled={busy}
        className="inline-flex items-center justify-center px-3 py-1.5 rounded-md bg-brand text-brand-fg text-sm font-medium hover:opacity-90 disabled:opacity-50"
      >
        {busy ? 'Publishing…' : 'Publish to newsroom'}
      </button>
      {err && <p className="text-xs text-red-300 mt-1.5">{err}</p>}
    </div>
  );
}
