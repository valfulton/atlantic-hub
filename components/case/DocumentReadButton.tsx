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

type Severity = 'urgent' | 'high' | 'normal' | 'info';
type Visibility = 'operator_only' | 'family_visible';

interface Finding {
  findingId?: number;
  documentId?: number;
  caseId?: number;
  sectionKey: string | null;
  quote: string | null;
  oddityType: string | null;
  severity: Severity;
  visibility?: Visibility;
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
  /** Trust byte-serve URL — when present, each finding's page number becomes
   *  a click-jump to that page in the PDF (operator side, mirrors family).
   *  (#672) */
  indexableDocumentUrl?: string | null;
  indexableDocumentId?: number | null;
}

export default function DocumentReadButton({ caseId, documentId, documentName, initialFindings = [], indexableDocumentUrl, indexableDocumentId }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [findings, setFindings] = useState<Finding[]>(initialFindings);
  const [lastRun, setLastRun] = useState<{ count: number; extractCount: number; pages: number; model: string; source: 'live' | 'cache' } | null>(null);
  // (#670) Per-finding inline edit state. Keyed by index so we don't lose
  // un-saved text if findings get re-sorted.
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState<{ quote: string; llmNote: string; sectionKey: string; pageNumber: string }>({ quote: '', llmNote: '', sectionKey: '', pageNumber: '' });
  const [editBusy, setEditBusy] = useState(false);

  function startEdit(idx: number, f: Finding) {
    setEditingIdx(idx);
    setEditDraft({
      quote: f.quote || '',
      llmNote: f.llmNote || '',
      sectionKey: f.sectionKey || '',
      pageNumber: f.pageNumber == null ? '' : String(f.pageNumber)
    });
  }
  async function saveEdit(idx: number) {
    const f = findings[idx];
    if (!f?.findingId) return;
    setEditBusy(true);
    try {
      const body: Record<string, unknown> = {
        quote: editDraft.quote.trim() || null,
        llmNote: editDraft.llmNote.trim() || null,
        sectionKey: editDraft.sectionKey.trim() || null,
        pageNumber: editDraft.pageNumber.trim() ? Number(editDraft.pageNumber.trim()) : null
      };
      const res = await fetch(
        `/api/admin/av/cases/${caseId}/findings/${f.findingId}/content`,
        { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setFindings(prev => prev.map((x, j) => j === idx ? {
        ...x,
        quote: body.quote as string | null,
        llmNote: body.llmNote as string | null,
        sectionKey: body.sectionKey as string | null,
        pageNumber: body.pageNumber as number | null
      } : x));
      setEditingIdx(null);
      router.refresh();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setEditBusy(false);
    }
  }

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
      setLastRun({
        count: j.findingCount,
        extractCount: j.extractCount || 0,
        pages: j.pageCount,
        model: j.modelId,
        source: j.cacheSource
      });
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
          padding: '6px 14px',
          borderRadius: 6,
          // Operator chrome is dark — gold-jewelry on dark per brand rules.
          border: '1px solid rgba(235,203,107,0.55)',
          background: busy ? 'rgba(235,203,107,0.14)' : 'rgba(235,203,107,0.08)',
          color: 'var(--gold, #EBCB6B)',
          fontWeight: 600,
          letterSpacing: '0.06em',
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
          {lastRun.count} finding{lastRun.count === 1 ? '' : 's'} · {lastRun.extractCount} extract{lastRun.extractCount === 1 ? '' : 's'} · {lastRun.pages} pages · {lastRun.model}
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
            const onSevChange = async (next: Severity) => {
              if (!f.findingId || next === f.severity) return;
              // Optimistic update — flip locally, then PATCH; on failure, revert.
              const prev = f.severity;
              setFindings(prevList => prevList.map((x, j) => j === i ? { ...x, severity: next } : x));
              try {
                const res = await fetch(
                  `/api/admin/av/cases/${caseId}/findings/${f.findingId}/severity`,
                  {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ severity: next })
                  }
                );
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
              } catch {
                setFindings(prevList => prevList.map((x, j) => j === i ? { ...x, severity: prev } : x));
              }
            };
            return (
              <div key={f.findingId ?? i} style={{ borderLeft: `3px solid ${sevColor}`, paddingLeft: 10, marginBottom: 10 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted, #5C6862)', marginBottom: 4 }}>
                  {f.findingId ? (
                    <select
                      value={f.severity}
                      onChange={(e) => onSevChange(e.target.value as Severity)}
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        letterSpacing: '0.08em',
                        color: sevColor,
                        background: 'transparent',
                        border: `1px solid ${sevColor}55`,
                        borderRadius: 4,
                        padding: '1px 4px',
                        cursor: 'pointer'
                      }}
                      title="Change severity (saves immediately)"
                    >
                      <option value="urgent">urgent</option>
                      <option value="high">high</option>
                      <option value="normal">normal</option>
                      <option value="info">info</option>
                    </select>
                  ) : (
                    <span style={{ color: sevColor, fontWeight: 700 }}>{f.severity}</span>
                  )}
                  {(() => {
                    // (#672) Click-jump the §-ref + page number to the trust PDF
                    // when the finding belongs to the indexable document. Same
                    // pattern as the family panel.
                    const canJump =
                      !!indexableDocumentUrl
                      && f.pageNumber != null
                      && (indexableDocumentId == null || f.documentId === indexableDocumentId);
                    const jumpHref = canJump
                      ? `${indexableDocumentUrl}#page=${f.pageNumber}`
                      : null;
                    const linkStyle: React.CSSProperties = {
                      color: 'var(--gold, #EBCB6B)',
                      textDecoration: 'underline',
                      textDecorationStyle: 'dotted',
                      textDecorationColor: 'var(--gold, #EBCB6B)',
                      cursor: 'pointer'
                    };
                    return (
                      <>
                        {f.sectionKey && (
                          jumpHref ? (
                            <a href={jumpHref} target="_blank" rel="noopener noreferrer" style={linkStyle} title="Jump to this section in the document">
                              · §{f.sectionKey}
                            </a>
                          ) : (
                            <span>· §{f.sectionKey}</span>
                          )
                        )}
                        {f.pageNumber && (
                          jumpHref ? (
                            <a href={jumpHref} target="_blank" rel="noopener noreferrer" style={linkStyle} title="Open the document at this page">
                              · page {f.pageNumber} ↗
                            </a>
                          ) : (
                            <span>· page {f.pageNumber}</span>
                          )
                        )}
                        {f.oddityType && <span>· {f.oddityType.replace(/_/g, ' ')}</span>}
                      </>
                    );
                  })()}
                  {f.findingId && (
                    <button
                      type="button"
                      onClick={async () => {
                        const cur: Visibility = f.visibility || 'operator_only';
                        const next: Visibility = cur === 'family_visible' ? 'operator_only' : 'family_visible';
                        const prev = cur;
                        setFindings(prevList => prevList.map((x, j) => j === i ? { ...x, visibility: next } : x));
                        try {
                          const res = await fetch(
                            `/api/admin/av/cases/${caseId}/findings/${f.findingId}/visibility`,
                            {
                              method: 'PATCH',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ visibility: next })
                            }
                          );
                          if (!res.ok) throw new Error(`HTTP ${res.status}`);
                          router.refresh();
                        } catch {
                          setFindings(prevList => prevList.map((x, j) => j === i ? { ...x, visibility: prev } : x));
                        }
                      }}
                      style={{
                        marginLeft: 'auto',
                        fontSize: 9,
                        fontWeight: 700,
                        letterSpacing: '0.08em',
                        textTransform: 'uppercase',
                        padding: '2px 8px',
                        borderRadius: 999,
                        border: f.visibility === 'family_visible'
                          ? '1px solid rgba(10,77,60,0.5)'
                          : '1px solid rgba(120,120,120,0.4)',
                        background: f.visibility === 'family_visible'
                          ? 'rgba(10,77,60,0.10)'
                          : 'transparent',
                        color: f.visibility === 'family_visible'
                          ? 'var(--emerald-deep, #0A4D3C)'
                          : 'var(--muted, #888)',
                        cursor: 'pointer'
                      }}
                      title={f.visibility === 'family_visible'
                        ? 'Family can see this — click to hide'
                        : 'Hidden from family — click to show'}
                    >
                      {f.visibility === 'family_visible' ? '● Family sees' : '○ Operator only'}
                    </button>
                  )}
                </div>
                {editingIdx === i ? (
                  // (#670) Inline edit form — replaces verbatim view while open.
                  <div style={{ marginTop: 6 }}>
                    <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                      <input
                        type="text"
                        value={editDraft.sectionKey}
                        onChange={(e) => setEditDraft(d => ({ ...d, sectionKey: e.target.value }))}
                        placeholder="§ ref (e.g. 5.A)"
                        style={{ flex: 1, fontSize: 11, padding: '3px 6px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 4, color: 'inherit' }}
                      />
                      <input
                        type="number"
                        value={editDraft.pageNumber}
                        onChange={(e) => setEditDraft(d => ({ ...d, pageNumber: e.target.value }))}
                        placeholder="page"
                        style={{ width: 70, fontSize: 11, padding: '3px 6px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 4, color: 'inherit' }}
                      />
                    </div>
                    <textarea
                      value={editDraft.quote}
                      onChange={(e) => setEditDraft(d => ({ ...d, quote: e.target.value }))}
                      placeholder="Verbatim quote from the document"
                      rows={3}
                      style={{ width: '100%', fontSize: 12, padding: 6, marginBottom: 6, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 4, color: 'inherit', fontStyle: 'italic', resize: 'vertical' }}
                    />
                    <textarea
                      value={editDraft.llmNote}
                      onChange={(e) => setEditDraft(d => ({ ...d, llmNote: e.target.value }))}
                      placeholder="Analyst note explaining the concern (shown to family if Family-sees is on)"
                      rows={4}
                      style={{ width: '100%', fontSize: 12, padding: 6, marginBottom: 6, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 4, color: 'inherit', resize: 'vertical' }}
                    />
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        type="button"
                        onClick={() => saveEdit(i)}
                        disabled={editBusy}
                        style={{ fontSize: 11, padding: '4px 12px', borderRadius: 4, border: '1px solid rgba(235,203,107,0.55)', background: 'rgba(235,203,107,0.14)', color: 'var(--gold, #EBCB6B)', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', cursor: editBusy ? 'wait' : 'pointer' }}
                      >
                        {editBusy ? 'Saving…' : 'Save'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingIdx(null)}
                        disabled={editBusy}
                        style={{ fontSize: 11, padding: '4px 12px', borderRadius: 4, border: '1px solid rgba(160,160,160,0.3)', background: 'transparent', color: 'var(--muted, #888)', cursor: 'pointer' }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    {f.quote && (
                      <div style={{ fontSize: 12, fontStyle: 'italic', color: 'var(--ink)', marginBottom: 4, lineHeight: 1.45, borderLeft: '2px solid rgba(10,10,10,0.1)', paddingLeft: 8 }}>
                        &ldquo;{f.quote}&rdquo;
                      </div>
                    )}
                    {f.llmNote && (
                      <div style={{ fontSize: 12, color: 'var(--muted, #5C6862)', lineHeight: 1.5 }}>
                        {f.llmNote}
                      </div>
                    )}
                    {f.findingId && (
                      <button
                        type="button"
                        onClick={() => startEdit(i, f)}
                        style={{ marginTop: 6, fontSize: 10, padding: '2px 8px', borderRadius: 4, border: '1px solid rgba(160,160,160,0.3)', background: 'transparent', color: 'var(--muted, #888)', cursor: 'pointer', letterSpacing: '0.06em', textTransform: 'uppercase' }}
                        title="Edit quote, note, section, or page"
                      >
                        ✎ Edit
                      </button>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
