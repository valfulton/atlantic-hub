# Smoke Test: Clay Enrichment Webhook

Run this after deploying the Clay receiver and applying schema 012. It
confirms the endpoint authenticates correctly, rejects junk, ingests a
real row, and dedups repeats.

Receiver: `POST /api/admin/av/integrations/clay-webhook`
Status page: `/admin/av/integrations/clay`
Schema: `schema/012_clay_enrichment.sql` (table `clay_enrichment_log`)

---

## 0. Prerequisites

1. Commit deployed to atlantic-hub on Netlify (build green).
2. `schema/012_clay_enrichment.sql` applied in phpMyAdmin against
   `shhdbite_AV`.
3. `CLAY_WEBHOOK_SECRET` set in Netlify env vars and a redeploy done.

There is only ONE new variable for this feature: `CLAY_WEBHOOK_SECRET`.
You generate it yourself. It is NOT a Clay API key. See section 5.

---

## 1. Confirm the secret is wired

Open `/admin/av/integrations/clay` while logged in as owner or staff.
Expect the green banner: "CLAY_WEBHOOK_SECRET is set".
If it reads "NOT set", the env var is missing or the deploy has not
finished. Fix before continuing.

---

## 2. Auth check (expect 401)

Replace BADSECRET with anything wrong. Run in a terminal:

```
curl -i -X POST https://atlantic-hub.netlify.app/api/admin/av/integrations/clay-webhook -H "X-Webhook-Secret: BADSECRET" -H "Content-Type: application/json" -d "{}"
```

Expect: HTTP 401 and body `{"ok":false,"error":"unauthorized"}`.

---

## 3. Empty-payload check (expect 400)

Use your REAL secret in place of REALSECRET:

```
curl -i -X POST https://atlantic-hub.netlify.app/api/admin/av/integrations/clay-webhook -H "X-Webhook-Secret: REALSECRET" -H "Content-Type: application/json" -d "{}"
```

Expect: HTTP 400 and body `{"ok":false,"error":"invalid_payload"}`.
The endpoint accepted the secret but found no usable fields.

---

## 4. Real row check (expect 200, inserted)

```
curl -i -X POST https://atlantic-hub.netlify.app/api/admin/av/integrations/clay-webhook -H "X-Webhook-Secret: REALSECRET" -H "Content-Type: application/json" -d "{\"company\":\"Smoke Test Co\",\"email\":\"owner@smoketestco.com\",\"website\":\"smoketestco.com\",\"contact_name\":\"Pat Tester\",\"contact_title\":\"Owner\",\"industry\":\"restaurant\"}"
```

Expect: HTTP 200 and body like `{"ok":true,"outcome":"inserted","leadId":1234}`.

Then:
1. Refresh `/admin/av/integrations/clay`. A row appears in "Last 50"
   with outcome Inserted and a link to the new lead.
2. Open the lead. Confirm company, email, contact name, and title landed.

---

## 5. Repeat-send check (expect 200, duplicate or updated)

Run the EXACT same curl from section 4 again. Because the receiver now
stamps each Clay row with a `clay:<row_id>` token (or dedups by domain
when no row id is sent), the second send should NOT create a second
lead.

Expect: HTTP 200 with outcome `duplicate` (nothing new to fill) or
`updated` (it filled a blank field). The status page should still show
ONE "Smoke Test Co" lead, not two.

Note: this test row has no Clay row id, so the dedup happens on the
website domain (smoketestco.com). Real Clay rows carry a row id, which
adds a second safety net.

---

## 6. Clean up the test lead

In `/admin/av`, find "Smoke Test Co" and archive it so the test data
does not pollute the pipeline.

---

## Expected response shapes (reference)

| Situation | HTTP | Body |
| --- | --- | --- |
| Bad or missing secret | 401 | `{"ok":false,"error":"unauthorized"}` |
| Secret set is empty server-side | 401 | `{"ok":false,"error":"unauthorized"}` |
| Body is not valid JSON | 400 | `{"ok":false,"error":"invalid_json"}` |
| No usable fields | 400 | `{"ok":false,"error":"invalid_payload"}` |
| Over 100 posts/min for one table | 429 | `{"ok":false,"error":"rate_limited"}` |
| New lead created | 200 | `{"ok":true,"outcome":"inserted","leadId":N}` |
| Existing lead, blanks filled | 200 | `{"ok":true,"outcome":"updated","leadId":N,"fieldsFilled":[...]}` |
| Existing lead, nothing to add | 200 | `{"ok":true,"outcome":"duplicate","leadId":N}` |

---

## Wiring Clay to send rows (the integration itself)

This receiver is PUSH based: Clay sends to us. You do NOT need a Clay
API key for this.

1. In Clay, open the table whose enriched rows you want to flow in.
2. Add an outgoing step that sends each row to an HTTP endpoint. In
   Clay this is the "HTTP API" action column or the table-level "Send
   to Webhook" automation, depending on your Clay layout. Look for the
   option that lets you POST a row to a URL.
3. Method: POST. URL:
   `https://atlantic-hub.netlify.app/api/admin/av/integrations/clay-webhook`
4. Add a custom header. Name: `X-Webhook-Secret`. Value: the same
   string you set as `CLAY_WEBHOOK_SECRET` in Netlify.
5. Map the body fields. The receiver reads many common names, so you do
   not have to match exactly, but the cleanest mapping is:
   company, email, phone, website, linkedin_url, contact_name,
   contact_title, industry, location. Send a row id field too if Clay
   exposes one (any of: row_id, clay_row_id, id) so repeat sends dedup.
6. Run one row from Clay and watch it appear on
   `/admin/av/integrations/clay`.
