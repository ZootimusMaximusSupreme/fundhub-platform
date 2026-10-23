# Direct Book Thank You — audio check and web version (2026-10-23)

Video: `thank-you-animation-FINAL.mp4` (2560x1440, 30 fps, 63.24 s). Its audio is a bit-for-bit copy of the original `Direct Book Thank You Take 1 (Edited Pre Animation).mp4` (AAC packet md5 `0d3a5cc18542eb8c89699b4ead168669` on both). Nothing was cut or re-edited. The original file was not touched.

Rules checked: `src/ad-videos/ffmpeg-plan.mjs` (`LOUDNORM` I -14, TP -1.5, LRA 11; `FINAL_AUDIO` aac 192k 48 kHz stereo; two-pass loudnorm), `src/ad-videos/animations.mjs` (`needsLoudnessFix`: re-fix when more than 1 LU off -14 LUFS; `finalizeChecks`; +faststart), `.claude/rules/ad-video-best-of-clips.md` (defect list), `.claude/rules/video-4k-unless-ad.md`.

## Verdict per rule

| Rule | Before (original audio) | After (web file) |
|---|---|---|
| Loudness within 1 LU of -14 LUFS | NO: -18.85 LUFS (4.85 LU quiet) | YES: -14.27 LUFS (loudnorm), -14.2 (ebur128) |
| True peak at or under -1.5 dBTP | yes: -3.73 dBTP (so quiet that no peak problem) | YES: -1.84 dBTP |
| Loudness range (LRA 11 ceiling) | yes: 2.20 LU | yes: 2.00 LU |
| AAC 192k, 48 kHz, stereo | yes (aac 254k, 48 kHz, stereo) | yes (aac 191k, 48 kHz, stereo) |
| +faststart (moov before mdat) | n/a | YES: moov at byte 32, mdat at byte 71079 |
| No jumps in level between clips | yes | yes |
| No dead air or long pauses | yes | yes |
| No filler words, doubled words, false starts, stumbles | yes | yes |
| No loud breaths or mouth noise | yes (none found) | yes |
| No peaks or clipping | yes (peak -3.74 dBFS, no clipped samples) | yes |
| Silence before he speaks / after he finishes | start fine; tail 0.4-0.5 s after the last word (see below) | same (not trimmed, per instruction) |
| 4K for a non-ad | NO: 2560x1440 (Chris's call, not changed, not upscaled) | NO: 2560x1440 |

## Numbers measured on the original audio

- loudnorm pass 1 (I -14, TP -1.5, LRA 11): input_i -18.85, input_tp -3.73, input_lra 2.20, input_thresh -28.93, target_offset 0.31.
- ebur128: integrated -18.8 LUFS, LRA 2.2 LU (low -19.8, high -17.6), true peak -3.7 dBTP.
- volumedetect: mean -21.9 dB, max -3.7 dB. astats: peak -3.74 dBFS, RMS -21.86 dBFS, 2 samples at the peak (no clipping), crest factor 8.05.
- Stereo is two identical channels (largest left-right difference 0.0005).
- Level jumps: short-term (3 s) loudness from 3.1 s to 62.7 s runs -20.7 to -17.0 LUFS (3.7 LU, normal speech movement). Six-second averages run -18.1 to -19.9 LUFS (1.8 LU spread). Loudest 0.4 s moment -12.0 LUFS at 29.0 s. No step change anywhere, so the cuts do not jump in level.
- silencedetect at the repo's settings (-35 dB, 0.12 s): 18 short pauses. Longest 0.38 s (60.73-61.11 s), then 0.34 s (15.79-16.13 s), 0.30 s (28.08-28.38 s), 0.28 s (18.02-18.30 s and 58.05-58.34 s). No pause over 0.4 s inside the talking. Every pause sits at -48 to -58 dBFS RMS, so no loud breaths or mouth noise sit in the gaps.
- Start: 0.00-0.10 s is near silence (-84 dBFS), a faint soft start of "Your" 0.10-0.26 s (peak -33 dBFS), full speech from 0.28 s. About 0.1 s of lead. Fine.
- End: last word ends about 62.75 s. The sound fades to -62 dBFS by 62.95 s, then sits at -84 dBFS to 63.25 s. That is a tail of about 0.4-0.5 s after he finishes. The ad editor's rule keeps 0.15 s. It is the only item near the defect list. Not trimmed (the cuts are final); trim it if you want a tighter ending.
- Words: local whisper.cpp (small.en, word times) heard 282 words. No um, uh, like or you know. No doubled words, no false starts, no half sentences. The caption word list (`words-timeline-from-captions.txt`) shows repeats such as GOOGLE GOOGLE, but each one is the same caption word read twice by the 0.1 s picture scan, not two spoken words.

## What was done to the audio

Repo method: loudnorm pass 1 on the video's audio, then pass 2 with those numbers (`loudnormPass2Args`), then AAC 192k 48 kHz stereo. The two-pass `linear=true` cannot stay linear here. +4.85 dB would push the -3.73 dBTP peak to +1.12 dBTP, so ffmpeg uses its dynamic mode (normalization_type "dynamic"). That is the same thing the repo's own `finalArgs` does with this input.

With the repo's TP -1.5 the AAC encode overshot: final file measured -14.18 LUFS but -1.16 dBTP (0.34 dB over the -1.5 rule). So pass 2 was run again with the peak target set to -2.0 (pass 1 re-measured with TP -2). Result below. Filter used:

`loudnorm=I=-14:TP=-2:LRA=11:measured_I=-18.85:measured_TP=-3.73:measured_LRA=2.20:measured_thresh=-28.93:offset=0.48:linear=true:print_format=json,aresample=48000`

Gain applied: +4.80 dB on average, short-term moves between +4.0 and +5.2 dB, so the loudness shape of the voice is kept. The peak limiter held back the loudest syllables by 0.3 to 2.1 dB (about 50 short moments; the most at 61.2-61.3 s, 37.2 s and 13.8-14.1 s). Short-term loudness of the final audio runs -16.1 to -12.6 LUFS (3.5 LU wide; it was 3.7 LU before).

## The web file `public/funnel/thank-you-video.mp4`

- 58,895,338 bytes (56.2 MiB), 7,443 kb/s total: video 7,250 kb/s, audio 191 kb/s.
- 2560x1440, h264 High level 5.0, yuv420p (tv, bt709), 30 fps constant, 1,897 frames (same as the source), keyframe every 60 frames.
- Length 63.30 s on the container (video track 1,897 frames, audio 63.28 s); the source reads 63.24 s. Difference 0.06 s.
- AAC LC, 48 kHz, stereo, 191 kb/s.
- Index (moov) at the front of the file.
- Loudness measured again on the finished file: I -14.27 LUFS (ebur128 -14.2), TP -1.84 dBTP, LRA 2.00 LU (ebur128 1.9). Repo functions on these numbers: `needsLoudnessFix` false, `faststartFromHead` true, `finalizeChecks` fails only on "An ad must be 1080x1920" (this is not an ad).
- Picture quality against the source: PSNR 39.5 dB average (lowest frame 36.3 dB), SSIM 0.976. Native-size crops at 40 s (ProofWall card, sky gradient) look the same as the source, no banding. An 8 Mb/s try (crf 22) gave 65.3 MB and nearly the same score (PSNR 39.8, SSIM 0.977), so the smaller one was kept.
- Command (video, then audio re-attached with the filter above and the same video stream copied):
  `ffmpeg -i thank-you-animation-FINAL.mp4 -map 0:v:0 -map 0:a:0 -af "<pass-2 filter>" -c:v libx264 -profile:v high -preset slow -crf 23 -maxrate 7.2M -bufsize 14.4M -g 60 -pix_fmt yuv420p -color_primaries bt709 -color_trc bt709 -colorspace bt709 -color_range tv -fps_mode cfr -r 30 -c:a aac -b:a 192k -ar 48000 -ac 2 -map_metadata -1 -movflags +faststart out.mp4`
- Poster `public/funnel/thank-you-video-poster.jpg`: 1280x720 jpg, 142,472 bytes, taken at 2.0 s.

## Not audio, but seen: the burned-in captions (picture; not changed)

These are Submagic caption mistakes in the finished picture, with the time they show. The words he says are fine.

1. 0.2-1.0 s: "YOUR CALL IS BOOKS." (he says "booked")
2. 22.0-22.7 s: "IT DOESN'T WHEN MATCH," (words out of order; he says "when it doesn't match")
3. 24.5-26.5 s: "WHEN IT MATCHES TWO AND / THREE BANKS APPROVE YOU," (he says "2 in 3 banks approve you")
4. 40.9-42.4 s: "ADVISOR YOUR WALKS YOU THROUGH THE OPTIONS" (he says "your advisor walks you")

One wording note: at 30.1 s he says "how much you're qualified for"; the script line reads "how much you qualify for".
