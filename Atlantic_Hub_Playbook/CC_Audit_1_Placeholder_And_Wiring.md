# CC Audit #1 — Placeholder + Wiring Smoke Test

Hand this prompt to a fresh Claude Code session in atlantic-hub. The goal: find every place the system LOOKS complete but isn't actually wired — UI scaffolding without a backend, buttons that don't fire, mock data still on a real page, tables that get written but never read, scheduled tasks declared but not running.

Run from: `/Users/atlanticandvine/Library/CloudStorage/OneDrive-atlanticandvine.com/HunterHoney/_organized/atlantic-hub`

---

## The Prompt

You're auditing Atlantic Hub (Next.js + MySQL) for "placeholder code" — things that look done but aren't. The owner (val) has been finding that lots of features were built fast for visibility, but the last-mile wiring (DB save, real fetch, scheduled trigger, etc.) was left as a stub. She wants a comprehensive list ranked by leverage.

### Pass 1 — Explicit placeholder markers

Grep the entire codebase for these patterns. Report every hit with file:line + a one-line description of what's incomplete:

```
// TODO
// FIXME
// XXX
// HACK
// PLACEHOLDER
// stub
// mock
// not implemented
// coming soon
'Coming soon'
"Coming soon"
disabled.*coming.soon
return \[\];  (in API routes — likely an empty stub)
return null;  (in data-access libs — likely a stub)
```

For each hit:
- File path + line
- What the surrounding code does
- Severity: BLOCKER (the feature is visible to users but does nothing) / HIGH (operator-facing surface that's broken) / MEDIUM (background system stubbed) / LOW (genuinely future work)

### Pass 2 — Dead interactive controls

Find every interactive element that doesn't do what it visually promises:

- `onClick={() => {}}` — empty click handlers
- `onClick={() => alert(` — placeholder alerts
- `href="#"` — links to nowhere
- `<button>` without an `onClick` or `type="submit"`
- `disabled` props that are hardcoded `true`
- Forms with no `onSubmit` or whose submit handler is empty

Each finding: file:line + the visible label/aria-label of the control + what it should do.

### Pass 3 — Mock data on production surfaces

Find every component or page that renders LITERAL hardcoded data instead of fetching:

- Array literals with example data (`['Lorem', 'Ipsum', ...]`)
- Object literals named `mockX`, `sampleX`, `placeholderX`, `defaultX`
- Components that don't accept data as props AND don't call a fetcher
- Imports of `*.fixture.ts` or `*.example.ts` files from real pages

Each finding: file:line + the variable name + the surface it's rendered on.

### Pass 4 — Imported but never rendered

Find components that are imported into a parent file but never appear in JSX:

```
import FooPanel from './FooPanel';
// ...no <FooPanel /> anywhere in the file
```

These are usually "built it, forgot to mount it." Each finding: parent file:line of import + component name.

### Pass 5 — Endpoints that return literal data

Find every API route (`app/api/**/*.ts` and `pages/api/**/*.ts`) whose response body is a JS literal instead of a DB-derived value:

```
return NextResponse.json({ items: [{ id: 1, name: 'Example' }] });
```

vs. real:

```
const items = await db.query('SELECT ...');
return NextResponse.json({ items });
```

Each finding: route path + line + what data it's faking.

### Pass 6 — Schema tables created but never used

For each `CREATE TABLE` in `schema/*.sql`:
- Search the codebase for `INSERT INTO <table>` and `UPDATE <table>` (write call sites)
- Search for `SELECT ... FROM <table>` (read call sites)

Report:
- Tables written but NEVER read (data is being saved but no one consumes it)
- Tables read but NEVER written (read path exists but no one writes — likely dead read)
- Tables defined but neither read nor written (pure ghost schema)

### Pass 7 — Scheduled tasks declared but not scheduled

The hub runs crons through Netlify functions AND/OR a HostGator worker. Find:
- Every file under `app/api/cron/**` or `app/api/scheduled/**`
- Every reference to `node-cron`, `setInterval`, or scheduled task patterns
- Cross-reference with `netlify.toml` and any HostGator worker config

Report:
- Cron endpoints that exist but aren't in `netlify.toml` / HostGator schedule
- Schedules registered but pointing at endpoints that 404 or no-op
- Cron functions that DO run but only succeed when a feature flag is on (and isn't)

### Pass 8 — Feature flags + disabled states

Grep for:
- `feature_flag`, `featureFlag`, `FEATURE_`
- `enabled: false`, `disabled: true`
- env var checks like `if (process.env.X !== 'true') return null;`

For each flag: what it gates, default state, where it's flipped.

### Pass 9 — "Visible but not connected" — the val test

For each panel under `app/admin/av/clients/[client_id]/` and each surface under `app/client/*`, answer:
- Does clicking every interactive control do something real (DB write OR navigation OR API call)?
- Does every displayed metric come from a real query?
- Is every "Last X at" timestamp a real persisted value?

Report any control / metric / timestamp that's faked or wired to nothing.

## Deliverable

`PLACEHOLDER_AUDIT.md` at the repo root. Structure:

```
# Placeholder + Wiring Audit (#523)

## Summary
- N BLOCKERS (user-visible features that do nothing)
- N HIGH (operator-facing breaks)
- N MEDIUM (background stubs)
- N LOW (genuinely future)

## BLOCKERS
### [file:line] One-line title
What's broken, what it looks like to val, the minimal fix.

## HIGH
...

## MEDIUM
...

## LOW
...

## Recommended queue order
Top 10 fixes by leverage — what's 80% built and just needs the last connector.
```

No code changes. Analysis only. Do not commit or push — the report IS the deliverable.

## Constraints

- No speculation — every finding backed by file:line you actually read.
- Don't list legitimately-future tasks (the "tasks" list shown in val's UI is fine to ignore) — focus on code that's IN the repo and pretends to work but doesn't.
- "Coming soon" pills that are intentional + visible to clients are LOW severity (val knows). "Coming soon" hidden in operator code where val expects something to work is BLOCKER.
- Memory references: read `Atlantic_Hub_Playbook/00_System_Map.md`, `lib/client/intake_fields.ts`, `lib/client/brief_store.ts`, `lib/public_intel/registry.ts` before starting.
