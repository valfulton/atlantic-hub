/**
 * ClientLeadCardV3  (#401, val 2026-06-03, per VR V3 leads spec)
 *
 * The V3 client lead card. Used by BOTH /client/leads (live) and
 * /admin/av/clients/[id]/preview/leads (operator mirror). Single source
 * of truth so the two surfaces cannot drift.
 *
 * Register: navy + cream + logo-gold (sparingly). Cormorant company
 * name + score, Inter chrome, ghost gold link, no colored band fills.
 * Per VR's brief: band collapsed to ONE muted small-caps word (gold
 * only when Hot), no rose/blue/amber pills, no rose "Avoid" tint,
 * dead-site as muted "No working website" (no rose dot).
 *
 * The `effectiveBand` demotion (HOT + poor ICP fit → "Mixed signal")
 * is preserved — it's real product truth, just rendered quiet.
 */
import type { ClientLead } from '@/lib/client/leads';
import ClientLeadReject from '@/app/client/_components/ClientLeadReject';

function effectiveBand(
  band: 'hot' | 'warm' | 'cool' | null,
  icpFitScore: number | null
): 'hot' | 'warm' | 'cool' | 'mixed' | null {
  if (!band) return null;
  if ((band === 'hot' || band === 'warm') && icpFitScore != null && icpFitScore < 40) {
    return 'mixed';
  }
  return band;
}

const BAND_WORD: Record<'hot' | 'warm' | 'cool' | 'mixed', string> = {
  hot: 'Hot',
  warm: 'Warm',
  cool: 'Cool',
  mixed: 'Mixed signal'
};

export interface ClientLeadCardV3Props {
  lead: ClientLead;
  /** Where the company-name link points. Live page → /client/leads/:auditId,
   *  operator preview → /admin/av/clients/:cid/preview/leads/:auditId. */
  leadHref: string;
  /** Read-only mode (operator preview) hides the Reject control. */
  preview?: boolean;
}

