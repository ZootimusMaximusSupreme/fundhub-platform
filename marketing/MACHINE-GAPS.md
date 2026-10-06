# Fundhub marketing machine — what works, what is missing

As of 2026-10-05, about 5:30pm Arizona time. Written by workflow W5 of `ops/workflows/finish-builds-2026-10-05.md`.

This is a read-only check. Nothing was fixed, sent, or paid for. Every fact names where it came from: a file and line, or a live check. Live checks are listed at the bottom.

## Words used here

- **Meta** is the company that runs Facebook and Instagram ads.
- **Pixel** is a small tag on a web page. It tells Meta that someone was there.
- **Server events** are the same signal, sent from our own server instead of the browser. Meta calls this the Conversions API.
- **Ad tag** (UTM tag) is text stuck on the end of an ad's link. It says which ad sent the person.
- **Ad number** is Fundhub's own number for one ad, like 84.
- **Sweeper** is a job that runs by itself on a clock.
- **Submagic** is the service that adds captions to a video.
- **B-roll** is short extra clips laid over the talking video.
- **Drip** is a set of texts or emails sent over several days.
- **Watch curve** shows how many people are still watching at each second.

## The big picture

- The $297 ads spent **$877.63** from September 26 to October 4. Meta recorded **0 sales**. Our checkout recorded **0 paid orders**. (`ops/workflows/roadmap-marketing-2026-10-04.md:9`)
- **135** real people opened /roadmap from October 1 to 4. **2** pressed the buy step. **0** paid. **0** booked a call. (same file, line 108)
- Most people leave the ad in the first 2 seconds. SLO2 got 57% of the money and kept only 10% of viewers at the quarter mark. (same file, lines 44, 49, 77)
- Our database copy of the 7 Meta ads says all 7 are **PAUSED** (last refreshed October 5, 04:08 UTC). (live check 3)
- /roadmap now shows **$147** with $297 crossed out. (live check 2)

---

## 1. Avatar, offer and copy flywheel (stages 1–6)

The flywheel turns market research into an offer, then ads, then spend. Only one flywheel exists, and it is for the **partner** offer. There is no flywheel for the $297 roadmap. (Looked in `marketing/flywheel/`: only `README.md` and `partner/`.)

**LIVE and proved**
- Stage 1, avatar: approved, 133 quotes. (`npm run flywheel:status`, live check 5; `marketing/flywheel/partner/01-avatar.md`)
- Stage 2, ad research: approved. 361 findings, 8 checked, 160 competitors. (`marketing/flywheel/partner/02-ad-research.md:3-11`)
- The status checker works. (`package.json:46`, `scripts/flywheel/status.mjs`)

**BUILT but unproved**
- Stage 3, offer: written, but the checker says **FAILED**: "did not report guarantees". (`marketing/flywheel/partner/03-offer.md`, status `draft` on line 4)
- Stage 4, copy: 31 hooks written, but the checker says **FAILED**: "did not report distinctReasons". (`marketing/flywheel/partner/04-copy.md`)
- Stage 5, ad strategy: written, but the checker says **BLOCKED**, waiting on 3 and 4. (`marketing/flywheel/partner/05-ad-strategy.md`)
- The board is out of date. It says stage 2 is "first run in progress" and stages 3–5 are "built, not run". All four files exist. (`ops/workflows/flywheel-partner.md:12-15`)

**MISSING**
- Stage 6, spend: "has not been run yet" (checker). "not started" (`ops/workflows/flywheel-partner.md:16`). "Stage 6 has no workflow yet" (line 58).
- No partner ad has run. None of the 7 ads in our database is named for the partner offer. (live check 3: names are `oVid: 1–3` and `oVid: SLO1–SLO4`)
- Meta Ad Library access is blocked on Chris. The board says nothing waits on it. (`ops/workflows/flywheel-partner.md:53-57`)
- The "Marketing Machine build spec" lives only in an archived Claude chat. `docs/specs/marketing-machine-2026-10-04.md` does not exist. (`ops/workflows/repo-sync-and-thread-cleanup-2026-10-05.md:122`; looked in `docs/specs/`)

