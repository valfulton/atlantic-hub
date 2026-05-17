'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface DiscoverResult {
  apolloOrganizationId: string;
  apolloPersonId?: string;
  outcome: 'inserted_person' | 'inserted_company_shell' | 'duplicate' | 'insert_failed';
  leadId?: number;
  details?: {
    company?: string;
    contactName?: string;
    contactTitle?: string;
    linkedinUrl?: string | null;
    domain?: string;
    industry?: string;
    employeeEstimate?: number | null;
    error?: string;
  };
}

interface DiscoverBatchSummary {
  attempted: number;
  inserted: number;
  insertedPeople: number;
  insertedCompanyShells: number;
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

interface IcpPreset {
  label: string;
  filters: {
    qOrganizationName?: string;
    organizationLocations?: string[];
    organizationNotLocations?: string[];
    qOrganizationDomainsList?: string[];
    qOrganizationKeywordTags?: string[];
    organizationNumEmployeesRanges?: string[];
  };
}

const ICP_PRESETS: IcpPreset[] = [
  {
    label: 'St. Croix hospitality (your EBW prospects)',
    filters: {
      organizationLocations: ['Saint Croix, United States Virgin Islands', 'US Virgin Islands'],
      qOrganizationKeywordTags: ['hospitality', 'restaurants', 'bars', 'catering', 'events'],
      organizationNumEmployeesRanges: ['1,10', '11,50']
    }
  },
  {
    label: 'USVI wedding + event planners',
    filters: {
      organizationLocations: ['US Virgin Islands', 'Saint Croix', 'Saint Thomas', 'Saint John'],
      qOrganizationKeywordTags: ['wedding planning', 'event planning', 'destination weddings'],
      organizationNumEmployeesRanges: ['1,10', '11,50']
    }
  },
  {
    label: 'Caribbean charter / yacht operators',
    filters: {
      organizationLocations: ['US Virgin Islands', 'British Virgin Islands', 'Puerto Rico'],
      qOrganizationKeywordTags: ['yacht charter', 'boat charter', 'marine', 'sailing'],
      organizationNumEmployeesRanges: ['1,10', '11,50']
    }
  },
  {
    label: 'Hotels + corporate retreat venues (St. Croix focus)',
    filters: {
      organizationLocations: ['Saint Croix, United States Virgin Islands', 'US Virgin Islands'],
      qOrganizationKeywordTags: ['hotels', 'resorts', 'corporate retreats', 'venues'],
      organizationNumEmployeesRanges: ['11,50', '51,200', '201,500']
    }
  },
  {
    label: 'Marketing agencies / SaaS (AV client ICP)',
    filters: {
      organizationLocations: ['United States'],
      qOrganizationKeywordTags: ['marketing agency', 'digital marketing', 'saas', 'software'],
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

  const [qOrganizationName, setQOrganizationName] = useState('');
  const [organizationLocations, setOrganizationLocations] = useState('');
  const [organizationNotLocations, setOrganizationNotLocations] = useState('');
  const [qOrganizationDomainsList, setQOrganizationDomainsList] = useState('');
  const [qOrganizationKeywordTags, setQOrganizationKeywordTags] = useState('');
  const [selectedRanges, setSelectedRanges] = useState<string[]>([]);
  const [perPage, setPerPage] = useState(25);

  function applyPreset(preset: IcpPreset) {
    setQOrganizationName(preset.filters.qOrganizationName || '');
    setOrganizationLocations((preset.filters.organizationLocations || []).join(', '));
    setOrganizationNotLocations((preset.filters.organizationNotLocations || []).join(', '));
    setQOrganizationDomainsList((preset.filters.qOrganizationDomainsList || []).join(', '));
    setQOrganizationKeywordTags((preset.filters.qOrganizationKeywordTags || []).join(', '));
    setSelectedRanges(preset.filters.organizationNumEmployeesRanges || []);
  }

  function csvToArray(s: string): string[] {
    return s.split(',').map((x) => x.trim()).filter(Boolean);
  }

  function toggleRange(v: string) {
    setSelectedRanges((prev) => (prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]));
  }

  async function runSearch(e: React.FormEvent) {
    e.preventDefault();
    setRunning(true);
    setError(null);
    setSummary(null);
    try {
      const body = {
        qOrganizationName: qOrganizationName.trim() || undefined,
        organizationLocations: csvToArray(organizationLocations),
        organizationNotLocations: csvToArray(organizationNotLocations),
        qOrganizationDomainsList: csvToArray(qOrganizationDomainsList),
        qOrganizationKeywordTags: csvToArray(qOrganizationKeywordTags),
        organizationNumEmployeesRanges: selectedRanges,
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

  const inputStyle = { backgroundColor: '#1a1f2e', color: '#f1f5f9' };

  return (
    <>
      <div className="bg-surface border border-border rounded-lg p-5 mb-6">
        <div className="text-xs uppercase tracking-wider text-muted mb-2">
          ICP presets — click to fill the form (company-level search)
        </div>
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
        <div className="text-xs text-muted mt-3 leading-relaxed">
          🔭 This is <strong>company</strong> discovery. Each match is inserted as a lead with company info
          only — the daily Hunter cron then enriches each with a real person + email at that company.
        </div>
      </div>

      <form onSubmit={runSearch} className="bg-surface border border-border rounded-lg p-5 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <div className="text-xs uppercase tracking-wider text-muted mb-1">Company name (partial match)</div>
            <input
              type="text"
              value={qOrganizationName}
              onChange={(e) => setQOrganizationName(e.target.value)}
              placeholder="e.g. STX Weddings"
              className="w-full border border-border rounded-md px-3 py-2 text-sm placeholder:text-slate-500"
              style={inputStyle}
            />
          </div>
          <div>
            <div className="text-xs uppercase tracking-wider text-muted mb-1">Keyword tags (industries / focus)</div>
            <input
              type="text"
              value={qOrganizationKeywordTags}
              onChange={(e) => setQOrganizationKeywordTags(e.target.value)}
              placeholder="hospitality, restaurants, wedding planning"
              className="w-full border border-border rounded-md px-3 py-2 text-sm placeholder:text-slate-500"
              style={inputStyle}
            />
          </div>
          <div>
            <div className="text-xs uppercase tracking-wider text-muted mb-1">Locations (company HQ)</div>
            <input
              type="text"
              value={organizationLocations}
              onChange={(e) => setOrganizationLocations(e.target.value)}
              placeholder="Saint Croix, US Virgin Islands"
              className="w-full border border-border rounded-md px-3 py-2 text-sm placeholder:text-slate-500"
              style={inputStyle}
            />
          </div>
          <div>
            <div className="text-xs uppercase tracking-wider text-muted mb-1">Exclude locations</div>
            <input
              type="text"
              value={organizationNotLocations}
              onChange={(e) => setOrganizationNotLocations(e.target.value)}
              placeholder="(optional) e.g. United Kingdom"
              className="w-full border border-border rounded-md px-3 py-2 text-sm placeholder:text-slate-500"
              style={inputStyle}
            />
          </div>
          <div className="md:col-span-2">
            <div className="text-xs uppercase tracking-wider text-muted mb-1">Specific company domains</div>
            <input
              type="text"
              value={qOrganizationDomainsList}
              onChange={(e) => setQOrganizationDomainsList(e.target.value)}
              placeholder="(optional) brewstx.com, esterastcroix.com"
              className="w-full border border-border rounded-md px-3 py-2 text-sm placeholder:text-slate-500"
              style={inputStyle}
            />
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
              style={inputStyle}
            />
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
              <>🔭 Find companies</>
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
        <h2 className="text-lg font-semibold mb-1">Apollo company search complete 🔭</h2>
        <p className="text-sm text-muted mb-4">
          {summary.stoppedEarlyReason
            ? summary.stoppedEarlyReason
            : `Apollo returned ${summary.apolloResultsReturned} of ${summary.apolloTotalEntries.toLocaleString()} total matches`}
        </p>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm mb-4">
          <Stat label="People inserted" value={summary.insertedPeople} tone="success" />
          <Stat label="Company shells" value={summary.insertedCompanyShells} />
          <Stat label="Duplicates" value={summary.duplicates} />
          <Stat label="Total returned" value={summary.apolloResultsReturned} />
        </div>

        {summary.results.filter((r) => r.outcome === 'inserted_person').length > 0 && (
          <div className="mb-4">
            <div className="text-xs uppercase tracking-wider text-muted mb-2">
              ✨ Decision-makers from Apollo ({summary.insertedPeople})
            </div>
            <ul className="space-y-1.5 max-h-60 overflow-y-auto">
              {summary.results
                .filter((r) => r.outcome === 'inserted_person')
                .map((r) => (
                  <li key={r.apolloPersonId} className="text-xs bg-bg border border-border rounded-md px-3 py-2">
                    <div className="font-medium text-ink">
                      {r.details?.contactName}
                      {r.details?.contactTitle && <span className="text-muted"> · {r.details.contactTitle}</span>}
                    </div>
                    <div className="text-muted">
                      <span>@ {r.details?.company}</span>
                      {r.details?.domain && <span> · {r.details.domain}</span>}
                      {r.details?.linkedinUrl && (
                        <span> · <a href={r.details.linkedinUrl} target="_blank" rel="noopener" className="text-blue-400 hover:underline">LinkedIn ↗</a></span>
                      )}
                    </div>
                  </li>
                ))}
            </ul>
          </div>
        )}

        {summary.results.filter((r) => r.outcome === 'inserted_company_shell').length > 0 && (
          <div className="mb-4">
            <div className="text-xs uppercase tracking-wider text-muted mb-2">
              🏢 Companies without Apollo contacts ({summary.insertedCompanyShells})
            </div>
            <div className="text-xs text-muted mb-2">
              Apollo found these companies but had no people on file. Hunter cron will try to find contacts at their domains tomorrow.
            </div>
            <ul className="space-y-1.5 max-h-40 overflow-y-auto">
              {summary.results
                .filter((r) => r.outcome === 'inserted_company_shell')
                .map((r) => (
                  <li key={r.apolloOrganizationId} className="text-xs bg-bg border border-border rounded-md px-3 py-2">
                    <div className="font-medium text-ink">{r.details?.company}</div>
                    <div className="text-muted">
                      {r.details?.domain && <span>{r.details.domain}</span>}
                      {r.details?.industry && <span> · {r.details.industry}</span>}
                      {typeof r.details?.employeeEstimate === 'number' && <span> · ~{r.details.employeeEstimate} emp</span>}
                    </div>
                  </li>
                ))}
            </ul>
          </div>
        )}

        {summary.duplicates > 0 && (
          <div className="bg-surface border border-border rounded-md px-3 py-2 mb-4 text-xs text-muted">
            {summary.duplicates} {summary.duplicates === 1 ? 'result was' : 'results were'} already in your DB
            (deduped on Apollo organization ID).
          </div>
        )}

        {summary.inserted > 0 && (
          <div
            className="border rounded-md px-3 py-3 mb-4 text-xs"
            style={{ backgroundColor: '#1a1f2e', borderColor: '#2a3245' }}
          >
            <div className="font-medium mb-1 text-ink">⏭ What happens next, automatically</div>
            <ul className="text-muted space-y-1 list-disc ml-4">
              {summary.insertedPeople > 0 && (
                <li>People-leads have real names + titles from Apollo; Hunter cron fills in their work email next</li>
              )}
              {summary.insertedCompanyShells > 0 && (
                <li>Company shells need Hunter to find a contact; if Hunter strikes out, do an Apollo top_people lookup manually</li>
              )}
              <li>Each enriched lead gets AI scored (coming in next build)</li>
              <li>Find them in <code className="bg-bg px-1 rounded">/admin/av</code> filtered by source = api</li>
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
