/**
 * ItineraryPanel — luxury_hospitality engagement (#550 v2).
 *
 * Renders the next 3 stops as horizontal cards: port · countdown · local
 * press outlets pre-listed. Pure read of parsed brief.itinerary; no DB.
 *
 * Empty state: deep-link to /admin/av/brief so val knows where to add the
 * itinerary JSON (or hand-typed lines — the parser accepts both).
 */
import type { ItineraryStop } from '@/lib/client/itinerary';
import { daysToArrival } from '@/lib/client/itinerary';

function formatCountdown(stop: ItineraryStop): string {
  const d = daysToArrival(stop);
  if (d == null) return 'date TBD';
  if (d < 0) return `${Math.abs(d)}d ago — in port`;
  if (d === 0) return 'arriving today';
  if (d === 1) return 'arriving tomorrow';
  return `arriving in ${d}d`;
}

function formatDates(stop: ItineraryStop): string {
  if (!stop.arrival && !stop.departure) return '';
  const fmt = (s: string | null) => {
    if (!s) return '?';
    const t = Date.parse(s);
    if (!Number.isFinite(t)) return s;
    const d = new Date(t);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  };
  if (stop.arrival && stop.departure) return `${fmt(stop.arrival)} → ${fmt(stop.departure)}`;
  if (stop.arrival) return `from ${fmt(stop.arrival)}`;
  return `until ${fmt(stop.departure)}`;
}

export default function ItineraryPanel({ stops }: { stops: ItineraryStop[] }) {
  return (
    <>
      <div className="app-sh">
        <h3>Itinerary</h3>
        {stops.length > 0 ? (
          <span className="ct">{stops.length} stops ahead</span>
        ) : null}
      </div>

      {stops.length === 0 ? (
        <div className="app-wire">
          <span className="eb">— The next chapter —</span>
          <p>
            Add your itinerary in the brief — each port becomes a chapter we can
            tell, with local press lined up in advance. Format: a JSON array of
            stops, or plain lines like “Cap d&apos;Antibes — 2026-07-12 → 2026-07-19”.
          </p>
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${Math.min(stops.length, 3)}, minmax(0, 1fr))`,
            gap: 12
          }}
        >
          {stops.map((stop, i) => (
            <div
              key={`${stop.port}-${stop.arrival ?? i}`}
              style={{
                background: 'var(--paper, #FFFDF5)',
                border: '0.5px solid var(--card-border, rgba(10,10,10,0.10))',
                borderRadius: 12,
                padding: '14px 16px',
                display: 'flex',
                flexDirection: 'column',
                gap: 8
              }}
            >
              <div
                style={{
                  fontSize: 10,
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                  color: 'var(--gold-ink, #7A5A18)'
                }}
              >
                Stop {i + 1}
              </div>
              <div
                style={{
                  fontFamily: 'var(--serif, Fraunces, Cormorant Garamond, serif)',
                  fontSize: 18,
                  fontWeight: 500,
                  color: 'var(--ink, #0A0A0A)',
                  lineHeight: 1.2
                }}
              >
                {stop.port}
              </div>
              <div style={{ fontSize: 12, color: 'var(--ink-soft, #5F5E5A)' }}>
                {formatCountdown(stop)}
                {formatDates(stop) ? ` · ${formatDates(stop)}` : ''}
              </div>
              {stop.localPressOutlets.length > 0 ? (
                <div
                  style={{
                    marginTop: 4,
                    paddingTop: 8,
                    borderTop: '0.5px solid var(--card-border, rgba(10,10,10,0.06))'
                  }}
                >
                  <div
                    style={{
                      fontSize: 10,
                      textTransform: 'uppercase',
                      letterSpacing: '0.06em',
                      color: 'var(--ink-soft, #5F5E5A)',
                      marginBottom: 4
                    }}
                  >
                    Press waiting
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {stop.localPressOutlets.slice(0, 4).map((o) => (
                      <span
                        key={o}
                        style={{
                          fontSize: 11,
                          padding: '2px 8px',
                          borderRadius: 6,
                          background: 'var(--gold-soft, #FAEEDA)',
                          color: 'var(--gold-ink, #633806)'
                        }}
                      >
                        {o}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
              {stop.notes ? (
                <div
                  style={{
                    fontSize: 11,
                    fontStyle: 'italic',
                    color: 'var(--ink-soft, #5F5E5A)',
                    marginTop: 4
                  }}
                >
                  {stop.notes}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
