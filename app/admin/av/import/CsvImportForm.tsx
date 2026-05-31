'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

interface RowResult {
  rowIndex: number;
  outcome: 'inserted' | 'duplicate_existing' | 'duplicate_target_upgraded' | 'invalid' | 'error';
  leadId?: number;
  company?: string;
  email?: string;
  domain?: string;
  reason?: string;
}

interface ImportResponse {
  ok: boolean;
  totalRows?: number;
  insertedCount?: number;
  duplicateCount?: number;
  invalidCount?: number;
  errorCount?: number;
  headerMap?: Record<string, string | null>;
  results?: RowResult[];
  error?: string;
  detected_headers?: string[];
}

const TARGET_OPTIONS = [
  { value: '', label: 'Auto (by industry per row)' },
  { value: 'av', label: 'AV only' },
  { value: 'ebw', label: 'EBW only' },
  { value: 'both', label: 'Both pipelines' }
];

const SAMPLE_CSV = `Company,Email,Phone,Website,Contact Name,Industry,Notes
Acme Restaurant,owner@acme.com,555-0100,https://acme.com,Jane Smith,restaurant,Met at conference
Sunset Marina,info@sunsetmarina.com,555-0200,https://sunsetmarina.com,John Doe,marina,Referred by Mike`;

export function CsvImportForm() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [csvText, setCsvText] = useState('');
  const [sourceLabel, setSourceLabel] = useState('');
  const [targetBusiness, setTargetBusiness] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResponse | null>(null);

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2_000_000) {
      setError('File too large (max 2 MB). Split it into smaller chunks.');
      return;
    }
    const text = await file.text();
    setCsvText(text);
    if (!sourceLabel) {
      setSourceLabel(file.name.replace(/\.csv$/i, ''));
    }
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    if (!csvText.trim()) {
      setError('Paste CSV content or pick a file first.');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/admin/av/leads/import-csv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          csv: csvText,
          sourceLabel: sourceLabel || 'csv-upload',
          targetBusiness: targetBusiness || undefined
        })
      });
      const rawText = await res.text();
      let json: ImportResponse | null = null;
      try {
        json = JSON.parse(rawText) as ImportResponse;
      } catch {
        setError(`Server returned non-JSON (HTTP ${res.status}). First 200 chars: ${rawText.slice(0, 200)}`);
        return;
      }
      if (!res.ok || !json) {
        setError(json?.error || `HTTP ${res.status}`);
        if (json?.detected_headers) {
          setError(`${json.error}\n\nDetected headers in your file: ${json.detected_headers.join(', ')}`);
        }
        return;
      }
      setResult(json);
      router.refresh();
    } catch (err) {
      setError(`Network error: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  }

  function useSample() {
    setCsvText(SAMPLE_CSV);
    setSourceLabel('sample-data');
  }

  const inputStyle: React.CSSProperties = { backgroundColor: '#1a1f2e', color: '#f1f5f9' };

  return (
    <div className="space-y-5">
      <SingleLeadForm />
      <AddContactForm />

      <div className="rounded-md border border-border p-4" style={{ backgroundColor: '#0e1420' }}>
        <h3 className="text-sm font-medium text-ink mb-2">Accepted columns (fuzzy-matched)</h3>
        <p className="text-xs text-muted mb-3">
          The platform recognizes common header names. You don&apos;t need to rename your file.
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
          <div><span className="text-ink">Company</span> <span className="text-muted">business, name, org</span></div>
          <div><span className="text-ink">Email</span> <span className="text-muted">mail, contact_email</span></div>
          <div><span className="text-ink">Phone</span> <span className="text-muted">tel, mobile</span></div>
          <div><span className="text-ink">Website</span> <span className="text-muted">url, domain</span></div>
          <div><span className="text-ink">Contact Name</span> <span className="text-muted">contact, poc</span></div>
          <div><span className="text-ink">Title</span> <span className="text-muted">job_title, role</span></div>
          <div><span className="text-ink">Industry</span> <span className="text-muted">vertical, category</span></div>
          <div><span className="text-ink">Notes</span> <span className="text-muted">comments, description</span></div>
        </div>
        <button
          type="button"
          onClick={useSample}
          className="mt-3 text-xs text-brand hover:underline"
        >
          Insert sample CSV for testing →
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-xs uppercase tracking-wider text-muted mb-1">Pick file or paste CSV</label>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            onChange={handleFileSelected}
            className="block text-sm text-muted file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border file:border-border file:bg-surface file:text-ink file:hover:border-brand file:transition-colors file:cursor-pointer"
          />
        </div>

        <div>
          <label className="block text-xs uppercase tracking-wider text-muted mb-1">
            CSV content {csvText && <span className="normal-case text-muted/70">({csvText.length.toLocaleString()} chars, {csvText.split('\n').length} lines)</span>}
          </label>
          <textarea
            value={csvText}
            onChange={(e) => setCsvText(e.target.value)}
            placeholder="Or paste CSV here (header row required)..."
            rows={10}
            className="w-full px-3 py-2 rounded-md border border-border focus:border-brand focus:outline-none font-mono text-xs"
            style={inputStyle}
          />
        </div>

        <div className="flex flex-wrap gap-3">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs uppercase tracking-wider text-muted mb-1">Source label</label>
            <input
              type="text"
              value={sourceLabel}
              onChange={(e) => setSourceLabel(e.target.value)}
              placeholder="e.g. acme-2026-customer-export"
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
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
        </div>

        <button
          type="submit"
          disabled={loading || !csvText.trim()}
          className="px-4 py-2 rounded-md bg-brand text-black font-medium hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? 'Importing…' : 'Import CSV'}
        </button>
      </form>

      {error && (
        <div className="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200 whitespace-pre-wrap">
          {error}
        </div>
      )}

      {result && <ImportResultPanel result={result} />}
    </div>
  );
}

/**
 * Single-lead quick-add. Builds a one-row CSV and posts it to the SAME
 * import endpoint, so a manually-added lead inherits dedup, target-business
 * inference, and background scoring/auditing -- no separate code path.
 */
function SingleLeadForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({
    company: '',
    contactName: '',
    email: '',
    phone: '',
    website: '',
    industry: '',
    notes: ''
  });
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setF((p) => ({ ...p, [k]: e.target.value }));

  function csvCell(v: string): string {
    const s = (v ?? '').trim();
    if (s === '') return '';
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setMsg(null);
    if (!f.company.trim() && !f.email.trim() && !f.website.trim()) {
      setErr('Enter at least a company, email, or website.');
      return;
    }
    const csv =
      'Company,Contact Name,Email,Phone,Website,Industry,Notes\n' +
      [f.company, f.contactName, f.email, f.phone, f.website, f.industry, f.notes].map(csvCell).join(',');
    setBusy(true);
    try {
      const res = await fetch('/api/admin/av/leads/import-csv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          csv,
          sourceLabel: `manual-${(f.company || f.website || 'lead').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)}`,
          targetBusiness: target || undefined
        })
      });
      const json = (await res.json().catch(() => null)) as ImportResponse | null;
      if (!res.ok || !json?.ok) {
        setErr(json?.error || `HTTP ${res.status}`);
        return;
      }
      const r = json.results?.[0];
      if (r?.outcome === 'inserted') setMsg(`Lead created (#${r.leadId}). It is being scored and audited now.`);
      else if (r?.outcome === 'duplicate_existing') setMsg(`Already in your pipeline (lead #${r.leadId}).`);
      else if (r?.outcome === 'duplicate_target_upgraded') setMsg(`Existing lead #${r.leadId} updated to cover this pipeline.`);
      else setMsg(r?.reason || 'Submitted.');
      setF({ company: '', contactName: '', email: '', phone: '', website: '', industry: '', notes: '' });
      router.refresh();
    } catch (e2) {
      setErr(`Network error: ${(e2 as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  const inputStyle: React.CSSProperties = { backgroundColor: '#1a1f2e', color: '#f1f5f9' };

  return (
    <div className="rounded-md border border-border p-4" style={{ backgroundColor: '#0e1420' }}>
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-ink">Add one lead</h3>
        <button type="button" onClick={() => setOpen((o) => !o)} className="text-xs text-brand hover:underline">
          {open ? 'Hide' : 'Add a single lead (e.g. a new meeting) →'}
        </button>
      </div>

      {open && (
        <form onSubmit={submit} className="mt-3 space-y-3">
          <div className="grid sm:grid-cols-2 gap-3">
            <input value={f.company} onChange={set('company')} placeholder="Company *" className="px-3 py-2 rounded-md border border-border focus:border-brand focus:outline-none text-sm" style={inputStyle} />
            <input value={f.contactName} onChange={set('contactName')} placeholder="Contact name" className="px-3 py-2 rounded-md border border-border focus:border-brand focus:outline-none text-sm" style={inputStyle} />
            <input value={f.email} onChange={set('email')} placeholder="Email" className="px-3 py-2 rounded-md border border-border focus:border-brand focus:outline-none text-sm" style={inputStyle} />
            <input value={f.phone} onChange={set('phone')} placeholder="Phone" className="px-3 py-2 rounded-md border border-border focus:border-brand focus:outline-none text-sm" style={inputStyle} />
            <input value={f.website} onChange={set('website')} placeholder="Website" className="px-3 py-2 rounded-md border border-border focus:border-brand focus:outline-none text-sm" style={inputStyle} />
            <input value={f.industry} onChange={set('industry')} placeholder="Industry (e.g. restaurant)" className="px-3 py-2 rounded-md border border-border focus:border-brand focus:outline-none text-sm" style={inputStyle} />
          </div>
          <input value={f.notes} onChange={set('notes')} placeholder="Notes (e.g. Meeting with Skip and Mike)" className="w-full px-3 py-2 rounded-md border border-border focus:border-brand focus:outline-none text-sm" style={inputStyle} />
          <div className="flex flex-wrap items-center gap-3">
            <select value={target} onChange={(e) => setTarget(e.target.value)} className="px-3 py-2 rounded-md border border-border focus:border-brand focus:outline-none text-sm" style={inputStyle}>
              {TARGET_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <button type="submit" disabled={busy} className="px-4 py-2 rounded-md bg-brand text-black font-medium hover:opacity-90 transition-opacity disabled:opacity-50">
              {busy ? 'Adding…' : 'Add lead'}
            </button>
            <span className="text-[11px] text-muted">Enter at least a company, email, or website.</span>
          </div>
          {msg && <div className="rounded-md border border-green-500/40 bg-green-500/10 p-2 text-sm text-green-200">{msg}</div>}
          {err && <div className="rounded-md border border-red-500/40 bg-red-500/10 p-2 text-sm text-red-200 whitespace-pre-wrap">{err}</div>}
        </form>
      )}
    </div>
  );
}

/**
 * Add a person (contact) and attach them to one OR MORE companies. A person can
 * belong to multiple companies; pick all that apply. Posts to /api/admin/av/contacts.
 */
function AddContactForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [companies, setCompanies] = useState<Array<{ id: number; company: string }>>([]);
  const [loadingCos, setLoadingCos] = useState(false);
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState<number[]>([]);
  const [f, setF] = useState({ fullName: '', email: '', phone: '', title: '' });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open || companies.length > 0) return;
    setLoadingCos(true);
    fetch('/api/admin/av/companies', { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => setCompanies(j.items || []))
      .catch(() => setErr('Could not load companies.'))
      .finally(() => setLoadingCos(false));
  }, [open, companies.length]);

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setF((p) => ({ ...p, [k]: e.target.value }));

  function toggle(id: number) {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setMsg(null);
    if (!f.fullName.trim() && !f.email.trim()) {
      setErr('Enter at least a name or email.');
      return;
    }
    if (selected.length === 0) {
      setErr('Pick at least one company to attach this person to.');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/admin/av/contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...f, leadIds: selected })
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        setErr(json?.error || `HTTP ${res.status}`);
        return;
      }
      setMsg(`Contact saved and linked to ${json.companiesLinked} compan${json.companiesLinked === 1 ? 'y' : 'ies'}.`);
      setF({ fullName: '', email: '', phone: '', title: '' });
      setSelected([]);
      router.refresh();
    } catch (e2) {
      setErr(`Network error: ${(e2 as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  const inputStyle: React.CSSProperties = { backgroundColor: '#1a1f2e', color: '#f1f5f9' };
  const shown = filter.trim()
    ? companies.filter((c) => (c.company || '').toLowerCase().includes(filter.trim().toLowerCase()))
    : companies;

  return (
    <div className="rounded-md border border-border p-4" style={{ backgroundColor: '#0e1420' }}>
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-ink">Add a contact (person)</h3>
        <button type="button" onClick={() => setOpen((o) => !o)} className="text-xs text-brand hover:underline">
          {open ? 'Hide' : 'Add a person to one or more companies →'}
        </button>
      </div>

      {open && (
        <form onSubmit={submit} className="mt-3 space-y-3">
          <div className="grid sm:grid-cols-2 gap-3">
            <input value={f.fullName} onChange={set('fullName')} placeholder="Full name *" className="px-3 py-2 rounded-md border border-border focus:border-brand focus:outline-none text-sm" style={inputStyle} />
            <input value={f.email} onChange={set('email')} placeholder="Email" className="px-3 py-2 rounded-md border border-border focus:border-brand focus:outline-none text-sm" style={inputStyle} />
            <input value={f.phone} onChange={set('phone')} placeholder="Phone" className="px-3 py-2 rounded-md border border-border focus:border-brand focus:outline-none text-sm" style={inputStyle} />
            <input value={f.title} onChange={set('title')} placeholder="Title / role at these companies" className="px-3 py-2 rounded-md border border-border focus:border-brand focus:outline-none text-sm" style={inputStyle} />
          </div>

          <div>
            <label className="block text-xs uppercase tracking-wider text-muted mb-1">
              Attach to companies {selected.length > 0 && <span className="normal-case text-brand">({selected.length} selected)</span>}
            </label>
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter companies…"
              className="w-full mb-2 px-3 py-2 rounded-md border border-border focus:border-brand focus:outline-none text-sm"
              style={inputStyle}
            />
            <div className="max-h-44 overflow-y-auto rounded-md border border-border divide-y divide-border/40">
              {loadingCos ? (
                <div className="p-3 text-xs text-muted">Loading companies…</div>
              ) : shown.length === 0 ? (
                <div className="p-3 text-xs text-muted">No companies found.</div>
              ) : (
                shown.map((c) => (
                  <label key={c.id} className="flex items-center gap-2 px-3 py-1.5 text-sm text-ink cursor-pointer hover:bg-surface-2">
                    <input type="checkbox" checked={selected.includes(c.id)} onChange={() => toggle(c.id)} className="accent-amber-500" />
                    <span>{c.company}</span>
                  </label>
                ))
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" disabled={busy} className="px-4 py-2 rounded-md bg-brand text-black font-medium hover:opacity-90 transition-opacity disabled:opacity-50">
              {busy ? 'Saving…' : 'Save contact'}
            </button>
            <span className="text-[11px] text-muted">A person can be attached to several companies — check all that apply.</span>
          </div>
          {msg && <div className="rounded-md border border-green-500/40 bg-green-500/10 p-2 text-sm text-green-200">{msg}</div>}
          {err && <div className="rounded-md border border-red-500/40 bg-red-500/10 p-2 text-sm text-red-200 whitespace-pre-wrap">{err}</div>}
        </form>
      )}
    </div>
  );
}

function ImportResultPanel({ result }: { result: ImportResponse }) {
  if (!result.results) return null;
  return (
    <div className="rounded-md border border-border p-4" style={{ backgroundColor: '#0e1420' }}>
      <div className="flex flex-wrap gap-4 text-sm mb-3">
        <Stat label="Rows" value={result.totalRows ?? 0} />
        <Stat label="Inserted" value={result.insertedCount ?? 0} tone="green" />
        <Stat label="Duplicates" value={result.duplicateCount ?? 0} tone="amber" />
        <Stat label="Invalid" value={result.invalidCount ?? 0} tone="muted" />
        <Stat label="Errors" value={result.errorCount ?? 0} tone={(result.errorCount ?? 0) > 0 ? 'red' : 'muted'} />
      </div>

      {result.headerMap && (
        <div className="text-xs text-muted mb-3">
          Header mapping detected:{' '}
          {Object.entries(result.headerMap)
            .filter(([, v]) => v)
            .map(([k, v]) => (
              <span key={k} className="inline-block mr-3">
                <span className="text-ink">{k}</span>=<span className="font-mono">{v}</span>
              </span>
            ))}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-muted border-b border-border">
            <tr>
              <th className="text-left py-1 pr-3">Row</th>
              <th className="text-left py-1 pr-3">Outcome</th>
              <th className="text-left py-1 pr-3">Company</th>
              <th className="text-left py-1 pr-3">Domain</th>
              <th className="text-left py-1 pr-3">Note</th>
            </tr>
          </thead>
          <tbody>
            {result.results.map((r) => (
              <tr key={r.rowIndex} className="border-b border-border/40">
                <td className="py-1 pr-3 font-mono text-muted">{r.rowIndex}</td>
                <td className="py-1 pr-3"><OutcomePill outcome={r.outcome} /></td>
                <td className="py-1 pr-3">{r.company ?? '—'}</td>
                <td className="py-1 pr-3 text-muted">{r.domain ?? '—'}</td>
                <td className="py-1 pr-3 text-muted/70">{r.reason ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'green' | 'amber' | 'red' | 'muted' }) {
  const color =
    tone === 'green' ? 'text-green-400'
    : tone === 'amber' ? 'text-amber-400'
    : tone === 'red' ? 'text-red-400'
    : tone === 'muted' ? 'text-muted'
    : 'text-ink';
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
    duplicate_existing: { label: 'DUPLICATE', cls: 'bg-amber-500/15 text-amber-300 border-amber-500/30' },
    duplicate_target_upgraded: { label: 'DUP → AV+EBW', cls: 'bg-purple-500/15 text-purple-300 border-purple-500/30' },
    invalid: { label: 'INVALID', cls: 'bg-slate-500/15 text-slate-300 border-slate-500/30' },
    error: { label: 'ERROR', cls: 'bg-red-500/15 text-red-300 border-red-500/30' }
  };
  const m = map[outcome] || { label: outcome.toUpperCase(), cls: 'bg-slate-500/15 text-slate-300 border-slate-500/30' };
  return <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border ${m.cls}`}>{m.label}</span>;
}
