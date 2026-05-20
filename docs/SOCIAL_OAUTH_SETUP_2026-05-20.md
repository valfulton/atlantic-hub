# Social OAuth Setup -- Operator Checklist (Val, in parallel with build session)

**Run these in this order. None of them require code from the build
session -- they prep the credentials the session will plug in.**

Estimated time: 30-45 minutes of clicking, plus a 1-day verification
wait on LinkedIn and instant on X. Meta + TikTok are not in v1, defer
their developer-app registrations.

---

## STEP 1 -- Generate the encryption key (30 seconds)

Open Terminal. Paste:

```
openssl rand -hex 32
```

Copy the 64-character hex string it prints. You will paste it into
Netlify in Step 4 as `SOCIAL_TOKEN_ENCRYPTION_KEY`. Save it in 1Password
under "Atlantic Hub - SOCIAL_TOKEN_ENCRYPTION_KEY" so you can rotate
it later without losing access to any stored connection.

---

## STEP 2 -- Register the LinkedIn app (10 minutes + 1 day verification)

1. Open: https://www.linkedin.com/developers/apps/new
2. Fill in:
   - **App name:** Atlantic Hub
   - **LinkedIn Page:** select your Atlantic & Vine company page (create one first at https://www.linkedin.com/company/setup/new/ if you do not have one)
   - **App logo:** upload a 100x100 PNG of the Atlantic Hub honeycomb mark
   - **Legal agreement:** check
3. Click Create app.
4. On the app's Auth tab, add this Authorized redirect URL:
   - `https://atlantic-hub.netlify.app/api/admin/social/oauth/linkedin/callback`
5. On the Products tab, request:
   - **Share on LinkedIn** (instant approval)
   - **Sign In with LinkedIn using OpenID Connect** (instant approval)
   - **Marketing Developer Platform** (1-day review -- not blocking v1 since Share on LinkedIn is enough for personal-profile posts)
6. On the Auth tab, copy:
   - **Client ID** -> goes to Netlify as `LINKEDIN_CLIENT_ID`
   - **Client Secret** -> goes to Netlify as `LINKEDIN_CLIENT_SECRET`

---

## STEP 3 -- Register the X (Twitter) app (15 minutes, requires $100/mo Basic plan)

1. Open: https://developer.x.com/en/portal/dashboard
2. If you do not already have an X Developer account: sign up, choose
   the **Basic** plan ($100/month). The Free tier does not allow
   posting via API.
3. Once subscribed: Projects & Apps -> Create new app.
   - **App name:** Atlantic Hub
   - **App permissions:** Read and write
   - **Type of App:** Web App
4. Add this Callback URL:
   - `https://atlantic-hub.netlify.app/api/admin/social/oauth/x/callback`
5. Add this Website URL:
   - `https://atlantic-hub.netlify.app`
6. Save. Then on the Keys and Tokens tab, generate / copy:
   - **OAuth 2.0 Client ID** -> goes to Netlify as `X_CLIENT_ID`
   - **OAuth 2.0 Client Secret** -> goes to Netlify as `X_CLIENT_SECRET`
   - Important: do NOT use the API Key / API Secret on the same page --
     those are the old OAuth 1.0a credentials. The build session uses
     OAuth 2.0.

---

## STEP 4 -- Add all five env vars to Netlify (5 minutes)

Open: https://app.netlify.com/sites/atlantic-hub/configuration/env

For each row below, click Add a variable -> Add a single variable,
paste the key and value, scope to All scopes, save.

| Variable | Value | Where it came from |
| --- | --- | --- |
| `SOCIAL_TOKEN_ENCRYPTION_KEY` | the 64-char hex string from Step 1 | openssl |
| `LINKEDIN_CLIENT_ID` | Client ID from Step 2 | LinkedIn app Auth tab |
| `LINKEDIN_CLIENT_SECRET` | Client Secret from Step 2 | LinkedIn app Auth tab |
| `X_CLIENT_ID` | OAuth 2.0 Client ID from Step 3 | X app Keys and Tokens |
| `X_CLIENT_SECRET` | OAuth 2.0 Client Secret from Step 3 | X app Keys and Tokens |

After all five are saved, do NOT trigger a deploy yet -- the build
session will push the social code which triggers the deploy
automatically. Adding env vars now means the first deploy already has
them.

---

## DEFERRED -- Meta and TikTok (do these later, do not block v1)

Meta (Instagram Business + Facebook Pages + Threads) requires a Meta
Business app + business verification + app review. That process takes
3-10 days minimum. Skip for v1. When ready, the build session has
abstractions wired in so Meta plugs in without code changes.

TikTok for Developers requires a 1-2 week review. Skip for v1.

When you want to start either, ping me and I will give you a
deferred-mode setup doc identical to Steps 2-4 for those providers.

---

## VERIFICATION AFTER THE BUILD SESSION SHIPS

Visit https://atlantic-hub.netlify.app/admin/social -- the LinkedIn
and X cards should now show a working **Connect LinkedIn** / **Connect
X** button. Click LinkedIn -> sign in -> approve -> you should land
back on /admin/social with the new connection listed.

If the button still says "SHIPS NEXT SESS," the build did not push yet
or env vars are missing. Open Netlify deploys page and confirm the
latest deploy is green.

---

## SPEED-UP NOTES (since you asked)

Three things that will get social ship in your hand faster:

1. **Start Step 2 (LinkedIn) right now.** LinkedIn's automatic
   verification of the company page is the only async wait in the
   whole pipeline. Triggering it now means by the time the build
   session ships, LinkedIn is already verified and you can connect
   immediately.

2. **Skip the X paid plan if you do not need X day-one.** LinkedIn
   alone covers the agency-grade B2B use case. Adding X is +$100/mo
   for what is mostly noise traffic for restaurant / hospitality leads.
   Decision is yours -- if you skip, the build session still wires the
   X provider so you can flip it on later by adding the X env vars.

3. **Do not chase Meta or TikTok in this session.** Their review
   queues will gate you for a week-plus. The build is multi-provider
   ready; you can drop in Meta and TikTok the day their reviews clear,
   no rebuild needed.
