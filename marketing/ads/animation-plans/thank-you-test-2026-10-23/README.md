# Direct Book Thank You — animation test (2026-10-23)

Chris's finished thank-you video (2560x1440, 30 fps, 63.24 s, Submagic captions already burned in) with the 8 planned see-through animations laid over it. Test copy only. The original in `~/Downloads/Direct Book Thank You Take 1 (Edited Pre Animation).mp4` is never changed.

## Where things are

| File | What it is |
|---|---|
| `words-timeline-from-captions.txt` | Every spoken word with its time, read from the burned-in caption highlights (0.1 s steps). Captions run about 0.15 s ahead of the voice. |
| `anchors.json` | Each plan anchor line matched to that timeline (all 8 matched at 1.0). `tools/align-anchors.py` makes it. |
| `schedule.json` | The readjusted schedule: start, length, side, and why, per animation. |
| `props/` | The exact Remotion props each clip was rendered with (incl. `durationInFrames`). |
| `contact-sheet-v2.jpg` | One frame per animation from the v2 test copy, taken at the moment of its anchor line. |
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

## Open problems (not fixed)

1. SoftPullWide (right) covers a strip of Chris's right temple around 12.5 s, and BureauMatchWide (right) touches his right ear. He sits right of center. Putting both on the left panel would clear his face.
2. Words and numbers not in this script: QualifyTodayWide shows a sample client's $199,350 / $221,500 / "$22,150 left on the table"; ProofWallWide shows "Thousands of data points", "A little over a million dollars funded for myself" and approvals of $15,000 / $50,000 / $74,000; BookCallWide's Booked card says "Wed 15 · 2:30 PM"; LenderMatchScrollWide names real banks; BureauMatchWide names the three bureaus.
3. LenderMatchScrollWide's thin gray eyebrow and its blue closing line are hard to read over the trees.
4. `src/ad-videos/animations.mjs` only handles 1080x1920 ads. It would skip every wide clip. `build-from-schedule.py` stands in for it on this video.
5. SoftPullWide's chip ("You pay $32") shows with the headline at 1.7 s in, about 1.5 s after he says it.
