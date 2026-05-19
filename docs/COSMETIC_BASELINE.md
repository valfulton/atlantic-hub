# Atlantic Hub - Cosmetic Baseline + Design Language

**Purpose:** Every Claude Code session must reference this doc before adding UI. Keeps the experience consistent across pages, sessions, and time. Captures the gamification language locked in 2026-05-17 plus accessibility minimums.

**Last reviewed:** 2026-05-17

---

## DESIGN LANGUAGE PRINCIPLES

1. **Celebrate outcomes, never the act of opening the app.** No streaks, no badges, no daily check-in rewards, no "you're on fire" notifications, no leaderboards. Operators come back because there's money in the pipeline; lean on that.

2. **Animate change, not state.** When a value updates (score, count, status), animate the transition. When the page loads with no change, render the final state instantly — no welcome animation, no parallax.

3. **Rarity makes it feel like a win.** Confetti, sparkles, big animations should fire AT MOST once per day per trigger condition. Saturation kills the magic.

4. **Information density over decoration.** Operator dashboards need to scan fast. Client portals can be slightly more polished/celebratory. Different audiences, different density.

5. **Plural voice, no founder name.** "Our platform," "our team," "we." Never "I" or a specific name unless that person is in a paid sponsor context.

---

## STATUS COLOR PALETTE

Locked via the existing Tailwind setup. Use these exclusively for status indicators.

| Status | Hex | Tailwind | Use for |
| --- | --- | --- | --- |
| Hot | `#f43f5e` (rose-500) | `bg-rose-500 / text-rose-300` | Hot leads, high-score badges, critical alerts |
| Warm | `#f59e0b` (amber-500) | `bg-amber-500 / text-amber-300` | Warm leads, medium-score badges, attention |
| Cool | `#3b82f6` (blue-500) | `bg-blue-500 / text-blue-300` | Cool leads, lower-priority info |
| Success | `#10b981` (emerald-500) | `bg-emerald-500 / text-emerald-300` | Enriched, completed, paid status |
| Live | `#10b981` (emerald-500) | with pulse animation | Real-time indicators |
| Coming Soon | `#C9A961` (gold-accent) | gold | Roadmap items, beta features |
| Failed / Error | `#ef4444` (red-500) | `bg-red-500 / text-red-300` | Failed automations, errors |
| Muted | varies per surface | `text-muted` | Secondary info, helper text |

**Color is never the only indicator.** Every status badge includes a text label so color-blind users can read state. Hot/Warm/Cool always render with the word, not just the hue.

---

## GAMIFICATION VOCABULARY (use across all UI)

### Animated reveals
When the AI re-scores a lead, animate the score count up from 0 to final value over 1.5 seconds. Sub-score breakdown bars fill left-to-right over 0.8 seconds. Status band badge pulses with a brief glow on change.

Component: `components/AnimatedScoreReveal.tsx` (shipped 2026-05-17).

### Hot-lead confetti
First time per day a lead lands at score 86 or above, fire a `canvas-confetti` burst with the company name. Once per day max, gated via `lib/ui/once_per_day.ts`. Never on every page load.

Component: `components/HotLeadConfetti.tsx` (shipped 2026-05-17).

### Sparkle pattern
Hover states on AI-powered actions (Re-score, Generate Social Content, Generate Commercial, Generate Outreach, Auto-Audit) use the SHARED `.ah-action-sparkle` class defined in `app/globals.css`. Twin sparkle pseudo-elements twinkle on hover or keyboard focus; the loading state (`data-loading="true"` attribute on the button) spins the icon and pulses the sparkles. The class honors `prefers-reduced-motion` automatically -- no per-component work needed.

Reference implementation: `app/admin/av/[audit_id]/RescoreButton.tsx`.

Do NOT copy the styled-jsx block from RescoreButton into a new component. Use the shared class. If you find an existing component still inlining the sparkle CSS (early sessions did this before the class was promoted), migrate it to `.ah-action-sparkle` when you next touch the file.

Markup template:

```tsx
<button
  className="ah-action-sparkle ..."
  data-loading={busy ? 'true' : 'false'}
  aria-label="Generate <action>"
>
  <span className="ah-sparkle-icon">{/* svg icon */}</span>
  <span>{busy ? 'Generating' : 'Generate'}</span>
  <span className="ah-sparkle-pair" aria-hidden="true">
    <span>✦</span><span>✧</span>
  </span>
</button>
```

### Lead-of-the-day pattern
On any operator landing page, surface the single most actionable record at the top above the table. Click goes straight to detail.

Eligibility uses a three-tier fallback so the brand banner stays visible most days:

1. `today` -- new hot/warm lead from the last 24 hours
2. `this_week` -- new hot/warm lead from the last 7 days
3. `top_overall` -- any unactioned lead with score >= 60

