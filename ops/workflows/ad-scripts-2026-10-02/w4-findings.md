# W4 findings: which ads ran on Meta, and every VSL

Batch `ad-scripts-2026-10-02`. Written by W4 on 2026-10-02. Read only: nothing was changed in Meta, Google Drive, ClickFunnels or the database.

## Meta ads that ran

**Source:** the Meta Marketing API, read live on 2026-10-02 at 10:35 Arizona time (17:35 UTC), through the app's stored Meta connection. Ad account **Fundhub.ai (`act_982103620742368`)**. It is the only ad account that connection can see. **Range:** everything the account has ever run (Meta's "maximum" window). Seven ads have ever delivered, from 2026-08-04 to today. Dates use the account's time zone (Arizona). Today's numbers are partial.

| Meta ad id | Name | utm_content | Status | First / last delivery | Spend | Impressions | Link clicks | Leads | Purchases | ThruPlays | Matched script (file + ad number) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 120253626444660264 | oVid: SLO1 | oVid: SLO1 | ACTIVE | 2026-09-26 to 2026-10-02, still running (7 days) | $52.42 | 585 | 90 | 0 | 0 | 104 | `marketing/ads/slo/fundhub-297/FundHub-LOCKED-ADS.md`, AD 1, Straight offer, full read. SLO Ad 1, id 84 (`marketing/ads/slo/trigger-maps/84-ad-1-straight-offer-full-read.md`) |
| 120253626574340264 | oVid: SLO2 | oVid: SLO2 | ACTIVE | 2026-09-26 to 2026-10-02, still running (7 days) | $272.35 | 1,247 | 43 | 1 | 0 | 115 | `FundHub-LOCKED-ADS.md`, AD 7, Haynes, the call that was never a roadmap. SLO Ad 7, id 90 (`trigger-maps/90-ad-7-haynes-the-call-that-was-never-a-roadmap.md`) |
| 120253626579160264 | oVid: SLO3 | oVid: SLO3 | ACTIVE | 2026-09-26 to 2026-10-02, still running (7 days) | $95.48 | 2,113 | 119 | 0 | 0 | 218 | `FundHub-LOCKED-ADS.md`, AD 6, Haynes, you already know. SLO Ad 6, id 89 (`trigger-maps/89-ad-6-haynes-you-already-know.md`) |
| 120253626580720264 | oVid: SLO4 | oVid: SLO4 | ACTIVE | 2026-09-26 to 2026-10-02, still running (7 days) | $212.53 | 1,051 | 45 | 0 | 0 | 65 | `FundHub-LOCKED-ADS.md`, AD 3, Straight offer, what your file is worth. SLO Ad 3, id 86 (`trigger-maps/86-ad-3-straight-offer-what-your-file-is-worth.md`) |
| 120252674467320264 | oVid: 1 | oVid: 1 | PAUSED | 2026-08-04 to 2026-08-18 (11 days: Aug 4–7, Aug 12–18) | $76.08 | 1,024 | 48 | 0 | 0 | 85 | `marketing/ads/CONTROLS.md`, Ad 4, Blind Application. No registry id |
| 120252674768130264 | oVid: 2 | oVid: 2 | PAUSED | 2026-08-05 to 2026-08-20 (11 days: Aug 5–6, Aug 12–20) | $403.02 | 2,105 | 54 | 0 | 0 | 187 | `marketing/ads/CONTROLS.md`, Ad 2, Broker Burn Angle. No registry id |
| 120252674770740264 | oVid: 3 | oVid: 3 | PAUSED | 2026-08-04 to 2026-08-20 (11 days: Aug 4–5, Aug 12–20) | $168.54 | 1,142 | 36 | 0 | 0 | 58 | `marketing/ads/CONTROLS.md`, Ad 3, Competitor Angle. No registry id |
| | **Total** | | | | **$1,280.42** | **9,267** | **435** | **1** | **0** | **832** | 7 of 7 matched |

Meta's account-level "amount spent" reads $1,248.85. That is exactly the spend through Oct 1. The other $31.57 is today's spend so far.

