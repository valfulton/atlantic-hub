/**
 * ClientLeadNarrativeLinesPanel  (#46 spine Inc 5)
 *
 * Read-only mirror of the operator's LeadNarrativeLines, scoped to the
 * client's view. Surfaces ONLY the lines this lead is currently linked to
 * — never candidates, never overlap reasoning, never link/role/unlink
 * controls. The client sees: "This lead supports your Founder Story line
 * (advances) — 8 leads · 2 qualified · 1 won."
 *
 * This is the moment the spine becomes a product the client experiences,
 * not internal plumbing. Per feedback_client_simplicity: hide all the
 * machinery, show only facts that build confidence.
 *
 * Server component — no client-side fetching needed. Hides entirely when
 * the lead has no linked lines yet so it adds zero day-one visual weight.
 */
import type { ClientLeadNarrativeLine } from '@/lib/client/lead_detail';

function outcomesStrip(o: ClientLeadNarrativeLine['outcomes']): string {
  if (o.leadsLinked === 0) return '';
  const parts: string[] = [`${o.leadsLinked} lead${o.leadsLinked === 1 ? '' : 's'}`];
  if (o.qualified > 0) parts.push(`${o.qualified} qualified`);
  if (o.converted > 0) parts.push(`${o.converted} won`);
  if (o.lost > 0 && o.converted === 0 && o.qualified === 0) parts.push(`${o.lost} lost`);
  return parts.join(' · ');
}

const ROLE_COPY: Record<ClientLeadNarrativeLine['role'], { label: string; fg: string }> = {
  // Friendlier copy than the operator-side "advances/reinforces/tests" verbs;
  // the client doesn't need our internal taxonomy, they need a feeling.
  advances: { label: 'main story', fg: '#86efac' },
  reinforces: { label: 'reinforces', fg: '#fde68a' },
  tests: { label: 'testing angle', fg: '#c4b5fd' }
};

export function ClientLeadNarrativeLinesPanel({ lines }: { lines: ClientLeadNarrativeLine[] }) {
  if (!lines || lines.length === 0) return null;

  return (
    <section className="rounded-2xl border border-border bg-black/20 p-4">
      <div className="text-[10px] uppercase tracking-[0.14em] text-brand mb-2">
        Story this lead supports
      </div>
      <ul className="flex flex-col gap-2">
        {lines.map((line) => {
          const role = ROLE_COPY[line.role];
          const strip = outcomesStrip(line.outcomes);
          const stripColor =
            line.outcomes.converted > 0 ? '#86efac'
            : line.outcomes.qualified > 0 ? '#fde68a'
            : 'rgba(255,255,255,0.55)';
          return (
            <li key={line.lineId} className="flex flex-col gap-1">
              <div className="flex items-baseline gap-2 flex-wrap">
                <span className="text-sm font-medium text-ink">{line.name}</span>
                <span className="text-[10px] uppercase tracking-wide" style={{ color: role.fg }}>
                  · {role.label}
                </span>
              </div>
              {line.thesis && (
                <p className="text-[12px] text-muted leading-snug line-clamp-2">{line.thesis}</p>
              )}
              {strip && (
                <p
                  className="text-[11px]"
                  style={{ color: stripColor }}
                  title="Outcomes across all leads in this story"
                >
                  📈 {strip}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
