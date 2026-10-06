# Trigger map

There is **no per-script trigger table in the repo**. At export time `src/ad-videos/broll.mjs` (`planBroll`) reads Submagic word timings and matches **clip file names** to spoken words. Clip order comes from `src/messaging/providers/google-drive-write.mjs` (`listBrollClips`): deliverables folder first, then portal, then approvals; videos before stills inside each folder.

**Script words:** `marketing/ads/slo/fundhub-297/FundHub-LOCKED-ADS.md`

**Coverage matrix (measured 2026-09-23):** `docs/workflows/submagic-settings-lock-2026-09-23.md` (W3 section 4)

**Default today:** PNG/JPG stills are **not** offered (`src/ad-videos/pipeline.mjs` filters them unless `AD_VIDEO_BROLL_STILLS=1`). Eight screen-recorded **video** clips are named in `scripts/broll-upload-clips.mjs`; the board says they were not on Drive yet when written.

The table below is **in spoken order** for this script. "What gets plugged in" is the asset whose **file name tags** include the trigger word. Up to five clips run per take; the first three seconds stay on Chris's face; only one clip wins a moment (library order + cursor).

## Script

- **Name:** AD 2 — Straight offer, declined open
- **Ad id (pipeline / `ad_scripts.ad_id`):** 85

## Triggers (in script order)

| Line or phrase (from script) | Trigger word | Asset at that word | Mapping lives in |
|---|---|---|---|
| You got declined and nobody told you why. For $297 I'll tell you exactly why, and what it takes to get a yes. | `declined` | declined-decline-why.mp4 (named in scripts/broll-upload-clips.mjs — plugs in only if uploaded to Drive and still images are not winning the slot first) | `src/ad-videos/broll.mjs` + W3 matrix in `docs/workflows/submagic-settings-lock-2026-09-23.md` |
| Your credit pulled from all three bureaus. Where your score sits today and where it can sit once your file is cleaned up. On a lot of files that spread is a couple hundred thousand dollars in funding you're missing out on. | `credit` | credit-score-scores-bureaus-bureau.mp4 (named in scripts/broll-upload-clips.mjs — plugs in only if uploaded to Drive and still images are not winning the slot first); credit-analysis-report.png (Drive still — only if AD_VIDEO_BROLL_STILLS=1; default held back) | `src/ad-videos/broll.mjs` + W3 matrix in `docs/workflows/submagic-settings-lock-2026-09-23.md` |
| Every single thing on your file that got you turned down. The cards sitting too high, with the exact balance to bring each one down to. The harmful items, each one with the document you need to address it, already written with your accounts in it. | `cards` | nothing is plugged in | `src/ad-videos/broll.mjs` + W3 matrix in `docs/workflows/submagic-settings-lock-2026-09-23.md` |
| Every single thing on your file that got you turned down. The cards sitting too high, with the exact balance to bring each one down to. The harmful items, each one with the document you need to address it, already written with your accounts in it. | `accounts` | letter-letters-accounts-account.mp4 (named in scripts/broll-upload-clips.mjs — plugs in only if uploaded to Drive and still images are not winning the slot first) | `src/ad-videos/broll.mjs` + W3 matrix in `docs/workflows/submagic-settings-lock-2026-09-23.md` |
| And a list of the banks that will approve you once your file is fully optimized. | `list` | list-banks-bank-approve-approval-approved.mp4 (named in scripts/broll-upload-clips.mjs — plugs in only if uploaded to Drive and still images are not winning the slot first); bank-lender-match-list.png (Drive still — only if AD_VIDEO_BROLL_STILLS=1; default held back) | `src/ad-videos/broll.mjs` + W3 matrix in `docs/workflows/submagic-settings-lock-2026-09-23.md` |


## Known wrong fires (same repo board)

These portal stills are **not** tied to this script's intent but can steal a slot if stills are turned on:

| Spoken word | Asset | Why it is wrong |
|---|---|---|
| `you` (early in every ad) | `what-you-own.png` | Portal screen, not the line Chris is on |
| `file` (credit file) | `send-a-file.png` | Upload button, not the credit file |

Source: `docs/workflows/submagic-settings-lock-2026-09-23.md` W3 section 4, item 3.
