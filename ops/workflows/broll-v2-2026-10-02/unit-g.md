# Unit G — shot lists + renders for the two tool-analogy ads

**Status: DONE (2026-10-02). All 12 clips are rendered (6 per script).**

- Scripts: "Script 3 — Tool analogy, SLO (current)" and "Script 4 — Tool analogy, sorting hat (current)" in `marketing/ads/notes-green-screen.md` (local `main`). No B-roll for the Apple Notes ads (Scripts 1 and 2).
- Shot list: `marketing/broll/shot-lists/2026-10-02-tool-analogy.md` (line, template, exact props, start time at 150 words a minute, length, MP4 name for every clip).
- Word totals match the scripts file (195 and 182).

## Clips (12)

All H.264, 1080x1920, 30 fps, yuv420p with bt709 tags, exact frame counts. 10.4 MB together. One `npx remotion render ... --codec=h264 --props=<file>` command per clip, typed at the terminal; no render script saved. The props files stayed in the session scratchpad, not the repo. `marketing/broll/out/` is gitignored. No `--gl=angle` was used.

| Clip | Template | Starts | Length | File (under `marketing/broll/out/`) |
|---|---|---|---|---|
| Script 3 #1 | FlatTireHammer | 0:16 | 3.5 s | `script-3/s3-01-flat-tire-hammer-0m16s.mp4` |
| Script 3 #2 | JackFix | 0:22 | 3.5 s | `script-3/s3-02-jack-fix-0m22s.mp4` |
| Script 3 #3 | FileItems | 0:35 | 3.0 s | `script-3/s3-03-file-items-0m35s.mp4` |
| Script 3 #4 | LenderList | 0:44 | 3.0 s | `script-3/s3-04-lender-list-0m44s.mp4` |
| Script 3 #5 | OfferStack | 0:54 | 3.5 s | `script-3/s3-05-offer-stack-0m54s.mp4` |
| Script 3 #6 | JackFix | 1:06 | 3.5 s | `script-3/s3-06-jack-fix-1m06s.mp4` |
| Script 4 #1 | FlatTireHammer | 0:22 | 3.5 s | `script-4/s4-01-flat-tire-hammer-0m22s.mp4` |
| Script 4 #2 | FileItems | 0:35 | 3.0 s | `script-4/s4-02-file-items-0m35s.mp4` |
| Script 4 #3 | FundingRounds | 0:42 | 3.5 s | `script-4/s4-03-funding-rounds-0m42s.mp4` |
| Script 4 #4 | ToolMatch | 0:56 | 4.0 s | `script-4/s4-04-tool-match-0m56s.mp4` |
| Script 4 #5 | FlatTireHammer | 1:02 | 3.0 s | `script-4/s4-05-flat-tire-hammer-1m02s.mp4` |
| Script 4 #6 | BookCall | 1:09 | 3.0 s | `script-4/s4-06-book-call-1m09s.mp4` |

## Changed from the first draft of the shot list (after Unit F finished)

- **Script 4 clip 4 (ToolMatch):** the first draft put the "Almost everybody grabs first" chip on the row "Your file's ready → Applying in rounds", which is a right tool in the script. Fixed to match Unit F's rule (the chip goes only on a wrong-tool row): the board now has four rows, three right tools plus a fourth row "Before your file is ready → Applying" (the line's own words). That row (index 3, counted from 0) is the one that lifts and carries the chip. No final card.
- **Script 4 clip 5 (FlatTireHammer):** eyebrow changed from "Almost everybody grabs first" to "Applying before the file is ready", so it does not repeat clip 4's chip and ties to the line before it.

## Checks run

- **No-text zones:** each of the 12 clips (the 6 earlier ones at their main and middle frames, the 6 Unit F ones at the end frame and a middle frame) was also rendered as a still with money switched off (`checkTextOnly`) and scanned: **0** drawn pixels in the top 14% (y 0–268) or the bottom 35% (y 1249–1919).
- **Looked at:** the end frame of every MP4 with red lines at the 14% and 65% edges, a frame strip of ToolMatch, OfferStack, FundingRounds and BookCall, and a full-size crop of the caption area on the two longest captions ("Without learning how it's made", "That's the hammer on the flat tire"). Both fit on one line inside the side margins. The ToolMatch chip sits on the top edge of row 4 and covers no words. Frame counts are exact (105, 105, 105, 105, 120, 90).
- **Fixed after looking (first six clips):** two eyebrows ran to the side margin ("A roadmap built from your own credit", "If something's holding your file back"); shortened to "Built from your own credit" and "Holding your file back" and re-rendered.

## Files (Unit G only)

- New: `marketing/broll/shot-lists/2026-10-02-tool-analogy.md`
- New: `ops/workflows/broll-v2-2026-10-02/unit-g.md` (this file)
- MP4s in `marketing/broll/out/script-3/` and `marketing/broll/out/script-4/` (gitignored, not committed)
- No template, kit or Root.tsx edits.

## Leftovers

- **Unit F's template, not touched:** on the last frames of FlatTireHammer and JackFix clips with a long eyebrow ("Applying before the file is ready", "You use it the way you use a jack", "Fixing a flat tire with a hammer"), a white lane dash from the road drifts across the top of the eyebrow's last letter (the Y, K or R). The words stay readable. Checked at full size in s4-05 and s3-06; s3-01 looked the same at low resolution. A shorter eyebrow or the dash drawn behind the text would fix it.
- Script 3 clip 6 (JackFix): the clock beside the caption turns a quarter of the way round (fifteen minutes), but the line "You use it the way you use a jack…" says no time. Template graphic, left as is.
