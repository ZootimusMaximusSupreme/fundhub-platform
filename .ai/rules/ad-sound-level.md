---
description: After Submagic and after post-Submagic edits, recheck audio, smooth voice level and tone, then land at -14 LUFS
alwaysApply: true
---

# Ad sound level

**Owner law (2026-10-23):** Every finished video is set to **-14 LUFS**, true peak at or under **-1.5 dB**. That is the common level for Facebook and online video. Submagic downloads come back quiet (measured -27 to -30 LUFS).

**Owner law (2026-10-25):** Sound is not decibels only. After Submagic, and again after any post-Submagic video work, **recheck the audio** and **smooth** Chris's voice: matched tonality across the take, and each word stays at roughly the same loudness. Merged clips fail when one line jumps and another drops. Post-Submagic edits (animation overlays, caption or font refinements, any re-encode that touches audio) can **clip** — fix that in the smooth pass, do not ship clipped audio.

## Always

- **Recheck after Submagic.** Measure when the Submagic export lands. Do not assume the download is safe for the next step.
- **Recheck after post-Submagic work.** Any overlay finalize, caption/font tweak, or mux that changes audio gets the same recheck and smooth pass before the file is done or handed to Chris to audit.
- **Smooth, then level.** Smoothing means even voice loudness word-to-word and consistent tone across joined clips — not only hitting -14 on the meter. Then set **-14 LUFS** and true peak at or under **-1.5 dB**.
- Measure with `ebur128=peak=true` and write both numbers in the report, plus whether a smooth pass ran and clipping was found.
- Copy the picture when the pipeline allows. Do not re-encode video for level alone when `-c:v copy` is valid.
- After Submagic, if integrated loudness moved more than 1 LU from the last good pass, run the full smooth + level workflow again.
- A video that is not smoothed, not rechecked after post-Submagic work, or not at -14 is not done.

How: the `fundhub-video-animation-overlay` skill (step 7) and the `fundhub-ad-editor` skill (`edit.py`) follow this rule. Pre-Submagic merge/cut audio prep stays in `fundhub-ad-editor`; post-Submagic recheck and smooth stays in the overlay finalize path. This file is the one source for the numbers and for when to recheck.

## Never

- Ship post-Submagic animation or audit exports without rechecking audio after that edit.
- Treat -14 LUFS alone as done when voice still jumps between merged clips or words.
- Skip smoothing because "Submagic already cleaned it."

## Example

```text
Submagic export is quiet at -28 LUFS. Overlays are laid on and the file is muxed.

❌ Copy audio through, run loudnorm once, report -14, ship.
✅ Recheck for clip peaks, smooth voice level and tone across the take, then two-pass loudnorm to -14, measure true peak, report all of it.
```
