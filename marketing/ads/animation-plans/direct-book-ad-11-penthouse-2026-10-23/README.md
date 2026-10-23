# Direct Book Ad 11 (The penthouse) - animation build (2026-10-23)

Finished Submagic render (1080x1920, 30 fps, 69.80 s, 2094 frames, captions burned in) with 5 see-through animations laid BEHIND him (person cut-out on top). Animations only: no cut, no sound change, no timing change. Output `~/Downloads/Direct Book Ad 11 — The penthouse Animated.mp4` (189 MB, not in the repo). Input never modified (byte compare). `... Edited.mp4` ignored. Method: `.cursor/skills/fundhub-video-animation-overlay/SKILL.md`; pattern: `../direct-book-ad-16-test-2026-10-23/`.

## Animations (start times from whisper on the real audio)

| # | Template | Starts | Length | Spot | Scale | Words shown | Lands on |
|---|---|---|---|---|---|---|---|
| 1 | PriceTag | 12.3 s | 3.0 s | right, lower middle | 0.41 | "A guy up there", "Penthouse $1,500,000", "He was struggling" | tag settles 12.8 s on "dollar penthouse"; subline 13.9 s on "struggling" |
| 2 | StepPath | 25.3 s | 3.0 s | left, top | 0.31 | "He moved out of state", "Optimized his credit", "Put it to work alongside investors and credit partners" | step 1 at 25.8 s on "his credit"; step 2 at 27.3 s on "put it to work" |
| 3 | MoneyClimb | 30.0 s | 4.0 s | right, top | 0.45 | "Within six months", "His income", "Over $400,000 a month" | reaches $400,000 at 32.6 s on "$400,000" |
| 4 | CompanyLine | 46.5 s | 3.5 s | right, top | 0.42 | "Run companies and scale businesses", "The ones who do it most efficiently use other people's money" | headline up 46.8 s; line spoken 47.0-49.9 s |
| 5 | PathCards | 54.2 s | 4.0 s | right, lower middle | 0.34 | "Credit is that lever", "Only your own cash", "The slowest way to build wealth" | card 1 at 54.9 s on "credit is that lever"; card 2 at 55.8 s on "only your own cash" |

17.5 s of animation (25%). No overlaps. Each clip fades in and out over 0.2 s.

## Logo
The script never says "Fundhub", so no FundhubLogo. No logo anywhere.

## Words fixed from what he actually said
He says "a month", not the script's "a year" (captions agree): the MoneyClimb unit reads "a month". He says "one and a half million dollar penthouse": tag shows $1,500,000. The Archimedes lines were not filmed ("as I said, give me a lever..."), so none is shown. CompanyLine's default "Funded" chip was changed to "Other people's money" and its count to 3 (chip text is cut off by the template at this size).

## Checks
- Duration 69.80 s, 2094 frames, 30 fps, 1080x1920 in both. Audio stream copy md5 identical (66945433f769b347343829729f5ee48a).
- Caption band y 1400-1800, frame by frame: PSNR min 40.8, mean 48.0 outside the windows; inside 41.7 / 48.2. Only the re-encode (x264 CRF 15) differs.
- Contact sheet `contact-sheet-final.jpg` looked at: words clear of his head and above the captions.
- Fit: every word box 29 px or more away from his outline over each window (`tools/fit-search-ad11.py`, `fit-search-ad11-ymin.py`).

## Open
- CompanyLine: its headline sits over the machine art on a tree background, hard to read at 0.42 and no white plate. Chip text cut off.
- Small chips (eyebrows) are tiny at these scales; titles and numbers read.
- PathCards is 0.34 scale; the second card's small line is about 10 px.
- The cut-out is per frame, no smoothing.
- Not wired into the pipeline.

## Redo
`tools/make-schedule.py`; render clips from `marketing/broll` (`npx remotion render src/index.ts <Template> <clip>.mov --props=props/<n>.json --codec=prores --prores-profile=4444 --image-format=png --pixel-format=yuva444p10le`); `matte` per the skill; `python3 -I tools/build-from-schedule.py <clips_dir> <out.mp4> <in.mp4> --behind <masks_dir>` (use absolute paths).
