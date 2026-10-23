# Direct Book Ad 14 (780 and up, 13 optimization points) - animation build, 74.13 s (2026-10-23)

Input `~/Downloads/Direct Book Ad 14 — 780 and up, 13 optimization points.mp4` (1080x1920, 30 fps, 2224 frames, captions burned in, he is on camera the whole ad). Output `~/Downloads/Direct Book Ad 14 — 780 and up, 13 optimization points Animated.mp4` (152 MB, not in the repo). Animations only: no cut, no sound change, no timing change. Input never modified.

Method: same as Ad 11 (`../direct-book-ad-11-penthouse-2026-10-23/README.md`, skill `.cursor/skills/fundhub-video-animation-overlay/SKILL.md`). Word times: whisper small.en on this file's audio (`words-timeline.txt`); checked against the audio energy onset (within about 0.1 s).

## Animations (size = width of the words box as % of 1080)

| # | Template | Window | Cards (his words) | Size | Where |
|---|---|---|---|---|---|
| 1 | FundhubLogo | 1.9-3.9 s | the fundhub. logo | 80% | behind him |
| 2 | PathCards | 5.1-8.2 s | Personal, business, or both; In the shortest amount of time | 88% | behind him |
| 3 | PathCards | 9.6-15.1 s | A high score is all that matters; Banks don't ask you for tax returns; They don't ask you for bank statements | 88% | in front (over hair, never face) |
| 4 | PathCards | 15.1-21.5 s | Whatever funding you're after; At the lowest terms and the fastest timelines; So you get the maximum amount | 87% | in front (over hair, never face) |
| 5 | PathCards | 21.6-28.3 s | Credit cards and lines of credit; SBA and MCA; Even personal funding | 88% | in front (over hair, never face) |
| 6 | PathCards | 28.3-37.5 s | A mismatch cuts your approvals in half; We check every file on 13 optimization points; Before a single application goes out | 88% | in front (over hair, never face) |
| 7 | PathCards | 37.6-45.9 s | Optimize those 13 points; Double your approval odds with every lender; Fewer denials: every application goes to a bank that approves you | 88% | in front (over hair, never face) |
| 8 | PathCards | 45.9-53.3 s | Our AI matching system; A much bigger list of banks than anyone else; We send out more applications to banks that fit your file | 88% | in front (over hair, never face) |
| 9 | PathCards | 53.3-58.7 s | We remove the inquiries after every round; So we run each round faster than everyone else | 87% | behind him |
| 10 | PathCards | 58.7-74.1 s | Click the link below; And we'll pull your reports | 87% | behind him |

10 animations, no overlaps, each rides along with the whole idea (3-15 s) instead of popping and leaving. #1 starts at 1.9 s on the hook line ("Fundhub gets you the maximum amount of funding"). The logo is the only logo and sits on the one time he says Fundhub (whisper writes "FunHub"; the captions spell it Fundhub). #10 is the call to action, in his exact closing ask, and stays to the end.

## Cadence: his word vs the card on screen
Entrance = first frame the card is visibly on screen (about 12-25% of its area), read from the rendered clips. Card 2 and 3 enter on their own words, not on a fixed stagger.

