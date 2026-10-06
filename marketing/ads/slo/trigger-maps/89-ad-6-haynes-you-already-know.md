# Trigger map

There is **no per-script trigger table in the repo**. At export time `src/ad-videos/broll.mjs` (`planBroll`) reads Submagic word timings and matches **clip file names** to spoken words. Clip order comes from `src/messaging/providers/google-drive-write.mjs` (`listBrollClips`): deliverables folder first, then portal, then approvals; videos before stills inside each folder.

**Script words:** `marketing/ads/slo/fundhub-297/FundHub-LOCKED-ADS.md`

**Coverage matrix (measured 2026-09-23):** `docs/workflows/submagic-settings-lock-2026-09-23.md` (W3 section 4)

**Default today:** PNG/JPG stills are **not** offered (`src/ad-videos/pipeline.mjs` filters them unless `AD_VIDEO_BROLL_STILLS=1`). Eight screen-recorded **video** clips are named in `scripts/broll-upload-clips.mjs`; the board says they were not on Drive yet when written.

The table below is **in spoken order** for this script. "What gets plugged in" is the asset whose **file name tags** include the trigger word. Up to five clips run per take; the first three seconds stay on Chris's face; only one clip wins a moment (library order + cursor).

## Script

- **Name:** AD 6 — Haynes, you already know
- **Ad id (pipeline / `ad_scripts.ad_id`):** 89

## Triggers (in script order)

| Line or phrase (from script) | Trigger word | Asset at that word | Mapping lives in |
|---|---|---|---|
| **HOOK** You already know your credit file decides how much funding you can get. What you don't know is how much more that same file would carry if you optimized it first. | `more` | unlock-more.png (Drive still — only if AD_VIDEO_BROLL_STILLS=1; default held back) | `src/ad-videos/broll.mjs` + W3 matrix in `docs/workflows/submagic-settings-lock-2026-09-23.md` |
| **REASONS** For most people that gap is a couple hundred thousand dollars in extra capital. One card sitting too high. A couple of items nobody has addressed. Personal data that doesn't match across the three bureaus. Small fixes, and every one of them moves your fundability by more than you'd expect. That difference is what scales your company to multiple six figures a month, or funds the deal you've been waiting on, or gets the new thing off the ground. | `capital` | nothing is plugged in | `src/ad-videos/broll.mjs` + W3 matrix in `docs/workflows/submagic-settings-lock-2026-09-23.md` |
| **REASONS** For most people that gap is a couple hundred thousand dollars in extra capital. One card sitting too high. A couple of items nobody has addressed. Personal data that doesn't match across the three bureaus. Small fixes, and every one of them moves your fundability by more than you'd expect. That difference is what scales your company to multiple six figures a month, or funds the deal you've been waiting on, or gets the new thing off the ground. | `card` | 40k-business-card.jpg (Drive still — only if AD_VIDEO_BROLL_STILLS=1; default held back) | `src/ad-videos/broll.mjs` + W3 matrix in `docs/workflows/submagic-settings-lock-2026-09-23.md` |
| **REASONS** For most people that gap is a couple hundred thousand dollars in extra capital. One card sitting too high. A couple of items nobody has addressed. Personal data that doesn't match across the three bureaus. Small fixes, and every one of them moves your fundability by more than you'd expect. That difference is what scales your company to multiple six figures a month, or funds the deal you've been waiting on, or gets the new thing off the ground. | `personal` | 39k-personal-loan.jpg (Drive still — only if AD_VIDEO_BROLL_STILLS=1; default held back) | `src/ad-videos/broll.mjs` + W3 matrix in `docs/workflows/submagic-settings-lock-2026-09-23.md` |
| Nobody sits down and tells you how to 10x your file, because this industry makes its money on you staying unprepared. Your application goes out, it gets shotgunned to a list of banks, and whatever it gets you is what you take. | `10x` | nothing is plugged in | `src/ad-videos/broll.mjs` + W3 matrix in `docs/workflows/submagic-settings-lock-2026-09-23.md` |
| Nobody sits down and tells you how to 10x your file, because this industry makes its money on you staying unprepared. Your application goes out, it gets shotgunned to a list of banks, and whatever it gets you is what you take. | `list` | list-banks-bank-approve-approval-approved.mp4 (named in scripts/broll-upload-clips.mjs — plugs in only if uploaded to Drive and still images are not winning the slot first); bank-lender-match-list.png (Drive still — only if AD_VIDEO_BROLL_STILLS=1; default held back) | `src/ad-videos/broll.mjs` + W3 matrix in `docs/workflows/submagic-settings-lock-2026-09-23.md` |


## Known wrong fires (same repo board)

These portal stills are **not** tied to this script's intent but can steal a slot if stills are turned on:

| Spoken word | Asset | Why it is wrong |
|---|---|---|
| `you` (early in every ad) | `what-you-own.png` | Portal screen, not the line Chris is on |
| `file` (credit file) | `send-a-file.png` | Upload button, not the credit file |

Source: `docs/workflows/submagic-settings-lock-2026-09-23.md` W3 section 4, item 3.
