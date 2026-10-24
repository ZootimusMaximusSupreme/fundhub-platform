---
description: Opus builds and changes animation templates; Sonnet only places finished animations on videos
alwaysApply: true
---

# Opus builds animations. Sonnet places them.

**Owner law (2026-10-24):** Chris: "Sonnet doesn't build animations. Opus does. Make sure that's the rule. Then Sonnet places them."

## Always

- **Opus** builds every new animation and makes every change to an existing one: anything in `marketing/broll/src/` (templates, props, brand pieces, length caps), `marketing/broll/catalog.json`, and the broll tests.
- **Sonnet** places finished animations on a video: word times, anchors, schedule, props text, render, lay-on, sound, checks, contact sheet.
- When a Sonnet placer needs a template that doesn't exist, or needs one to work differently, it stops that animation, writes the need in `marketing/ads/animation-plans/new-animations-needed.md`, and places the rest. An Opus agent builds it, then Sonnet places it.

## Never

- A Sonnet agent editing `marketing/broll/src/`, adding a template, or changing a template's prop, length cap or look.
- Opus spent on placing, when the templates it needs already exist.

## Example

```text
The VSL needs a "Click the link below" button and no template has one.

❌ The Sonnet placer writes LinkButton.tsx and uses it.
✅ The Sonnet placer adds "LinkButton: CTA button with a cursor press" to new-animations-needed.md
   and places the other animations. Opus builds LinkButton. Sonnet places it.
```

Related: `.cursor/rules/animation-overlay-on-spoken-words.mdc`, `.cursor/rules/animation-no-echo.mdc`.
