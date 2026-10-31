# Backend selling lanes — build spec (2026-10-30)

Status: SPEC. Written from Chris's voice note on 2026-10-30. Waiting on the four decisions at the bottom. No code is written yet. Order of work: spec, then back end (Sonnet), then screens last (Opus). Law: build-spec-then-backend-then-frontend.

## What Chris wants, in plain words

After someone fills out the survey, Fundhub keeps teaching them by email, text and push until they show up to the call. What they get depends on who they are. A person who says "500 credit score" gets repair and Capital Blueprint content. If the setter finds out they really have a 700, their content changes to match. If they reschedule, the content keeps going. Email, text and push never go out at the same time. The goal is a higher show rate, because many people arrive not knowing why credit has to be fixed before funding.

This is Jeremy Haynes' "Harvester + Hammer Them" system (`marketing/ads/backend-selling-system.md`) made to run for each person.

## What is already in the repo (looked up 2026-10-30)

- **BS-01** (`src/workflows/bs-01-precall-launcher.mjs`) is on and registered. It starts when a call is booked, runs a 3-day grid (days 1 to 3, six slots a day), and stops when the call is held. It splits only two ways, funding or repair, using the credit-pull result (`clients.outcome_tier`). That result arrives after the call, so before the call most people get the text only.
- **The email copy is not real.** All 32 BS-FUND and BS-REPAIR email entries in `fundhub-docs/sources/EMAIL-TEMPLATES-SOURCE-OF-TRUTH.md` are sample filler text. BS-REPAIR has 6 cells with no entry at all. The send gate refuses filler text. Net effect today: BS-01 sends one text (`SMS-BS01-02-PRECALL`) and no emails. `TODO.md:171` records that the 15 placeholder emails were turned off on 2026-10-09.
- **The survey** (`api/public/survey-submit.mjs`, `src/survey/cf-question-map.mjs`) saves: credit score band (500-579, 580-649, 650-699, 700-749, 750+, Not sure), funding target, planned use, what they want to change, has business, revenue or income, available capital. It is stored in `clients.custom_fields` and in `client_custom_fields`. It does not collect "has negatives".
- **The setter does not verify credit today.** Josh only confirms the time and asks 2 or 3 survey facts. No field, no event and no code stores a corrected score. The setter SOP says to keep setter notes separate and never change the submitted answers.
- **Reschedule and cancel already work.** `booking.rescheduled` and `booking.cancelled` cancel the running drip and a reschedule starts a fresh one (`s-04b-booking-reminders.mjs`, `bs-01`).
- **Send rules.** All sends go through `sendTemplated`, which only queues. A cron sweeper sends every 5 minutes. Texts are blocked from 8 p.m. to 8 a.m. Arizona time. Email has no quiet hours. There is no cap per person per channel beyond a 30-minute text duplicate block.
- **Push is not a channel yet.** It only rides along with a real text or email. Only the pre-call text can trigger it, and only for people who installed the app and turned on `marketing_push_enabled` (nothing sets that today). Lock-screen words come from a fixed approved list in `src/push/payload.mjs`.
- **Content that exists.** `marketing/ads/POST-BOOKING-15.md` holds 30 short-video concepts (titles and talking points), not email or text copy.

## The build

### 1. The lane

Each person has one lane at a time. The lane is a label saved on the person.

**Owner update 2026-10-31: two lanes, not three.** Chris: "It's either funding or it's blueprint and repair. Blueprint and repair is everyone." The earlier three-lane table (Funding, Blueprint, Repair and partners) is replaced by this one:

| Lane | Who | Content theme |
|---|---|---|
| Funding | score 700 and up | how funding works, the funding sequence, lender matching, what approved means |
| Blueprint and Repair | everyone else | the steps between them and the most funding: Capital Blueprint, the 13 optimization points, credit repair, the waypoints, the credit partner, what the industry lies about. Teach, never "you will not get funded" |

On the call, the closer still picks Blueprint or repair from the real file. The content does not have to.

Older notes kept for history: Blueprint fits when they have $5K cash or more, or a 620 FICO (ideally 650); under that they look at repair, credit partners, and funding with help.

How the survey answers map:

