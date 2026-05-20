'use client';
/**
 * Imperative confetti moment for when a lead transitions to converted.
 * Different from HotLeadConfetti (which fires once-per-day on hot-lead
 * arrival) -- this fires per CONVERSION, no daily gate. Sales teams
 * earn the celebration each time.
 *
 * Not gated by once_per_day because closing a deal is the kind of event
 * that should celebrate every time. Operator can flag a real abuse case
 * later if it ever feels excessive.
 */

import confetti from 'canvas-confetti';

export function celebrateConversion(companyName: string | undefined): void {
  // Bigger, longer burst than the daily hot-lead one. Two staggered
  // origins, more particles, mixed colors.
  const baseOpts = {
    particleCount: 110,
    spread: 75,
    startVelocity: 60,
    ticks: 280,
    gravity: 0.9,
    decay: 0.93,
    scalar: 1.05,
    colors: ['#f59e0b', '#f43f5e', '#10b981', '#a78bfa', '#22d3ee', '#fbbf24']
  };
  confetti({ ...baseOpts, origin: { x: 0.15, y: 0.9 }, angle: 65 });
  window.setTimeout(() => {
    confetti({ ...baseOpts, origin: { x: 0.85, y: 0.9 }, angle: 115 });
  }, 180);
  window.setTimeout(() => {
    confetti({ ...baseOpts, particleCount: 60, origin: { x: 0.5, y: 0.85 }, angle: 90, spread: 90 });
  }, 380);

  if (companyName) showConvertedToast(companyName);
}

function showConvertedToast(company: string): void {
  if (typeof document === 'undefined') return;
  const el = document.createElement('div');
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  el.style.cssText = [
    'position:fixed',
    'top:32px',
    'left:50%',
    'transform:translateX(-50%) translateY(-40px)',
    'z-index:9999',
    'padding:16px 26px',
    'background:linear-gradient(135deg, rgba(16,185,129,0.22), rgba(245,158,11,0.18))',
    'border:1px solid rgba(16,185,129,0.55)',
    'border-radius:16px',
    'color:#f8fafc',
    'font-family:inherit',
    'font-size:15px',
    'font-weight:600',
    'box-shadow:0 14px 60px rgba(0,0,0,0.55), 0 0 30px rgba(16,185,129,0.45)',
    'opacity:0',
    'transition:opacity 380ms ease, transform 380ms cubic-bezier(0.22, 1, 0.36, 1)',
    'pointer-events:none',
    'white-space:nowrap',
    'max-width:90vw'
  ].join(';');

  const safe = company.length > 56 ? company.slice(0, 53) + '...' : company;
  el.innerHTML = `
    <span style="font-size:20px;margin-right:8px;">🎉</span>
    <strong>${escapeHtml(safe)}</strong>
    <span style="opacity:0.85;margin-left:6px;font-weight:500;">converted. Nice work.</span>
  `;
  document.body.appendChild(el);
  requestAnimationFrame(() => {
    el.style.opacity = '1';
    el.style.transform = 'translateX(-50%) translateY(0)';
  });
  window.setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateX(-50%) translateY(-40px)';
  }, 4800);
  window.setTimeout(() => el.remove(), 5400);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