export default function ClientLeadCardV3({ lead, leadHref, preview }: ClientLeadCardV3Props) {
  const l = lead;
  const displayBand = effectiveBand(l.band, l.icpFitScore);
  const bandLabel = displayBand ? BAND_WORD[displayBand] : null;
  const bandIsHot = displayBand === 'hot';
  const icpGood = l.icpFitScore != null && l.icpFitScore >= 60;
  const icpPoor = l.icpFitScore != null && l.icpFitScore < 40;
  const hasWorkingSite = l.website && l.websiteStatus !== 'placeholder' && l.websiteStatus !== 'dead';
  const hasDeadSite = l.website && (l.websiteStatus === 'placeholder' || l.websiteStatus === 'dead');

  return (
    <article className="v3-card" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      {/* Head row: company + score */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '14px' }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          {l.auditId ? (
            <a href={leadHref} className="v3-card__h" style={{ textDecoration: 'none', display: 'block' }}>
              {l.company}
            </a>
          ) : (
            <h3 className="v3-card__h" style={{ margin: 0 }}>{l.company}</h3>
          )}
          {l.industry && !['other', 'unknown', 'n/a', 'none'].includes(l.industry.trim().toLowerCase()) && (
            <div style={{
              fontFamily: 'var(--sans)',
              fontSize: '10.5px',
              letterSpacing: '.16em',
              textTransform: 'uppercase',
              color: 'var(--cream-muted)',
              marginTop: '4px'
            }}>
              {l.industry}
            </div>
          )}
        </div>
        {l.score !== null && (
          <div style={{
            fontFamily: 'var(--serif)',
            fontSize: '28px',
            fontWeight: 500,
            color: 'var(--cream)',
            fontVariantNumeric: 'tabular-nums',
            lineHeight: 1,
            flexShrink: 0
          }}>
            {Math.round(l.score)}
          </div>
        )}
      </div>

      {/* Band word + fit + audit-stale — one quiet row, no fills */}
      {(bandLabel || l.icpFitScore != null || l.auditStale) && (
        <div style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: '12px',
          fontSize: '11px',
          letterSpacing: '.14em',
          textTransform: 'uppercase'
        }}>
          {bandLabel && (
            <span style={{
              color: bandIsHot ? 'var(--amber)' : 'var(--cream-muted)',
              fontWeight: 500
            }}>
              {bandLabel}
            </span>
          )}
          {l.icpFitScore != null && (
            <span style={{
              color: icpGood ? 'var(--amber)' : icpPoor ? 'var(--cream-muted)' : 'var(--cream-muted)',
              border: `1px solid ${icpGood ? 'var(--amber)' : 'var(--rule)'}`,
              padding: '3px 9px',
              borderRadius: '999px',
              fontWeight: 500
            }}>
              {Math.round(l.icpFitScore)} fit
            </span>
          )}
          {l.auditStale && (
            <span style={{
              color: 'var(--amber-deep)',
              border: '1px solid var(--amber-deep)',
              padding: '3px 9px',
              borderRadius: '999px',
              fontWeight: 500
            }}>
              Audit out of date
            </span>
          )}
        </div>
      )}

      {l.icpFitReasoning && (
        <p style={{
          margin: 0,
          fontFamily: 'var(--serif)',
          fontStyle: 'italic',
          color: 'var(--cream-muted)',
          fontSize: '14px',
          lineHeight: 1.5
        }}>
          {l.icpFitReasoning}
        </p>
      )}

      {/* Pain summary */}
      {l.painSummary && (
        <p className="v3-card__p" style={{ margin: 0 }}>
          {l.painSummary}
        </p>
      )}

      {/* Call script — quiet sub-block on navy-elev */}
      {l.callScript && (l.callScript.openers.length > 0 || l.callScript.avoid.length > 0) && (
        <div style={{
          border: '1px solid var(--rule)',
          background: 'var(--navy-elev)',
          borderRadius: '10px',
          padding: '14px 16px'
        }}>
          <div style={{
            fontFamily: 'var(--sans)',
            fontSize: '10.5px',
            letterSpacing: '.18em',
            textTransform: 'uppercase',
            color: 'var(--amber-deep)',
            marginBottom: '10px'
          }}>
            What to say on the call
          </div>
          {l.callScript.primaryPain && (
            <p style={{
              margin: '0 0 10px',
              color: 'var(--cream)',
              opacity: 0.86,
              fontSize: '13.5px',
              lineHeight: 1.55
            }}>
              {l.callScript.primaryPain}
            </p>
          )}
          {l.callScript.openers.length > 0 && (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {l.callScript.openers.slice(0, 3).map((o, i) => (
                <li key={i} style={{
                  fontFamily: 'var(--serif)',
                  fontStyle: 'italic',
                  color: 'var(--cream)',
                  fontSize: '15px',
                  lineHeight: 1.5
                }}>
                  &ldquo;{o}&rdquo;
                </li>
              ))}
            </ul>
          )}
          {l.callScript.avoid.length > 0 && (
            <div style={{
              marginTop: '10px',
              fontSize: '12px',
              color: 'var(--cream-muted)'
            }}>
              <span style={{ color: 'var(--cream-muted)', opacity: 0.85, textTransform: 'uppercase', letterSpacing: '.12em', fontSize: '10.5px', marginRight: '8px' }}>
                Avoid
              </span>
              {l.callScript.avoid.join('; ')}
            </div>
          )}
        </div>
      )}

      {/* Contact line — Inter 12px, muted labels + cream values */}
      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '6px 16px',
        fontFamily: 'var(--sans)',
        fontSize: '12px',
        color: 'var(--cream)',
        paddingTop: '12px',
        borderTop: '1px solid var(--rule)'
      }}>
        {l.contactName && (
          <span>
            <span style={{ color: 'var(--cream-muted)' }}>Contact</span>{' '}
            {l.contactName}
            {l.contactTitle && <span style={{ color: 'var(--cream-muted)' }}> · {l.contactTitle}</span>}
          </span>
        )}
        {l.email && (
          <span>
            <span style={{ color: 'var(--cream-muted)' }}>Email</span> {l.email}
          </span>
        )}
        {l.phone && (
          <span>
            <span style={{ color: 'var(--cream-muted)' }}>Phone</span> {l.phone}
          </span>
        )}
        {(l.addressStreet || l.addressCity) && (
          <span>
            <span style={{ color: 'var(--cream-muted)' }}>Address</span>{' '}
            {[l.addressStreet, l.addressCity, l.addressState, l.addressPostal].filter(Boolean).join(', ')}
          </span>
        )}
        {hasWorkingSite && (
          <a href={l.website ?? '#'} target="_blank" rel="noopener" className="v3-link" style={{ borderBottom: 0 }}>
            Website →
          </a>
        )}
        {hasDeadSite && (
          <span style={{ color: 'var(--cream-muted)' }} title={l.website ?? undefined}>
            No working website
          </span>
        )}
      </div>

      {/* Foot row: primary "Open lead →" + quiet Reject */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '14px',
        flexWrap: 'wrap',
        marginTop: '4px'
      }}>
        {l.auditId && (
          <a href={leadHref} className="v3-link">Open lead →</a>
        )}
        {!preview && (
          <span style={{ marginLeft: 'auto' }}>
            <ClientLeadReject leadId={l.id} />
          </span>
        )}
      </div>
    </article>
  );
}
