'use client';
/**
 * QuickActionsRibbon — the mobile-only sticky action row at the top of a
 * cockpit page (val 2026-06-07). Tapping a button scrolls to its panel AND
 * auto-expands it (fires `macc-open` for the matching MobileAccordion id).
 * Hidden on desktop (all panels are visible there anyway).
 *
 *   <QuickActionsRibbon actions={[
 *     { label: 'Send access', icon: '🔑', targetId: 'send-access', primary: true },
 *     { label: 'Edit ICP',    icon: '✎',  targetId: 'edit-icp' },
 *     { label: 'New lead',    icon: '+',  targetId: 'new-lead' },
 *   ]} />
 */
import './macc.css';

interface Action {
  label: string;
  icon?: string;
  /** id of the MobileAccordion to scroll to + open. */
  targetId: string;
  primary?: boolean;
}

export default function QuickActionsRibbon({ actions }: { actions: Action[] }) {
  function go(id: string) {
    window.dispatchEvent(new CustomEvent('macc-open', { detail: id }));
    // Fallback scroll for non-accordion targets.
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  return (
    <div className="qa-ribbon" role="toolbar" aria-label="Quick actions">
      {actions.map((a) => (
        <button
          key={a.targetId}
          type="button"
          className={`qa-btn${a.primary ? ' qa-btn--primary' : ''}`}
          onClick={() => go(a.targetId)}
        >
          {a.icon && <span aria-hidden="true">{a.icon}</span>}
          {a.label}
        </button>
      ))}
    </div>
  );
}
