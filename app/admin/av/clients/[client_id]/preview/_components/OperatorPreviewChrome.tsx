/**
 * OperatorPreviewChrome  (#403, val 2026-06-03)
 *
 * Single source of truth for the operator preview banner + sibling tab
 * strip wrapped around every /admin/av/clients/[id]/preview/* page.
 *
 * Tones: logo gold #EBCB6B (with #C7A64E deep) — NEVER Tailwind amber
 * (which renders orange-yellow). val standing rule: no orange anywhere.
 *
 * Props:
 *   - clientId / clientName: for tab links + banner copy
 *   - active: which sibling tab is highlighted ("dashboard" | "leads" | ...)
 *   - bannerExtra: optional extra link in the banner (Edit creative brief, etc.)
 */
import Link from 'next/link';

const TABS = [
  { id: 'dashboard', label: 'Dashboard', path: '' },
  { id: 'leads', label: 'Leads list', path: '/leads' },
  { id: 'watchlist', label: 'Watchlist', path: '/watchlist' },
  // (#433) Campaigns + Calendar — mirror /client/campaigns and /client/calendar.
  // Per the nav-tab mirror rule, ClientV3TopNav NAV must keep both entries
  // in sync with this TABS array. Edits to either array land together.
  { id: 'campaigns', label: 'Campaigns', path: '/campaigns' },
  { id: 'calendar', label: 'Calendar', path: '/calendar' },
  // (#419) Content Studio mirror — shows generated posts true-to-platform.
  { id: 'content', label: 'Content', path: '/content' },
  { id: 'audit', label: 'Audit', path: '/audit' },
  { id: 'intake', label: 'Intake / brief', path: '/intake' },
  { id: 'pr', label: 'Press queue', path: '/pr' }
] as const;

export type PreviewTab = (typeof TABS)[number]['id'];

export default function OperatorPreviewChrome({
  clientId,
  clientName,
  active,
  bannerLine,
  bannerExtra
}: {
  clientId: number;
  clientName: string;
  active: PreviewTab;
  /** The right side of the banner — e.g. "Read-only" or a 1-line note. */
  bannerLine?: React.ReactNode;
  /** Optional extra link in the banner header (left of "Back to client"). */
  bannerExtra?: React.ReactNode;
}) {
  // Logo-gold inline tones — replaces every Tailwind amber-* usage.
  const goldBorder = 'rgba(235,203,107,0.34)';
  const goldFill = 'rgba(235,203,107,0.08)';
  const goldInk = '#EBCB6B';
  const goldDim = '#C7A64E';

  return (
    <>
      {/* Banner */}
      <div
        className="mb-3 rounded-lg px-4 py-2.5 text-sm flex items-center justify-between gap-3 flex-wrap"
        style={{
          border: `1px solid ${goldBorder}`,
          background: goldFill,
          color: 'var(--cream, #F5EFE3)'
        }}
      >
        <span>
          <span style={{ color: goldInk, fontWeight: 600 }}>Operator preview</span>
          {' '}— what{' '}
          <span style={{ color: goldInk, fontWeight: 600 }}>{clientName}</span>
          {' '}sees here.{' '}
          {bannerLine}
        </span>
        <span className="shrink-0 flex items-center gap-4">
          {bannerExtra}
          <Link
            href={`/admin/av/clients/${clientId}`}
            style={{ color: goldInk, textDecoration: 'none' }}
            className="hover:underline"
          >
            Back to client
          </Link>
        </span>
      </div>

      {/* Sibling tab strip */}
      <div className="mb-4 flex items-center gap-2 text-xs flex-wrap">
        <span
          style={{
            color: goldDim,
            textTransform: 'uppercase',
            letterSpacing: '0.2em',
            fontSize: '10px',
            marginRight: '4px'
          }}
        >
          See what {clientName} sees:
        </span>
        {TABS.map((t) => {
          const href = `/admin/av/clients/${clientId}/preview${t.path}`;
          const on = t.id === active;
          const baseStyle: React.CSSProperties = {
            display: 'inline-flex',
            alignItems: 'center',
            padding: '4px 10px',
            borderRadius: '6px',
            fontSize: '12px',
            border: `1px solid ${on ? goldBorder : 'var(--rule, rgba(255,255,255,.08))'}`,
            background: on ? goldFill : 'transparent',
            color: on ? goldInk : 'var(--cream, #F5EFE3)',
            textDecoration: 'none',
            fontWeight: on ? 600 : 400
          };
          return on ? (
            <span key={t.id} style={baseStyle}>{t.label}</span>
          ) : (
            <Link
              key={t.id}
              href={href}
              style={baseStyle}
              className="hover:[border-color:rgba(235,203,107,0.34)]"
            >
              {t.label}
            </Link>
          );
        })}
      </div>
    </>
  );
}
