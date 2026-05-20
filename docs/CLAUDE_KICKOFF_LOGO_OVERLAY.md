# Claude Code Session Kickoff: Logo Overlay (Brand Kit per Lead)

**Purpose:** Drop into a fresh Claude Code session. Goal: let an operator
upload a client logo once, then have every generated commercial
(image + video) get the logo automatically composited into the
pre-reserved corner the AI engine left blank. No more downloading,
opening Canva, dragging-and-dropping, exporting, re-uploading.

> Path: `/atlantic-hub/docs/CLAUDE_KICKOFF_LOGO_OVERLAY.md`

---

## MANDATORY READING (in order, before any code)

1. `docs/SESSION_COORDINATION.md`
2. `docs/PROJECT_BRIEFING_2026-05-18.md`
3. `docs/CLIENT_FACING_GUARDRAILS.md`
4. `docs/SYSTEM_ARCHITECTURE.md`
5. This file

---

## WHY THIS EXISTS

Every current text-to-image / text-to-video model butchers logos.
Random warping, wrong fonts, hallucinated mascots, made-up brand
glyphs. Even when a generation looks clean, every run yields a slightly
different "logo," which destroys brand consistency.

The Commercials tab already tells the AI engine to leave clean,
low-detail negative space in a chosen corner (top-left / top-right /
bottom-left / bottom-right). The operator has been promising
themselves they'd add the logo "later in Canva." This session removes
that step.

---

## SCOPE RESERVATIONS

- **Schema migration:** `schema/023_brand_kits.sql` (reserved in
  `SESSION_COORDINATION.md` -- 017 is social posting reserved,
  018 is living_score shipped, 019 is the sales mega-ship in flight,
  021 is shipped social_drafts, 022 is reserved parent_asset_id for
  the social-posting session.)
- **New files OWNED:**
  - `lib/brand_kit/types.ts`
  - `lib/brand_kit/store.ts` (DB queries for brand_kits)
  - `lib/brand_kit/compositor.ts` (the actual image / video overlay)
  - `app/api/admin/av/leads/[audit_id]/brand-kit/route.ts` (GET, PUT)
  - `app/api/admin/av/leads/[audit_id]/brand-kit/logo/route.ts` (POST upload, DELETE)
  - `app/api/admin/av/leads/[audit_id]/commercial/[asset_id]/branded/route.ts` (GET the
    branded composite -- streams or 302s to a cached object URL)
  - `app/admin/av/[audit_id]/BrandKitPanel.tsx` (sub-panel on the
    Commercials tab OR a new "Brand kit" mini-tab)
- **Modified files OWNED:**
  - `app/admin/av/[audit_id]/CommercialPanel.tsx` -- show a "Branded"
    toggle on each asset card so the operator can switch between the
    raw asset and the composited version. Download + Push to social
    use the branded URL when toggle is on.
- **Cross-touch (read + careful write):** lib/grok/discoverer.ts -- on
  successful generation, if a brand_kit exists for the lead AND
  auto-brand is on, kick off the composite (best-effort, async).
- **Will NOT touch:** any `/client/*` route, any `/api/client/*`, any
  auth file, any existing OAuth / social-posting code.
- **Upstream dependencies:** Schema 011 (grok_imagine) shipped.
- **Parallel-safe with:** Social Posting Connectors session, Clay
  webhook, PhantomBuster webhook.

---

## DATA MODEL

