---
description: Overlay animations must stay readable on a phone. Where they sit follows animation-rules section 2. Never tiny chips. Never park the point in his hair.
alwaysApply: true
---

# Animation size — readable on a phone

**Owner law (2026-10-25):** Chris on Capital Blueprint Ad 1: overlays were too small, half the frame went black, and “YOUR FILE” was only a spinner. **That must never ship again.** When you layer animations on a finished ad, form each clip so a person on a phone can read it without squinting. Capital Blueprint Ad 2, same day: Opus only for building animations and for fixing the layout when clips are too small; lightweight models must not build animations or ship tiny scaled overlays.

**Where it sits (owner law 2026-10-25):** Law: animation-rules (.ai/rules/animation-rules.md) section 2. This file does not pick a different spot. The space goes left, right, or top. A long multi-step visual goes in the top one-third. A shorter visual goes left, right, or top, wherever his head is not. A slight overlap behind the head is allowed. The words stay readable. Do not park the point in his hair. Do not shrink a clip into the hair to make it fit.

## Always

- **Read the frame before you scale.** Head size and position vary. It is not one fixed box. A long multi-step visual stays in the top one-third at a size you can read. The overlay may be full width inside that band. A shorter visual uses the open left, right, or top. If the side is too tight to stay readable, move the visual. Do not drop the scale into the hair.
- **Beside Chris (portrait 1080×1920), for a short visual:** the main words plate uses about **70% to 90%** of the open band (see `animation-overlay-on-spoken-words`). Schedule **scale** for those beside clips is **0.65 minimum**; **0.7+** is normal. Use the **frame layout scan** from `animation-rules` section 2, not a one-time face box.
- **Real content:** a report, dashboard, or proof beat shows the real thing, readable, in the spot section 2 names. Example: `BlueprintDashboardReal` plays the real Capital Blueprint recording (`marketing/broll/public/blueprint/blueprint-6-month-timelapse.mp4`, from `ops/workflows/build-evidence/blueprint-timelapse-2026-10-21/`). A long dashboard goes in the top one-third. Never an empty loader, an empty card, or a micro label (“CREDIT UP / 733”) with nothing you can read.
- **Words stay readable on every frame.** At least **28 px** tall on a 1080-wide frame. His head and hair do not cover the point. A slight overlap behind the head is allowed. `tools/visible-check.py` catches hidden words. It is not a license to hide half the words in his hair.
- **Finish the point:** the clip stays on until the idea lands; do not flash a badge and leave.
- **Full frame:** output stays **1080×1920** filled. **No black letterbox** on the left or right from wrong scale or overlay math.
- **Check before lay-on:** `node marketing/broll/scripts/validate-overlay-schedule.mjs <schedule.json>`. A schedule row gives `mode`, `scale`, `words_on_video_box` (or `words_boxes`), `min_text_px_clip`, and for behind clips `visible_words_fraction` plus `content_source` for product and proof beats. The hook `scripts/hooks/guard-overlay-schedule.mjs` runs the same check when a `schedule.json` under `marketing/ads/animation-plans/` is saved and when `build-from-schedule.py` is run, in Claude and in Cursor, and stops the lay-on when it fails.

## Never

- Schedule beside clips at **scale below 0.65** (Ad 1 used about 0.46–0.52 — defect).
- Ship **spinner-only**, **eyebrow-only**, or a card whose point sits in his hair, when the beat needs a report, dashboard, or proof.
- Use a **lightweight model** to build or redesign templates in `marketing/broll/src/`, or to change a clip's size to make it fit (Opus only — `animation-builders-opus-placers-sonnet`).

## Examples

Stills, labeled, on Capital Blueprint Ad 2: `marketing/ads/animation-plans/capital-blueprint-ad-2-2026-10-25/examples/`

- `example-1-BAD-too-small.jpg` — a plate at scale 0.48 beside his head. The words cannot be read on a phone.
- `example-2-BAD-empty-behind-head.jpg` — the point sat in a dark card in his hair: a title and nothing else. That does not pass.
- `example-3-OK-behind-head-shows-dash.jpg` — the words that matter are readable outside the hair. A long dashboard belongs in the top one-third, with at most a slight overlap behind the head. An empty card with the point in the hair does not pass.

**Does not work (Chris audit, 2026-10-25 — Capital Blueprint Ad 1)**

```text
❌ Tiny “YOUR FILE” pill + loading ring (scale ~0.48). You cannot see a credit report.
❌ “INDUSTRY TRAINING COST” and “200+” as small floating chips; left half of the video is black.
❌ “CREDIT UP / Score improving / 733” as a small top chip with no dashboard visible behind him.
❌ Composer-built fake mini-dashboard with nothing readable on screen.
```

**Works**

```text
✅ Long: the top one-third, readable, full width in that band when the frame allows. A slight overlap behind the head is fine. The point stays out of the hair.
✅ Short: left, right, or top, where the head is not, big enough to read on a phone.
✅ Proof: ProofWall with real approval cards at a size you can read the bank and amount.
✅ Maximum funding: QualifyToday / MoneyClimb at a scale where the dollar amount is the hero.
```

## Who builds vs places

Law: `animation-builders-opus-placers-sonnet` — **Opus** builds and changes templates and the catalog, and owns layout sizing (scale, spot, crop) when a clip is unreadable. **Sonnet or lighter** does only the mechanical steps after Opus writes the schedule: render finished clips, lay-on, mux, sound.
