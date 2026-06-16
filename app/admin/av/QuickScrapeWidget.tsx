'use client';

/**
 * QuickScrapeWidget — leads-page entry point for the smart scraper.
 *
 * val often spots a website she wants to chase RIGHT FROM the leads page
 * (e.g. NDVIP — Mike forwarded a referral, she needs to add it without
 * bouncing to /admin/av/discover). This is a minimal-noise version of the
 * full ScrapeDiscoverForm: one URL field + optional industry, hit POST
 * /api/admin/av/discover/scrape, surface the result inline with a deep-link.
 *
 * No destination picker (defaults to operator pipeline = unassigned), no
 * bulk mode, no target-business override. Power users still go to the full
 * /admin/av/discover page for those knobs. This is the 80% "paste-and-go"
 * affordance the cockpit was missing.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

interface ScrapeResponse {
  ok: boolean;
  mode: 'new' | 'fill';
  inserted?: boolean;
  duplicate?: boolean;
  leadId?: number;
  auditId?: string;
  company?: string;
  reason?: string;
  error?: string;
}

export function QuickScrapeWidget() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [industry, setIndustry] = useState('');
  // (val 2026-06-16, #702) Pre-fill fields — when val ALREADY has contact
  // info (referral, dinner intro, prior email), she pastes it here so we
  // don't depend on the scraper finding it. Operator values take precedence
  // over scraped values server-side.
  const [contactName, setContactName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [company, setCompany] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ScrapeResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;
    setBusy(true);
    setErr(null);
    setResult(null);
    try {
      const res = await fetch('/api/admin/av/discover/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // mode='new' is the create-a-lead path; the scrape endpoint also
        // supports 'fill' for backfilling an existing lead's missing fields.
        body: JSON.stringify({
          mode: 'new',
          websiteUrl: url.trim(),
          industry: industry.trim() || null,
          // (#702) Pre-fill values. Server-side these win over scraped values.
          contactName: contactName.trim() || null,
          email: email.trim() || null,
          phone: phone.trim() || null,
          company: company.trim() || null,
          notes: notes.trim() || null
        })
      });
      const j: ScrapeResponse = await res.json().catch(() => ({ ok: false, mode: 'new' }));
      if (!res.ok) {
        setErr(j.error ?? `HTTP ${res.status}`);
        return;
      }
      setResult(j);
      if (j.ok && j.inserted) {
        // Refresh the leads list so the new row shows up in the table below.
        // We intentionally DON'T clear the URL field so val sees what she
        // just submitted — easier to spot duplicates from her own clicks.
        router.refresh();
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // Collapsed by default — the leads page is dense, this stays out of the
  // way until val needs it. Expanded state is sticky for the session via
  // useState (doesn't survive reload — that's fine, the widget is fast).
  if (!open) {
    return (
      <div className="mb-4 flex items-center gap-3">
        <button
          type="button"
          onClick={() => setOpen(true)}
          title="Paste a website URL and the smart scraper will pull email/phone/socials and insert a new lead — same engine as Find new leads."
          className="text-[12px] px-3 py-1.5 rounded-md border border-[color-mix(in_srgb,var(--gold-bright)_30%,transparent)] text-[color-mix(in_srgb,var(--gold-bright)_95%,transparent)] hover:border-[color-mix(in_srgb,var(--gold-bright)_60%,transparent)] bg-[color-mix(in_srgb,var(--gold-bright)_5%,transparent)] transition"
        >
          ✨ Quick add from a website
        </button>
        <Link
          href="/admin/av/discover"
          className="text-[11px] text-muted hover:text-ink underline-offset-2 hover:underline transition"
        >
          More find-new-leads options →
        </Link>
      </div>
    );
  }

  return (
    <div className="mb-4 rounded-xl border border-[color-mix(in_srgb,var(--gold-bright)_30%,transparent)] bg-[color-mix(in_srgb,var(--gold-bright)_5%,transparent)] p-4">
      <div className="flex items-baseline justify-between gap-3 mb-2">
        <div>
          <h2 className="text-sm font-semibold text-ink">✨ Quick add from a website</h2>
          <p className="text-[11px] text-muted mt-0.5">
            Paste a URL. The scraper pulls email / phone / socials and inserts a new lead. For the full
            options (destination, target business, bulk fill), use{' '}
            <Link href="/admin/av/discover" className="underline">
              Find new leads
            </Link>.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-[11px] text-muted hover:text-ink transition shrink-0"
          aria-label="Close quick-add"
        >
          ✕
        </button>
      </div>

      <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
        <div className="flex-1 min-w-[220px]">
          <label className="block text-[10px] uppercase tracking-[0.14em] text-muted mb-1">
            Website URL
          </label>
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://ndvip.com/"
            required
            disabled={busy}
            className="w-full text-sm bg-black/30 border border-border rounded-md px-3 py-1.5 text-ink focus:outline-none focus:border-[color-mix(in_srgb,var(--gold-bright)_50%,transparent)] transition"
          />
        </div>
        <div className="w-44">
          <label className="block text-[10px] uppercase tracking-[0.14em] text-muted mb-1">
            Industry (optional)
          </label>
          <input
            type="text"
            value={industry}
            onChange={(e) => setIndustry(e.target.value)}
            placeholder="e.g. restaurant, hotel"
            disabled={busy}
            className="w-full text-sm bg-black/30 border border-border rounded-md px-3 py-1.5 text-ink focus:outline-none focus:border-[color-mix(in_srgb,var(--gold-bright)_50%,transparent)] transition"
          />
        </div>
        <button
          type="submit"
          disabled={busy || !url.trim()}
          className={
            'text-sm px-3 py-1.5 rounded-md border transition ' +
            (busy || !url.trim()
              ? 'border-white/10 text-white/30 cursor-not-allowed'
              : 'border-[color-mix(in_srgb,var(--gold-bright)_50%,transparent)] text-[var(--gold-bright)] hover:border-[color-mix(in_srgb,var(--gold-bright)_80%,transparent)] bg-[color-mix(in_srgb,var(--gold-bright)_12%,transparent)]')
          }
        >
          {busy ? 'Scraping…' : 'Scrape & insert'}
        </button>
      </form>

      {/* (val 2026-06-16, #702) "What I already know" — optional pre-fill.
          When val has info from a referral / dinner / prior email, paste it
          here. Operator values override scraper values on the server side.
          Collapsed by default to keep the widget calm. */}
      <details className="mt-3">
        <summary className="cursor-pointer text-[11px] text-muted hover:text-ink select-none">
          + What I already know (contact name, email, phone, company, notes)
        </summary>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-3">
          <div>
            <label className="block text-[10px] uppercase tracking-[0.14em] text-muted mb-1">
              Contact name
            </label>
            <input
              type="text"
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
              placeholder="e.g. Divine Schultheis"
              disabled={busy}
              className="w-full text-sm bg-black/30 border border-border rounded-md px-3 py-1.5 text-ink focus:outline-none focus:border-[color-mix(in_srgb,var(--gold-bright)_50%,transparent)] transition"
            />
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-[0.14em] text-muted mb-1">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="e.g. divine@divinedental.com"
              disabled={busy}
              className="w-full text-sm bg-black/30 border border-border rounded-md px-3 py-1.5 text-ink focus:outline-none focus:border-[color-mix(in_srgb,var(--gold-bright)_50%,transparent)] transition"
            />
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-[0.14em] text-muted mb-1">
              Phone
            </label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="e.g. (555) 555-5555"
              disabled={busy}
              className="w-full text-sm bg-black/30 border border-border rounded-md px-3 py-1.5 text-ink focus:outline-none focus:border-[color-mix(in_srgb,var(--gold-bright)_50%,transparent)] transition"
            />
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-[0.14em] text-muted mb-1">
              Company (override)
            </label>
            <input
              type="text"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              placeholder="Only if scraped title is wrong"
              disabled={busy}
              className="w-full text-sm bg-black/30 border border-border rounded-md px-3 py-1.5 text-ink focus:outline-none focus:border-[color-mix(in_srgb,var(--gold-bright)_50%,transparent)] transition"
            />
          </div>
          <div className="md:col-span-2">
            <label className="block text-[10px] uppercase tracking-[0.14em] text-muted mb-1">
              Notes (how you know them, context, anything Val will want later)
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Mike Bannister intro at the Skip dinner — interested in EBW for office holiday party"
              rows={2}
              disabled={busy}
              className="w-full text-sm bg-black/30 border border-border rounded-md px-3 py-1.5 text-ink focus:outline-none focus:border-[color-mix(in_srgb,var(--gold-bright)_50%,transparent)] transition resize-y"
            />
          </div>
        </div>
      </details>

      {result && result.ok && result.inserted && (
        <div
          className="mt-3 text-[12px] rounded-md border border-emerald-400/30 bg-emerald-400/5 px-3 py-2"
          style={{ color: '#86efac' }}
        >
          ✓ Inserted lead{result.company ? ` — ${result.company}` : ''}
          {result.auditId && (
            <>
              {' · '}
              <Link
                href={`/admin/av/${result.auditId}`}
                className="underline-offset-2 hover:underline font-medium"
              >
                Open lead detail
              </Link>
            </>
          )}
        </div>
      )}
      {result && result.ok && !result.inserted && result.duplicate && (
        <div className="mt-3 text-[12px] rounded-md border border-[color-mix(in_srgb,var(--gold-bright)_30%,transparent)] bg-[color-mix(in_srgb,var(--gold-bright)_5%,transparent)] px-3 py-2 text-[color-mix(in_srgb,var(--gold-bright)_95%,transparent)]">
          Already in pipeline{result.company ? ` — ${result.company}` : ''}
          {result.auditId && (
            <>
              {' · '}
              <Link
                href={`/admin/av/${result.auditId}`}
                className="underline-offset-2 hover:underline font-medium"
              >
                Open existing lead
              </Link>
            </>
          )}
        </div>
      )}
      {result && !result.ok && result.reason && (
        <div
          className="mt-3 text-[12px] rounded-md border border-[color-mix(in_srgb,var(--gold-bright)_30%,transparent)] bg-[color-mix(in_srgb,var(--gold-bright)_5%,transparent)] px-3 py-2"
          style={{ color: '#fde68a' }}
        >
          {result.reason}
        </div>
      )}
      {err && (
        <div
          className="mt-3 text-[12px] rounded-md border border-rose-400/30 bg-rose-400/5 px-3 py-2"
          style={{ color: '#fca5a5' }}
        >
          {err}
        </div>
      )}
    </div>
  );
}
