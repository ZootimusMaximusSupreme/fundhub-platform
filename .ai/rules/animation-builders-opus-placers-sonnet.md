---
description: Opus builds and changes animation templates and owns layout sizing; Sonnet and lighter models only place finished animations and do the mechanical render, mux and sound
alwaysApply: true
---

# Opus builds animations. Sonnet places them.

**Owner law (2026-10-24):** Chris: "Sonnet doesn't build animations. Opus does. Make sure that's the rule. Then Sonnet places them."

**Owner law (2026-10-25), Capital Blueprint Ad 2:** Opus only for building animations, and for fixing the overlay layout when clips are too small. Lightweight models must not build animations or ship tiny scaled overlays.

## Always

- **Opus** builds every new animation and makes every change to an existing one: anything in `marketing/broll/src/` (templates, props, brand pieces, length caps), `marketing/broll/catalog.json`, and the broll tests.
- **Opus owns layout sizing.** When a clip is too small to read on a phone, or the point sits in his hair, Opus fixes it: the scale, the spot, the crop, and which template to use. Opus writes those numbers into `schedule.json`. Law: animation-rules (.ai/rules/animation-rules.md) section 2 — left, right, or top; a long multi-step visual in the top one-third; only a slight overlap behind the head; words stay readable. Law: animation-size-readable (.ai/rules/animation-size-readable.md) - never unreadable, and do not shrink a clip into the hair.
- **Sonnet** places finished animations on a video: word times, anchors, schedule, props text, render, lay-on, sound, frame review on the final mux, checks, contact sheet. Law: animation-overlay-frame-review (.ai/rules/animation-overlay-frame-review.md).
- **Lighter models (Sonnet, Composer, Grok) do only the mechanical steps after Opus has written the schedule:** render the clips, lay them on, mux, and fix the sound. They run `node marketing/broll/scripts/validate-overlay-schedule.mjs <schedule.json>` before the lay-on. If it fails, they stop and hand the layout back to Opus.
- When a Sonnet placer needs a template that doesn't exist, or needs one to work differently, it stops that animation, writes the need in `marketing/ads/animation-plans/new-animations-needed.md`, and places the rest. An Opus agent builds it, then Sonnet places it.

## Never

- A Sonnet agent editing `marketing/broll/src/`, adding a template, or changing a template's prop, length cap or look.
- A lighter model shrinking a clip's scale to make it fit, or shipping a schedule the size check failed.
- Opus spent on placing, when the templates it needs already exist and the layout already reads well.

## Example

```text
The VSL needs a "Click the link below" button and no template has one.

❌ The Sonnet placer writes LinkButton.tsx and uses it.
✅ The Sonnet placer adds "LinkButton: CTA button with a cursor press" to new-animations-needed.md
   and places the other animations. Opus builds LinkButton. Sonnet places it.
```

```text
A long dashboard is unreadable, or the point sits in his hair.

❌ Composer sets scale 0.48 so it fits beside his head, and ships.
✅ Opus puts the long dashboard in the top one-third, words readable, with at most a slight overlap behind the head, writes the schedule,
   and the size check passes. Then a lighter model renders, muxes and levels the sound.
```

Related: `.cursor/rules/animation-overlay-on-spoken-words.mdc`, `.cursor/rules/animation-no-echo.mdc`, `.cursor/rules/animation-size-readable.mdc`.
