'use client';

/**
 * PrInboxPanel  (#226)
 *
 * Per-client PR inbox address surface. Lives on the operator client page,
 * just under the existing PR opportunities panel. Shows the live email
 * address for inbound journalist requests, with a Copy button and a
 * "Generate / Rotate" button.
 *
 * Server hands us the initial record so the panel renders without a
 * client-side fetch round-trip on first paint.
 */
import { useState } from 'react';

export interface PrInboxInitial {
  slug: string | null;
  email: string | null;
  setAt: string | null;
}

export default function PrInboxPanel({
  clientId,
  clientName,
  initial
}: {
  clientId: number;
  clientName: string;
  initial: PrInboxInitial;
}) {
  const [slug, setSlug] = useState<string | null>(initial.slug);
  const [email, setEmail] = useState<string | null>(initial.email);
  const [setAt, setSetAt] = useState<string | null>(initial.setAt);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function generate(rotate: boolean) {
    if (rotate) {
      const ok = window.confirm(
        `Rotate the PR inbox for ${clientName}?\n\n` +
        `Anything still using the OLD address (${email || '(none)'}) will stop working immediately. ` +
        `Use this if the address leaked or you want a clean re-issue.`
      );
      if (!ok) return;
    }
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/admin/av/clients/${clientId}/pr-inbox`, { method: 'POST' });
      const rawText = await res.text();
      let data: { ok?: boolean; slug?: string; email?: string; setAt?: string; error?: string; message?: string } | null = null;
      try { data = JSON.parse(rawText); }
      catch { throw new Error(`Server returned HTTP ${res.status} (non-JSON)`); }
      if (!res.ok) throw new Error(data?.error || data?.message || `HTTP ${res.status}`);
      setSlug(data?.slug || null);
      setEmail(data?.email || null);
      setSetAt(data?.setAt || null);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function copy() {
    if (!email) return;
    navigator.clipboard.writeText(email).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <div className="text-[11px] uppercase tracking-[0.12em] text-muted mb-1">
        PR inbox address
      </div>
      <div className="text-[13px] text-white/70 mb-3">
        Hand this address to journalists / publicists / media-list services for {clientName}. Every email
        sent here lands in their PR pipeline automatically — no manual forwarding.
      </div>

      {email ? (
        <div className="rounded-lg border border-[color-mix(in_srgb,var(--gold-bright)_30%,transparent)] bg-[var(--gold-bright)]/[0.05] px-3 py-2 mb-3">
          <div className="flex items-center gap-2 flex-wrap">
            <code className="text-[13px] text-[color-mix(in_srgb,var(--gold-bright)_95%,transparent)] font-mono break-all">{email}</code>
            <button
              onClick={copy}
              className="ml-auto rounded-md px-2.5 py-1 text-[10.5px] font-medium uppercase tracking-wider border border-[color-mix(in_srgb,var(--gold-bright)_35%,transparent)] text-[var(--gold-bright)] hover:bg-[color-mix(in_srgb,var(--gold-bright)_10%,transparent)] transition"
            >
              {copied ? 'Copied ✓' : 'Copy'}
            </button>
          </div>
          {setAt && (
            <div className="text-[10.5px] text-white/40 mt-1.5">
              Generated {new Date(setAt).toLocaleString()}
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-lg border border-white/10 bg-black/15 px-3 py-3 mb-3 text-[12.5px] text-white/55">
          No PR inbox address generated for {clientName} yet. Generate one and the address goes live the
          moment the DNS / forwarding is wired (see playbook).
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={() => generate(slug != null)}
          disabled={busy}
          className={
            'rounded-md px-3 py-1.5 text-[12px] font-medium transition ' +
            (busy
              ? 'bg-white/10 text-white/40 cursor-not-allowed'
              : slug
              ? 'border border-white/20 text-white/70 hover:border-white/40 hover:text-white'
              : 'border border-[color-mix(in_srgb,var(--gold-bright)_40%,transparent)] text-[var(--gold-bright)] hover:bg-[color-mix(in_srgb,var(--gold-bright)_10%,transparent)]')
          }
        >
          {busy
            ? 'Generating…'
            : slug
            ? 'Rotate address (invalidates the current one)'
            : 'Generate PR inbox address'}
        </button>
      </div>

      {err && (
        <div className="mt-2 rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-[11.5px] text-rose-200">
          {err}
        </div>
      )}

      <div className="mt-3 text-[10.5px] text-white/40 leading-relaxed">
        Setup is one-time per domain — see <code>Atlantic_Hub_Playbook/PR_Inbox_DNS_Setup.md</code>.
        After that, every per-client slug routes automatically.
      </div>
    </div>
  );
}
