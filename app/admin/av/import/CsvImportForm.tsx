'use client';
import { useRef, useState } from 'react';
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
          className="px-4 py-2 rounded-md bg-brand text-white font-medium hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
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
