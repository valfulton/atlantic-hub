# Session Coordination Protocol - "The Symphony"

**Purpose:** Multiple Claude Code sessions can ship in parallel without stepping
on each other if everyone follows this protocol. Conductor = Cowork Claude.
Players = each Claude Code session.

**Every session must read `docs/PROJECT_BRIEFING_2026-05-18.md` FIRST.** That
file is the single source of truth for what is shipped, what is queued, and
the non-negotiable rules that apply to every change.

---

## SCHEMA MIGRATION REGISTRY

Every new migration gets a pre-reserved number. NEVER pick your own number.
Check this table before writing a migration. Update this table when you ship.

| Number | File | Status | Owner / session |
| --- | --- | --- | --- |
| 001-007 | Initial schema, EBW, enrichment, Apollo | shipped | historical |
| 008 | target_business + normalized_domain + archive index | shipped | 2026-05-17 |
| 009 | client_users (portal auth) | shipped 2026-05-17 | Client Portal session, commit 50bc550 |
| 010 | system_events (unified event log) | shipped 2026-05-17 | Auto-Scoring + Events session, commit e8ee628 |
| 011 | grok_imagine_assets + grok_imagine_log | shipped 2026-05-18 | Grok Imagine session (per-lead commercials) |
| 012 | clay_enrichment_log | reserved | Clay Webhook session |
| 013 | phantombuster_runs_log | reserved | PhantomBuster Webhook session |
| 014 | outreach_mailboxes + outreach_campaigns + outreach_messages + outreach_replies + outreach_send_log | shipped 2026-05-18 | Email Outreach Automation session (HostGator SMTP + Microsoft Graph + Gmail drivers, AI drafter grounded in audit_content, approval queue, reply classifier, auto-stage advance) |
| 015 | client_users.tier rename (starter/growth -> sprint/momentum) | shipped 2026-05-18 | Grok Imagine session (pricing alignment) |
| 016 | lead_visual_briefs (Option C creative direction layer) | shipped 2026-05-18 | Grok Imagine session (visual brief) |
| 017 | social_connections + social_posts + social_publish_log | reserved | Social Posting Connectors session |
| 018 | living_score (ai_engagement_score + ai_combined_score + score_history) | in flight 2026-05-19 | Cowork Claude (VP of Sales rollout, ship 1 of 5) |
| 019+ | unreserved | available | request from conductor |

---

## FILE OWNERSHIP DURING ACTIVE SESSIONS

When a session is "in flight," other sessions DO NOT TOUCH its owned files.
Conductor updates this table when sessions begin and end.

### Currently in flight (2026-05-17)

(none — three sessions queued up: Grok Imagine, Clay Webhook, PhantomBuster Webhook, all parallel-safe with each other)

### Shipped 2026-05-17

**Session: Cosmetic + Gamification Polish** -- 6 moves landed plus radar built in raw SVG (recharts was not actually installed; saved a dependency)
- Shipped: `components/AnimatedScoreReveal.tsx`, `components/ScoreRadarChart.tsx`, `components/LeadOfTheDay.tsx`, `components/HotLeadConfetti.tsx`, `lib/ui/once_per_day.ts`
- Modified: `app/admin/av/page.tsx`, `app/admin/av/[audit_id]/page.tsx`, `app/admin/av/[audit_id]/LeadDetailTabs.tsx`, `app/admin/events/EventsTable.tsx`, `app/admin/av/[audit_id]/RescoreButton.tsx`
- Bonus moves NOT yet shipped (held for next polish pass): band-badge tooltips, sidebar "new hot leads" dot, score history sparkline

**Session: Client Portal** -- commit 50bc550 "client portal: schema 009 plus magic-link auth plus dashboard"
- Shipped: `app/api/client/*`, `app/client/*`, `lib/auth/client-*.ts`, `lib/client-portal/*`, middleware.ts client-route additions, schema/009_client_portal.sql