| # | Word | He says it | Card visible | Late by | Card |
|---|---|---|---|---|---|
| 1 | FunHub | 1.90 s | 1.93 s | +0.03 s | plate visible frame 1 of clip (soft), solid frame 5 |
| 2 | personal | 5.18 s | 5.20 s | +0.02 s | Personal, business, or both |
| 2 | in | 6.70 s | 6.73 s | +0.03 s | In the shortest amount of time |
| 3 | Having | 9.72 s | 9.77 s | +0.05 s | A high score is all that matters |
| 3 | Banks | 11.94 s | 11.97 s | +0.03 s | Banks don't ask you for tax returns |
| 3 | they | 13.80 s | 13.83 s | +0.03 s | They don't ask you for bank statements |
| 4 | Whatever | 15.22 s | 15.27 s | +0.05 s | Whatever funding you're after |
| 4 | at | 17.34 s | 17.37 s | +0.03 s | At the lowest terms and the fastest timelines |
| 4 | so | 19.94 s | 19.97 s | +0.03 s | So you get the maximum amount |
| 5 | Credit | 21.70 s | 21.73 s | +0.03 s | Credit cards and lines of credit |
| 5 | SBA | 23.42 s | 23.47 s | +0.05 s | SBA and MCA |
| 5 | even | 24.93 s | 24.97 s | +0.04 s | Even personal funding |
| 6 | A | 28.41 s | 28.43 s | +0.02 s | A mismatch cuts your approvals in half |
| 6 | we | 32.37 s | 32.40 s | +0.03 s | We check every file on 13 optimization points |
| 6 | before | 35.58 s | 35.60 s | +0.02 s | Before a single application goes out |
| 7 | optimize | 37.68 s | 37.70 s | +0.02 s | Optimize those 13 points |
| 7 | double | 39.01 s | 39.03 s | +0.02 s | Double your approval odds with every lender |
| 7 | fewer | 42.46 s | 42.50 s | +0.04 s | Fewer denials: every application goes to a bank that approves you |
| 8 | Our | 45.96 s | 46.00 s | +0.04 s | Our AI matching system |
| 8 | a | 47.68 s | 47.70 s | +0.02 s | A much bigger list of banks than anyone else |
| 8 | we | 50.70 s | 50.73 s | +0.03 s | We send out more applications to banks that fit your file |
| 9 | We | 53.42 s | 53.47 s | +0.05 s | We remove the inquiries after every round |
| 9 | so | 56.45 s | 56.50 s | +0.05 s | So we run each round faster than everyone else |
| 10 | Click | 58.82 s | 58.87 s | +0.05 s | Click the link below |
| 10 | and | 59.82 s | 59.87 s | +0.05 s | And we'll pull your reports |

Each animation holds about 0.4 s after his last word (#8 and #9 hold less: the next animation starts at his next word, and no two overlap).

## Template change (additive, `marketing/broll/src/templates/PathCards.tsx`)
New optional prop `cardStarts` (clip frames, real time): cards enter on those frames, not on the fixed stagger, and the clip runs exactly `durationInFrames` (not clamped to 75-135). Without it nothing changes. tsc and the see-through tests pass.

## Where the plates sit
He fills the middle: hair top y 419, face box y 642-1275 (Vision), captions from y about 1500. Free: the band above his face. Plates are 87-88% wide (80% for the logo), y 30-596, never below y 600, so they never touch his face or the captions.
- Behind him (#1, 2, 9, 10): above his hair, he is cut out (Apple Vision) and laid back on top.
- In front of him (#3-8): the three-card plates are too tall to sit above his hair, so the whole plate is drawn in front of his hair and forehead (bottom edge 596 or higher, face starts 642).
- No plate sits over his chest: the chest strip between chin (y 1275) and captions (1500) is only 225 px tall and one card is 150 px.

## Checks
- Duration 74.14 s, 2224 frames, 30 fps, 1080x1920 in both. Audio stream copy md5 identical (050e755a5e6cf49cf17bb5db0779029a).
- Caption band y 1450-1850 frame by frame: PSNR min 45.8, mean 50.1 (re-encode only). Face band y 640-1340: min 40.4, mean 44.2.
- Every words box is 10 px or more inside the frame (schedule asserts it); contact sheet looked at: `contact-sheet-final.jpg`.

## Open
- Plates in front cover his hair and forehead (never the face). The plate position barely differs between "front" and "behind" because his head is big in this selfie.
- Card text is shown in full when the card enters, so a long card (#7 card 3, #8 card 3) is on screen a second or two before he finishes saying it.
- Not wired into the pipeline. Plate renders are in the scratch folder, not the repo.

## Redo
`python3 -I tools/make-schedule.py`; render clips from `marketing/broll` (`npx remotion render src/index.ts PathCards <n>-PathCards.mov --props=props/<n>-PathCards.json --codec=prores --prores-profile=4444 --image-format=png --pixel-format=yuva444p10le`; logo: `FundhubLogo` with props/01); matte windows with `tools/matte.swift`; `python3 -I tools/build-from-schedule.py <clips_dir> <out.mp4> <in.mp4> --behind <masks_dir>`; `python3 tools/contact-sheet.py <out.mp4> contact-sheet-final.jpg`.
