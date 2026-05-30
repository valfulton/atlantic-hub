'use client';

/**
 * MakeClientButton — convert an existing lead into a client account in one step.
 *
 * Carries the lead's known info (email, contact, company, industry) into the
 * client-create flow, links this lead (and any sharing the email) to the new
 * client, and returns the magic link to send when YOU choose. After creating,
 * finish their full brief on the Creative brief page. Owner + staff.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';

type Tier = 'audit_only' | 'sprint' | 'momentum' | 'scale';

export function MakeClientButton(props: {
  /** (#253) The lead's audit_id — when present, the create route will look up
   *  source_payload.lead_intake_draft and pre-fill the new client's intake. */
  auditId?: string;
  email: string | null;
  company: string | null;
  contactName: string | null;
  industry: string | null;
  clientId: number | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{
    clientId: number | null;
    magicLink: string;
    emailSent: boolean;
    /** (#253) How many intake fields the smart-scrape draft contributed. */
    draftFieldsMerged?: number;
  } | null>(null);
  const [tier, setTier] = useState<Tier>('scale');
  const [trialDays, setTrialDays] = useState('30');

  // Already a client — show status instead of the button.
  if (props.clientId) {
    return (
      <span className="px-3 py-1.5 rounded-md border border-emerald-400/40 text-emerald-300 text-sm">Client ✓</span>
    );
  }

  const canCreate = !!(props.email && props.email.includes('@'));

  async function create(send: boolean) {
    setBusy(true); setErr(null); setDone(null);
    try {
      const res = await fetch('/api/admin/av/clients/create', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: (props.email || '').trim(),
          name: props.contactName || null,
          company: props.company || null,
          industry: props.industry || null,
          // (#253) Sending auditId triggers the lead_intake_draft carryover
          // on the server — the new client lands with a populated intake the
          // moment they exist.
          auditId: props.auditId ?? null,
          tier,
          trialDays: Number(trialDays) || null,
          sendInvite: send
        })
      });
      const j = await res.json();
      if (res.ok && j.ok) {
        setDone({
          clientId: j.clientId ?? null,
          magicLink: j.magicLink,
          emailSent: j.emailSent,
          draftFieldsMerged: typeof j.draftFieldsMerged === 'number' ? j.draftFieldsMerged : 0
        });
        router.refresh();
      } else {
        setErr(j.error || 'Could not create the client.');
      }
    } catch {
      setErr('Could not create the client.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="px-3 py-1.5 rounded-md border border-border text-sm text-ink hover:border-brand transition-colors"
      >
        Make client
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => !busy && setOpen(false)}>
          <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <div className="text-base font-semibold text-ink">Convert lead to client</div>
              <button onClick={() => setOpen(false)} className="text-muted text-sm hover:text-ink" disabled={busy}>Close</button>
            </div>

            {done ? (
              <div className="text-sm text-ink space-y-3">
                <p>
                  Client created.{' '}
                  {done.emailSent ? 'Magic-link invite emailed.' : 'No email sent — copy the link to send when ready.'}
                </p>
                {/* (#253) Show the carryover so val sees the auto-fill actually
                    happened. The lead's smart-scrape draft contributed N intake
                    fields — the new client's brief is already partly populated.
                    When the draft contributes zero, we stay silent (no point
                    nagging val with "0 fields carried over"). */}
                {done.draftFieldsMerged && done.draftFieldsMerged > 0 ? (
                  <div
                    className="rounded-md border px-3 py-2 text-xs leading-relaxed"
                    style={{
                      borderColor: 'rgba(110,231,183,0.35)',
                      background: 'rgba(110,231,183,0.08)',
                      color: '#86efac'
                    }}
                  >
                    ✨ <span className="font-medium">{done.draftFieldsMerged}</span>{' '}
                    intake field{done.draftFieldsMerged === 1 ? '' : 's'} carried over from this
                    lead&apos;s smart-scrape draft. Their brief is already partly populated — open
                    the client page to review.
                  </div>
                ) : props.auditId ? (
                  <div className="text-[11px] text-muted">
                    Tip: run <span className="text-ink">✨ Smart enrich from website</span> on a
                    lead before converting and the new client&apos;s intake will pre-fill from the
                    page.
                  </div>
                ) : null}
                <div>
                  <div className="text-[11px] uppercase tracking-[0.1em] text-muted mb-1">Magic link (valid 24h)</div>
                  <div className="flex gap-2">
                    <input className="w-full rounded-lg border border-border bg-black/30 px-3 py-2 text-sm text-ink" readOnly value={done.magicLink} onFocusCapture={(e) => e.currentTarget.select()} />
                    <button onClick={() => navigator.clipboard?.writeText(done.magicLink)} className="shrink-0 rounded-lg border border-border bg-black/30 px-3 text-sm text-ink">Copy</button>
                  </div>
                </div>
                <div className="flex gap-2 pt-1">
                  <a href="/admin/av/brief" className="rounded-lg bg-brand hover:opacity-90 text-brand-fg font-medium text-sm px-4 py-2">Finish their brief</a>
                  {done.clientId && <a href={`/admin/av/clients/${done.clientId}`} className="rounded-lg border border-border bg-black/30 px-4 py-2 text-sm text-ink">Open client</a>}
                </div>
              </div>
            ) : (
              <div className="space-y-3 text-sm">
                <p className="text-muted">
                  Creating a client for <span className="text-ink">{props.contactName || props.company || props.email}</span>. This links their lead(s) and prepares their hub. Finish the full brief afterward.
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-[11px] uppercase tracking-[0.1em] text-muted mb-1">Tier</div>
                    <select className="w-full rounded-lg border border-border bg-black/30 px-3 py-2 text-ink" value={tier} onChange={(e) => setTier(e.target.value as Tier)}>
                      {(['audit_only', 'sprint', 'momentum', 'scale'] as Tier[]).map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  <div>
                    <div className="text-[11px] uppercase tracking-[0.1em] text-muted mb-1">Trial days (blank = permanent)</div>
                    <input className="w-full rounded-lg border border-border bg-black/30 px-3 py-2 text-ink" inputMode="numeric" value={trialDays} onChange={(e) => setTrialDays(e.target.value)} />
                  </div>
                </div>
                {!canCreate && <div className="text-xs" style={{ color: '#fca5a5' }}>This lead needs a valid email before it can become a client.</div>}
                {err && <div className="text-xs" style={{ color: '#fca5a5' }}>{err}</div>}
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => create(false)}
                    disabled={busy || !canCreate}
                    className="rounded-lg bg-brand hover:opacity-90 disabled:opacity-50 text-brand-fg font-medium text-sm px-5 py-2"
                  >
                    {busy ? 'Saving…' : 'Save only'}
                  </button>
                  <button
                    onClick={() => create(true)}
                    disabled={busy || !canCreate}
                    className="rounded-lg border border-border bg-black/30 hover:border-brand disabled:opacity-50 text-ink font-medium text-sm px-5 py-2"
                  >
                    {busy ? 'Saving…' : 'Save & send invite'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