**Session: Auto-Scoring + Events** -- commit e8ee628 "av: system event log plus auto AI scoring on every lead insert"
- Shipped: `lib/events/log.ts`, `lib/ai/score_and_audit.ts`, `app/admin/events/*`, `app/api/admin/events/route.ts`, `app/api/admin/av/score-sweep/route.ts`, `app/api/admin/av/leads/[audit_id]/score/route.ts`, `app/admin/av/[audit_id]/RescoreButton.tsx`, `netlify/functions/score-cron.mts`, schema/010_system_events.sql
- Cross-touched + instrumented with events: lib/apollo/discoverer.ts, lib/google_places/discoverer.ts, lib/apify/discoverer.ts, lib/enrichment/enricher.ts, app/api/admin/av/discover/scrape/route.ts, app/api/admin/av/discover/scrape-bulk/route.ts, app/api/admin/av/leads/import-csv/route.ts, app/api/admin/av/leads/[audit_id]/social-content/route.ts

**Session: AV Site Polish** -- different repo (AV_livewebsite), shipped earlier

---

## RULES FOR EVERY NEW SESSION

1. **Read this doc first.** Before writing any code, confirm your owned files don't collide with anything "in flight."

2. **Reserve your schema number in this doc.** Edit the registry above. Commit immediately so other sessions see the lock.

3. **Declare your owned files in your kickoff response.** Reply to Val with: "I own files X, Y, Z and schema 0NN. I will not touch A, B, C."

4. **Cross-cutting changes need explicit listing.** If your work touches a file another session might also need (e.g., a discovery route), name it in your kickoff response so the conductor decides priority.

5. **Append to CHANGELOG.md when you ship.** One line per session: date, scope, commit hash. Next session reads this to know what's live.

6. **No silent renumbering.** If you find your schema number is already taken when you sit down to code, STOP. Tell the conductor. Get a new number.

---

## CONDUCTOR RESPONSIBILITIES (Cowork Claude)

1. **Assign scope per session.** Each kickoff doc reserves files + schema number.
2. **Update SESSION_COORDINATION.md when sessions start.** Add to "currently in flight" table.
3. **Update SESSION_COORDINATION.md when sessions ship.** Move to "shipped" rows. Update schema registry.
4. **Resolve conflicts.** If two sessions want the same file, conductor decides serialization order.
5. **Maintain CHANGELOG.md.** Add commit hashes from session reports.

---

## WHEN TO RUN N SESSIONS IN PARALLEL VS ONE AT A TIME

Run in parallel when:
- Sessions own disjoint file sets
- Sessions need different schema numbers (no shared table edits)
- One session being blocked doesn't block the other

Run sequentially when:
- Both sessions need to modify the same critical file (e.g., middleware.ts, page.tsx for a hot route)
- One session's output is input to the other (cosmetic gamification depends on auto-scoring shipping first because it animates the re-score button)
- Schema dependencies (a feature that reads system_events can only ship after the events table exists)

---

## DEPENDENCY GRAPH (active queue, May 2026)

```
[Client Portal]      [Auto-Scoring + Events]      [AV Site Polish]
       |                       |                          |
       v                       v                          v
   shipped --------> [Cosmetic Gamification]         shipped
                              |
                              v
                     [Grok Imagine]
                              |
                              v
              [Clay Webhook]   [PhantomBuster Webhook]
                  (parallel-safe with Grok)
```

Cosmetic gamification waits for events to ship (item 5 in the gamification list
needs the /admin/events page to exist). Grok Imagine has no upstream dependency
but Val sequenced it before Clay/PhantomBuster.

---

## TEMPLATE FOR FUTURE KICKOFF DOCS

Every kickoff doc must include this header section near the top:

```
## SCOPE RESERVATIONS (read SESSION_COORDINATION.md first)

- Schema migration: schema/0NN_<name>.sql (reserved 0NN in registry)
- New files OWNED: <list with full paths>
- Modified files OWNED: <list with full paths>
- Cross-touch (read + careful write): <list>
- Will NOT touch: <list of common hotspots>
- Upstream dependencies (must ship first): <list>
- Parallel-safe with: <list of other in-flight sessions>
```

If a kickoff doc doesn't have this section, the conductor missed something.
Ask before starting.
