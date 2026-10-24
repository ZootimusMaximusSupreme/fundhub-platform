# Direct Book VSL 1 (Watch page) - animation build (2026-10-23)

Input `~/Downloads/Direct Book VSL 1 — Watch page Edited.mp4` (2560x1440, 30 fps, 5679 frames, 189.30 s, Submagic captions burned in, never modified). The VSL is 2560x1440, not 4K: size kept, nothing scaled.
Output `~/Downloads/Direct Book VSL 1 — Watch page Edited Animated.mp4` (868 MB, not in the repo). Animations only: no cut, no timing change, same 5679 frames, same fps and size. Method: `.cursor/skills/fundhub-video-animation-overlay/SKILL.md`.

## What is in it
30 see-through diagrams from `marketing/broll` (the Wide templates), 167 s of the 189 s. All of them sit BEHIND him (his cut-out is laid back over them), none over his face or the burned-in captions. No numbered list, no text-only plate. One animation on the hook (1.0 s). The logo shows only where he says Fundhub (21.5 s and 101.3 s). The CTA (BookCall) runs on "click the link below" and is held to the last frame.

Width = the drawing's box as % of the 2560 frame. These are the side-panel templates (the board rule keeps the middle for his face and the captions), so the best fit beside his head is 30-37%. Nothing is under 30%.

| # | Window | Template | What it shows | Width | Spot |
|---|---|---|---|---|---|
| 1 | 1.00-9.30 s | MoneyClimb | $20,000, $400,000, even a million, across multiple businesses | 30% | right, top |
| 2 | 10.70-13.40 s | FileItems | your file, your personal data and business codes flagged | 36% | left, low |
| 3 | 13.45-18.97 s | ScoreBadge | score gauge, even 800 scores held back | 31% | right, mid |
| 4 | 20.85-22.87 s | FundhubLogo | the fundhub. logo on 'Fundhub' | 37% | left, top |
| 5 | 22.90-26.70 s | MoneyClimb | a little over $1,000,000 funded for himself | 32% | right, low |
| 6 | 26.70-32.70 s | StampCard | your file stamped Denied, nobody checks it against what the bank approves | 34% | left, mid |
| 7 | 34.50-38.80 s | FileItems | report: two approvals, a report full of hard inquiries | 32% | right, top |
| 8 | 38.80-43.50 s | StampCard | your application stamped Skipped, you never find out what you qualify for | 34% | left, low |
| 9 | 44.60-49.90 s | StampCard | your file stamped Not checked against what each bank approves | 32% | right, mid |
| 10 | 49.95-56.13 s | QualifyToday | sample file: today vs once fixed (UnderwriteIQ sample client) | 33% | left, top |
| 11 | 56.20-60.50 s | LenderMatchScroll | bank list scrolls, 30-50 lenders that fit you | 31% | right, low |
| 12 | 60.50-64.00 s | SoftPull | dial that does not move: in the order that protects your score | 34% | left, mid |
| 13 | 64.00-71.93 s | FundingStack | five funding types stack into one block | 34% | right, top |
| 14 | 73.40-79.80 s | FileItems | hard inquiries stay on the report, the next lender approves less | 33% | left, low |
| 15 | 79.90-84.50 s | InquiriesOff | inquiries struck off, file goes into the next round clean | 33% | right, mid |
| 16 | 84.60-91.00 s | FundingRounds | funding sequence: rounds stack real capital | 32% | left, top |
| 17 | 93.00-99.00 s | MoneyClimb | $250,000 to $400,000 | 35% | right, low |
| 18 | 100.80-102.80 s | FundhubLogo | the fundhub. logo on 'Fundhub' | 36% | left, mid |
| 19 | 105.70-112.90 s | DeadlineClocks | 24 and 72 hour clocks, you don't pay | 35% | right, top |
| 20 | 112.95-120.00 s | FileItems | report: the item holding you back, shown | 32% | left, low |
| 21 | 121.50-127.90 s | HiddenDataPoints | 13 dots around the count 13 optimization points | 35% | right, mid |
| 22 | 127.90-134.80 s | FileItems | balances down, negative items removed, what to add | 33% | left, top |
| 23 | 135.20-142.40 s | FundingStack | bank relationships, deposits, business data stack | 36% | right, low |
| 24 | 143.00-150.10 s | FundabilityMeter | fundability meter climbs to Maximum | 31% | left, mid |
| 25 | 152.50-159.00 s | StampCard | Capital Blueprint stamped Guaranteed | 34% | right, top |
| 26 | 159.50-165.80 s | ProofWall | real client approvals, hundreds of files, thousands of data points | 33% | left, low |
| 27 | 165.90-170.10 s | BookCall | CTA: calendar, pick a time for your call | 35% | right, mid |
| 28 | 170.15-176.03 s | SoftPull | 3-bureau report, $32, no impact on your score | 32% | left, top |
| 29 | 176.15-185.03 s | QualifyToday | sample file: how much you qualify for | 35% | right, low |
| 30 | 186.20-189.30 s | BookCall | CTA: click the link below, book your call (held to the last frame) | 32% | left, mid |

