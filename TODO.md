# TODO — unfinished work

## Animation words repeat Chris — added 2026-10-24 (remind Chris)

Chris set the no-echo rule (`.cursor/rules/animation-no-echo.mdc`) and said: save the rule, keep moving, remind me to fix. These finished videos still print his own sentences on the animations:

- [ ] Direct Book VSL 1, Watch page (live on https://apply.fundhub.ai/watch). Plan: `marketing/ads/animation-plans/direct-book-vsl-1-watch-page-2026-10-23/` on branch `claude/vsl-animations`.
- [ ] Ads 4, 11, 14 and 16, and the thank-you video (in Drive folder 1lu1Jzn302TMBdfPS6r2XuOvNdMaWA9Ry). Plans on branches `claude/ad11-penthouse-animations` and `claude/ad14-animations`.
- [ ] When fixing: reword each plate short, with no drift; add the echo checker (fail on 4 or more of his words in a row); set sound to -14 LUFS; replace the files in Drive and the live VSL.

## Today — 2026-10-16 (carried from PR #53 on 2026-10-21; Chris, say if these are still open)

Owner has a batch of MCA and SBA deals open now and wants them pushed through. Set this up today.

- [ ] Get a new MCA referral link from Crafty (the loan broker Fundhub sends MCA deals to). The email flow needs this link.
- [ ] Set up the MCA email flow for the current MCA and SBA deals, using Crafty's new referral link.
- [ ] Push the current MCA and SBA deals through.

## Company-wide UX refresh — added 2026-10-18

- [ ] Start a new-agent-led refresh of Fundhub's full experience across the website, funnels, client and team portals, CRM, Finance OS, and Mac/iPhone apps. Use `ops/workflows/company-ux-refresh-2026-10-18-reference.png` (the Mac welcome screen) as the visual reference: generous space, bold and clear type, simple navigation, restrained black-and-white controls, and a polished Apple-like feel. First map the screens and agree on shared design rules; then split the upgrade among agents while preserving each working journey.
  - One-page client portal home preview is ready for review in `ops/workflows/company-ux-refresh-2026-10-18.md`; the live page is unchanged.

## App improvements (sales process) — added 2026-10-17

- [ ] Backend: lead_app_status table (installed, logged_in, notif_status, last_seen_at)
- [ ] Backend: endpoint the app posts status to
- [ ] App: post install + login status on first login
- [ ] App: post notification status (allowed/denied/not_asked) on open and on return to app
- [ ] Setter dashboard: per-lead checklist auto-filled from lead_app_status
- [ ] Setter dashboard: timer since booking
- [ ] Setter dashboard: call attempt counter
- [ ] Setter dashboard: flag booked-but-not-installed leads
- [ ] Setter dashboard: hide app status once lead exits sales process (keep collecting)
- [ ] App: custom pre-permission screen before iOS notification popup
- [ ] Decide deferred deep link approach (Branch or similar) for not-yet-installed leads
- [ ] Post-booking link: one-time login token that opens the app logged in

## Affiliate dashboard — added 2026-10-17

- [ ] Affiliate dashboard: send client + affiliate a notice when the file goes to the ISO (trigger: email sent to ISO)

## Tomorrow — 2026-10-17: SBA lender partners

Contacts, public facts, and the call questions: `ops/workflows/lender-partners-2026-10-16.md`.

- [ ] Email Newtek at klowy@newtekone.com: who Fundhub is, SBA-ready deal flow, ask for a referral partner call.
- [ ] Email Live Oak at andrew.kennedy@liveoak.bank with the same ask.
- [ ] Call Live Oak at 866-438-9393 and ask for the SBA referral partner team.
- [ ] Fill out the Live Oak contact form at liveoakbank.com/sba-loan-experts as a backup.
- [ ] Have ready: Fundhub LLC name, address, website, rough monthly count of SBA-ready clients.
- [ ] On each call, run the 11 questions in the lender file.
- [ ] Get the MCA contact's terms with the same 11 questions.
- [ ] Compare the 11 questions with the CRM lender sheet and merge.

## Credit optimization onboarding — one workflow (added 2026-10-16)

Merge Blake's separate LLC funnel into the main credit optimization onboarding so every client goes through one path. SmartCredit is a required step, signed up through your co-branded link, so every client pays you recurring.

- [ ] Put the two current paths side by side (main onboarding and Blake's LLC funnel) and list anything Blake's has that the main one is missing.
- [ ] One entry point: every credit optimization client lands on the same onboarding page, whether they came from a closer, an affiliate or Blake. Tag the source on the client record so attribution still works.
- [ ] First step after payment: SmartCredit signup through the co-branded link, opened right from the portal.
- [ ] Gate the portal: document upload unlocks only once SmartCredit is connected.
- [ ] If the co-brand account gives report access, pull the credit report into the portal automatically so the client never uploads one by hand.
- [ ] Add SmartCredit to the day 1, 3 and 5 reminder texts: chase the SmartCredit signup first, then documents.
- [ ] Track SmartCredit status per client (not started, signed up, active, cancelled) and flag cancellations, since a cancel means lost recurring revenue and a stale report.
- [ ] Monthly: match the co-brand commission report against your active client list.
- [ ] Walk one test client through the merged flow end to end yourself.
- [ ] Retire Blake's funnel page and redirect its link to the new entry point.

## Today — 2026-10-13

Afternoon update — owner reports it is about 2:30 PM Arizona/MST and plans to film in 15 minutes (about 2:45 PM). Open work only. With each owner update, return the full organized remaining list and omit completed items. Focus: filming now, then editing; outreach remains open. Use AI wait time for independent tasks; keep the editing block uninterrupted. Remaining engineering scope: finish heartbeat, end-to-end testing, fix issues found, then refactor. Refine the offers alongside revenue work; no new feature expansion.

### 1. Film now, then edit

- [ ] Film outside — four remaining ads and the remaining longer-form/thank-you videos; exact longer-video count/titles still need clarification.
- [ ] Set up the green screen and film four green-screen videos at home.
- [ ] Edit the videos and add B-roll — three uninterrupted hours. Lock cuts before adding animation overlays.

Start filming around 2:45 PM based on the owner's stated time and 15-minute plan. Earlier morning/before-2 targets are superseded. Reserve three uninterrupted hours for editing after filming. Front-camera 30 fps remains accepted for today's ads; the detailed technical proof backlog below is separate from this daily filming plan.

### 2. Outreach

- [ ] Text Blake's leads first using the 661 number and owner's 480 number as planned.
- [ ] Complete the group-text step for Blake — approximately 28 leads; confirm the count and grouping.
- [ ] Finish texting the remaining people on the corrected lead list — owner now estimates 80–85 prior/current-client leads in total. The roughly 28 Blake leads are a subset, not a replacement total.

### 3. Clients and setup

- [ ] Handle Bram, the credit client (also dictated as Brahm/Brom).
- [ ] Finish LexisNexis setup for Colin.
- [ ] Hook up Cortana correctly with the funnel.
- [ ] Verify the setter's complete appointment-setting process.
- [ ] Confirm the closer is connected, ready, and receiving the setter handoff correctly.

### 4. Sales and system checks

- [ ] Finish heartbeat fixes — IN PROGRESS: Claude and Codex are working on it. Owner expects completion tonight; this is a target, not verified completion (10:36 AM update). Review results when the work is ready.
- [ ] Do mock sales calls.
- [ ] Walk through the dashboard and the complete sales/setting process.
- [ ] Refine the offers and existing sales assets; verify the existing marketing process end to end.
- [ ] After heartbeat fixes, run the itemized company-wide end-to-end checks. Record expected and observed results, pass/fail/not checked, and next action.
- [ ] Fix and harden the issues those checks reveal, then repeat the affected journeys before refactoring.

Inventory reference: `ops/workflows/coverage-deep-proof-2026-10-12.md` last records 3,942 tracked items, including screens, controls, routes, and workflows. Recount before the full check; a mapped monitor does not by itself prove the business result.

### 5. Waiting

- [ ] Justice — waiting for confirmation that his email/account works.

### 6. After the priority work

- [ ] Next creative direction (owner 2026-10-15): the ad does the selling because awareness is so high, so move to a short VSL and more display and split-screen style videos. The 10/15 VSL (`marketing/vsl/direct-book-vsl-2026-10-15.md`) is fine for now.
- [ ] Talk through the line of credit stacking system with Claude (owner side note 2026-10-15, while writing Direct Book Ad 14).
- [ ] Decide on the data-points offer ideas (a $1,000 bank-order step inside the Blueprint, a $2,000 to $3,000 a month data subscription). Ideas only, not decided. Saved in `marketing/offers/data-points-ideas-2026-10-14.md`. (owner 2026-10-14)
- [ ] Add more specifics about the Capital Blueprint to the VSL: which letters to send, which banks to apply to and in what order, which banks to open accounts with, and how to start and optimize your businesses. Keep it specific but short. (owner ask 2026-10-13; scripts in `marketing/ads/scripts/2026-10-13.md`)

- [ ] End of this week: pay the $99 Apple developer account so the teleprompter iPhone app can be built — that app is what gets the front camera to 60 fps. Until then 30 fps stays (owner call 2026-10-13).
- [ ] Make the CRM mobile friendly — every CRM screen works on the phone. (Owner added 2026-10-13.)
- [ ] Continue the existing refactor plan: `ops/workflows/company-refactor-plan-2026-10-12.md`. Goals: less duplicate code, lower AI token use, stronger architecture, better performance, and roughly half the code where justified. Measure improvements and preserve behavior.
- [ ] Repository cleanup — code only. Identify required non-code dependencies before deleting clutter; protect working code and other sessions' unfinished work.

### 7. Personal

- [ ] Food and water, if still needed.
- [ ] Clean the house floors when back home.
- [ ] Coffee at Panera, if still needed.
- [ ] Optional sushi if it fits after filming.
- [ ] Full gym workout tonight before bed.

## Priority — iPhone teleprompter launch readiness (updated 2026-10-13)

The main recording, camera switching, two-second tail, full-script editor, local take queue, microphone meter, and per-offer Drive routing were built and merged in PRs #29, #30, and #31. Some versions also shipped. **Implementation/merge is not a physical iPhone proof.** Evidence and latest measurements: `ops/workflows/teleprompter-video-2026-10-12.md`. Keep each item open until the acceptance test is real.

- [ ] **Prove a fresh full-frame iPhone 17 Pro Max original at 60 real fps.** Ads target 1080×1920 at 60 fps; VSL/4K pieces target 2160×3840 at 60 fps. Check real saved-file dimensions, distinct frames, A/V timing, cropping, and bitrate—not only the selected preset or camera badge. The last measured new originals were 28.82 fps Ad and 10.87 fps VSL, both granted 30 fps. If Safari cannot provide 60 real fps, label the limitation and establish a reliable native-camera/native-app path before claiming done.
- [ ] **Prove the whole live camera lifecycle on a physical iPhone.** Always-on visible front preview, slight blur only on screen, sharp saved file, selfie-mirrored front recording, unmirrored rear, correct upright aspect and full head/shoulders, no black screen, no cut/split while flipping front/rear during one take. Test both orientations.
- [ ] **Prove all teleprompter controls together while recording.** Single tap Play/Pause; double-tap edits the *entire* script with working Copy/Paste/Save; manual scrolling while playing does not pause; countdown only once; exact two-second script-end tail then auto-stop; only Record/Stop manually starts or stops a take. Check remote/volume controls, 130–320 WPM speed, smooth text, and camera controls never activating Record.
- [ ] **Prove real microphone capture.** Show the connected external microphone (RØDE when iOS exposes that exact source), small moving audio meter and actual audio in the saved original; warn clearly when mic is missing or muted. Do not infer an external mic from an unknown iPhone device label.
- [ ] **Prove durable, nonblocking take uploads.** Accept take A, verify it is saved locally, immediately record take B while A uploads, stack uploads in order, recover pending saved videos after closing/reopening, handle offline and storage errors, and prove both videos land exactly once in Drive. Use accurate “saved on device” versus “uploaded” status. An unfinished browser take interrupted by iOS force-quit cannot be guaranteed recoverable; evaluate native iOS recording if that guarantee is required.
- [ ] **Prove marketing-machine organization.** Original exact descriptive take names; source offer ID/funnel tag routes Direct Book, SLO and newly registered offers to separate Google Drive folders; no mixed offers; the downstream video sweeper finds each folder; double-tap Drive icon opens the current offer's folder without exiting on one tap.
- [ ] **Resolve retained script edits and session recovery.** Signed filming link automatically retries queued edits and saved marks as permitted. Show a simple honest warning if reauthorization really is required; do not drop the pending edits or falsely say saved.
- [ ] **Locate the owner-reported newly uploaded takes and verify their original quality.** Latest investigation at October 13 01:08 Arizona could not find files newer than the last verified release in the accessible Drive folders. Obtain a real Drive file link or saved-video status and reconcile the intended destination. Do not claim the older Ad/VSL files are new captures.
- [ ] **Get all current release checks green and prove the exact live version.** Last confirmed successful GitHub “Ship to live” run: 38352933862; the newer 38367410262 release/tests failed. Diagnose the latest failure. The deployed-site WebKit mock proof passed 6/6 badge/picker cases, but that does not replace physical iPhone saved-video proof.
- [ ] **Prevent regressions after real-device proof.** Keep camera/audio/recording/upload and remote behavior under automated tests, and keep monitoring red where functionality or proof is genuinely missing. Do not relax payment, booking, or fulfillment monitoring to ship the camera.

## Owner-handled pulse reds — added 2026-10-11

- [ ] Replace the masked `OPENAI_API_KEY` and prove Company Brain search returns an answer instead of 502.
- [ ] Record outcomes for the two booked calls that ended with no saved outcome.
- [ ] Restore meeting links on new bookings; the newest five real bookings have no join link.
- [ ] Close the 2,407 catalog rows that still lack proof at their required level. The coverage build owns the code; keep this row until its final proof is green.
- [ ] Refactor the heartbeat proof maps after coverage is complete. Remove repeated rules and group shared proof targets, while keeping every check and every red/green result honest.
- [ ] Add Justice Nikkel and Sarah Blankstein as booking-page hosts; both are past due.
- [ ] Give repair file `64212914-1e0d-4ec1-bd6e-07fa156108b8` a real next step; it is stuck in Analysis.
- [ ] Resolve failed delivery for `SMS-AISET04-HANDOFF` and `SMS-S05A-NOSHOW-RECOVER`.
- [ ] Set a valid `UNSUBSCRIBE_TOKEN_SECRET` and prove email unsubscribe links work.
- [ ] Move the overdue Repair Analysis pipeline card forward or record the correct next action.
- [ ] Help the paying client who has held portal access for more than 72 hours sign in.
- [ ] Fill the Experian, Equifax, and TransUnion service numbers and menu paths in the AI bureau config.
- [ ] Create the overdue repair letters for file `64212914-1e0d-4ec1-bd6e-07fa156108b8`.
- [ ] Resolve the six customer texts that failed at the phone company in the last seven days.
- [ ] Move client `FH-000507` forward from “round 1 letters made” and clear the stuck repair trip.

This file contains only unchecked items. Items stay here until current evidence proves they are complete.

- [ ] Review all the copy before launch (owner 2026-10-09). Everything a customer reads: the message templates (325 in the database today: 232 email and 93 text approved; the 15 placeholder emails were just turned off), the sales and checkout pages, the drip and nudge texts, and the ads. Includes the 12 repair pre-call emails (BS-REPAIR-*) that nobody has written yet. The $197 "30% off" drip text still says more than the $147 price.
- [ ] Tomorrow: work on Blueprint. Map the whole client journey end to end so it pops at launch.
- [ ] Blueprint gets its own payment webhook instead of Commas.
- [ ] Set up Whop for multiple items (Chris said "WOP"; earlier in the same chat he used "WAP" for Whop).
- [ ] Add tests and quizzes to Blueprint (owner idea 2026-10-06 — funding courses use them).
- [ ] Welcome kit (mailed package) — not now. Owner 2026-10-06: it's a whole project; later.
- [ ] Follow-up texts: the no-reply drip (`src/workflows/slo-no-reply-197.mjs`, live) still offers the roadmap for $197, which is now $50 more than the $147 page price. Lower the offer or turn that text off. - Checked 10/5: still $197 (`src/slo/discount-197.mjs` `DISCOUNT_CENTS = 19700`; page `SLO_PRICE_CENTS = 14700`). Last sent: email 10/3, text 10/2; none since the $147 change. Chris decides (yes/no on `ops/workflows/finish-builds-2026-10-05.md`).
- [ ] Financing approval (expected 10/4) - Checked 10/5: nothing about it in the repo. Chris only.
- [ ] Confirm Lead and Schedule fire in Meta Test Events. Server-side CAPI is built (10/2) but stays off until `META_CAPI_ENABLED` and `META_CAPI_ACCESS_TOKEN` are set. - Checked 10/5: server events are ON, not off. Production has `META_CAPI_ENABLED=1`; `META_CAPI_ACCESS_TOKEN` is not needed (the sender uses the token saved in `ad_platform_connections`, `src/meta/token.mjs`). Meta accepted every server send on record, 0 errors. **Lead: fired once, accepted** (10/2 22:43 UTC, the SLO2 checkout). **Schedule: never fired**, because there has been no booking since tracking went live 10/2 (0 rows in `bookings`). Proving Schedule needs one booking; that makes a real calendar slot, so it is Chris's call.
- [ ] Launch book-a-call at $250/day once those events show - Spending money: Chris only. Waits on the Schedule proof above.
- [ ] Compare /roadmap conversion for one week at $147 against the last week at $297, at the same daily spend - Checked 10/5: cannot run yet. $147 went live 10/4 15:07 Arizona, so the week ends 10/11 15:07. $297 week on record: ad spend 9/28–10/4 = $707.24, 0 paid orders, 2 real Meta checkouts started (10/1, 10/2); per-visit /roadmap counts only exist from 10/2. Watch: /roadmap had 1 tracked visit on 10/5 (Arizona) against 32 on 10/4, while /home had 187, so the spend may not be the same on both sides.
- [ ] Film 3 canal ads and 2 ads at home
- [ ] Edit
- [ ] Mastermind the offer
- [ ] Scrape courses
- [ ] Network: in claude.ai network settings, allow all domains (or at least myclickfunnels.com, api.netlify.com, api.supabase.com, api.inngest.com)
- [ ] Make ZootimusMaximusSupreme/Fundhub_ai private (it's public and still empty)
- [ ] Take `public/funnel/slo-testimonial-colin.mp4` (155MB) out of the history or move it to Git LFS, because GitHub rejects files over 100MB
- [ ] Give the cloud permanent access to the repo on GitHub, so work keeps going while the Mac is off
- [ ] Add the deploy keys to the cloud environment's secrets, so `npm run ship` runs from the cloud
- [ ] Test: ship one small change end to end from the cloud
- [ ] File deletes: approve them again in each new Claude session that needs to clear git locks (the approval lasts one session)
- [ ] Consolidate the conflicting rules across CLAUDE.md, `.claude/rules`, `.cursor/rules` and the notes, so sessions stop building in different directions (10/3)
- [ ] Animation overlays for the new ads. Owner-set order: edit the video first and lock it, then add the animations on top. Animations go in last so no cut ever chops one.
- [ ] Lock the final cut of one ad
- [ ] Mark the timestamps where each animation lands
- [ ] Drop the animations in and export
- [ ] Repeat for the rest of the batch
- [ ] Figure out the low-ticket session funnel
- [ ] Block AI crawlers on every live funnel page. Checked 10/4: robots.txt on apply.fundhub.ai allows every crawler.
- [ ] List every live funnel in ClickFunnels
- [ ] Find where ClickFunnels lets you add head code or SEO settings per page
- [ ] Add the crawler block to each page
- [ ] Spot-check one page to confirm it's live
- [ ] Check UnderwriteIQ's math against Chris's (see UI item 9 below)
- [ ] Chris's math: highest card limit × 5.5 = personal; business ≈ 2× personal; personal loans on top. A $20K card ≈ $110K personal, ≈ $220K business.
- [ ] `src/underwrite/vendor/underwriter.cjs` lines 196–286 applies 5.5× on each clean bureau and adds all three, so a $20K card shows $330K personal (3× Chris's number)
- [ ] The same code doubles business only at 2+ years old (1× at 1–2 years, 0.5× under 1 year); Chris's rule is ≈ 2×
- [ ] Decide whether 5.5× applies once or per bureau
- [ ] Decide whether business is ≈ 2× or stays tied to business age
- [ ] Run one real client file through it and compare to the math by hand
- [ ] Move ads from full scripts to bullet points. The 2026-10-04 batch is the last fully scripted set.
- [ ] Bullet format to stop rambling: hook and line 2 written word for word, then one short cue per point, then the reveal, then the CTA word for word
- [ ] Fix monotone delivery with a simple inflection system (path of least resistance, no new app)
- [ ] Mark up one script with them and film it
- [ ] Watch it back next to an unmarked take and compare
- [ ] Once the marks feel natural, have every new script delivered with them
- [ ] Later, if it helps: one short course or app on vocal tonality
- [ ] Curiosity-gap thumbnails, only for certain ads, not every ad. Owner-set: it's a separate thumbnail image (red circle on something that doesn't fully make sense, e.g. a spot near the penthouse) PLUS a strong opening, two separate pieces.
- [ ] Pull 5 examples of red-circle thumbnails you like
- [ ] Make the thumbnail for the penthouse ad
- [ ] Set it as the ad's thumbnail / cover in Meta
- [ ] Keep the strong spoken opening as is
- [ ] Compare hook rate against the same ad with the default thumbnail
- [ ] Pull his voice-dictated messages from the Claude chats
- [ ] List his go-to phrases and how he builds a sentence
- [ ] Fold them into `marketing/ads/VOICE.md`
- [ ] Write every new script against it
- [ ] Examine the reference ad (Scale without your own cash) and reuse how it was built
- [ ] Read it through once more and mark anything to change
- [ ] Film it
- [ ] Use the same build steps (`marketing/ads/reference/ad-scale-without-your-own-cash-2026-10-04.md`) for the next long ads
- [ ] Visuals for the reference ad (Scale without your own cash): Chris on the bottom of the frame, animations on top. Film, edit and lock first, animations last.
- [ ] Film it on the phone in BigVU, framed so you sit in the bottom 40% of the frame
- [ ] Edit and lock the cut
- [ ] Reuse the Remotion templates in `marketing/broll` (branch ad-scripts-2026-10-02): FileItems or HiddenDataPoints for step 1, CompanyLine or BankPockets for step 2, LenderMatchScroll or LenderSlots for step 3, BookCall for the CTA
- [ ] Build 3 new ones: spend up → more data → better ads; $10K / $20K / $50K a month climbing to $100K; rates going up while banks lend less
- [ ] Leave the family beat as just Chris on camera, no animation
- [ ] Drop the animations onto the locked cut at each beat and export
- [ ] Lock scripts the night before every filming day (2026-10-04: 3 hours went to rewriting one ad on location)
- [ ] Pick the ads for tomorrow
- [ ] Read each one out loud once at home and flag any line that doesn't roll off the tongue
- [ ] Fix the flagged lines with Claude that night
- [ ] Load only locked scripts into BigVU
- [ ] On filming day, film only. Any new idea goes on the list for the next batch
- [ ] Fundhub teleprompter (owner decision 2026-10-04: BigVU drifts speed, needs a restart every take, can't pause and resume, and can't start anywhere in the script)
- [ ] iPhone app (paused, owner-set 2026-10-10): bring `tools/teleprompter-ios/` level with the web page and make the volume buttons run the speed ladder. Build spec: `docs/specs/teleprompter-ios-app-build-2026-10-10.md`. Starts when Chris pays the $99 Apple account.
- [ ] Put it on your phone as a real app through TestFlight ($99/year Apple developer account)
- [ ] Move it behind your login on fundhub.ai so it saves to the Home Screen
- [ ] Scripts load straight from the repo, no copy and paste
- [ ] Test it at home on one ad
- [ ] Fix what feels off, then film a full batch with it
- [ ] Later: recordings go straight into the editing pipeline
- [ ] 20 full ads, plus the short sorting-hat ads (10/1)
- [ ] Notes green screen ads from `marketing/ads/notes-green-screen.md` (10/2)
- [ ] Film the 7-step note and the sorting-hat note
- [ ] Film the cliffhanger version next to the full version
- [ ] Test line 2 ("Banks will fund you again for every business you open") as the hook in one version
- [ ] Storytelling notes: your timeline, Gene's timeline, and the funding mistakes that cost you money
- [ ] Testimonials: grow from the 3 on /roadmap to 6–9, filmed with B-roll (9/30, 10/3)
- [ ] Film 3 long-form B-roll interviews (10/1)
- [ ] Export the Portal Welcome video from Submagic (9/25)
- [ ] Film the Credit Mastery System course in Loom, one video per module (93 slides) (8/21, 10/2)
- [ ] Submagic: get the Business + API plan and put the API key in `.env`. Repo law says API only, and there's no key yet. (9/22, 9/24)
- [ ] Build the automated edit pipeline in `docs/journeys/ad-video-flow.md`: Drive "Raw" folder → R2 → Submagic and Deepgram. It's designed and not built. (9/22)
- [ ] Find the app someone sent you that breaks down Hormozi's ad creatives and storytelling (check texts, Instagram, Facebook, or the 99ads Skool group) (10/2)
- [ ] Reorder How It Works on /roadmap to match the 7-step note. The page has 5 steps in a different order. (10/2)
- [ ] Copy conflicts on the live pages (10/1)
- [ ] The /watch, /apply, /book and /thank-you marquee says "Up to 12 funding rounds," while the model is 3–6 rounds
- [ ] Refund window: most pages say 7 days, and 12 spots say 30 days
- [ ] Add the thank-you video at the top of /thank-you. The page has no video yet. (9/30)
- [ ] Move the VSL off Netlify. /watch still plays `fundhub.ai/funnel/vsl.mp4`, which is what got the site paused for bandwidth. (9/30)
- [ ] Re-check the 23 fixes in the "Roadmap Page Audit & Game Plan" doc against the live page, and finish what's left (9/30)
- [ ] Turn off the free-access system (9/30)
- [ ] Retire the old /order page ($297 ClickFunnels checkout). Nothing live links to it. (10/4)
- [ ] Full walkthrough of the book-a-call funnel: VSL, survey, thank-you page (10/3)
- [ ] Free lead magnet: save the 7-lesson outline ("How to get $100K–$300K in 0% funding off your credit file") and host it inside the client portal (10/4)
- [ ] Send your sales manager the new offers and pricing ($2,500 / $5,000 / $10,000), and confirm the closer is trained on them (10/3)
- [ ] Send the proposal to your sales manager (10/2)
- [ ] Run free roadmaps for your shortlist, then pitch the first two cohort people (10/2)
- [ ] Text your old-client list (40–50 people), target 10 sales (10/1, 10/3)
- [ ] Credit optimization clients: reminder texts on day 1, 3 and 5 until their documents are uploaded. The doc check runs after an upload, and nothing chases them before it. (10/3)
- [ ] Capital Blueprint: the backend shipped 9/29 (checklist agent, dispute steps, closer-ready alert, monthly pull, paydown, partner file, next funding sequence, welcome kit, bank tracker). What's left: (9/30)
- [ ] Run one real client through it end to end
- [ ] Promo alerts at 60, 30 and 7 days
- [ ] Payment reserve tracking
- [ ] Payment timing guidance
- [ ] Per-letter mailing upsell
- [ ] Set the monthly member fee that starts after the 12 included months
- [ ] Pixel conditioning, so only qualified survey answers fire Lead and Schedule (10/3)
- [ ] Custom "ShowedCall" event. It's planned in `marketing/ads/apply-survey-meta-tracking-2026-09-30.md` and not built. (10/1)
- [ ] 1% value-based lookalike from about 2,000 leads (760+ credit, $100K–$200K revenue) (10/3)
- [ ] Apply for the Meta Marketing API, Google Ads API and Partner API (9/30)
- [ ] Book the Plaid call and get the Plaid production API keys (10/3)
- [ ] Bank list: 237 banks still have no bureau on file. Log the inquiries from each funded client's report to fill them in. (9/11)
- [ ] ClarityPay: call the rep with the questions in section 07 of the proposal, and sign up directly so you get your own checkout (9/30, 10/2)
- [ ] Website migration off ClickFunnels: merge the open branches first, restore the shuffle and the light-up course section, put the Canva approval screenshots into the asset stack, then Cal.com and the CRM custom fields (9/22)
- [ ] Climate front door: the pack is committed, so pick the flat Darwin map or the globe, then ship (9/19)
- [ ] Capital Strategy course: only a wireframe exists, so build the deck before filming (8/21)
- [ ] Authorized contact access in the credit optimization portal: one person manages several clients' files, with consent and permission levels (9/27)
- [ ] Finalize the doc-collection agent prompts (8/22, 9/19)
- [ ] Save the interview research as an SOP (9/20)
- [ ] Background marketing agents: scheduled ad-script drafts you review in one batch (9/6)
- [ ] Company brain (already built): transcribe ACQ, your course and the Hormozi content, load them in, then add an open-source visualization (10/3)
- [ ] Re-review the company brain graph options before any build. Not approved. Do not build the vault. (10/5) - Vault root: open `marketing/` in a free app so Fundhub notes and Hormozi share one graph - Fundhub notes folder (not created): `marketing/brain/` with offers, funnels, angles, ads, decisions. Spec already names this in `docs/specs/marketing-machine-2026-10-04.md` M7 - Hormozi stays at `marketing/knowledge/hormozi/`. Do not move it. No API embed - Apps to re-review: Obsidian (free, closed source), Logseq (free, open source), SiYuan (free, open source), Foam (free, open source, inside Cursor). Links are `[[Note Name]]` - CRM Company Brain screen (chat + flat list) stays until a later build. Do not rebuild Obsidian inside fundhub.ai first - Smallest later slice if you approve: create `marketing/brain/` with an index and a few `[[links]]`, then open `marketing/` in the app you pick
- [ ] CXL Conversion Optimization minidegree (start with Landing Page Optimization), then Digital Psychology & Persuasion. Check your friend's access first. (10/3)
- [ ] Jeremy Haynes back-end ads once book-a-call has data (10/3)
- [ ] Focus group: entrepreneurial women in AZ go through the program free and become spokespeople (9/14)
- [ ] Get the Telegram contact for the Maria Wendt course (9/30)
- [ ] White label: set the build clock and the guarantee terms (9/4)
- [ ] Contracts: finish your additions to the 3 agreements (Business Funding Consultation, Credit Optimization Services, Credit Optimization Starter) (9/4)
- [ ] Whop KYB ticket for FH Consulting LLC, only if you still use Whop once ClarityPay is direct (9/29)
- [ ] Amoeba + Lithos to run a lot of agents across the businesses. Owner-set 10/9: go. Run Lithos with Amoeba, then move to the Claude API for use cases. Amoeba is free and Mac only, and it shows several Claude Code or Codex sessions in one window. Lithos here means Lithos AI's Motus, a kit for building agents (swap it if you meant a different Lithos).
- [ ] Install Amoeba on the Mac and open this repo in it.
- [ ] Add Motus to the repo.
- [ ] Pick the first agent to build. Start with one already on this list: background marketing agents or doc-collection agents.
- [ ] Build that agent with Motus in a Claude Code session inside Amoeba.
- [ ] Open a second session side by side for the next agent.
- [ ] List the Claude API use cases across the businesses.
- [ ] Pick the first use case and move it to the Claude API.
- [ ] Alt finance offer: SBA, hard money and real estate lending
- [ ] Search the Meta Ad Library for SBA, hard money and fix-and-flip ads
- [ ] Pick the lending partners for each product
- [ ] Define the offer and how it routes on the sorting-hat call
- [ ] Write and film the first batch of ads
- [ ] Build the funnel and launch
- [ ] **Arizona MLO refinance funnel.** White label is E Mortgage Capital (`https://www.emortgagecapital.com/`). Use the Arizona mortgage-loan-officer license. Pull Arizona leads. Target homes that need a refinance. Then run that funnel. Company NMLS 1416824. Their refi door is `/refinance` (also `/e-refi`).
- [ ] **Film more ads.**
- [ ] **Film more interviews.** Shoot long form, then cut it into short form.
- [ ] **Owner: Claude Code IDE** (not Cursor Grok, not Composer). Make sure the lender lists are good — the book of banks AND the list a $297 / Capital Blueprint buyer sees in the portal. Book: `docs/legacy-strong/lenders-legacy-strong.csv` (~313 banks), loaded by `scripts/lenders-import-alec.mjs`. Buyer-facing list: built by `src/deliverables/lender-list.mjs` (portal deliverable `bank-lender-match-list` / `lender_match_list.html`) from that book — no separate static buyer CSV found. Do not start this check before Saturday.
- [ ] Run Colin's testimonial through Submagic: `~/Downloads/Fundhub Roadmap Testimonial Colin 1.mp4` (seen 2026-09-22). Copy it into the Drive "SLO Ads" folder (13ZOjA56MNuM-PHSRK5fQK0bovRwR8raZ) first so it is not only on this laptop. Submagic key is not in .env yet (Chris pasted it in chat 2026-09-21; the .env write was blocked).
- [ ] **Chris — paste the view counter onto the watch page.** The watch page lives in ClickFunnels, so no code here can reach it. Open the page for `apply.fundhub.ai/watch`, paste `marketing/landing-pages/06-utm-hidden-fields.html` at the top and `marketing/landing-pages/07-vsl-watch-beacon.html` at the bottom, then Save and Publish. Until then, nobody watching the video is counted.
- [ ] **Chris — is `ANTHROPIC_API_KEY` on the list?** Netlify → site → Site settings → Environment variables. Just say whether the name is there; do not show the value. Social Studio's "Write 3 posts for me" still writes 0 posts on the live site. The starred-out OpenAI key no longer blocks it (`a91a81f8`), so the only thing left is whether a working writer key exists. **Never remove a key** — CLAUDE.md §11.
- [ ] Manual walkthrough 1–5pm: one client, ad → call → payment → fulfillment
- [ ] Mail forward at usps.com
- [ ] Calls after 5: credit optimization leads, Brandon Elliot (set Build Clock + First File numbers first; lead with 50% split, no clawback), Smart Start, storage unit
- [ ] Apply: Meta Marketing API, Google Ads API, Partner API
- [ ] If time: tweak 14 ads for Monday, VSL, Capital Blueprint + Capital Academy filming
- [ ] Film VSL, send to Paul
- [ ] SLO live: VSL in, SIM MODE off
- [ ] Payouts + waterfall walked end to end
- [ ] Quizzes working
- [ ] Closer on the script
- [ ] Lender list optimized and fixed
- [ ] Filter 83 ads → top 30 = source of truth
- [ ] Cut ad 41 (built on a guarantee we don't offer)
- [ ] Launch primary offer
- [ ] Film 14 in Sedona
- [ ] Sell as-is: your brand, your ads, we fulfill; marketing = paid add-on. Drop Meta ad-library dependency.
- [ ] Set Build Clock days + First File count
- [ ] clients.partner_id attribution (0 of 29)
- [ ] Non-circumvention clause, migration
- [ ] **Shoot 60–80 videos.** Different ad variations, one complete ad per angle. Ambitious and Chris knows it. Everything else on this page waits behind it.
- [ ] **Assets ready before the camera turns on:**
- [ ] Copy angles we already hold
- [ ] The additional angles from **Paul Tancredi**
- [ ] White-label angles too — Chris wants to shoot those tomorrow even though white label launches later. Shooting once beats shooting twice.
- [ ] **Andromeda shape, since this is what the volume is for.** One reason per ad, hook and body and close all built for that one reason, filmed start to finish. Do NOT film one body and swap hooks onto it — that is the approach that stopped working when Meta's algorithm changed. Meta's floor is 15–20 genuinely different reasons; 60–80 videos clears it easily as long as they are different *arguments* and not different *lengths*.
- [ ] **Push the SLO live for the funding offer. Up, not running.** The pages are built at `marketing/landing-pages/slo/` — `slo-01-sales.html`, `slo-02-order.html`, `slo-03-thank-you.html`, all ClickFunnels-ready with split markers where CF's native checkout and scheduler go. Its own README has a **SWAP BEFORE LAUNCH** list that must be cleared:
- [ ] Video files: `slo-vsl.mp4` + poster, `slo-vsl2-funding.mp4`, `slo-vsl3-repair.mp4` — these come out of tomorrow's shoot
- [ ] CTA hrefs: `/order` → the live order path
- [ ] Proof: replace the bracket placeholders in Section 5 with real results (they auto-hide until then, so the page is safe to put up early)
- [ ] Turn SIM MODE off
- [ ] **All the other funnels and materials up**, after the offers are refined.
- [ ] **Refine the offers before the funnels go up.** Chris's call: each offer answers a different market pain, and they need a pass. The e-product catalogue is live in `src/config/offers.mjs`: Soft Pull $32 · Decline Autopsy $27 · Winner's Board $47 · Live Trial $297 · Repair Trial $200 · Repair DFY $1,000 · UWIQ Deliverables $1,000–5,000 · Funding DFY $3,000 + 10% · Funding Mastery $5,000.
- [ ] **Winner's Board becomes a subscription.** Owner decision 2026-08-31. It is currently one-time in `src/config/offers.mjs:175-184` with no `billing` field, and a subscription in `marketing/ads/ascension/ascension-ads.md:114`. The code is the half that is wrong. Chris wants it recurring so it sits inside the ecosystem rather than beside it.
- [ ] **Meta API fully operational.** The token works today and reads the Fundhub.ai ad account. What is not wired: nothing writes campaigns, and `ad_metrics_daily` and `ad_platform_connections` are both empty, so no spend, impression or click data has ever landed.
- [ ] **Google API**
- [ ] **Google Ads API**
- [ ] **Partner API for Google Ads and YouTube integration**
- [ ] **It has to work perfectly.** Chris's words, and it is the foundation everything else sits on. Two things already known:
- [ ] Migrations only run on the production deploy context, so a schema change is not live until the branch merges. Check `/api/health` — `pending` is the honest answer.
- [ ] The `.pg.test.mjs` suite skips silently without `DATABASE_URL`. A green `npm test` proves nothing about anything that touches the database.
- [ ] **[#326](https://github.com/ZootimusMaximusBackup/fundhub-platform/pull/326)** — credit repair: the 30-day bureau clock, delivery routing, Round 2. **Watch the first week after it lands** — the deadline alarm has never fired in the product's life, so new sends will start creating breach tasks.
- [ ] **Nothing ever attributes a lead to a partner.** `clients.partner_id` is the column that links a client to the partner who brought them. It is set on **0 of 29** clients. Every production writer of `clients` was traced — `src/auth/seed-role-accounts.mjs:84`, `src/contracts/upload.mjs:182`, `src/journeys/runner/synthetic.mjs:82`, and the event-bus creator `src/handlers/client-lifecycle.mjs:184` — and **not one sets it**. The public funnel intake `api/public/survey-submit.mjs` does not contain the word "partner". The only writer that has ever set it is the demo seeder. So a white-label partner sees no leads because **no lead can reach them**. Every dashboard complaint below is downstream of this. Fixing the screens without fixing this produces a prettier empty page.
- [ ] **The partner home's centrepiece is permanently empty.** `partner-galaxy.html:523-532` hardcodes `CLIENTS`/`NODES`/`ROUTES`/`STANDING` as empty arrays with no assignment anywhere. The canvas is the largest element on the page (`.sky-wrap{flex:1}`, line 188) and ships with a legend explaining how to read it and instructions to click things in it. This is why it "looks poor" — not thin content, a dressed-up blank.
- [ ] **`partner-training.html` works and nothing links to it.** It renders the 13 seeded `training_modules` and 4 `training_gates` correctly. `grep -rn "partner-training" public/` returns only `shell.js` constants and a CSS comment; `partner-galaxy.html` says "training" zero times. Built, seeded, unreachable.
- [ ] **Two more endpoints built, routed, and called by nobody:** `/api/read/partner-production` and `/api/trials/dashboard`.
- [ ] **The accrued balance is fetched and thrown away.** `partner-galaxy.html:1755` asks for it; `data.js:579` drops it.
- [ ] **The affiliate's two most useful tables have no data path.** `affiliate.html` declares `var LEADS=[]` (line 398) and `var PAYOUTS=[]` (line 477) and never assigns either, so they permanently print "No referrals on file" and "not connected to your payout history yet." No endpoint anywhere returns `affiliate_referrals` or `affiliate_payouts` rows — the file's own comment at 526-529 says so. Not broken; never built.
- [ ] **Two tiles are hardcoded strings.** RATE is the literal "Per agreement" and COOKIE is "60d" (`affiliate.html:212-213`), while the real rates — direct 20%, downline 5% — sit in `affiliate_commission_rules`.
- [ ] **The payout hold is invisible.** `affiliates.partner_license_signed_at` gates every release (`033_affiliates.sql:88-95`) and the endpoint reduces it to a bare `license_signed` boolean with no explanation and no route to the document.
- [ ] **Nobody can log in as the one affiliate with real numbers.** AFF-000063 has the only referral and the only payout in the database and has no `accounts` row. `affiliate@fundhub.ai` — the account that does work — has 3 clicks and nothing else. Testing this felt useless because it was.
- [ ] **11 of 13 partners have `agreement_signed_at` NULL**, so the training page returns 403 `not_entitled` for them, including the test-role partner an auditor would sign in as.
- [ ] **Two stale comments that mislead a reader**, both about the leads path: `affiliate.html:817-825` says nothing records clicks (false — 9 rows exist and `public/start.html:52,56` POST them), and `api/read/affiliates.mjs:24-27` says af-02 has never written a referral row (false — it is registered and wired at `src/workflows/index.mjs:5,74`).
- [ ] **Refine the white-label offers.** Chris likes them and wants a pass — each one answers a different market pain.
- [ ] **The Locked Book offer** — `marketing/flywheel/partner/03-offer.md`. $10,000 once, sold on the Owner Lock. Needs its two guarantee numbers:
- [ ] The Build Clock: how many business days
- [ ] The First File: how many files in the first 30 days
- [ ] **Non-circumvention clause into the partner license.** A NEW migration — never edit 283. Gates the strongest guarantee (The Lock Stands) and any copy claiming the protection is contractual.
- [ ] **Three copy fixes before a white-label ad runs.** Word swaps. 1. Bare "nothing monthly" → "the partner program itself carries no repeating charge". There IS a live monthly menu ($297, $2,497, lead flow). 2. Wherever the ten-clients-a-month floor appears, add the penalty: warning, cure window, share drops 50% → 20%. 3. `PAPER-PROMISE-VS-RULE-LONG` and `NOT-A-COURSE-LONG`: "in their agreement" → "on their site".
- [ ] **Seed the initial partner row** — the partners table is empty.
- [ ] Re-run copy stage 4 for Andromeda if the 24 scripts are not replaced by tomorrow's shoot. The workflow is already fixed and gates on 15 distinct reasons.
- [ ] **No email follow-up.** 23 of 24 email pieces failed review. Anyone who books and does not buy has nothing catching them.
- [ ] **Mailgun bank-inbox → Netlify.** PAUSED, blocked on an unpaid Mailgun balance. Route moved, `MAILGUN_SIGNING_KEY` set. After paying: prove one forwarded email lands in the CRM, then document the closer latch and keyword sorter in `docs/sops/`.
- [ ] **Plaid API key** and environment secrets.
- [ ] **Re-extract `$100M Offers`** — the PDF truncated before the guarantees chapter, which is why the first offer run produced one vague guarantee.
- [ ] **Meta Ad Library API access** — may not help, since Meta's docs say non-EU ads only return if political. Competitor research already works through `r.jina.ai`.
- [ ] **ST-07 Effective permissions** — copy only, role rules live in server code.
- [ ] **Repair system + education** from `docs/metro2/AI-CREDIT-REPAIR-LETTER-GENERATION-PROMPT.md`. **COMPLIANCE REVIEW REQUIRED** before any live letter uses it.
- [ ] UX pass across the Finance OS screens, mobile and tablet included.
- [ ] **Repo hygiene.** 21 agent worktrees, 37 stashes, stranded `vc/save-*` branches. Chris raised it and said plainly he was not asking for action. After Friday, never during — the commands that clean it are the ones that eat another session's uncommitted work.
- [ ] Real contract text for each agreement (Funding Mastery, FUNDING-AGREEMENT, CREDIT-REPAIR-AGREEMENT; decide whether Capital Blueprint needs one). It may already be in the repo — W3 will search and tell you. See ops/workflows/fix-batch-2026-09-03.md W3.
- [ ] Tell W7 the exact AI setter symptom (call not placed / silent / hangs up / ignores prompt).
- [ ] Tell W4 whether the dispute-letter consent belongs on every client's portal or only repair clients (F35).
- [ ] Turn off the Gmail "FS Auto" filter before the re-walk (F17).
- [ ] Accountability upsell — Chris's idea 2026-09-03, note only. Revisit after the fix batch and fulfillment. See manual-walkthrough-2026-09-03.md.
- [ ] **high** — Credit-score bars on the client-facing deck are coloured by bureau, not by score — Experian's bar is always the red one (`public/app/present.js:350`)
- [ ] **high** — The two contracts stamped "DO NOT SEND THIS" are one click away from a real client (`src/contracts/send.mjs:312-400`)
- [ ] **high** — The affiliate terms page tells partners they earn nothing on the 10% success fee — the opposite of the owner's decision (`public/app/affiliate.html:421`)
- [ ] **high** — Galaxy invents funded/deposit dollars and prints them over real staff names — the owner's "no invented money" ruling was applied to partner-galaxy.html only (`public/app/galaxy.html:626-651`)
- [ ] **high** — A client's portal Payments tab always says "No payments yet" — it is never painted for a client, and the invoice the server now returns is read by nothing (`public/app/client-portal.html:843-852`)
- [ ] **high** — Brand Studio tells a partner their SSL certificate is issued automatically, and stamps "Verified · SSL issued" — nothing issues any certificate (`public/app/brand-studio.html:673`)
- [ ] **high** — Four wide-open public endpoints are documented as "NOT open" and signature-checked (`Detector:`)
- [ ] **high** — Journey pages overstate who can reach three staff endpoints, because the generator only recognises a role list whose name ends in ROLES (`Cause:`)
- [ ] **high** — The browser check that blocks every merge secretly drives the real fundhub.ai site (`playwright.config.mjs:110-111`)
- [ ] **high** — A leftover debugging beacon is live in production, and the guard that promises this is impossible cannot see it (`api/social/oauth.mjs:110-132`)
- [ ] **high** — Two screens print the word "Fundhub" where the standard says the brand logo goes (`public/app/pipeline.html:667`)
- [ ] **medium** — On Social Studio a post that failed and an account whose sign-in has died both paint peach, and the same screen paints that same dead account coral one panel over (`public/app/social-studio.html:859`)
- [ ] **medium** — Affiliate terms promise last-touch attribution with a 60-day window; the system is first-touch, forever (`public/app/affiliate.html:420`)
- [ ] **medium** — Times on staff screens are drawn in the viewer's own clock while the topbar beside them claims Arizona (`public/app/closer-call.js:47`)
- [ ] **medium** — The Journeys simulator reports "Messages sent 4 · Everything went to <your phone>" while sending nothing anywhere (`public/app/journeys.html:830-885`)
- [ ] **medium** — The Documents screen states in capitals that age counts from the last state change; it counts from the day the document was generated (`public/app/documents.html:730`)
- [ ] **medium** — The contract signing page tells the signer they can come back to the link "at any time"; the link stops working 30 days after it was sent (`src/contracts/signed-link.mjs:39`)
- [ ] **medium** — A client's portal Messages tab always says "No messages yet", because the painter only runs for staff (`public/app/client-portal.html:881`)
- [ ] **medium** — The Decline Autopsy journey draws three live routes; all three are commented out of the router and 404 (`netlify/functions/api.mjs:700-709`)
- [ ] **medium** — Two signed, expiring links are printed on every journey page as "genuinely open" and lumped in with the login and health-check routes (`Cause:`)
- [ ] **medium** — The screen-frame guard misses the short way of writing a text size, so the pipeline drawer buttons are the wrong size on its own reference screen (`src/ui/screen-standard.test.mjs:96`)
- [ ] **medium** — The guard against a test permanently repointing live message routing excuses the offence using the offence itself (`src/messaging/routing-restore.guard.test.mjs:81`)
- [ ] **medium** — CLAUDE.md still says outbound calls may only live in the messaging providers folder, but the enforced design puts them all in src/lib/ (`src/lib/outbound-fetch.mjs:1-3`)
- [ ] **medium** — Pipeline shows a "— held" figure that can never be a number (`public/app/pipeline.html:728`)
- [ ] **medium** — The sales presentation deck sets seven text sizes below the standard's floor, including the legal small print (`public/app/present.html:28`)
- [ ] **medium** — Pipeline and Specialist top bars are missing all three rules that stop them overflowing (`public/app/pipeline.html:46`)
- [ ] **low** — A caption tells the owner to read a colour, which the standards file forbids in copy (`public/app/campaign-manager.html:386`)
- [ ] **low** — The client portal writes its own card shadow instead of using the shared one (`public/app/client-portal.html:86`)
- [ ] **SLO / marketing video Drive naming strategy.** Chris's system is `SLO Ad N Take M.mp4` (+ specials: Retargeting, Funding Roadmap, Portal Welcome, VSL). Need a written strategy doc + organizer script alignment so agents stop inventing LOCKED-AD / pipeline names. Reference: Riverside list (IMG_0448 email), `scripts/slo-ads-drive-organize.mjs`, `ops/workflows/slo-ads-drive-manifest-2026-09-23.md`.
- [ ] **Local AI models in Cursor.** Add/configure local models in Cursor settings (Ollama/LM Studio or whatever Chris uses); document steps in repo if there's a pattern.
- [ ] Have Cursor run `npm run ship`. The server hasn't been deployed since 10/2, so checkout still charges $297 while /roadmap shows $147. (10/4)
- [ ] Fix the follow-up texts. They still offer a $197 "discount," which is now higher than the $147 price, so lower it or turn it off. (10/4)
- [ ] Check whether the old /order checkout (ClickFunnels product at $297) still gets traffic. If it does, change the product price. (10/4)
- [ ] Today's shoot (10/4)
- [ ] 3 canal ads
- [ ] 2 home ads
- [ ] 3 more green screen ads
- [ ] 10 book-a-call ads in total (10/3)
- [ ] 3 prop ads and 3 notes ads (10/3)
- [ ] Keep up 15 new ads a week, each on a different angle (9/21)
- [ ] Refine the 11 scripts (9/30)
- [ ] Lock each script the night before you film it (10/4)
- [ ] Move to bullet-point scripts with delivery marks after this batch (10/4)
- [ ] Film 3 testimonials with B-roll, then grow testimonials from 3 to 6–9 (9/30, 10/3)
- [ ] Send the B-roll asset request list to the marketing team (9/21)
- [ ] Rooftop shoot: pick 2–3 spots (W Hotel at night, Canal Club, Diablo Rooftop) and a spot for the reclined shot (Caesars daybeds), then build the shot list (9/20)
- [ ] Film the portal welcome video (script approved, opens with "What's up, welcome to Fundhub") (9/21)
- [ ] Spare Rode Wireless ME transmitter (about $80, pair it in Rode Central) (10/4)
- [ ] USB-C power bank (10/4)
- [ ] ZGCINE PS-R30 PRO charging case (10/4)
- [ ] Edit the VSLs and ads first and lock them, then add animations last. Check you have enough animations for the VSL. (10/3, 10/4)
- [ ] Visuals for the long ad ("Scale without your own cash"): the Remotion templates plus 3 new ones (10/4)
- [ ] Study the long reference ad and use its method on the next long ads (10/4)
- [ ] Smooth out the VSL with Carly (9/30, 10/1)
- [ ] Export the 3 Submagic videos: Portal Welcome, SLO Main Page VSL, VSL 2 Booking (9/25)
- [ ] Hand the edited videos to Paul for the campaigns (9/30)
- [ ] Finish the Chase selfie frame: flip it so the sign reads right, cut the shine, crop to thumbnail size, add text (10/4)
- [ ] Testimonial thumbnail pipeline: pull the best line from each video, pick a frame, render branded thumbnails (9/28)
- [ ] Submagic: confirm you're on the Business + API plan (9/22)
- [ ] Automated pipeline: Drive "Raw" folder → R2 → Submagic and Deepgram, with phone alerts through ntfy or Pushover (9/22)
- [ ] Delete the 4 "DUPLICATE" files in the SLO Ads Drive folder (9/21)
- [ ] Load the scripts from the repo automatically (10/4)
- [ ] Test it at home on one ad, fix what feels off, then film a full batch (10/4)
- [ ] Roadmap page audit: finish the 23 remaining fixes in the "Roadmap Page Audit & Game Plan" doc (9/30)
- [ ] Reorder the /roadmap steps to match the 7-step note (10/2)
- [ ] Resolve the copy conflicts: "12 funding rounds" vs the 3–6 round model, and the refund-period mismatch (10/1)
- [ ] Thank-you page: add the video slot, update the step copy and the FAQ (9/30)
- [ ] Remove the empty testimonial boxes, edit the testimonials, then add the real ones (9/30, 10/1)
- [ ] Mobile layout check (9/19)
- [ ] Prep the sorting-hat funnel (9/30)
- [ ] Deploy the custom /apply survey and the /watch UnderwriteIQ panel, then swap the placeholder approval amounts for real approval screenshots (10/1)
- [ ] Block AI crawlers on every ClickFunnels funnel (10/3)
- [ ] Low-ticket session funnel (10/3)
- [ ] Proof cards: fill the template (fundhub-proof-cards.html) with real client wins (9/22)
- [ ] ClickFunnels API slot with Paul (the Launch plan allows one app, and Paul's team is using it) (9/22)
- [ ] Merge the open branches first
- [ ] Restore the shuffle and the light-up course section
- [ ] Put the Canva approval screenshots into the asset stack
- [ ] Set up Cal.com and the CRM custom fields
- [ ] Optimize the roadmaps (9/30)
- [ ] Capital Blueprint features (9/30)
- [ ] Welcome kit
- [ ] Letter mailing as a per-letter upsell
- [ ] White label recruiting (parked): pitches for credit optimization companies and high-ticket coaches, a Google Ads inbound page, and mailer copy (8/31)
- [ ] Clarity tracking check (9/30)
- [ ] UnderwriteIQ: make the funding math match your rule (highest limit × 5.5 for personal, about double that for business). The client-facing number runs about 3x too big. (10/4)
- [ ] UnderwriteIQ: post-funding inquiry log, backfilled from client files (9/11)
- [ ] Ask a repair partner for a sample export, and look into a mortgage broker data trade for prime-lender coverage (9/11)
- [ ] Zoom with Justice on financing approvals (9/30)
- [ ] Create the Whop account, and follow up on the Whop KYB ticket for FH Consulting LLC (9/29, 9/30)
- [ ] Commas: hit the processed-volume threshold that unlocks financing on any product (9/17)
- [ ] FH Consulting BNPL setup (9/11)
- [ ] Register a domain for FH Consulting
- [ ] Confirm its EIN and open its business bank account
- [ ] Move the e-product pages, thank-you page and checkout to the new domain, with terms, privacy and refund pages in its name
- [ ] Connect Payments AI (or Stripe) and PayPal, and turn on Pay Later
- [ ] Apply to Elective with the disclosure statement
- [ ] Apply to FlexxBuy (Pro plan) and put its link on the white-label sales page
- [ ] Apply to Payva as the $10,000 backup
- [ ] Write the one-page intercompany agreement
- [ ] Link fundhub.ai out to the FH Consulting domain for the education products
- [ ] Text the 40 old clients (target: 10 sales) (10/1)
- [ ] Text the 50-person list (10/3)
- [ ] Follow up on leads (10/2)
- [ ] Make the GitHub repo private
- [ ] Take the 155MB video (public/funnel/slo-testimonial-colin.mp4) out of the history or move it to LFS, because GitHub rejects files over 100MB
- [ ] Update the repo rules that still say GitLab
- [ ] Remove the blocks that stop Claude from shipping on its own: open the network allowlist (ClickFunnels, Netlify, Supabase, Inngest), give the cloud repo access, and put deploy keys in cloud secrets (10/4)
- [ ] Permanent cloud access to the repo (10/2)
- [ ] Triage TODO.md into Today, This week and Next 30 days (10/4)
- [ ] Write the voice file (VOICE-CHRIS.md) from your own phrasing (10/4)
- [ ] Make the ad-creation system faster (10/3)
- [ ] Your three numbers: cash on hand, monthly burn, monthly collected revenue. Then set kill criteria for each offer. (9/4)
- [ ] Plan the investor buyout (9/4)
- [ ] Claude organization agent for your desktop files and Google Drive (8/15)
- [ ] Check that your friend's CXL access is still active (10/3)
- [ ] CXL Digital Psychology & Persuasion minidegree (10/3)
- [ ] Scrape the courses (10/3)
- [ ] Typing practice on Monkeytype (english 1k, 60-second tests) toward 140 WPM (8/31)
- [ ] Taxes (9/19, 9/20, 9/21)
- [ ] Send the CPA the list of years
- [ ] Finish the last 2 years
- [ ] Mail all 3 years to the IRS by certified mail, and keep the signed PDF and the receipt
- [ ] Recover your Apple account (9/21, 10/3)
- [ ] DCM: order the AHH-DCM77 bypass harness (about $84 at autoharnesshouse.com, confirm it fits the 2024 Prius Prime) and a plastic pry tool, clean the car, then pull the DCM (9/19, 9/20)
- [ ] Lift 2–3 times a week (10/2, 10/4)
- [ ] Ultra Japan (Sept 18–19, 2027): sign up for ticket alerts at ultrajapan.com, and book flights in Jan–Feb 2027 (in around Sept 15, out around Sept 22) (9/25)
- [ ] Clean the room, hang up clothes, and consolidate the yellow boxes into one (9/20)
- [ ] Hang the art: your two pieces plus a third, in black frames above the desk (9/20, 9/25)
- [ ] Replace the bed and sort out the desk (9/20)
- [ ] Bring the King Eight Sleep back from your friend's place (9/25)
- [ ] Bring in the 77-inch TV and the monitor (9/25)
- [ ] Faux fur throws, and a tapestry over the patched wall (9/25)
- [ ] Snake-print rug from Marketplace (9/25)
- [ ] Royal Berkey: check the filter age (Boroux filters are the cheaper swap) (9/25)
- [ ] Sonos: add Era 100s as rear surrounds, and factory reset the Move (9/25)
- [ ] Speech therapist in Arizona who takes AHCCCS (send me your plan name and I'll search its directory) (10/4)
- [ ] Sleep study, then an ENT consult (9/4)
- [ ] Dentist: fillings and a deep cleaning, then cleanings every 3 months (9/1)
- [ ] Botox consult (9/10)
- [ ] House: 655 N Gentry Circle, Mesa, after two steady months of income (strategy only) (9/22)
- [ ] Airbnb for a month: Gilbert or Cornville (8/15, 9/19)
- [ ] Corvette Z06, and sell the Cybertruck (9/22)
- [ ] Tennis trip: Acapulco, the Miami Open or Las Vegas F1, with all-in costs from Phoenix (9/11)
- [ ] Social reps: weekly events plus a daily 2-minute conversation with a stranger, and re-check CitySwoon in late October (9/14)
- [ ] DoorDash Platinum push (4.7 rating, 100 deliveries in 30 days) with Gridwise tracking (9/16)
- [ ] 3D printer: try HeatSync Labs in Mesa first, then a Bambu Lab (A1 about $349, or X1 Carbon Combo about $1,449) (9/5, 9/15)
- [ ] Switch 2 games: Mario Kart World, Donkey Kong Bananza, Metroid Prime 4, Smash Bros. Ultimate, Super Mario Bros. Wonder, Star Fox (about $390) (9/28)
- [ ] Cartier order through your Cartier Scottsdale SA: Roadster, Juste un Clou bracelet and ring (9/2)
- [ ] Hyperbaric chamber: OxyRevo Forward 90 Pro (8/31)
- [ ] Wally 58 charter (8/25)
- [ ] Butt Buddy: high-risk processor (CCBill, Segpay, Verotel or NETbilling), the site on Render, and silicone casting in a printed mold (9/5)
- [ ] AI idea-pitch platform: decide whether you sell the ideas yourself or take a cut of users' ideas (9/5)
- [ ] Clone the funnel for an e-product audience, without the funding questions (9/3)
- [ ] Try claude-mem for shared memory across Claude Code, Cursor and Codex (8/31)
- [ ] Manual end-to-end test, firing every webhook and trigger yourself (8/15)
- [ ] Favicons on the funnel and the main site (8/15)
- [ ] UnderwriteIQ module for the $1,000–$5,000 course (8/15)
- [ ] Strategy conversation with Gemini about Fundhub (8/15)
- [ ] Message blast to your credit optimization contacts (8/15)
- [ ] Fix the SMS and email copy, and lock the naming decisions (8/21, 8/22)
- [ ] Clear the 5 deployment prerequisites that block uploads and inbound mail (8/21)
- [ ] Commit the repair build spec and wireframe, and confirm the WS-A to WS-E Cursor prompts ran (8/21)
- [ ] Run a CRS test (8/22)
- [ ] Lead-routing SOP, then build the routing from it (8/26)
- [ ] Debug the deliverables and the credit letters (8/26)
- [ ] BigVU Bluetooth remote ($10–15), if you stay on BigVU (9/2)
- [ ] Vercel: downgrade to Hobby and ask for the refund (9/3)
- [ ] Cat odor kit: Nature's Miracle, Zout, white vinegar, Zeolite, a blacklight (9/5)
- [ ] USB-C cable for the Rode SC16 receiver on the Mac, plus 2–3 solid USB-C cables with micro zips (9/19, 9/20)
- [ ] Ask whether the CPA specializes in real estate (9/11)
- [ ] FAFSA at studentaid.gov once the 2024 return posts (8/15, 9/19)
- [ ] University of Phoenix: ask the advisor about Security+ transfer credit and the Maricopa 3+1 pathway (9/11)
- [ ] Start TryHackMe or HackTheBox (9/11)
- [ ] Call Eduardo Soto (8/15, 9/19)
- [ ] Rent, due on the 1st (10/1)
- [ ] Bulk coffee: Kirkland Espresso 5 lb on Walmart.com, or 2 Costco 3 lb bags at a time (9/20)
- [ ] Buy an iPad (A16 11-inch, about $395 at the Walmart on N Dobson) (10/1)
- [ ] Sell the iPad Air 11-inch M2 256GB at $450 OBO (check the model in Settings first) (9/23)
- [ ] Black Friday: check the LG 100MRGB95BU price at Best Buy, Amazon and LG.com (10/3)
- [ ] Pick up the baby blanket at Tyler and Carly's (9/20)
- [ ] Townhouse: get the CC&Rs, and have an electrician check the 200-amp upgrade (9/7)
- [ ] Move your photos to the new Apple ID with Image Capture (9/5)
- [ ] Taxes with the CPA
- [ ] Rent
- [ ] Mail the returns
- [ ] FAFSA
- [ ] Apple ID
- [ ] Buy the DCM harness AHH-DCM77
- [ ] USB-C cables
- [ ] Bulk coffee
- [ ] iPad
- [ ] Room: clean it, hang the art, sort the bed and desk
- [ ] Ultra Japan: set ticket alerts, look at flights for Jan–Feb 2027
- [ ] Townhouse (9/7 chat, if still on): get the CC&Rs, have an electrician check the 200-amp upgrade
