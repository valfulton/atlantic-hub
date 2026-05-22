'use client';
import { useCallback, useEffect, useState } from 'react';

interface TableProbe {
  ok: boolean;
  n: number | null;
  error?: string;
}
interface SelfTest {
  ok: boolean;
  generatedAt: string;
  env: Record<string, { present: boolean; looksValid?: boolean }>;
  tables: Record<string, TableProbe>;
  signals: Record<string, TableProbe>;
  recentFailures: Array<{ eventType: string; source: string | null; error: string | null; at: string }>;
  failuresOk: boolean;
}

const TABLE_LABELS: Record<string, string> = {
  grok_imagine_assets: 'Commercials (images + videos)',
  lead_brand_kits: 'Per-lead brand kits (logos)',
  operator_logo_library: 'Reusable logo library',
  lead_social_drafts: 'Saved social drafts',
  lead_visual_briefs: 'Visual briefs',
  system_events: 'Event log'
};

const SIGNAL_LABELS: Record<string, string> = {
  leads_with_logo_on_file: 'Leads with a logo uploaded',
  reusable_library_logos: 'Logos saved to your library',
  active_social_drafts: 'Social drafts available to pull',
  commercials_succeeded: 'Commercials finished',
  commercials_in_flight: 'Commercials still rendering',
  commercials_failed: 'Commercials that failed'
};

function Dot({ good }: { good: boolean }) {
  return (
    <span
      aria-hidden
      className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
      style={{ background: good ? '#56B870' : '#FF5A6E' }}
    />
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-surface border border-border rounded-2xl p-5 mb-4">
      <h2 className="text-sm font-semibold text-ink uppercase tracking-[0.12em] mb-3">{title}</h2>
      {children}
    </div>
  );
}

export function SelfTestView() {
  const [data, setData] = useState<SelfTest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/av/selftest', { cache: 'no-store' });
      const j = (await res.json()) as SelfTest & { error?: string };
      if (!res.ok || !j.ok) throw new Error(j.error || `HTTP ${res.status}`);
      setData(j);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void run();
  }, [run]);

  if (loading) return <div className="text-sm text-muted">Running checks...</div>;
  if (error)
    return (
      <div className="rounded-md border border-red-400/40 bg-red-500/10 p-3 text-sm text-red-100">
        Self-test failed to load: {error}
      </div>
    );
  if (!data) return null;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs text-muted">
          Checked {new Date(data.generatedAt).toLocaleString()}
        </p>
        <button
          type="button"
          onClick={() => void run()}
          className="text-xs px-3 py-1 rounded-full border border-border text-muted hover:text-ink hover:border-pink-400"
        >
          Re-run
        </button>
      </div>

      <Card title="API keys">
        <div className="space-y-2">
          {Object.entries(data.env).map(([key, v]) => {
            const good = v.present && v.looksValid !== false;
            return (
              <div key={key} className="flex items-center gap-2 text-sm">
                <Dot good={good} />
                <span className="font-mono text-ink">{key}</span>
                <span className="text-muted ml-auto">
                  {!v.present
                    ? 'not set in Netlify'
                    : v.looksValid === false
                    ? 'set, but wrong prefix -- re-paste the real key'
                    : 'set'}
                </span>
              </div>
            );
          })}
        </div>
        <p className="text-[11px] text-muted/80 mt-3 leading-relaxed">
          XAI powers commercial image / video generation. OPENAI powers the &quot;Pull social content&quot;
          button. Either being red explains why that feature does nothing.
        </p>
      </Card>

      <Card title="Database tables">
        <div className="space-y-2">
          {Object.entries(data.tables).map(([key, probe]) => (
            <div key={key} className="flex items-center gap-2 text-sm">
              <Dot good={probe.ok} />
              <span className="text-ink">{TABLE_LABELS[key] ?? key}</span>
              <span className="font-mono text-[11px] text-muted/70">{key}</span>
              <span className="text-muted ml-auto">
                {probe.ok ? `${probe.n} rows` : 'table missing -- apply the schema'}
              </span>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-muted/80 mt-3 leading-relaxed">
          A missing table means that schema file was never run in phpMyAdmin against shhdbite_AV.
        </p>
      </Card>

      <Card title="Your data">
        <div className="space-y-2">
          {Object.entries(data.signals).map(([key, probe]) => (
            <div key={key} className="flex items-center gap-2 text-sm">
              <Dot good={probe.ok} />
              <span className="text-ink">{SIGNAL_LABELS[key] ?? key}</span>
              <span className="text-muted ml-auto font-mono">{probe.ok ? probe.n : 'n/a'}</span>
            </div>
          ))}
        </div>
      </Card>

      <Card title="Recent failures">
        {data.recentFailures.length === 0 ? (
          <p className="text-sm text-muted">No failures recorded. Clean run.</p>
        ) : (
          <div className="space-y-2">
            {data.recentFailures.map((f, i) => (
              <div key={i} className="text-xs border border-border rounded-lg p-2.5 bg-bg/40">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-ink">{f.eventType}</span>
                  {f.source && <span className="text-muted/70">via {f.source}</span>}
                  {f.at && (
                    <span className="text-muted/70 ml-auto">{new Date(f.at).toLocaleString()}</span>
                  )}
                </div>
                {f.error && <div className="text-red-300 mt-1 whitespace-pre-wrap break-words">{f.error}</div>}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
