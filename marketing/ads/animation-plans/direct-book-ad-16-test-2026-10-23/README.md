# Direct Book Ad 16 (Advanced funding algorithm) - animation test (2026-10-23)

Chris's finished ad (1080x1920, 30 fps, 67.60 s, 2028 frames, Submagic captions already burned in) with the 7 planned see-through animations laid on, BEHIND him (person cut-out laid back on top), each in a different spot. Test copy only. The original `~/Downloads/Direct-Book-Ad-16 (Edited no Animation).mp4` is never changed. The test video is not in the repo (140 MB); it was built in a scratch folder.

Follows `.cursor/skills/fundhub-video-animation-overlay/SKILL.md`. Worked example for the wide video: `../thank-you-test-2026-10-23/`.

## Result in one paragraph

It works: all 7 animations land on the words they show, behind him, words clear of his head and above the captions, original audio bit-identical, captions untouched. The catch is size. In this framing his head and hair fill x 215-810 and y 335-1250, and his shoulders fill the full width from y 1100. The only free room inside the words band (y 269-1248) is the two top corners and two thin side strips, so every clip had to shrink to 0.37-0.57 of its template size (the logo 0.8). Big words read; the small eyebrow chips and sublines do not.

## What is in this folder

| File | What it is |
|---|---|
| `words-timeline-from-captions.txt` | Every spoken word with its time, read from the burned-in caption highlights (0.1 s steps). Company name written Fundhub (captions print it in capitals). |
| `anchors.json` | Each plan anchor line matched to that timeline. `tools/align-anchors.py` makes it. |
| `schedule.json` | The schedule: start, length, scale, spot, dx/dy, word box on the video, and why, per animation. `tools/make-schedule.py` writes it. |
| `props/` | The exact Remotion props each clip was rendered with (incl. `durationInFrames`). |
| `contact-sheet-final.jpg` | One frame per animation at its payoff, red box on each animation's words. |
| `tools/` | `ocr2.swift` + `words2.py` (word timeline), `align-anchors.py`, `make-schedule.py`, `build-from-schedule.py` (one encode, audio copied, `--behind`), `matte.swift` (person cut-out), `face.swift`, `contact-sheet.py`, plus the fit tools used to find where the words fit (`person-union-maps.py`, `fit-search.py`), `band-compare.py` and `event-strips.py`. |

## The animations (all start times REAL, read from the captions)

| # | Template | Starts | Length | Spot | Scale | Lands on |
|---|---|---|---|---|---|---|
| 1 | StampCard (OUT OF DATE) | 14.05 s | 3.0 s | right, upper middle | 0.47 | stamp slams 14.95 s, settled 15.1 s, on "out of date" |
| 2 | FundhubLogo | 23.3 s | 2.0 s | center, above his head | 0.80 | letters rise 23.5-24.0 s, on "Fundhub" (said 23.6 s) |
| 3 | HiddenDataPoints (7) | 27.0 s | 3.0 s | left, top | 0.44 | count reaches 7 at 28.5 s on "seven"; "different data feeds" 28.7 s |
| 4 | LenderList | 37.8 s | 2.0 s | right, top | 0.49 | headline up 38.2 s on "where the lending"; rows fill to 39.0 s |
| 5 | ScoreBadge (400-850) | 41.3 s | 3.2 s | right, low | 0.37 | gauge sweeps on "anywhere from 400"; check 43.3 s on "to"; line done 43.5 s |
| 6 | PathCards (3 ways) | 44.5 s | 4.5 s | left, top | 0.37 | cards solid at 45.4, 46.0, 46.8 s on "for you", "with you", "set it up" |
| 7 | StampCard (APPROVED / OR DENIED) | 53.15 s | 4.0 s | right, lower middle | 0.47 | stamp slams 54.3 s, settled 54.6 s; subline 55.3 s |

22 s of animation, 32% of the video. No overlaps. Offsets inside each clip were read off the finished test copy at 0.1 s steps (about 0.1 s accurate). "Said at" times are the caption time plus 0.15 s; the 0.15 s lead is the number measured on the thank-you video, not re-measured on this one.

## What changed from the 2026-10-22 plan

