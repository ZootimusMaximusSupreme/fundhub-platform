# Ad and VSL inventory — 2026-10-02

Every ad Fundhub has written or run, what state it is in, and every VSL for both funnels.

**Status words:**

- **ran** — Meta shows the ad delivered (section 9 has the numbers).
- **approved** — locked by Chris, words final.
- **filmed** — an MP4 of it exists in the SLO Ads Drive folder (manifest of 2026-09-23).
- **draft** — written, never locked.
- **not found** — named somewhere, but the words are nowhere we can reach.

Where an ad is both approved and ran, it says both.

**Sources:** `marketing/ads/reference/locked-ads-2026-09.md` (Chris's 10-02 export of the Claude Doc), `marketing/ads/reference/vsl-scripts-latest.md`, `marketing/ads/CONTROLS.md`, `marketing/ads/CONCEPTS.md`, `marketing/ads/slo/fundhub-297/*`, `marketing/ads/POST-BOOKING-15.md`, `marketing/ads/ascension/ascension-ads.md`, `marketing/ads/registry.json`, `ops/workflows/slo-ads-drive-manifest-2026-09-23.md`, `ops/workflows/slo-ads-content-map-2026-09-23.md`, and the Meta and VSL lookups in `ops/workflows/ad-scripts-2026-10-02/w4-findings.md`.

## 1. $297 Funding Roadmap (SLO) — the locked set

Approved 9/19–9/22. The registry id is the `utm_content` id (from `marketing/ads/slo/trigger-maps/`). "Filmed" is the 9/23 transcript pass of every MP4 in the SLO Ads Drive folder (`ops/workflows/slo-ads-content-map-2026-09-23.md`); takes filmed after 9/23 are not counted.

| Ad | Angle | Status | Filmed (Drive) | Registry id | Meta |
|---|---|---|---|---|---|
| Ad 1 | Straight offer, full read | approved · **ran** | yes — `SLO Ad 1 Take 1` | 84 | `oVid: SLO1`, active since 9/26, $52.42, 90 link clicks, 0 purchases |
| Ad 2 | Straight offer, declined and nobody told you why | approved | no — the Riverside email named two takes, but the 9/23 transcript pass found no "declined" open in any file | 85 | never ran |
| Ad 3 | Straight offer, what your file is actually worth | approved · **ran** | yes — filed under the wrong name `SLO Ad 7 Call Pitch Take 2` | 86 | **ran** — `oVid: SLO4`, active since 9/26, $212.53, 45 link clicks, 1 checkout started, 0 purchases |
| Ad 4 | Straight offer, one card holding the file down | approved (rewritten 9/22) | no | 87 | never ran |
| Ad 5 | Straight offer, max fundability, both sides of the file | approved (rewritten 9/22) | no — the old `SLO Ad 5 Take 1` file was a piece of VSL 1 | 88 | never ran |
| Ad 6 | Haynes, you already know, 10x your file | approved · **ran** | partial — one partial take and one hook-only take, filed as `Call Pitch Take 3` and `Take 6` | 89 | **ran** — `oVid: SLO3`, active since 9/26, $95.48, 119 link clicks, 0 purchases |
| Ad 7 | Haynes, the call that was never a roadmap | approved · **ran** | yes — `SLO Ad 7 Call Pitch Take 1` (takes 2–9 are mostly other scripts or scraps) | 90 | **ran** — `oVid: SLO2`, active since 9/26, $272.35, 43 link clicks, 1 lead, 0 purchases |
| Ad 8 | Abandoned cart (retargeting) | approved | likely — `SLO Funding Roadmap Take 3` is a checkout-abandon take; the 9/23 pass did not match its words to Ad 8 | none in repo | never ran |
| Shorts 1–7 | max funding · gatekeeping · worth 2–3 hundred vs fifty · declined · call was a pitch · one card · ten years in $297 | approved | no | none | never ran |
| Bullet VSL | Haynes flow, nine beats | approved, superseded for filming by the VSL read-throughs | no | — | — |
| Deliverable walkthroughs (4) | Funding Snapshot · Credit Analysis Report · Credit Optimization Roadmap · Bank and Lender Match List | not written ("next to write") | no | — | — |
| Retargeting statics (6) | one per deliverable + the offer + the guarantee | brief for Paul (images, not scripts) | — | — | never ran |
| **Prop ads 9–20** | — | **not found** | — | — | — |

**Filmed with no script in the repo:** `SLO Ad 7 Take 1` (a "two sides" personal-and-business stacking take, per the 9/23 content map) · `SLO Retargeting Take 3` ("Funding Success Blueprint"). The file once named `SLO VSL Take 1` is the portal welcome video, not VSL 1.

**Prop ads 9–20 — searched and not found:** the repo (every file and every branch's git history), the Claude Doc the locked ads came from (it holds ads 1–8 only), and Google Drive full-text search. If they exist, they live in a chat window.

**The repo's old copy of the locked ads is behind.** `marketing/ads/slo/fundhub-297/FundHub-LOCKED-ADS.md` still has the older Ad 4 ("the roadmap without the call") and older Ad 5. The 10-02 export in `marketing/ads/reference/locked-ads-2026-09.md` has the 9/22 rewrites.

## 2. $297 drafts that were never locked

| File | Ads | Status |
|---|---|---|
| `slo/fundhub-297/FundHub-297-Ads-2026-09-18.md` | A1 full offer read · A2 callout open · A3 price anchor · A4 thirty-second cut · A5 disqualifier · B1 you already know · B2 you're doing this but · B3 circumstance · B4 qualify and disqualify · B5 real-time contextual · Haynes-flow VSL | draft |
| `slo/fundhub-297/FundHub-297-Ads-v2.md` | 1 ten seconds · 2 the hours · 3 wrong sequence · 4 the data · 5 straight read · 6 one payment · 7 you hold the receipts · 8 the levers · 9 where you live · 10 $297 against the course · S1–S4 · Haynes-flow VSL v2 | draft |
| `slo/fundhub-297/FundHub-297-Final-Ten.md` | H1–H5 Haynes five · S1–S5 straight offer five · M1 the call was a sales call · M2 the shotgun · M3 two moves away · M4 the read without the call · M5 pull it and find out | draft (the locked set replaced it) |

## 3. New in this batch (2026-10-02)

| Ad | Funnel | Status | Where |
|---|---|---|---|
| Ad 21, 22, 23 | $297 Funding Roadmap (/roadmap) | draft | `marketing/ads/scripts/2026-10-02.md` |
| Ad 24, 25, 26 | Sorting hat (/watch book-a-call) | draft | `marketing/ads/scripts/2026-10-02.md` |

## 4. Book-a-call (/watch) — the live controls

From `marketing/ads/CONTROLS.md`. Its header calls four ads and one VSL "filmed and running". Meta shows three of them ran Aug 4–20 and are paused now (section 9).

| Ad | Angle | Status |
|---|---|---|
| Ad 1 | Denial | filmed · uploaded to Meta 8/3, **never ran** |
| Ad 2 | Broker Burn | **ran** — `oVid: 2`, Aug 5–20, paused, $403.02, 54 link clicks, 0 leads |
| Ad 3 | Competitor | **ran** — `oVid: 3`, Aug 4–20, paused, $168.54, 36 link clicks, 0 leads |
| Ad 4 | Blind Application | **ran** — `oVid: 1`, Aug 4–18, paused, $76.08, 48 link clicks, 0 leads |
| Script 7 | Insider Access | draft (in CONTROLS, not on the filmed list) |
| Script 8 | Stop Before You Apply Again | draft (in CONTROLS, not on the filmed list) |
| Script 9 | Why I Built This | draft (in CONTROLS, not on the filmed list) |
| The Founder VSL | `VSL_Script_DirectROAS_v1` | live — the 3:27 video on /watch, being replaced (section 10) |

## 5. The concept sheet — 48 cold concepts

`marketing/ads/CONCEPTS.md`. Hooks plus angle notes, never full scripts. All **draft**.

1 Who Takes Them Off · 2 The Wrong Item First · 3 Nobody Can Promise A Deletion · 4 The No Is Still Talking · 5 The Handoff Nobody Bills You For · 6 Before Anyone Pulls It · 7 You Don't Need A Business · 8 Four Exits · 9 Built To Bring You Back · 10 One Shot Or Twelve · 11 Two More, Not Five · 12 Nobody Types Your Number · 13 Twenty-Four And Seventy-Two · 14 Under 600, Not For You · 15 The Same Twelve Banks · 16 The Order You Apply In · 17 Learning On Your File · 18 They Took The Swing Anyway · 19 Seven Days, Here's Why · 20 A Card On His Board · 21 What A Clean File Buys · 22 One Cell Number · 23 Ask Them How · 24 Collateral, Not Clutter · 25 Nobody Remembers Forty Files · 26 My Own File First · 27 Which Bureau They Pull · 28 Round Two · 29 The Application You Never Sent · 30 The Speed Of Your Bank Account · 31 Twenty-Five On A 720 · 32 Nobody Ran The Number · 33 Not A Loan Processor · 34 Seven Hundred And Clean · 35 Seventy-Five Files At Once · 36 A Thousand Hours · 37 The Clock On Us · 38 I Turn Most People Down · 39 Thirty Days Is A Bank · 40 Two Rounds In · 41 Two Answers End The Call · 42 Nobody Stacks $200K In One Shot · 43 Nobody Gets Your Login · 44 Thirty-Two Dollars · 45 Somebody Else's Credit File · 46 Nobody Teaches The Order · 47 Two Hundred First · 48 Thirty Days, By Law

## 6. Post-booking 30 — retargeting for people who already booked

`marketing/ads/POST-BOOKING-15.md`. Short vertical hooks for the 72 hours before a call. All **draft** ("pick 15").

1 What this call actually is · 2 Who this is for · 3 What the thirty-two dollar read is · 4 How we get paid · 5 Why there's a call at all · 6 What we actually look at · 7 Why we turn people down · 8 We're not a credit repair company · 9 What ten percent actually means · 10 What happens right after the soft pull · 11 Soft pull versus hard pull · 12 What the three doors are · 13 What the deposit goes toward · 14 What happens to the people you turn down · 15 The other guys want eight to ten thousand · 16 Is this a scam · 17 Will it work for me specifically · 18 I've tried something like this before · 19 Do I need a business · 20 I don't have the cash right now · 21 Why can't I just do this myself · 22 Can I put this on payments · 23 What if I don't qualify · 24 I need to talk to my spouse · 25 How long this takes · 26 What we need from you · 27 What approved does and doesn't mean · 28 What the first week looks like · 29 How much work is this on you · 30 What we're not going to do

## 7. Ascension (white-label partner offer)

`marketing/ads/ascension/ascension-ads.md`. Strategy plus hooks. All **draft**; the file says there are zero videos.

- **Ad set A, cold → $27 Decline Autopsy:** hooks 1 You Already Know · 2 You're Doing This, But · 3 Circumstance · 4 Qualify inside the ad · 5 Specificity · 6 Real-time contextual.
- **Ad set B, warm → $10,000 partnership:** hooks 1 You Already Know · 2 You're Doing This, But · 3 Circumstance · 4 Disqualify openly · 5 Objection first.
- **Ad set C:** the 72-hour "hammer them" plan before a review call (a plan, no scripts).

## 8. Registry ids

`marketing/ads/registry.json` holds 24 `utm_content` ids with lanes; only three carry a title. Ids: 16 phase (funding600) · 26 underwriter (uwiq) · 27–31 (uwiq) · 42 ringlights (funding600) · 43 (sorting) · 44 (funding600) · 45–46 (sorting) · 72–76 (white label) · 77 (funding600) · 78–79 (sorting) · 80 (premium) · 81 (funding600) · 82 (premium) · 83 (sorting). The SLO trigger maps add 84–90 for SLO Ads 1–7. None of the seven ads that ran carries a registry id: every live ad sends `utm_content={{ad.name}}` ("oVid: SLO1"), which has no leading digits, so the matching in section 9 used Meta's own video file names.

## 9. What actually ran on Meta

Read live from the Meta Marketing API on 2026-10-02 (read only, through the app's stored Meta connection). One ad account: **Fundhub.ai** (`act_982103620742368`). Window: everything the account has ever run. Seven ads have delivered, 2026-08-04 to today; today's numbers are partial.

| Meta ad | Script | Status | Delivered | Spend | Impressions | Link clicks | Leads | Purchases | ThruPlays |
|---|---|---|---|---|---|---|---|---|---|
| `oVid: SLO1` | $297 Ad 1 — full read (id 84) | active | 9/26 – today | $52.42 | 585 | 90 | 0 | 0 | 104 |
| `oVid: SLO2` | $297 Ad 7 — the call that was never a roadmap (id 90) | active | 9/26 – today | $272.35 | 1,247 | 43 | 1 | 0 | 115 |
| `oVid: SLO3` | $297 Ad 6 — you already know (id 89) | active | 9/26 – today | $95.48 | 2,113 | 119 | 0 | 0 | 218 |
| `oVid: SLO4` | $297 Ad 3 — what your file is worth (id 86) | active | 9/26 – today | $212.53 | 1,051 | 45 | 0 | 0 | 65 |
| `oVid: 1` | Book-a-call Ad 4 — Blind Application | paused | Aug 4–18 | $76.08 | 1,024 | 48 | 0 | 0 | 85 |
| `oVid: 2` | Book-a-call Ad 2 — Broker Burn | paused | Aug 5–20 | $403.02 | 2,105 | 54 | 0 | 0 | 187 |
| `oVid: 3` | Book-a-call Ad 3 — Competitor | paused | Aug 4–20 | $168.54 | 1,142 | 36 | 0 | 0 | 58 |
| | **Total** | | | **$1,280.42** | **9,267** | **435** | **1** | **0** | **832** |

**Watch curve (Meta's counts, lifetime):**

| Meta ad | Plays | 25% | 50% | 75% | 95% | 100% | Landing page views |
|---|---|---|---|---|---|---|---|
| `oVid: SLO1` | 411 | 110 | 38 | 11 | 7 | 6 | 43 |
| `oVid: SLO2` | 1,133 | 113 | 55 | 35 | 27 | 21 | 33 |
| `oVid: SLO3` | 1,315 | 235 | 127 | 51 | 29 | 27 | 75 |
| `oVid: SLO4` | 823 | 61 | 29 | 20 | 13 | 12 | 28 |
| `oVid: 1` | 918 | 47 | 23 | 14 | 11 | 10 | 16 |
| `oVid: 2` | 1,937 | 105 | 48 | 35 | 18 | 16 | 40 |
| `oVid: 3` | 989 | 25 | 8 | 4 | 3 | 3 | 23 |

- **Campaigns:** "oPur: TOF-SLO: $297" (Sales, active since 9/26, $632.78, all four ads link to https://apply.fundhub.ai/roadmap/) · "oSched: VSL: Funding" (Leads, paused; linked to fundhub.ai/vsl-825799 until Aug 11, then https://apply.fundhub.ai/watch; $647.64) · "New Traffic Campaign" (archived, never delivered).
- **The one lead** is a Meta pixel Lead on `oVid: SLO2`; one person in our database carries `utm_content = "oVid: SLO2"`. `oVid: SLO4` has one checkout started, which is not a purchase. No ad has a purchase.
- **How the match was made:** Meta keeps each uploaded video's original file name ("SLO Ad 7 — Haynes, the call that was never a roadmap.mp4", "Ad_2___Broker_Burn_Angle…"); lengths agree every time. The spoken words were not checked against the videos.
- **Never ran on this account:** $297 Ads 2, 4, 5 and 8, the seven shorts, the six statics, book-a-call Ad 1 (Denial — uploaded 8/3, never used) and Scripts 7–9, the 48 concepts, the post-booking 30, and Ascension.
- **Source detail and the stored-table gap:** `ops/workflows/ad-scripts-2026-10-02/w4-findings.md`. Our stored copy `ad_metrics_daily` holds only $86.86 of the book-a-call spend, so these numbers come from Meta's API.

## 10. VSL list — both funnels

| VSL | Funnel | Where it lives | Status |
|---|---|---|---|
| Live sales-page VSL video (2:26, 1080p) | /roadmap $297 | https://fundhub.ai/funnel/slo-vsl.mp4 on https://apply.fundhub.ai/roadmap/ · repo `public/funnel/slo-vsl.mp4` · Drive "SLO Main Page VSL.mp4" (`1iPr3He8-GwkLaTA5RxPDaa2HgKkjNCDU`), cut from "SLO VSL 1 Open / Middle / FAQ / Close" | **live, being replaced** by a rewrite |
| Live booking-page VSL video (1:28, 1080p) | /roadmap $297 (booking page after purchase) | https://fundhub.ai/funnel/slo-vsl2-funding.mp4 on https://apply.fundhub.ai/roadmap-book · repo `public/funnel/slo-vsl2-funding.mp4` · Drive "VSL 2 — Booking page.mp4" (`1d6fnyDWPwI7dZFWaCNRvppbyyQPogiJW`) | **live**; its 9/20 script is marked being replaced |
| Repair-track VSL #3 | /roadmap $297 (booking page, repair track) | https://fundhub.ai/funnel/slo-vsl3-repair.mp4 (named in `slo/slo-02-booking.html`) | **missing** — the file is 404 and no script exists |
| SLO VSL 1 — sales page script (9/20) | /roadmap $297 | `marketing/ads/reference/vsl-scripts-latest.md`; also `slo/fundhub-297/FundHub-VSL-Scripts.md` and `reference/locked-ads-2026-09.md` | **reference only** (being replaced) |
| SLO VSL 2 — booking page script (9/20) | /roadmap $297 | same three files | **reference only** (being replaced) |
| Bullet VSL, Haynes flow | /roadmap $297 | `marketing/ads/reference/locked-ads-2026-09.md` | **superseded** by the 9/20 read-throughs |
| The SLO rewrite | /roadmap $297 | not written yet | **not found** |
| The Founder VSL (`VSL_Script_DirectROAS_v1`) — the live /watch video (3:27, 960x540) | /watch book-a-call | script `marketing/ads/CONTROLS.md` "The Founder VSL" · video https://fundhub.ai/funnel/vsl.mp4 on https://apply.fundhub.ai/watch · repo `public/funnel/vsl.mp4` · Drive "First Ads" raw take (6:41, `1iqu_Vt4wlGRNJ7Luu_ZDZ8J-twszJpf0`) | **live, being replaced** by the 9/30 script |
| /watch VSL — 9/30 script | /watch book-a-call | `marketing/ads/reference/vsl-scripts-latest.md` | **draft** — the current script; not filmed yet |
| /watch thank-you video — 9/30 script | /watch book-a-call (https://apply.fundhub.ai/thank-you) | `marketing/ads/reference/vsl-scripts-latest.md` | **draft** — the live thank-you page has no video today |
| "VSL: Alternative Financing (Front-End)" — the Drive VSL scripts doc | book-a-call, older version | Drive `1Mkxc4eQr54IRC8U3AYR3jtm5ixoHoEqVVBNkqkcr4nY` (written 2026-07-18) | **superseded** by the 9/30 /watch VSL; uses the banned $25 million and Koi Poke proof |
| Funding Call Clarity (three filmed takes: 5:55, 3:07, 1:42) | unclear | Drive "First Ads" (`1sPR9ny_KV1iFX27ukkptnbzZClXeXTCu`, `1PPAAFsizY2dydeHNOFj_cmeI1JfrL6U-`, `1UDQ8DUnJ6GgaNTW8BgSB7mDb01iv_EH_`) | **filmed, not used**; no script in the repo |
| VSL 1: Landing Page — the April $297 Underwrite IQ Diagnostic | older offer | Drive `1APeRXWEfHSaycvC21gqlXbNBg_dZI1ye` (+ copy `1cLBmwj9jR-X4MAiDyzHFS2BnCQig8Fq7`) | **superseded** |
| Landing Page VSL Script — $297 Diagnostic front end | older offer | Drive `16_wtGx8vq3YWZtfIAmDo--rIu0R6f5A4` | **superseded** |
| VSL 2: Thank You Page — done-for-you after the diagnostic | older offer | Drive `1yYpNRNYF7bYxBS7vuA6lqlaD_FGTbOD1` (earlier `1N7qJyTNRuS-hEUipqoEexrP4O4hEPV2o`) | **superseded** |
| "Fundhub VSL Script, revised V2" | older | Drive `1T2KJ_HVWwzDMHtXLID2DAXRfWi5ut4hVipS5wm2yABk` | **superseded**; uses the banned $25 million proof |
| fundhub_vsl_v2.docx | unknown | Drive `199ZBgOB-uwIggJlr84R_PDSH7qBrnP1T` | **could not read** — Drive returned no text |
| Chris VSL 1.0 (Dan Kennedy voice, 2024) | older | Drive `17HQtLdrI1V8f1b4GJeqG4s70xyVKKz2yVRgXAOr2Ao4` | **superseded** |
| Chris Affiliate VSL Script (Keynote, 2021) | affiliate | Drive `1RfS8ZvdRAxkdtb8F2lWzDruKi7RUtcXP` | **superseded**; not opened |
| Portal welcome video (not a sales letter) | client portal | `marketing/vsl/portal-welcome-video.md` · https://fundhub.ai/assets/video/portal-welcome.mp4 | **live** since 2026-09-25 |

Proof the three funnel videos are live: our own watch counter (`vsl_watch_sessions`) shows real viewings through today on /watch, /roadmap and /roadmap-book, and each live file matches its repo copy byte for byte.

## 11. Angles, hooks and loop payoffs already used

The short list the six new ads were checked against. Full version: the board's Brief, section B6 (`ops/workflows/ad-scripts-2026-10-02.md`).

- **$297 locked:** full offer read · declined and nobody told you why (loop paid off: "I'll tell you exactly why") · what your file is worth (paid off: "I'll tell you what yours is worth") · one card holding the file down (paid off: which card and the balance) · two sides of the file (paid off next sentence: personal and business) · you already know your file decides funding (paid off: the gap is a couple hundred thousand) · the call that was never a roadmap (paid off: "the roadmap was never the product") · abandoned cart (four questions, the $11,000 first round).
- **$297 shorts:** tired of people who don't know · gatekeeping · worth two or three hundred vs fifty · declined · call was a pitch · one card · ten years in a $297 package.
- **$297 drafts:** price anchor · disqualifier · callout · thirty-second cut · circumstance (no time to learn credit) · template disputing · 700+ came back small · still scrolling · ten seconds · the hours · wrong sequence · the data · timeline was a sales answer · one payment · receipts · the levers · where you live · $297 vs course · the call was a sales call · the shotgun · two moves away · the read without the call · pull it and find out.
- **Book-a-call controls:** denial (paid off: "nobody ran your file through the same system a bank uses") · broker burn · competitor · blind application · insider access · stop before you apply · why I built this · the Founder VSL.
- **9/30 /watch VSL:** the condition of your credit decides $10K–$50K versus $100K–$1M · small details hold back even an 800 · loop "one step most people miss" → removing inquiries between funding rounds.
- **48 concepts and the post-booking 30:** titles in sections 5 and 6.
