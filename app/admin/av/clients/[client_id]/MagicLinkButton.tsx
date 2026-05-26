'use client';

/**
 * MagicLinkButton — generate a FRESH magic-link for an existing client (the
 * original from account creation expires in 24h). Shows the link to copy, with
 * an option to email it to them directly.
 */
import { useState } from 'react';

export default function MagicLinkButton({ clientId }: { clientId: number }) {
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [hours, setHours] = useState<number>(24);
  const [emailSent, setEmailSent] = useState<boolean | null>(null);
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function generate(send: boolean) {
    setBusy(true); setErr(null); setEmailSent(null); setCopied(false);
    try {
      const res = await fetch(`/api/admin/av/clients/${clientId}/magic-link`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ send })
      });
      const j = await res.json();
      if (!res.ok || !j.ok) { setErr(j.error || 'Could not generate.'); return; }
      setLink(j.link); setEmail(j.email); setHours(j.expiresInHours ?? 24);
      if (send) setEmailSent(!!j.emailSent);
    } catch {
      setErr('Could not generate.');
    } finally {
      setBusy(false);
    }
  }

  function copy() {
    if (link) { navigator.clipboard?.writeText(link); setCopied(true); }
  }

  if (!link) {
    return (
      <span className="inline-flex items-center gap-2 flex-wrap">
        <button onClick={() => generate(false)} disabled={busy} className="text-brand hover:underline text-sm">
          {busy ? 'Generating…' : 'Generate magic link →'}
        </button>
        {err && <span className="text-xs" style={{ color: '#fca5a5' }}>{err}</span>}
      </span>
    );
  }

  return (
    <div className="rounded-2xl border border-border bg-surface p-4 mb-6">
      <div className="text-[11px] uppercase tracking-[0.12em] text-muted mb-2">
        Magic link {email ? `for ${email}` : ''} — valid {hours}h · lands them on their intake until it's complete
      </div>
      <div className="flex gap-2 mb-2">
        <input
          readOnly
          value={link}
          onFocus={(e) => e.currentTarget.select()}
          className="w-full rounded-lg border border-border bg-black/30 px-3 py-2 text-sm text-ink"
        />
        <button onClick={copy} className="shrink-0 rounded-lg border border-border bg-black/30 px-3 text-sm text-ink hover:border-brand">
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <div className="flex items-center gap-3">
        <button onClick={() => generate(true)} disabled={busy} className="rounded-lg px-3 py-1.5 text-xs font-medium" style={{ background: 'rgba(255,156,91,0.16)', color: '#FFD9BE', border: '1px solid rgba(255,156,91,0.35)' }}>
          {busy ? 'Sending…' : 'Email it to them'}
        </button>
        <button onClick={() => generate(false)} disabled={busy} className="text-xs text-muted hover:text-ink underline">Regenerate</button>
        {emailSent === true && <span className="text-xs" style={{ color: '#6ee7b7' }}>Emailed ✓</span>}
        {emailSent === false && <span className="text-xs" style={{ color: '#fca5a5' }}>Email didn’t send — copy the link instead.</span>}
        {err && <span className="text-xs" style={{ color: '#fca5a5' }}>{err}</span>}
      </div>
    </div>
  );
}
