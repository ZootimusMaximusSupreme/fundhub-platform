---
description: Fundhub ad and VSL animation overlays — order, matte, timing, frequency, see-through only
alwaysApply: true
---

# Animation rules

**Owner law (2026-10-25):** See-through overlays only. Nothing covers Chris or the captions. Overlays go on last, after the cut and after Submagic captions. Full book: `marketing/ads/ANIMATION-RULES.md`. Where this law and `docs/specs/marketing-machine-2026-10-04.md` §9.4 disagree on full-frame mode or animation count, **this law wins**.

**Code (owner-set 2026-10-25):** This rule is law now. Writer, validators, and pipeline code may lag until the marketing system is 100% wired — no rush. Hand-built animation work follows this rule today. Code catches up in the same change when that path goes live.

Placing clips on a finished export also follows `animation-overlay-on-spoken-words`, `animation-no-echo`, `animation-logo-only-on-fundhub`, and `animation-builders-opus-placers-sonnet` unless this rule says otherwise.

## 1. Order (2026-10-04)

Animation overlays always go on last: after the cut and after captions.

Pipeline: film → cut → Submagic captions → Chris downloads → animation overlays → finalize.

The master Submagic sees never has animations in it.

Captions: Submagic template "Hormozi 2" ("Hormozi 1" is the backup). Submagic AI B-roll stays off.

## 2. Never cover Chris (2026-10-25)

Animations never cover Chris's face, body or hair, and never cover the captions. There is no full-frame mode. Every animation is a see-through overlay.

Before placing animations, track Chris's position in every frame of the Submagic export (a per-frame matte of his outline).

Animation size is at the AI's discretion, but no pixel of an animation may overlap Chris's matte on any frame. Check every frame, not once per clip.

Two placements:

- **Beside:** see-through overlay in open space (safe zones in section 8).
- **Behind:** animation is the background; Chris is composited in front (matte cutout), then captions. Use for products, dashboards, processes, comparisons. Use Beside for quick anchors.

## 3. What gets an animation (2026-10-25)

An anchor is a visual of an emotion, a contrast, or a list. Money gets less emphasis; the payoff is always shown on screen.

**Products:** show the product working on screen when the script explains it (e.g. Capital Blueprint dashboard).

**Credibility:** real proof only — not AI-generated visuals. Examples: Chris's posts from 10 years ago; approvals spreadsheet with dates visible, PII blurred, bank names visible. A dollar total ($1M+ funded) does not show credibility; the approvals do.

Diagrams and overlays for financial and technical points. Chris's B-roll from `DRIVE_BROLL_FOLDER_ID` is optional, off by default.

## 4. Anchor timing (2026-10-25)

The animation starts about **0.1 s before** the anchor word begins, never after the word is said.

Anchor times come from the cut plan. If the Submagic export **length** differs from the master by more than **0.1 s**, re-map anchors using Submagic's words (export drift — not the lead-in).

If an anchor's line was cut, skip that animation and flag it.

## 5. Frequency (2026-10-25)

Replaces "at least one animation, plus one per number, step or comparison."

At least one animation every 10 seconds (~6 in a 60-second ad), more or fewer when the content calls for it.

## 6. Length (2026-10-25)

A process, system or comparison stays on screen as long as the explanation takes. No length cap.

## 7. See-through renders (only mode)

No paper, no grid, no full-frame tint — solid cards, words and objects with soft shadow. `<SeeThrough>` on by default. Alpha: ProRes 4444 `.mov` or VP9 `.webm`. 30 fps. Vertical 1080×1920 (ads); wide 3840×2160 (VSL and thank-you, filmed sideways in 4K). ffmpeg overlays on the Submagic export at anchor time; copy audio; one video re-encode.

## 8. Safe zones

Set `caption_position_y` so captions sit where overlays never draw.

Matte (section 2) wins when it exists. Fallback zones: vertical words in y 269–1248; wide one side panel (`side` left|right), left x 192–1500, right x 2340–3648, y 108–1512; nothing in middle column or bottom 30% on wide.

## 9. Brand and words

Accent #3D86F0, "fundhub." wordmark, spectrum dash, Inter. 3D depth: premium and clean, never busy. Money decoration outside face/caption zones. **Fundhub** only. Dollar figures only from script, live page, /roadmap sample, or real approval PNG. Never invent numbers, names, or claims. No "we think", "might", "maybe", "could", "likely". Catalog templates only; data-tied templates take no data props.

## Never

- Plan, place, or build animations from memory without reading this rule and `marketing/ads/ANIMATION-RULES.md` in this session
- Full-frame animations or `animation_mode='fullframe'` on shipped ads
- Overlap Chris's matte or captions on any frame
- Put animations on the master before Submagic captions
- Turn on Submagic AI B-roll
- AI-generated credibility visuals when the line asks for proof

## Always

- Cut → Submagic captions → download → overlays → finalize
- Per-frame matte check before placing each clip
- Real proof for credibility lines (spreadsheet, posts, approval PNGs with PII blurred)

## Example

```text
Ask: "Place animations on Ad 12 after Submagic."

❌ Cover Chris's face with a full-frame qualify clip for 3 s.
✅ See-through Beside clip in the side panel, starts 0.1 s before the anchor word, matte clean on every frame; Behind only for a dashboard beat with Chris composited in front.
```
