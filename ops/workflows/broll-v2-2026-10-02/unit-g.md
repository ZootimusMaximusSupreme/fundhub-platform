# Unit G — shot lists + renders for the two tool-analogy ads

**Status: part done (2026-10-02). 6 of 12 clips rendered. The other 6 are waiting on Unit F.**

- Scripts: "Script 3 — Tool analogy, SLO (current)" and "Script 4 — Tool analogy, sorting hat (current)" in `marketing/ads/notes-green-screen.md` (local `main`). No B-roll for the Apple Notes ads (Scripts 1 and 2).
- Shot list: `marketing/broll/shot-lists/2026-10-02-tool-analogy.md` (line, template, exact props, start time at 150 words a minute, length, MP4 name for every clip).
- Clips: 6 per script. Word totals match the scripts file (195 and 182).

## Rendered (existing templates)

| Clip | Template | Starts | Length | File |
|---|---|---|---|---|
| Script 3 #3 | FileItems | 0:35 | 3.0 s | `marketing/broll/out/script-3/s3-03-file-items-0m35s.mp4` |
| Script 3 #4 | LenderList | 0:44 | 3.0 s | `marketing/broll/out/script-3/s3-04-lender-list-0m44s.mp4` |
| Script 3 #5 | OfferStack | 0:54 | 3.5 s | `marketing/broll/out/script-3/s3-05-offer-stack-0m54s.mp4` |
| Script 4 #2 | FileItems | 0:35 | 3.0 s | `marketing/broll/out/script-4/s4-02-file-items-0m35s.mp4` |
| Script 4 #3 | FundingRounds | 0:42 | 3.5 s | `marketing/broll/out/script-4/s4-03-funding-rounds-0m42s.mp4` |
| Script 4 #6 | BookCall | 1:09 | 3.0 s | `marketing/broll/out/script-4/s4-06-book-call-1m09s.mp4` |

All 6: H.264, 1080x1920, 30 fps, yuv420p with bt709 tags, exact frame counts (90 or 105). 3.7 MB together. One `npx remotion render ... --codec=h264 --props=<file>` command per clip, typed at the terminal; no render script saved. The props files were kept in the session scratchpad, not the repo. `marketing/broll/out/` is gitignored.

## Waiting on Unit F

`ops/workflows/broll-v2-2026-10-02/unit-f.md` has the props contract but no "TOOL TEMPLATES READY" heading yet. These 6 are written against that contract and not rendered:

| Clip | Template | Starts | Length | File (to render) |
|---|---|---|---|---|
| Script 3 #1 | FlatTireHammer | 0:16 | 3.5 s | `out/script-3/s3-01-flat-tire-hammer-0m16s.mp4` |
| Script 3 #2 | JackFix | 0:22 | 3.5 s | `out/script-3/s3-02-jack-fix-0m22s.mp4` |
| Script 3 #6 | JackFix | 1:06 | 3.5 s | `out/script-3/s3-06-jack-fix-1m06s.mp4` |
| Script 4 #1 | FlatTireHammer | 0:22 | 3.5 s | `out/script-4/s4-01-flat-tire-hammer-0m22s.mp4` |
| Script 4 #4 | ToolMatch | 0:56 | 4.0 s | `out/script-4/s4-04-tool-match-0m56s.mp4` |
| Script 4 #5 | FlatTireHammer | 1:02 | 3.0 s | `out/script-4/s4-05-flat-tire-hammer-1m02s.mp4` |

When resumed: read unit-f.md, render these 6 with the props in the shot list, look at a frame of each. Two things to check against Unit F's finished templates: (1) `highlight: 1` means the second row ("Applying in rounds") counting from 0; change it if Unit F counts from 1. (2) The longest captions ("That's the hammer on the flat tire", "Without learning how it's made") fit without running off; if not, cut them shorter using words from the same line.

## Checks run

- **No-text zones:** each rendered clip, at its hero frame and a middle frame, was also rendered as a still with money switched off (`checkTextOnly`). 12 stills scanned: **0** drawn pixels in the top 14% (y 0–268) or the bottom 35% (y 1249–1919). Words sit between y 303 (wordmark) and y 1175 at most, and between x 106 and x 905.
- **Looked at:** the hero frame of every MP4 (with red lines at the 14% and 65% edges), plus motion strips of OfferStack, FundingRounds, FileItems and BookCall. Real line text fits; no cut or missing card slices.
- **Fixed after looking:** two eyebrows ran to the side margin ("A roadmap built from your own credit", "If something's holding your file back"). They are now "Built from your own credit" and "Holding your file back", and both clips were re-rendered.

## Files (Unit G only)

- New: `marketing/broll/shot-lists/2026-10-02-tool-analogy.md`
- New: `ops/workflows/broll-v2-2026-10-02/unit-g.md` (this file)
- MP4s in `marketing/broll/out/script-3/` and `marketing/broll/out/script-4/` (gitignored, not committed)
- No template, kit or Root.tsx edits.

## Leftovers

- None.