Only renders null when the pipeline is genuinely empty (no scored leads above 60 anywhere). The copy adapts per tier so the card never lies about how fresh the lead is.

Component: `components/LeadOfTheDay.tsx` (shipped 2026-05-17, widened 2026-05-19).

### Score radar chart
Sub-score breakdowns (fit / intent / reachability / icp_match) render as a radar chart, not numbers. Pure SVG, no recharts dependency. Brand colors. Spring scale-in animation on first render.

Component: `components/ScoreRadarChart.tsx` (shipped 2026-05-17). Reuse for any future sub-score breakdown.

### Live mode toggle
Any page that streams real-time events (events log, outreach queue, future commercial-generation queue) gets a top-right "Live" toggle. Off by default. When on: poll every 5 seconds. New rows fade in from top with green highlight that fades over 2 seconds. Toggle pulses while live. Preference persists in localStorage per-browser.

Pattern is in `app/admin/events/EventsTable.tsx` (shipped 2026-05-17).

### Held for next polish pass
These three moves are approved by Val (2026-05-17) but not yet built. When relevant to your session, include them:

- **Band-badge tooltips.** Hover a Hot/Warm/Cool badge to see `Hot = 75-100: pursue this week`. Self-documenting for new operators and client viewers.
- **Sidebar "new hot leads" dot.** Tiny brand-color dot next to the tenant name in the sidebar when a fresh hot lead has landed since last visit. Clears on click. Notification without streak/checkin pattern.
- **Score history sparkline.** 60x16 px sparkline on lead detail header showing score movement across re-scorings. Append to `ai_audit` JSON history on each scoring run; render trend visually.

---

## ACCESSIBILITY MINIMUMS (WCAG AA targets)

**Every new component must hit these. Existing components are being remediated in a parallel session — coordinate with that session if your work touches the same files.**

### Color contrast
- Body text: 4.5:1 minimum against background
- Large text (18px+ or 14px+ bold): 3:1 minimum
- UI components / state changes: 3:1 minimum
- The `text-muted` Tailwind class currently fails AA on dark backgrounds. Replacement coming in accessibility-audit session.

### Focus states
Every interactive element gets a visible focus ring on keyboard navigation. Use `focus-visible:ring-2 focus-visible:ring-brand` Tailwind utility. Never `outline: none` without replacement.

### Keyboard navigation
- Tab order must follow visual order
- Modals trap focus when open, return focus to trigger on close
- Escape closes modals, dropdowns
- Enter/Space activates buttons

### ARIA + semantic HTML
- Icon-only buttons need `aria-label`
- Loading states announce via `aria-live="polite"`
- Status updates announce via `aria-live="polite"` (rate-limited so screen readers don't get spammed)
- Use semantic HTML: `<button>` not `<div onClick>`, `<nav>` not `<div role="navigation">`

### Touch targets
- Minimum 44x44px for any interactive element on mobile
- Spacing between adjacent touch targets: at least 8px

### Animation respect
- Honor `prefers-reduced-motion: reduce` — disable confetti, score-reveal animations, radar spring, live-mode polling animations for users who set this preference

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

### Color-only indicators
Never use color alone. Every status communicates via text label AND color. Every chart has data labels in addition to color encoding.

---

## TYPOGRAPHY

- Headings: Fraunces serif (already loaded)
- Body / UI: Inter (already loaded)
- Minimum body font size: 14px (12px only for very dense table rows, never for primary content)
- Line height: 1.5 minimum for body, 1.2 for headings
- Max line length: 75 characters for body text

---

## MOBILE / RESPONSIVE STANDARDS

- All pages must render usefully at 375px width (iPhone SE) without horizontal scroll
- Tables collapse to card view below 768px
- Modals become bottom sheets below 640px
- Touch targets meet 44x44 minimum
- Navigation collapses to hamburger below 1024px

---

## PWA HOOKS (planned, not yet shipped)

When PWA support ships:
- `public/manifest.json` declares app name, icons, theme color
- Service worker handles offline shell + caches static assets
- `apple-touch-icon` meta tags for iOS home screen
- `theme-color` meta tag for status bar coloring

Until shipped: components should already work offline-friendly (no required network calls for static rendering of cached data).

---

## WHEN TO REFERENCE THIS DOC

Every kickoff doc must include this line near the top:

> Read `docs/COSMETIC_BASELINE.md` before adding UI. Use the gamification components already built. Hit WCAG AA on any new component. Honor reduced-motion preferences.

If a session needs a NEW interactive pattern not covered here, propose it to Val and update this doc before shipping. Don't fork the design language.

---

## CHANGE LOG

- 2026-05-17: Initial draft. Locks gamification patterns from Cosmetic + Gamification Polish session. Establishes WCAG AA minimums for accessibility-audit session.
