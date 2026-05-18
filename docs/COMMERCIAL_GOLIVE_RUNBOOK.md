# Grok Imagine -- Go-Live Runbook

Ship the new AI commercial generator on a lead. Follow top to bottom.
Should take under 15 minutes if nothing surprising.

---

## 1. Get your xAI API key (3 min)

1. Open https://console.x.ai/team/default/api-keys
2. Sign in (or sign up if first time). You may need to add a payment
   method on the billing page before the key works.
3. Click "Create API key". Name it `atlantic-hub-prod`. Copy the key
   (starts with `xai-...`) somewhere safe.

You only need one key for the whole platform; it works for both image
and video generation.

---

## 2. Add the key to Netlify (1 min)

1. Open https://app.netlify.com/sites/atlantic-hub/configuration/env
2. Click "Add a single variable".
3. Key: `XAI_API_KEY`
4. Value: paste the `xai-...` key.
5. Scope: All scopes / All deploy contexts (default is fine).
6. Save.

You do **not** need to redeploy yet. The next push will pick up the env
var automatically.

---

## 3. Run the schema migration (2 min)

1. Open phpMyAdmin (HostGator cPanel -> phpMyAdmin).
2. Click into the `shhdbite_AV` database in the left sidebar.
3. Click the "SQL" tab at the top.
4. Open the file `atlantic-hub/schema/011_grok_imagine.sql` in your
   editor, copy the whole file, paste it into the SQL window.
5. Click "Go".
6. Expected output: a few "skipped -- already exists" info rows on
   re-runs, or success messages on the first run. The migration is
   idempotent, so running it twice is safe.

Quick sanity check (paste in the same SQL tab):

```sql
SHOW TABLES LIKE 'grok_imagine%';
DESC grok_imagine_assets;
SELECT COUNT(*) FROM grok_imagine_assets;
```

Expected: two tables (`grok_imagine_assets`, `grok_imagine_log`),
DESC shows all the columns from schema 011, count is 0.

---

## 4. Verify the build locally (3 min)

From your terminal:

```bash
cd "$HOME/Library/CloudStorage/OneDrive-atlanticandvine.com/HunterHoney/_organized/atlantic-hub"
npx tsc --noEmit
npm run build
```

Both should finish clean. `npm run build` ends with `Compiled successfully`.
If you get a "Cannot find module @/lib/grok/..." error, run
`rm -rf .next` and try again. (The repo had a stale `.next` from May 12.)

---

## 5. Commit + push (2 min)

```bash
git add -A
git status   # confirm only the new + modified files I listed below show up
git commit -m "grok imagine: per-lead ai commercial generation, schema 011"
git push origin main
```

The commit should touch:
- `schema/011_grok_imagine.sql` (new)
- `lib/grok/imagine.ts` (new)
- `lib/grok/discoverer.ts` (new)
- `app/api/admin/av/leads/[audit_id]/commercial/route.ts` (new)
- `app/api/admin/av/leads/[audit_id]/commercial/[asset_id]/route.ts` (new)
- `app/admin/av/[audit_id]/CommercialPanel.tsx` (new)
- `app/admin/av/[audit_id]/LeadDetailTabs.tsx` (one tab added)
- `docs/ENV_VARS_REFERENCE.md` (XAI_API_KEY row added)
- `docs/CHANGELOG.md` (new 2026-05-18 entry)
- `docs/SESSION_COORDINATION.md` (schema 011 marked shipped)
- `docs/PROJECT_STATUS_2026-05-18.md` (new)
- `docs/COMMERCIAL_GOLIVE_RUNBOOK.md` (this file)

Netlify auto-builds in ~90s.

If git push fails with a lock error: restart your computer, retry.

---

## 6. Smoke test on a real lead (3 min)

