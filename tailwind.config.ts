import type { Config } from 'tailwindcss';

/**
 * Tailwind's default `amber` palette is orange (#f59e0b at 500). val hates
 * the orange. We override the entire amber palette to map to the LOGO GOLD
 * scale (#EBCB6B at 400). Any `bg-amber-400 / text-amber-300 / border-amber-500`
 * class anywhere in the codebase — past, present, future — now reads as gold.
 *
 * Single source of truth: to retune the brand, change these values ONLY.
 * Do NOT bake hex literals into components.
 */
const GOLD_SCALE = {
  50:  '#FBF6E5',
  100: '#F6EBC0',
  200: '#F0DC92',
  300: '#EFD37F',
  400: '#EBCB6B',  // ← logo gold, the canonical brand value
  500: '#D4B354',
  600: '#B59743',
  700: '#8E7634',
  800: '#5F4E22',
  900: '#3A2F15'
} as const;

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: 'var(--brand)',
        'brand-fg': 'var(--brand-fg)',
        ink: 'var(--ink)',
        muted: 'var(--muted)',
        surface: 'var(--surface)',
        'surface-2': 'var(--surface-2)',
        border: 'var(--border)',
        danger: 'var(--danger)',
        ok: 'var(--ok)',
        /* Override Tailwind's amber palette to logo gold. */
        amber: GOLD_SCALE,
        /* Alias `gold-*` to the same scale so new code reads more honestly. */
        gold: GOLD_SCALE
      },
      fontFamily: {
        sans: ['ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif']
      }
    }
  },
  plugins: []
};

export default config;
