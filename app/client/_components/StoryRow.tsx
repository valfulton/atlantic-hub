// app/client/_components/StoryRow.tsx  (V3 social skin)
// Stories row repurposed as the multi-brand BRAND SWITCHER (not vanity content).
// Tapping a brand swaps brand context (client_id scope) for the whole client view.
// For single-brand clients, render nothing (or just the active ring, no switching).
'use client';

export type BrandStory = {
  id: string;          // client_id / brand scope
  label: string;       // "CBB", "CLDA"
  monogram?: string;   // shown in the ring
  logoUrl?: string;
};

export interface StoryRowProps {
  brands: BrandStory[];
  activeId: string;
  onSwitch: (id: string) => void;
  onAddBrand?: () => void;   // owner-only
}

export default function StoryRow({ brands, activeId, onSwitch, onAddBrand }: StoryRowProps) {
  if (brands.length <= 1 && !onAddBrand) return null;
  return (
    <nav className="brands" aria-label="Switch brand">
      {brands.map((b) => (
        <button key={b.id} type="button" className={`brand ${b.id === activeId ? 'on' : ''}`} onClick={() => onSwitch(b.id)}>
          <span className="brand__ring">
            <span className="brand__pic" style={b.logoUrl ? { backgroundImage: `url(${b.logoUrl})` } : undefined}>
              {!b.logoUrl && (b.monogram ?? b.label.slice(0, 3))}
            </span>
          </span>
          <span className="brand__lbl">{b.label}</span>
        </button>
      ))}
      {onAddBrand && (
        <button type="button" className="brand brand--add" onClick={onAddBrand}>
          <span className="brand__ring"><span className="brand__pic">+</span></span>
          <span className="brand__lbl">Add brand</span>
        </button>
      )}
    </nav>
  );
}