```sql
USE shhdbite_AV;

CREATE TABLE IF NOT EXISTS lead_brand_kits (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  lead_id BIGINT UNSIGNED NOT NULL UNIQUE,
  logo_storage_path VARCHAR(512) NULL,  -- where the source logo lives
  logo_mime_type VARCHAR(64) NULL,
  logo_width INT UNSIGNED NULL,
  logo_height INT UNSIGNED NULL,
  -- Composite defaults the operator picks once per lead.
  default_position ENUM('top-left','top-right','bottom-left','bottom-right')
                   NOT NULL DEFAULT 'bottom-right',
  default_opacity DECIMAL(3,2) NOT NULL DEFAULT 1.00,  -- 0.00 to 1.00
  default_scale DECIMAL(4,3) NOT NULL DEFAULT 0.150,   -- logo width as fraction of frame
  default_padding INT UNSIGNED NOT NULL DEFAULT 24,    -- pixels from the edge
  -- Auto-apply on every generation (the default Val asked for).
  auto_apply BOOLEAN NOT NULL DEFAULT TRUE,
  -- Audit
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by_user_id BIGINT UNSIGNED NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Per-asset cached composite output so we don't re-render on every page load.
CREATE TABLE IF NOT EXISTS commercial_branded_renders (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  source_asset_id BIGINT UNSIGNED NOT NULL,
  brand_kit_id BIGINT UNSIGNED NOT NULL,
  -- The full config snapshot used so cache busts when settings change.
  position ENUM('top-left','top-right','bottom-left','bottom-right') NOT NULL,
  opacity DECIMAL(3,2) NOT NULL,
  scale DECIMAL(4,3) NOT NULL,
  padding INT UNSIGNED NOT NULL,
  output_storage_path VARCHAR(1024) NOT NULL,
  output_mime_type VARCHAR(64) NOT NULL,
  bytes BIGINT UNSIGNED NULL,
  duration_ms INT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_branded_source (source_asset_id),
  KEY idx_branded_kit (brand_kit_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

---

## COMPOSITING

### Image overlay (the easy half)

Use `sharp` (already a workable npm dependency, very fast, MIT-licensed)
in the Netlify Functions runtime. Pseudocode:

```ts
const source = await fetch(asset.storage_url).then(r => r.arrayBuffer());
const logo = await fetch(brandKit.logoUrl).then(r => r.arrayBuffer());
const baseImg = sharp(Buffer.from(source));
const meta = await baseImg.metadata();
const logoWidthPx = Math.round((meta.width ?? 1024) * brandKit.default_scale);
const resizedLogo = await sharp(Buffer.from(logo)).resize({ width: logoWidthPx }).toBuffer();
const out = await baseImg
  .composite([{
    input: resizedLogo,
    gravity: gravityFromPosition(brandKit.default_position),  // 'northeast' etc
    blend: 'over',
    // opacity via SVG wrapping if < 1.0
  }])
  .toBuffer();
```

### Video overlay (the harder half)

Use `ffmpeg-static` + `fluent-ffmpeg`. Build the filtergraph:

```
ffmpeg -i source.mp4 -i logo.png -filter_complex \
  "[1:v]scale=iw*${scale}:-1[lg];[0:v][lg]overlay=${x}:${y}" \
  -c:a copy out.mp4
```

Cache the result, return a public URL. If ffmpeg execution exceeds
Netlify Function timeout (10s on the standard tier), fall back to a
backgrounded ffmpeg task and return the cached URL on the next GET. Use
schema/scheduled function for the queue.

### Storage

For v1, write the composite to a temp Netlify Function dir and stream
it back; the route at `branded/route.ts` serves it on demand. Cache the
final URL in `commercial_branded_renders.output_storage_path`. Phase 2:
rehost to S3 / R2 for permanent URLs. The asset rehosting work parked
in section 4 of the PROJECT_BRIEFING applies here too.

---

## ENV VARS

| Name | Purpose | Required |
| --- | --- | --- |
| `FFMPEG_PATH` | Override for ffmpeg binary location | optional |

Sharp ships its own binaries. No additional env var needed.

---

## UI

### BrandKitPanel.tsx

A sub-card on the Commercials tab (or new tab):

- **Upload area:** drag-drop or click. Accepts PNG (transparent
  preferred), SVG, JPG. Max 2 MB. Server validates dimensions
  (min 64x64, max 4000x4000).
- **Position dial:** 4-corner picker (matches the existing logo-space
  selector on the generator card).
- **Scale slider:** 5% to 30% of frame width.
- **Opacity slider:** 50% to 100%.
- **Padding spinner:** 0-64 px from the edge.
- **Auto-apply toggle:** on by default. When on, every new generated
  asset shows the branded version immediately.
- **Preview:** show the most recent asset with the current settings
  composited live (small thumbnail re-renders on slider change with a
  300ms debounce).

### Commercial asset card -- "Branded" toggle

Add a "Branded" toggle to each asset card. When on (default if the
lead has an active brand_kit with auto_apply), the displayed media
URL switches to the branded composite. Download + Push to social use
the branded URL.

When off, the raw asset is shown.

---

## VERIFY BEFORE COMMIT

1. `npx tsc --noEmit` exit 0
2. `npm run build` succeeds
3. Schema 023 idempotent in phpMyAdmin
4. Upload a transparent PNG logo on a real lead. Generate a new
   commercial. Open it. Logo appears in bottom-right with the default
   scale. Looks tight.
5. Generate a video commercial. Open it. Logo appears in the same
   corner for the full duration.
6. Toggle the asset card Branded toggle off. Raw asset returns.

---

## CLIENT-FACING ETIQUETTE

Per `docs/CLIENT_FACING_GUARDRAILS.md`: nothing in this feature talks
about per-unit cost. The composite work is "free" from the client's
point of view -- it's bundled into the tier.

---

## ON FINISH

1. Update `docs/PROJECT_STATUS_<date>.md`.
2. Append to `docs/CHANGELOG.md`.
3. Mark schema 023 shipped in `docs/SESSION_COORDINATION.md`.
4. Add to `docs/PROJECT_BRIEFING_2026-05-18.md` section 3 (shipped).
5. Hand back a one-paragraph summary to Val.

Ship.
