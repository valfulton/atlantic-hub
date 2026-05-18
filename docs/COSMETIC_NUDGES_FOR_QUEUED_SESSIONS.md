# Cosmetic Nudges to Paste Into Each Queued Cowork Chat

**Purpose:** Atlantic & Vine's design language is locked in `docs/COSMETIC_BASELINE.md`. Every new session should read it. These short paste-in nudges remind each session to use the gamification components Val already loves + hit WCAG AA + match the brand feel.

**How to use:** When you spin up a fresh cowork chat for Grok / Clay / PhantomBuster / Email / future sessions, paste the matching nudge below as a follow-up message AFTER you've pasted the main kickoff doc. The kickoff doc already references COSMETIC_BASELINE.md, but the nudge below makes it impossible to miss.

---

## NUDGE FOR: Grok Imagine session

```
Before you build the Commercials tab UI:

Read docs/COSMETIC_BASELINE.md carefully. Use the existing gamification components:
- The "Generate image" and "Generate video" buttons should use the same sparkle pattern as RescoreButton (twinkle on hover, sparkle-spinner while loading)
- The generated-asset grid uses the same DataTable component used elsewhere
- New assets fade in with the same highlight-fade pattern used on /admin/events live mode
- Cost-per-asset displays use the muted text style but at AA contrast (not gray-on-gray)
- Touch targets 44x44 min on the Generate buttons
- Honor prefers-reduced-motion: skip the fade-in animation if the user opts out

These are non-negotiable. Atlantic Hub has one design language now; respect it.
```

---

## NUDGE FOR: Clay Webhook session

```
The Clay status page at /admin/av/integrations/clay must match the rest of the operator dashboard:

Read docs/COSMETIC_BASELINE.md. Specifically:
- Use the StatusBadge component for outcome pills (inserted=success, duplicate=amber, error=red)
- Recent-runs table is a DataTable, not custom markup
- Webhook URL display uses a copy-to-clipboard button with the sparkle hover state
- Setup instructions section has aria-live="polite" so screen readers announce status changes when Val configures things
- WCAG AA contrast on everything
- prefers-reduced-motion respected

The Clay integration is a CONFIG page, not a polished surface — keep it minimal and high-density. No celebratory animations here.
```

---

## NUDGE FOR: PhantomBuster Webhook session

```
The PhantomBuster status page at /admin/av/integrations/phantombuster must match the Clay status page (above) and follow docs/COSMETIC_BASELINE.md.

Specifically for the per-run details:
- Each run shows aggregate counts using the same Stat component pattern from the AV leads page
- New rows fade in on the live-mode pattern if you wire live-refresh
- Failed runs surface the error message in expand-on-click detail (don't blast a huge red block)
- Touch targets 44x44 min

If you build a "test run" button, sparkle pattern on hover.
```

---

## NUDGE FOR: Email Outreach Automation session

```
The Outreach surface is your biggest UI build of Phase 2. Read docs/COSMETIC_BASELINE.md before you touch anything.

CRITICAL design rules for this session:
- The "Generate outreach" button (per-lead and bulk) uses the SAME sparkle pattern as RescoreButton. This is the third AI-powered action and the pattern should feel consistent.
- Approval queue rows highlight-fade on insertion just like /admin/events live mode
- Pending-count badges in the sidebar use the brand-dot pattern (NOT a streak/notification badge — see the "non-features" section of COSMETIC_BASELINE.md)
- Reply classification badges (positive/interested/neutral/negative) follow the status color palette
- The reply thread rendering uses semantic <article> + <time> tags for screen reader support
- aria-live="polite" on the pending-count so screen readers announce new approvals needed
- prefers-reduced-motion disables the highlight-fade

DO NOT introduce:
- Email-specific celebration animations (no confetti when one sends — that fires too often)
- Sound effects (anti-pattern for productivity tools)
- Achievement badges for "first 10 sends" etc.

The MILESTONE moment for celebration is a positive reply landing. Hook one celebratory moment to outreach.replied events where classification='positive', once per day max via lib/ui/once_per_day.ts. That's it.
```

---

## GENERIC FALLBACK (if you spin up a session not listed above)

Paste this verbatim as a follow-up to any kickoff doc:

```
Before you write a line of UI:

1. Read docs/COSMETIC_BASELINE.md.
2. Reuse existing components from the gamification pass: AnimatedScoreReveal, ScoreRadarChart, LeadOfTheDay, HotLeadConfetti, RescoreButton sparkle pattern.
3. Hit WCAG AA contrast on every new component (4.5:1 body text, 3:1 large text and UI components).
4. Add focus-visible rings to every interactive element.
5. Add aria-label to every icon-only button.
6. Honor prefers-reduced-motion.
7. Touch targets 44x44 min.
8. Status indicators communicate via TEXT + COLOR, never color alone.
9. Plural voice, no founder name in any visible UI string.

These are not suggestions. The design language is locked. Match it.
```
