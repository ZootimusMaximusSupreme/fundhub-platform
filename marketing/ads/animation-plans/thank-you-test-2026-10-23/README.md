# Direct Book Thank You — animation test (2026-10-23)

Chris's finished thank-you video (2560x1440, 30 fps, 63.24 s, Submagic captions already burned in) with the 8 planned see-through animations laid over it. Test copy only. The original in `~/Downloads/Direct Book Thank You Take 1 (Edited Pre Animation).mp4` is never changed.

## Where things are

| File | What it is |
|---|---|
| `words-timeline-from-captions.txt` | Every spoken word with its time, read from the burned-in caption highlights (0.1 s steps). Captions run about 0.15 s ahead of the voice. |
| `anchors.json` | Each plan anchor line matched to that timeline (all 8 matched at 1.0). `tools/align-anchors.py` makes it. |
| `schedule.json` | The readjusted schedule: start, length, side, and why, per animation. |
| `props/` | The exact Remotion props each clip was rendered with (incl. `durationInFrames`). |
| `contact-sheet-final.jpg` | One frame per animation from the final test copy, taken at the moment of its anchor line. |
| `tools/` | `align-anchors.py`, `build-from-schedule.py` (lays the clips on the video in one encode), plus the helper's `ocr.swift` / `face.swift` / `words.py` (the timeline) and the first-pass `build-test-video.sh` / `make-sheet.sh`. |

## Redo it

1. Timeline: `ocr.swift` reads the caption strip (`ffmpeg -vf fps=10,crop=2560:260:0:1100`), `words.py` turns it into the word timeline. No speech-to-text tool is installed on this Mac and the repo's transcribers call the paid OpenAI API, so the burned-in captions are the transcript.
2. Anchors: `python3 -I marketing/ads/animation-plans/thank-you-test-2026-10-23/tools/align-anchors.py`
3. Clips (from `marketing/broll`, one per row of `schedule.json`):
   `npx remotion render <Template> <clip>.mov --props=<props file> --codec=prores --prores-profile=4444 --image-format=png --pixel-format=yuva444p10le --scale=0.6666666667` (ProofWallWide also needs `--gl=angle`).
4. Lay on: `python3 -I marketing/ads/animation-plans/thank-you-test-2026-10-23/tools/build-from-schedule.py <clips_dir> <out.mp4>`

## What changed from the 2026-10-22 plan

- The plan's start times came from an even speaking pace (77 s of speech). The real video is 63 s, so they were 0.5 s to 10.3 s late; the last animation was planned for 61.2 s, in the sign-off. Real times are in `anchors.json`.
- **The 4 s face gap, 3 s clip cap and 35% share limits apply to opaque full-frame clips only** (`src/ad-videos/animations.mjs`, `mode === "fullframe"`). In overlay (see-through) mode the code forbids overlaps and nothing else. So all 8 stay. They cover 28.0 s (44% of the video).
- Starts were set so each animation's payoff shows when the matching words are spoken (measured from frame strips of each clip, 3 per second). Three clips were rendered longer so their steps follow the speech: BureauMatchWide 3.0 -> 4.5 s, LenderMatchScrollWide 3.5 -> 4.5 s (closing line now holds 0.5 s), PathCardsWide 2.5 -> 3.5 s, QualifyTodayWide 2.5 -> 3.0 s. All inside each template's catalog length range.
- Caption band (y 1100-1360) and audio: the audio stream is a bit-for-bit copy. Nothing is drawn below y 1007.

## Round 3 (2026-10-23, same day): behind him, varied spots, script words

- **Behind him, green-screen style.** `tools/matte.swift` cuts him out of the video (macOS Vision person segmentation, one gray PNG per frame for the animation windows only). `build-from-schedule.py <clips> <out.mp4> --behind <masks_dir>` lays his cut-out back on top of the finished composite, so any card that reaches behind his head is hidden by him, hair edges included. Captions stay as they were (they are part of the original frames). 864 masks took about 5 minutes.
- **Not always in the same spot.** `schedule.json` now carries `side`, `dx` and `dy` per clip. This video uses upper-left, upper-right (tucked 100 px toward him), lower-left, mid-left, lower-right and a card tucked behind his head (QualifyToday, 130 px). Rule: words stay clear of his face box (x 935-1760, y 400-1220 here) and above the caption band (y 1170); only decoration (cash stacks, card margins) goes behind him.
- **Face.** SoftPull moved right and tucked, BureauMatch moved left. With the cut-out on, nothing can cover his face.
- **Script words.** ProofWall `proofLines` are "Ten years of my own funding" and "Hundreds of client files". QualifyToday reads "Today · sample file" beside the amount. BookCall stays a generic calendar by design.
- **Readable over film.** `marketing/broll/src/brand/ReadPlate.tsx`: in see-through mode `Eyebrow` and LenderMatch's closing line sit on a white plate. Page-on renders are unchanged. `tsc`, lint, catalog and see-through tests pass.

## Still open

1. `src/ad-videos/animations.mjs` only handles 1080x1920 ads and skips wide clips; `build-from-schedule.py` stands in for it. Nothing here is wired into the pipeline.
2. SoftPullWide's chip ("You pay $32") shows with the headline, about 1.5 s after he says it.
3. BureauMatchWide names the three bureaus and LenderMatchScrollWide lists real bank names (template design).
4. The cut-out is per-frame (no temporal smoothing); check hair edges on new footage.