- Score comes from `cf_svy_self_reported_fico`. Cash comes from `cf_svy_available_capital` ("$5k - $25k", "$25k - $100k" and "$100k+" count as $5,000 or more).
- The survey band "580-649" cannot tell 610 from 640. On the survey alone it counts as under the bar, so "650-699" is the Blueprint band. A 580-649 person with $5,000 or more cash still goes to Blueprint.
- "Not sure" counts as under the bar until the setter verifies.
- The verified score from the setter uses the exact 620 line and replaces the survey band whenever one is saved (section 2). The verified value is stored next to the survey answer, never on top of it.

### 2. The setter's correction (new)

- New saved field: `verified_fico_band`, plus who recorded it and when. Lives with the other per-person facts.
- New event: `setter.verified`. It is added to `src/events/canonical.mjs`. It fires when a setter or Josh saves the verified band.
- When it fires, the lane is worked out again. If the lane changed, the unsent steps for the old lane are cancelled and the new lane's steps are scheduled. Steps already sent are never sent again.

### 3. The timeline

Two phases, one engine:

- **Before booking:** starts at `survey.submitted`. The person gets the frenzy while they decide to book.
- **After booking:** starts at `booking.created`. All times are counted back from the call time (`startTime`). A reschedule re-counts from the new time and keeps going. This covers Chris's "they have another 2 days before they book" case and the reschedule case.

Design: a plan table with one row per planned send (person, lane, channel, template key, due time, status). The planner writes the rows. A sweeper on the Netlify clock (every 5 minutes, same pattern as `s-nobook-chase`) sends whatever is due through `sendTemplated`. A reschedule or a lane change rewrites the unsent rows. Reason for the table over long Inngest sleeps: Chris said on 2026-10-20 to stop burning ingests, and the table lets staff see each person's whole plan.

Channel timing rule: no two channels for the same person within 4 hours of each other. Suggested rhythm for a day: email in the morning, text at midday, push in the evening. Final hours are set by Chris (decision 4).

### 4. Stops

The plan for a person stops when any of these happens: the call is held (`call.completed`), the booking is cancelled with no new booking, they opt out of that channel, they pay for a product, or the cap in decision 4 is reached. Quiet hours and opt-out stay enforced by the existing gate.

### 5. Channels

- **Email and text:** work through the existing send path.
- **Push:** goes to every person who has the app (Chris, 2026-10-30: app download is already tracked; `client_apns_devices`). Push is part of the launch, not later. The map below gives push its own pieces.

### 6. Content

**The job of the content (Chris, 2026-10-30).** We already know from where they are what they will qualify for. They think they are getting funding. The content sells the dream and shows why they have to go through the process first, so they show up ready to pay: the Blueprint, repair, or the funding deposit. It uses Jeremy Haynes backend-selling psychology to drive the payment, not only the show. Each lane's pieces walk them from "I want funding" to "I need this step to get it."

- Every template needs a key per lane, such as `LANE-REPAIR-PRE-03-EMAIL`, and gets approved by the owner before it can send (`compliance_passed`). Nothing is sent from filler text.
- Pieces are: belief-breaking, proof and testimonials (real source only), how funding works, how credit works, process short clips, diagrams. Chris films the videos; screen recordings from inside Fundhub and webcam clips are fine.
- Shared pieces ("what the call is", "what to bring") are written once and used in every lane.
- First set: pick 15 from `POST-BOOKING-15.md`, split across lanes, plus new lane-specific pieces. I write the email and text copy from Chris's videos and notes. Copy follows the ad rules: certain words, no "might", no day counts, never "number".
- Retire the old filler `BS-FUND-*` and `BS-REPAIR-*` keys when the lane keys go live.

### 6a. Content map (draft 1, 2026-10-30 — mapping only, nothing built)

