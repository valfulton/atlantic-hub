/**
 * Banner — the ONE full-width notice primitive. Tones: info (emerald-mist),
 * gold (reserved emphasis), danger (garnet). See ui.css.
 */
import type { ReactNode } from 'react';
import './ui.css';

export type BannerTone = 'info' | 'gold' | 'danger';

export default function Banner({
  tone = 'info',
  children
}: {
  tone?: BannerTone;
  children: ReactNode;
}) {
  return (
    <div className={`av-banner av-banner--${tone}`} role="status">
      {children}
    </div>
  );
}
