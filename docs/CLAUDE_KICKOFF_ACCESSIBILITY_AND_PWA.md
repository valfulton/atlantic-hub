# Claude Code Session Kickoff: Accessibility Audit + PWA Install

**Purpose:** Drop this entire file into a fresh Claude Code session.
**Goal:** Two related shippable wins in one focused session:
1. **WCAG AA accessibility pass** across all atlantic-hub admin pages — readable, navigable, focus-visible, screen-reader-friendly. Val flagged 2026-05-17 that elements are hard to see and the interface feels complicated.
2. **PWA support** — manifest, service worker, install prompt. Lets atlantic-hub "Add to Home Screen" on iOS/Android and feel like a native app.

**Both ship together because they're cosmetic + structural and touch the same set of files.**

---

## PASTE THIS INTO THE NEW CLAUDE CHAT (top of message)

You are continuing the Atlantic & Vine / Atlantic Hub project. Atlantic And Vine
LLC, operated by Val Fulton. Be confident, terse, ASCII-only in shell commands
and commit messages (no em-dashes, no smart quotes, no curly punctuation).

Read these docs FIRST:
1. `docs/SESSION_COORDINATION.md`
2. `docs/PROJECT_STATUS_2026-05-17.md`
3. `docs/COSMETIC_BASELINE.md` (this is your bible for this session - WCAG AA standards locked there)
4. `docs/SYSTEM_ARCHITECTURE.md`
5. This file

All under `/Users/atlanticandvine/Library/CloudStorage/OneDrive-atlanticandvine.com/HunterHoney/_organized/atlantic-hub/`.

Ship today.

---

## SCOPE RESERVATIONS

- **Schema migration:** none (zero schema changes)
- **New files OWNED:**
  - `public/manifest.json`
  - `public/icon-192.png`, `public/icon-512.png`, `public/apple-touch-icon.png` (generate from existing brand logo)
  - `app/sw.ts` or `public/sw.js` (service worker — minimal: cache shell, allow offline read of last-known state)
  - `components/InstallPrompt.tsx` (custom Add-to-Home-Screen prompt, dismissible, once-per-session)
  - `docs/A11Y_AUDIT_FINDINGS.md` (write-up of what was wrong + what changed)
- **Modified files OWNED:**
  - `tailwind.config.ts` (add accessible-contrast color tokens if needed)
  - `app/globals.css` or `app/layout.tsx` (focus-visible utilities, `prefers-reduced-motion` rules, meta tags)
  - `components/Sidebar.tsx` (ARIA + keyboard nav)
  - `components/StatusBadge.tsx` (contrast remediation if needed)
  - `components/DataTable.tsx` (semantic HTML, ARIA, keyboard nav)
  - Any individual page where contrast or focus is broken — case by case
