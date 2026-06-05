/**
 * ProspectIntelPanel  (#253)
 *
 * Single source of truth for the "About this prospect" panel that appears on
 * BOTH the operator lead detail page AND the client lead detail page. Used
 * to live inline inside ClientLeadDetailTabs; promoted to a shared component
 * so the two surfaces can never drift — fix here, both update.
 *
 * Renders nothing when intel is null or every field came back empty (the
 * extractor already collapses to null in that case, so the only thing the
 * caller needs to do is short-circuit when intel === null).
 *
 * Server component — no hooks, no client interactivity. The data is
 * read-only; an edit affordance is a separate surface (the per-lead intake
 * editor, the next #253 increment).
 */
import type { ProspectIntel } from '@/lib/client/lead_detail';

interface Row {
  key: keyof ProspectIntel;
  label: string;
  /** Optional dim suffix for the row (e.g. "match this in outreach"). */
  hint?: string;
  /** When true, wrap the value in quotes + italics — slogans read better that way. */
  quoted?: boolean;
}

const ROWS: Row[] = [
  { key: 'businessDescription', label: 'What they do' },
  { key: 'slogan',              label: 'Their tagline',         quoted: true },
  { key: 'targetAudience',      label: 'Who they sell to' },
  { key: 'keyMessage',          label: 'Their key message' },
  { key: 'differentiators',     label: 'What sets them apart' },
  { key: 'notableClients',      label: 'Names they drop' },
  { key: 'pressAwards',         label: 'Press / awards' },
  { key: 'founderStory',        label: 'Founder angle' },
  { key: 'brandVoice',          label: 'Their voice',           hint: 'match this when you reach out' }
];

export function ProspectIntelPanel({ intel }: { intel: ProspectIntel | null }) {
  if (!intel) return null;
  // Filter to populated rows ONCE so we can short-circuit the whole panel
  // when nothing's there. The extractor SHOULD have caught this but defending
  // belt + suspenders since both server paths might evolve independently.
  const populated = ROWS.filter((r) => {
    const v = intel[r.key];
    return typeof v === 'string' && v.trim().length > 0;
  });
  if (populated.length === 0) return null;

  return (
    <div className="rounded-2xl border border-[color-mix(in_srgb,var(--gold-bright)_20%,transparent)] bg-[var(--gold-bright)]/[0.03] p-4">
      <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
        <div className="text-[10px] uppercase tracking-[0.14em] text-[var(--gold-bright)]">
          About this prospect
        </div>
        <div className="text-[10px] text-muted">From their website</div>
      </div>
      <ul className="space-y-2">
        {populated.map((r) => {
          const value = intel[r.key] as string;
          return (
            <li key={r.key} className="text-sm leading-relaxed">
              <span className="text-muted text-[11px] uppercase tracking-wider mr-2">{r.label}</span>
              {r.quoted ? (
                <span className="text-ink italic">&ldquo;{value}&rdquo;</span>
              ) : (
                <span className="text-ink">{value}</span>
              )}
              {r.hint && (
                <span className="text-[10.5px] text-muted ml-2">({r.hint})</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
