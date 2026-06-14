# Handoff — Spinoff B: "Invite co-pilot" (joint tenants / co-pilot logins)

**Date:** 2026-06-11
**Feature:** Let two people log in with separate emails but see the SAME client brand.
**Test case:** Kevin Lyons + Maile Lyons both on The Flame (`client_id` 16).

---

## What this does, in plain terms

You can now add a **second login** to any brand. Both people sign in with their
own email and see the exact same brand hub. Both get the weekly digest email.
On approval cards you'll see **who approved** and a **"joint authority"** badge
when a brand has two or more logins — meaning either person's green light counts,
and nothing is ever blocked waiting on the other.

Where to use it: open a client at **Admin → Clients → (the brand)**, look under
the **"Send access"** section. There's a new **"Co-pilots on [brand]"** panel
with the current logins and an **"+ Invite co-pilot →"** button. Type their
email, optionally tick "email the sign-in link to them," and send. You get a
one-time sign-in link back to copy if you'd rather send it yourself.

---

## The one architectural decision (and why)

The spec said "pick one path": a new `co_owners[]` column **or** multiple
`client_users` rows. **No new column was needed.** The database already allows
many logins per brand — `client_users.email` is unique but `client_users.client_id`
is not (see `schema/009_client_portal.sql`). A co-pilot is simply another
`client_users` row bound to the same `client_id`. This matches the spec's
"Don't build a separate co-pilot role" — co-pilots are full client users with
full access; the joint nature is brand-level, not permission-level.

**So: no database migration is required for this feature.**

---

## Files added

- `lib/av/account_team.ts` — `inviteCopilot()`, `listCopilots()`,
  `countActiveClientLogins()`, and `resolveApproverDisplayName()`.
- `app/api/admin/av/clients/[client_id]/copilots/invite/route.ts` — the invite API
  (owner + staff only).
- `app/admin/av/clients/[client_id]/InviteCopilotPanel.tsx` — the roster + invite UI.

## Files changed

- `app/admin/av/clients/[client_id]/page.tsx` — renders the new panel.
- `lib/client/weekly_digest.ts` — the digest now **fans out to every co-pilot**
  on the brand (was: a single recipient). Best-effort; a co-pilot email failure
  never breaks the primary send. Existing callers are unaffected.
- `app/api/admin/av/cockpit/greenlight/route.ts` — approval now returns
  `approvedByName` + `jointAuthority`.
- `app/admin/av/clients/[client_id]/cockpit/page.tsx` — passes `jointAuthority`.
- `app/admin/av/clients/[client_id]/cockpit/CockpitClient.tsx` — shows the
  "✓ Approved by [name] · joint authority" badge on green-lit cards.

---

## One thing to know about the approval badge

Today, drafts are green-lit from the **operator cockpit** (your side), so the
"Approved by …" name is whoever clicked Green light there. The **"joint authority"**
badge appears automatically whenever a brand has 2+ logins — that's the part that
signals the brand is jointly held and that either co-pilot's sign-off is sufficient.

Letting Kevin or Maile click "approve" from **their own** client dashboard (so the
badge reads "approved by Kevin") is a natural **follow-up** — it needs a small
client-side approve action. The attribution plumbing is already in place to show
their name the moment that exists (`resolveApproverDisplayName` already resolves
both client and operator identities). Say the word and I'll add it.

---

## Final step the sandbox couldn't run for me

My type-check/commit shell was down (disk space), so I couldn't run these for you.
A developer (or you) runs them from the project folder:

```bash
# 1. Type-check — confirms everything compiles
npx tsc --noEmit

# 2. If clean, commit + push
git add -A
git commit -m "Spinoff B: Invite co-pilot (joint tenants / co-pilot logins)"
git push
```

If `tsc` reports anything, send me the output and I'll fix it. No database
migration to run — the data model already supported this.
