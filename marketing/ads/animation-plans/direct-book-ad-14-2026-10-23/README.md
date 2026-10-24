# Direct Book Ad 14 (780 and up, 13 optimization points) - animation build v2, diagrams only (2026-10-23)

Redo. v1 was numbered PathCards word lists and was rejected ("1234 isn't what I want", "animations should be diagrams"). v2 has no PathCards and no numbered list: every animation is a picture/diagram from the plan `marketing/ads/animation-plans/2026-10-22.json` (entry "Direct Book Ad 14"), with his filmed words only.

Input `~/Downloads/Direct Book Ad 14 — 780 and up, 13 optimization points.mp4` (1080x1920, 30 fps, 2224 frames, 74.14 s, captions burned in, never modified). Output `~/Downloads/Direct Book Ad 14 — 780 and up, 13 optimization points Animated.mp4` (151 MB, not in the repo). Animations only: no cut, audio stream-copied.

## Animations (size = width of the diagram as % of 1080)

| # | Window | Template | What it shows | Size | Where |
|---|---|---|---|---|---|
| 1 | 1.9-3.9 s | FundhubLogo | the fundhub. logo | 81% | behind him |
| 2 | 9.5-11.3 s | ScoreBadge | score gauge, 780 or higher | 69% | in front of his hair |
| 3 | 11.3-15.0 s | StampCard | tax-return document stamped Not asked, bank-statements plate | 55% | in front of his hair |
| 4 | 20.5-28.2 s | FundingStack | funding types stack into one block | 79% | in front of his hair |
| 5 | 28.2-32.1 s | BureauMatch | three credit reports, one mismatch, approvals cut in HALF | 83% | in front of his hair |
| 6 | 32.2-37.1 s | HiddenDataPoints | 13 dots around the count 13 optimization points | 69% | in front of his hair |
| 7 | 37.2-41.6 s | HiddenDataPoints | 13 dots, we double your approval odds | 69% | in front of his hair |
| 8 | 42.9-45.8 s | StampCard | folder stamped Approves you | 55% | in front of his hair |
| 9 | 45.9-53.0 s | LenderList | a much bigger list of banks, row by row | 66% | in front of his hair |
| 10 | 53.1-58.7 s | InquiriesOff | inquiries struck off, money rides to the next round | 57% | in front of his hair |
| 11 | 58.8-74.1 s | BookCall | calendar picks a time, We'll pull your reports | 71% | in front of his hair |

11 animations, none overlap, none is a numbered list. #1 (logo) starts at 1.9 s on "Fundhub"; #2 (score gauge) starts inside the first 10 s (9.5 s) and lands 780 on "score". #11 is the CTA on "click the link below" and stays to the end.

## Why these templates (plan vs filmed)
The plan was written for the script, the filmed take differs: no "you owe us nothing", no "if either deadline slips", no spoken paragraph about the three paths (PathCards in the plan: dropped, owner says no lists), and the 24/72 hour line is the last sentence under the CTA (DeadlineClocks dropped: the CTA holds to the end). "780 or higher" is spoken in the first sentence, so the gauge plays on his later "Having a high score is all that matters" (the plan note: ScoreBadge threshold). Plan props are kept, words changed only to what he says:
- StampCard (document): "Banks don't ask for / Your tax returns", stamp "Not asked", "They don't ask for your bank statements" (plan, verbatim).
- FundingStack: Credit cards, Lines of credit, SBA, MCA, Personal funding / "Stack all of it and blend it together" (plan, verbatim).
- BureauMatch: "Your three credit reports / A mismatch on one of them", three "Credit report" cards, stage 1 matches, stage 2 mismatch "Cuts your approvals in HALF" (plan, bureau names are not said so generic).
- HiddenDataPoints x2: "We check every file on 13 optimization points / Before a single application goes out" and "When we optimize those 13 points / We double your approval odds".
- StampCard (folder): "Fewer denials / Every application goes to a bank / Approves you" (the stamp has to come after the folder, so the tag carries the first half of his sentence).
- LenderList: "Our AI matching system / A much bigger list of banks / Than anyone else", names blank (no bank named).
- InquiriesOff: his words: "After every round of funding", "This round of funding", "Inquiries", "Removed", "Next round", "Faster than everyone else".
- BookCall (CTA): eyebrow "Click the link below", confirmation "We'll pull your reports". The picked-day chip ("Wed 15 - 2:30 PM") is hidden (new prop `showPicked: false`), so no day or time is named. The calendar grid and slot times are the template's generic art.
Not covered (no template that says it without inventing words): 0.1-9.5 s except the logo, 15.1-20.4 s (lowest terms, fastest timelines, maximum amount), 50.5-53 s ("send out more applications"), and the last paragraph.