## 2. Ad scripts

**LIVE and proved**
- 4 of the $297 ads ran on Meta from September 26: Ads 1, 3, 6 and 7. (`marketing/ads/scripts/ALL-ADS-since-2026-09-03.md:9`) In Meta they are named SLO1–SLO4. (branch `ad-scripts-2026-10-02`, `ops/workflows/ad-scripts-2026-10-02.md:210`)
- What each one spent and how long people watched: `ops/workflows/roadmap-marketing-2026-10-04.md:41-47`.
- Every script since September 2 is on main, word for word: 32 full ads, 7 shorts, 6 videos. (`marketing/ads/scripts/ALL-ADS-since-2026-09-03.md:18`)

**BUILT but unproved** (written, never ran)
- Approved, not filmed: Ads 2, 4, 5, 8 and Shorts 1–7. (`marketing/ads/scripts/ALL-ADS-since-2026-09-03.md:10`)
- Prop ads 9–20, written September 28, not filmed. (same file, line 11)
- Drafts: Ads 21–23, Notes scripts 1 and 3, sorting hat Ads 24–26. (same file, lines 12–14)
- The book-a-call final scripts and green screen talking points are only on branch `all-scripts-2026-10-03`. (`TODO.md:17`; `ops/workflows/repo-sync-and-thread-cleanup-2026-10-05.md:114`) W1 is merging it.
- `marketing/ads/INVENTORY-2026-10-02.md` and `marketing/ads/scripts/2026-10-02.md` are only on branch `ad-scripts-2026-10-02`. (repo-sync board line 113) W1 is merging it.

**MISSING**
- The switch from full scripts to bullet points is not done. (`TODO.md:56`)

## 3. Ad video pipeline (filming, joining takes, captions, B-roll)

**LIVE and proved**
- Every filmed take lands in one Drive folder, SLO Ads. (`ops/workflows/slo-ads-drive-manifest-2026-09-23.md:4`)
- SLO Ads 1–7 were filmed. (branch `ad-scripts-2026-10-02`, `ops/workflows/ad-scripts-2026-10-02.md:161`) The 2 VSLs, the bank ad and the penthouse ad were filmed. (`TODO.md:15`, checked off)
- On the live site the robot found a take and made a Submagic project. (`ops/workflows/submagic-settings-lock-2026-09-23.md:1076`) It put our own moving clips on it. (line 1238)
- One take reached "waiting for approval". (same file, line 1239)
- The phone push (ntfy) arrived. (`ops/workflows/grok-handoff-ad-video-text-2026-09-24.md:22`)
- The database tracks 24 takes today: 10 landed, 2 staged, 6 editing, 2 waiting for approval, 4 failed. (live check 3)

**BUILT but unproved**
- The approve link and the delivery to Paul's folder exist in code. (`api/public/ad-video-approve.mjs`; `src/ad-videos/pipeline.mjs:844`) No take has ever been approved or delivered: **0** rows are approved or delivered. (live check 3) The 2 takes waiting for approval have not moved since September 24. (live check 3)
- Saving our own copy of the finished video: the step exists (`src/ad-videos/pipeline.mjs:727`) but the worker never turns it on (`netlify/functions/ad-video-worker-background.mjs:60`). "Our own copy of the finished file was not taken." (`ops/workflows/submagic-settings-lock-2026-09-23.md:1147`)
- The text message to Chris: the code exists (`src/ad-videos/notify-fanout.mjs`). The proof line `sms: sent` was never seen. (`ops/workflows/grok-handoff-ad-video-text-2026-09-24.md:22, 89`; `ops/workflows/submagic-settings-lock-2026-09-23.md:1250`)
- B-roll: 12 clips rendered for 2 scripts, only on branch `ad-scripts-2026-10-02` (`ops/workflows/broll-v2-2026-10-02/unit-g.md:3` there). The 1.7 GB of rendered files live only in that worktree folder. (repo-sync board line 120) W1 is backing them up.
- The database tests for this feature have never run. (`docs/journeys/ad-video-flow.md:275`)

