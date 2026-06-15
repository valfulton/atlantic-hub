'use client';

/**
 * components/case/DocumentReadButton.tsx  (val 2026-06-15, #666)
 *
 * "Read & flag oddities" button on each document row. Operator-only — mount
 * on the operator case dashboard (/admin/av/clients/[id]/cases/[caseId]),
 * NEVER on the family-facing /client surface.
 *
 * Clicking POSTs to /api/admin/av/cases/[caseId]/documents/[docId]/read,
 * which:
 *   1. Pulls bytes, extracts per-page text via unpdf
 *   2. Calls runLlm with task kind 'document_read' (gpt-4o, deterministic)
 *   3. Stores findings in case_document_findings (re-run replaces)
 *   4. Returns the structured findings + cost
 *
 * Component renders the findings inline below the button. Spinner runs
 * during the call (~10-25s for a trust). Severity-color borders match
 * the family-view action-item tags (urgent garnet, high gold, normal/info
 * emerald).
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Finding {
  documentId?: number;
  caseId?: number;
  sectionKey: string | null;
  quote: string | null;
  oddityType: string | null;
  severity: 'urgent' | 'high' | 'normal' | 'info';
  pageNumber: number | null;
  llmNote: string | null;
  modelId?: string | null;
}

interface Props {
  caseId: number;
  documentId: number;
  documentName: string;
  /** Findings already stored from a prior run, so the panel renders on first paint. */
  initialFindings?: Finding[];
}

export default function DocumentReadButton({ caseId, documentId, documentName, initialFindings = [] }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [findings, setFindings] = useState<Finding[]>(initialFindings);
  const [lastRun, setLastRun] = useState<{ count: number; pages: number; model: string; source: 'live' | 'cache' } | null>(null);

  async function runRead() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/av/cases/${caseId}/documents/${documentId}/read`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' } }
      );
      const j = await res.json();
      if (!res.ok || !j.ok) {
        setError(j.error || `read failed (HTTP ${res.status})`);
        return;
      }
      setFindings(j.findings || []);
      setLastRun({ count: j.findingCount, pages: j.pageCount, model: j.modelId, source: j.cacheSource });
      router.refresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'network error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: 8 }}>
      <button
        type="button"
        onClick={runRead}
        disabled={busy}
        style={{
          fontSize: 11,
          padding: '4px 10px',
          borderRadius: 6,
          border: '1px solid rgba(10,77,60,0.4)',
          background: busy ? 'rgba(10,77,60,0.08)' : 'rgba(10,77,60,0.03)',
          color: 'var(--emerald-deep, #0A4D3C)',
          fontWeight: 600,
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
          cursor: busy ? 'wait' : 'pointer'
        }}
        title={`Run the LLM document reader against ${documentName}. Replaces prior findings.`}
      >
        {busy ? 'Reading…' : findings.length > 0 ? 'Re-read & flag' : 'Read & flag oddities'}
      </button>

      {error && (
        <div style={{ fontSize: 11, color: '#A23B2E', marginTop: 6 }}>
          {error}
        </div>
      )}

      {lastRun && !error && (
        <div style={{ fontSize: 10, color: 'var(--muted, #5C6862)', marginTop: 6, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          {lastRun.source === 'cache' ? 'Cached · ' : ''}
          {lastRun.count} finding{lastRun.count === 1 ? '' : 's'} · {lastRun.pages} pages · {lastRun.model}
        </div>
      )}

      {findings.length > 0 && (
        <div style={{ marginTop: 10, borderTop: '1px solid rgba(10,77,60,0.14)', paddingTop: 10 }}>
          <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--muted, #5C6862)', marginBottom: 8 }}>
            Findings ({findings.length})
          </div>
          {findings.map((f, i) => {
            const sevColor =
              f.severity === 'urgent' ? '#8E2A2A'
              : f.severity === 'high' ? '#7A5A18'
              : f.severity === 'info' ? '#5C6862'
              : '#0A4D3C';
            return (
              <div key={i} style={{ borderLeft: `3px solid ${sevColor}`, paddingLeft: 10, marginBottom: 10 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted, #5C6862)', marginBottom: 4 }}>
                  <span style={{ color: sevColor, fontWeight: 700 }}>{f.severity}</span>
                  {f.sectionKey && <span>· §{f.sectionKey}</span>}
                  {f.pageNumber && <span>· page {f.pageNumber}</span>}
                  {f.oddityType && <span>· {f.oddityType.replace(/_/g, ' ')}</span>}
                </div>
                {f.quote && (
                  <div style={{ fontSize: 12, fontStyle: 'italic', color: 'var(--ink)', marginBottom: 4, lineHeight: 1.45, borderLeft: '2px solid rgba(10,10,10,0.1)', paddingLeft: 8 }}>
                    "{f.quote}"
                  </div>
                )}
                {f.llmNote && (
                  <div style={{ fontSize: 12, color: 'var(--muted, #5C6862)', lineHeight: 1.5 }}>
                    {f.llmNote}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
