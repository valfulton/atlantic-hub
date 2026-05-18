# Claude Code Session Kickoff: Cosmetic + Gamification Polish

**Purpose:** Drop into a fresh Claude Code session. Pure UI work, zero schema, zero backend changes. Six surgical moves that make the operator dashboard feel like a product instead of a back office.

**Source of these recommendations:** Brutal feedback agent review of atlanticandvine.netlify.app and atlantic-hub on 2026-05-17. Approved by Val.

---

## PASTE THIS INTO THE NEW CLAUDE CHAT (top of message)

You are continuing the Atlantic & Vine / Atlantic Hub project. Atlantic And Vine
LLC, operated by Val Fulton. Be confident, terse, ASCII-only in shell commands
and commit messages (no em-dashes, no smart quotes, no curly punctuation).

Read these docs FIRST:
1. `/Users/atlanticandvine/Library/CloudStorage/OneDrive-atlanticandvine.com/HunterHoney/_organized/atlantic-hub/docs/SESSION_COORDINATION.md`
2. `/Users/atlanticandvine/Library/CloudStorage/OneDrive-atlanticandvine.com/HunterHoney/_organized/atlantic-hub/docs/PROJECT_STATUS_2026-05-17.md`
3. `/Users/atlanticandvine/Library/CloudStorage/OneDrive-atlanticandvine.com/HunterHoney/_organized/atlantic-hub/docs/PRODUCT_VISION.md`
4. This file

After reading, ship the six surgical moves below.

---

## SCOPE RESERVATIONS

- **Schema migration:** none (UI only)
- **New files OWNED:**
  - `components/AnimatedScoreReveal.tsx` (animated count-up score badge)
  - `components/ScoreRadarChart.tsx` (radar chart for sub-scores)
  - `components/LeadOfTheDay.tsx` (homepage card)
  - `components/HotLeadConfetti.tsx` (canvas-confetti effect, fires once per day max)
  - `lib/ui/once_per_day.ts` (helper to gate effects to "first time today" via localStorage)
- **Modified files OWNED:**
  - `app/admin/av/page.tsx` (insert LeadOfTheDay card above the table, wire confetti)
  - `app/admin/av/[audit_id]/page.tsx` (swap StatusBadge for AnimatedScoreReveal on aiScoreBand)
  - `app/admin/av/[audit_id]/LeadDetailTabs.tsx` (insert ScoreRadarChart in the AI tab)
  - `app/admin/events/page.tsx` (add live-mode toggle — depends on events session shipping first)
- **Cross-touch:** none
- **Will NOT touch:** any `/api/*` routes, any `/client/*` routes, any `lib/openai/*`, `lib/grok/*`, discovery routes, schema files
- **Upstream dependencies:**
  - Move #5 (live events mode) REQUIRES `/admin/events` page to exist (Auto-Scoring + Events session must ship first)
  - Move #1 (animated re-score) REQUIRES the re-score button to exist (Auto-Scoring session adds it)
  - Moves #2, #3, #4, #6 can ship anytime
- **Parallel-safe with:** Client Portal, Grok Imagine, Clay, PhantomBuster (different files)

If Auto-Scoring + Events session hasn't shipped when you start, ship moves 2/3/4/6 first, then come back for 1 and 5 after events ships.

---

## TECH AVAILABLE

- Tailwind CSS already in use across components — use it
- `recharts` IS already in dependencies — use it for the radar chart
- `canvas-confetti` NOT yet in dependencies — add via `npm install canvas-confetti @types/canvas-confetti --save`
- No Framer Motion needed — CSS animations + Tailwind transitions are enough
- localStorage for "once per day" gating

---

## THE SIX MOVES

### Move 1: Animated score reveal on Re-score (depends on auto-scoring shipping)

When the lead's `ai_score` updates (after a Re-score click), animate the score badge in the page header to count up from 0 to the final number over 1.5 seconds. The band badge (Hot/Warm/Cool) pulses with a brief glow. Sub-score breakdown bars (fit, intent, reachability, icp_match) fill left-to-right over 0.8 seconds.

Build as `components/AnimatedScoreReveal.tsx`. Accept props: `{ score: number; band: 'hot' | 'warm' | 'cool' | null; breakdown?: { fit: number; intent: number; reachability: number; icp_match: number; } }`. Use a `useEffect` keyed on the score value to trigger animation on prop change.

Use pure CSS keyframes — no Framer Motion. Tailwind's `transition`, `animate-pulse`, and `transform` utilities cover everything needed.

