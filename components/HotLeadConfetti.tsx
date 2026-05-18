'use client';
/**
 * components/HotLeadConfetti.tsx
 *
 * Once-per-day confetti burst when a new HOT lead (ai_score > 85) has
 * landed today. Fires from the bottom of the viewport so it doesn't
 * obscure content. The fired-flag is gated via lib/ui/once_per_day so
 * the operator only sees this once per calendar day, no matter how
 * many times they reload /admin/av.
 *
 * Renders nothing visible -- it's a pure side-effect component.
 *
 * Props:
 *   leadsToday: leads that arrived today (the parent decides "today" --
 *               server-side cutoff, not local).
 *
 * Anti-pattern guard: we don't fire on EVERY visit. We don't celebrate
 * the act of opening the app. We only celebrate a real new outcome
 * (a hot lead arrived). One celebration per day, max.
 */

import { useEffect, useRef } from 'react';
import confetti from 'canvas-confetti';
import { hasFiredToday, markFiredToday } from '@/lib/ui/once_per_day';

interface ConfettiCandidate {
  auditId: string;
  company: string;
  aiScore: number;
}

export function HotLeadConfetti({ candidates }: { candidates: ConfettiCandidate[] }) {
  const firedRef = useRef(false);

  useEffect(() => {
    if (firedRef.current) return;
    if (candidates.length === 0) return;
    if (hasFiredToday('hot_lead_celebration')) return;

    // Pick the single hottest candidate to base the daily celebration on.
    const top = candidates.reduce((best, c) => (c.aiScore > best.aiScore ? c : best), candidates[0]);
    if (top.aiScore < 86) return;

    firedRef.current = true;
    markFiredToday('hot_lead_celebration');

    // Two staggered bursts from the bottom corners for a "rising" feel.
    const baseOpts = {
      particleCount: 70,
      spread: 60,
      startVelocity: 55,
      ticks: 220,
      gravity: 0.95,
      decay: 0.92,
      scalar: 0.95,
      colors: ['#f59e0b', '#f43f5e', '#22d3ee', '#a78bfa', '#34d399']
    };
    confetti({ ...baseOpts, origin: { x: 0.2, y: 0.95 }, angle: 70 });
    window.setTimeout(() => {
      confetti({ ...baseOpts, origin: { x: 0.8, y: 0.95 }, angle: 110 });
    }, 220);

    // Brief celebratory toast in the corner with the company name.
    showCompanyToast(top.company, top.aiScore);
  }, [candidates]);

  return null;
}

function showCompanyToast(company: string, score: number): void {
  if (typeof document === 'undefined') return;

  const el = document.createElement('div');
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  el.style.cssText = [
    'position:fixed',
    'bottom:32px',
    'left:50%',
    'transform:translateX(-50%) translateY(40px)',
    'z-index:9999',
    'padding:14px 22px',
    'background:linear-gradient(135deg, rgba(245,158,11,0.18), rgba(244,63,94,0.18))',
    'border:1px solid rgba(245,158,11,0.5)',
    'border-radius:14px',
    'color:#f8fafc',
    'font-family:inherit',
    'font-size:14px',
    'font-weight:500',
    'box-shadow:0 12px 48px rgba(0,0,0,0.45), 0 0 24px rgba(245,158,11,0.35)',
    'opacity:0',
    'transition:opacity 350ms ease, transform 350ms cubic-bezier(0.22, 1, 0.36, 1)',
    'pointer-events:none',
    'white-space:nowrap',
    'max-width:90vw'
  ].join(';');

  const safeCompany = company.length > 48 ? company.slice(0, 45) + '...' : company;
  el.innerHTML = `
    <span style="font-size:18px;margin-right:8px;">🔥</span>
    <strong>${escapeHtml(safeCompany)}</strong>
    <span style="opacity:0.8;margin-left:6px;">scored ${score} today.</span>
  `;
  document.body.appendChild(el);

  // Fade-in next frame, then fade-out at 4.2s, remove at 4.8s.
  requestAnimationFrame(() => {
    el.style.opacity = '1';
    el.style.transform = 'translateX(-50%) translateY(0)';
  });
  window.setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateX(-50%) translateY(40px)';
  }, 4200);
  window.setTimeout(() => {
    el.remove();
  }, 4800);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