- **Start times were estimates** (even-pace guesses, 21.9 s to 80.0 s, longer than the whole video at 67.6 s). Real times come from the captions: they are 8.5 to 26 s earlier. Plan estimate vs real anchor start: 21.9 vs 13.4, 34.1 vs 23.4, 40.4 vs 27.5, 52.6 vs 37.4, 59.6 vs 41.0, 67.4 vs 46.6, 80.0 vs 53.8.
- **Transcript words fixed from the captions.** The plan body had "funny companies" (captions: "funding companies") and "how much fun you qualify for" (captions: "how much money you qualify for"). No animation prints either. "FunHub" was already corrected to Fundhub.
- **Overlay mode.** The 4 s face gap, 3 s cap and 35% share belong to full-frame mode only; the 3 key points the plan dropped for them (850/400/500 ScoreBadge, 10 years, credit cards / SBA / MCA stack) were not added back (not asked).
- **Clips stretched inside the catalog range** so steps follow his speech: PathCards 3.0 -> 4.5 s (the maximum; the cards still come 0.7 s apart, he says them 1.1 s apart), StampCard 1 2.5 -> 3.0 s, StampCard 2 3.0 -> 4.0 s, ScoreBadge 2.5 -> 3.2 s.
- **PathCards starts at "we'll do it for you" (44.5 s)**, not at the plan's anchor "or we'll set it up..." (46.6 s), so each card lands on its own phrase.

## Where the animations sit and why

`person-union-maps.py` runs the person cut-out over every frame of each window and keeps every pixel he ever covers. `fit-search.py` then finds, per clip, the biggest scale and the spots where every box that holds words stays 21 px or more from him, inside y 269-1248. Only the white plate, list rows, dots and money go behind him. Result: the words of every animation clear him by at least 10 px in every frame (checked at 0, 10 and 21 px margins: 0 overlapping pixels at 10 px for all 7; slivers of 2 px (anim 3) and 18 px (anim 7) at 21 px). The Vision face rectangle (`face.swift`) is about 25% wider than his real outline (x 190-880 against 215-810), so it was not used for the fit.

## Checks (test copy vs original)

- Duration 67.60 s and 2028 frames in both. Same fps (30), size (1080x1920).
- Audio stream bit-identical: `ffmpeg -i <file> -map 0:a:0 -c copy -f md5 -` gives `71228a8d3f522cb9948f62f3c4c0aab2` for both.
- Caption band (y 1400-1800) compared frame by frame (`tools/band-compare.py`): PSNR 42.2 min, 45.2 mean outside the animation windows and 42.2 min, 45.0 mean inside them. Inside equals outside, so the only difference is the re-encode (x264 CRF 15). Nothing is drawn below y 1250.
- Contact sheet: `contact-sheet-final.jpg`, looked at.
- Nothing in `marketing/broll` or the repo code changed, so `tsc` and lint were not rerun.

## Redo it

1. Frames and words: `ffmpeg -vf fps=10,crop=1080:360:0:1420` on the video, `swiftc -O tools/ocr2.swift`, then `python3 -I tools/words2.py ocr2.jsonl`.
2. `python3 -I tools/align-anchors.py` (anchors), edit `tools/make-schedule.py` if needed, `python3 -I tools/make-schedule.py` (schedule.json).
3. Clips (from `marketing/broll`, one per file in `props/`): `npx remotion render <Template> <clip>.mov --props=<props file> --codec=prores --prores-profile=4444 --image-format=png --pixel-format=yuva444p10le` (scale 1, 1080x1920).
4. Cut-out: `swiftc -O tools/matte.swift -o matte; ./matte <video> <masks_dir> "start,end;start,end"` (about 4 minutes for 840 frames).
5. Lay on: `python3 -I tools/build-from-schedule.py <clips_dir> <out.mp4> --behind <masks_dir>` (about 35 s).

## Still open

1. Small text: the eyebrow chips ("BUSINESS IN A BOX SYSTEM" and the like) are 6-8 px high at these sizes, and the sublines about 11 px. They are on screen but cannot be read on a phone. Titles, stamps, numbers and the 400/850 line are readable.
2. LenderList shows five empty numbered rows (the template's design; no bank names). He never says "five".
3. HiddenDataPoints prints the big number 7 with the line "Pulls from six to seven" (from the plan).
4. Anchor 1 matched at only 0.8 because the caption reader dropped "they're"; the words were checked by hand.
5. The cut-out is per frame with no smoothing; the hair edge looks clean in the sheet and strips, but check it on the full video.
6. Nothing is wired into the pipeline; `src/ad-videos/animations.mjs` was not touched.
