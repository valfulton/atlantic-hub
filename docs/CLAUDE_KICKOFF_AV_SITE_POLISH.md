# Claude Code Session Kickoff: AV Marketing Site Polish

**Purpose of this doc:** Drop this entire file into a fresh Claude Code session.
Different repo than atlantic-hub. Zero conflict with any in-flight Atlantic Hub work.

**Goal of the session:** Three surgical polish edits on the marketing site at
atlanticandvine.netlify.app. All copy edits, no schema, no API, no risk.

**Do not:**
- Touch atlantic-hub. Different property, different repo.
- Use smart quotes, em-dashes, or curly punctuation in commit messages.
- Rebuild or redesign anything. Surgical edits only.
- Estimate timelines. Ship it.

---

## PASTE THIS INTO THE NEW CLAUDE CHAT (top of message)

You are working on the Atlantic & Vine marketing site, atlanticandvine.netlify.app.
The owner is Atlantic And Vine LLC, operated by Val Fulton. Be confident, terse,
ASCII-only in shell commands and commit messages (no em-dashes, no smart quotes,
no curly typography of any kind).

Read this doc, then make the surgical edits below, then push.

---

## FILE LOCATIONS

- **AV site source:** `/Users/atlanticandvine/Library/CloudStorage/OneDrive-atlanticandvine.com/AtlanticandVine/ATLANTIC AND VINE management/AV website build/AV_web_2026/Claude/AV_livewebsite/`
- **Pages to edit:** `index.html` (primary), possibly `custom-solutions.html` and `pop-journey.html` if Val asks for more
- **Deploy script in the same folder:** `./deploy.sh "commit message"` wraps git add + commit + push with safety rails

---

## DEPLOY FLOW

The AV marketing site is hosted on Netlify, source at `github.com/valfulton/atlanticandvine`.
Push to GitHub triggers Netlify auto-build (~30 seconds).

From the AV_livewebsite folder:

```
./deploy.sh "site: live results stats Option 1 swap"
```

If commit fails with git lock errors, Val restarts her computer. Do not propose
moving the repo (Val has rejected this).

---

## EDIT 1: SWAP THE "LIVE RESULTS" STATS BACK TO NUMERIC WITH HONEST LABELS

The current live site has a "LIVE RESULTS" card on the homepage hero with three stats.
Val pushed an earlier edit that replaced numeric stats with capability labels
(4 / AI / 1) but feels the numeric version looked better. Restore numbers, fix labels.

**Current (live now):**
```html
<div class="stat-row">
    <div class="stat"><div class="stat-number">4</div><div class="stat-label">Discovery channels</div></div>
    <div class="stat"><div class="stat-number">AI</div><div class="stat-label">Fit scoring</div></div>
    <div class="stat"><div class="stat-number">1</div><div class="stat-label">Dashboard</div></div>
</div>
```

**Replace with (Option 1 - numeric weight restored, labels honest):**
```html
<div class="stat-row">
    <div class="stat"><div class="stat-number">100+</div><div class="stat-label">Prospects found</div></div>
    <div class="stat"><div class="stat-number">90%+</div><div class="stat-label">AI fit score</div></div>
    <div class="stat"><div class="stat-number">Days</div><div class="stat-label">To first lead</div></div>
</div>
```

Rationale:
- "100+ Prospects found" replaces "100+ Leads / Quarter" - drops the unverifiable per-quarter claim while keeping the visual weight.
- "90%+ AI fit score" replaces "94% Avg Fit Score" - aspirational floor instead of specific average. Defensible.
- "Days To first lead" replaces "14d To First Lead" - says "days not months" without committing to a specific count.

---

## EDIT 2: CHECK FOR ANY OTHER STATS PAGES

Run a grep for the same pattern across all HTML files:

```
cd "/Users/atlanticandvine/Library/CloudStorage/OneDrive-atlanticandvine.com/AtlanticandVine/ATLANTIC AND VINE management/AV website build/AV_web_2026/Claude/AV_livewebsite"
grep -l "stat-number" *.html
```

If any other page (custom-solutions.html, pop-journey.html, etc.) has the same
stat-row pattern, apply the same Option 1 treatment. If they have different
stats that look fine, leave them alone.

---

## EDIT 3: SCAN FOR ANY REMAINING BRAND-NAME REFERENCES

Val's rule: no naming SaaS vendors she pays for (Apollo, Hunter, LinkedIn, etc.)
unless they are a paid sponsor.

Run:

```
grep -in "linkedin\|apollo\|hunter\.io\|clay\b" *.html
```

For each hit, decide:
- If it names a vendor she pays for in a non-sponsor context → rewrite to generic ("LinkedIn" -> "your networks", "Apollo" -> "our discovery engine", etc.)
- If it's a paid sponsor placement (e.g., "Brought to you by Events by Water") → leave alone
- If it's a CHOICE the client makes (e.g., "Which platforms do you want content for: LinkedIn, Instagram, Facebook") → leave alone since the user is selecting destinations, not us advertising a vendor

Document each change in the commit message.

---

## VERIFICATION BEFORE COMMIT

1. Open the modified HTML file in a browser locally (`open index.html` from terminal)
2. Visually confirm the new stats render cleanly in the LIVE RESULTS card
3. Confirm no other copy got accidentally damaged

---

## COMMIT AND PUSH

ASCII-only commit message:

```
./deploy.sh "site: restore numeric stats with honest labels, scrub remaining brand names"
```

deploy.sh will:
1. Show you the git diff
2. Ask "Continue with commit?" → y
3. Push to GitHub
4. Netlify rebuilds in ~30 seconds

---

## WHEN DONE

Hand back a one-paragraph summary to Val:
- What changed
- Which files
- Commit hash
- Live URL: https://atlanticandvine.netlify.app

That's it. Ship.
