/**
 * /admin/av/clients/[client_id]/distress/[entity_key]  (val 2026-06-07)
 *
 * Operator-only intel dossier for a single watchlist entity. Server-rendered
 * so the operator sees real data on first paint — no client-side fetch
 * spinner, no skeleton.
 *
 * What you see, top to bottom:
 *   1. Entity header — name, score, source counts, "open lead" link if promoted
 *   2. Signals strip — every classified signal that contributed to the score,
 *      each with a plain-English "why this matters" line
 *   3. Records — every public_intel_record we hold on this entity, grouped
 *      by source kind, each with:
 *        - the structured headline fields per source kind
 *        - the signals THIS record fires
 *        - the full raw JSON in a <details> disclosure
 *
 * This is the visibility-gap closer: every field we paid for, surfaced.
 */
import Link from 'next/link';
import { loadDossierForEntity, SIGNAL_KIND_COPY, type Dossier } from '@/lib/public_intel/dossier';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Auth: gated by /admin/av/* middleware. Any reader of this page is already
 * known to be a non-client operator. The dossier loader is itself scoped to
 * client_id so a misbehaving link can't leak cross-client data.
 */
interface PageProps {
  params: { client_id: string; entity_key: string };
}

/** Headline fields per source — what to surface above the fold for each
 *  record. Keys reference common payload paths each adapter writes. Missing
 *  fields are skipped silently (we never invent data). */
const STRUCTURED_HINTS: Record<string, Array<{ path: string; label: string }>> = {
  courtlistener: [
    { path: 'case_name', label: 'Case' },
    { path: 'docket_number', label: 'Docket #' },
    { path: 'court', label: 'Court' },
    { path: 'date_filed', label: 'Filed' },
    { path: 'nature_of_suit', label: 'Nature' },
    { path: 'parties', label: 'Parties' },
    { path: 'absolute_url', label: 'CourtListener URL' }
  ],
  pacer_docket: [
    { path: 'case_name', label: 'Case' },
    { path: 'docket_number', label: 'Docket #' },
    { path: 'chapter', label: 'Chapter' },
    { path: 'date_filed', label: 'Filed' },
    { path: 'creditors', label: 'Creditors' },
    { path: 'trustee', label: 'Trustee' }
  ],
  ca_sos: [
    { path: 'entity_name', label: 'Entity' },
    { path: 'entity_number', label: 'SOS Entity #' },
    { path: 'status', label: 'Status' },
    { path: 'entity_type', label: 'Type' },
    { path: 'jurisdiction', label: 'Jurisdiction' },
    { path: 'agent_name', label: 'Registered agent' },
    { path: 'agent_address', label: 'Agent address' },
    { path: 'incorporation_date', label: 'Incorporated' }
  ],
  ucc_ca: [
    { path: 'debtor_name', label: 'Debtor' },
    { path: 'secured_party', label: 'Secured party' },
    { path: 'filing_number', label: 'Filing #' },
    { path: 'filing_date', label: 'Filed' },
    { path: 'collateral_description', label: 'Collateral' }
  ],
  cfpb: [
    { path: 'company', label: 'Company' },
    { path: 'product', label: 'Product' },
    { path: 'sub_product', label: 'Sub-product' },
    { path: 'issue', label: 'Issue' },
    { path: 'sub_issue', label: 'Sub-issue' },
    { path: 'state', label: 'State' },
    { path: 'zip_code', label: 'ZIP' },
    { path: 'date_received', label: 'Received' },
    { path: 'company_response', label: 'Co. response' },
    { path: 'timely_response', label: 'Timely?' },
    { path: 'complaint_what_happened', label: 'Narrative' }
  ],
  md_land_rec: [
    { path: 'instrument_type', label: 'Instrument' },
    { path: 'grantor', label: 'Grantor' },
    { path: 'grantee', label: 'Grantee' },
    { path: 'recording_date', label: 'Recorded' },
    { path: 'county', label: 'County' },
    { path: 'book_page', label: 'Book/Page' }
  ],
  datasf: [
    { path: 'address', label: 'Address' },
    { path: 'complaint_description', label: 'Complaint' },
    { path: 'status', label: 'Status' },
    { path: 'date_opened', label: 'Opened' },
    { path: 'last_updated', label: 'Updated' }
  ],
  gbp: [
    { path: 'place_name', label: 'Business' },
    { path: 'rating', label: 'Rating' },
    { path: 'review_count', label: 'Reviews' },
    { path: 'snapshot_date', label: 'Snapshot' },
    { path: 'categories', label: 'Categories' }
  ],
  hmda: [
    { path: 'respondent_name', label: 'Lender' },
    { path: 'action_taken', label: 'Action' },
    { path: 'loan_amount', label: 'Loan $' },
    { path: 'denial_reason', label: 'Denial reason' },
    { path: 'tract', label: 'Census tract' }
  ],
  census_acs: [
    { path: 'tract', label: 'Tract' },
    { path: 'median_income', label: 'Median income' },
    { path: 'homeownership_rate', label: 'Homeownership %' },
    { path: 'population', label: 'Population' }
  ]
};

