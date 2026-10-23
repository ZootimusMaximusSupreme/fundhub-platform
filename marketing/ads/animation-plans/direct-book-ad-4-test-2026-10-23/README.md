# Direct Book Ad 4 — High earners: animation test (2026-10-23)

Chris's finished 1080x1920 ad (30 fps, 74.77 s, Submagic captions burned in) with the 5 planned see-through animations laid over it, BEHIND him (green-screen style), each in a different spot. Test copy only. The original `~/Downloads/direct-book-ad-4 (edited no animation).mp4` is never changed (size 182417243, video md5 7213ad92…, checked before and after).

The test video is a big file and is NOT in git: `/private/tmp/claude-501/ad4-out/direct-book-ad-4-with-animations-TEST.mp4` (173 MB). Redo it with the steps below.

## Where things are

| File | What it is |
|---|---|
| `words-timeline-from-captions.txt` | Every spoken word with its time, read from the burned-in caption highlights (0.1 s steps). Captions run about 0.15 s ahead of the voice. |
| `anchors.json` | The plan's 5 anchor lines matched to that timeline, plus the line each clip really lands on, and the span read by hand. |
| `schedule.json` | Start, length, scale, x, y and why, per animation. |
| `props/` | The exact Remotion props each clip was rendered with. |
| `contact-sheet-final.jpg` | One marked frame per animation at its anchor line. |
| `tools/` | `ocr.swift` (adds the highlight's y so two-line captions work), `words.py`, `align-anchors.py`, `matte.swift`, `face.swift`, `build-from-schedule.py` (portrait, scale/x/y, fades), `make-sheet.py`, `preview-placement.py`. |

## What he really says (differs from the written script, ad_scripts 95)

The plan's `body` is the written script. The filmed take changed some words, so the plan's props could not be used as they were:

- "comes back about four times" is said at 25.0 s, but the next sentence is what carries the numbers: "so 200K run through a system that already has proven returns, turns into 800K pretty quickly" (28.0-33.3). ReturnMultiple was timed to that sentence. The default "A LOT more than $200,000" and "That's on the low end" are not said; he says "800K" and "that's on my poor performing ads" (26.2).
- "sitting in your account in the next **7** to 30 days" (the plan and the template say 15 to 30; "depending on what your roadmap takes" is not said). CalendarStrip props changed to 7 to 30, no footer.
- "up to 300K / 600K / $900,000" and "100K at minimum" match the plan.
- "Do you want access to that capital to put into **a** proven system you already make money with" (plan said "the").
- The burned-in caption at 24.5 s reads "put in the **media**" where the script says Meta. No animation uses either word.

## Spots (1080x1920; his hair top is at y 430-530, caption band starts y 1560)

His head and hair fill y 430-1540, so the only free space for words is the strip above his hair (y 20-470) and the strip to the right of his face. Each clip is scaled down (0.56 to 0.72) and moved; the part of a card that is only padding goes behind his head. See `schedule.json`.

| # | Template | Start | Length | Spot | Timing |
|---|---|---|---|---|---|
| 1 | ReturnMultiple | 30.0 s | 4.0 s | top right, scale 0.60 | REAL |
| 2 | MoneyClimb range | 46.6 s | 4.0 s | top left, scale 0.62 | REAL |
| 3 | MoneyClimb steps | 56.8 s | 4.0 s | top right, scale 0.56 | REAL (first step about 1 s late) |
| 4 | CalendarStrip | 61.0 s | 2.8 s | top centre, scale 0.64, tucked behind his head | REAL |
| 5 | PathCards | 64.6 s | 4.5 s | upper left, scale 0.72 | REAL |

19.3 s of animation, 26% of the video, no overlaps. Each clip fades in and out over 0.2 s (the plates used to pop on and off in one frame).

## Redo it

1. Timeline: `ffmpeg -vf fps=10,crop=1080:260:0:1520` makes the caption strips, `ocr.swift` reads them (`swiftc -O ocr.swift -o ocr; ./ocr <dir> > ocr.jsonl`), `words.py ocr.jsonl > words-timeline-from-captions.txt`.
2. Anchors: `python3 -I marketing/ads/animation-plans/direct-book-ad-4-test-2026-10-23/tools/align-anchors.py`
3. Clips (from `marketing/broll`): `npx remotion render <Template> <clip>.mov --props=<props file> --codec=prores --prores-profile=4444 --image-format=png --pixel-format=yuva444p10le` (scale 1, no `--scale`).
4. Cut-out: `./matte <video> <masks_dir> "29.6,34.2;46.3,50.9;56.5,61.1;60.7,64.1;64.3,69.4"` (669 frames, about 65 s).
5. Lay on: `python3 -I .../tools/build-from-schedule.py <clips_dir> <out.mp4> --behind <masks_dir>` (about 40 s).
6. Check: duration and frame count equal, audio md5 equal, caption band PSNR (pair frames by index), `make-sheet.py` for the contact sheet.

## Checks on the test copy

- 74.77 s and 2243 frames, same as the original.
- Audio stream copied bit for bit (md5 31ff1f2430a52be5861cf19bb4dfb971 both).
- Caption band (y 1500-1920), frame by frame against the original: PSNR min 44.8 dB, mean 50.5 dB (re-encode noise only).
- `npx tsc --noEmit` (marketing/broll) and `npm run lint` pass; nothing in `marketing/broll` was changed.

## Still open

- Words (at least the eyebrow lines) sit in the top 14% (y < 269) on every clip. That strip is where Reels draws its header. His head leaves no room below it; to stay out of it the clips would have to shrink to about 0.4 and the small labels would be unreadable.
- Small labels (the gray caps over each amount) are 11 to 15 px tall at these scales. The amounts and card titles are 26 to 70 px.
- The 200K to 800K sentence is the strongest number in the ad and "about four times" (25.0) has no animation of its own; a second ReturnMultiple there would repeat the same look.
- The first MoneyClimb step ("up to $300,000") shows about 1 s after he says it: three steps at his pace (2 s each) do not fit the template's 4 s maximum.
- Nothing is wired into the pipeline (`src/ad-videos/animations.mjs`).
