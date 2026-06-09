'use client';

/**
 * BrandColorPicker — actionable colors-as-button (#555).
 *
 * Replaces the passive "Brand colors" text input with a clickable swatch-strip
 * that opens an inline editor for: named pairs ("navy + amber"), hex pairs
 * ("#0a1f3d, #d4a253"), or a "guess from my logo" CTA that hits the existing
 * brand-kit extractor endpoint.
 *
 * Value normalization is forgiving — the parser the BriefRevenueTriptych already
 * uses accepts either format, so this picker just round-trips a string.
 */
import { useState } from 'react';

type Props = {
  value: string;
  onChange: (next: string) => void;
  /** Optional logo URL — when present, "Guess from logo" CTA shows. */
  logoUrl?: string | null;
  /** Endpoint that takes { logoUrl } and returns { colors: [hex, hex] }. */
  guessEndpoint?: string;
};

// Compact preset names mapped to display swatches. Same vocabulary the
// BriefRevenueTriptych's parseBrandColors() understands.
const PRESETS: Array<{ label: string; value: string; swatches: [string, string] }> = [
  { label: 'Navy + amber',       value: 'navy + amber',       swatches: ['#0a1f3d', '#d4a253'] },
  { label: 'Emerald + gold',     value: 'emerald + gold',     swatches: ['#0A4D3C', '#EBCB6B'] },
  { label: 'Forest + champagne', value: 'forest + champagne', swatches: ['#0A4D3C', '#EBCB6B'] },
  { label: 'Burgundy + cream',   value: 'burgundy + cream',   swatches: ['#6B1A2C', '#FFFDF5'] },
  { label: 'Garnet + ivory',     value: 'garnet + ivory',     swatches: ['#6B1A2C', '#F7F1E1'] }
];