- **Cross-touch (read + careful write):** existing component files; only modify CSS/className/ARIA, never logic
- **Will NOT touch:** API routes, schema files, business logic in lib/, /client/* routes (portal owns those)
- **Upstream dependencies:** none
- **Parallel-safe with:** Grok Imagine, Clay, PhantomBuster, Email Automation (different concerns)

---

## SCOPE 1: ACCESSIBILITY AUDIT + REMEDIATION

### Step 1: Run automated checks

Install `pa11y-ci` or use Chrome DevTools' Lighthouse on each major route. Capture findings in `docs/A11Y_AUDIT_FINDINGS.md`. Don't ship the audit doc yet — use it to drive your fix list, then leave the final doc as a record of what changed.

Routes to audit:
- `/admin` (home)
- `/admin/av` (leads list — primary operator surface)
- `/admin/av/discover` (multi-source discovery — 4 tabs)
- `/admin/av/import` (CSV import)
- `/admin/av/[audit_id]` (lead detail — most complex page)
- `/admin/events` (event log)
- `/admin/hh`, `/admin/ebw` (other tenant home pages — same patterns)
- `/login` (auth)
- `/client/login` (client portal auth)
- `/client/dashboard` (client portal main)

### Step 2: Fix in priority order

**Priority 1 — Color contrast.** The `text-muted` Tailwind class is the most likely AA failure on dark backgrounds. Lift the muted color until it passes 4.5:1 on both `bg-surface` and `bg-surface-2`. Use https://webaim.org/resources/contrastchecker/ or `npm` tooling.

**Priority 2 — Focus states.** Every interactive element gets a visible focus ring. Add to globals.css:

```css
*:focus-visible {
  outline: 2px solid var(--brand);
  outline-offset: 2px;
  border-radius: 2px;
}
```

Then audit per-component to make sure no component overrides this with `outline: none`.

**Priority 3 — ARIA labels on icon-only buttons.** The Archive `×` button on each lead row. The sidebar logout. Any button that's icon-only.

**Priority 4 — Semantic HTML.** Replace `<div onClick>` with `<button>` wherever found. Confirm `<nav>`, `<main>`, `<aside>` are used.

**Priority 5 — Keyboard navigation.** Tab through `/admin/av`. Confirm logical order. Confirm modal traps focus. Confirm Escape closes modals.

**Priority 6 — Mobile responsive.** Test at 375px width (iPhone SE). Tables should collapse to card view below 768px. Touch targets 44x44 minimum.

**Priority 7 — Reduced motion.** Add to globals.css:

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

This disables confetti, score-reveal animations, sparkles for users who opted out.

**Priority 8 — Color-only indicators.** Audit every status badge to confirm there's text + color, not color alone. The Hot/Warm/Cool badges already do this. Verify nothing else is broken.

### Step 3: Document what changed

Write `docs/A11Y_AUDIT_FINDINGS.md` with:
- Before/after Lighthouse scores per route
- Specific WCAG criteria addressed
- Items deferred (with reason) for future sessions

---

## SCOPE 2: PWA SUPPORT

### Step 1: Generate icons

Atlantic Hub already has brand imagery in `public/`. Generate three PNG sizes from the existing logo:
- `public/icon-192.png` (192x192)
- `public/icon-512.png` (512x512)
- `public/apple-touch-icon.png` (180x180)

Use `sharp` or similar if Val doesn't have ready-made icons. Maskable variant nice-to-have.

### Step 2: Manifest

`public/manifest.json`:

```json
{
  "name": "Atlantic Hub",
  "short_name": "Atlantic",
  "description": "AI-powered marketing intelligence platform",
  "start_url": "/admin",
  "scope": "/",
  "display": "standalone",
  "background_color": "#0A0F1A",
  "theme_color": "#0A4D3C",
  "orientation": "portrait-primary",
  "icons": [
    { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any maskable" }
  ]
}
```

### Step 3: Meta tags in root layout

In `app/layout.tsx` head:

```tsx
<link rel="manifest" href="/manifest.json" />
<meta name="theme-color" content="#0A4D3C" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
<link rel="apple-touch-icon" href="/apple-touch-icon.png" />
```

### Step 4: Service worker (minimal — cache shell)

For v1, a tiny service worker that caches the app shell (HTML, CSS, JS) and serves stale-while-revalidate. No offline-DB sync, no background sync. Just makes the app feel snappy on repeat loads + survives flaky connections.

Use Next.js's recommended service worker setup (or `next-pwa` plugin if it fits without bloating bundle).

### Step 5: Install prompt component

`components/InstallPrompt.tsx` — listens for `beforeinstallprompt` event, shows a discrete toast at bottom-right with "Install Atlantic Hub on your phone" and a dismiss X. Dismissed state persists per browser via localStorage. Don't nag.

Mount it in `app/admin/layout.tsx` (or wherever the operator-side layout lives) — only for authenticated owner/staff. Client-portal users get a separate prompt or none.

---

## ANTI-PATTERNS - DO NOT BUILD

- Don't add a PWA "splash screen" that delays load. Splash screens are an anti-pattern for productivity tools.
- Don't add `display: 'fullscreen'` in the manifest — `standalone` is correct for productivity apps. Fullscreen kills the status bar and confuses users.
- Don't cache user data in the service worker. Only static shell assets. Caching user data without sync logic causes stale-data bugs.
- Don't add "high contrast mode" toggle — users system-level prefers-contrast media query handles this.
- Don't change color palette without consulting `COSMETIC_BASELINE.md`. Adjust lightness for contrast, never invent new colors.

---

## VERIFICATION BEFORE COMMIT

1. `npx tsc --noEmit` returns exit 0
2. `npm run build` returns "Compiled successfully"
3. Lighthouse Accessibility score on `/admin/av` goes from current (likely 70-80) to 90+
4. Chrome DevTools "Application" tab shows manifest loaded + service worker registered + "Installable" status
5. On a real phone: open atlantic-hub.netlify.app, browser menu shows "Add to Home Screen" option, icon installs, opens in standalone mode
6. Tab through `/admin/av` keyboard-only: every interactive element is reachable + visibly focused
7. Test with `prefers-reduced-motion` set (Chrome DevTools > Rendering > Emulate CSS media): no animations fire

---

## DEPLOY

```
cd "$HOME/Library/CloudStorage/OneDrive-atlanticandvine.com/HunterHoney/_organized/atlantic-hub"
git add -A
git commit -m "a11y plus pwa: wcag aa pass, install prompt, manifest, focus states"
git push origin main
```

Netlify auto-builds in ~90s.

If git push fails with mysterious lock errors, Val restarts her computer.

---

## ON FINISH

- Update `docs/PROJECT_STATUS_2026-05-17.md` with what shipped
- Append to `docs/CHANGELOG.md`
- Update `docs/COSMETIC_BASELINE.md` PWA section to mark as shipped
- Hand back a one-paragraph summary with before/after Lighthouse scores

Tell Val: "Open atlantic-hub.netlify.app on your phone. Tap the browser menu. Tap Add to Home Screen. It's an app now."
