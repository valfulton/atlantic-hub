'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { DestinationSelect, parseDestination, type ClientOption, type EmployeeOption } from './DestinationSelect';

/**
 * Apify Instagram Profile Scraper → leads. Paste IG handles (any common format)
 * and the actor returns profile data — bio, business email/phone if public,
 * link in bio, follower count, business category. Each profile becomes a
 * lead row with cross-source dedup against existing Apollo / Places leads.
 */

interface Result {
  username: string;
  outcome: string;
  leadId?: number;
  details: {
    company: string;
    email?: string | null;
    phone?: string | null;
    website?: string | null;
    industry?: string | null;
    isBusinessAccount?: boolean;
    followersCount?: number | null;
    error?: string;
  };
}

interface BatchResponse {
  source: string;
  inputCount: number;
  resolvedCount: number;
  insertedCount: number;
  duplicateCount: number;
  results: Result[];
  error?: string;
  detail?: string;
}

export function InstagramDiscoverForm({
  clients = [],
  employees = []
}: {
  clients?: ClientOption[];
  employees?: EmployeeOption[];
}) {
  const router = useRouter();
  const [raw, setRaw] = useState('');
  const [dest, setDest] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BatchResponse | null>(null);

  function parseUsernames(input: string): string[] {
    return input
      .split(/[\s,\n]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    const usernames = parseUsernames(raw);
    if (usernames.length === 0) {
      setError('Paste at least one Instagram handle.');
      return;
    }
    if (usernames.length > 25) {
      setError(`Max 25 handles per batch (you have ${usernames.length}). Split into multiple runs.`);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/admin/av/discover/instagram', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usernames, ...parseDestination(dest) })
      });
      const json: BatchResponse = await res.json();
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
  const parsed = parseUsernames(raw);

  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm text-muted mb-3">
          Apify Instagram Profile Scraper. Pulls each handle&apos;s profile, parses bio for
          email/phone/links, inserts a lead. Best for boutique businesses (charter captains,
          beach bars, photographers) that live on IG, not the open web.
        </p>
        <p className="text-xs text-muted">
          Free tier: ~1000 profiles/month on Apify&apos;s $5/mo credit. Paste handles separated
          by spaces, commas, or new lines. Any format works: <code>@foo</code>, <code>foo</code>,{' '}
          <code>https://instagram.com/foo</code>.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <DestinationSelect value={dest} onChange={setDest} clients={clients} employees={employees} />
        <div>
          <label className="block text-xs uppercase tracking-wider text-muted mb-1">
            Instagram handles{' '}
            {parsed.length > 0 && <span className="text-muted/70 normal-case">({parsed.length} parsed)</span>}
          </label>
          <textarea
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            placeholder="@stcroix_dive,&#10;the.beach.bar,&#10;https://instagram.com/sunsetcharters"
            rows={5}
            className="w-full px-3 py-2 rounded-md border border-border focus:border-brand focus:outline-none font-mono text-sm"
            style={inputStyle}
            required
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          className="px-4 py-2 rounded-md bg-brand text-black font-medium hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? 'Scraping IG profiles…' : `Scrape ${parsed.length || 0} profile${parsed.length === 1 ? '' : 's'}`}
        </button>
      </form>

      {error && (
        <div className="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200">
          {error}
        </div>
      )}

      {result && <InstagramResultPanel result={result} />}
    </div>
  );
}

function InstagramResultPanel({ result }: { result: BatchResponse }) {
  return (
    <div className="rounded-md border border-border p-4" style={{ backgroundColor: '#0e1420' }}>
      <div className="flex flex-wrap gap-4 text-sm mb-3">
        <Stat label="Input" value={result.inputCount} />
        <Stat label="Resolved" value={result.resolvedCount} />
        <Stat label="Inserted" value={result.insertedCount} tone="green" />
        <Stat label="Duplicates" value={result.duplicateCount} tone="amber" />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-muted border-b border-border">
            <tr>
              <th className="text-left py-1 pr-3">Outcome</th>
              <th className="text-left py-1 pr-3">Handle</th>
              <th className="text-left py-1 pr-3">Business</th>
              <th className="text-left py-1 pr-3">Email</th>
              <th className="text-left py-1 pr-3">Phone</th>
              <th className="text-left py-1 pr-3">Followers</th>
            </tr>
          </thead>
          <tbody>
            {result.results.map((r, i) => (
              <tr key={`${r.username}-${i}`} className="border-b border-border/40">
                <td className="py-1 pr-3"><OutcomePill outcome={r.outcome} /></td>
                <td className="py-1 pr-3 font-mono">@{r.username}</td>
                <td className="py-1 pr-3">{r.details.company}</td>
                <td className="py-1 pr-3 text-muted">{r.details.email || '—'}</td>
                <td className="py-1 pr-3 text-muted">{r.details.phone || '—'}</td>
                <td className="py-1 pr-3 text-muted">{r.details.followersCount?.toLocaleString() ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'green' | 'amber' }) {
  const color = tone === 'green' ? 'text-green-400' : tone === 'amber' ? 'text-[#EBCB6B]' : 'text-ink';
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted">{label}</div>
      <div className={`text-lg font-semibold ${color}`}>{value}</div>
    </div>
  );
}

function OutcomePill({ outcome }: { outcome: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    inserted: { label: 'INSERTED', cls: 'bg-green-500/15 text-green-300 border-green-500/30' },
    duplicate_existing: { label: 'DUPLICATE', cls: 'bg-[#EBCB6B]/12 text-[#EBCB6B] border-[#EBCB6B]/30' },
    duplicate_target_upgraded: { label: 'DUP → AV+EBW', cls: 'bg-purple-500/15 text-purple-300 border-purple-500/30' },
    profile_not_found: { label: 'NOT FOUND', cls: 'bg-slate-500/15 text-slate-300 border-slate-500/30' },
    insufficient_contact: { label: 'NO CONTACT', cls: 'bg-slate-500/15 text-slate-300 border-slate-500/30' },
    insert_failed: { label: 'FAILED', cls: 'bg-red-500/15 text-red-300 border-red-500/30' }
  };
  const m = map[outcome] || { label: outcome.toUpperCase(), cls: 'bg-slate-500/15 text-slate-300 border-slate-500/30' };
  return <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border ${m.cls}`}>{m.label}</span>;
}