**MISSING**
- **Joining takes into one best master and cutting dead air.** The law requires it (`.claude/rules/ad-video-best-of-clips.md`). There is no code for it. Searched `src/`, `scripts/` and `netlify/` for ffmpeg, concat, silencedetect, mergeTakes and best-of. The pipeline works one Drive file at a time (`docs/journeys/ad-video-flow.md:49`). Submagic's own bad-take removal is off (`src/messaging/providers/submagic.mjs:359`). The older plan says to leave silence-cutting off (`marketing/ads/video-pipeline-plan.md:259`). That plan is older than the September 24 law.
- **Submagic credits.** "Credits still block it." (`ops/workflows/submagic-mcp-2026-09-24.md:34`)
- **A retry pays Submagic again.** (`src/ad-videos/store.mjs:426, 446`) Left for an owner call. (`ops/workflows/submagic-settings-lock-2026-09-23.md:1105`)
- **B-roll on top of our own film.** "Not built yet." It waits on filmed takes for Ads 21–26. (branch `ad-scripts-2026-10-02`, `ops/workflows/broll-v2-2026-10-02.md:55, 61`)
- The 4 SLO ads that ran on Meta were made outside the pipeline. There is no delivery record for them. (branch `ad-scripts-2026-10-02`, `ops/workflows/ad-scripts-2026-10-02/w4-findings.md:115`)

## 4. Ad launch and tracking

**LIVE and proved**
- The Meta pixel `2403674420141513` is on every funnel page. (`ops/workflows/wiring-audit-2026-10-02.md:55`; `ops/workflows/tracking-everything-2026-10-02.md:222`) The live /roadmap page loads it. (live check 2)
- **Server events to Meta are on and sending.** Netlify production has `META_CAPI_ENABLED` set to 1. (live check 4) Meta's reply is saved on 168 page events from October 2, 17:59 UTC to October 5, 19:34 UTC: PageView and ViewContent 91, VideoProgress 36, ReachedBuyBox 20, SurveyStep 16, PageView 3, Lead 1, InitiateCheckout 1. (live check 3) First proof: `ops/workflows/tracking-everything-2026-10-02.md:224`.
- Our own page tracker saves the ad tags with every click and scroll. (`docs/audits/wiring-audit-2026-10-02.md:188`)
- Ads are built by hand in Ads Manager by the media buyer. (`ops/workflows/2026-09-28-landing-page-conversion.md:118`)

**BUILT but unproved**
- Schedule (booked call) and Purchase events, in the browser and on the server. (`public/funnel/fh-events.js:290`; `src/handlers/meta-purchase.mjs`; `src/meta/map.mjs`) None has fired yet, because there were 0 sales and 0 bookings. (`ops/workflows/roadmap-marketing-2026-10-04.md:108`; bookings in the last 30 days: 0, live check 3)
- Code that can create Meta campaigns and ads. Nothing calls it. It has never run on a real ad account. (`src/adplatforms/meta.mjs:3-6, 44, 71, 93`)

