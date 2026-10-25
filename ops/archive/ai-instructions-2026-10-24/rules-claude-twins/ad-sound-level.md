# Ad sound level

**Owner law (2026-10-23):** Every finished video is set to **-14 LUFS**, true peak at or under **-1.5 dB**. That is the common level for Facebook and online video. Submagic downloads come back quiet (measured -27 to -30 LUFS).

## Always

- Set the level, then measure with `ebur128=peak=true` and write both numbers in the report.
- Copy the picture. Do not re-encode the video.
- After Submagic, measure again. If it moved more than 1 LU, set it back to -14.
- A video that is not at -14 is not done.

How: the `fundhub-video-animation-overlay` skill (step 7, two-pass `loudnorm`) and the `fundhub-ad-editor` skill (`edit.py`) both do it. This rule is the one source for the numbers.
