'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { DestinationSelect, parseDestination, type ClientOption, type EmployeeOption } from './DestinationSelect';

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

export function DiscoverForm({
  clients = [],
  employees = []
}: {
  clients?: ClientOption[];
  employees?: EmployeeOption[];
}) {
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
  // (#307) Exclude industries — was silently dropped from the ICP auto-fill.
  // Loaded from the client's stored excludedIndustries, editable per-run, and
  // passed back to discover so the post-filter respects this run's edits.
  const [qOrganizationNotKeywordTags, setQOrganizationNotKeywordTags] = useState('');
  const [selectedRanges, setSelectedRanges] = useState<string[]>([]);
  const [perPage, setPerPage] = useState(25);
  const [dest, setDest] = useState('');
  // (#238) When val picks a client from the destination dropdown, auto-fill
  // the search criteria from THAT client's stored ICP. State below tracks the
  // last applied client so we don't clobber edits she made AFTER the auto-fill
  // and gives her a one-click "undo" if the saved ICP isn't what she wants.
  // (#95 followup) Also tracks SOURCE ('icp' / 'brief_fallback' / 'mixed' /
  // 'none') so the banner is honest about whether the client has a real saved
  // ICP or we just inferred from the brief.
  const [autoFilledFromClient, setAutoFilledFromClient] = useState<{
    clientId: number;
    name: string;
    source: 'icp' | 'brief_fallback' | 'mixed' | 'none';
    appliedCount: number;
    hint: string | null;
  } | null>(null);
  const [autoFillBusy, setAutoFillBusy] = useState(false);

  useEffect(() => {
    const parsed = parseDestination(dest);
    if (!parsed.clientId) {
      // Switched away from a client destination — leave any typed values alone.
      // Just clear the "auto-filled from X" badge so the UI is honest.
      setAutoFilledFromClient(null);
      return;
    }
    const clientId = parsed.clientId;
    const clientName = clients.find((c) => c.clientId === clientId)?.name || `client #${clientId}`;
    let cancelled = false;
    setAutoFillBusy(true);
    fetch(`/api/admin/av/clients/${clientId}/icp-for-discovery`, { cache: 'no-store' })
      .then(async (res) => {
        const raw = await res.text();
        let data: {
          industries?: string[];
          geographies?: string[];
          excludedIndustries?: string[];
          // (#307) Now also returned by the endpoint.
          excludeGeographies?: string[];
          employeeRanges?: string[];
          source?: 'icp' | 'brief_fallback' | 'mixed' | 'none';
          hint?: string | null;
        } = {};
        try { data = JSON.parse(raw); } catch { throw new Error(`HTTP ${res.status} (non-JSON)`); }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        if (cancelled) return;
        // Apply each field only when the client has saved values for it, so a
        // partially-filled ICP doesn't wipe out val's typed criteria.
        let applied = 0;
        if (Array.isArray(data.geographies) && data.geographies.length > 0) {
          setOrganizationLocations(data.geographies.join(', '));
          applied += 1;
        }
        if (Array.isArray(data.industries) && data.industries.length > 0) {
          setQOrganizationKeywordTags(data.industries.join(', '));
          applied += 1;
        }
        if (Array.isArray(data.employeeRanges) && data.employeeRanges.length > 0) {
          setSelectedRanges(data.employeeRanges);
          applied += 1;
        }
        // (#307) Was silently dropped before — now visible + editable.
        if (Array.isArray(data.excludedIndustries) && data.excludedIndustries.length > 0) {
          setQOrganizationNotKeywordTags(data.excludedIndustries.join(', '));
          applied += 1;
        }
        if (Array.isArray(data.excludeGeographies) && data.excludeGeographies.length > 0) {
          setOrganizationNotLocations(data.excludeGeographies.join(', '));
          applied += 1;
        }
        setAutoFilledFromClient({
          clientId,
          name: clientName,
          source: data.source ?? 'none',
          appliedCount: applied,
          hint: data.hint ?? null
        });
      })
      .catch(() => {
        // Non-fatal: if the ICP fetch fails the form stays as-is and val types
        // criteria like before. No banner needed.
        if (!cancelled) setAutoFilledFromClient(null);
      })
      .finally(() => {
        if (!cancelled) setAutoFillBusy(false);
      });
    return () => { cancelled = true; };
  }, [dest, clients]);

  function applyPreset(preset: IcpPreset) {
    setQOrganizationName(preset.filters.qOrganizationName || '');
    setOrganizationLocations((preset.filters.organizationLocations || []).join(', '));
    setOrganizationNotLocations((preset.filters.organizationNotLocations || []).join(', '));
    setQOrganizationDomainsList((preset.filters.qOrganizationDomainsList || []).join(', '));
    setQOrganizationKeywordTags((preset.filters.qOrganizationKeywordTags || []).join(', '));
    // (#307) Reset exclude-industries when a preset is applied — presets don't
    // carry their own excludes today, so clear whatever was auto-loaded.
    setQOrganizationNotKeywordTags('');
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
        // (#307) Pass excluded-industries through so the server-side
        // post-filter uses THIS run's edits (operator override) instead of
        // only the saved ICP. Empty array = same as before.
        qOrganizationNotKeywordTags: csvToArray(qOrganizationNotKeywordTags),
        organizationNumEmployeesRanges: selectedRanges,
        page: 1,
        perPage,
        ...parseDestination(dest)
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
        <DestinationSelect value={dest} onChange={setDest} clients={clients} employees={employees} />
        {/* (#238 + #95 followup) Auto-fill banner: distinguishes whether
            anything actually loaded, and whether it came from the curated ICP
            table or was inferred from the brief as a fallback. Three states:
              - icp / mixed: green tone, "Loaded from X's ICP"
              - brief_fallback: amber-warning tone, "Inferred from brief"
              - none: rose tone, "No ICP yet — open IcpEditor on their page" */}
        {autoFillBusy && (
          <div className="text-[11px] text-[color-mix(in_srgb,var(--gold-bright)_75%,transparent)] -mt-2">Loading their saved ICP…</div>
        )}
        {!autoFillBusy && autoFilledFromClient && (
          <div className="-mt-2 space-y-1">
            <div className="flex items-center gap-2 flex-wrap text-[11.5px]">
              {autoFilledFromClient.source === 'icp' && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/40 bg-emerald-400/10 px-2 py-0.5 font-medium text-emerald-200">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-300" aria-hidden="true" />
                  Loaded from {autoFilledFromClient.name}&apos;s ICP ({autoFilledFromClient.appliedCount} field{autoFilledFromClient.appliedCount === 1 ? '' : 's'})
                </span>
              )}
              {autoFilledFromClient.source === 'mixed' && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-[color-mix(in_srgb,var(--gold-bright)_35%,transparent)] bg-[color-mix(in_srgb,var(--gold-bright)_10%,transparent)] px-2 py-0.5 font-medium text-[color-mix(in_srgb,var(--gold-bright)_95%,transparent)]">
                  <span className="h-1.5 w-1.5 rounded-full bg-[var(--gold-bright)]" aria-hidden="true" />
                  Mixed — part from {autoFilledFromClient.name}&apos;s ICP, part inferred from brief
                </span>
              )}
              {autoFilledFromClient.source === 'brief_fallback' && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-[color-mix(in_srgb,var(--gold-bright)_35%,transparent)] bg-[color-mix(in_srgb,var(--gold-bright)_10%,transparent)] px-2 py-0.5 font-medium text-[color-mix(in_srgb,var(--gold-bright)_95%,transparent)]">
                  <span className="h-1.5 w-1.5 rounded-full bg-[var(--gold-bright)]" aria-hidden="true" />
                  Inferred from {autoFilledFromClient.name}&apos;s brief — ICP not curated yet
                </span>
              )}
              {autoFilledFromClient.source === 'none' && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-rose-400/40 bg-rose-400/10 px-2 py-0.5 font-medium text-rose-200">
                  <span className="h-1.5 w-1.5 rounded-full bg-rose-300" aria-hidden="true" />
                  No ICP saved yet for {autoFilledFromClient.name}
                </span>
              )}
              {autoFilledFromClient.appliedCount > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setOrganizationLocations('');
                    setQOrganizationKeywordTags('');
                    setSelectedRanges([]);
                    setAutoFilledFromClient(null);
                  }}
                  className="text-[10.5px] uppercase tracking-wider text-white/55 hover:text-white/85"
                >
                  clear
                </button>
              )}
              <a
                href={`/admin/av/clients/${autoFilledFromClient.clientId}`}
                className="text-[10.5px] uppercase tracking-wider text-[color-mix(in_srgb,var(--gold-bright)_75%,transparent)] hover:text-[color-mix(in_srgb,var(--gold-bright)_95%,transparent)]"
              >
                Open their ICP editor →
              </a>
            </div>
            {autoFilledFromClient.hint && (
              <div className="text-[10.5px] text-white/55 italic leading-snug">
                {autoFilledFromClient.hint}
              </div>
            )}
            {autoFilledFromClient.source === 'none' && (
              <div className="text-[10.5px] text-white/55 italic leading-snug">
                Their brief isn&apos;t populated either, or doesn&apos;t mention industries/locations. Type the criteria below or fill their intake first.
              </div>
            )}
          </div>
        )}
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
          {/* (#307) Exclude industries — was loaded silently from the client's
              ICP but never visible to val. Now an editable field that pre-fills
              from saved ICP and gets passed back so server-side post-filter
              respects per-run edits. */}
          <div className="md:col-span-2">
            <div className="text-xs uppercase tracking-wider text-muted mb-1">Exclude industries</div>
            <input
              type="text"
              value={qOrganizationNotKeywordTags}
              onChange={(e) => setQOrganizationNotKeywordTags(e.target.value)}
              placeholder="(optional) e.g. hospitality media, hospitality recruiting, education / institutes"
              className="w-full border border-border rounded-md px-3 py-2 text-sm placeholder:text-slate-500"
              style={inputStyle}
              title="Industries / keywords to drop from results. Pre-filled from this client's ICP exclude list when one is set; you can edit for THIS run without changing the saved ICP."
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
                      ? 'bg-brand text-black border-brand'
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
            className="px-4 py-2 bg-brand text-black text-sm font-medium rounded-md hover:opacity-90 disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            {running ? (
              <>
                <span className="inline-block w-3 h-3 border-2 border-black border-t-transparent rounded-full animate-spin" />
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