function fmtVal(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return v.map(fmtVal).join(', ');
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function fmtDate(d: Date | string): string {
  const dt = typeof d === 'string' ? new Date(d) : d;
  if (!(dt instanceof Date) || Number.isNaN(dt.getTime())) return String(d);
  return dt.toLocaleString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit'
  });
}

function StructuredFields({ sourceKind, recordJson }: { sourceKind: string; recordJson: Record<string, unknown> }) {
  const hints = STRUCTURED_HINTS[sourceKind] ?? [];
  if (hints.length === 0) return null;
  const rows = hints
    .map((h) => ({ label: h.label, value: fmtVal(recordJson[h.path]) }))
    .filter((r) => r.value && r.value.length > 0);
  if (rows.length === 0) return null;
  return (
    <dl style={{
      display: 'grid',
      gridTemplateColumns: 'max-content 1fr',
      gap: '4px 14px',
      margin: '8px 0 0',
      fontSize: 13
    }}>
      {rows.map((r, i) => (
        <Row key={i} label={r.label} value={r.value} />
      ))}
    </dl>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  const isUrl = /^https?:\/\//.test(value);
  return (
    <>
      <dt style={{ color: '#94a3b8', fontWeight: 500, whiteSpace: 'nowrap' }}>{label}</dt>
      <dd style={{ margin: 0, color: '#e2e8f0', wordBreak: 'break-word' }}>
        {isUrl
          ? <a href={value} target="_blank" rel="noopener" style={{ color: '#a5b4fc' }}>{value} ↗</a>
          : value}
      </dd>
    </>
  );
}

function SignalChip({ kind, source }: { kind: string; source: string | null }) {
  const copy = SIGNAL_KIND_COPY[kind as keyof typeof SIGNAL_KIND_COPY];
  return (
    <span
      title={source ? `Source: ${source}` : undefined}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        padding: '3px 9px',
        background: 'rgba(168,85,247,0.10)',
        border: '1px solid rgba(168,85,247,0.32)',
        borderRadius: 999,
        fontSize: 11,
        color: '#c084fc',
        fontWeight: 500
      }}
    >
      ✦ {copy?.label ?? kind}
    </span>
  );
}

function CountBadge({ kind, n }: { kind: string; n: number }) {
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'baseline',
      gap: '6px',
      padding: '4px 10px',
      background: 'rgba(56,189,248,0.08)',
      border: '1px solid rgba(56,189,248,0.28)',
      borderRadius: 6,
      fontSize: 12
    }}>
      <strong style={{ color: '#7dd3fc' }}>{n}</strong>
      <span style={{ color: '#94a3b8' }}>{kind}</span>
    </span>
  );
}

