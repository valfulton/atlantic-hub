'use client';

/**
 * DiscoverPanel -- the client's "describe your ideal customer, find leads"
 * control. Reads/saves their ICP and runs scoped discovery via
 * /api/client/discover. On success it refreshes the server-rendered leads
 * list below it. Sourcing providers are never shown -- the client only
 * describes who they want and clicks Find leads.
 */
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

interface Usage {
  usedThisMonth: number;
  monthlyCap: number;
  perRun?: number;
}

function toCsv(arr: string[]): string {
  return arr.join(', ');
}
function fromCsv(s: string): string[] {
  return s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}

export default function DiscoverPanel() {
  const router = useRouter();
  const [loaded, setLoaded] = useState(false);
  const [industries, setIndustries] = useState('');
  const [geographies, setGeographies] = useState('');
  const [excludeGeographies, setExcludeGeographies] = useState('');
  const [sizeMin, setSizeMin] = useState('');
  const [sizeMax, setSizeMax] = useState('');
  const [description, setDescription] = useState('');
  const [usage, setUsage] = useState<Usage | null>(null);
  const [running, setRunning] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'err' | 'info'; text: string } | null>(null);

  useEffect(() => {
    fetch('/api/client/discover', { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => {
        if (j?.icp) {
          setIndustries(toCsv(j.icp.industries || []));
          setGeographies(toCsv(j.icp.geographies || []));
          setExcludeGeographies(toCsv(j.icp.excludeGeographies || []));
          setSizeMin(j.icp.companySizeMin ? String(j.icp.companySizeMin) : '');
          setSizeMax(j.icp.companySizeMax ? String(j.icp.companySizeMax) : '');
          setDescription(j.icp.description || '');
        }
        if (j?.usage) setUsage(j.usage);
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  const run = useCallback(async () => {
    if (running) return;
    setRunning(true);
    setMsg(null);
    const icp = {
      industries: fromCsv(industries),
      geographies: fromCsv(geographies),
      excludeGeographies: fromCsv(excludeGeographies),
      companySizeMin: sizeMin ? Number(sizeMin) : null,
      companySizeMax: sizeMax ? Number(sizeMax) : null,
      description
    };
    try {
      const res = await fetch('/api/client/discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ icp })
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg({ tone: 'err', text: j.message || j.error || 'Discovery failed. Please try again.' });
      } else {
        if (j.usage) setUsage(j.usage);
        const found = Number(j.inserted ?? 0);
        setMsg({
          tone: found > 0 ? 'ok' : 'info',
          text: j.message || (found > 0 ? `Found ${found} new leads. They're being scored.` : 'No new matches this run.')
        });
        if (found > 0) router.refresh();
      }
    } catch {
      setMsg({ tone: 'err', text: 'Something went wrong. Please try again.' });
    } finally {
      setRunning(false);
    }
  }, [running, industries, geographies, excludeGeographies, sizeMin, sizeMax, description, router]);

  const capLine =
    usage && usage.monthlyCap > 0
      ? `${usage.usedThisMonth} / ${usage.monthlyCap} discovered this month`
      : null;

  const inputCls =
    'w-full rounded-lg px-3 py-2 text-sm bg-white border border-[color:var(--line-strong)] text-ink placeholder:text-muted focus-visible:ring-2 focus-visible:ring-[color:var(--emerald)] outline-none';

  return (
    <section className="mb-8 rounded-2xl border border-border bg-[var(--paper)] p-5 sm:p-6">
      <div className="flex items-center justify-between gap-3 mb-1">
        <h2 className="text-lg font-semibold text-ink">Find new leads</h2>
        {capLine && <span className="text-xs text-muted">{capLine}</span>}
      </div>
      <p className="text-sm text-muted mb-4 leading-relaxed">
        Describe your ideal customer and we&apos;ll find matching companies and add them to your pipeline, scored and
        ready.
      </p>

      <div className="grid sm:grid-cols-2 gap-3">
        <label className="block">
          <span className="text-[11px] uppercase tracking-[0.12em] text-muted">Industries / keywords</span>
          <input
            className={`mt-1 ${inputCls}`}
            placeholder="real estate, property management"
            value={industries}
            onChange={(e) => setIndustries(e.target.value)}
            disabled={!loaded || running}
          />
        </label>
        <label className="block">
          <span className="text-[11px] uppercase tracking-[0.12em] text-muted">Locations</span>
          <input
            className={`mt-1 ${inputCls}`}
            placeholder="St. Croix, US Virgin Islands"
            value={geographies}
            onChange={(e) => setGeographies(e.target.value)}
            disabled={!loaded || running}
          />
        </label>
        <label className="block">
          <span className="text-[11px] uppercase tracking-[0.12em] text-muted">Exclude locations (optional)</span>
          <input
            className={`mt-1 ${inputCls}`}
            placeholder="e.g. United Kingdom"
            value={excludeGeographies}
            onChange={(e) => setExcludeGeographies(e.target.value)}
            disabled={!loaded || running}
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-[11px] uppercase tracking-[0.12em] text-muted">Min employees</span>
            <input
              type="number"
              min={1}
              className={`mt-1 ${inputCls}`}
              placeholder="1"
              value={sizeMin}
              onChange={(e) => setSizeMin(e.target.value)}
              disabled={!loaded || running}
            />
          </label>
          <label className="block">
            <span className="text-[11px] uppercase tracking-[0.12em] text-muted">Max employees</span>
            <input
              type="number"
              min={1}
              className={`mt-1 ${inputCls}`}
              placeholder="200"
              value={sizeMax}
              onChange={(e) => setSizeMax(e.target.value)}
              disabled={!loaded || running}
            />
          </label>
        </div>
      </div>

      <label className="block mt-3">
        <span className="text-[11px] uppercase tracking-[0.12em] text-muted">Notes (who is your ideal client?)</span>
        <textarea
          className={`mt-1 ${inputCls} min-h-[64px] resize-y`}
          placeholder="Boutique hotels and vacation-rental managers expanding into new island markets…"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          disabled={!loaded || running}
        />
      </label>

      <div className="mt-4 flex items-center gap-3 flex-wrap">
        <button
          type="button"
          onClick={() => void run()}
          disabled={!loaded || running}
          className="inline-flex items-center justify-center px-4 py-2 rounded-md bg-brand text-brand-fg text-sm font-medium hover:opacity-90 disabled:opacity-60"
        >
          {running ? 'Finding leads…' : 'Find leads'}
        </button>
        {msg && (
          <span
            className="text-sm"
            style={{ color: msg.tone === 'ok' ? 'var(--emerald-deep)' : msg.tone === 'err' ? 'var(--danger)' : 'var(--muted)' }}
          >
            {msg.text}
          </span>
        )}
      </div>
    </section>
  );
}
