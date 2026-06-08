# KYC → DD Report End-to-End Test Walkthrough

**Audience:** val running CBB (Adriana's collections brand) as the demo client.
**Goal:** validate that the entire intake → KYC → DD chain works with real
data, and that fixing one field in one place propagates everywhere.

This is the smoke test to run AFTER each commit lands on Netlify.

---

## Step 0 — Wait for Netlify deploy

Push pending: `4b011ab → 9226882 → (commit landing next)`. Netlify rebuild
takes ~3 minutes. Open https://atlantic-hub.netlify.app/admin/av/clients
once the build banner clears.

---

## Step 1 — Open CBB and fix the brief

Navigate to the operator client page for **CBB** (Adriana's collections
brand, NOT CLDA — pick one for the test, you can repeat for the other).

Scroll to the **Brief / Intake editor** (top of the client page) and confirm
ALL of these are filled:

| Field | Expected value | If empty → fix → so KYC… |
|---|---|---|
| `company` | "Central Business Bureau" | …queries company by name |
| `short_name` | "CBB" | …displays brand chip correctly |
| `contact_name` | "Adriana Candelaria" | …screens marketing POC |
| **`owner_name`** | "Adriana Candelaria" | …screens the LEGAL OWNER (the KYC target) |
| `business_state` | "CA" | …state-scopes CourtListener |
| `business_address` | her street address | …address screen + Census ACS |

**Why owner_name matters:** the new field added in `#537`. KYC sweep
screens this person specifically. If empty, only company gets screened
and you lose the personal-history check.

Hit **Apply** to save the brief.

---

## Step 2 — Re-apply the client_screening pack

Scroll up to the **Vertical pack** panel. If it shows `✓ Applied · re-apply`
on **Pre-engagement DD**, click that to re-derive panel configs from your
updated brief. The chip should refresh with the current timestamp.

This re-populates CourtListener + CFPB panel configs with the new owner_name.

---

## Step 3 — Run Full KYC Sweep

Scroll to **Due Diligence · OPERATOR ONLY**. Hit **⚡ Run Full KYC Sweep**.

**What to check in the sweep result:**

```
Sweep ran · N flags added
Read from brief: company="Central Business Bureau" · contact_name="Adriana Candelaria" · owner_name="Adriana Candelaria" (KYC target) · state="CA"
✓ uspto_patents · 0 hits
  Queried: "Adriana Candelaria", "Central Business Bureau"
✓ courtlistener · X hits
  Queried: "Adriana Candelaria" + "Central Business Bureau" in CA · all time
  → [Case name] · Court · Date · matched "Central Business Bureau"
  → [Case name] · Court · Date · matched "Adriana Candelaria"
✓ cfpb · X hits
  Queried: "Central Business Bureau" in CA · last 1825d
```

**Verify:**
- ✅ `owner_name` shows in the snapshot (not "EMPTY ⚠️")
- ✅ Each step's `Queried:` line lists owner + company
- ✅ Each hit row is a clickable link (sky blue)
- ✅ States scope to CA

If `owner_name` shows EMPTY ⚠️, go back to Step 1.

---

## Step 4 — Screen each address

Hit **🏠 Screen each address**.

**What to check:**
- Adriana's address geocodes (no red "could not geocode" line)
- HMDA market signal appears for her county
- Per-property record stub note ("Forsyth County GA is the first county
  with the Browserless adapter wired; others land as adapters ship") OR
  if she's outside Forsyth, "Per-property adapter for [county], CA not yet
  wired"
- The address auto-populates into the Address History list at top of
  Due Diligence

---

## Step 5 — Generate DD Report

Hit **📄 Generate DD Report**. The modal opens with the polished markdown.

**What to verify in the report:**
- Subject line uses company name + owner name
- Executive Summary lists flags by severity
- Identity table shows company, contact, owner, industry, website
- Address History section
- Public Records Findings section organized by source
- Operator Notes (from the dossier free-form notes)
- Methodology + disclaimer

**Open as PDF** (top right) — your browser print dialog opens. Save as PDF.
This is the deliverable val sends to a recipient.

---

## Step 6 — Repeat for CLDA (Adriana's second brand)

Do steps 1-5 on CLDA. Compare the two outputs. They should differ in:
- company name (Candelaria's LDA Services vs Central Business Bureau)
- court hits (different brand names)
- HMDA data (same county since same operator address)

This confirms the system handles a single owner with multiple brands
correctly.

---

## Step 7 — Send results back

Reply to this chat with:
- A screenshot of the sweep result on CBB
- Any "EMPTY ⚠️" markers you saw
- Whether the Galvez 2008 case opens in CourtListener when clicked
- The DD Report's flag count + any rendering issues

That's the signal I need to know which fix bundle to ship next.

---

## What's NOT yet shipped (queued for the next bundle)

- `owner_dob_year` and `owner_personal_address` as dedicated brief fields
  with intake-form input (currently lives in dossier panel)
- Auto-populate HMDA + Census ACS panel configs on pack apply
- Website audit suggestions surfaced in the DD Report's "Website Health"
  section as actionable bullets (currently only the 9-axis scores show)
- DD Report saved as a persistent PDF in asset_provenance (currently
  print-to-PDF is one-time)
- Socials gap surfaced in DD Report as an improvement opportunity (not a
  red flag)
- Onboarding "Socials" chip flipping to "no socials found · audit
  opportunity" when Quick Prep finds none

If any of those is more critical than the smoke test outcome above, say
the word and I'll re-prioritize.
