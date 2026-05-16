'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface DiscoverResult {
  apolloPersonId: string;
  outcome: 'inserted' | 'duplicate' | 'insert_failed';
  leadId?: number;
  details?: { name?: string; title?: string; company?: string; domain?: string; error?: string };
}

interface DiscoverBatchSummary {
  attempted: number;
  inserted: number;
  duplicates: number;
  insertFailed: number;
  apolloResultsReturned: number;
  apolloTotalEntries: number;
  apolloPage: number;
  apolloPerPage: number;
  searchesUsedThisRun: number;
  searchesUsedThisMonth: number;
  searchesRemainingThisMonth: number;
  monthlyCeiling: number;
  results: DiscoverResult[];
  stoppedEarlyReason: string | null;
}

const EMPLOYEE_RANGES = [
  { label: '1–10', value: '1,10' },
  { label: '11–50', value: '11,50' },
  { label: '51–200', value: '51,200' },
  { label: '201–500', value: '201,500' },
  { label: '501–1,000', value: '501,1000' },
  { label: '1,001–5,000', value: '1001,5000' },
  { label: '5,001+', value: '5001,1000000' }
];

const SENIORITIES = [
  { label: 'Owner', value: 'owner' },
  { label: 'Founder', value: 'founder' },
  { label: 'C-suite', value: 'c_suite' },
  { label: 'Partner', value: 'partner' },
  { label: 'VP', value: 'vp' },
  { label: 'Head', value: 'head' },
  { label: 'Director', value: 'director' },
  { label: 'Manager', value: 'manager' },
  { label: 'Senior', value: 'senior' }
];

interface IcpPreset {
  label: string;
  filters: {
    personTitles?: string[];
    personSeniorities?: string[];
    personLocations?: string[];
    organizationLocations?: string[];
    qOrganizationDomainsList?: string[];
    organizationIndustries?: string[];
    organizationNumEmployeesRanges?: string[];
    qKeywords?: string;
  };
}

const ICP_PRESETS: IcpPreset[] = [
  {
    label: 'St. Croix hospitality (your EBW prospects)',
    filters: {
      personTitles: ['owner', 'general manager', 'events manager', 'catering manager'],
      personSeniorities: ['owner', 'founder', 'c_suite', 'director', 'manager'],
      organizationLocations: ['Saint Croix, United States Virgin Islands', 'US Virgin Islands'],
      organizationIndustries: ['hospitality', 'restaurants', 'food & beverages', 'events services'],
      organizationNumEmployeesRanges: ['1,10', '11,50'],
      qKeywords: 'restaurant boardwalk bar catering'
    }
  },
  {
    label: 'USVI wedding + event planners',
    filters: {
      personTitles: ['wedding planner', 'event planner', 'event coordinator', 'wedding coordinator'],
      personSeniorities: ['owner', 'founder', 'director', 'manager'],
      organizationLocations: ['US Virgin Islands', 'Saint Croix', 'Saint Thomas', 'Saint John'],
      organizationIndustries: ['events services', 'hospitality'],
      organizationNumEmployeesRanges: ['1,10', '11,50']
    }
  },
  {
    label: 'Caribbean charter / yacht operators',
    filters: {
      personTitles: ['captain', 'charter manager', 'fleet manager', 'operations manager'],
      personSeniorities: ['owner', 'founder', 'director', 'manager'],
      organizationLocations: ['US Virgin Islands', 'British Virgin Islands', 'Puerto Rico'],
      organizationIndustries: ['recreational facilities and services', 'maritime', 'leisure travel & tourism'],
      organizationNumEmployeesRanges: ['1,10', '11,50']
    }
  },
  {
    label: 'Hotels + corporate retreat venues (St. Croix focus)',
    filters: {
      personTitles: ['group sales', 'events coordinator', 'sales manager', 'general manager'],
      personSeniorities: ['director', 'manager', 'head'],
      organizationLocations: ['Saint Croix, United States Virgin Islands', 'US Virgin Islands'],
      organizationIndustries: ['hospitality', 'hotels & motels', 'travel & tourism'],
      organizationNumEmployeesRanges: ['11,50', '51,200', '201,500']
    }
  },
  {
    label: 'Marketing decision-makers at small SaaS (AV client ICP)',
    filters: {
      personTitles: ['marketing director', 'head of marketing', 'vp marketing', 'cmo', 'demand generation'],
      personSeniorities: ['c_suite', 'vp', 'head', 'director'],
      organizationLocations: ['United States'],
      organizationIndustries: ['computer software', 'information technology and services', 'internet'],
      organizationNumEmployeesRanges: ['11,50', '51,200', '201,500']
    }
  }
];

