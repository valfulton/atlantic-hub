'use client';
/**
 * ResendInviteButton  (#301)
 *
 * Per-employee re-issue control. Posts to
 * /api/admin/av/employees/[user_id]/resend-invite, gets back a fresh
 * set-password URL with a 14-day TTL, and surfaces it inline with a copy
 * button so val can paste it into email/Slack/wherever.
 *
 * Mirrors the MagicLinkButton pattern on the client page so the visual
 * language matches: bg-brand text-black for the primary action, dark
 * surface card to show the fresh link, copy chip on the right.
 */
import { useState } from 'react';

interface ResendResponse {
  ok: boolean;
  link?: string;
  email?: string;
  expiresInDays?: number;
  wasNew?: boolean;
  error?: string;
}

export default function ResendInviteButton({ userId }: { userId: number }) {
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [ttlDays, setTtlDays] = useState<number>(14);
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function generate() {
    setBusy(true);
    setErr(null);
    setCopied(false);
    try {
      const res = await fetch(`/api/admin/av/employees/${userId}/resend-invite`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}'
      });
      const j: ResendResponse = await res.json().catch(() => ({ ok: false, error: 'bad response' }));
      if (!res.ok || !j.ok || !j.link) {
        setErr(j.error || `HTTP ${res.status}`);
        return;
      }
      setLink(j.link);
      setEmail(j.email ?? null);
      setTtlDays(j.expiresInDays ?? 14);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function copy() {
    if (!link) return;
    navigator.clipboard?.writeText(link);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  if (!link) {
    return (
      <div>
        <button
          type="button"
          onClick={generate}
          disabled={busy}
          // Contrast rule: bg-brand always text-black.
          className="text-sm font-medium px-3 py-1.5 rounded-md bg-brand text-black hover:opacity-90 disabled:opacity-50 inline-flex items-center gap-2"
          title="Generate a fresh set-password link for this employee. The old link (if any) is invalidated."
        >
          {busy ? 'Generating…' : '📧 Resend invite link'}
        </button>
        {err && <span className="ml-3 text-xs" style={{ color: '#fca5a5' }}>{err}</span>}
        <p className="text-[11px] text-muted mt-2 leading-relaxed">
          Generates a fresh URL the employee can use to set their password. The previous link
          (if any) is invalidated. Paste the new URL into email or Slack.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-emerald-400/30 bg-emerald-400/[0.06] p-4">
      <div className="text-[11px] uppercase tracking-[0.12em] mb-1.5" style={{ color: '#86efac' }}>
        ✓ Fresh invite ready{email ? ` for ${email}` : ''}
      </div>
      <p className="text-[11.5px] text-muted/90 mb-2 leading-snug">
        Any previous link for this employee is now invalid. The link below is valid for {ttlDays} days.
      </p>
      <div className="flex gap-2">
        <input
          readOnly
          value={link}
          onFocus={(e) => e.currentTarget.select()}
          className="w-full rounded-lg border border-border bg-black/30 px-3 py-2 text-sm text-ink"
        />
        <button
          onClick={copy}
          className="shrink-0 rounded-lg px-3 text-sm font-medium bg-brand text-black hover:opacity-90"
        >
          {copied ? '✓ Copied' : 'Copy'}
        </button>
      </div>
      <div className="mt-2 flex items-center gap-3">
        <button
          onClick={generate}
          disabled={busy}
          className="text-[11px] text-muted hover:text-ink underline-offset-2 hover:underline"
          title="Generate yet another fresh link (invalidates the one above)."
        >
          Regenerate
        </button>
        {err && <span className="text-xs" style={{ color: '#fca5a5' }}>{err}</span>}
      </div>
    </div>
  );
}
