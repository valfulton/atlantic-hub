# Claude Code Session Kickoff: Vine-Themed Gamification (FUTURE / PARKED)

**Status:** PARKED. Not in scope for any in-flight session as of 2026-05-20.

**Why parked:** Atlantic Hub (the operator dashboard) already locked its
visual language in `docs/COSMETIC_BASELINE.md`: dark mode, amber brand,
honeycomb mark, sunset gradients, sparkle accents. That language is
sophisticated-tech-operator. The wine-cellar / harvest / vintage metaphors
proposed below clash with the shipped Hot / Warm / Cool bands and the
engagement-score sparkline (commits 393d684 .. 68d245e).

The wine-cellar aesthetic lives on the **brand surface** at
`atlanticandvine.com` (the AV marketing site, separate repo at
`github.com/valfulton/atlanticandvine.git`). When a future session takes
on a Pop-Journey polish pass on that site, these ideas should be
re-evaluated *there*, where the metaphor fits.

**Why captured at all:** the ideas are still good for the right surface.
Saving them so they are not lost when memory rolls.

---

## SCOPE RESERVATIONS (when revived)

- Schema migration: none required for the ideas as captured.
- Target surface: atlanticandvine.com (NOT atlantic-hub).
- Will NOT touch atlantic-hub aesthetic without an explicit
  `docs/COSMETIC_BASELINE.md` update + Val sign-off first.

---

## IDEAS TO EVALUATE FOR THE BRAND SURFACE

### Prospect-experience moves (Pop Journey on atlanticandvine.com)

1. **Live audit construction.** When the intake form posts, route to a
   "your audit is being prepared" page that visibly walks through 4-5
   construction stages (8-15s each) -- "Pulling your business profile,"
   "Identifying your ideal customer fit," "Analyzing competitive
   position," "Drafting recommendations." Even if mostly UI theater on
   top of the actual generation, it turns a black-box wait into a
   craftsmanship moment.

2. **Wax-seal reveal.** When the audit is ready, transition from
   "preparing" to a dark card with a wax-seal break animation that
   reveals the audit. Optional, motion-respecting (honor
   `prefers-reduced-motion`).

3. **Branded audit PDF.** Generate a PDF of the audit with a styled
   cover -- prospect's business name in serif, palette extracted from
   their site, dated. The PDF is the artifact they show a business
   partner; it raises perceived value of the free audit.

4. **Cellar preview teaser.** At the bottom of the rendered audit, three
   blurred "lead cards" with copy like "These are the kinds of contacts
   we'd send you on day one." Real leads from the same industry,
   half-blurred. Implicit upgrade prompt to Sprint.

5. **Reserve-your-strategy-session CTA.** Restyle the Calendly embed so
   it reads as a hospitality reservation, not a sales-call form. Calm
   palette, single CTA, no urgency timer.

### Net-new operator-surface gamification (NOT shipped, NOT in baseline)

These were proposed but conflict with the locked operator aesthetic.
Re-evaluate only if `docs/COSMETIC_BASELINE.md` is intentionally
expanded.

6. **Vintage Runs (streak counter).** Days in a row with at least one
   lead reviewed + one outreach sent. Quiet number in the sidebar; small
   badge at 7d / 30d. (Conflicts with the existing engagement-score
   sparkline, which is the operator's current "trend" surface.)

7. **Tonight's Tasting Menu.** End-of-day card at 5pm local with the
   three highest-priority follow-ups for tomorrow. Click to schedule
   them as morning tasks. (Conflicts with the shipped LeadOfTheDay card
   which already surfaces a single action.)

8. **Cellar view for closed deals.** Dedicated /admin/av/closed page
   rendering closed deals as bottles on a rack, each labeled by client
   + close date. Doubles as social proof for the upsell pitch.

9. **Vine constellation map.** A single visual page showing discoveries
   as a constellation: industries cluster naturally, hot leads pulse
   brighter, archived leads fade. Pattern-detection eye candy.

10. **Pour-of-the-day sonics.** Soft champagne-flute chime when Clay
    lands a verified email on a previously dead lead. Off by default,
    operator opt-in.

---

## OUT OF SCOPE WHEN REVIVED

Per `docs/COSMETIC_BASELINE.md` rule 1 ("celebrate outcomes, never the
act of opening the app"), do NOT introduce check-in rewards, daily login
streaks, or notification badges that fire on page load. The streak idea
(item 6) is borderline -- if revived, it must reward outcomes (sent
outreach, closed deals) not visits.

---

## REVIEW BEFORE STARTING

When this session is finally opened:

1. Re-read `docs/COSMETIC_BASELINE.md` and confirm the surface in
   question (brand site vs. operator dashboard).
2. Re-read `docs/PROJECT_BRIEFING_2026-05-18.md` to confirm tier names
   are still sprint / momentum / scale at $1,995 / $3,995 / $7,995. If
   the registry has moved, update copy before shipping.
3. Confirm with Val which surface gets the polish before writing code.
   The same idea reads as classy on one surface and tacky on the other.

---

## PARK STAMP

- Parked by: Clay Webhook session, 2026-05-20.
- Conductor note: see Cowork chat 2026-05-20 -- ideas were proposed in
  the original Clay-session response, conductor corrected scope, ideas
  preserved here for a future focused session.