### Move 2: Lead of the Day card on /admin/av

Insert above the leads table on `app/admin/av/page.tsx`:

A horizontal card 80px tall titled "Your hottest lead this morning" with:
- The single highest-scored lead from the last 24 hours where `lead_status = 'new'`
- Company name, ai_score badge, brief reason from `ai_score_reason`
- Click anywhere on the card → routes to `/admin/av/<audit_id>`

If no high-scored new leads in the last 24 hours, render nothing (don't show an empty state — silence is fine).

Build as `components/LeadOfTheDay.tsx`. Server component, fetches via `serverFetch('/api/admin/av/leads?stage=new&sort=score&direction=desc&limit=1')` then filters client-side for >24h old or skips.

### Move 3: Confetti on first hot lead of the day

When the operator visits `/admin/av` AND there's a lead with `ai_score > 85` that arrived TODAY AND we haven't fired confetti today yet, trigger `canvas-confetti` with the company name flying in.

Build as `components/HotLeadConfetti.tsx` client component. Uses `lib/ui/once_per_day.ts` helper:

```ts
export function hasFiredToday(key: string): boolean { /* check localStorage key + date */ }
export function markFiredToday(key: string): void { /* set localStorage */ }
```

Gate strictly: ONCE per day. Don't fire on every page load. Don't fire if score is 85 but already-archived.

### Move 4: Score breakdown as a radar chart

In `LeadDetailTabs.tsx` AI tab, replace any existing list-of-numbers presentation of the sub-scores with `ScoreRadarChart`. Use recharts `RadarChart` with axes: Fit / Intent / Reachability / ICP Match.

Build `components/ScoreRadarChart.tsx`. Accept props `{ breakdown: { fit: number; intent: number; reachability: number; icp_match: number; } }`. Render at 240px square. Use brand colors (var(--brand) and var(--brand-glow)).

### Move 5: Live mode toggle on /admin/events (depends on events session shipping)

Top right corner of `/admin/events`: a toggle labeled "Live". When ON, auto-refetch the events list every 5 seconds. New rows fade in from the top with a subtle highlight that fades out over 2 seconds.

Implement as a useEffect with setInterval that calls `router.refresh()`. Add a small ⚡ icon next to "Live" so it's clear something is happening.

Persist the toggle state in localStorage so it remembers per-operator preference.

### Move 6: Sparkle the Re-score button

Borrow aesthetic from your `pop-journey.html` page. On hover, the Re-score button gets a tiny sparkle animation (1-2 sparkle CSS pseudo-elements that twinkle). Loading state replaces "..." with a sparkle spinner.

Pure CSS. ~20 lines. Goes in `app/admin/av/[audit_id]/page.tsx` or wherever the Re-score button lives (added by the Auto-Scoring session — read their code to find it).

---

## ANTI-PATTERNS - DO NOT BUILD

The brutal feedback agent was explicit about these. Do not implement:
- Streaks ("you've logged in 3 days in a row")
- Badges or achievement systems
- Daily check-in rewards
- "You're on fire 🔥" notifications
- Leaderboards of any kind
- Login celebrations

Why: operators come back because there's MONEY in the pipeline. Celebrate outcomes (leads, scores, conversions). Never celebrate the act of opening the app — that's a consumer-app anti-pattern that adults can smell.

---

## VERIFICATION BEFORE COMMIT

1. `npx tsc --noEmit` returns exit 0
2. `npm run build` returns "Compiled successfully"
3. Visual check on `/admin/av` — Lead of the Day card renders if eligible lead exists
4. Visual check on `/admin/av/[audit_id]` — radar chart renders cleanly
5. Confetti only fires once per session per day (test by reloading page, should NOT re-fire)
6. No layout shift / no broken responsive behavior at 1024px and 1440px widths

---

## DEPLOY

```
cd "$HOME/Library/CloudStorage/OneDrive-atlanticandvine.com/HunterHoney/_organized/atlantic-hub"
npm install canvas-confetti @types/canvas-confetti --save
npx tsc --noEmit
npm run build
git add -A
git commit -m "ui: animated score reveal, lead of the day card, radar chart, sparkle re-score"
git push origin main
```

Netlify auto-builds in ~90s.

---

## ON FINISH

Update `docs/PROJECT_STATUS_2026-05-17.md`. Append to `docs/CHANGELOG.md`. Hand back a one-paragraph summary to Val.