### Video watch numbers (Meta's own counts, lifetime)

| Ad | Plays | Reached 25% | 50% | 75% | 95% | 100% | ThruPlays | Landing page views |
|---|---|---|---|---|---|---|---|---|
| oVid: SLO1 | 411 | 110 | 38 | 11 | 7 | 6 | 104 | 43 |
| oVid: SLO2 | 1,133 | 113 | 55 | 35 | 27 | 21 | 115 | 33 |
| oVid: SLO3 | 1,315 | 235 | 127 | 51 | 29 | 27 | 218 | 75 |
| oVid: SLO4 | 823 | 61 | 29 | 20 | 13 | 12 | 65 | 28 |
| oVid: 1 | 918 | 47 | 23 | 14 | 11 | 10 | 85 | 16 |
| oVid: 2 | 1,937 | 105 | 48 | 35 | 18 | 16 | 187 | 40 |
| oVid: 3 | 989 | 25 | 8 | 4 | 3 | 3 | 58 | 23 |

Meta returned no 2-second-play count for any of these ads.

### Campaigns

- **oPur: TOF-SLO: $297.** Objective: Sales. ACTIVE since 2026-09-26. One ad set, "oPur: TOF-SLO: 25-55M: SBOs: 2.5M". All four ads link to https://apply.fundhub.ai/roadmap/. Spend so far: $632.78.
- **oSched: VSL: Funding.** Objective: Leads. PAUSED. One ad set, "oSched: M28-55: Business Owners: 2.4m". Until Aug 11 the ads linked to https://fundhub.ai/vsl-825799, which is 404 today. From Aug 12 they linked to https://apply.fundhub.ai/watch. Spend: $647.64.
- **New Traffic Campaign.** Objective: Traffic. ARCHIVED. Made 2026-08-03 and stopped 20 seconds later. It never delivered.

### What the leads and purchases mean

- The one lead on oVid: SLO2 is a Meta pixel Lead. Our own database has one person tagged `utm_content = "oVid: SLO2"`, which lines up with it.
- oVid: SLO4 has one checkout started. That is not a purchase.
- No ad has a purchase. The three August ads have no lead and no booking event in Meta.

### How each ad was matched to its script

Meta keeps the original file name of every video uploaded to the ad account. Each ad's video ties back to one of those files:

| Meta ad | Uploaded file name in Meta | Length |
|---|---|---|
| oVid: SLO1 | Ad 1 — Straight offer, full read (DONE).mp4 | 52.3 s |
| oVid: SLO2 | SLO Ad 7 — Haynes, the call that was never a roadmap.mp4 | 64.3 s |
| oVid: SLO3 | SLO Ad 6 — Haynes, you already know, 10x your file.mp4 | 48.0 s |
| oVid: SLO4 | SLO Ad 3 (DONE).mp4 | 63.1 s |
| oVid: 1 | Ad_4___Blind_Application take1 eye contact (2).mp4 | 115.8 s |
| oVid: 2 | Ad_2___Broker_Burn_Angleeyecorrction (1).mp4 | 101.2 s |
| oVid: 3 | Ad_3___Competitor_Angleeye correction (1).mp4 | 110.2 s |

- The SLO matches come from Meta's breakdown by video. The August matches come from each ad's creative, which names its video. The lengths agree every time. The match is by file name. The spoken words were not checked against the video.
- The Meta ad names do not follow our ad numbers. "oVid: 1" is the Blind Application ad (CONTROLS Ad 4). "oVid: SLO2" is SLO Ad 7.
- The creatives were edited mid-run, on Aug 12 and Oct 1. Only the link and the URL tags changed. The videos stayed the same (same lengths).

### Never ran on this ad account

- CONTROLS **Ad 1, Denial Angle.** It was uploaded on 2026-08-03 as "Ad_1___Denial_Angleeye (1).mp4" (85.9 s), but no ad ever used it.
- Every other ad script has no ad on this account. That covers SLO Ads 2, 4, 5 and 8, the shorts, CONTROLS Scripts 7–9, the 48 concepts, and Ascension.

