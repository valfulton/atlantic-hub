/**
 * lib/ui/celebrate.ts
 *
 * Operator-only celebration engine. Fires confetti/champagne pop-wows on real
 * wins (publishing, scheduling, converting a lead, etc.) with an operator-tunable
 * INTENSITY: off / subtle / normal / extra. "extra" is deliberately ridiculous —
 * this is the backend, just for val, to make the grind fun. Intensity is stored
 * in localStorage so it persists per browser; never shown to clients.
 *
 * Reuses canvas-confetti (same dep as components/HotLeadConfetti.tsx). Call only
 * on confirmed outcomes, never on opening a screen.
 */
import confetti from 'canvas-confetti';

const CHAMPAGNE = ['#FFC73D', '#FF9C5B', '#FDE68A', '#FBBF24', '#FFF7E6'];
const FESTIVE = ['#FF5A6E', '#FF9C5B', '#FFC73D', '#34d399', '#60a5fa', '#c084fc'];

export type CelebrationIntensity = 'off' | 'subtle' | 'normal' | 'extra';
const STORAGE_KEY = 'ah_celebrate_intensity';

export function getCelebrationIntensity(): CelebrationIntensity {
  if (typeof window === 'undefined') return 'normal';
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    if (v === 'off' || v === 'subtle' || v === 'normal' || v === 'extra') return v;
  } catch { /* ignore */ }
  return 'normal';
}

export function setCelebrationIntensity(v: CelebrationIntensity): void {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(STORAGE_KEY, v); } catch { /* ignore */ }
}

function burst(originX: number, angle: number, count: number, colors: string[]): void {
  confetti({
    particleCount: count, spread: 62, startVelocity: 52, ticks: 220,
    gravity: 0.9, decay: 0.92, scalar: 0.95, colors,
    origin: { x: originX, y: 0.95 }, angle
  });
}

/** Try to make emoji confetti (champagne + sparkle + party). Best-effort. */
function emojiShapes(): unknown[] {
  try {
    const anyConfetti = confetti as unknown as { shapeFromText?: (o: { text: string; scalar?: number }) => unknown };
    if (typeof anyConfetti.shapeFromText === 'function') {
      return ['🥂', '🎉', '✨'].map((t) => anyConfetti.shapeFromText!({ text: t, scalar: 2.4 }));
    }
  } catch { /* ignore */ }
  return [];
}

/** A sustained, over-the-top storm for 'extra'. */
function extraStorm(): void {
  const end = Date.now() + 1500;
  const shapes = emojiShapes();
  // Big opening blast.
  confetti({ particleCount: 160, spread: 120, startVelocity: 55, ticks: 260, gravity: 0.9, decay: 0.92, scalar: 1.1, colors: FESTIVE, origin: { x: 0.5, y: 0.6 } });
  if (shapes.length) {
    confetti({ particleCount: 24, spread: 110, startVelocity: 45, ticks: 260, scalar: 2.2, colors: CHAMPAGNE, shapes: shapes as never[], origin: { x: 0.5, y: 0.5 } });
  }
  const tick = () => {
    burst(0.12, 64, 28, FESTIVE);
    burst(0.88, 116, 28, FESTIVE);
    if (Date.now() < end) window.setTimeout(tick, 180);
  };
  tick();
}

/**
 * Fire a celebration scaled to the operator's chosen intensity. Pass a label for
 * the toast (e.g. the thing that just went live). opts.force overrides intensity.
 */
export function celebrate(label?: string, opts?: { force?: CelebrationIntensity }): void {
  if (typeof window === 'undefined') return;
  const intensity = opts?.force ?? getCelebrationIntensity();
  if (intensity === 'off') return;

  if (intensity === 'subtle') {
    burst(0.5, 90, 26, CHAMPAGNE);
  } else if (intensity === 'extra') {
    extraStorm();
  } else {
    // normal: two rising corner bursts + a centre champagne fizz.
    burst(0.2, 70, 60, CHAMPAGNE);
    window.setTimeout(() => burst(0.8, 110, 60, CHAMPAGNE), 180);
    window.setTimeout(
      () => confetti({ particleCount: 40, spread: 100, startVelocity: 42, ticks: 170, gravity: 0.8, decay: 0.9, scalar: 0.7, colors: CHAMPAGNE, origin: { x: 0.5, y: 1 } }),
      110
    );
  }

  showToast(label, intensity);
}

/** Back-compat: existing call sites celebrate a real go-live. */
export function celebrateGoLive(label?: string): void {
  celebrate(label);
}

function showToast(label: string | undefined, intensity: CelebrationIntensity): void {
  if (typeof document === 'undefined') return;
  const big = intensity === 'extra';
  const el = document.createElement('div');
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  el.style.cssText = [
    'position:fixed', 'bottom:32px', 'left:50%',
    'transform:translateX(-50%) translateY(40px)', 'z-index:9999',
    big ? 'padding:18px 28px' : 'padding:14px 22px',
    'background:linear-gradient(135deg, rgba(255,199,61,0.20), rgba(255,156,91,0.18))',
    'border:1px solid rgba(255,199,61,0.5)', 'border-radius:14px',
    'color:#f8fafc', 'font-family:inherit', big ? 'font-size:16px' : 'font-size:14px', 'font-weight:500',
    'box-shadow:0 12px 48px rgba(0,0,0,0.45), 0 0 24px rgba(255,199,61,0.35)',
    'opacity:0', 'transition:opacity 350ms ease, transform 350ms cubic-bezier(0.22, 1, 0.36, 1)',
    'pointer-events:none', 'white-space:nowrap', 'max-width:90vw'
  ].join(';');
  const safe = label ? (label.length > 56 ? label.slice(0, 53) + '...' : label) : '';
  const emoji = big ? '&#127881;&#129346;&#10024;' : '&#127870;';
  el.innerHTML = `<span style="font-size:${big ? 22 : 18}px;margin-right:8px;">${emoji}</span><strong>${big ? 'WIN!' : 'Done!'}</strong>${safe ? `<span style="opacity:0.9;margin-left:6px;">${escapeHtml(safe)}</span>` : ''}`;
  document.body.appendChild(el);
  requestAnimationFrame(() => {
    el.style.opacity = '1';
    el.style.transform = 'translateX(-50%) translateY(0)';
  });
  const hold = big ? 5000 : 4200;
  window.setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateX(-50%) translateY(40px)';
  }, hold);
  window.setTimeout(() => el.remove(), hold + 600);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