function extractSwatches(raw: string): [string, string] | null {
  if (!raw) return null;
  const hexes = raw.match(/#([0-9a-f]{6}|[0-9a-f]{3})\b/gi);
  if (hexes && hexes.length >= 2) return [hexes[0], hexes[1]];
  const lower = raw.toLowerCase();
  for (const p of PRESETS) {
    if (lower.includes(p.value.split(' + ')[0]) && lower.includes(p.value.split(' + ')[1])) {
      return p.swatches;
    }
  }
  return null;
}

export default function BrandColorPicker({ value, onChange, logoUrl, guessEndpoint }: Props) {
  const [open, setOpen] = useState(false);
  const [manual, setManual] = useState(value);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const swatches = extractSwatches(value);

  async function guessFromLogo() {
    if (!logoUrl || !guessEndpoint) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(guessEndpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ logoUrl })
      });
      const j = await res.json();
      if (!res.ok || !j.colors) {
        setErr(j.error ?? 'Could not read colors from your logo. Try a preset or paste hex.');
        return;
      }
      const colors = j.colors as string[];
      if (Array.isArray(colors) && colors.length >= 2) {
        const next = `${colors[0]}, ${colors[1]}`;
        onChange(next);
        setManual(next);
      }
    } catch (e) {
      setErr((e as Error).message ?? 'Could not read colors from your logo.');
    } finally {
      setBusy(false);
    }
  }

  function pickPreset(p: typeof PRESETS[number]) {
    onChange(p.value);
    setManual(p.value);
    setOpen(false);
  }

  function saveManual() {
    onChange(manual);
    setOpen(false);
  }

  // ── Collapsed button: shows the current swatches OR a "Set your colors →" CTA
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          width: '100%',
          minHeight: 44,
          background: 'var(--paper, #FFFDF5)',
          border: '0.5px solid var(--card-border, rgba(10,10,10,0.18))',
          borderRadius: 10,
          padding: '10px 14px',
          textAlign: 'left',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          fontFamily: 'inherit'
        }}
      >
        {swatches ? (
          <>
            <span style={{ display: 'inline-flex', gap: 4 }}>
              <span style={{ width: 18, height: 18, borderRadius: 4, background: swatches[0], border: '0.5px solid rgba(0,0,0,0.18)' }} />
              <span style={{ width: 18, height: 18, borderRadius: 4, background: swatches[1], border: '0.5px solid rgba(0,0,0,0.18)' }} />
            </span>
            <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: 'var(--ink, #0A0A0A)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {value}
            </span>
            <span style={{ fontSize: 11, color: 'var(--ink-soft, #5F5E5A)' }}>Edit →</span>
          </>
        ) : (
          <>
            <span
              style={{
                display: 'inline-flex',
                width: 28,
                height: 28,
                borderRadius: 6,
                border: '1px dashed var(--card-border, rgba(10,10,10,0.18))',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--gold-bright, #EBCB6B)',
                fontSize: 14
              }}
            >
              +
            </span>
            <span style={{ flex: 1, fontSize: 13, color: 'var(--ink, #0A0A0A)', fontWeight: 500 }}>
              Set your colors
            </span>
            <span style={{ fontSize: 11, color: 'var(--ink-soft, #5F5E5A)' }}>→</span>
          </>
        )}
      </button>
    );
  }

  // ── Expanded picker
  return (
    <div
      style={{
        background: 'var(--paper, #FFFDF5)',
        border: '0.5px solid var(--card-border, rgba(10,10,10,0.18))',
        borderRadius: 10,
        padding: 14
      }}
    >
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8, marginBottom: 12 }}>
        {PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={() => pickPreset(p)}
            style={{
              background: 'var(--paper-soft, #F7F1E1)',
              border: '0.5px solid var(--card-border, rgba(10,10,10,0.10))',
              borderRadius: 8,
              padding: '8px 10px',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              cursor: 'pointer',
              fontFamily: 'inherit'
            }}
          >
            <span style={{ display: 'inline-flex', gap: 4 }}>
              <span style={{ width: 14, height: 14, borderRadius: 3, background: p.swatches[0], border: '0.5px solid rgba(0,0,0,0.18)' }} />
              <span style={{ width: 14, height: 14, borderRadius: 3, background: p.swatches[1], border: '0.5px solid rgba(0,0,0,0.18)' }} />
            </span>
            <span style={{ fontSize: 12, color: 'var(--ink, #0A0A0A)' }}>{p.label}</span>
          </button>
        ))}
      </div>

      <label style={{ display: 'block', marginBottom: 12 }}>
        <span style={{ display: 'block', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--ink-soft, #5F5E5A)', marginBottom: 4 }}>
          Or paste hex / name your own
        </span>
        <input
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          placeholder='e.g. "#0a1f3d, #d4a253" or "burgundy + cream"'
          style={{
            width: '100%',
            background: 'var(--paper-soft, #F7F1E1)',
            border: '0.5px solid var(--card-border, rgba(10,10,10,0.18))',
            borderRadius: 8,
            padding: '8px 10px',
            fontSize: 13,
            color: 'var(--ink, #0A0A0A)',
            fontFamily: 'inherit'
          }}
        />
      </label>

      {logoUrl && guessEndpoint ? (
        <button
          type="button"
          onClick={guessFromLogo}
          disabled={busy}
          style={{
            background: 'var(--mint-soft, #E1F5EE)',
            color: 'var(--emerald-deep, #085041)',
            border: 'none',
            borderRadius: 8,
            padding: '8px 14px',
            fontSize: 13,
            fontWeight: 500,
            cursor: busy ? 'wait' : 'pointer',
            marginRight: 8
          }}
        >
          {busy ? 'Reading your logo…' : '✨ Guess from my logo'}
        </button>
      ) : null}

      <button
        type="button"
        onClick={saveManual}
        style={{
          background: 'var(--gold-bright, #EBCB6B)',
          color: 'var(--ink, #0A0A0A)',
          border: 'none',
          borderRadius: 8,
          padding: '8px 16px',
          fontSize: 13,
          fontWeight: 500,
          cursor: 'pointer',
          marginRight: 8
        }}
      >
        Save
      </button>
      <button
        type="button"
        onClick={() => setOpen(false)}
        style={{
          background: 'transparent',
          border: '0.5px solid var(--card-border, rgba(10,10,10,0.18))',
          borderRadius: 8,
          padding: '8px 14px',
          fontSize: 13,
          color: 'var(--ink, #0A0A0A)',
          cursor: 'pointer'
        }}
      >
        Cancel
      </button>

      {err ? (
        <div style={{ marginTop: 10, fontSize: 12, color: 'var(--rose-ink, #72243E)' }}>{err}</div>
      ) : null}
    </div>
  );
}
