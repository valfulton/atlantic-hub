# Email Outreach Automation — Go-Live Runbook

**Ship date:** 2026-05-18
**Audience:** Val (operator). Hand this to a future operator unchanged.
**Owner files:** schema/014, lib/email/*, lib/ai/outreach_drafter.ts, lib/ai/reply_classifier.ts, app/api/admin/av/outreach/*, app/admin/av/outreach/*, netlify/functions/outreach-poll-cron.mts.

This doc walks you from "I just pulled the branch" to "I sent my first AI-drafted outreach
email and saw it auto-advance the lead." Follow in order.

---

## 1. Apply the schema migration

Open HostGator phpMyAdmin → click `shhdbite_AV` in the sidebar so the top reads
"Database: shhdbite_AV" → SQL tab → paste the entire contents of
`schema/014_outreach.sql` → Go.

Verify with:
```
SHOW TABLES LIKE 'outreach_%';
```
You should see five tables: `outreach_mailboxes`, `outreach_campaigns`,
`outreach_messages`, `outreach_replies`, `outreach_send_log`. The migration is
idempotent so re-running it later is safe.

---

## 2. Decide which mailboxes you want to send from

You can connect any combination of:

1. **HostGator SMTP** — fastest setup. Use any cPanel-created mailbox like
   `outreach@atlanticandvine.com`. Just need host/port/user/password.
2. **Microsoft Graph (Outlook / Microsoft 365)** — recommended for your main
   sending identity. Replies land in your normal Outlook inbox where you're
   already working. Requires a one-time Azure App Registration.
3. **Gmail API (Google Workspace / personal Gmail)** — same model as Outlook,
   for clients on Google. Requires a one-time Google Cloud OAuth client.

For each driver you plan to use, follow the matching subsection below. You can
do this in any order; you don't need all three to start.

### 2A. HostGator SMTP setup

Nothing to configure in Netlify. Skip straight to section 3.

DNS hygiene (do this once for your sending domain so emails land in inboxes
instead of spam folders):

- **SPF**: add a TXT record at the root of `atlanticandvine.com`:
  `v=spf1 +a +mx include:hostgator.com ~all`
  (If you also send from Microsoft, append `include:spf.protection.outlook.com`.
  If from Google, append `include:_spf.google.com`.)
- **DKIM**: in cPanel → "Email Deliverability" → click "Manage" next to
  `atlanticandvine.com` → enable DKIM. HostGator will publish the TXT record for you.
- **DMARC**: TXT record at `_dmarc.atlanticandvine.com`:
  `v=DMARC1; p=quarantine; rua=mailto:dmarc@atlanticandvine.com`

These take 5–60 minutes to propagate. You can send before they propagate, but
deliverability will be worse until they do.

### 2B. Microsoft Graph (Outlook) setup

One-time Azure App Registration:

1. Go to portal.azure.com → Azure Active Directory → "App registrations" → "New registration"
2. Name: **Atlantic Hub Outreach**
3. Supported account types: **Accounts in any organizational directory and personal Microsoft accounts**
4. Redirect URI: **Web** → `https://atlantic-hub.netlify.app/api/admin/av/outreach/mailboxes/oauth/microsoft/callback`
5. Click "Register"
6. From the Overview tab, copy the **Application (client) ID**
7. Certificates & secrets → "New client secret" → 24-month expiry → copy the **Value** (not the Secret ID — the Value)
8. API permissions → "Add a permission" → Microsoft Graph → "Delegated permissions" → check: `offline_access`, `Mail.Send`, `Mail.Read`, `User.Read` → Add permissions
9. If you have a work tenant, click "Grant admin consent"

Now set these three env vars in Netlify (Site configuration → Environment variables):

- `MICROSOFT_OAUTH_CLIENT_ID` = the Application (client) ID from step 6
- `MICROSOFT_OAUTH_CLIENT_SECRET` = the Value from step 7
- `MICROSOFT_OAUTH_REDIRECT_URI` = `https://atlantic-hub.netlify.app/api/admin/av/outreach/mailboxes/oauth/microsoft/callback`

Trigger a redeploy in Netlify so the new env vars are visible to the running app.

### 2C. Gmail API setup

One-time Google Cloud OAuth client:

1. console.cloud.google.com → create a new project named "Atlantic Hub Outreach"
2. APIs & Services → "Library" → search and enable **Gmail API**
3. APIs & Services → "OAuth consent screen" → **External** → fill name, support email, dev email → on the Scopes step add: `https://www.googleapis.com/auth/gmail.send`, `https://www.googleapis.com/auth/gmail.readonly`, `https://www.googleapis.com/auth/userinfo.email`
4. Add yourself (and any test users) as Test Users while the app is in Testing mode. Submit for verification later if you'll connect external client accounts.
5. APIs & Services → "Credentials" → "Create credentials" → "OAuth client ID" → **Web application** → name "Atlantic Hub Outreach Web" → Authorized redirect URIs: `https://atlantic-hub.netlify.app/api/admin/av/outreach/mailboxes/oauth/google/callback` → Create
6. Copy the **Client ID** and **Client secret**

Set in Netlify:

- `GOOGLE_OAUTH_CLIENT_ID`
- `GOOGLE_OAUTH_CLIENT_SECRET`
- `GOOGLE_OAUTH_REDIRECT_URI` = `https://atlantic-hub.netlify.app/api/admin/av/outreach/mailboxes/oauth/google/callback`

Trigger a redeploy.

---

## 3. Connect your first mailbox in the UI

Visit `/admin/av/outreach/mailboxes`.

### For HostGator SMTP

Click the "HostGator SMTP" card. Fill:

- Display name: anything, e.g. "Atlantic outreach"
- From email: e.g. `outreach@atlanticandvine.com`
- From display name: e.g. "Atlantic and Vine"
- SMTP host: `mail.atlanticandvine.com` (default)
- Port: 465 (SSL) — port 587 (STARTTLS) also works
- Username: usually the full email address
- Password: the password you set for that mailbox in cPanel

Save. Then click "Test" on the mailbox row. You should see "Test OK" with a
sub-second latency. If you see "auth_error", the password is wrong; if
"connection_error", the host/port is wrong or HostGator's SMTP is blocked
from your sending environment.

### For Outlook / Gmail

Click the matching card, fill display name + from address only, save. The
app redirects you to Microsoft/Google's consent screen. Approve the scopes.
You land back at `/admin/av/outreach/mailboxes` with a "connected" flash.
Click "Test" — should return "OK".

---

## 4. Create your first campaign

Visit `/admin/av/outreach/new`.

Recommended starter values:

- Name: e.g. "Hot AV leads — May 2026"
- Send from mailbox: the one you just connected
- Offer summary: a paragraph the AI grounds every draft in. Keep it specific.
- CTA: e.g. "Open to a quick 15-minute call this week to see if it fits?"
- Signature: plural voice, no founder name. e.g. "— the Atlantic and Vine team"
- Daily send cap: start at **5/day** (matches your stated cadence)
- Require operator approval before send: **YES** (always, until you trust the drafts)
- Auto-advance lead_status: **YES**
- Initial status: **Active**

Save. You land on the campaign detail page.

---

## 5. Send your first draft

Open any high-scoring lead (Hot band). Click the new "Outreach" tab. Pick
your campaign in the dropdown. Click **Generate draft**.

In ~10 seconds you'll see the AI's draft inline — subject + body + the audit
excerpt the email is hooked on. If the lead has `audit_content`, you'll see
"audit-grounded" highlighted; if not, it falls back to company + industry
context.

Read it. If it sounds right, click **Approve + send**. The system will:

1. Enforce the daily cap (per-mailbox, per-campaign, per-tier)
2. Send via the driver
3. Stamp the lead `contacted` (lead_status auto-advance from `new`)
4. Log `outreach.sent` to `system_events`
5. Log a row in `outreach_send_log` for auditing

If it doesn't sound right, click **Reject** with an optional reason, then
click Generate again for a fresh try. Each generation costs ~$0.005 in
OpenAI usage.

---

## 6. Watch the loop close on replies

When a recipient replies, the reply-poll cron picks it up within 15 minutes
(Microsoft Graph and Gmail only — HostGator SMTP reply polling lands in a
follow-up). You can also click **Poll replies now** on `/admin/av/outreach`
to fetch manually.

Each reply is classified:

| Classification | Effect |
| --- | --- |
| positive | lead_status → qualified (auto-advance) + once-per-day celebration |
| interested | lead_status → contacted if still new |
| negative | lead_status → lost |
| unsubscribe | lead_status → lost |
| autoresponder | logged only, no stage change |
| neutral / unknown | logged, no stage change |

The first positive reply each day pops a brief celebration toast (gated via
`lib/ui/once_per_day.ts`). Subsequent positives are logged silently — per
the cosmetic baseline, rarity is what makes the moment feel like a win.

---

## 7. Daily workflow (what good looks like)

Once a day, in 5 minutes:

1. Open `/admin/av/outreach`
2. Look at the **Pending approval** queue
3. For each draft: click to expand, scan, **Approve + send** or **Reject**
4. That's it.

The system handles: drafting (when you click Generate from a lead), sending,
reply matching, classification, stage advancement, event logging, and the
audit trail.

---

## 8. Where to look when something's wrong

| Symptom | Where to look |
| --- | --- |
| Generate fails with "OPENAI_API_KEY not set" | Netlify env vars |
| Approve fails with "auth_error" | mailbox needs reconnect — click Test on /mailboxes |
| Approve fails with "cap reached" | per-campaign or per-mailbox daily cap hit — edit campaign or wait until tomorrow |
| Drafts always fall back to "generic hook" | the lead has no `audit_content` — run AI Re-score on it first |
| Replies aren't showing up | check `/admin/events` for `outreach.reply_poll_failed`; click "Poll replies now" manually |
| Wrong tier names anywhere | already shipped in schema/015 (2026-05-18) — should be `sprint`/`momentum`/`scale` everywhere |

The `system_events` table is the single observability surface. Every
significant action logs there:

- `outreach.mailbox_created`, `outreach.mailbox_connected`, `outreach.mailbox_archived`
- `outreach.mailbox_test_ok`, `outreach.mailbox_test_failed`
- `outreach.campaign_created`, `outreach.campaign_updated`, `outreach.campaign_archived`
- `outreach.drafted`, `outreach.draft_failed`
- `outreach.sent`, `outreach.send_failed`
- `outreach.rejected`
- `outreach.replied` (with classification in the payload)
- `outreach.reply_poll_run`, `outreach.reply_poll_failed`
- `lead.stage_advanced` (with from/to/reason in the payload)

Filter `/admin/events` by `outreach.*` to see only the outreach trail.

---

## 9. What is NOT in v1 (planned for follow-up)

These are deliberate cuts to ship today. Each is a small follow-up:

- **HostGator IMAP reply polling.** The HostGator SMTP driver sends only;
  replies route to your normal inbox. The Microsoft and Gmail drivers
  already do automated reply polling. Adding IMAP for HostGator is a v2
  task — straightforward but adds another dependency (imapflow).
- **Drip sequences (sequence_step > 1).** The schema supports it; the UI
  ships single-step only. v2 work.
- **Client-facing `/client/outreach` page.** Currently admin-only. The
  feature gates by tier (Momentum + Scale per the tier matrix in
  `lib/client-portal/tiers.ts`); the client view is the next session.
- **Open and click tracking.** The schema has the columns; v1 ships no
  pixel/redirect tracking because cold-feeling pixels hurt deliverability.
  When wanted, we add a redirect domain + 1x1 pixel host.
- **Per-tenant tier-cap enforcement in `sendDraft`.** The pipeline accepts
  a `tier` parameter and applies the cap — but the API route calls it with
  `tier='operator'` because val is the only sender today. When the
  `/client/outreach` page ships, the route will look up the client's tier
  from `client_users.tier` and pass that instead.

---

## 10. Cost expectations

- AI drafting: ~$0.005 per draft (gpt-4o-mini, ~1000-token completion)
- AI reply classification: ~$0.003 per reply (skipped entirely for
  obvious autoresponder / unsubscribe patterns)
- Sending: $0 (your own mailboxes — no per-message third-party charge)

At your stated cadence of 5 sends/day, that's roughly $0.025/day in OpenAI
costs, $0.75/month. Even if a client at the Scale tier (200 sends/day +
similar reply volume) ramps up, you're under $50/month in OpenAI usage for
that whole tenant.

Tier prices ($1,995 / $3,995 / $7,995) versus per-tenant infrastructure cost
keeps gross margin above 95% even at full Scale usage.
