# Trigger map

There is **no per-script trigger table in the repo**. At export time `src/ad-videos/broll.mjs` (`planBroll`) reads Submagic word timings and matches **clip file names** to spoken words. Clip order comes from `src/messaging/providers/google-drive-write.mjs` (`listBrollClips`): deliverables folder first, then portal, then approvals; videos before stills inside each folder.

**Script words:** `marketing/ads/slo/fundhub-297/FundHub-LOCKED-ADS.md`

**Coverage matrix (measured 2026-09-23):** `docs/workflows/submagic-settings-lock-2026-09-23.md` (W3 section 4)

**Default today:** PNG/JPG stills are **not** offered (`src/ad-videos/pipeline.mjs` filters them unless `AD_VIDEO_BROLL_STILLS=1`). Eight screen-recorded **video** clips are named in `scripts/broll-upload-clips.mjs`; the board says they were not on Drive yet when written.

The table below is **in spoken order** for this script. "What gets plugged in" is the asset whose **file name tags** include the trigger word. Up to five clips run per take; the first three seconds stay on Chris's face; only one clip wins a moment (library order + cursor).

## Script

- **Name:** AD 7 — Haynes, the call that was never a roadmap
- **Ad id (pipeline / `ad_scripts.ad_id`):** 90

## Triggers (in script order)

| Line or phrase (from script) | Trigger word | Asset at that word | Mapping lives in |
|---|---|---|---|
| **HOOK** They told you to hop on a call and they'd walk you through your file. Remove your inquiries, show you the roadmap, tell you exactly what to fix. You got on the call and the whole thing turned into a pitch. | `roadmap` | roadmap-document-documents.mp4 (named in scripts/broll-upload-clips.mjs — plugs in only if uploaded to Drive and still images are not winning the slot first); credit-optimization-roadmap.png (Drive still — only if AD_VIDEO_BROLL_STILLS=1; default held back) | `src/ad-videos/broll.mjs` + W3 matrix in `docs/workflows/submagic-settings-lock-2026-09-23.md` |
| **HOOK** They told you to hop on a call and they'd walk you through your file. Remove your inquiries, show you the roadmap, tell you exactly what to fix. You got on the call and the whole thing turned into a pitch. | `pitch` | nothing is plugged in | `src/ad-videos/broll.mjs` + W3 matrix in `docs/workflows/submagic-settings-lock-2026-09-23.md` |
| And the roadmap is the single most valuable thing in this. The exact steps, in the exact order, to get from where your file is to where it could be. That's the difference between a little bit of funding and hundreds of thousands of dollars in personal funding plus hundreds of thousands in business funding, across multiple businesses. Stacked up, that's potentially seven figures. Every company in this space gatekeeps it for that exact reason. | `personal` | 39k-personal-loan.jpg (Drive still — only if AD_VIDEO_BROLL_STILLS=1; default held back) | `src/ad-videos/broll.mjs` + W3 matrix in `docs/workflows/submagic-settings-lock-2026-09-23.md` |
| And the roadmap is the single most valuable thing in this. The exact steps, in the exact order, to get from where your file is to where it could be. That's the difference between a little bit of funding and hundreds of thousands of dollars in personal funding plus hundreds of thousands in business funding, across multiple businesses. Stacked up, that's potentially seven figures. Every company in this space gatekeeps it for that exact reason. | `business` | 41k-chase-ink-business-unlimited.jpg (Drive still — only if AD_VIDEO_BROLL_STILLS=1; default held back) | `src/ad-videos/broll.mjs` + W3 matrix in `docs/workflows/submagic-settings-lock-2026-09-23.md` |
| So I took mine out of a call entirely. Ten years of doing this, hundreds of files. I'll pull your credit, tell you what you qualify for right now and what you qualify for once your file is optimized, name every single thing in the way, hand you the document for each one already written, and give you the exact order to set it all up. | `credit` | credit-score-scores-bureaus-bureau.mp4 (named in scripts/broll-upload-clips.mjs — plugs in only if uploaded to Drive and still images are not winning the slot first); credit-analysis-report.png (Drive still — only if AD_VIDEO_BROLL_STILLS=1; default held back) | `src/ad-videos/broll.mjs` + W3 matrix in `docs/workflows/submagic-settings-lock-2026-09-23.md` |
| Nobody calls you. Nobody pitches you. | `pitches` | nothing is plugged in | `src/ad-videos/broll.mjs` + W3 matrix in `docs/workflows/submagic-settings-lock-2026-09-23.md` |


## Known wrong fires (same repo board)

These portal stills are **not** tied to this script's intent but can steal a slot if stills are turned on:

| Spoken word | Asset | Why it is wrong |
|---|---|---|
| `you` (early in every ad) | `what-you-own.png` | Portal screen, not the line Chris is on |
| `file` (credit file) | `send-a-file.png` | Upload button, not the credit file |

Source: `docs/workflows/submagic-settings-lock-2026-09-23.md` W3 section 4, item 3.
