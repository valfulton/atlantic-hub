/**
 * lib/ui/celebrate.ts
 *
 * Champagne-pop celebration for a real WIN — e.g. a post going LIVE from the
 * Campaign Timeline. Reuses canvas-confetti (same dep + visual language as
 * components/HotLeadConfetti.tsx) but as a fire-on-event helper (NOT daily-gated):
 * a go-live is worth celebrating every time it happens.
 *
 * Anti-pattern guard: only call this on a confirmed real outcome (publish
 * succeeded), never on opening a screen or on a draft/save. Gold "champagne"
 * palette to match the brand, with an upward fizz + a brief toast.
 */
import confetti from 'canvas-confetti';

const CHAMPAGNE = ['#FFC73D', '#FF9C5B', '#FDE68A', '#FBBF24', '#FFF7E6'];

export function celebrateGoLive(label?: string): void {
  if (typeof window === 'undefined') return;

  const base = {
    particleCount: 60, spread: 62, startVelocity: 52, ticks: 200,
    gravity: 0.9, decay: 0.92, scalar: 0.95, colors: CHAMPAGNE
  };
  // Two rising bursts from the bottom corners…
  confetti({ ...base, origin: { x: 0.2, y: 0.95 }, angle: 70 });
  window.setTimeout(() => confetti({ ...base, origin: { x: 0.8, y: 0.95 }, angle: 110 }), 180);
  // …and a fine "champagne" fizz up the centre.
  window.setTimeout(
    () => confetti({ particleCount: 40, spread: 100, startVelocity: 42, ticks: 170, gravity: 0.8, decay: 0.9, scalar: 0.7, colors: CHAMPAGNE, origin: { x: 0.5, y: 1 } }),
    110
  );

  showGoLiveToast(label);
}

function showGoLiveToast(label?: string): void {
  if (typeof document === 'undefined') return;
  const el = document.createElement('div');
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  el.style.cssText = [
    'position:fixed', 'bottom:32px', 'left:50%',
    'transform:translateX(-50%) translateY(40px)', 'z-index:9999',
    'padding:14px 22px',
    'background:linear-gradient(135deg, rgba(255,199,61,0.20), rgba(255,156,91,0.18))',
    'border:1px solid rgba(255,199,61,0.5)', 'border-radius:14px',
    'color:#f8fafc', 'font-family:inherit', 'font-size:14px', 'font-weight:500',
    'box-shadow:0 12px 48px rgba(0,0,0,0.45), 0 0 24px rgba(255,199,61,0.35)',
    'opacity:0', 'transition:opacity 350ms ease, transform 350ms cubic-bezier(0.22, 1, 0.36, 1)',
    'pointer-events:none', 'white-space:nowrap', 'max-width:90vw'
  ].join(';');
  const safe = label ? (label.length > 48 ? label.slice(0, 45) + '...' : label) : '';
  el.innerHTML = `<span style="font-size:18px;margin-right:8px;">&#127870;</span><strong>Live!</strong>${safe ? `<span style="opacity:0.85;margin-left:6px;">${escapeHtml(safe)} is published.</span>` : '<span style="opacity:0.85;margin-left:6px;">Your post is published.</span>'}`;
  document.body.appendChild(el);
  requestAnimationFrame(() => {
    el.style.opacity = '1';
    el.style.transform = 'translateX(-50%) translateY(0)';
  });
  window.setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateX(-50%) translateY(40px)';
  }, 4200);
  window.setTimeout(() => el.remove(), 4800);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
