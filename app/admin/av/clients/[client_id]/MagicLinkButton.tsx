'use client';

/**
 * MagicLinkButton — generate a FRESH magic-link for an existing client (the
 * original from account creation expires in 24h). Shows the link to copy, with
 * an option to email it to them directly.
 *
 * (#297) Hardened the operator-facing copy after the deep-dive audit:
 *   - Recipient email is surfaced FIRST (the chip), not buried in a header line.
 *     Was: "Magic link for tim@... — valid 24h" all in one muted line.
 *   - "Regenerate" now flashes an explicit "Old link is now invalid" confirmation
 *     so val never accidentally sends a dead URL after regenerating.
 *   - New "Single-use" caveat under the URL so val doesn't expect a re-clickable
 *     link (per the audit: token consumes on first land, sets session cookie).
 *   - "Email it to them" button switched to bg-brand text-black per contrast rule;
 *     "Regenerate" stays a quiet underlined link.
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
  // (#297) "Was just regenerated" flag so we can flash an explicit "old link
  // is dead" callout right after a regenerate. Reset on next action.
  const [justRegenerated, setJustRegenerated] = useState(false);

  async function generate(send: boolean, isRegen: boolean = false) {
    setBusy(true); setErr(null); setEmailSent(null); setCopied(false);
    if (!isRegen) setJustRegenerated(false);
    try {
      const res = await fetch(`/api/admin/av/clients/${clientId}/magic-link`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ send })
      });
      const j = await res.json();
      if (!res.ok || !j.ok) {
        // (#368) The route now returns {error:'no_user', reason:'...'} with a
        // friendly explanation when no login is attached. Surface the reason
        // verbatim — it points val at the right next step (the EMAIL+PASSWORD
        // panel below) instead of leaving her staring at a raw error.
        setErr(j.reason || j.error || 'Could not generate.');
        return;
      }
      setLink(j.link); setEmail(j.email); setHours(j.expiresInHours ?? 24);
      if (send) setEmailSent(!!j.emailSent);
      if (isRegen) setJustRegenerated(true);
    } catch {
      setErr('Could not generate.');
    } finally {
      setBusy(false);
    }
  }

  function copy() {
    if (link) { navigator.clipboard?.writeText(link); setCopied(true); window.setTimeout(() => setCopied(false), 1600); }
  }

  if (!link) {
    return (
      <span className="inline-flex items-center gap-2 flex-wrap">
        <button onClick={() => generate(false)} disabled={busy} className="text-brand hover:underline text-sm">
          {busy ? 'Generating…' : 'Generate portal sign-in link (intake-gated) →'}
        </button>
        {err && <span className="text-xs" style={{ color: '#fca5a5' }}>{err}</span>}
      </span>
    );
  }

  return (
    <div className="rounded-2xl border border-border bg-surface p-4 mb-6">
      {/* (#297) Recipient + expiry as the FIRST thing val reads. */}
      <div className="flex items-baseline justify-between gap-3 mb-1.5 flex-wrap">
        <div className="text-[11px] uppercase tracking-[0.12em] text-muted">
          Magic link {email ? <>for <span className="text-ink/90 normal-case tracking-normal font-medium">{email}</span></> : '(recipient unknown)'}
        </div>
        <span className="text-[10px] text-muted/80 shrink-0" title="Expires in 24 hours from generation. Single-use: lands them in a session, then the token is consumed.">
          Valid {hours}h · single-use
        </span>
      </div>
      <p className="text-[11.5px] text-muted/90 mb-2 leading-snug">
        Logs them in for {hours}h and lands them on their intake until it&apos;s complete. After they click it once, the token consumes — if they need to log in again later, hit Regenerate.
      </p>

      {/* (#297) Explicit "old link is dead" callout right after a regenerate so
          val never sends the wrong URL by mistake. */}
      {justRegenerated && (
        <div
          className="text-[11px] mb-2 rounded-md px-2.5 py-1.5"
          style={{ background: 'rgba(110,231,183,0.10)', color: '#86efac', border: '1px solid rgba(110,231,183,0.25)' }}
        >
          ✓ Fresh link generated. Any previous magic link for {email || 'this client'} is now invalid — only the URL below works.
        </div>
      )}

      <div className="flex gap-2 mb-2">
        <input
          readOnly
          value={link}
          onFocus={(e) => e.currentTarget.select()}
          className="w-full rounded-lg border border-border bg-black/30 px-3 py-2 text-sm text-ink"
        />
        <button
          onClick={copy}
          className="shrink-0 rounded-lg border border-border bg-black/30 px-3 text-sm text-ink hover:border-brand"
        >
          {copied ? '✓ Copied' : 'Copy'}
        </button>
      </div>
      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={() => generate(true)}
          disabled={busy}
          // Contrast rule: bg-brand always text-black.
          className="rounded-lg px-3 py-1.5 text-xs font-medium bg-brand text-black hover:opacity-90 disabled:opacity-50"
        >
          {busy ? 'Sending…' : `📧 Email it to ${email ? email.split('@')[0] : 'them'}`}
        </button>
        <button
          onClick={() => generate(false, true)}
          disabled={busy}
          className="text-xs text-muted hover:text-ink underline"
          title="Generates a brand-new link and invalidates the previous one. Use when the previous link has been used or shared with the wrong person."
        >
          Regenerate (invalidates old link)
        </button>
        {emailSent === true && <span className="text-xs" style={{ color: '#6ee7b7' }}>Emailed ✓</span>}
        {emailSent === false && <span className="text-xs" style={{ color: '#fca5a5' }}>Email didn&apos;t send — copy the link instead.</span>}
        {err && <span className="text-xs" style={{ color: '#fca5a5' }}>{err}</span>}
      </div>
    </div>
  );
}
