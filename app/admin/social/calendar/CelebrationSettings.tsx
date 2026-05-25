'use client';

/**
 * CelebrationSettings — operator-only control for the calendar's pop-wow
 * celebrations. Pick intensity (off / subtle / normal / extra) — persisted in
 * localStorage — and a Test button to preview. Backend-only; clients never see it.
 */
import { useEffect, useState } from 'react';
import { celebrate, getCelebrationIntensity, setCelebrationIntensity, type CelebrationIntensity } from '@/lib/ui/celebrate';

const LEVELS: { value: CelebrationIntensity; label: string }[] = [
  { value: 'off', label: 'Off' },
  { value: 'subtle', label: 'Subtle' },
  { value: 'normal', label: 'Normal' },
  { value: 'extra', label: 'EXTRA 🎉' }
];

export function CelebrationSettings() {
  const [intensity, setIntensity] = useState<CelebrationIntensity>('normal');

  // Read the persisted value after mount (avoids SSR/hydration mismatch).
  useEffect(() => { setIntensity(getCelebrationIntensity()); }, []);

  function choose(v: CelebrationIntensity) {
    setIntensity(v);
    setCelebrationIntensity(v);
    if (v !== 'off') celebrate('Pop-wow set to ' + v, { force: v });
  }

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
      <span className="text-[11px] uppercase tracking-[0.12em] text-muted">Celebrations</span>
      <div className="inline-flex rounded-lg border border-border overflow-hidden">
        {LEVELS.map((l) => (
          <button
            key={l.value}
            onClick={() => choose(l.value)}
            className={
              'px-2.5 py-1 transition ' +
              (intensity === l.value ? 'bg-brand text-brand-fg font-medium' : 'bg-black/20 text-muted hover:text-ink')
            }
          >
            {l.label}
          </button>
        ))}
      </div>
      <button
        onClick={() => celebrate('Test', { force: intensity === 'off' ? 'extra' : intensity })}
        className="px-2.5 py-1 rounded-lg border border-border bg-black/20 text-muted hover:text-ink"
        title="Preview"
      >
        Test 🎉
      </button>
    </div>
  );
}