## Timing: payoff on his word (skill rules "land the payoff" and "stretch to fit")
Each clip was rendered at a stretch k (length L = default length x k, `REMOTION_UNCLAMP=1`, so past the catalog's 2.5-4.5 s cap) and started so its parts hit his words (word times from whisper small.en, `words-timeline.txt`). Held pictures use frame hold (`hold_frames`) so a diagram stays up through the whole thought.

| Moment | He says | On screen (from start + frame x k) |
|---|---|---|
| #1 | "Fundhub" 1.90 | plate 1.93 s, letters land 2.4 s |
| #2 | "high score" 10.2-10.7 | gauge marker rides 9.8-10.4, 780 lands 10.67 s |
| #3 | "tax returns" 13.1 / "bank statements" 14.5 | stamp slams 12.97, settles 13.2; plate 14.3 |
| #4 | credit cards 21.7, lines 22.5, SBA 23.4, MCA 24.1, personal 24.9 | rows 21.8, 22.5, 23.2, 24.0, 24.8; block closes 26.6; caption 27.2 ("blend it together" 27.4) |
| #5 | "mismatch" 28.5, "half" 31.5 | title 28.4; mismatch card 31.1; HALF 31.3 |
| #6 | "13" 33.7 | count reaches 13 at 33.9 |
| #7 | "13 points" 38.3, "double" 39.0 | 13 at 38.5; "We double your approval odds" 38.9 |
| #8 | "every application" 43.5, "approves" 45.3 | folder 43.4; stamp slams 45.1, settles 45.4 |
| #9 | "Our AI matching" 46.0, "than anyone else" 49.4 | title 46.3; rows 46.8-48.7 (early by about 1 s); footer 49.6 |
| #10 | "remove" 53.4, "after every round" 54.8, "so we run each round" 56.5, "faster than everyone else" 57.3 | start 53.2; struck 55.6; Next round 56.8; note 57.3 |
| #11 | "click the link below" 58.8, "pull your reports" 60.3-60.9 | pill 58.9; day 59.6, time 60.4; "We'll pull your reports" 60.8 |

## Where plates sit
His head fills the middle: hairline y about 600, eyebrows 770, captions from y 1500. Free band: y 10-655. All diagrams sit in it, in front of his hair (never below y 662), alternating left, centre and right. The logo sits behind him. A few transients (stamp slam, mismatch card) can touch y 700 for about 0.2 s (frame PSNR on y 670-1450 min 33.4, mean 44.6). There is no room for a plate over his chest: chin y 1275, captions 1500.

## Template changes (additive, all off by default)
- `clipTimeline.ts`, `brand/format.ts`: `REMOTION_UNCLAMP=1` lifts the 2.5-4.5 s length cap for timed renders.
- `PathCards`: optional `cardStarts` (kept from v1, unused in v2).
- `BookCall`: optional `showPicked` (hide the day-and-time chip).
- `LenderList`, `InquiriesOff`: floating words sit on the white `ReadPlate` in see-through mode (unreadable over film before). Page-on renders are unchanged.

## Checks
- Duration 74.14 s, 2224 frames, 30 fps, 1080x1920 in both. Audio stream copy md5 identical (050e755a5e6cf49cf17bb5db0779029a).
- Caption band y 1450-1850 frame by frame: PSNR min 45.9, mean 50.0.
- Every diagram is at least 10 px inside the frame (schedule asserts it). Contact sheet looked at: `contact-sheet-final.jpg`.

## Open
- Sizes 55-84% wide: tall templates (StampCard 55%, InquiriesOff 57%, LenderList 66%, Score/Hidden 69%) do not reach 70% in the 650 px free band.
- #9 title and rows are early against his words (stretch compromise); #6 subline and #3 stamp pop a little early/late (see table).
- Repeat: #6 and #7 are the same template back to back (the plan used HiddenDataPoints for both lines).
- Not wired into the pipeline; clip renders are in the scratch folder.

## Redo
`python3 -I tools/make-schedule.py`; render each clip from `marketing/broll` with `REMOTION_UNCLAMP=1 npx remotion render src/index.ts <Template> <clip>.mov --props=props/<key>.json --codec=prores --prores-profile=4444 --image-format=png --pixel-format=yuva444p10le` (`props-index.json` has template and props per clip); masks with `tools/matte.swift`; `python3 -I tools/build-from-schedule.py <clips_dir> <out.mp4> <in.mp4> --behind <masks_dir>`; `python3 tools/contact-sheet.py <out.mp4> contact-sheet-final.jpg`.
