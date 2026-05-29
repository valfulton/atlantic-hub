/**
 * AuditStalePill  (#90)
 *
 * Subtle indicator that surfaces when a lead's audit was generated BEFORE
 * the owning client's brief was last edited. Shown on both /client/leads
 * (so the client knows their audit hasn't caught up) and the operator
 * mirror at /admin/av/clients/[id]/preview/leads.
 *
 * Renders NOTHING when the audit is current — keeps the lead list clean.
 *
 * Generation isn't triggered from here; val uses the existing
 * RefreshIntelPanel on the client page to rebuild stale audits. The
 * `actionable` prop changes the tooltip wording for the operator side
 * ("Refresh from latest intel") vs the client side ("being refreshed").
 */
export default function AuditStalePill({
  stale,
  size = 'sm',
  actionable = false
}: {
  stale: boolean;
  size?: 'xs' | 'sm';
  actionable?: boolean;
}) {
  if (!stale) return null;
  const padClass = size === 'xs' ? 'px-1.5 py-0' : 'px-2 py-0.5';
  const textSize = size === 'xs' ? 'text-[9.5px]' : 'text-[10px]';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full ${padClass} ${textSize} uppercase tracking-[0.14em] font-medium border`}
      style={{
        background: 'rgba(245,158,11,0.12)',
        color: '#fcd34d',
        borderColor: 'rgba(245,158,11,0.35)'
      }}
      title={
        actionable
          ? 'The brief was edited after this audit ran. Click "Refresh AI intel" on the client page to regenerate.'
          : 'The brief was edited after this audit ran — Atlantic & Vine is refreshing it.'
      }
    >
      <span aria-hidden="true">&#9203;</span>
      Audit catching up
    </span>
  );
}