export function DiscoverForm() {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<DiscoverBatchSummary | null>(null);
  const [showResult, setShowResult] = useState(false);

  // Form fields stored as comma-separated strings; parsed before POST
  const [personTitles, setPersonTitles] = useState('');
  const [personLocations, setPersonLocations] = useState('');
  const [organizationLocations, setOrganizationLocations] = useState('');
  const [qOrganizationDomainsList, setQOrganizationDomainsList] = useState('');
  const [organizationIndustries, setOrganizationIndustries] = useState('');
  const [selectedRanges, setSelectedRanges] = useState<string[]>([]);
  const [selectedSeniorities, setSelectedSeniorities] = useState<string[]>([]);
  const [qKeywords, setQKeywords] = useState('');
  const [perPage, setPerPage] = useState(25);

  function applyPreset(preset: IcpPreset) {
    setPersonTitles((preset.filters.personTitles || []).join(', '));
    setPersonLocations((preset.filters.personLocations || []).join(', '));
    setOrganizationLocations((preset.filters.organizationLocations || []).join(', '));
    setQOrganizationDomainsList((preset.filters.qOrganizationDomainsList || []).join(', '));
    setOrganizationIndustries((preset.filters.organizationIndustries || []).join(', '));
    setSelectedRanges(preset.filters.organizationNumEmployeesRanges || []);
    setSelectedSeniorities(preset.filters.personSeniorities || []);
    setQKeywords(preset.filters.qKeywords || '');
  }

  function csvToArray(s: string): string[] {
    return s.split(',').map((x) => x.trim()).filter(Boolean);
  }

  function toggleRange(v: string) {
    setSelectedRanges((prev) => (prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]));
  }

  function toggleSeniority(v: string) {
    setSelectedSeniorities((prev) => (prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]));
  }

  async function runSearch(e: React.FormEvent) {
    e.preventDefault();
    setRunning(true);
    setError(null);
    setSummary(null);
    try {
      const body = {
        personTitles: csvToArray(personTitles),
        personSeniorities: selectedSeniorities,
        personLocations: csvToArray(personLocations),
        organizationLocations: csvToArray(organizationLocations),
        qOrganizationDomainsList: csvToArray(qOrganizationDomainsList),
        organizationIndustries: csvToArray(organizationIndustries),
        organizationNumEmployeesRanges: selectedRanges,
        qKeywords: qKeywords.trim() || undefined,
        page: 1,
        perPage
      };
      const res = await fetch('/api/admin/av/discover', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.message || j.error || `HTTP ${res.status}`);
      }
      const data: DiscoverBatchSummary = await res.json();
      setSummary(data);
      setShowResult(true);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  }

  return (
    <>
      <div className="bg-surface border border-border rounded-lg p-5 mb-6">
        <div className="text-xs uppercase tracking-wider text-muted mb-2">ICP presets — click to fill the form</div>
        <div className="flex flex-wrap gap-2">
          {ICP_PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              onClick={() => applyPreset(preset)}
              className="text-xs px-3 py-1.5 bg-bg border border-border rounded-md hover:border-brand text-ink"
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      <form onSubmit={runSearch} className="bg-surface border border-border rounded-lg p-5 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <div className="text-xs uppercase tracking-wider text-muted mb-1">Person titles (comma-separated)</div>
            <input
              type="text"
              value={personTitles}
              onChange={(e) => setPersonTitles(e.target.value)}
              placeholder="owner, general manager, wedding planner"
              className="w-full border border-border rounded-md px-3 py-2 text-sm placeholder:text-slate-500"
              style={{ backgroundColor: '#1a1f2e', color: '#f1f5f9' }}
            />
          </div>
          <div>
            <div className="text-xs uppercase tracking-wider text-muted mb-1">Keywords (free text)</div>
            <input
              type="text"
              value={qKeywords}
              onChange={(e) => setQKeywords(e.target.value)}
              placeholder="boardwalk, catering, beach venue"
              className="w-full border border-border rounded-md px-3 py-2 text-sm placeholder:text-slate-500"
              style={{ backgroundColor: '#1a1f2e', color: '#f1f5f9' }}
            />
          </div>
          <div>
            <div className="text-xs uppercase tracking-wider text-muted mb-1">Person locations</div>
            <input
              type="text"
              value={personLocations}
              onChange={(e) => setPersonLocations(e.target.value)}
              placeholder="Saint Croix, US Virgin Islands"
              className="w-full border border-border rounded-md px-3 py-2 text-sm placeholder:text-slate-500"
              style={{ backgroundColor: '#1a1f2e', color: '#f1f5f9' }}
            />
          </div>
          <div>
            <div className="text-xs uppercase tracking-wider text-muted mb-1">Organization locations</div>
            <input
              type="text"
              value={organizationLocations}
              onChange={(e) => setOrganizationLocations(e.target.value)}
              placeholder="US Virgin Islands"
              className="w-full border border-border rounded-md px-3 py-2 text-sm placeholder:text-slate-500"
              style={{ backgroundColor: '#1a1f2e', color: '#f1f5f9' }}
            />
          </div>
          <div className="md:col-span-2">
            <div className="text-xs uppercase tracking-wider text-muted mb-1">Organization industries</div>
            <input
              type="text"
              value={organizationIndustries}
              onChange={(e) => setOrganizationIndustries(e.target.value)}
              placeholder="hospitality, restaurants, event services"
              className="w-full border border-border rounded-md px-3 py-2 text-sm placeholder:text-slate-500"
              style={{ backgroundColor: '#1a1f2e', color: '#f1f5f9' }}
            />
          </div>
          <div className="md:col-span-2">
            <div className="text-xs uppercase tracking-wider text-muted mb-1">Specific company domains (comma-separated)</div>
            <input
              type="text"
              value={qOrganizationDomainsList}
              onChange={(e) => setQOrganizationDomainsList(e.target.value)}
              placeholder="brewstx.com, esterastcroix.com"
              className="w-full border border-border rounded-md px-3 py-2 text-sm placeholder:text-slate-500"
              style={{ backgroundColor: '#1a1f2e', color: '#f1f5f9' }}
            />
            <div className="text-xs text-muted mt-1">Optional: limit search to specific company domains. Up to 1,000.</div>
          </div>
          <div className="md:col-span-2">
            <div className="text-xs uppercase tracking-wider text-muted mb-2">Seniority levels</div>
            <div className="flex flex-wrap gap-2">
              {SENIORITIES.map((s) => (
                <button
                  key={s.value}
                  type="button"
                  onClick={() => toggleSeniority(s.value)}
                  className={[
                    'text-xs px-3 py-1.5 border rounded-md',
                    selectedSeniorities.includes(s.value)
                      ? 'bg-brand text-white border-brand'
                      : 'border-border text-ink hover:border-brand'
                  ].join(' ')}
                  style={selectedSeniorities.includes(s.value) ? undefined : { backgroundColor: '#1a1f2e' }}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
          <div className="md:col-span-2">
            <div className="text-xs uppercase tracking-wider text-muted mb-2">Organization size (employees)</div>
            <div className="flex flex-wrap gap-2">
              {EMPLOYEE_RANGES.map((r) => (
                <button
                  key={r.value}
                  type="button"
                  onClick={() => toggleRange(r.value)}
                  className={[
                    'text-xs px-3 py-1.5 border rounded-md',
                    selectedRanges.includes(r.value)
                      ? 'bg-brand text-white border-brand'
                      : 'bg-bg border-border text-ink hover:border-brand'
                  ].join(' ')}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wider text-muted mb-1">Results per call (max 100)</div>
            <input
              type="number"
              min={1}
              max={100}
              value={perPage}
              onChange={(e) => setPerPage(Math.max(1, Math.min(100, Number(e.target.value) || 25)))}
              className="w-full border border-border rounded-md px-3 py-2 text-sm placeholder:text-slate-500"
              style={{ backgroundColor: '#1a1f2e', color: '#f1f5f9' }}
            />
            <div className="text-xs text-muted mt-1">Each call counts as 1 Apollo search credit.</div>
          </div>
        </div>

        <div className="flex items-center gap-3 pt-2 border-t border-border">
          <button
            type="submit"
            disabled={running}
            className="px-4 py-2 bg-brand text-white text-sm font-medium rounded-md hover:opacity-90 disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            {running ? (
              <>
                <span className="inline-block w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Searching Apollo…
              </>
            ) : (
              <>🔭 Run Apollo search</>
            )}
          </button>
          {error && <span className="text-xs text-red-400">Error: {error}</span>}
        </div>
      </form>

      {showResult && summary && <DiscoverResultModal summary={summary} onClose={() => setShowResult(false)} />}
    </>
  );
}

function DiscoverResultModal({
  summary,
  onClose
}: {
  summary: DiscoverBatchSummary;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 bg-black/85 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="border border-border rounded-xl max-w-2xl w-full p-6 shadow-2xl max-h-[85vh] overflow-y-auto"
        style={{ backgroundColor: '#0e1420' }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold mb-1">Apollo search complete 🔭</h2>
        <p className="text-sm text-muted mb-4">
          {summary.stoppedEarlyReason
            ? summary.stoppedEarlyReason
            : `Apollo returned ${summary.apolloResultsReturned} of ${summary.apolloTotalEntries.toLocaleString()} total matches`}
        </p>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm mb-4">
          <Stat label="Inserted" value={summary.inserted} tone="success" />
          <Stat label="Duplicates" value={summary.duplicates} />
          <Stat label="Insert failed" value={summary.insertFailed} />
          <Stat label="Total returned" value={summary.apolloResultsReturned} />
        </div>

        {summary.results.filter((r) => r.outcome === 'inserted').length > 0 && (
          <div className="mb-4">
            <div className="text-xs uppercase tracking-wider text-muted mb-2">Newly inserted ({summary.inserted})</div>
            <ul className="space-y-1.5 max-h-72 overflow-y-auto">
              {summary.results
                .filter((r) => r.outcome === 'inserted')
                .map((r) => (
                  <li key={r.apolloPersonId} className="text-xs bg-bg border border-border rounded-md px-3 py-2">
                    <div className="font-medium text-ink">{r.details?.company}</div>
                    <div className="text-muted">
                      {r.details?.name}
                      {r.details?.title && <span> · {r.details.title}</span>}
                      {r.details?.domain && <span> · {r.details.domain}</span>}
                    </div>
                  </li>
                ))}
            </ul>
          </div>
        )}

        {summary.duplicates > 0 && (
          <div className="bg-surface border border-border rounded-md px-3 py-2 mb-4 text-xs text-muted">
            {summary.duplicates} {summary.duplicates === 1 ? 'result was' : 'results were'} already in your DB
            (deduped on apollo_person_id).
          </div>
        )}

        <div className="bg-bg border border-border rounded-md px-3 py-2 mb-4 text-xs">
          <div className="text-muted">
            Apollo searches this month:{' '}
            <span className="text-ink font-medium">
              {summary.searchesUsedThisMonth} / {summary.monthlyCeiling}
            </span>{' '}
            ({summary.searchesRemainingThisMonth} remaining)
          </div>
        </div>

        {summary.inserted > 0 && (
          <div
            className="border rounded-md px-3 py-3 mb-4 text-xs"
            style={{ backgroundColor: '#1a1f2e', borderColor: '#2a3245' }}
          >
            <div className="font-medium mb-1 text-ink">⏭ What happens next, automatically</div>
            <ul className="text-muted space-y-1 list-disc ml-4">
              <li>Hunter cron (daily 6 AM UTC) will pick these up and fill in real emails</li>
              <li>AI scoring will run on each new lead (coming in the next build)</li>
              <li>You can find them in <code className="bg-bg px-1 rounded">/admin/av</code> filtered by source = api</li>
            </ul>
          </div>
        )}

        <div className="flex justify-end">
          <button
            onClick={onClose}
            className="text-sm px-4 py-2 bg-surface border border-border rounded-md hover:border-ink"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'success' }) {
  const color = tone === 'success' && value > 0 ? 'text-green-500' : 'text-ink';
  return (
    <div className="bg-bg border border-border rounded-md px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-muted">{label}</div>
      <div className={`text-xl font-semibold ${color}`}>{value}</div>
    </div>
  );
}
