---
description: After overlay finalize, agents must frame-review the final mux before calling it acceptable
alwaysApply: true
---

# Animation overlay — frame review before handoff

**Owner law (2026-10-25):** Capital Blueprint Ad 1 shipped with tiny overlays, black voids, and blocked layout because the agent trusted `schedule.json` and validators, not the **finished pixels**. Before Chris is told an overlaid ad or VSL is **done** or **acceptable**, run a **frame review on the final mux** (Submagic export + overlays + audio level pass). Law: animation-rules (.ai/rules/animation-rules.md) section 2 — the **frame layout scan** applies to what actually shipped, not only to the plan.

## Always

- Review the **final mux file** you will hand to Chris (for example `review-final.mp4` in scratch, or the leveled export after step 7 in `fundhub-video-animation-overlay`). Not the pre-overlay master alone.
- **Extract frames** with ffmpeg (or existing plan tools such as `make-sheet.py` / `make-sheet.sh`) at:
  - Each scheduled clip: **start, middle, and end** (by time or frame index from `schedule.json`).
  - Each **anchor word** time from `anchors.json` or the word timeline.
  - **Spot checks** across the full length (about every **5–10 s**, plus the hook in the first 10 s).
- **View the frames** (agent vision or human eye). Do not call acceptable from `schedule.json`, green validators, or lint alone.
- Judge every sampled frame against:
  - Face or hair blocked? Caption band blocked?
  - Readable size on a phone? (Law: animation-size-readable (.ai/rules/animation-size-readable.md))
  - Black voids, letterbox, or half-empty frame?
  - Matte / **Behind** correct where used?
  - Law: animation-no-echo (.ai/rules/animation-no-echo.md) — labels do not repeat his sentence.
  - Law: animation-logo-only-on-fundhub (.ai/rules/animation-logo-only-on-fundhub.md) — logo only on Fundhub lines.
- Write a **verdict** in plain English, exactly one of:
  - **Acceptable**
  - **Not acceptable** (fix and re-review; do not hand off)
  - **Acceptable with named timestamp fixes** (list each `MM:SS.s` fix; apply fixes and re-sample those windows)
- **Save evidence** under the animation plan directory (or scratch path linked in the plan README):
  - A contact sheet (for example `contact-sheet-final.jpg`) and/or a `frame-review/` folder of PNGs, plus
  - `frame-review-pass.json` with `verdict`, `final_mux`, `reviewed_at`, `frames_sampled`, and optional `fixes` / `learnings`.
- Optional one-line learnings: append to the plan **README** if it exists; do not create a new markdown file unless Chris asked for one.
- Before handoff, run `npm run animation:frame-review-check -- <plan-dir>` (or `node scripts/animation-overlay-frame-review-check.mjs <plan-dir>`). It **warns only**; it does not replace viewing frames.

## Never

- Tell Chris an overlaid video is done, acceptable, or ready to audit without a frame review on the **final mux**.
- Use "looks good", "should be fine", or "validator passed" as the verdict.
- Skip re-review after any change to overlays, matte, scale, schedule, or post-overlay audio re-encode.

## Skip switch (agents only)

Set `FUNDHUB_SKIP_FRAME_REVIEW=1` for one command to silence the reminder script. That does **not** waive the law for a real handoff to Chris.

## Example

```text
Final mux is leveled at -14 LUFS. schedule.json passes validate-overlay-schedule.

❌ "Size check OK — sending Chris the file."
✅ Extract frames at each clip start/mid/end, anchors, and every 8 s; view them; verdict Acceptable;
   save contact-sheet-final.jpg + frame-review-pass.json; then send the video.
```

## Who

Law: animation-builders-opus-placers-sonnet (.ai/rules/animation-builders-opus-placers-sonnet.md) — whoever finishes lay-on, mux, and sound (Sonnet or lighter after Opus wrote the schedule) runs the frame review before handoff.