### utm_content

The URL tags on every ad send `utm_content={{ad.name}}`, so utm_content arrives as the ad's name ("oVid: SLO1"). It has no leading digits, so `fundhub_ad_id()` finds no ad id in it. That is why the matching above used Meta's video file names.

### Why the API and not our stored table

Our stored copy, `ad_metrics_daily`, holds 34 day-rows for these seven ads. It is missing Aug 4–16 for the book-a-call campaign. It has $86.86 of Meta's $647.64. It also stores no link clicks, leads or purchases. So the table above uses Meta's API, not the stored copy.

## VSL list

| VSL | Funnel | Where it lives | Status |
|---|---|---|---|
| Live sales-page VSL video (2:26, 1080p) | /roadmap $297 SLO | https://fundhub.ai/funnel/slo-vsl.mp4, playing on https://apply.fundhub.ai/roadmap (page `marketing/landing-pages/slo/slo-01-sales.html`). Repo file `public/funnel/slo-vsl.mp4`. Drive source "SLO Main Page VSL.mp4" (`1iPr3He8-GwkLaTA5RxPDaa2HgKkjNCDU`), edited 2026-09-25. Its raw pieces in the ad-video pipeline are named "SLO VSL 1 Open / Middle / FAQ / Close". | **Live, being replaced** by a rewrite |
| Live booking-page VSL video (1:28, 1080p) | /roadmap $297 SLO (booking page after purchase) | https://fundhub.ai/funnel/slo-vsl2-funding.mp4, playing on https://apply.fundhub.ai/roadmap-book (page `slo/slo-02-booking.html`). Repo file `public/funnel/slo-vsl2-funding.mp4`. Drive source "VSL 2 — Booking page.mp4" (`1d6fnyDWPwI7dZFWaCNRvppbyyQPogiJW`). | **Live.** Its 9/20 script is marked "being replaced" in `vsl-scripts-latest.md` |
| Repair-track VSL #3 | /roadmap $297 SLO (booking page, `track=repair`) | https://fundhub.ai/funnel/slo-vsl3-repair.mp4, named in `slo/slo-02-booking.html` | **Missing.** The file is 404 and there is no script in the repo |
| SLO VSL 1, sales page script (9/20, about 470 words) | /roadmap $297 SLO | `marketing/ads/reference/vsl-scripts-latest.md` ("SLO VSL 1"). The same script is in `marketing/ads/slo/fundhub-297/FundHub-VSL-Scripts.md` (VSL 1), in `marketing/ads/reference/locked-ads-2026-09.md` (VSL read-through, VSL 1), and in Claude Doc `3ccff488-b6c6-42b0-950c-619edcc6297c` | **Reference only** (being replaced) |
| SLO VSL 2, booking page script (9/20, about 290 words) | /roadmap $297 SLO | The same three repo files (VSL 2) | **Reference only** (being replaced) |
| Bullet VSL, Haynes flow (nine beats) | /roadmap $297 SLO | `marketing/ads/reference/locked-ads-2026-09.md` | **Superseded.** That file says the 9/20 read-throughs replace it for filming |
| SLO rewrite (the replacement Chris named) | /roadmap $297 SLO | Not in the repo | **Not found** in the repo |
| The Founder VSL, filmed as `VSL_Script_DirectROAS_v1`. This is the live /watch video (3:27, 960x540) | /watch book-a-call | Script: `marketing/ads/CONTROLS.md`, "The Founder VSL" (841 words). Live video: https://fundhub.ai/funnel/vsl.mp4 on https://apply.fundhub.ai/watch (ClickFunnels builder page 25061160). Repo file `public/funnel/vsl.mp4` (in the repo since 2026-08-17), the same cut as `marketing/landing-pages/assets/VSL.mov`. Drive "First Ads" holds the raw take `VSL_Script__DirectROAS_v1.mp4` (6:41, `1iqu_Vt4wlGRNJ7Luu_ZDZ8J-twszJpf0`) and three short cuts named "VSL Script (DirectROAS v1)" (1:41, 1:59, 1:18). None of them is the 3:27 cut. | **Live, being replaced** by the 9/30 script. CONTROLS.md and RULES.md tie the video to this script. The 3:27 cut's words were not checked against the script |
| /watch VSL, 9/30 script | /watch book-a-call | `marketing/ads/reference/vsl-scripts-latest.md` ("/watch VSL (book-a-call), latest, 9/30") | **Draft.** It is the current script and will replace the live /watch video. No filmed file found |
| /watch thank-you video, 9/30 script | /watch book-a-call (https://apply.fundhub.ai/thank-you) | `marketing/ads/reference/vsl-scripts-latest.md` | **Draft.** The live thank-you page has no video today |
| "VSL: Alternative Financing (Front-End)" (the Drive doc named in the ask) | Book-a-call, older version. It sells a soft-pull "see your real offers" application, then a strategy call | Drive `1Mkxc4eQr54IRC8U3AYR3jtm5ixoHoEqVVBNkqkcr4nY`, "Fundhub-VSL-FrontEnd-Funding-StrategyCall.md". About 5 minutes, filmed in the Cybertruck. Written 2026-07-18 | **Superseded** by the 9/30 /watch VSL. No filmed file found. Uses the $25 million and Koi Poke proof the newer rules ban |
| Funding Call Clarity (filmed, three takes: 5:55, 3:07, 1:42) | Other. The funnel is unclear | Drive "First Ads": `1sPR9ny_KV1iFX27ukkptnbzZClXeXTCu`, `1PPAAFsizY2dydeHNOFj_cmeI1JfrL6U-`, `1UDQ8DUnJ6GgaNTW8BgSB7mDb01iv_EH_` (filmed 2026-07-18) | **Filmed, not used.** It is on no live page and has no script in the repo. Not confirmed to be a VSL |
| VSL 1: Landing Page. Sells the $297 Underwrite IQ Diagnostic (about 5 minutes, Cybertruck) | Other: the older April $297 diagnostic offer | Drive `1APeRXWEfHSaycvC21gqlXbNBg_dZI1ye`, "Fundhub_VSL1_Landing_Page.docx" (2026-04-03). Copy: `1cLBmwj9jR-X4MAiDyzHFS2BnCQig8Fq7`, "Fundhub.ai VSL Landing Page 04/03/2026" | **Superseded** (old offer) |
| Landing Page VSL Script. $297 Diagnostic front end (about 3 minutes, about 550 words) | Other: April $297 diagnostic | Drive `16_wtGx8vq3YWZtfIAmDo--rIu0R6f5A4`, "Fundhub_LP_VSL_Script.docx" (2026-03-30) | **Superseded** |
| VSL 2: Thank You Page. Sells done-for-you funding after the $297 diagnostic (about 12 minutes; $3,000 deposit and a 10% fee) | Other: April $297 diagnostic | Drive `1yYpNRNYF7bYxBS7vuA6lqlaD_FGTbOD1`, "VSL DFY 04/03/2026.docx". Earlier version: `1N7qJyTNRuS-hEUipqoEexrP4O4hEPV2o`, "Fundhub_VSL2_Thank_You_Page.docx". `marketing/copy/Drive-Source-Index.md` lists two more copies (`1X5XBIiTB7f1k9PqnCw7Lxiyg19O6QHLd`, `12pKnCXwp1LIOFYCn36YXV9SqeDvje5oQ`), which were not opened | **Superseded** (old offer) |
| VSL V2, "Fundhub VSL Script, revised V2" (done-for-you funding for online businesses) | Other | Drive `1T2KJ_HVWwzDMHtXLID2DAXRfWi5ut4hVipS5wm2yABk` (March 2026) | **Superseded.** Uses the banned $25 million proof |
| fundhub_vsl_v2.docx | Unknown | Drive `199ZBgOB-uwIggJlr84R_PDSH7qBrnP1T` (2026-03-25) | **Could not read.** The Drive connector returned no text |
| Chris VSL 1.0, written in Dan Kennedy's voice (a 9-minute capital VSL: "$100,000 to $500,000 in 72 hours") | Other | Drive `17HQtLdrI1V8f1b4GJeqG4s70xyVKKz2yVRgXAOr2Ao4` (2024-11-15, shared by an outside writer) | **Superseded** (2024) |
| Chris Affiliate VSL Script (a Keynote file) | Other: affiliate | Drive `1RfS8ZvdRAxkdtb8F2lWzDruKi7RUtcXP` (file dated 2021-06-20) | **Superseded.** Not opened, because it is a Keynote file |
| Portal welcome video. Not a sales letter; listed because it sits in `marketing/vsl/` | Other: client portal, after purchase | Script: `marketing/vsl/portal-welcome-video.md`. Live file: https://fundhub.ai/assets/video/portal-welcome.mp4. Drive source "Fundhub Portal Welcome Video.mp4" (`1D0UAokYexCW6zaQfgJoIV8o0hmbsuGE_`) | **Live** since 2026-09-25 |

**Proof that the three funnel VSLs are live.** Our own video counter (`vsl_watch_sessions`) shows real viewings through today: `vsl.mp4` on /watch (207 s) since 2026-09-22, `slo-vsl.mp4` on /roadmap (146 s) since 2026-09-21, and `slo-vsl2-funding.mp4` on /roadmap-book (88 s) since 2026-10-01. Those first dates are when the counter started, not when each video went up. Each live file is the same size, byte for byte, as its repo copy.

**Left out on purpose.** The swipe and course files in `marketing/copy/Drive-Source-Index.md` are other people's VSLs, not ours: "Mastering VSLs SOP", "800 Book Offer VSL", "TODD DOWELL 3 ANGLES 1 VSL", "VSL Script (copywriting)" and "VSL Best Practices".

## Leftovers

- `ad_metrics_daily` is missing Aug 4–16 for the book-a-call campaign. It has $86.86 of Meta's $647.64, and it keeps no link clicks, leads or purchases. The 9/28 landing-page board (`ops/workflows/2026-09-28-landing-page-conversion.md`) quotes the stored numbers as if they were the whole run.
- Every live ad sends `utm_content={{ad.name}}` ("oVid: SLO1"), which has no leading digits. So no Meta ad can be tied to a registry id in our attribution tables.
- `https://fundhub.ai/funnel/slo-vsl3-repair.mp4` is still 404, and /roadmap-book swaps to it for `track=repair` visitors.
- `marketing/ads/CONTROLS.md` says the August ads book calls at $32–36 each. Meta shows 0 leads for the three that ran on this account, and Ad 1 (Denial) never ran here. Where the $32–36 came from was not checked.
- The live /watch VSL file is 960x540. The 4K rule covers non-ad videos.
- The ad-video pipeline table (`ad_videos`) has no delivery record for the four SLO videos that are live on Meta: no final file id and no delivered date.

## How I got this

- **Meta:** read-only Graph API v21.0 GET calls. Account insights at ad level for the "maximum" window, both lifetime and daily, plus ads, campaigns, ad videos, ad creatives, and the by-video breakdown. They used the stored Meta connection, unlocked through `src/adplatforms/tokens.mjs` the same way `api/campaigns/sync.mjs` does it. The key was never printed or saved.
- **Database:** `BEGIN READ ONLY … ROLLBACK` reads (only transaction-local `set_config`, no bare `SET`) of `ad_platform_connections`, `ads`, `ad_metrics_daily`, `client_ad_attribution`, `ad_videos` and `vsl_watch_sessions`. **Live pages:** `curl` with `?cb=<timestamp>` on /watch, /roadmap/, /roadmap-book, /thank-you and /roadmap-thank-you, then a `HEAD` on each video. Lengths were read from the MP4 headers.
- **Drive:** the Drive connector, for the named doc and its folder, the "First Ads" folder, and the own-copy VSL docs listed in `marketing/copy/Drive-Source-Index.md`. Plus one read-only `getFileMeta` call per video (repo Drive client) for the lengths. All one-off scripts stayed in the session scratchpad and are not in the repo.