**MISSING**
- **No visitor has an ad number.** The live ads send the ad tag `oVid: SLO2` (`ops/workflows/roadmap-marketing-2026-10-04.json:2036`). Our ad-number rule only reads leading digits, like `84-slo-ad-1` (`db/migrations/286_client_ad_attribution.sql:34-35, 81-84`). Result: 18 people have ad tags saved, **0** have an ad number. (live check 3) No sale can be tied to an ad this way.
- None of the 7 ads in our database has a Fundhub ad number. (live check 3) Ad numbers 84–90 already exist for SLO Ads 1–7. (branch `ad-scripts-2026-10-02`, `ops/workflows/ad-scripts-2026-10-02.md:161`)
- The campaign name `oPur: TOF-SLO: $297` reads as lane "unknown". The lane list has no lane for the $297 roadmap. (`db/migrations/286_client_ad_attribution.sql:67-75`)
- The check in Meta's Test Events screen for Lead and Schedule was never recorded. (`TODO.md:10`)
- `TODO.md:10` is out of date. It says server events stay off. They are on. (live checks 3 and 4)
- Meta's own Conversions API Gateway was never checked for double counting. (`ops/workflows/tracking-everything-2026-10-02.md:174`)
- The "ShowedCall" event is planned and not built. (`TODO.md:146`)

## 5. Landing pages and the checkout

**LIVE and proved**
- /roadmap is up at $147 with $297 crossed out. (live check 2) It went live October 4 at 3:07pm Pacific. (`ops/workflows/roadmap-marketing-2026-10-04.md:18`; `src/slo/offer.mjs:12`)
- Checkout step 3 stays locked until payment. Step 1 saves the contact. A booking goes to /roadmap-thank-you. (`docs/audits/wiring-audit-2026-10-02.md:178-180`)
- 3 testimonial cards are on /roadmap. (`ops/workflows/testimonial-thumbnails-2026-09-27.md:289-291`) Proof cards are on /roadmap. (`TODO.md:183`, checked 10/4)
- The VSL files load. (`ops/workflows/slo-live-videos-2026-09-25-roadmap.md:61-62`)
- The /apply, /watch and /thank-you fixes are live. (`ops/workflows/apply-funnel-fixes-2026-10-01.md:13-17`)

**BUILT but unproved**
- Page fixes are built and waiting for Chris's OK: layout shift, dead clicks, "Fundhub LLC" on the page, buy box version 2. (`docs/audits/wiring-audit-2026-10-02.md:200`)
- The fix for the Facebook and Instagram in-app browser reloading after payment is "not live yet". (same file, line 186)
- No real buyer has ever paid through it. (`ops/workflows/roadmap-marketing-2026-10-04.md:9`)

**MISSING**
- Sales: 135 people, 2 pressed buy, 0 paid. (`ops/workflows/roadmap-marketing-2026-10-04.md:108`)
- A thank-you video: "The page has no video yet." (`TODO.md:122`)
- /watch still plays the video from Netlify, which is what got the site paused for bandwidth. (`TODO.md:123`)
- Financing approval is still open. (`TODO.md:9`)
- The old /order page is not retired yet. (`TODO.md:126`)

## 6. Follow-up (texts, emails, calls)

**LIVE and proved** (live check 3 counts the last 14 days)
- Texts are on. 23 texts were delivered and 18 replies came in. So "SMS is off on purpose" (`TODO.md:1004`) is out of date.
- The no-book chase works: texts and emails 1, 2 and 3 were delivered, the last on October 5.
- The $197 follow-up is live: the $197 text was delivered once (October 2), the $197 email twice (last October 3), and hot drip emails 1 and 2 (October 3 and 4).
- Booking confirmation, the 2-hour reminder and the no-show texts were delivered to test clients. (`ops/workflows/full-comms-prove-2026-09-20-fire.md:136-142`)
- The booking message from ClickFunnels reaches us again. (`ops/workflows/sleep-fears-2026-09-25.md:35`)

**BUILT but unproved**
- The 24-hour reminder on the real clock. (`ops/workflows/full-comms-prove-2026-09-20.md:196`)
- The AI phone call on a booking: the talk is "UNVERIFIED". (`ops/workflows/full-launch-lattice-2026-09-20.md:506`)