## Round 2 (2026-10-23): BookCall words only
#27 and #30 no longer show a made-up day-and-time chip or a "Booked" card (`showPicked: false`). #27 reads "Click the button below" / "Fill out the 10 second application" / "Pick a time for your call"; #30 reads "Click the link below" / "Book your call today". The calendar grid, the highlighted day and the slot times are the template's generic art (no month, no name), as in Ad 14.

## Words (Whisper small.en, `words-timeline.txt`)
Word times come from whisper.cpp small.en on his audio (not caption reading). Filmed words beat the script: "24 hours" (not business hours), "or just denies you", "funny game" is whisper's mis-hearing of "funding game" and is never printed (the burned-in Submagic captions say "funny game"; that is the input, not ours). `anchors.json` lists his phrase and word time for every part. Props print only his words, except the labelled sample file in QualifyToday and the labels below.

## Timing: payoff on the word
Each clip was rendered at a length L (`REMOTION_UNCLAMP=1`, which lifts the 2.5-4.5 s cap) so its parts land on his words, trimmed to a play length and, where the idea runs longer, the last picture is held (`schedule.json`: `render_frames`, `play_frames`, `hold_frames`). Beat times were read from 12-tile strips of every render (`tools/strip.py`). Where the template's own order cannot match his, the part lands close but not exact: see weak spots.

## Sound (skill step 7)
Two-pass loudnorm on the whole file: input -16.92 LUFS, TP -3.72. Output measured with ebur128 peak=true: **-14.0 LUFS, true peak -2.1 dBFS**. Picture copied (no second video encode), AAC 320k request, 48 kHz.

## Checks
- 5679 frames, 30 fps, 2560x1440 both; duration 189.30 s (container 189.40 s because the AAC encoder pads the audio by 0.09 s).
- Caption band y 1100-1360 against the original, every frame: PSNR min 43.8, mean 47.7 (encode noise only; nothing is drawn there).
- Every drawing box is inside x 40-2520, y 24-1085 (captions start about y 1130) and 28 px clear of his cut-out over its whole window (`tools/fit.py`). Contact sheet looked at: `contact-sheet-final.jpg`.
- `cd marketing/broll && npx tsc --noEmit`, `npm run lint`, `node --test src/marketing/catalog.test.mjs src/marketing/broll-see-through.test.mjs` pass (31/31).

## Template changes (additive, off by default)
`REMOTION_UNCLAMP=1` now also lifts the cap in `offer-cta-timeline.ts` (BookCall) and `ProofWall.tsx`. From the Ad 14 branch: `format.ts`, `clipTimeline.ts` (same switch), `BookCall` `showPicked`, white read plates in `InquiriesOff` and `LenderList`.

## Weak spots
- Size: the Wide templates are side panels, 30-37% of the width. Bigger would put words over his head.
- Template order vs his order: #1 footer chip "Plus personal funding" shows about 1.4 s before he says it; #2/#7/#14/#22 list rows land 0.4-1.6 s early or late of his phrase (slow template steps, his phrases are 1-2 s apart); #13 rows land 0.4-1.3 s early (SBA, merchant cash, personal funding); #26 "Thousands of data points" about 0.7 s late; #27 "Pick a time" card lands just after "call".
- #6 file stamped Denied lands about 0.6 s after "denies you".
- Repeats: StampCard x4, FileItems x5, MoneyClimb x3, BookCall x2, QualifyToday x2, SoftPull x2, FundingStack x2, Logo x2 (the plan reuses them).
- #11 LenderMatchScroll prints real bank names and logos from the CRM list (template design; he says "thousands of lenders"). #26 ProofWall shows real client approval screenshots with their amounts and banks (proof cards from source); he says "hundreds of files".
- #10 and #29 QualifyToday numbers are the roadmap sample client (UnderwriteIQ), labelled "Sample file".
- Gaps with no animation: 9.3-10.7, 19.0-20.85 (the "one step most people miss" line), 89.4-93.0 stretch is held by #16, 102.8-105.7, 150.1-152.5 (advisor checking in), 185.05-186.2.
- Not wired into the pipeline; clip renders are in the scratch folder.

## Redo
`python3 -I tools/plan.py` (props + plan.json), `bash tools/render-clips.sh <clips_dir>`, `python3 tools/bbox.py <clips_dir> <bbox.json>`, masks `swiftc -O tools/matte.swift -o matte && ./matte <video> <masks_dir> "0,189.4"`, `python3 tools/fit.py <masks_dir> <bbox.json>` (needs numpy+Pillow, no -I), `python3 -I tools/build-from-schedule.py <clips_dir> <masks_dir> <out.mp4> <in.mp4>`, then loudnorm two-pass, `python3 tools/contact-sheet.py <out.mp4> contact-sheet-final.jpg`.