Sources read: Jeremy Haynes "Hammer Them" SOP (4 pillars: questions, second-layer questions, objections, expectations; 15-20 pieces in the 72 hours before a call; sell the next step), `src/config/offers.mjs` (prices), `.ai/rules/ad-know-the-offer.md` (Capital Blueprint steps), `src/blueprint/credit-partner.mjs`, `marketing/ads/POST-BOOKING-15.md` (PB-#), `marketing/ads/backend-selling-system.md`.

**What each lane is selling toward (the payment on the call):**

| Lane | The payment | Price in `offers.mjs` |
|---|---|---|
| Funding (700+) | Funding, done for you: the deposit | $3,000 deposit |
| Blueprint (620+ or $5K cash) | Capital Blueprint | $5,000 default ($5,000 to $10,000) |
| Repair and partners | Repair test run, or full repair done for you | $200 test run, $1,000 full |

**Formats.** Every piece has one main format and a slideshow version (Chris: "build the slideshows for everything").

- V = Chris talking to camera (phone or webcam)
- S = screen recording inside Fundhub (dashboard, file, letters)
- Z = Zoom clip from a real call (with consent from the signed agreement)
- P = real proof: an approval screenshot or a client's own words (law: proof-cards-from-source)
- D = slideshow or diagram

**Channels.** One piece goes on one channel. They are not three copies of the same message.

- Email carries the full piece: a thumbnail, two lines, the link.
- Text carries the hook line and the link.
- Push (app users) carries one line that opens the piece in the app.

#### Shared pieces (every lane)

| # | Piece | Pillar | Format | Belief it breaks |
|---|---|---|---|---|
| C1 | What this call is and is not (PB-1) | Question | V | "It's a sales ambush." |
| C2 | Who Fundhub is and how we get paid (PB-4) | Question | V + D | "What's the catch?" |
| C3 | Soft pull vs hard pull (PB-11) | 2nd layer | D | "This will hurt my score." |
| C4 | Is this a scam (PB-16) | Objection | P + V | "These guys are all fake." |
| C5 | Bring your spouse (PB-24) | Objection | V | "I have to ask my partner first." |
| C6 | What we will never do (PB-30) | Expectation | V | "They'll lie to me like the last guy." |

#### Funding lane (700+). Belief to build: "My score is good, but the order and the setup decide how much I get."

| # | Piece | Pillar | Format |
|---|---|---|---|
| F1 | A good score is not the whole file: what a bank really reads | Question | S |
| F2 | The funding sequence: why the bank you apply to first changes the total | 2nd layer | D |
| F3 | Applying yourself burns inquiries, and each one lowers the next approval | Objection | D |
| F4 | Real approvals from files like theirs | Proof | P |
| F5 | What the deposit pays for (PB-13) | Objection | V |
| F6 | What "approved" means and does not mean (PB-27) | Expectation | V |
| F7 | The first week after you say yes (PB-28) | Expectation | S |

#### Blueprint lane (620+ or $5K cash). Belief to build: "I'm close, but there are steps between me and the most funding, and I need the map."

| # | Piece | Pillar | Format |
|---|---|---|---|
| B1 | You are closer than you think: today vs once fixed (the /roadmap sample: $199,350 → $221,500, labeled sample) | Question | S + D |
| B2 | The 13 optimization points, in order | 2nd layer | D |
| B3 | Pay this card down to this target first (the Chase sample, labeled sample) | 2nd layer | S |
| B4 | Each business is judged on its own: business one, then business two | 2nd layer | D |
| B5 | The free credit partner file: a second person on your account | Question | D |
| B6 | "The other guys want eight to ten thousand" (PB-15) | Objection | V |
| B7 | "Why can't I just do this myself" (PB-21) | Objection | V |
| B8 | Real Blueprint progress: items off, credit up | Proof | P |
| B9 | 12 months, an AI coach on your open step, the Fundhub team on the rest | Expectation | S |

#### Repair and partners lane. Belief to build: "Funding is still the goal. There are a few ways to get there, and fixing the file comes first."

| # | Piece | Pillar | Format |
|---|---|---|---|
| R1 | Why the bank said no: what is on your file | Question | S |
| R2 | How credit repair really works: the letters, the waypoints, what comes off | 2nd layer | S + D |
| R3 | What the industry lies about: "guaranteed deletions," "funding with bad credit" | Objection | V |
| R4 | Bring in a credit partner: a person with good credit joins your file, so the bank looks at their credit too and the funding is based on both of you (Chris, 2026-10-30: low-credit people need to bring somebody in). Same thing as the free credit partner file in Capital Blueprint (`src/blueprint/credit-partner.mjs` adds both people's amounts together). | Question | V + D |
| R5 | Start with one round, done for you (the $200 test run) | Objection | V |
| R6 | How long it takes and how much work is on you (PB-25, PB-29) | Expectation | V |
| R7 | Real before and after (source only) | Proof | P |
| R8 | The road after repair: repair, then Blueprint, then funding | Expectation | D |

#### Order and timing (one person)

1. **Survey to booking (before they book):** C1, then the lane's #1 and #2, then C2. One piece a day. Ends when they book.
2. **Booked to call (the hammer, about 72 hours):** the rest of the lane in order, mixed with C3 to C6. Each day: email in the morning, text at midday, push in the evening (app users). Questions first, then 2nd layer, then objections, then expectations the night before.
3. **Reschedule or more days:** a refill pool of proof and stories, one a day, until the call or the cap. Proof pieces (F4, B8, R7) refill first.
4. **Lane switch** (the setter's verified score): the new lane picks up at its first unsent piece. Shared pieces already sent are not sent again.

**What Chris films:** V pieces = 12 short talking-head videos. S pieces = 7 screen recordings inside Fundhub. Z clips come from calls he already has. Slideshows, diagrams and copy are made from his videos.

**Open for Chris on the map:**
- ~~Credit partner~~ Answered 2026-10-30: a person with good credit the client brings in. Pitched in the Repair lane (R4).
- Is the $32 file read still sold before the call? It changes C3 and the shared set.

### 6b. Draft copy, day 1 per lane (draft 1, 2026-10-31 — not approved, nothing sent)

Shown as mockups at https://claude.ai/artifact/CLb5TijCdmDNy3HyKF3aUJ. Signed "Chris, Fundhub".

**Every lane**
- Email C1, subject "What happens on your Fundhub call": Your call is booked. Here is exactly what happens. We pull up your real file. We show you how much you qualify for based on where you're at right now. Then we show you the steps to get the most funding. Nobody pitches you for 30 minutes. It's a working call. [Watch before your call]
- Text C1 (before booking): {{first_name}}, thanks for doing the survey. Here's what a Fundhub call looks like: {{link}} Pick your time here: {{book_link}}
- Push C3: Soft pull or hard pull? See which one we use.

**Funding**
- Email F2, subject "The first bank you apply to changes your total": Your credit is strong. That's a great start. But banks see each other. The first one you apply to changes what the next one says. That's why we plan your funding sequence before anyone applies. On your call, we show you the order for your file. [See why the order matters]
- Text F3: {{first_name}}, every time you apply on your own, the next bank sees it. Here's why we plan it first: {{link}} - Chris, Fundhub
- Push F5: What your deposit pays for. Tap to watch.

**Blueprint**
- Email B1, subject "You're closer than you think": Here's a sample file from our Capital Blueprint. Today it qualifies for $199,350. Once it's fixed, $221,500. Same person. The difference is the steps, done in the right order. On your call, we show you the steps for your file. [Watch the sample] (Sample file. These are not your amounts.)
- Text B3: {{first_name}}, which card you pay down first matters. Here's how we pick it: {{link}} - Chris, Fundhub
- Push B6: Why the other guys charge $8,000 to $10,000. Tap to watch.

**Repair and partners**
- Email R4, subject "You don't have to do this alone": Funding is still the goal. There is more than one way to get there. One way: bring in a credit partner. That's a person with good credit who joins your file. The bank looks at both of you. On your call, we show you how it works and which way fits you. [See how it works]
- Text R3: {{first_name}}, anyone who guarantees every item comes off is lying to you. Here's what real repair looks like: {{link}} - Chris, Fundhub
- Push R5: Start with one round, done for you. Tap to see how.

### 6a-2. Chris's answers to Jeremy's question list (2026-10-31, owner's words, summarized)

Chris: "I've never done inbound sales before." These answers merge with the repo's sales scripts, setter guide, closer playbook, transcripts, offer docs and the Hormozi library. The piece list is rebuilt from all of it; every piece names its source.

- **Why Fundhub exists.** Brokers sell shady, inefficient products on bad systems, so people slip through the cracks. Fundhub does not let people slip through. We fulfill, we keep our word, and our guarantees move people through as fast as possible.
- **Who Fundhub is.** Ten years in the funding industry, learned the hard way. Chris spent thousands of hours building what he wished he had to get the maximum amount of funding. He still funds himself.
- **What people don't get.** How credit really works. Credit education is the big one. They don't know they need really good credit to get funded, or how to optimize it. That is what the Blueprint and repair are for. They need to understand how credit is structured, how the company works, and what the deposit covers.
- **How it is different.** Outbound systems Chris spent 2,000 hours building do the legwork: applying, finding good banks, every nuance. Built so you have the most banks in the funding ecosystem.
- **Who it is for.** Anyone whose goal is the maximum amount of funding. No shortcuts. Guardrails so you can't mess it up. You will be taken care of.
- **The real pain.** Getting from where they are to maximum funding in the shortest time, with no fluff. You follow directions, you get there, then we get you the maximum amount of funding.
- **Time objection.** It is automated. You take directions on the Blueprint and answer a few questions from the advisor now and then.
- **Doubt.** People are skeptical because many companies sell these services and never fulfill.
- **Is this a scam.** Fundhub works with LexisNexis, Experian, Equifax and TransUnion and holds the licenses for that. There is a contract. Fundhub never takes a file that doesn't qualify and always tells you exactly where you need to go.
- **Pre-underwriting (Chris's term, 2026-10-31).** Fundhub uses the same models banks use to underwrite, so it pre-underwrites you and sends you only to the banks that will approve your file. Most banks approve good credit; the point is catching the red flag that gets you denied and wastes your time. Matches the written UnderwriteIQ Guarantee: "Before we take you on, our system pre-approves you for a specific amount" (`marketing/landing-pages/slo/preview/03-thank-you.html:420`).
- **We know before you apply.** The top of a credit report lists the reasons a bank approves or denies (for example "too high revolving balances"). Those are the same reasons the bank's letter gives. Fundhub reads them, so nobody is sent to apply who is not going to be approved. (Repo: `src/underwrite/report.mjs`, `src/deliverables/credit-analysis.mjs`.)
- **First week after yes (funding).** If they qualify, we optimize, then send them into funding. First approval within 72 hours. Gates stop anyone who can't be funded now.
- **What the deposit covers.** The operations of the company.
- **Credit partner and the funding circle.** Everyone should build an inner circle of funding partners who help fund their deals. Chris does it all the time. Fundhub facilitates the funding for the partners too, so the client gets more than their own amount, and partners can get a referral fee. It raises capital when you don't qualify yet, and it still works when you do.
- **What the call is.** Not one size fits all. We diagnose and tell you exactly what to do. We want action takers who need a solution, not shoppers.
- **Copy rule from Chris:** never say "CRS" to a customer.

Day counts are allowed now (owner-set 2026-10-31, PR "Allow day counts in ads"). The written Funding 72-Hour Action Guarantee says "A funding advisor starts within 24 business hours. Applications go out within 72 business hours. If we don't act in that window, you get your deposit back." (`marketing/landing-pages/slo/preview/03-thank-you.html:419`). Chris, 2026-10-31, settled: "Applications go out within 72 hours. That's the guarantee. That's in the contract." Approvals are not guaranteed in 72 hours; say it casually: applications go out within 72 business hours, which typically means approvals come very shortly after. Use "business hours" so the line matches the written guarantee. The funding-circle referral fee still needs the real program it points to.

### 6c. The three groups today, and the fix plan (looked up 2026-10-31 — mapping only, nothing built)

Chris, 2026-10-31: three groups need their own flow. (1) Came in as a lead and quit the survey. (2) Finished the survey and did not book. (3) Booked: the hammer.

**The root problem.** `survey.submitted` fires after the first survey answer, not at the end (`marketing/landing-pages/apply-survey.html:364-366, 422-434`; `src/adapters/clickfunnels.mjs:135-157, 887-891`). Only the last question (`cf_svy_available_capital`) moves the card to Survey Complete (`src/handlers/client-lifecycle.mjs:31, 330-347`). So a person who answers one question and quits is treated as "finished" by every automation.

**Group 1 — quit the survey.** Today: welcome text and email right away (`s-00-welcome`; the text says "your application is in" even though they only typed contact info), one email at 20 minutes (`s-02-incomplete-survey-nudge`) whose link goes to the calendar, not back to the survey, and a "call new opt-in" setter task. Because of the root problem, the 20-minute email only reaches people who quit before question one. No text nudge, no second touch, no resume link. Fix plan: a real "survey finished" event; a quit-survey flow with a resume link (text and email, then next morning, then day 3); welcome wording that fits someone who has not finished.

**Group 2 — finished, did not book.** Today: `s-nobook-chase` sends text and email at 2 hours, 24 hours and 72 hours, then stops after day 4. The copy is real. It starts after the first answer (root problem). It does not stop when they reply. Every message link goes to the 700+ calendar, even for people the page sent to the second calendar (`src/workflows/messaging.mjs:146-150`; the credit tier is not saved on the person). No setter task on a finished survey with no booking. The setter's "no answer" button sends no event, so the no-answer text cadence (`ai-set-03`) never runs now that Josh is retired. Fix plan: start the chase on the real "finished" event; links follow the two calendars; this is where the lane's "before booking" pieces run; stop on reply; a setter task for finished-no-book; make the "no answer" button start the no-answer cadence; keep going past day 4 with the lane refill pool until the cap.

**Group 3 — booked.** Today: confirmation text and email, a 24-hour and 2-hour reminder (`s-04b`), one pre-call text 48 hours out (`bs-01`, the only real BS copy), the 15-minute handoff text (`ai-set-04`), and the Cortana booking feed. The BS-01 email grid is filler and never sends. Fix plan: the hammer in this spec (lane pieces, email, text, push, plus booked-audience ads) replaces the filler grid. The reminders stay.

**Cadence (recommended 2026-10-31, waiting on Chris).** From Jeremy's Hammer Them SOP (Chris's copy: https://drive.google.com/file/d/1GOA7iPTQlX_tIwyGHNXgaB8wmeOv_mnM/view): 15 to 20 or more touches in the 72 hours before the call, mostly booked-audience ads; 6 emails a day. Fundhub plan: ads carry the volume; email 3 a day rising to 6 if opens hold; 1 content text a day on top of the booking reminders; 1 push a day for app users. Watch text STOP replies, spam marks and show rate.

**Price (recommended 2026-10-31).** No Fundhub prices in the hammer or the chase. Jeremy: sell the next step (the call), content has no call to action, price worries are handled by the cost of not fixing the file. The price comes up on the call only.

**Open decision.** Texting hours disagree: the setter SOP says 6 a.m. to 10 p.m. Arizona time (`docs/sops/weekend-2026-10-24/02-setter.md:34`), the send gate holds customer texts from 8 p.m. to 8 a.m. (`src/messaging/gate.mjs:111-122`).

### 7. Heartbeat (required in the same change)

- Ping row for the new sweeper in `src/pulse/heartbeats.mjs` and the sorting in `src/pulse/tripwires.mjs`.
- Deep check in `src/pulse/coverage/gap-<lane>.mjs`: "Is every person who booked a call in the next 72 hours holding a next planned send?" Goes red when someone has none.
- Tests: one pass and one fail case per check. `npm run pulse:prove` must say OK.

### 8. Proof

Scratch database only (law: verify-scratch-only, no-test-data-on-production). Walk: survey with band 500, plan appears for Repair; save verified 700, plan switches and sent steps are not repeated; reschedule moves the times; call held stops the plan. Then, when copy is approved, a prove-phone run to the agent number only.

## Order of work

1. Chris answers the four decisions. (This session)
2. Back end, Sonnet: new field and event, plan table, planner, sweeper, stops, heartbeat. No screens.
3. Copy, Opus plans, Sonnet writes drafts: templates for Repair lane first, because that lane has the biggest gap.
4. Front end, Opus, last: a staff view of one person's lane and plan. Optional until the back end is proven.

## Decisions only Chris can make

1. ~~**Lane cut points.**~~ Answered 2026-10-30. See section 1.
2. ~~**Who records the verified score.**~~ Settled by the repo: Josh (AG-04) was retired on 2026-10-24 and the setter is a person (`TODO.md`, manual setter). So it is a one-click field on the human setter's screen.
5. **Cortana.** Chris, 2026-10-30: the lanes must be wired to Cortana. Proposed: send show, Blueprint paid and deposit paid as server events through the existing Cortana feed (`src/workflows/cortana-booking-feed.mjs`, `src/messaging/providers/cortana-booking-webhook.mjs`), so ads learn from people who pay, not only people who book.
3. ~~**Push.**~~ Answered 2026-10-30: email, text and push for anyone with the app.
4. **Cap and rhythm.** How many days does the plan run before it stops on its own, and what hours do email, text and push go out?

## Leftovers found (not fixed here)

- Survey fix (Chris, 2026-10-30: "we should probably fix the survey too"). Split the score bands at 620 so the survey alone can place Blueprint people: for example "580-619" and "620-649" in place of "580-649". The survey lives on ClickFunnels (`src/survey/cf-question-map.mjs`). Owner-set 2026-10-30, final: "500 to 620. 620 to 699. 700 to 760. 760 to 850." Options: 500-619, 620-699, 700-759, 760-850, Not sure. (A score of exactly 620 goes to 620-699, so the first label ends at 619. Not sure stays.) Both lane lines, 620 and 700, sit on a band edge, so the survey alone places every person. Code that reads the old bands must move in the same change: `classifySurvey` (PASS reads 700-749 / 750+) and `surveyFicoBand`. Not started; waiting on Chris's go.

- The code comment in BS-01 says 11 of 18 cells have copy. The docs show none do.
- `has_negatives` is not collected by the survey, so the PASS result in `classifySurvey` can never happen and every submit lands in MANUAL_REVIEW.
- Nothing sets `marketing_push_enabled`, so marketing push cannot reach anyone today.

## Next chats (2026-10-31)

Chris split the next work into two chats. Each starts from main.

**Chat 1: slideshows.** Paste:

> Build the Fundhub backend selling slideshows. Words and design only. Nothing gets sent. Before writing anything, read in this order: CLAUDE.md and AGENTS.md; `.ai/rules/copy-skills-foundation.md`; every file in `marketing/copy-skills/copybot/` (start with `references/owner-voice.md`, `references/chris-voice-profile.md` and `references/voice-and-quality.md`); every file in `marketing/copy-skills/visual-thinking/`; the Fundhub brand in `public/app/fundhub-brand.css` and `docs/rules/UI-STANDARDS.md` (use only these colors, fonts and parts); the plan in `ops/workflows/backend-selling-lanes-2026-10-30.md` (sections 6a to 6c); Jeremy Haynes' "Hammer Them Ad Strategy SOP.docx" in Chris's Google Drive; `.ai/rules/ad-know-the-offer.md` and `src/config/offers.mjs`. Use Copybot for every word and Visual Thinking for every picture. Two lanes: Funding (700 and up) and Blueprint and Repair (everyone else). No Fundhub prices. The guarantee line is exactly: "Applications go out within 72 business hours. That's our guarantee, and it's in your contract. That typically means approvals come very shortly after." Never say "CRS". Label every sample as a sample. Every fact traces to a file or to Chris's saved words, or it goes. One belief per slideshow, 5 to 8 slides, phone first, click-through. `marketing/slideshows/pre-underwriting-draft-1.html` was rejected because it ignored the skills and the brand; do not copy it. Start with the pre-underwriting slideshow and show Chris a link he can open on his phone before building more. Then build about 15. Save each in `marketing/slideshows/`, commit, and open a pull request.

**Chat 2: funnel workflows.** Paste:

> Fix and finish Fundhub's follow-up workflows from lead to booked call and onward. Mostly email, plus texts. Read first: CLAUDE.md and AGENTS.md; section 6c of `ops/workflows/backend-selling-lanes-2026-10-30.md` (what runs today, every gap, with file paths); the intended journeys in `docs/journeys/`; and `.ai/rules/copy-skills-foundation.md` (every message is written with Copybot in Chris's voice). Fix each stage: (1) A lead with no survey, or who quit partway, gets a text and an email that send them straight back to the survey where they stopped. Today `survey.submitted` fires after the first answer, the S-02 email links to the calendar instead of the survey, there is no text and no second touch, and the welcome text says "your application is in" too early. (2) Survey done, no booking: `s-nobook-chase` starts too early, does not stop on a reply, and sends everyone the 700+ calendar. Every link must follow the two calendars (700 and up to `/funding-book-call`, everyone else to `/funding-book-call--02424`), so save the credit tier on the person. Add a setter task for finished-but-not-booked, and make the setter's "no answer" button start the no-answer cadence (`ai-set-03`). (3) Booked: confirm, reminders, reschedule, no-show and call held all work. Leave the BS-01 filler emails for the slideshows chat to replace. (4) Change the survey score ranges Chris set: 500-619, 620-699, 700-759, 760-850, Not sure. In the same change, move the calendar split, the qualified and unqualified pixel events Cortana sees, `classifySurvey` and `surveyFicoBand`. Customer texting hours: ask Chris once, 6 a.m. to 10 p.m. or 8 a.m. to 8 p.m. Arizona time. Follow the heartbeat, scratch-only verify, no-test-data-on-production and features-stay-on rules. Prove it on a scratch database, then on live with plus-tag test leads, and show Chris what each person gets.