**MISSING**
- **Price mismatch.** The follow-up offers $197 (`src/slo/discount-197.mjs:7`). The page is $147. That is $50 more. (`TODO.md:8`)
- **Emails are failing.** In 14 days the welcome email failed 6 times and bounced 2 times, against 2 delivered. The finish-your-application email failed 5 times. (live check 3) Some may be test addresses. This check did not split them.
- A moved call still gets the old 15-minute text. A cancelled or moved call can be marked a no-show. (`ops/workflows/cf-calendar-switch-plan-2026-09-22.md:35-37`) The code still stops that text only on a cancel. (`src/workflows/ai-set-04-3way-handoff.mjs:141-149`)
- The long drip is not sending. Cold, warm and hot were turned off on August 22. (`ops/workflows/roadmap-run-2026-09-27.md:152`)
- The "booked" and "day of" texts are blocked. (`ops/workflows/full-comms-prove-2026-09-20-fire.md:109, 111`)
- Nobody answers a client's text. "A client who texts gets silence." (`TODO.md:1034`)
- The AI caller has no phone number of its own. (`TODO.md:436`)

## 7. Reporting (watch curve, ad numbers)

**LIVE and proved**
- Meta numbers come in every morning at 7:00. (`src/workflows/index.mjs:316`) The database holds 46 ad-days from August 17 to October 4: $1,002.32 spent, 400 taps. Last sync October 5, 07:01 UTC. (live checks 1 and 3)
- The watch curve is saved on 36 of those days. (live check 3) The October 4 report used it second by second. (`ops/workflows/roadmap-marketing-2026-10-04.md:73-77`)
- Our page tracker shows who opened, scrolled, pressed play and pressed buy, by ad name. (same file, lines 93–104)
- Clarity is pulled by hand, once per ask. (`scripts/clarity-insights-pull.mjs`; same file, line 28)

**BUILT but broken or unproved**
- **The "dying ad" phone buzz has never fired.** The code calls `notify.send` (`src/ops/watch-curve.mjs:14, 96`). The file it imports hands back the send step itself, so `notify.send` is empty (`src/ad-videos/notify-fanout.mjs:83`). The alert table has 0 rows. (live check 3) SLO2 kept 10% at the quarter mark (`ops/workflows/roadmap-marketing-2026-10-04.md:44`), so it should have fired.
- The daily "what to fix in the next take" table is empty: 0 rows. (live check 3) "It does not fill itself every morning yet." (`ops/workflows/roadmap-run-2026-09-27.md:144`)
- The campaign screen https://fundhub.ai/app/campaign-manager.html has no watch curve view. It is listed as a "Later screen". (`marketing/ads/watch-curve.md:67`)

**MISSING**
- **ClickFunnels page numbers do not come in at night.** The night job asks with a plain connection, and the database hides the account from it. (`src/workflows/clickfunnels-analytics-sweeper.mjs:11-15`; `ops/workflows/2026-09-28-landing-page-conversion.md:55-63`) The night job has not written since September 22. (`ops/workflows/roadmap-marketing-2026-10-04.md:27`) The last sync, October 4 at 22:10 UTC, matches the hand pull for that day's report. (live check 1)
- **Cost per sale.** The daily sync does not save Meta's purchase count or cost per purchase. (`api/campaigns/sync.mjs:516-521`) All 46 ad-days show 0 conversions. (live check 3) No report ties an ad to a payment. It ties ads to bookings only. (`src/ads/store.mjs:64-70`)
- Link clicks and landing page views from Meta are not saved. (`ops/workflows/2026-09-28-landing-page-conversion.md:88-91`)
- `TODO.md:573-576` says the ad numbers table is empty. It has 46 rows. (live check 3)

---

## What to do next (ranked)

1. **Put the Fundhub ad number on every ad link.** Set each ad's tag to its number, like `84-slo-ad-1`. Today 0 of 18 tagged people have an ad number, so no sale can be tied to an ad.
   *Chris decides:* who changes the links — the media buyer by hand in Ads Manager, or an agent through Meta's API (that code has never run on a real account).
