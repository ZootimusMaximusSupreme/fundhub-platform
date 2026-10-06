# Trigger map

There is **no per-script trigger table in the repo**. At export time `src/ad-videos/broll.mjs` (`planBroll`) reads Submagic word timings and matches **clip file names** to spoken words. Clip order comes from `src/messaging/providers/google-drive-write.mjs` (`listBrollClips`): deliverables folder first, then portal, then approvals; videos before stills inside each folder.

**Script words:** `marketing/ads/slo/fundhub-297/FundHub-LOCKED-ADS.md`

**Coverage matrix (measured 2026-09-23):** `docs/workflows/submagic-settings-lock-2026-09-23.md` (W3 section 4)

**Default today:** PNG/JPG stills are **not** offered (`src/ad-videos/pipeline.mjs` filters them unless `AD_VIDEO_BROLL_STILLS=1`). Eight screen-recorded **video** clips are named in `scripts/broll-upload-clips.mjs`; the board says they were not on Drive yet when written.

The table below is **in spoken order** for this script. "What gets plugged in" is the asset whose **file name tags** include the trigger word. Up to five clips run per take; the first three seconds stay on Chris's face; only one clip wins a moment (library order + cursor).

## Script

- **Name:** AD 3 — Straight offer, what your file is worth
- **Ad id (pipeline / `ad_scripts.ad_id`):** 86

## Triggers (in script order)

| Line or phrase (from script) | Trigger word | Asset at that word | Mapping lives in |
|---|---|---|---|
| You have no idea what your credit file is actually worth. Optimized correctly, your file could be worth two hundred, three hundred, four hundred thousand dollars in funding, and you just don't know how to get there in the shortest amount of time. | `credit` | credit-score-scores-bureaus-bureau.mp4 (named in scripts/broll-upload-clips.mjs — plugs in only if uploaded to Drive and still images are not winning the slot first); credit-analysis-report.png (Drive still — only if AD_VIDEO_BROLL_STILLS=1; default held back) | `src/ad-videos/broll.mjs` + W3 matrix in `docs/workflows/submagic-settings-lock-2026-09-23.md` |
| Then the two amounts. What you qualify for right now, and what you qualify for once your file is optimized. That difference is the money that starts your new business, funds the one you're already running, or gets you ahead of the guys you're competing with. | `qualify` | funding-qualify-qualified.mp4 (named in scripts/broll-upload-clips.mjs — plugs in only if uploaded to Drive and still images are not winning the slot first) | `src/ad-videos/broll.mjs` + W3 matrix in `docs/workflows/submagic-settings-lock-2026-09-23.md` |
| Then the two amounts. What you qualify for right now, and what you qualify for once your file is optimized. That difference is the money that starts your new business, funds the one you're already running, or gets you ahead of the guys you're competing with. | `business` | 41k-chase-ink-business-unlimited.jpg (Drive still — only if AD_VIDEO_BROLL_STILLS=1; default held back) | `src/ad-videos/broll.mjs` + W3 matrix in `docs/workflows/submagic-settings-lock-2026-09-23.md` |
| And the list of banks that will approve you once your file is there. | `list` | list-banks-bank-approve-approval-approved.mp4 (named in scripts/broll-upload-clips.mjs — plugs in only if uploaded to Drive and still images are not winning the slot first); bank-lender-match-list.png (Drive still — only if AD_VIDEO_BROLL_STILLS=1; default held back) | `src/ad-videos/broll.mjs` + W3 matrix in `docs/workflows/submagic-settings-lock-2026-09-23.md` |
| two, three, four hundred thousand dollars in funding | `funding` | funding-qualify-qualified.mp4 (named in scripts/broll-upload-clips.mjs — plugs in only if uploaded to Drive and still images are not winning the slot first); funding-snapshot.png (Drive still — only if AD_VIDEO_BROLL_STILLS=1; default held back) | `src/ad-videos/broll.mjs` + W3 matrix in `docs/workflows/submagic-settings-lock-2026-09-23.md` |


## Known wrong fires (same repo board)

These portal stills are **not** tied to this script's intent but can steal a slot if stills are turned on:

| Spoken word | Asset | Why it is wrong |
|---|---|---|
| `you` (early in every ad) | `what-you-own.png` | Portal screen, not the line Chris is on |
| `file` (credit file) | `send-a-file.png` | Upload button, not the credit file |

Source: `docs/workflows/submagic-settings-lock-2026-09-23.md` W3 section 4, item 3.
