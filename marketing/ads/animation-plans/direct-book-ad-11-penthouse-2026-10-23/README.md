# Direct Book Ad 11 (The penthouse) - animation build, 53.84 s cut (2026-10-23)

Redo for the right video: `~/Downloads/Direct Book Ad 11 — The penthouse (1).mp4` (1080x1920, 30 fps, 53.84 s, 1615 frames, captions burned in). Output `~/Downloads/Direct Book Ad 11 — The penthouse (1) Animated.mp4` (148 MB, not in the repo). Animations only: no cut, no sound change, no timing change. Input never modified (byte compare). The earlier build was on the 69.8 s file and was replaced.

Method: `.cursor/skills/fundhub-video-animation-overlay/SKILL.md`. Word times: whisper small.en on this file's audio (`words-timeline.txt`), numbers checked on the captions.

## What the video is
0-8.9 s is building B-roll with captions (he is not on screen). He appears at 8.9 s.

## Animations (size = width of the words box as % of 1080)

| # | Template | Starts | Length | Spot | Size | Words shown | Lands on |
|---|---|---|---|---|---|---|---|
| 1 | PathCards (3) | 3.7 s | 4.5 s | center, over the B-roll | 86% | "Your parents won't tell you", "Your friends won't", "Maybe not even your business partner" | cards at about 4.4, 5.3, 6.2 s on "parents", "friends", "business partner" |
| 2 | PriceTag | 10.3 s | 3.0 s | top, left | 68% | "Penthouse $1,500,000" | tag settles 10.8 s on "one and a half million" |
| 3 | PathCards (3) | 19.2 s | 3.5 s | top, right | 73% | "Cut out the distractions", "Optimized his credit", "Put it to work alongside investors and credit partners" | cards about 19.9, 20.8, 21.7 s |
| 4 | PriceTag | 25.2 s | 3.0 s | top, right | 46% | "His income, over $400,000 a month" | tag settles 25.7 s; "$400,000" said 26.4 s |
| 5 | PathCards (2) | 34.0 s | 3.5 s | top, full width | 86% | "Run companies and scale businesses", "Most efficiently use other people's money" | cards about 34.7 and 35.6 s |
| 6 | PathCards (2) | 39.9 s | 4.5 s | top, full width | 86% | "Credit is that lever", "Only your own cash / The slowest way to build wealth" | cards about 40.6 and 41.5 s; subline in view when he says "slowest way to build wealth" (43.3 s) |

19.0 s of animation (35%). No overlaps. Animation 1 starts at 3.7 s, inside the first 10 s, on the hook line. No "Fundhub" in the script, so no logo.

## What changed from the first (small) build
- Right video, new word times, new schedule from scratch.
- Much bigger: words 46-86% of frame width (was 0.31-0.45 scale). The big plates sit in the one place that is free of his face: the top band above his head, and the building B-roll.
- CompanyLine and MoneyClimb dropped (unreadable over art / too tall for the free space). StepPath and the CompanyLine-style claim became PathCards (no big plate, so nothing runs off the top of the frame). The $400,000 line is a PriceTag, with "a month" as he says it (the written script says "a year").

## How it is laid on
1. Plates go on the video, then his cut-out (Apple Vision person matte) goes back on top, so he is in front.
2. The words box of each clip (+10 px) is drawn once more IN FRONT of him. The fit keeps every words box off his face and neck (head mask below hairline = hair top + 140 px, up to y 1250, margin 21 px), so the only thing the front layer covers is hair or the plate area.
3. Nothing is below y 1100; the captions (y about 1480-1700) are untouched.
4. Each clip fades in and out over 0.2 s.

## Checks
- Duration 53.84 s, 1615 frames, 30 fps, 1080x1920 in both. Audio stream copy md5 identical (faa4e7c4d500414567406a2cb097d91a).
- Caption band y 1450-1850 frame by frame: PSNR min 40.5, mean 48.2 (the re-encode only).
- Every words box is 10 px or more inside the frame on all four sides (schedule.json asserts it); contact sheet looked at.
- `contact-sheet-final.jpg`: one frame per animation at its payoff, red box = the words, size % in the title.

## Open
- Animation 4 is only 46% wide: in that stretch his head leans left and the free corner is small (fit maximum 0.8 scale). The big "$400,000" is about 110 px tall.
- The card plates are in front of a little hair on animations 2, 3, 5, 6 (words box only).
- The 3-card clip's cards come about 0.9 s apart; he says them about 1.0-1.2 s apart (card 3 on #3 is a little early).
- Not wired into the pipeline.

## Redo
`python3 -I tools/make-schedule.py`; render clips from `marketing/broll` (`npx remotion render src/index.ts <Template> <clip>.mov --props=props/<n>.json --codec=prores --prores-profile=4444 --image-format=png --pixel-format=yuva444p10le`); matte with `tools/matte.swift` for the windows; `tools/fit-search.py <n> <scales>` to re-fit; `python3 -I tools/build-from-schedule.py <clips_dir> <out.mp4> <in.mp4> --behind <masks_dir>` (absolute paths).