2. **Prove the money events in Meta's Test Events screen:** Lead, Schedule and Purchase. Meta is told to find buyers and has 0 purchases to learn from. Also check Meta's own gateway so no sale counts twice. Then fix `TODO.md:10`.
   *Chris decides:* OK to run one real $147 test order and refund it, so Purchase can be seen live.
3. **Fix the $197 follow-up against the $147 page.** The $197 text and emails are going out now.
   *Chris decides:* the new follow-up price, or turn that text off.
4. **Fix the reporting holes in one pass:** the dying-ad phone buzz, the ClickFunnels night job, and saving purchases, cost per purchase, link clicks and landing page views from Meta.
   *Chris decides:* nothing.
5. **New openings for the ads.** All 7 ads read paused. SLO1's opening holds best: 46% still watching at 5 seconds. SLO2's lost 78% by 5 seconds. (`ops/workflows/roadmap-marketing-2026-10-04.md:77, 85`) The watch-curve law says change the first line. Ads 2, 4, 5, 8 and Shorts 1–7 are approved and not filmed.
   *Chris decides:* which scripts to film next, and the daily budget when ads go back on (including the book-a-call launch at $250 a day, `TODO.md:11`).
6. **Get one ad all the way to Paul's folder.** Turn on "save our own copy", prove the text to Chris, and approve the 2 takes that have waited since September 24.
   *Chris decides:* buy more Submagic API credits (yes or no), and whether a retry may pay for a new Submagic project (yes or no).
7. **Build the step that joins takes into one best master** in script order and cuts dead air, repeats and false starts, before Submagic. The law already requires it. No code exists.
   *Chris decides:* nothing.
8. **Fix moved and cancelled calls:** save each booking under the call's own id, stop the 15-minute text on a move, and stop the no-show mark on a cancel or move.
   *Chris decides:* should ClickFunnels' own reminder emails also go out, or only ours? (`ops/workflows/cf-calendar-switch-plan-2026-09-22.md:81`)
9. **Find out why emails fail** (6 failed and 2 bounced welcome emails in 14 days), then decide on the long drip.
   *Chris decides:* turn the cold, warm and hot drips back on (yes or no). They have been off since August 22.
10. **Save the Marketing Machine spec into the repo** from the archived chat, then re-run flywheel stages 3 and 4, then 5, and build stage 6.
    *Chris decides:* run the flywheel for the partner offer now, or build one for the $297 roadmap first.

Already being handled by W1 on the same board: merging the two ad branches and backing up the 1.7 GB of B-roll.

---

## Live checks behind this file (all read-only, 2026-10-05)

1. `npm run marketing:data:health` (`scripts/marketing-data-health.mjs`, SELECT only). Result: ok, nothing blocked. ClickFunnels connection active, last sync 2026-10-04 22:10 UTC. Meta connection active with a stored token, last sync 2026-10-05 07:01 UTC. 24 page-stat rows, 46 ad-day rows, 7 ads.
2. Plain page loads: https://apply.fundhub.ai/roadmap/ (200; "$147" 25 times, "$297" 7 times; pixel code present). https://fundhub.ai/api/health (ok, 336 migrations, 0 pending).
3. Production database, each query inside `BEGIN READ ONLY` … `COMMIT`, no session settings: `ad_metrics_daily`, `ads`, `ad_videos`, `ad_watch_curve_alerts`, `ad_watch_curve_diagnoses`, `client_ad_attribution`, `events` (Meta reply field), `messages` (counts by template and status, no names or numbers), `bookings`.
4. Netlify production: the value of `META_CAPI_ENABLED` (it is 1), and the names only of `META_PIXEL_ID`, `SUBMAGIC_API_KEY` and `DRIVE_PAUL_FOLDER_ID` (all set). `META_CAPI_ACCESS_TOKEN` is not set; the code falls back to the token stored in the database (`src/meta/token.mjs:6, 78`).
5. `node scripts/flywheel/status.mjs` (reads local files only).
