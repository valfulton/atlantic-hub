# Atlantic & Vine — Brand Book

_The single source of truth for the look. If a decision isn't here, it isn't a rule. Last updated 2026-06-05._

## 1. The philosophy

- **Color never works solo — it POPS or it ANCHORS.** Judge color only in combination, never as a swatch.
  - **Anchor** = the calm grounds that hold the room and rest the eye: cream, white, deep forest, near-black.
  - **Pop** = gold. Saved for the moments that earn it (a win, a hot signal, a milestone). It reads because it's rare.
- **Luxury that celebrates.** Restraint everywhere, sparkle on the moment that deserves it. Sexy and mysterious, never cheesy.
- **Legibility and clarity trump all.** The one hard rule. Everything else flexes (harmony, not dogma).
- **The UI begins with type.** Get the type right first; color and motion hang off it.

## 2. The palette (exact hex)

### Anchors (grounds)
`--ground` cream `#FAF8F4` · `--paper` white `#FFFFFF` (cards) · `--forest` `#0A3D2E` (hero) · near-black `#0A0A0A` (footer / nav / grounding).

### Green (the accent — one token, swappable later)
`--emerald-deep` `#0A4D3C` (accent, buttons, **headlines**) · `--emerald` `#0C6049` (hover/jewel) · `--emerald-mist` `#DCEDE5` (quiet chip).

### Gold (the POP — matched to the logo's real pixels)
Bronze `#7D5B3C` (anchor; the **only** gold legible as text on cream) · Antique `#A9842A` · **Core `#CFAF65`** (the brand gold) · Bright `#E6CE7E` · Champagne `#F5F4C0` (glint, dark-only). Live "leaf" = `--gold-leaf-grad` (the five blended + a slow subtle shimmer).

### Ink / metals
`--ink` `#14201B` (body text) · `--muted` `#5C6862` · cream-on-dark `#FAF8F4` · silver/platinum `#C9D1DC` (the logo's "Vine" on dark).

## 3. The rules that matter

- **No black headlines, ever.** Headlines on light = emerald `#0A4D3C`; on dark = cream or gold. Body/meta = ink `#14201B`.
- **Gold is pop, not paint.** Rare, metallic, a slow shimmer (12s, a whisper — not a slot machine). On cream it's borders/fills/accents; the only gold *text* on cream is bronze `#7D5B3C`. Champagne/bright gold = dark grounds only.
- **Green is an accent, not a field.** Green text + the hero box + buttons — not green slabs on every card.
- **Dark is for grounding, not cards.** Footer, nav, hero, the gate. Never black card surfaces, never funeral.
- **Confetti / pop-wow** belongs on *earned* moments (a win, a milestone) — not ambient.
- **Cards** = white `#FFFFFF` on cream, a soft emerald shadow + one thin gold-leaf top edge. Contrast does the lifting.

## 4. The logo

The logo is the brand — a metallic-gold mark with the vine; never let it fade, never tape it on as an afterthought (give it size + presence). Use the **best existing file** for now (val will return with a refreshed logo). Two placements:
- **Dark grounds** → full-gold logo (champagne highlights pop); "Vine" → silver `#C9D1DC`.
- **Light grounds** → bronze-gold + near-black wordmark; drop the thin champagne strokes (they vanish on white).

Send the **official secret gold hex** and it's a one-line token overwrite — every gold updates at once.

## 5. Type (foundation — being dialed in next)

Fraunces = display / headlines (emerald). Inter = body / chrome. Body floor 16px; only uppercase eyebrows go smaller (≥11px). No italic body paragraphs. One scale, defined once.

## 6. Surfaces

- **Client portal** = cream/white + green accent + gold pop + dark footer/nav. The brand face.
- **Operator cockpit** = dark workshop register (density OK; AA the only hard rule). Doesn't need to match the client face.
- **Velvet Royale** = the exploration / rep-arena sandbox — the place to try dramatic/dark/sparkle ideas without breaking the main brand.

## 7. Process + direction

- **Nothing ships without a UI/UX pass.** Route all deliverables (copy, UI, content) by the UI/UX chat; the **newsroom edits copy**. Approval gate still holds — nothing auto-publishes.
- **All color flows through tokens** (`brand-tokens.css`) — one editable root, no inline hex. A restyle is a one-file edit.
- **Direction:** a newstation heading toward **web3**; asset protection + provenance (C2PA) are leading-edge, core, not side features.
