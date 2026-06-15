/**
 * components/case/DocumentExtractsPanel.tsx  (val 2026-06-15, #671)
 *
 * Operator-side panel showing structured info the LLM scanner pulled out of
 * each uploaded document — drafting attorney, firm address + phone + bar #,
 * trustors / trustees / beneficiaries, notary, key dates. Groups by kind so
 * val + Adriana can see "everything we know about the lawyer" / "everything
 * we know about the parties" at a glance.
 *
 * Mount on /admin/av/clients/[id]/cases/[caseId] AFTER DocumentFindingsPanel.
 * Hides itself when no extracts exist (auto-runs when the operator clicks
 * Read & Flag Oddities — same LLM call now returns both).
 */
import type { DocumentExtract } from '@/lib/case/document_extracts_store';

interface DocLite {
  documentId: number;
  documentName: string;
}

interface Props {
  caseId: number;
  extracts: DocumentExtract[];
  documents: DocLite[];
}

const KIND_LABELS: Record<string, string> = {
  attorney:   'Attorneys',
  firm:       'Firms',
  bar_number: 'Bar numbers',
  address:    'Addresses',
  contact:    'Phone / Email / Fax',
  notary:     'Notaries',
  witness:    'Witnesses',
  party:      'Parties',
  date:       'Key dates',
  other:      'Other'
};

const KIND_ORDER = ['attorney', 'firm', 'bar_number', 'address', 'contact', 'notary', 'witness', 'party', 'date', 'other'];

export default function DocumentExtractsPanel({ caseId: _caseId, extracts, documents }: Props) {
  if (!extracts || extracts.length === 0) return null;

  const docMap = new Map<number, string>();
  for (const d of documents) docMap.set(d.documentId, d.documentName);

  // Group by kind, preserving DB order within each kind.
  const grouped: Record<string, DocumentExtract[]> = {};
  for (const e of extracts) {
    const k = e.kind || 'other';
    if (!grouped[k]) grouped[k] = [];
    grouped[k].push(e);
  }
  const presentKinds = KIND_ORDER.filter(k => grouped[k]?.length);

  return (
    /* (val 2026-06-15, #690) Whole section is collapsible — default closed.
        This panel is the audit trail (every party, every address, every bar
        number the LLM scanner pulled). It belongs on the page but shouldn't
        crowd the top. The drafting attorney hero (separate component) carries
        the at-a-glance attorney summary above this. */
    <details className="rounded-xl border border-border bg-[var(--surface-2)] p-5 case-extracts-panel" style={{ marginTop: 16 }}>
      <summary style={{ cursor: 'pointer', listStyle: 'none', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 11, color: 'var(--muted, #5C6862)', display: 'inline-block', transition: 'transform 0.15s' }} className="case-extracts-chev">▸</span>
        <h2 className="text-sm uppercase tracking-wider text-muted" style={{ margin: 0, flex: 1 }}>
          Pulled from documents ({extracts.length})
        </h2>
      </summary>
      <style>{`
        .case-extracts-panel[open] .case-extracts-chev { transform: rotate(90deg); }
        .case-extracts-panel summary::-webkit-details-marker { display: none; }
      `}</style>
      <p className="text-xs text-muted mt-3 mb-4 leading-relaxed">
        Contact info and parties the scanner extracted from uploaded PDFs. This
        is where the firm&rsquo;s address, phone, bar number, and the names of
        everyone in the file end up — populated once, reusable in letters,
        case dashboard, and downstream automation.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        {presentKinds.map((kind) => (
          <div key={kind}>
            <h3 style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--muted, #5C6862)', marginBottom: 8, fontWeight: 700 }}>
              {KIND_LABELS[kind] || kind}
            </h3>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {grouped[kind].map((e) => {
                const docName = docMap.get(e.documentId);
                const missing = e.value == null || e.value.trim() === '';
                return (
                  <li
                    key={e.extractId}
                    style={{
                      // (val 2026-06-15, #689) Responsive — stack columns
                      // under ~520px so labels/values/source don't crush.
                      display: 'grid',
                      gridTemplateColumns: 'minmax(140px, 180px) minmax(0, 1fr) minmax(0, auto)',
                      gap: 12,
                      padding: '8px 0',
                      borderTop: '1px solid rgba(127,127,127,0.18)',
                      alignItems: 'baseline'
                    }}
                  >
                    <div style={{ fontSize: 12, color: 'var(--muted, #5C6862)' }}>
                      {e.label || '(no label)'}
                    </div>
                    {/* (val 2026-06-15, #690) Use var(--ink) directly instead
                        of currentColor — the parent's color cascade is
                        getting overridden somewhere (Tailwind defaults or
                        the prose styles) so currentColor was inheriting a
                        muted value. --ink is per-surface (cream + dark both
                        define it correctly) so this is bulletproof on both. */}
                    <div style={{
                      fontSize: 13,
                      color: missing ? 'var(--muted, #5C6862)' : 'var(--ink, #14201B)',
                      fontStyle: missing ? 'italic' : 'normal',
                      wordBreak: 'break-word',
                      overflowWrap: 'anywhere',
                      minWidth: 0
                    }}>
                      {missing ? (e.note || 'not present in document') : e.value}
                    </div>
                    <div style={{
                      fontSize: 10,
                      letterSpacing: '0.06em',
                      color: 'var(--muted, #5C6862)',
                      textAlign: 'right',
                      wordBreak: 'break-word',
                      overflowWrap: 'anywhere',
                      minWidth: 0
                    }}>
                      {docName ? <span>{docName.replace(/\.[a-z]+$/i, '')}</span> : null}
                      {e.pageNumber ? <span> · p.{e.pageNumber}</span> : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </details>
  );
}
