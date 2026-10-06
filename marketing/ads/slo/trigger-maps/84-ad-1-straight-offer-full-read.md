# Trigger map

There is **no per-script trigger table in the repo**. At export time `src/ad-videos/broll.mjs` (`planBroll`) reads Submagic word timings and matches **clip file names** to spoken words. Clip order comes from `src/messaging/providers/google-drive-write.mjs` (`listBrollClips`): deliverables folder first, then portal, then approvals; videos before stills inside each folder.

**Script words:** `marketing/ads/slo/fundhub-297/FundHub-LOCKED-ADS.md`

**Coverage matrix (measured 2026-09-23):** `docs/workflows/submagic-settings-lock-2026-09-23.md` (W3 section 4)

**Default today:** PNG/JPG stills are **not** offered (`src/ad-videos/pipeline.mjs` filters them unless `AD_VIDEO_BROLL_STILLS=1`). Eight screen-recorded **video** clips are named in `scripts/broll-upload-clips.mjs`; the board says they were not on Drive yet when written.

The table below is **in spoken order** for this script. "What gets plugged in" is the asset whose **file name tags** include the trigger word. Up to five clips run per take; the first three seconds stay on Chris's face; only one clip wins a moment (library order + cursor).

## Script

- **Name:** AD 1 — Straight offer, full read
- **Ad id (pipeline / `ad_scripts.ad_id`):** 84

## Triggers (in script order)

| Line or phrase (from script) | Trigger word | Asset at that word | Mapping lives in |
|---|---|---|---|
| For $297 I'll tell you how much funding you qualify for right now, and how much you qualify for once your file is optimized. | `funding` | funding-qualify-qualified.mp4 (named in scripts/broll-upload-clips.mjs — plugs in only if uploaded to Drive and still images are not winning the slot first); funding-snapshot.png (Drive still — only if AD_VIDEO_BROLL_STILLS=1; default held back) | `src/ad-videos/broll.mjs` + W3 matrix in `docs/workflows/submagic-settings-lock-2026-09-23.md` |
| Your credit pulled from all three bureaus. Where your score sits today and where it can sit once your file is cleaned up. | `credit` | credit-score-scores-bureaus-bureau.mp4 (named in scripts/broll-upload-clips.mjs — plugs in only if uploaded to Drive and still images are not winning the slot first); credit-analysis-report.png (Drive still — only if AD_VIDEO_BROLL_STILLS=1; default held back) | `src/ad-videos/broll.mjs` + W3 matrix in `docs/workflows/submagic-settings-lock-2026-09-23.md` |
| Your credit pulled from all three bureaus. Where your score sits today and where it can sit once your file is cleaned up. | `score` | credit-score-scores-bureaus-bureau.mp4 (named in scripts/broll-upload-clips.mjs — plugs in only if uploaded to Drive and still images are not winning the slot first) | `src/ad-videos/broll.mjs` + W3 matrix in `docs/workflows/submagic-settings-lock-2026-09-23.md` |
| Everything on your file holding you back, we show you all of it. Sometimes it's one item. Sometimes it's twelve. Every one of them comes with the document you need to address it, so you can maximize your fundability. | `document` | roadmap-document-documents.mp4 (named in scripts/broll-upload-clips.mjs — plugs in only if uploaded to Drive and still images are not winning the slot first) | `src/ad-videos/broll.mjs` + W3 matrix in `docs/workflows/submagic-settings-lock-2026-09-23.md` |
| And we give you a list of the banks that will approve you once your file is fully optimized. | `list` | list-banks-bank-approve-approval-approved.mp4 (named in scripts/broll-upload-clips.mjs — plugs in only if uploaded to Drive and still images are not winning the slot first); bank-lender-match-list.png (Drive still — only if AD_VIDEO_BROLL_STILLS=1; default held back) | `src/ad-videos/broll.mjs` + W3 matrix in `docs/workflows/submagic-settings-lock-2026-09-23.md` |
| Click below, pay the $297, fill out the form. Takes about ten seconds. Then you're holding the roadmap that takes a file that only qualifies for fifty thousand and turns it into a file worth several hundred thousand. | `roadmap` | roadmap-document-documents.mp4 (named in scripts/broll-upload-clips.mjs — plugs in only if uploaded to Drive and still images are not winning the slot first); credit-optimization-roadmap.png (Drive still — only if AD_VIDEO_BROLL_STILLS=1; default held back) | `src/ad-videos/broll.mjs` + W3 matrix in `docs/workflows/submagic-settings-lock-2026-09-23.md` |
| We pull your credit with a soft inquiry, so your score doesn't move. | `inquiry` | inquiry-inquiries-soft.mp4 (named in scripts/broll-upload-clips.mjs — plugs in only if uploaded to Drive and still images are not winning the slot first) | `src/ad-videos/broll.mjs` + W3 matrix in `docs/workflows/submagic-settings-lock-2026-09-23.md` |


## Known wrong fires (same repo board)

These portal stills are **not** tied to this script's intent but can steal a slot if stills are turned on:

| Spoken word | Asset | Why it is wrong |
|---|---|---|
| `you` (early in every ad) | `what-you-own.png` | Portal screen, not the line Chris is on |
| `file` (credit file) | `send-a-file.png` | Upload button, not the credit file |

Source: `docs/workflows/submagic-settings-lock-2026-09-23.md` W3 section 4, item 3.
