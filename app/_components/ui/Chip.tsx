/**
 * Chip — the ONE status/label primitive. Tones: solid (emerald), dark (black,
 * e.g. "new · filed …"), gold (RESERVED for premium/featured only), quiet
 * (outline). Sentence case — no shouty all-caps. See ui.css.
 */
import type { ReactNode } from 'react';
import './ui.css';

export type ChipTone = 'solid' | 'dark' | 'gold' | 'quiet';

export default function Chip({ tone = 'solid', children }: { tone?: ChipTone; children: ReactNode }) {
  return <span className={`av-chip av-chip--${tone}`}>{children}</span>;
}
