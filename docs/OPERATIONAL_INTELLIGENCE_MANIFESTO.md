# Atlantic Hub - Operational Intelligence Manifesto

Permanent strategic reference for Atlantic Hub. Read this before implementing
features, changing workflows, or restructuring the product. It governs **how
the systems share intelligence** and **how the client journey flows**. It does
NOT govern visual design or delight (see "What this doc does not govern").

Last updated: 2026-05-21
Scope: the Atlantic Hub platform (operator dashboard + client portal). The
marketing site (atlanticandvine.com) and the Pop-Journey funnel are separate
surfaces with their own rules and are out of scope here.
Pairs with: docs/SESSION_COORDINATION.md (build coordination + schema registry),
docs/PRODUCT_VISION.md (offer + product detail).

---

## What Atlantic Hub is

Atlantic Hub is an AI-native operational intelligence platform for business
growth. It discovers opportunities, analyzes businesses, generates strategic
guidance, orchestrates outreach and content, and is meant to compound what it
learns over time.

It is deliberately NOT positioned as a CRM, a lead scraper, a social scheduler,
or a dashboard of disconnected tools. The long-term moat is not the software --
it is the accumulated operational intelligence the platform builds about each
business and across all of them.

---

## The two pillars

Everything in this doc reduces to two things. If a feature does not strengthen
one of these, question why it is being built.

### Pillar 1 - A strong client journey

The client experience should feel guided, prepared, and confidence-building --
not like a data dump. The journey is:

  Discover -> Intake -> Audit delivered -> Portal access -> Ongoing guidance

Principles:
- Every screen should answer "what matters most right now, and why."
- The client should feel informed and strategically advantaged, never buried.
- Access should be effortless: intake creates an account and emails a secure
  magic link; the client lands in their dashboard without friction.
- The journey should become more valuable over time, not just deliver once.

### Pillar 2 - Shared intelligence that compounds

Atlantic Hub is not a set of disconnected AI tools. Every system should read
from and contribute to a shared intelligence layer about each business, so that
each interaction makes the next recommendation smarter.

Per-business intelligence we care about accumulating:
- Brand voice and visual preferences
- Audience psychology and pain points
- Seasonal timing and market windows
- Content and outreach performance
- Sales objections and conversion outcomes
- Preferred channels and engagement signals

The goal is not automation alone. The goal is continuously improving business
intelligence -- which messaging converts, which industries respond, which
timing matters, which signals predict buying intent. Over time this becomes a
relationship graph across businesses, campaigns, industries, and outcomes. That
graph is the moat.

---

## The event stream is the spine

Every meaningful action generates an event (lead.created, ai.lead_scored,
ai.audit_generated, lead.enriched_clay, outreach.*, workflow.failed, and so on).
This unified stream is the observability layer today and the memory/training
substrate for the intelligence graph tomorrow. New systems must emit events for
the actions they take. Do not add a meaningful action that is invisible to the
event stream.

---

## Reality vs Horizon (be honest about this)

Builders must not assume the vision already exists. As of the last update:

| Capability | Status |
| --- | --- |
| Event stream / observability spine | REAL - shipped, live (System Events) |
| Per-lead intelligence (Living Score, pain_point_profile, score history, brand kits, lifecycle states) | REAL - shipped per lead |
| Client journey skeleton (intake -> magic-link account -> portal -> view audit) | REAL - coded end to end; depends on SMTP + CORS config being correct |
| Cross-business compounding ("reels beat static for hospitality") | HORIZON - not built; each lead is scored in isolation |
| Intelligence graph linking businesses/campaigns/outcomes | HORIZON - not built |
| One-click campaign orchestration (one intent -> outreach + content + social together) | HORIZON - assets are generated per-lead, not orchestrated |
| Guided "next step" layer on the client side | EARLY - dashboard shows data; guidance is thin |

When you build, say which column you are moving and do not describe Horizon
items as if they are Reality.

---

## What is LOCKED

Do not reinvent or re-quote these from memory or from stale pages. Read the
canonical source.

- Tenancy model: tenants are `av`, `ebw`, `hh`, and `client:<id>`. The
  `shhdbite_AV.leads` table is the single source of truth for AV leads.
- Tier names: `audit_only` | `sprint` | `momentum` | `scale`. Canonical
  definition: `lib/client-portal/tiers.ts`.
- Prices (canonical: lib/client-portal/tiers.ts + docs/PRODUCT_VISION.md):
  audit_only = free, Sprint = $1,995/mo, Momentum = $3,995/mo, Scale = $7,995/mo.
  Never quote prices from memory; if a price appears wrong on a surface, fix the
  surface to match the canonical source, do not copy the wrong value.
- Schema changes: every migration is pre-reserved in
  docs/SESSION_COORDINATION.md before it is written. Read the registry first.
- Never show per-unit API / inference cost on any client-facing surface.

---

## What this doc does NOT govern

This manifesto is about intelligence flow and the client journey. It does not
prescribe visual style, and it does not restrict delight.

- Playful, expressive, and "retro wow" design is welcome where it fits. The
  Pop-Journey sparkles and celebratory moments are intentional and stay.
- Animation, confetti, and reveal moments are a design decision, not something
  this doc bans. Use judgment about context (a calm operator triage view and a
  celebratory client moment can feel different on purpose).
- Visual identity, typography, and motion are builder's discretion in service of
  the brand. This doc only asks that delight never gets in the way of clarity
  about "what matters now."

---

## How to use this doc

1. Read this before building, alongside docs/SESSION_COORDINATION.md.
2. For any new feature, name which pillar it serves and which Reality/Horizon
   row it moves.
3. Make sure the feature reads shared intelligence where relevant and emits
   events for what it does.
4. If a feature serves neither pillar, raise it before building it.
