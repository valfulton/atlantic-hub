'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Contact-page scraper. Two modes:
 *   - 'new': paste a website URL → scrape it → insert as a new lead
 *   - 'fill': given an existing audit_id, scrape the website on file and
 *     fill in missing email/phone (don't overwrite curated data).
 *
 * Regex-over-raw-HTML (no Cheerio). Works on static sites + WordPress +
 * Squarespace; falls down on full SPAs.
 */

interface ScrapeResponse {
  ok: boolean;
  mode: 'new' | 'fill';
  inserted?: boolean;
  filled?: boolean;
  duplicate?: boolean;
  leadId?: number;
  auditId?: string;
  company?: string;
  mergedTarget?: string;
  reason?: string;
  error?: string;
  scraped?: {
    email: string | null;
    phone: string | null;
    companyTitle: string | null;
    socials: Record<string, string>;
    pagesFetched: string[];
    pagesFailed: string[];
  };
}

const TARGET_OPTIONS = [
  { value: '', label: 'Auto (by industry)' },
  { value: 'av', label: 'AV only' },
  { value: 'ebw', label: 'EBW only' },
  { value: 'both', label: 'Both pipelines' }
];

interface BulkResult {
  ok: boolean;
  dryRun?: boolean;
  checked: number;
  filled: number;
  message?: string;
  results?: Array<{
    leadId: number;
    auditId: string;
    company: string;
    website: string;
    filledEmail: boolean;
    filledPhone: boolean;
    foundSocials: number;
    emailFound: string | null;
    phoneFound: string | null;
    pagesFetched: number;
    pagesFailed: number;
    skipped: boolean;
    reason?: string;
  }>;
}

export function ScrapeDiscoverForm({ clients = [] }: { clients?: { clientId: number; name: string }[] }) {
  const router = useRouter();
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [industry, setIndustry] = useState('');
  const [targetBusiness, setTargetBusiness] = useState<string>('');
  const [destClientId, setDestClientId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ScrapeResponse | null>(null);
  // Bulk-fill state — runs scraper against existing leads with websites + missing data
  const [bulkLimit, setBulkLimit] = useState(10);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkResult, setBulkResult] = useState<BulkResult | null>(null);
  const [bulkError, setBulkError] = useState<string | null>(null);

  async function handleBulkFill(dryRun: boolean) {
    setBulkError(null);
    setBulkResult(null);
    setBulkLoading(true);
    try {
      const res = await fetch('/api/admin/av/discover/scrape-bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: bulkLimit, dryRun })
      });
      // Read as text first so we can show non-JSON error pages instead of
      // throwing a cryptic "string did not match expected pattern".
      const rawText = await res.text();
      let json: BulkResult & { error?: string } | null = null;
      try {
        json = JSON.parse(rawText) as BulkResult & { error?: string };
      } catch {
        setBulkError(
          `Server returned a non-JSON response (HTTP ${res.status}). ` +
            `First 200 chars: ${rawText.slice(0, 200)}`
        );
        return;
      }
      if (!res.ok || !json) {
        setBulkError(json?.error || `HTTP ${res.status}`);
        return;
      }
      setBulkResult(json);
      if (!dryRun) router.refresh();
    } catch (err) {
      setBulkError(`Network error: ${(err as Error).message}`);
    } finally {
      setBulkLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    if (!websiteUrl.trim()) {
      setError('Paste a website URL.');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/admin/av/discover/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'new',
          websiteUrl: websiteUrl.trim(),
          industry: industry || undefined,
          targetBusiness: targetBusiness || undefined,
          clientId: destClientId ? Number(destClientId) : undefined
        })
      });
      const json: ScrapeResponse = await res.json();
      if (!res.ok) {
        setError(json.error || `HTTP ${res.status}`);
        return;
      }
      setResult(json);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const inputStyle: React.CSSProperties = { backgroundColor: '#1a1f2e', color: '#f1f5f9' };

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-muted mb-3">
          Scrape a website&apos;s home + contact + about pages for email/phone/socials, insert as
          a lead. Use for businesses you know have a site but aren&apos;t in Apollo or Google
          Places. Cross-source dedup by domain — won&apos;t duplicate an existing lead.
        </p>
        <p className="text-xs text-muted">
          Heads-up: this is regex-over-raw-HTML, no headless browser. Works for static sites
          (WordPress, Squarespace, plain HTML). Most full-SPA contact pages will return
          nothing — try Google Places or IG for those.
        </p>
      </div>

      {/* ------------------------------------------------------------------
          BULK FILL: scrape existing leads with websites + missing data.
          For Val's 23+ St. Croix leads where Hunter struck out.
      ------------------------------------------------------------------ */}
      <div className="rounded-md border border-brand/30 p-4" style={{ backgroundColor: '#0e1420' }}>
        <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
          <div>
            <h3 className="text-sm font-medium text-ink">Fill from existing websites</h3>
            <p className="text-xs text-muted">
              Loops through leads that have a website on file but are missing a real email or phone,
              and scrapes their contact pages. Won&apos;t overwrite real data.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-3 mt-3">
          <div>
            <label className="block text-xs uppercase tracking-wider text-muted mb-1">Leads per run</label>
            <input
              type="number"
              min={1}
              max={20}
              value={bulkLimit}
              onChange={(e) => setBulkLimit(Math.min(20, Math.max(1, Number(e.target.value) || 10)))}
              className="w-20 px-3 py-2 rounded-md border border-border focus:border-brand focus:outline-none"
              style={inputStyle}
            />
          </div>
          <button
            type="button"
            onClick={() => handleBulkFill(true)}
            disabled={bulkLoading}
            className="px-3 py-2 rounded-md bg-surface border border-border text-muted hover:text-ink hover:border-brand transition-colors text-sm disabled:opacity-50"
          >
            {bulkLoading ? 'Working…' : 'Dry run (preview)'}
          </button>
          <button
            type="button"
            onClick={() => handleBulkFill(false)}
            disabled={bulkLoading}
            className="px-4 py-2 rounded-md bg-brand text-white font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {bulkLoading ? 'Scraping…' : `Scrape next ${bulkLimit} & fill`}
          </button>
        </div>

        {bulkError && (
          <div className="mt-3 rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200">
            {bulkError}
          </div>
        )}

        {bulkResult && (
          <div className="mt-3 space-y-2">
            <div className="flex flex-wrap gap-4 text-sm">
              <Stat label="Checked" value={bulkResult.checked} />
              <Stat label="Filled" value={bulkResult.filled} tone="green" />
              {bulkResult.dryRun && (
                <span className="text-xs uppercase tracking-wider text-amber-300 self-center">DRY RUN — no DB changes</span>
              )}
            </div>
            {bulkResult.message && <div className="text-sm text-muted">{bulkResult.message}</div>}
            {bulkResult.results && bulkResult.results.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-muted border-b border-border">
                    <tr>
                      <th className="text-left py-1 pr-3">Lead</th>
                      <th className="text-left py-1 pr-3">Email found</th>
                      <th className="text-left py-1 pr-3">Phone found</th>
                      <th className="text-left py-1 pr-3">Socials</th>
                      <th className="text-left py-1 pr-3">Pages</th>
                      <th className="text-left py-1 pr-3">Note</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bulkResult.results.map((r) => (
                      <tr key={r.leadId} className="border-b border-border/40">
                        <td className="py-1 pr-3 text-ink">{r.company}</td>
                        <td className="py-1 pr-3 text-muted">
                          {r.emailFound ? (
                            <span className={r.filledEmail ? 'text-green-300' : 'text-muted'}>{r.emailFound}</span>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="py-1 pr-3 text-muted">
                          {r.phoneFound ? (
                            <span className={r.filledPhone ? 'text-green-300' : 'text-muted'}>{r.phoneFound}</span>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="py-1 pr-3 text-muted">{r.foundSocials || '—'}</td>
                        <td className="py-1 pr-3 text-muted">
                          {r.pagesFetched}/{r.pagesFetched + r.pagesFailed}
                        </td>
                        <td className="py-1 pr-3 text-muted/70 text-[10px]">{r.reason ?? (r.skipped ? 'no-changes' : 'filled')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="border-t border-border pt-5">
        <h3 className="text-sm font-medium text-ink mb-2">Or: add a brand-new lead by URL</h3>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="pb-3 border-b border-border">
          <label className="block text-xs uppercase tracking-wider text-muted mb-1">Send pulled lead to</label>
          <select
            value={destClientId}
            onChange={(e) => setDestClientId(e.target.value)}
            className="w-full md:w-96 px-3 py-2 rounded-md border border-border focus:border-brand focus:outline-none text-sm"
            style={inputStyle}
          >
            <option value="">Atlantic &amp; Vine (my pipeline)</option>
            {clients.map((c) => (
              <option key={c.clientId} value={String(c.clientId)}>{c.name} (their hub)</option>
            ))}
          </select>
          <div className="text-[11px] text-muted mt-1">
            Pick a client to send this straight into their hub. Default keeps it in your AV pipeline.
          </div>
        </div>
        <div>
          <label className="block text-xs uppercase tracking-wider text-muted mb-1">Website URL</label>
          <input
            type="text"
            value={websiteUrl}
            onChange={(e) => setWebsiteUrl(e.target.value)}
            placeholder="https://thebuccaneer.com"
            className="w-full px-3 py-2 rounded-md border border-border focus:border-brand focus:outline-none font-mono"
            style={inputStyle}
            required
          />
        </div>
        <div className="flex flex-wrap gap-3">
          <div className="flex-1 min-w-[180px]">
            <label className="block text-xs uppercase tracking-wider text-muted mb-1">Industry (optional)</label>
            <input
              type="text"
              value={industry}
              onChange={(e) => setIndustry(e.target.value)}
              placeholder="e.g. restaurant, hotel, agency"
              className="w-full px-3 py-2 rounded-md border border-border focus:border-brand focus:outline-none"
              style={inputStyle}
            />
          </div>
          <div>
            <label className="block text-xs uppercase tracking-wider text-muted mb-1">Pipeline</label>
            <select
              value={targetBusiness}
              onChange={(e) => setTargetBusiness(e.target.value)}
              className="px-3 py-2 rounded-md border border-border focus:border-brand focus:outline-none"
              style={inputStyle}
            >
              {TARGET_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <button
          type="submit"
          disabled={loading}
          className="px-4 py-2 rounded-md bg-brand text-white font-medium hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? 'Scraping…' : 'Scrape & insert'}
        </button>
      </form>

      {error && (
        <div className="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200">
          {error}
        </div>
      )}

      {result && <ScrapeResultPanel result={result} />}
    </div>
  );
}

function ScrapeResultPanel({ result }: { result: ScrapeResponse }) {
  return (
    <div className="rounded-md border border-border p-4" style={{ backgroundColor: '#0e1420' }}>
      <div className="mb-3">
        {result.inserted ? (
          <div className="text-green-300 text-sm font-medium">
            ✓ Inserted lead {result.company ? <span className="text-ink">— {result.company}</span> : null}
          </div>
        ) : result.duplicate ? (
          <div className="text-amber-300 text-sm font-medium">
            ⚠ Duplicate — matched existing lead #{result.leadId}
            {result.mergedTarget && (
              <span className="text-purple-300 ml-2">(target merged to {result.mergedTarget})</span>
            )}
          </div>
        ) : (
          <div className="text-slate-300 text-sm">
            Nothing useful to add. Reason:{' '}
            <span className="text-muted">{result.reason || 'no-email-or-phone-found'}</span>
          </div>
        )}
      </div>

      {result.scraped && (
        <div className="space-y-2 text-xs">
          <Field label="Email" value={result.scraped.email} />
          <Field label="Phone" value={result.scraped.phone} />
          <Field label="Company title" value={result.scraped.companyTitle} />
          {Object.keys(result.scraped.socials).length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted mb-0.5">Socials</div>
              <div className="flex flex-wrap gap-2">
                {Object.entries(result.scraped.socials).map(([k, v]) => (
                  <a
                    key={k}
                    href={v}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-brand hover:underline"
                  >
                    {k}
                  </a>
                ))}
              </div>
            </div>
          )}
          <Field
            label={`Pages fetched (${result.scraped.pagesFetched.length})`}
            value={result.scraped.pagesFetched.join(' · ') || null}
          />
          {result.scraped.pagesFailed.length > 0 && (
            <Field
              label={`Pages failed (${result.scraped.pagesFailed.length})`}
              value={result.scraped.pagesFailed.join(' · ')}
            />
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'green' | 'amber' }) {
  const color = tone === 'green' ? 'text-green-400' : tone === 'amber' ? 'text-amber-400' : 'text-ink';
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted">{label}</div>
      <div className={`text-lg font-semibold ${color}`}>{value}</div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted">{label}</div>
      <div className="text-ink font-mono break-all">{value || <span className="text-muted">—</span>}</div>
    </div>
  );
}
