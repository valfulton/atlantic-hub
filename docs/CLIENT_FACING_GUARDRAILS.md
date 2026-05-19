# Client-Facing Guardrails

**Mandatory read for every kickoff doc, every code session.** These are
non-negotiable rules about what a paying client may and may not see in
the product. Violating any of these breaks pricing trust and is treated
as a P0 bug.

---

## Rule 1: NEVER show per-unit API / inference cost on client-facing surfaces

**Banned on client-facing surfaces:**
- "$0.05 per image"
- "$0.30 per video"
- "Costs $X in API"
- "Token usage: 1,500"
- Any dollar amount tied to a single asset, generation, lookup, or API call
- Phrases like "AI cost," "model cost," "Grok cost," "OpenAI cost"

**Allowed on client-facing surfaces:**
- Their plan price ($1,995 / $3,995 / $7,995 per month)
- Their monthly volume ("12 videos and 24 images per month")
- A-la-carte pack prices ($39 per extra video, $9 per extra image -- the *client* price, not the API cost)
- A usage counter: "5 of 12 videos used this month"

**Allowed on internal / admin surfaces** (`/admin/*` routes, owner + staff only):
- Per-asset `costUsd` (for budgeting + cost tracking)
- Cumulative spend (in `grok_imagine_log`, system_events, etc.)
- API rate-limit hits, error counts

---

## Why this matters

When a client pays $3,995/mo for Momentum, they are paying for the
*outcome* (12 commercial videos that grow their business) plus the
strategy + curation + system around it. Showing them that the raw API
costs $0.30 collapses that value story into a 40,000% markup
conversation that nobody wins.

The cost is internal. The value is what the client sees.

---

## Where to look before shipping any client-facing code

Anything under these paths is client-facing and must not contain per-unit cost:
- `app/client/**` (the Client Portal pages)
- `app/api/client/**` (the Client Portal API responses)
- `marketing/**` (the public marketing pages)
- Any email template sent to a client
- Any PDF or document generated for a client (contracts, audits, deliverables)

Anything under these paths is INTERNAL and may show per-unit cost:
- `app/admin/**`
- `app/api/admin/**`
- `docs/**` (internal docs)
- `lib/**` (server-only utilities)
- Operator dashboards, logs, observability surfaces

---

## CI / pre-commit guardrail (TODO)

Future improvement: add a grep-based pre-commit hook that scans
`app/client/**`, `app/api/client/**`, and `marketing/**` for the regex
`\$0\.[0-9]+\s*(per|/)\s*(image|video|gen|token|call|asset|request)`
and blocks the commit if it matches.

For now, this is enforced by code review.

---

## How to refer to commercial allotments on client surfaces

Use volume + cadence + outcome, not pricing.

**Good:**
- "12 AI Commercial Videos per Month"
- "Daily commercial cadence"
- "5 of 12 videos generated this month -- 7 left"
- "Need more? Add a 10-pack of extra videos for $390."

**Bad:**
- "12 AI Commercial Videos at $0.30 each"
- "Cost: $3.60 this month"
- "Grok Imagine usage: $7.68"
- "Each video costs ~$0.30 in API"

---

## Existing surfaces audited 2026-05-18

| Surface | Path | Audit result |
| --- | --- | --- |
| Admin Commercial panel | `app/admin/av/[audit_id]/CommercialPanel.tsx` | Shows per-asset cost. **Allowed** (admin-only). |
| Admin lead detail | `app/admin/av/[audit_id]/*` | Shows cost in log views. **Allowed** (admin-only). |
| Admin Outreach overview | `app/admin/av/outreach/*` | Admin-only. Shows token usage in API responses; UI surfaces sent/replied counts only. **Allowed** (admin-only). |
| Admin Outreach per-lead panel | `app/admin/av/[audit_id]/OutreachPanel.tsx` | Admin-only. **Allowed.** |
| Outreach drafter prompts | `lib/ai/outreach_drafter.ts` | Explicit rule in the system prompt: "Do not mention pricing, dollar amounts, or any per-unit API cost. Never reveal that the email was AI-generated." **Clean.** |
| Client dashboard | `app/client/dashboard/page.tsx` | No per-unit cost. **Clean.** |
| Client `/api/client/me` | `app/api/client/me/route.ts` | Returns tier features by name + volume only. **Clean.** |
| Marketing commercials page | `marketing/commercials-pricing.html` | Shows tier prices + a-la-carte client prices ($39/$9). No API-cost language. **Clean.** |

If you add a new client-facing surface, add it to this table after auditing it.