export default async function EntityDossierPage({ params }: PageProps) {
  const clientId = Number.parseInt(params.client_id, 10);
  if (!Number.isFinite(clientId) || clientId <= 0) {
    return <div style={{ padding: 24, color: '#fca5a5' }}>Invalid client id.</div>;
  }
  // entity_key arrives URL-encoded — Next.js auto-decodes params.
  const entityKey = decodeURIComponent(params.entity_key);

  const dossier: Dossier = await loadDossierForEntity({
    clientId,
    entityKey,
    maxRecords: 150
  });

  const totalRecords = dossier.records.length;
  const sourceKinds = Object.keys(dossier.countsBySource).sort();

  return (
    <div style={{
      padding: '28px 36px 80px',
      maxWidth: 1180,
      margin: '0 auto',
      color: '#e2e8f0',
      fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif'
    }}>
      {/* Breadcrumb */}
      <div style={{ fontSize: 12, color: '#64748b', marginBottom: 16 }}>
        <Link href={`/admin/av/clients/${clientId}`} style={{ color: '#94a3b8' }}>← Back to client</Link>
        {' · '}
        <Link href={`/admin/av/clients/${clientId}/preview/watchlist`} style={{ color: '#94a3b8' }}>Watchlist</Link>
      </div>

      {/* Header */}
      <header style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 11, color: '#94a3b8', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 6 }}>
          Operator intel · raw payload
        </div>
        <h1 style={{ margin: '0 0 6px', fontSize: 28, fontWeight: 500 }}>
          {dossier.entityLabel || entityKey}
        </h1>
        <div style={{ fontSize: 12, color: '#64748b', fontFamily: 'ui-monospace, monospace' }}>
          {entityKey}
        </div>
      </header>

      {/* Watchlist summary */}
      {dossier.watchlist ? (
        <section style={{
          marginBottom: 28,
          padding: '16px 18px',
          background: 'rgba(15,23,42,0.6)',
          border: '1px solid rgba(148,163,184,0.18)',
          borderRadius: 8
        }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 10, color: '#94a3b8', letterSpacing: '0.12em', textTransform: 'uppercase' }}>Score</div>
              <div style={{ fontSize: 32, fontWeight: 500, fontFamily: 'ui-serif, Georgia, serif' }}>
                {dossier.watchlist.score}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: '#94a3b8', letterSpacing: '0.12em', textTransform: 'uppercase' }}>First seen</div>
              <div style={{ fontSize: 14 }}>{fmtDate(dossier.watchlist.firstSeenAt)}</div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: '#94a3b8', letterSpacing: '0.12em', textTransform: 'uppercase' }}>Last recomputed</div>
              <div style={{ fontSize: 14 }}>{fmtDate(dossier.watchlist.lastRecomputedAt)}</div>
            </div>
            {dossier.watchlist.lastAction && (
              <div>
                <div style={{ fontSize: 10, color: '#94a3b8', letterSpacing: '0.12em', textTransform: 'uppercase' }}>Last action</div>
                <div style={{ fontSize: 14, textTransform: 'capitalize' }}>{dossier.watchlist.lastAction}</div>
              </div>
            )}
          </div>

          {dossier.watchlist.contributingSignals.length > 0 && (
            <>
              <div style={{
                marginTop: 18,
                fontSize: 10,
                color: '#94a3b8',
                letterSpacing: '0.12em',
                textTransform: 'uppercase'
              }}>
                Contributing signals ({dossier.watchlist.contributingSignals.length})
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
                {dossier.watchlist.contributingSignals.map((s, i) => (
                  <SignalChip key={i} kind={s.signalKind} source={s.source} />
                ))}
              </div>
              {/* Why each signal kind matters — plain English, one line each */}
              <div style={{ marginTop: 12, fontSize: 12, color: '#94a3b8' }}>
                {Array.from(new Set(dossier.watchlist.contributingSignals.map((s) => s.signalKind))).map((kind) => {
                  const copy = SIGNAL_KIND_COPY[kind as keyof typeof SIGNAL_KIND_COPY];
                  if (!copy) return null;
                  return (
                    <div key={kind} style={{ padding: '4px 0' }}>
                      <strong style={{ color: '#c084fc' }}>{copy.label}</strong> — {copy.why}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </section>
      ) : (
        <section style={{
          marginBottom: 28,
          padding: '14px 18px',
          background: 'rgba(15,23,42,0.4)',
          border: '1px dashed rgba(148,163,184,0.24)',
          borderRadius: 8,
          fontSize: 13,
          color: '#94a3b8'
        }}>
          No watchlist score on file for this entity in this client&apos;s scope. It may have been
          dismissed, or never scored — records below are what we hold regardless.
        </section>
      )}

      {/* Source-kind count strip */}
      <section style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 10, color: '#94a3b8', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 8 }}>
          What we hold ({totalRecords} record{totalRecords === 1 ? '' : 's'})
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {sourceKinds.length === 0
            ? <span style={{ fontSize: 13, color: '#64748b' }}>Nothing yet — adapters have not surfaced records for this entity.</span>
            : sourceKinds.map((k) => <CountBadge key={k} kind={k} n={dossier.countsBySource[k]} />)}
        </div>
      </section>

      {/* Promoted leads */}
      {dossier.leads.length > 0 && (
        <section style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 10, color: '#94a3b8', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 8 }}>
            In the pipeline
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {dossier.leads.map((l) => (
              <Link
                key={l.leadId}
                href={`/admin/av/leads/${l.leadId}`}
                style={{
                  padding: '10px 14px',
                  background: 'rgba(34,197,94,0.06)',
                  border: '1px solid rgba(34,197,94,0.28)',
                  borderRadius: 6,
                  textDecoration: 'none',
                  color: '#e2e8f0',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 14,
                  flexWrap: 'wrap'
                }}
              >
                <span style={{ fontWeight: 500 }}>{l.company || 'Lead'}</span>
                {l.contactName && <span style={{ color: '#94a3b8', fontSize: 12 }}>{l.contactName}</span>}
                {l.band && <span style={{ color: l.band === 'hot' ? '#fb923c' : '#94a3b8', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{l.band}</span>}
                {l.score !== null && <span style={{ color: '#94a3b8', fontSize: 12 }}>score {l.score}</span>}
                <span style={{ marginLeft: 'auto', color: '#a5b4fc', fontSize: 12 }}>Open lead →</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Records by source kind */}
      <section>
        <h2 style={{ fontSize: 14, fontWeight: 600, color: '#cbd5e1', marginBottom: 12 }}>
          Records on file
        </h2>
        {dossier.records.length === 0 && (
          <div style={{ padding: 20, textAlign: 'center', color: '#64748b', fontSize: 13 }}>
            No public_intel_records found for this entity_key or label inside client {clientId}&apos;s scope.
          </div>
        )}

        {sourceKinds.map((kind) => {
          const inGroup = dossier.records.filter((r) => r.sourceKind === kind);
          return (
            <div key={kind} style={{ marginBottom: 28 }}>
              <h3 style={{
                fontSize: 12,
                fontWeight: 600,
                color: '#7dd3fc',
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                marginBottom: 10
              }}>
                {kind} ({inGroup.length})
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {inGroup.map((r) => (
                  <article
                    key={r.recordId}
                    style={{
                      padding: '14px 16px',
                      background: 'rgba(15,23,42,0.5)',
                      border: '1px solid rgba(148,163,184,0.16)',
                      borderRadius: 6
                    }}
                  >
                    {/* Headline strip */}
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap', marginBottom: 4 }}>
                      <span style={{ fontWeight: 500, color: '#e2e8f0' }}>
                        {r.summaryLabel || `Record #${r.recordId}`}
                      </span>
                      <span style={{ fontSize: 11, color: '#64748b', fontFamily: 'ui-monospace, monospace' }}>
                        {r.entityKey}
                      </span>
                      <span style={{ fontSize: 11, color: '#64748b', marginLeft: 'auto' }}>
                        fetched {fmtDate(r.fetchedAt)}
                      </span>
                    </div>

                    {/* Structured fields for known sources */}
                    <StructuredFields sourceKind={r.sourceKind} recordJson={r.recordJson} />

                    {/* Signals this single record fires */}
                    {r.derivedSignals.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
                        {r.derivedSignals.map((s, i) => (
                          <SignalChip key={i} kind={s.signalKind} source={s.source} />
                        ))}
                      </div>
                    )}

                    {/* Full raw JSON — collapsed by default */}
                    <details style={{ marginTop: 10 }}>
                      <summary style={{
                        cursor: 'pointer',
                        fontSize: 11,
                        color: '#94a3b8',
                        letterSpacing: '0.08em',
                        textTransform: 'uppercase'
                      }}>
                        Raw payload (all fields)
                      </summary>
                      <pre style={{
                        margin: '8px 0 0',
                        padding: 12,
                        background: '#0f172a',
                        border: '1px solid rgba(148,163,184,0.16)',
                        borderRadius: 4,
                        fontSize: 11,
                        lineHeight: 1.5,
                        overflow: 'auto',
                        maxHeight: 360,
                        color: '#cbd5e1',
                        fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace'
                      }}>
                        {JSON.stringify(r.recordJson, null, 2)}
                      </pre>
                    </details>
                  </article>
                ))}
              </div>
            </div>
          );
        })}
      </section>
    </div>
  );
}
