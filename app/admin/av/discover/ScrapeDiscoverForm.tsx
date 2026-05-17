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

export function ScrapeDiscoverForm() {
  const router = useRouter();
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [industry, setIndustry] = useState('');
  const [targetBusiness, setTargetBusiness] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ScrapeResponse | null>(null);

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
          targetBusiness: targetBusiness || undefined
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
    <div className="space-y-5">
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

      <form onSubmit={handleSubmit} className="space-y-4">
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

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted">{label}</div>
      <div className="text-ink font-mono break-all">{value || <span className="text-muted">—</span>}</div>
    </div>
  );
}
