/**
 * DistrictHeatMapPanel — political_campaign engagement kind (#550 v2).
 *
 * Renders a simple horizontal-bar view of district distress signals — one bar
 * per (zip, signal_kind) pair, severity dot + count to the right.
 * No external chart library needed; uses CSS only so it streams clean.
 *
 * Empty state: deep-link to /admin/av/brief to add district_zips when missing.
 */
import type { DistrictSignal } from '@/lib/client/district_heatmap';

const KIND_LABEL: Record<string, string> = {
  foreclosure:    'Foreclosure',
  bankruptcy:     'Bankruptcy',
  warn_notice:    'Plant closure (WARN)',
  code_violation: 'Code violation',
  ucc:            'Vendor exposure',
  lien:           'Tax lien',
  recorder:       'Recorder filing',
  court_filing:   'Court filing'
};

const SEVERITY_COLOR: Record<DistrictSignal['severity'], { dot: string; label: string }> = {
  rising: { dot: 'var(--rose-ink, #993556)',    label: 'rising' },
  new:    { dot: 'var(--gold, #C9A961)',        label: 'new'    },
  steady: { dot: 'var(--ink-soft, #5F5E5A)',    label: 'steady' }
};

function kindLabel(k: string): string {
  return KIND_LABEL[k] ?? k.replace(/_/g, ' ');
}

export default function DistrictHeatMapPanel({
  signals,
  hasDistrictConfig
}: {
  signals: DistrictSignal[];
  /** True when the brief contains at least one parseable zip. False = honest setup prompt. */
  hasDistrictConfig: boolean;
}) {
  const maxCount = signals.reduce((m, s) => Math.max(m, s.count), 0) || 1;

  return (
    <>
      <div className="app-sh">
        <h3>District pulse</h3>
        <span className="ct">{hasDistrictConfig ? `${signals.length} active signals` : 'set up'}</span>
      </div>

      {!hasDistrictConfig ? (
        <div className="app-wire">
          <span className="eb">— Your district —</span>
          <p>
            Add your district ZIP codes in the brief and we will surface every
            public-records signal — foreclosures, plant-closure notices, code
            violations — that constituents are living through this week.
          </p>
        </div>
      ) : signals.length === 0 ? (
        <div className="app-wire">
          <span className="eb">— Quiet week —</span>
          <p>
            No active distress signals in your district right now. We will keep
            watching; the moment one fires, it lands here with a date stamp.
          </p>
        </div>
      ) : (
        <div
          style={{
            background: 'var(--paper, #FFFDF5)',
            border: '0.5px solid var(--card-border, rgba(10,10,10,0.10))',
            borderRadius: 12,
            padding: '14px 18px'
          }}
        >
          {signals.map((s, i) => {
            const widthPct = Math.round((s.count / maxCount) * 100);
            const sev = SEVERITY_COLOR[s.severity];
            return (
              <div
                key={`${s.zip}-${s.signalKind}-${i}`}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '64px 1fr auto',
                  gap: 10,
                  alignItems: 'center',
                  padding: '6px 0',
                  borderTop: i === 0 ? 'none' : '0.5px solid var(--card-border, rgba(10,10,10,0.06))'
                }}
              >
                <span style={{ fontSize: 12, color: 'var(--ink-soft, #5F5E5A)' }}>{s.zip}</span>
                <div>
                  <div style={{ fontSize: 12.5, color: 'var(--ink, #0A0A0A)', marginBottom: 4 }}>
                    {kindLabel(s.signalKind)}
                  </div>
                  <div
                    style={{
                      height: 6,
                      background: 'var(--paper-soft, #F7F1E1)',
                      borderRadius: 3,
                      overflow: 'hidden'
                    }}
                  >
                    <div
                      style={{
                        width: `${widthPct}%`,
                        height: '100%',
                        background: sev.dot,
                        opacity: 0.85
                      }}
                    />
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      fontSize: 12,
                      color: 'var(--ink-soft, #5F5E5A)'
                    }}
                  >
                    <span
                      style={{
                        display: 'inline-block',
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        background: sev.dot
                      }}
                    />
                    <span style={{ textTransform: 'uppercase', letterSpacing: '0.06em', fontSize: 10 }}>
                      {sev.label}
                    </span>
                    <span style={{ fontWeight: 500, color: 'var(--ink, #0A0A0A)', marginLeft: 4 }}>
                      {s.count}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