1. Wait for the Netlify deploy to finish (check the green check at
   https://app.netlify.com/sites/atlantic-hub/deploys).
2. Open https://atlantic-hub.netlify.app/admin/av and click into any
   lead that has `audit_content` populated. A lead with an existing
   strategic audit gives the best commercial -- the prompt builder reads
   that field.
3. Click the new **"Commercials"** tab (between AI Scoring and Notes).
4. Asset type: Image. Model: Quality. Aspect ratio: 16:9. Resolution: 1K.
5. Leave the custom prompt blank.
6. Click **Generate image**. Wait 5-15 seconds.
7. Expected: the image appears in the asset grid below, status pill
   reads `succeeded`, cost reads `$0.05`.
8. Click **Download** to confirm the URL works.

Now test video:

1. Same lead, switch the toggle to **Video**.
2. Duration: 6 seconds. Aspect ratio: 9:16 (vertical). Resolution: 1K (= 480p).
3. Click **Generate video**.
4. Expected: a placeholder card appears immediately with status
   `running` and a pulsing dot. The panel auto-polls every 5 seconds.
5. After 30 seconds to ~2 minutes the card updates to `succeeded`, the
   `<video controls>` element appears, cost reads `$0.30`.

---

## 7. Spot-check the database (1 min)

Back in phpMyAdmin SQL tab:

```sql
SELECT id, asset_type, model, generation_status, cost_usd, created_at, completed_at
FROM grok_imagine_assets
ORDER BY created_at DESC LIMIT 5;

SELECT id, endpoint, model, outcome, cost_usd, latency_ms, called_at
FROM grok_imagine_log
ORDER BY called_at DESC LIMIT 5;

SELECT event_type, status, payload, execution_time_ms, created_at
FROM system_events
WHERE event_type = 'commercial.generated'
ORDER BY created_at DESC LIMIT 5;
```

Expect rows in all three tables matching the two commercials you just made.

---

## 8. Things that can go wrong

| Symptom | Cause | Fix |
| --- | --- | --- |
| 503 "XAI_API_KEY not configured" | Env var not saved in Netlify, or last deploy was before the save | Save again, trigger a fresh deploy from the Netlify dashboard |
| 502 "xai api error" status 401 | API key is wrong or revoked | Re-copy from console.x.ai, save in Netlify |
| 502 "xai api error" status 402 | Billing not enabled on the xAI team | Add a payment method at console.x.ai billing |
| 429 | Hit xAI rate limit (free tier is tight) | Wait a minute, retry. Upgrade billing tier if it keeps happening. |
| Video stuck on 'running' for >5 min | xAI job legitimately slow or timed out upstream | Refresh the panel (auto-polls); if still stuck after 10 min, delete the asset and regenerate. Logs land in `grok_imagine_log`. |
| Image returns broken URL | xAI URL expired by the time you clicked download | Rare; regenerate. Long-term we'll rehost on download (TODO). |
| 422 on schema run | Already ran | Idempotent guard saw existing table; safe to ignore |

---

## 9. PENDING -- deferred pricing decisions

Per Val 2026-05-18: **pricing surfaces are intentionally untouched** by
this session. The functionality ships, the pricing story decides later.
Here's the punch list waiting on your call:

1. **`AV_livewebsite/js/packages.js`** -- add a `commercials` field
   inside `sprint` / `momentum` / `scale` (volume numbers + model +
   note). Per the conductor's correction doc:
   - sprint: 4 videos + 8 images, model grok-imagine-image
   - momentum: 12 videos + 24 images, model grok-imagine-image-quality
   - scale: 30 videos + 60 images, model grok-imagine-image-quality
     (NOTE: kickoff doc said pro, but pro is deprecated 2026-05-15 so
     we should use quality here too)
   - Update each tier's `includes` array with the commercial line items.
   - Add `addon_extra_videos_pack` ($390 for 10) and
     `addon_extra_images_pack` ($180 for 20) as `type: 'one_time'`
     add-ons.
   - Do **not** change `monthlyPrice` -- those are tied to live Stripe
     payment links.

2. **`AV_LAUNCH_PROMO` + `calculateLaunchPlusAnnual()`** -- new launch
   discount object in packages.js (20% off, end date your choice).

3. **`atlantic-hub/marketing/commercials-pricing.html`** -- the page
   I built earlier still has Demo / Debut / Encore / Headliner names.
   Rebuild against Sprint / Momentum / Scale at the real prices
   ($1,995 / $3,995 / $7,995) keeping the pop-tour aesthetic. Add
   strikethrough launch pricing + countdown.

4. **`lib/client-portal/tiers.ts`** -- the `ClientTier` type still
   reads `'audit_only' | 'starter' | 'growth' | 'scale'`. Real names
   per packages.js are `'audit_only' | 'sprint' | 'momentum' | 'scale'`.

5. **`schema/015_tier_rename.sql`** -- migration to rename the
   `client_users.tier` ENUM values from starter/growth -> sprint/momentum.
   Idempotent, same information_schema pattern.

6. **`docs/PRODUCT_VISION.md`** -- swap all Starter/Growth references
   for Sprint/Momentum at the new prices. Drop the legacy "$1,497" note.

7. **Run `js/setup-stripe-products.php`** to sync the new add-on
   Stripe products and capture the generated price/payment-link IDs.

Once you've made the pricing decisions (or just signed off "go with
what's in the correction doc"), this whole punch list is about a 90-min
session for one Claude. Until then, the per-lead generator works fine
on its own.

---

## 10. Demo script (for client-facing magic moment)

> "Here's your strategic audit. Now let me show you what we'll do with it.
>
> [Click the lead, click the Commercials tab.]
>
> The AI just read your audit. Watch what happens when I push this button.
>
> [Click Generate Image. Wait 8 seconds.]
>
> That's an on-brand hero image for your business in eight seconds. Same
> framing for any post, any platform, any campaign.
>
> [Click Generate Video, switch to 9:16 vertical.]
>
> And that's a six-second commercial for Reels and TikTok. Want a 10
> second one with a different aspect ratio? Pick a number, click
> generate. The commercial reads from your audit, so it stays on-brand
> automatically.
>
> This is part of every active plan. The Sprint plan gets 4 of these a
> month, Momentum gets 12, Scale gets 30. That's just the commercials
> side of what we do."

End of runbook.
