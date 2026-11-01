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

### 6d. Funnel workflows build — work board (2026-10-31, chat 2)

Chris's order: fix the follow-up messages from lead to booked call and onward (chat 2 prompt under "Next chats"). Work copy: branch `claude/followup-flows` in `/Users/chrisstanbridge/Developer/fh-followup-flows` (a sibling folder, made from `origin/main` at `1b1b2e881`). Scratch database: a local Postgres 16.2 with pgvector on `127.0.0.1:55432`, every migration applied (406), one copy per unit (`fundhub_scratch_w1` to `_w5`). It never touches the live database.

**In plain words.** Five pieces run at the same time. One fixes the survey "finished" signal, the score ranges and the send hours. One builds the "come back to the survey" link and messages. One fixes the "finished but did not book" chase and the setter's buttons. One checks every booked-call message on the test database. One writes the new words with Copybot in Chris's voice. Then this chat joins them, tests all of it, ships it, and shows Chris what each person gets.

**What waits on what.** No unit waits to start. Each one builds against the shared names below. The join waits for all five. The live proof waits for the ship.

| Unit | Owner | What it owns | Status |
|---|---|---|---|
| W1 | this chat (Opus) | `survey.completed` from every survey source; score ranges 500-619 / 620-699 / 700-759 / 760-850 / Not sure in the survey page, `classifySurvey`, `surveyFicoBand`, the calendar split, the qualified and unqualified pixel events; `credit_tier` saved on the person; send hours (instant any hour, drips 9 a.m. to 5 p.m. Arizona); the resume step on the `/apply` page; heartbeat rows; journeys; join, ship, live proof | join done; ship and live proof next |
| W2 | agent (Sonnet) | resume link + public door `GET /api/public/survey-resume`; S-02 quit-survey flow (3 touches, text + email); welcome sends carry the resume link | done |
| W3 | agent (Sonnet) | `s-nobook-chase` on `survey.completed`, stop on reply; setter task for finished-not-booked; setter "No answer" starts AI-SET-03; `credit_tier` refreshed when the setter fixes the score | done |
| W4 | agent (Sonnet) | booked lane check on the scratch database: confirm, reminders, reschedule, cancel, no-show, call held; smallest fix for anything broken; BS-01 left alone | done |
| W5 | agent (Opus) | the words: welcome text and email, 6 quit-survey messages, 3 no-answer texts for people with a call and 3 for people without one, in one migration | done |

**Shared names (do not rename).**
- Events: `survey.completed` (fires once, when the answers include `cf_svy_available_capital`; payload is the `survey.submitted` payload). `setter.no_answer` (payload `{ disposition: "no_answer", setter_staff_id, call_attempts }`, client set, idempotency key `setter.no_answer:<clientId>:<YYYY-MM-DD in Phoenix>`). Both are in `src/events/canonical.mjs`.
- Merge tag `{{survey_resume_link}}`: the workflow passes it in `sendTemplated(..., { context: { survey_resume_link } })`. Built by `surveyResumeUrl({ orgId, clientId })` in `src/survey/resume-link.mjs` (W2).
- Template keys (W5 writes the rows, the workflows send them): `SMS-S00-WELCOME`, `EMAIL-S00-WELCOME` (rewritten, link is `{{survey_resume_link}}`); `SMS-S02-RESUME-1..3`, `EMAIL-S02-RESUME-1..3`; `SMS-AISET03-MSG1..3` (rewritten for people with a call booked, no Josh); `SMS-AISET03-OPTIN-1..3` (people with no call booked, link `{{custom_values.booking_link}}`).
- `creditTierFor(fields)` in `src/config/survey-qualification.mjs` (W1) → `"qualified"` (700 and up), `"unqualified"` (everything else, Not sure too) or `null` (no answer). A setter's score fix wins over the typed answer. Saved on the person as `custom_fields.credit_tier`.
- Send hours (W1, `src/messaging/send-window.mjs`): `sendTiming(templateKey)` → `"instant"` (any hour: S00 welcome, S04-01 booking confirm), `"drip"` (9 a.m. to 5 p.m. Arizona, email and text; a drip due outside waits for 9 a.m.: S02 resume, NOBOOK, AISET03, S05A no-show, BS-01 pre-call text) or `"standard"` (today's rules; the 24-hour and 2-hour call reminders stay here so they are never held past the call).

**Rules for every unit.** Edit only the files your unit owns. Do not run git commit, checkout, branch, stash or push; this chat commits. Never read or use `/Users/chrisstanbridge/Developer/fundhub-platform/.env` or the live database; use only your scratch database. Never send a real text or email. Write your manifest below when you finish: files touched, exports added, tests run with pass and fail counts, anything you could not finish.

**Manifests.** (each unit appends here)

- **W5 — the words (done 2026-10-31).** File touched: `db/migrations/532_followup_flows_copy.sql` (new, the only file). No code and no exports. Written with Copybot in Chris's voice. After Chris's note on 2026-10-31 ("Please use our new copy skill. Pursaude."), every message gives one reason to act now, with the support right next to it. Every fact comes from a repo file or Chris's saved words, and the migration header lists each source. No prices, no day counts, no "number", "CRS", Social Security, "pre-approves", Josh, emojis or em dashes.
  - What it does: adds 9 new templates (`SMS/EMAIL-S02-RESUME-1..3`, `SMS-AISET03-OPTIN-1..3`) for every org, approved, and never touches a row that already exists. Rewrites 5 (`SMS-S00-WELCOME`, `EMAIL-S00-WELCOME`, `SMS-AISET03-MSG1..3`) for every org, approved. On those 5 it clears the old sign-off (who approved and the hash), because that sign-off was for the old words. A stale hash would also turn the pulse's copy-drift check red.
  - Checks (scratch `fundhub_scratch_w5` only):
    - Migrate, first run: applied. The org holds all 14 keys, 14 of 14 approved. Templates went from 172 to 181 rows.
    - Migrate, second run: skipped as already applied. The raw SQL, run again inside a rolled-back transaction, changed nothing (14 rows, same words, still 181 rows).
    - Send gate restricted-word screen (the gate's own `loadRules`, `appliesTo` and `toRegex`; 12 active rules; body and subject; rendered with the sample values): 0 hits. No warn hits (there are no warn rules). The real `gate()` at noon Arizona time: 14 of 14 allowed.
    - Draft guard `isDraftTemplateRow`: false on all 14.
    - Texts: every one ends "Reply STOP to opt out.", is plain ASCII, and is 223 to 280 characters with the tags.
    - No run of 6 words is shared by two messages (Chris's set phrase "how much you qualify for" is allowed). Reading level: texts about grade 1 to 5, emails about grade 4 to 5.
    - `npm run lint` is clean. `scripts/db/template-restore.pg.test.mjs` on scratch: 4 of 4 pass.
  - For the lead at the join (left on purpose):
    1. Run `npm run migrations:manifest`.
    2. Run `node scripts/pulse/fin-b22-sql-template-keys.mjs --write`. The saved list of SQL-only templates gains exactly the 9 new keys (146 to 155). Until then 2 tests fail: `scripts/db/template-restore.test.mjs` (7 of 8) and `src/pulse/catalog/proofs/fin-b22-flow-live.test.mjs` (237 of 238). On a throwaway copy with the list rebuilt, they pass 8 of 8 and 238 of 238.
    3. Fresh databases only (CI): seeds 013, 015 and 295 run after migrations and put the old words back on the 5 rewritten keys. Production and the migrated scratch databases keep the new words. If a CI database test needs the new words, move the 5 updates into a seed numbered after 300 (for example `db/seed/301_followup_flows_copy.sql`) and add it to `RESTORE_SNAPSHOT_EXCLUDE_FILES` in `scripts/db/template-restore.mjs`, the way seed 298 did.
    4. The real resume link is 125 characters, so the 4 survey texts go out at about 308 to 365 characters (3 text segments each). The 6 setter texts fit in 2 segments.
  - Leftover (not fixed here, found while checking the YES reply): `src/workflows/dpc-03-inbound-reply-router.mjs` treats YES as "confirm my call" only when `call_outcome` is `booked`. After a reschedule it is `rescheduled` (`src/handlers/comms.mjs`), so a YES opens a "send contract + collect payment" task instead. Today's `SMS-S04-01-CONFIRM` ("Reply CONFIRM") has the same gap. The new no-booking texts never ask for a reply word.
  - Preview, rendered with the sample values (first name Dana, resume link `https://apply.fundhub.ai/apply?r=sample`, booking link `https://apply.fundhub.ai/funding-book-call--02424?fh_tier=u`). All 4 emails end with the same footer: "fundhub.ai • Funding Intelligence for Entrepreneurs" and an Unsubscribe link.

```text
1. SMS-S00-WELCOME (Right away, any hour, the moment they type their name, email and phone)
Hey Dana, thanks for starting your Fundhub application. A few more questions and you can book the call where you see how much you qualify for. If you have to stop, this link opens your next question: https://apply.fundhub.ai/apply?r=sample
- Chris, Fundhub
Reply STOP to opt out.

2. EMAIL-S00-WELCOME (Right away, any hour, same moment)
Subject: 3 steps to see how much you qualify for
Hey Dana,
Thanks for getting started with Fundhub. Here's exactly what happens next.
1. Finish your questions. There's no credit pull to apply, and your answers save as you go.
2. Pick a time for your call. Your advisor gets your answers before you meet.
3. Meet your advisor on Google Meet. You see how much you qualify for based on where you're at right now, and the fastest way to the maximum amount of funding.
If you stopped partway, finish now. This button takes you right back to your next question.
[Button: Finish my application]
Or open this link: https://apply.fundhub.ai/apply?r=sample
If you already answered every question and picked a time, you're all set.
Chris
Fundhub

3. SMS-S02-RESUME-1 (About 20 minutes after they stop (drip hours, 9 a.m. to 5 p.m. Arizona))
Dana, your Fundhub application is saved. This link drops you at the exact question where you stopped, so you only answer what's left, then pick your call time: https://apply.fundhub.ai/apply?r=sample
- Chris, Fundhub
Reply STOP to opt out.

4. EMAIL-S02-RESUME-1 (About 20 minutes after they stop (drip hours))
Subject: Before you apply for funding anywhere
Hey Dana,
Each time you apply for funding, a hard inquiry goes on your report. The next lender sees it and approves less.
That's why we read your file with you before anyone applies. You see how much you qualify for without adding a single hard inquiry.
It starts with your Fundhub application. Your answers are saved, and the button below opens the question you stopped on.
[Button: Pick up where I stopped]
Or open this link: https://apply.fundhub.ai/apply?r=sample
Chris
Fundhub

5. SMS-S02-RESUME-2 (The next morning (drip hours))
Hey Dana, if the credit score question stopped you, your best guess is fine. There's no credit pull to finish your Fundhub application, and your advisor checks your real file with you on the call: https://apply.fundhub.ai/apply?r=sample
- Chris, Fundhub
Reply STOP to opt out.

6. EMAIL-S02-RESUME-2 (The next morning (drip hours))
Subject: The reasons a bank says yes or no
Hey Dana,
The top of your credit report lists the reasons a bank says yes or no, like "too high revolving balances."
Those are the same reasons a bank puts in the letter it sends when it says no.
On your Fundhub call, we read those reasons with you first. You find out what's holding your file back before any bank sees it.
Finish your application to book that call. Every answer you already gave is saved.
[Button: Finish and book my call]
Or open this link: https://apply.fundhub.ai/apply?r=sample
Chris
Fundhub

7. SMS-S02-RESUME-3 (Day 3, the last one (drip hours))
Dana, this is my last reminder about your Fundhub application. We don't let people slip through the cracks, so here's your link one more time: https://apply.fundhub.ai/apply?r=sample
- Chris, Fundhub
Reply STOP to opt out.

8. EMAIL-S02-RESUME-3 (Day 3, the last one (drip hours))
Subject: Why I built Fundhub
Hey Dana,
I've spent ten years in the funding industry, and I learned most of it the hard way.
A lot of brokers pull up the same list of lenders for every client and blast out applications. I built Fundhub to be what I wish I had. It reads your file first and matches it only to the banks that fit it.
You follow directions, you get there, and the first direction is to finish your application.
This is my final note about your application. Everything you answered is still there, right where you stopped.
[Button: Finish my application]
Or open this link: https://apply.fundhub.ai/apply?r=sample
Chris
Fundhub

9. SMS-AISET03-MSG1 (Right after the missed setter call (drip hours))
Hey Dana, it's the Fundhub team. We called to make sure you're still good for your call, where we go through your file with you. Reply YES if you're set, or pick a better time: https://apply.fundhub.ai/funding-book-call--02424?fh_tier=u Reply STOP to opt out.

10. SMS-AISET03-MSG2 (30 minutes later (drip hours))
Dana, for your Fundhub call, be at a computer. We pull up your file together on the call. It's a soft pull, so your score stays where it is, and you leave knowing your next move. Need a new time? https://apply.fundhub.ai/funding-book-call--02424?fh_tier=u Reply STOP to opt out.

11. SMS-AISET03-MSG3 (2 hours after that (drip hours))
Hey Dana, one more note from the Fundhub team. Your call is where you see how much you qualify for based on where you're at right now. Text YES to lock it in, or pick a new time: https://apply.fundhub.ai/funding-book-call--02424?fh_tier=u Reply STOP to opt out.

12. SMS-AISET03-OPTIN-1 (Right after the missed setter call (drip hours))
Hey Dana, this is Fundhub. We called to get your funding call on the calendar and missed you. On that call, we show you the fastest way to the maximum amount of funding. Pick a time: https://apply.fundhub.ai/funding-book-call--02424?fh_tier=u Reply STOP to opt out.

13. SMS-AISET03-OPTIN-2 (30 minutes later (drip hours))
Dana, if you're about to apply for funding, see your file first. Each bank you apply to adds a hard inquiry, and the next bank approves less because of it. Book your Fundhub call before you apply: https://apply.fundhub.ai/funding-book-call--02424?fh_tier=u Reply STOP to opt out.

14. SMS-AISET03-OPTIN-3 (2 hours after that (drip hours))
Hey Dana, on your Fundhub call we review your file the way a lender does and show you what to fix first. The call uses a soft pull, with zero impact on your score. Grab a time: https://apply.fundhub.ai/funding-book-call--02424?fh_tier=u Reply STOP to opt out.
```

- **W4 — the booked lane (done 2026-10-31).** Every message path for a person who booked a call was driven through the real `handle()` functions, the real ClickFunnels adapter and the real `messages` table on `fundhub_scratch_w4`. Nothing was sent: the sender, the calendar read and Inngest are stand-ins, and the `cancelOn` rules were run as expressions against the event rows the adapter wrote. Three things were really broken and are fixed. The rest of what was checked worked; what is left open is listed at the end of this note.
  - Files touched: `src/workflows/booked-lane.pg.test.mjs` (new), `src/workflows/s-05a-no-show-recovery.mjs`, `src/workflows/s-05a-no-show-recovery.test.mjs`, `src/workflows/dpc-02-call-outcome-enforcement.mjs`, `src/workflows/s-04b-booking-reminders.mjs`. New exports: `touchPlan` (S-05A) and `callHeldFor` (DPC-02). `callHappened` is unchanged because BS-01 uses it. BS-01, `messaging.mjs`, `src/messaging/*`, `src/config/*`, the adapter, the survey files, SQL, the journeys and marketing were not touched.
  - **What each person gets, in plain words.**
    - **(a) They book.** Right away, at any hour: one confirmation text and one confirmation email. The text reads "You're booked, <first name>. <day, date, time> MST with a Fundhub funding advisor, about 20 minutes. Reply CONFIRM ... or move it here: <their calendar>". The email has the same time in the subject, a Download Fundhub Portal link, a Confirm my call sign-in link and Reschedule here. Both are handed to the sender by id at once, text first, not left for the 5-minute sweep. The calendar follows the saved score answer: 700-759, 760-850, 750+ and 700-749 get `/funding-book-call?fh_tier=q`; 620-699, 500-619 and Not sure get `/funding-book-call--02424?fh_tier=u`; no answer gets the plain link. All eight cases matched, in the confirmation, both reminders and the email. 24 hours before the call: a reminder text ("your Fundhub call is tomorrow"). 2 hours before: a reminder text ("in about two hours"). Both show Arizona time and the same calendar. A reminder whose moment has passed is skipped, never sent late: booked inside 24 hours gets only the 2-hour one, inside 2 hours gets neither, and a missing, garbled or past start time gets the confirmation only. Two minutes after booking, the Meet link is read from the host calendar and saved on the booking. 15 minutes before: one text ("Your call starts in 15 minutes") with that link, plus a follow-up task for the closer, exactly once per call time. No text if the call is under 15 minutes away, already over, moved, cancelled or marked a no-show. The sales card goes to Booked (S-04 never moves it backwards), with tag `call:booked` and call confirmed cleared. Staff: each active owner or setter with a phone gets one staff text showing the booked time in Arizona time, every owner and setter gets an app alert, and a replay texts nobody twice. The setter gets one task, "Setter: confirm booked strategy call", one open at a time. BS-01 (observed, unchanged): it starts on both booking events, its one real text goes 48 hours before the call, and it stops when a call was saved.
    - **(b) They move the call.** The runs for the old time stop in all four workflows (S-04B, the 15-minute text, the no-show check, BS-01). A booking that began as the calendar form post has the form's id, not the call's id, so only the email rule matches there, and it does. Another person's move, or another company's, stops nothing (BS-01 has no company check). A new S-04B run sends a new confirmation text and email with the new time and a new sign-in link, then reminders 24 hours and 2 hours before the NEW time. The 15-minute text and the no-show check start again at the new time, and a moved call that is missed is its own no-show. If a stop were ever missed, the 15-minute text and the no-show check still refuse the old time. The booking and the closer task move once, and call confirmed resets. The setter's task is not re-timed.
    - **(c) They cancel.** All four runs stop. The booking is marked cancelled, the closer's call task is closed, and the person is tagged `call:cancelled`. **The person gets nothing**: no workflow starts on a cancel. **The sales card stays on Booked.** The setter's booking task stays open. A cancelled call is never marked a no-show, even if a stop were missed.
    - **(d) They miss the call.** DPC-02 wakes 5 minutes after the call's end. With no held call it sets `no_show`, tags `call:no_show`, moves the card to Lost, marks the booking `noshow` and emits `booking.noshow` once (a rerun adds none). S-05A then makes the closer task "No-show recovery — rebook" at once and sends four touches, each an email then a text: the first at the first moment inside 9 a.m. to 5 p.m. Arizona, the second 24 hours after that, the third 48 hours after that, the fourth 96 hours after that. Before every touch, touch 1 too, it checks for a new booking or a move since the no-show, and stops if there is one. Every link is the person's own calendar. Email 1 names the missed time.
    - **(e) The call was held.** When the closer saves a call (not a No show) after this booking was made, the reminders stop, DPC-02 marks Showed (card to Showed, call outcome `showed`, last action `call_held`), no `booking.noshow` is emitted, and S-05A never starts.
  - **Fixes made, each with its file.**
    1. `src/workflows/s-05a-no-show-recovery.mjs`, the lead's course change. The sender holds a drip that is due outside 9 a.m. to 5 p.m. Arizona until 9 a.m. and checks only the opt-out, so a "you missed your call" message queued at 6 p.m. still went at 9 a.m. to a person who booked at 8 a.m. Now each touch time is planned inside a step with `dripSendTime` (touch 1 from now, touch 2 = touch 1 + 24 hours, touch 3 = touch 2 + 48 hours, touch 4 = touch 3 + 96 hours), then `sleepUntil`, then the rebook check, then the send. The closer task stays immediate. `touchPlan` is exported. `handle()` takes an optional `now`. Step names: `plan-touches`, `wait-touch-1..4`, `check-booked-1..4` (touch 1 is checked now too), `send-touch-1..4`. Tests: 5 new unit tests that failed before and pass now; in Postgres, the three (d) tests failed on the old file and pass, including "no-show at 6 p.m. Arizona, rebooked at 8 a.m. next day: no touch 1 is sent".
    2. Same file. The first no-show email printed "We had you down for  and didn't connect." (blank time) because S-05A passed no appointment. It now passes the missed call, the way the booking texts do. Test: unit and Postgres, failed before, pass now.
    3. `src/workflows/dpc-02-call-outcome-enforcement.mjs` (new `callHeldFor`; DPC-02 uses it) and `src/workflows/s-04b-booking-reminders.mjs` (its two call checks use it). "The call happened" used to mean any `call.completed` the person ever had. Two real breaks: a closer who saves **No show** before DPC-02 wakes made DPC-02 mark the person Showed and skip the recovery texts, and a person whose first call was held and who books a second one got **no reminders** and a second call marked Showed with no call. Now a saved No show does not count, and only a call saved after this booking was made counts. The booking time is compared inside SQL, because read into a JavaScript `Date` it loses microseconds (259 of 300 back-to-back pairs compared wrong, and the first version of this fix failed 6 of 25 runs for that reason; fixed, 40 clean runs). Tests: two Postgres tests failed before and pass; one precision test fails on the `Date` version and passes.
  - **Tests.** `src/workflows/booked-lane.pg.test.mjs`: 19 pass, 0 fail, 0 skipped on the scratch database; with no database 0 pass and 19 skipped; on a local database not named scratch, ci or test, 19 skipped (it refuses to write). 40 runs in a row, 0 failures. The scratch database was left with none of its rows. `src/workflows/s-05a-no-show-recovery.test.mjs`: 12 pass (7 older, 5 new; the older hand-made steps gained a `sleepUntil` stub). Nine neighbouring files (S-04, S-04B, S-04C, S-05A, DPC-02, AI-SET-04, BS-01, booking cancel rules, send-window): 110 pass, 0 fail. `npm run lint`: 4451 files parse clean (ESLint is not installed in this repo and the repo forbids new dependencies; the syntax gate is the lint).
  - **Left open, for the join or for Chris.**
    1. After a cancel the person hears nothing, the card stays on Booked and the setter's task stays open. A "you cancelled, here is your calendar" message would be new copy and a new workflow; not built.
    2. A person who missed a call and then booked again stays on **Lost** on the sales board: S-04 and the booking handler only move a card forward, and Lost sits after Booked. Messages are unaffected.
    3. DPC-02 decides 5 minutes after the call's end. If the closer has not saved the call by then, a call that was held is marked a no-show and the person is told "looks like we missed each other". How soon closers save is not in the repo. A longer wait or a second signal such as the Meet transcript is Chris's call.
    4. S-04B and BS-01 have no start-time check on a move (AI-SET-04 and DPC-02 do), so their rule is also true for the event that started their own new run. The Inngest docs say the cancel listener is created when the run is triggered, so it should be safe, but a scratch database cannot prove it. S-04B also has no "is a live booking still at this time" check when it wakes (AI-SET-04 and DPC-02 do), so a stop that was ever missed could let an old-time reminder out.
    5. BS-01 was left alone: its `cancelOn` has no company check, and it still uses the old `callHappened`, so it keeps both blind spots from fix 3.
    6. The 15-minute text (`SMS-AISET04-HANDOFF`, "it's Josh at Fundhub") and BS-01's pre-call text ("Josh from Fundhub here") still name Josh, who was retired on 2026-10-24. Copy, not touched.
    7. The sender can still hold a touch that S-05A queues in the last minutes of the window (it sweeps every 5 minutes) until the next 9 a.m. without a rebook check. Rare; the dispatcher is W1's.
    8. `docs/journeys/booking-notifications-flow.md` needs two small edits from the join (journeys are W1's, so not edited): the S-05A touches now wait for the window and check after each wait, and the held-call test in section 5b is `callHeldFor`.
    9. Two failing tests that are not mine, from the other units' trigger changes: `src/workflows/index.test.mjs` (add `survey.completed` and `setter.no_answer` to `EVENT_EMITTERS` in `api/read/workflows.mjs`; `survey.submitted` no longer has a listener) and `src/pulse/coverage/gap-handoff.test.mjs` ("the grace times are longer than the waits": it reads the old `wait-20-min` in S-02 and `wait-2h` in S-NOBOOK).
    10. Not done here: any live proof, and a run through a real Inngest (the stop rules were evaluated as expressions). The heartbeat needs no new row: no new job, page or send path was added, and the S-05A length (10 days) was already set in `src/pulse/workflow-runs.mjs`.

- **W3 — finished but did not book, and the setter's No answer (done 2026-10-31).** Built with the lead's timing change: every text is planned inside the 9-to-5 window first, the run sleeps until that moment, and only then checks and sends.
  - Files touched: `src/workflows/s-nobook-chase.mjs`, `src/workflows/ai-set-03-no-answer-cadence.mjs`, `src/setter/dashboard.mjs`. Outside my list, because `src/workflows/index.test.mjs` failed without it: `api/read/workflows.mjs`, two entries only (`survey.completed` replaces `survey.submitted`, which no workflow listens to now; `setter.no_answer` added). New: `src/workflows/stop-on-reply.mjs`, `src/workflows/stop-on-reply.test-support.mjs`, `src/workflows/stop-on-reply.pg.test.mjs`, `src/workflows/followup-chases.pg.test.mjs`. Tests edited: `s-nobook-chase.test.mjs`, `ai-set-03-no-answer-cadence.test.mjs`, `src/setter/dashboard.test.mjs`. Not touched: the do-not-touch list, `test-support.mjs`, any SQL file, the setter screen.
  - New exports: `hasReplied(db, { clientId, eventId })` and `HAS_REPLIED_SQL` (`stop-on-reply.mjs`). S-NOBOOK: `TRIGGER_EVENT`, `TEXT_GAP_MS`, `SETTER_TASK_SOURCE`, `SETTER_TASK_TITLE`, `SETTER_TASK_DETAIL`. AI-SET-03: `OPTIN1_KEY` to `OPTIN3_KEY`, `TEXT_GAP_MS`, `upcomingCall`, `rebookedSince`. Both `handle()` functions take an optional `now`, and the Inngest wrapper of S-NOBOOK now passes the trigger's name.
  - **What a person gets who finishes the survey and does not book.** 15 minutes after the finish: one setter task, "Setter: call — finished the survey, no call booked" (`setter-survey-done`, open to any setter, due now), unless they booked or wrote back first. Text and email 1 go at the first moment inside 9 a.m. to 5 p.m. Arizona that is at least 2 hours after the finish. Text 2 goes 24 hours after text 1's moment. Text 3 goes 72 hours after text 2's. At each moment, in this order: sleep until it, stop if they booked, stop if they wrote back, send. Step names: `plan-msg1..3`, `wait-until-msg1..3`, `check-booked-1..3`, `check-replied-1..3`, `send-nobook-1..3`. A finish at 4 p.m. plans text 1 for 9 a.m. the next day, so a booking at 8 a.m. stops it. Finish at 4 p.m. on 31 Oct: texts on 1 Nov, 2 Nov and 5 Nov, all at 9:00. Every link follows the saved score: 13 answer shapes checked through the real `sendTemplated` (700-759, 760-850, 620-699, 500-619, Not sure, the old 700-749, 750+, 650-699, 580-649, 500-579, an answer saved with no label, a setter fix up, a setter fix down).
  - **What happens when the setter saves No answer.** One `setter.no_answer` event, payload `{ disposition: "no_answer", setter_staff_id, call_attempts }`, key `setter.no_answer:<clientId>:<Arizona day>`. It is sent when a save says No answer and the saved result was not No answer yet, or the dial count went up. The same screen saved again sends nothing. A second dial the same day sends the event, and the bus drops it because the key is taken. The event goes out after the save worked, with the bus's own `emit`; `deps.emit` and `deps.now` let tests replace it; a failure logs a warning and never fails the save. Then AI-SET-03 runs: text 1 at `dripSendTime(now)`, text 2 at text 1's moment + 30 minutes, text 3 at text 2's + 2 hours, each moved into the window. "No answer" at 4:50 p.m. sends text 1 at once, text 2 at 9:00 the next morning and text 3 at 11:00. Before each text: stop if they booked or moved the call since the run began, stop if they wrote back. Words: a booked or rescheduled call that has not started gives `SMS-AISET03-MSG1..3` (the time of that call is passed as `{{appointment.start_time}}`, which W5's words do not use yet); anyone else gives `SMS-AISET03-OPTIN-1..3`. The choice is made just before text 1. The `call.completed` trigger and its disposition gate are unchanged.
  - **Setter fixes the score.** In the `save_survey` branch, inside the same transaction, `credit_tier` is written from `creditTierFor({ ...custom_fields, setter_survey_edits: saved })` when it is not null and is different from what is saved. A null answer leaves the old value. Clearing the fix puts it back to the typed answer's tier.
  - **Decisions I made, for the lead to confirm or turn around.**
    1. Runs already asleep under the old trigger (`survey.submitted`, started before this ships) keep going under their own event name: same send keys (nobody is texted twice), their old fixed waits, no setter task, and they do get stop-on-reply. Without this, `messageCohortId` would throw for every one of them at their next send. The old path is marked temporary in the code; delete it and its test about five days after the ship.
    2. The reply check reads text replies the way they are really saved. The Twilio adapter saves `message.inbound` with `client_id` empty and the sender's number in `payload.from` (the person is only found afterwards, for the message row). So a text reply is matched on the last ten digits, same company; an email reply is matched on `client_id`. A check on `client_id` alone would never see a text reply.
    3. AI-SET-03's old "rebooked" check asked "has this person ever booked?". With the call-booked words that is always yes, so it would have ended every cadence after text 1. It now asks "booked or moved a call after this run began" (`booking.created` or `booking.rescheduled` after the trigger event).
    4. Only a save that says No answer starts the cadence. A dial logged with no result named (`log_dial` with `handoff: {}`), when No answer was saved earlier, does not.
    5. A run that starts late never plans a moment in the past: text 1 is `dripSendTime(max(finish + 2 h, now))`.
  - **Tests.** Unit: `s-nobook-chase.test.mjs` 24 pass, `ai-set-03-no-answer-cadence.test.mjs` 24 pass, `src/setter/dashboard.test.mjs` 39 pass (the old "correcting the score" test used answers the survey no longer offers, so it now uses 620-699 and 700-759), `src/workflows/index.test.mjs` 14 pass; 0 fail, 0 skipped. Real Postgres, `fundhub_scratch_w3` only: `nobook-chase-historical.pg.test.mjs` 8, `stop-on-reply.pg.test.mjs` 11, `followup-chases.pg.test.mjs` 19; 38 pass, 0 fail, 0 skipped. With no database set, or on a local database not named scratch, ci or test, the two new files skip all 30 (they write rows, so they refuse). `followup-chases.pg.test.mjs` runs both chases through the real `createTask`, `sendTemplated`, `bookings` and `events` reads, the real bus insert and the real `save_survey` transaction, and also drives both workflows the way the engine does (many invocations from the top, finished steps handed back as JSON, a moving clock, events landing while they sleep): each send step ran at its planned 9-to-5 moment. Each main guard was broken on purpose once and a test failed every time (company scope, time compare, number match, channel filter, planning outside a step, the window move, the copy choice, the day key, the same-screen dedupe, the credit_tier write). Scratch database left with none of my rows. Lint: this repo has no ESLint config, so `npx eslint` cannot run as asked; I ran ESLint with a throwaway config kept outside the repo (undefined and unused names, 0 errors in my files) plus `node --check` on every file I touched.
  - **`e2e/setter-dashboard.spec.mjs` still matches (read, not run).** It answers both API routes itself, and no reply shape changed, so nothing I did can reach it. One fixture is out of date: the "correcting a lead's score" test lists the old score options and picks 700-749. It still passes, because the page shows whatever options the mock gives it, but a real server now rejects 700-749. Safe to update to the new labels whenever.
  - **For the join, and for W1 (I did not touch pulse, journeys, SQL or the screen).**
    1. `src/pulse/coverage/gap-handoff.test.mjs` "the grace times are longer than the waits" fails now. It pulls `step.sleep("wait-20-min", ...)` out of `s-02-incomplete-survey-nudge.mjs` and `step.sleep("wait-2h", ...)` out of `s-nobook-chase.mjs`, and neither line exists any more (both files plan their times and use `sleepUntil`). It stops at the S-02 line first; the NOBOOK line fails next. The chase now plans text 1 as finish + 2 hours, moved to 9 a.m. if that is after 5 p.m., so text 1 can leave up to 18 hours after the finish. `NOBOOK_GRACE_MIN` is 150 and needs a new number and a new way to read it (`TEXT_GAP_MS[1]` is exported from `s-nobook-chase.mjs`). I did not leave a fake `wait-2h` line in the source to quiet the test.
    2. Pulse reads that mention these flows: `src/pulse/coverage/slice-20-sales.mjs:42` still says `survey.submitted`; `src/pulse/coverage/slice-24-agents.mjs:32` says `call.completed` only; `REPLIED_BY` in `src/pulse/beats/lib/handoff-truth.mjs` matches `r.client_id = l.cid` only, which misses every text reply (their `client_id` is empty). Use the same match as `HAS_REPLIED_SQL`.
    3. Journeys: `docs/journeys/booking-notifications-flow.md` (lines 110 and 124) and `docs/journeys/marketing-push-intended.md` (line 33) still say `survey.submitted` starts the chase.
    4. `src/workflows/ds-01-repair-referral.test.mjs` test 13 fails with `step.sleepUntil is not a function`: its hand-made `rebookStep` needs a `sleepUntil` stub for W4's S-05A change. Not mine.
    5. Wider runs, 2026-10-31 14:15, to see whether my change broke anything outside my files. Every workflow test that needs no database: 1031 run, 1030 pass, 1 fails (item 4). Pulse (without the display proofs), http, messaging and events: 10143 run, 10114 pass, 24 skipped (database tests), 5 fail, and none of the 5 is in my files: `registry.test.mjs` and `tripwires.test.mjs` (W2's new route `public/survey-resume` has no heartbeat row yet); `beats.test.mjs` "Guard 2.2" (`job:s-nobook-chase` moved from the baseline to a tripwire in `src/pulse/tripwires.mjs`, and no beat lists it in `covers` yet); `gap-sms.test.mjs` (`s-00-welcome.mjs` no longer has `eventId }`); `gap-handoff.test.mjs` (item 1).
    6. The setter screen still tells the setter to send the missed-call text by hand ("Missed-call text sent"). The first automatic text now goes when No answer is saved, so a lead can get two. Screen not touched; the line may need to change.
    7. A text planned in the last minutes before 5 p.m. can still be held by the 5-minute sweep until 9 a.m., without a new check (W4 noted the same for S-05A). Rare; the dispatcher is W1's.
    8. W5's words say "Reply YES" in AI-SET-03 text 1 and 3; W5 already noted the YES router gap in `dpc-03-inbound-reply-router.mjs`.
    9. `SMS-AISET03-OPTIN-1..3` rows come from W5's seed `db/seed/301_followup_flows_copy.sql`. Until it is applied, the no-booking path sends nothing (`template_pending`), and the setter task still gets made.
    10. Two cadences can run on one person. A lead who finished the survey and did not book gets the S-NOBOOK chase; if the setter then saves No answer, AI-SET-03 starts too (the opt-in words). Their moments can fall together, for example finish at 4:00 p.m. and No answer at 4:20 p.m. sends AISET03 texts 1 and 2 at 4:20 and 4:50 p.m., then AISET03 text 3 and NOBOOK text and email 1 all at 9:00 a.m. the next day. Each stops on a booking or a reply, but neither looks at the other. Whether one should wait for the other is the lead's call; I changed nothing for it.

- **W2 — the come-back link and the quit-survey follow-up (done 2026-10-31).** Built with the lead's three corrections: each touch is planned inside the 9-to-5 window, the run sleeps to that moment and only then checks and sends; the door answers a bare GET with 400; the link is short.
  - **What a person gets.**
    1. The welcome text and email (S-00) carry `{{survey_resume_link}}`. Nothing else in S-00 changed.
    2. A person who opts in and does not finish gets three touches, a text and an email each (`SMS/EMAIL-S02-RESUME-1..3`). Touch 1 is 20 minutes after the opt-in, or the next 9:00 a.m. Arizona when that moment is before 9 a.m. or after 4:55 p.m. Touch 2 is 9:00 a.m. on the calendar day after touch 1 really goes out. Touch 3 is 9:00 a.m. the day after touch 2. All three times are worked out once, inside a step, and the run sleeps (`step.sleepUntil`) to each one.
    3. Only after waking does the run ask "finished? replied? booked? answered everything?", and only then send. So someone who opts in at 11 p.m. and finishes the survey at 8 a.m. gets nothing at 9. Tested exactly that way, and the test fails if the check moves back before the sleep.
    4. Every message carries three tags, worked out inside the send step from the answers saved by then: `{{survey_resume_link}}`, `{{survey_stopped_at}}` (the owner's ten phrases, "the credit score question") and `{{survey_taps_left}}` ("1 more tap", "5 more taps"). Never "0 more taps": with nothing left to answer the touch does not send, the run stops (`all_answered`) and the person is tagged `survey:complete`.
    5. The tag count comes from the path, not a number written down. The path is **8 questions after the contact screen** on both branches (9 screens with it), so someone who answered nothing hears "8 more taps". The brief said "9 questions after contact"; 9 is the screen count with the contact screen, so the words say 8.
  - **The link.** `https://apply.fundhub.ai/apply?r=<token>`, **79 characters** (33 of address, 46 of token; it was 125). The token is the client's id (22 characters), the last good day as whole days since 2026-01-01 in base36 (2 characters until mid-2029, then 3), and the first 16 bytes of an HMAC-SHA256 (22 characters). It holds no company, email, phone or name. Same key as the unsubscribe link (`UNSUBSCRIBE_TOKEN_SECRET`, `DOCUMENT_URL_SECRET` as the fallback), no new variable. It works through the end of the 30th UTC day after it was made, so never shorter than 30 days and never longer than 31. A tampered, expired or wrongly spelled token is the same `null`. With no key, or a client id that is not a uuid, the link falls back to the plain `https://apply.fundhub.ai/apply` and logs the reason, so a lead is never left without a welcome over a key. To go below 79, `TAG_BYTES` in `src/survey/resume-link.mjs` is the one constant: 12 bytes is 16 characters and a 73-character link (tried: it reads and mints fine; the 6 tests that pin the 16-byte layout would be updated with it).
  - **Text segments, measured.** The lead's real texts in `db/seed/301_followup_flows_copy.sql`, rendered with the 79-character link, a 10-letter first name and the longest words ("the question about what the money would change", "8 more taps"): `SMS-S00-WELCOME` 267 characters, `SMS-S02-RESUME-1` 279, `-2` 279, `-3` 262. All GSM-7, so **all 2 segments** (the limit for 2 is 306). With the old 125-character link they were 3.
  - **The door (for the page).** `GET https://fundhub.ai/api/public/survey-resume?r=<token>`. No body, no headers, no cookies.
    - `200 { ok: true, contact: { first_name, last_name, email, phone }, answers: { cf_svy_<key>: "words" | ["words"] }, next_key: "cf_svy_<key>" | null }`. `contact` values are strings, `""` when unknown; the phone is as saved (E.164, `+15551234567`). `answers` holds only the words the person picked, never a ClickFunnels option id; the multi question (`cf_svy_money_change_now`) is a list, the rest are strings; an old value (an old score band) comes back as saved, so the page keeps only what is still an option, which it already does. `next_key` is the first question on their path with no answer (contact excluded; the business answer picks the pair that follows), `null` when all are answered; every question before it has an entry in `answers`.
    - `400 { ok: false, error: "token_required" }` when there is no `r` at all (the pulse's bare GET counts 400 as up). `404 { ok: false }` for any bad, tampered, expired or unknown link: one body, no detail. `405` for any other method. `500 { ok: false, error: "unavailable" }` if the database cannot be read.
    - CORS: `Access-Control-Allow-Origin` is echoed for `https://apply.fundhub.ai`, `https://fundhub.ai` and `https://www.fundhub.ai` only (never `*`), with `Vary: Origin`, `Access-Control-Allow-Methods: GET, OPTIONS`, `Access-Control-Allow-Headers: content-type`. `OPTIONS` answers 200 `{ ok: true }`. `Cache-Control: no-store`. No credentials: `fetch(url, { credentials: "omit" })` works, and a plain GET needs no preflight.
    - Read only: one `SELECT` on `clients` by the id in the token. The token is checked before the database is touched, so a bad link never reaches it. `readSurveyResume(db, token, { now, secret, env })` is the same read without HTTP, for the pulse: the same `{ ok, contact, answers, next_key }` object, `null` for any bad link, and it throws if the database fails.
  - **Files.** New: `src/survey/resume-link.mjs`, `src/survey/resume-state.mjs`, `api/public/survey-resume.mjs`, `src/workflows/inngest-sim.mjs` (a test helper that runs a workflow the way Inngest does, replaying from the top at every wake), and the tests `src/survey/resume-link.test.mjs`, `src/survey/resume-state.test.mjs`, `src/http/survey-resume.test.mjs`, `src/http/survey-resume.pg.test.mjs`, `src/workflows/s-02-incomplete-survey-nudge.pg.test.mjs`. Changed: `src/workflows/s-02-incomplete-survey-nudge.mjs` (rebuilt) and its test, `src/workflows/s-00-welcome.mjs` and its test, `netlify/functions/api.mjs` (the import and `"public/survey-resume": publicSurveyResume`, placed beside `public/survey-submit`).
  - **Exports added.** `resume-link.mjs`: `surveyResumeToken`, `surveyResumeUrl({ orgId, clientId, now })` (the shared name; `orgId` is accepted and ignored), `readSurveyResumeToken` (returns `{ clientId }`), `surveyResumeSecret`, `RESUME_TTL_SECONDS`, `RESUME_BASE_URL`. `resume-state.mjs`: `savedSurveyAnswers`, `nextSurveyKey`, `surveyProgressWords(fields)` → `{ stoppedAt, tapsLeft, left }`. `survey-resume.mjs`: the handler and `readSurveyResume`. S-02: `handle({ event, db, step, now })`, `resumePlan`, `surveyCompleted(db, clientId, email, orgId)` (now asks for `survey.completed`; the email match only on rows with no client, and only in the same company), `sequenceInFlight`, `stopReason`, `TOUCHES`, `RESUME_TEMPLATE_KEYS`, `SMS_TEMPLATE_KEY`/`EMAIL_TEMPLATE_KEY` (touch 1, the old export name kept because the pulse reads it), `FIRST_TOUCH_WAIT_MS`, `SEQUENCE_WINDOW_MS`. `EMAIL-S02-FINISH-APPLICATION` is not sent any more; its row is untouched.
  - **Tests.** Unit: 103 pass, 0 fail, 0 skipped (token 21, progress and answers 18, door 19, S-02 38, S-00 7). Real Postgres, `fundhub_scratch_w2` only, as the owner and as `fundhub_app`: 22 pass, 0 fail, 0 skipped (door 8, S-02 14). The two database files run only on a loopback scratch or CI database (`isLocalScratchDatabaseUrl`); pointed at any other URL all 22 skip. Neighbours that import my files: `routes.test.mjs`, `workflows/index.test.mjs`, `s-nobook-chase`, `messaging`, `s-04b`, `cf-question-map`: 131 pass, 0 fail. I broke the important lines on purpose and watched a test fail each time: the stop check made before the sleep, `survey.submitted` read for `survey.completed`, the one-sequence guard (the call and its SQL), the plan worked out outside a step, the reply check, the company scope and the no-client-only email match in the finished SQL, the token's scheme, expiry, tag, spelling and day rules, and the progress phrases and counts. Lint: the repo has no ESLint config, so I linted all 13 files with a private one (undefined names, unused names): clean. `npm run lint`: clean, 4452 files parse.
  - **Decisions I made, for the lead to confirm or turn around.**
    1. **One sequence at a time.** A lead who uses touch 2's link and stops again fires a new `entry.captured` (the adapter's six-hour repeat guard has run out), which starts a second run with a different send key, so they would get a second touch 1 on top of the first run's touch 2. A run that finds resume messages sent to the person from another opt-in in the last 4 days (the longest run is 2 days 17 hours) steps aside (`sequence_in_flight`). Runs for one opt-in still share the `messageCohortId` key. Delete `sequenceInFlight` if you want a fresh sequence on every re-entry.
    2. **A reply is W3's `hasReplied`** (`stop-on-reply.mjs`), so S-02, S-NOBOOK and AI-SET-03 stop on the same words, by text (matched by number) or email. **A booking is S-NOBOOK's `hasBooked`.** Keep both exports.
    3. **Day-sized expiry.** The token carries whole days, so the life is "through the end of day 30", not 30 times 24 hours to the second.
  - **For the join, and for W1 (I did not touch pulse, journeys, SQL or pages).**
    1. `src/pulse/registry.test.mjs` and `src/pulse/tripwires.test.mjs` each fail on exactly one name, `public/survey-resume`, and nothing else. You said you would add the registry row, the tripwire and the deep check; the deep check can call `readSurveyResume(db, token)` with a token it mints.
    2. `src/pulse/coverage/gap-handoff.test.mjs` test 29 ("the grace times are longer than the waits") fails: it pulls `step.sleep("wait-20-min", "20m")` out of `s-02-incomplete-survey-nudge.mjs`, and S-02 now sleeps with `sleepUntil` to planned times. The 20-minute wait is the exported `FIRST_TOUCH_WAIT_MS` (`20 * 60 * 1000`); read that instead. The other pulse files that mention S-02 pass: `workflow-runs` (your `4 * D` is plenty), `workflow-coverage`, `slice-20-sales`, `slice-26-client-journey`.
    3. `docs/journeys/booking-notifications-flow.md` line 109 still calls S-02 the "incomplete-survey nudge".
    4. The sweep edge W3 and W4 also found (a touch queued in the last 5 minutes before 5 p.m. held to 9 a.m. by the 5-minute sweep, without a new check) is closed by `DRIP_LAST_PLAN_MINUTE` in `send-window.mjs`, which landed while I worked. S-02 gets it through `dripSendTime`; its plan tests now pin the 4:55 p.m. edge.
    5. A run already asleep when this ships was started by the old code (its 20-minute sleep is gone from the new code). It may fail once in Inngest; nobody is texted twice. Not tested (needs a real Inngest).
    6. Not done: any live proof, and a run through a real Inngest.

- **W1 — foundation, join and copy draft 2 (lead chat, 2026-10-31).**
  - **Survey finished.** `survey.completed` (canonical) fires once, on the post that carries `cf_svy_available_capital`: the ClickFunnels adapter (`mapToCanonical`, repeat-suppressed like the others) and the homepage door `api/public/survey-submit.mjs`. One rule, `surveyIsComplete` in `src/survey/cf-question-map.mjs`, also moves the card to Survey Complete. A climate-page lead (two answers) is not finished, so it now gets the come-back flow instead of the never-booked chase.
  - **Score answers.** 500-619, 620-699, 700-759, 760-850, Not sure in `src/config/survey-qualification.mjs`, `src/survey/cf-question-map.mjs`, `marketing/landing-pages/apply-survey.html` and `public/js/homepage-survey.js`. Old saved answers still read the same (`LEGACY_*`). `creditTierFor` is the one rule for the calendar split, `tierBookingLink`, and `custom_fields.credit_tier` (saved by `onSurveySubmitted` and by the setter's score fix). The /apply page's `QUALIFIED_SCORES` picks the framed calendar and the `credit_tier` the tracker turns into QualifiedLead / UnqualifiedLead. The climate door keeps old ranges too.
  - **Send hours.** `src/messaging/send-window.mjs`: instant (S-00 welcome, S-04-01 confirm) any hour; drip (S-02 resume, NOBOOK, AISET03, S-05A, BS-01 pre-call text) 9 a.m. to 5 p.m. Arizona, text and email, held on the queue to 9 a.m. by `dispatch.mjs` and `gate.mjs` (`drip_hours`, retryable); everything else as before. `dripSendTime` plans drips no later than 4:55 p.m. so the 5-minute sweep sends them inside the window. `nextHourStrike` is the one clock helper (dispatch's `nextQuietHoursEnd` wraps it).
  - **/apply resume.** `?r=<token>` asks the door for saved answers and opens on the first unanswered question; an answer that is no longer a choice is asked again; no token, a bad one or 3 s with no answer starts at the top.
  - **Copy, draft 2.** Chris on draft 1: it parroted the ads and did not sound like a person. The lead chat rewrote all 14, plus the 6 never-booked chase messages (they still signed as Josh), with Copybot (owner voice first) into `db/seed/301_followup_flows_copy.sql` (a seed, numbered after 300, because seeds 013/015/295 would overwrite a migration on a fresh database). The come-back messages name the question the person stopped on (`{{survey_stopped_at}}`) and the taps left (`{{survey_taps_left}}`). Checks: Flesch 89 to 105, no 5-word run shared with the ads or the VSL, no banned word, 2 SMS segments with the real 79-character link, the send gate allows all 14.
  - **Heartbeat.** `handoff:lead-first-touches-missing` follows the new keys, `survey.completed`, the reply stop (text replies by number) and the 9-to-5 due time (`dripAtSql`, proved equal to `dripSendTime` at 823 moments), plus a new setter-task branch. New daily deep check `survey:resume-link-opens` (`src/pulse/coverage/gap-survey-resume.mjs`), `reg:` ping for `public/survey-resume`, tripwire rows for the route and `job:s-nobook-chase` (baseline 403 to 402), the `lead-handoff` beat covers the chase, SLEEPERS raised.
  - **Join fixes.** The setter desk and the setter SOP now say the missed-call texts go out by themselves. Test fixtures moved to the new ranges. Diagrams regenerated. Journeys: `booking-notifications-flow.md` §1, §2, §3, §3b (new), §6, §7c; `heartbeat-flow.md`; changelog.

**Leftovers (found here, not fixed here).**
- `docs/journeys/marketing-push-intended.md` line 33 still says `survey.submitted` starts the never-booked chase. It is an intended journey (agents do not edit it); the actual trigger is `survey.completed`.
- The live booking confirm and reminder texts (`SMS-S04-01-CONFIRM`, `SMS-S04-02-REMIND-24H`, `SMS-S04-03-REMIND-2H`) still sign as Josh; the live rows differ from the repo seeds. The never-booked chase was rewritten here (draft 2). Chris to decide whether the booking texts move to the "Chris at Fundhub" voice.
- Two cadences can land together: a lead who finished the survey and then gets "No answer" can get AI-SET-03 text 3 and NOBOOK text + email 1 at the same 9 a.m. Neither waits for the other.
- After a cancel the person hears nothing and the setter task stays open; a no-show who rebooks stays on Lost; DPC-02 judges a no-show 5 minutes after the call, so a closer who saves later makes a held call look missed (W4).
- `dpc-03-inbound-reply-router.mjs` reads YES as "confirm my call" only when `call_outcome` is `booked`, not `rescheduled` (W5).
- The same-day booking block is on the first calendar only (other chat's note).
- S-NOBOOK keeps a temporary path for runs that fell asleep under `survey.submitted` before the ship. Remove it about five days after the ship (W3).

### 6e. Slideshows: build board (2026-10-31)

Owned by the slideshows chat (branch `claude/backend-selling-slideshows`). Other chats: leave this section alone. (Numbered 6e because chat 2's funnel board took 6d on main first.) Words and design only. Nothing here sends anything.

**What a slideshow is.** One HTML file per slideshow at `marketing/slideshows/<slug>.html`. It has 5 to 8 slides and teaches one belief. It is built for a phone and clicked through with Back and Next, a swipe, or the arrow keys. It is the slideshow version of a piece in 6a: the email, text or push links to it. No call to action and no Fundhub price. It sells the next step, the call (Hammer Them SOP).

**Chris's direction, 2026-10-31 (all of it is law for this batch).**
- His slide style, from the slides he shares on calls: a coded label, a big headline, then full lines of copy with the pastel stripe (`<ul class="lines">`). More copy, not less.
- Real first (law: `.ai/rules/show-real-proof.md`). Show the real thing whenever we have it: a real report section, a real agreement clause, a real product screen, a real approval. Merge it with a little branded mark on top (a chip, a tint, a label). A diagram on its own only when nothing real shows the point, and then in Fundhub's own style (white sheet, hairline panels, pastel tints, mono labels, ink). The layouts can be sketches; the look is ours. No stick figures, no hand-drawn look, no grids of tiles, no grid texture.
- The words point at the picture and the picture proves the words.
- The pattern deck is `marketing/slideshows/pre-underwriting.html` (review link: https://claude.ai/artifact/NZqQrr424KegLFMjSXrdAk). Copy its parts: `.lines`, `.real` (a real document: `.rh1`, `.rh2`, `.bureau-head`, `.score`, `ul`/`li.flag`/`li.yes`, `table`, `.clause` with `mark`), `.real-src` (the Sample line), `.chip` marks, `.sheet` + `svg.bv` branded diagrams, `.steps`, `.metric`/`.span`.

**The shared design. Do not fork it.**
- `marketing/slideshows/_shell/slideshow.css` and `slideshow.js` hold the design and the click-through engine. `node marketing/slideshows/build.mjs` copies them, plus `public/app/fundhub-brand.css` and the local rounded faces from `fundhub-font.css`, into every deck between its `fh:shell` markers. Change the shell, never a deck's copy of it, then run the build.
- `node marketing/slideshows/check.mjs` must say PASS. It runs Fundhub's copy rules and the ad rule book's own machine checker (`scripts/ads/check-script.mjs`, strict mode: banned words, never-say lines, vendor names, em dashes, Part 0 patterns such as "credit repair", "your number", EIN, "could"). It also fails: "CRS"; any hedge; "number"; Fundhub spelled any other way; any Fundhub price from `src/config/offers.mjs`; "72" without the exact guarantee line; approvals tied to 72 hours; any call to action; a figure with no Sample label and no `data-figures` reason; a slide with no `data-src`; fewer than 5 or more than 8 slides; a stale shell. Proven to fail planted mistakes on 2026-10-31.

**How to write one.**
1. Read your deck's facts in the fact bank and open every source line it cites. No source, no slide line. A claim bigger than its source gets smaller.
2. Copybot (`marketing/copy-skills/copybot/`, start with `references/owner-voice.md` and the voice sources it lists: `chris-voice-profile.md`, `marketing/ads/VOICE.md`, `marketing/ads/RULES.md` Part 0). Slide 1's headline and line are the hook: cause first, tell them something they don't know, no ask, no question, the first subject is not us (RULES.md 2.2, Part 0 rules 21, 26, 27). Full sentences, no chopped fragments, no setup-and-punchline pairs, say what things are (Part 0 rules 13 to 17). "Review your file the way a lender does" (rule 8). "Credit optimization", never "credit repair" (rule 1). Grade 5. The evergreen backend-selling spine fits most decks (RULES.md 3.13): the mistake, why it happens, what to do instead, the proof, the soft door to the call.
3. Visual Thinking (`marketing/copy-skills/visual-thinking/`): name each slide's question, then real first, merged with a mark, or a branded diagram that answers that question.
4. Markup per slide: `<section class="slide" data-src="file:line, ...">`, `<p class="eyebrow">CODE-0N / Topic</p>`, one `<h2>`, the hook slide's `<p class="lede">`, then `<ul class="lines">` with 1 to 3 full lines, then one `<figure class="pic">`. Add `dark` to the opening slide and the payoff slide only. A figure is labeled Sample, or the slide carries `data-figures="why this figure is a rule, not a sample"`. Real document titles use `.rh1`/`.rh2`, never `<h1>`/`<h2>`.
5. Write the Copybot and Visual Thinking choices in the deck's header comment, the way `pre-underwriting.html` does.
6. Run the build, run the check, then look at every slide 390 pixels wide (a local server: `python3 -m http.server` in the work copy).

**Real things we can show (all labeled Sample when they come from a sample).**
- FinanceOS sample report (scores 702, 709, 706; a card near 40% used; one old 30-day late; three hard inquiries, one per bureau; the bureau's four reason lines): `src/finance/sample-credit-file.mjs`. Rendered once through the real report renderer (`scripts/render-crs-standard-report.mjs` in the main checkout) to `/private/tmp/claude-501/-Users-chrisstanbridge-Developer-fundhub-platform/1cfbffaf-2a37-4e37-a006-93eba2f2ad5b/scratchpad/report/sample-report.html`; the builder script is `make-sample.mjs` beside it. Copy sections from that HTML into `.real` blocks. Funding lane.
- REPAIR-FULL sim file (two collections, one charge-off, one 30-day late, high-500s scores; real bureau comment text "PLACED FOR COLLECTION", "CHARGED OFF ACCOUNT"): `scripts/sim/push-credit.mjs:624-672`. Blueprint and Repair lane. If it cannot be rendered through the report renderer without a database, build the `.real` block from the file's own fields, word for word.
- /roadmap sample (762 middle score; $199,350 today, $221,500 once fixed, $22,150 left on the table; three cards and their 10% targets): `ops/workflows/2026-10-02-roadmap-sample-content/w1-samples.json`. Funding lane (money-on-the-table).
- Blueprint product screens, stamped SIMULATION: `ops/workflows/build-evidence/blueprint-timelapse-2026-10-21/still-0{1,2,3}-*.png`. Crop to the part that proves the line, save as a JPEG under 100 KB and embed it as a data URI. Never show "Pre-qualified" (still 1).
- Agreements, word for word: funding `db/migrations/493_funding_and_repair_agreement_text.sql:53`, credit repair `:58-90` (round one the day you sign, up to six rounds, no deletion promised), Blueprint `db/migrations/485_blueprint_program_scope.sql`, `491_blueprint_agreement_fundhub_team.sql`.
- Soft pull form, word for word: `db/migrations/287_contract_seller_signature_and_real_text.sql:146-154`.
- Real approval screenshots, names blurred: `marketing/landing-pages/slo/client-wins/deck.json` and `deck/`. No totals.

**Rules that bite here.** Never "closer", "sales call", "sales team", "pitch", "sell you" or "close you" in anything the lead sees or hears (Chris, 2026-10-31: "nobody wants to be closed or sold"); say "your advisor", "strategy call", "offer", "walk you through". `check.mjs` fails them. The credit report's own "Closed" stays. No Fundhub prices. Never "CRS". The guarantee line word for word, funding lane only: "Applications go out within 72 business hours. That's our guarantee, and it's in your contract. That typically means approvals come very shortly after." Never promise an approval, an amount or a deletion. One sample file per deck. Blueprint: "the Fundhub team" and "an AI coach", never "your advisor", no "every step has a due date". Never EIN, DUNS, net-30 or gas cards. "Funding sequence", never "round two". Never the Social Security number. The fact bank lists every do-not-say line per deck: `/private/tmp/claude-501/-Users-chrisstanbridge-Developer-fundhub-platform/1cfbffaf-2a37-4e37-a006-93eba2f2ad5b/scratchpad/fact-bank.md`.

**The plan, slide by slide.** Each slide also gets 1 to 3 full lines of copy. Real = a real document or screen with our marks on top. Diagram = a branded diagram.

| # | Deck | Lane | Belief | Status |
|---|---|---|---|---|
| 1 | `pre-underwriting` | Funding | We review your file the way a lender does, before a single application goes out. | done |
| 2 | `funding-sequence` | Funding | The order your applications go out decides your total. | done (builder A, checked) |
| 3 | `apply-yourself` | Funding | Every application you send on your own shows up for the next bank. | done (builder A, checked) |
| 4 | `money-on-the-table` | Funding | A strong score still leaves funding on the table. | done (builder A, checked) |
| 5 | `after-you-say-yes` | Funding | What happens after you sign. | done (builder D, checked) |
| 6 | `bank-said-no` | Blueprint and Repair | The reason the bank said no is already on your report, and it gets fixed first. | done (builder B, checked) |
| 7 | `thirteen-points` | Blueprint and Repair | 13 optimization points, done in the right order. | done (builder B, checked) |
| 8 | `card-paydown` | Blueprint and Repair | Which card you pay first, and to what target. | done (builder B, checked) |
| 9 | `credit-optimization` | Blueprint and Repair | The letters go out in order, and each one asks for more. | done (builder B, checked) |
| 10 | `credit-partner` | Blueprint and Repair | You don't have to qualify alone. | done (builder C, checked) |
| 11 | `business-one-two` | Blueprint and Repair | Each business is judged on its own. Start it now. | done (builder C, checked) |
| 12 | `blueprint-12-months` | Blueprint and Repair | What 12 months on the Blueprint look like. | done (builder C, checked) |
| 13 | `soft-pull` | Every lane | Reading your file does not move your score. | done (builder C, checked) |
| 14 | `the-call` | Every lane | Your call is a working call on your real file. | done (builder D, checked; "Google Meet" changed to "a video call", RULES.md 1.4) |
| 15 | `who-we-are` | Every lane | Fundhub keeps its word, in writing. | done (builder C, checked) |
| 16 | `cost-of-waiting` | Every lane | Every month you wait, the file stays the same and the cost keeps running. | done (builder E, checked) |
| 17 | `the-maximum` | Every lane | The maximum amount of funding comes from the file, the order and the companies, and it keeps going. | done (builder F, checked) |
| 18 | `the-money-talk` | Every lane | Money worries get solved on the call, not by cancelling. | done (builder F, checked) |
| 19 | `tried-before` | Every lane | If you paid someone and nothing happened, nobody read your file first. We fulfill. | done (builder E, checked) |
| 20 | `blueprint-value` | Blueprint and Repair | You don't need a thousand hours of courses. You need your own roadmap from your own file, built by a real algorithm. | done (builder G, checked) |
| 21 | `blueprint-in-action` | Blueprint and Repair | The dashboard, start to finish: your file, your steps, your letters, your businesses, until the file is ready to fund. The long-form walkthrough. | done (builder G, checked) |
| 22 | `your-data-is-safe` | Every lane | Access to prime data means better results, and we handle that data the way the bureaus require. | done (builder H, checked) |

**Deck 22, Chris's ask (2026-10-31):** "We have direct relationships with LexisNexis, Experian, TransUnion. That requires compliance. People are giving us a Social Security number in a safe form, so show we're a legitimate company." Sourced facts only: the published privacy policy (`public/privacy/index.html`, live at fundhub.ai/privacy): AES-256 encryption in transit and at rest, built on SOC 2 audited providers, no selling of personal information, mobile information never shared for marketing, retention until no longer needed, state rights to access, correct or delete. The agreement (`493...sql:53`): section 4 names LexisNexis and the soft inquiries, fraud checks and compliance checks; "Fundhub will use and protect your information for the service and related security checks"; section 8 discloses recorded calls and AI; the Blueprint agreement 11.2 "We do not sell your personal information" (`288...sql`). The pull code: the report is stored without the most sensitive identifier and that identifier is kept encrypted (`src/finance/crs-map.mjs:110-124`, `crs-pull.mjs:40`). The repair agreement gives the federal rights statement before signing (`493...sql:122`). Company: Fundhub LLC, a Florida limited liability company operating in Arizona, with its address (`493...sql:53`). Not sourced, so not on a slide: a license document, a SOC 2 report of Fundhub's own, "fully compliant" as a badge. The words "Social Security number" stay off (owner-set 2026-09-29, `.ai/rules/no-ssn-before-checkout-step-3.md`); say "the information a bureau needs to find your file" and "your most sensitive identifier".

**Deck 22, Chris's second pass (2026-10-31, his words, saved here as the source):** "It's about trust, but you're also selling them. Because we have these direct relationships with the bureaus, LexisNexis, Experian, TransUnion, Equifax, show them. Most funding companies are checking a consumer credit site report. We have multiple layers of credit information, and we can show them exactly what we can see past that. We have deeper data analytics than anybody else. We have access to Experian Business as well. Access to this data means we handle it correctly, and we use it to build the algorithms that optimize your file quicker and better. When we build the optimization letters, deeper data gets inquiries, accounts, addresses and names off faster. Access to prime data means better results. Banks want to do business with people like that, because we're pre-vetting with the same data feeds they use." Sourced layers to show: the tri-bureau prequal FICO 9 pull, one product per bureau (`src/finance/crs-client.mjs:112-126`); the business search and the LexisNexis Top Business match (`crs-client.mjs:176-200`); the Experian Business check (owner-set 2026-09-29, `reorg-draft-build.mjs:354-356`; `src/finance/bank-strategy.mjs:95` names Experian Business and Equifax Business); the full tradeline fields a consumer site never prints: account identifiers, subscriber codes, lates, payment patterns, inquiries by bureau, public records (`src/finance/crs-map.mjs:14, 152-229`; the tri-bureau report renderer header); the letters built from those fields: tradeline, personal information and inquiry removal (`src/pulse/beats/lib/letter-catalog.mjs:17, 147, 241-248`). Not sourced, so not on a slide: "we can see if a bank is in pre-review"; a competitor's product by name; any bureau logo (none in the repo; the names go in the brand's own style until logo files and their use rules are in the repo). Never the pull vendor's name.

Slide plan, deck 22 your-data-is-safe, now PRIME DATA (Trust, then the sell: Doubt and Desire): (1) Hook, cause first: a funding company asks for the information a bureau needs to find your file, and most never say what happens to it next. Real: the privacy policy's encryption sentence, marked. (2) Who we work with, in your agreement: Experian, Equifax, TransUnion and LexisNexis, with the fraud and compliance checks that come with them. Real: section 4 clause, marked. (3) What we never do: sell your information, share your mobile information for marketing. Real: the privacy policy and agreement 11.2, marked. (4) How the report is stored: without your most sensitive identifier, which is kept encrypted. Diagram with the code's own words (`ssnRedacted: true` shown as the engine's flag is fine; never the full phrase). (5) Everything is disclosed in writing before you pay: recorded calls, AI on your file, your rights by state, retention. Real: section 8, marked. (6) A real company: Fundhub LLC, Florida, operating in Arizona, with an address and Arizona law. Real: the agreement header, marked. (7) The call: nothing is pulled until you are on the call with us; soft pull; your score does not move.


**Real facts measured 2026-10-31 for deck 20 (code counts, tests and fixtures left out; `find ... | xargs cat | wc -l` on the work copy):** UnderwriteIQ's engine, `vendor/underwriteiq-full/`: 37,097 lines in 145 files. The Fundhub engines around it: `src/underwrite` 6,841 (20 files), `src/finance` 22,930 (64), `src/blueprint` 4,845 (18), `src/metro2` 10,989 (54), `src/deliverables` 5,802 (15), `src/waypoints` 1,872 (7). Together about 90,000 lines in 323 files. The whole app (`src`, `api`, `db`, `public/app`): about 580,000 lines. Safe to say on camera as "about".

**Real screens for deck 21:** the 6-month timelapse (`marketing/broll/public/blueprint/blueprint-6-month-timelapse.mp4`, 20 s, 3840 x 2160, stamped SIMULATION) holds three screens: the Progress checklist (about 2 s), the Money > Credit screen with the three scores, cards used and hard inquiries (about 10 s), and a staff workspace (not for leads). Frames at 4 K are in the scratch folder `bp-frames/`. The live app's Blueprint screens are `public/app/money-*.html` (accounts with "Add a business", banks, credit, fundability, alerts, connections) and `client-portal.html` (Progress). Chris's ask (2026-10-31): a long-form video of the dashboard in action, start to finish, is the next piece; deck 21 is its storyboard and script. The screen recording itself on a sample client is a follow-up (needs a scratch database with the sim client).

Slide plans, decks 20 and 21:

20 blueprint-value: (1) Hook, cause first: courses teach the funding game in general and never read your file, so a thousand hours later you still don't know your next step. Real: the green-lit line "Instead of watching a course about the process, you go through the process on your own file, and that's how you actually learn it." (`marketing/ads/scripts/2026-10-14.md:132`) and "Only about 1 in 8 people finish an online course they sign up for" (`2026-10-13.md:44`). (2) What you want is unlimited funding (owner-set 2026-09-29: structure aged companies right, five to ten of them, each needs revenue, it takes time). The three keys, Chris 2026-10-31: personal credit set up, businesses set up right, a clear roadmap from where you are to where you want to be, from your own file. Diagram. (3) It is a real algorithm. Real: a crop of the engine's own code (`src/finance/fundability.mjs:146-160`, the checks) shown as a code block, with the counts marked: 37,097 lines in 145 files for UnderwriteIQ, about 90,000 with the engines around it. Chris: "show them code too; they're going to think we're lying." (4) Your roadmap from your own file: the 13 optimization points in order (the six named groups, `ad-know-the-offer.md:43`). Real: the Progress checklist frame. (5) Your businesses: add business one, then business two; each is judged on its own (`fundability.mjs:73-75`, `:156-160`); "Add a business" is a real link in the app (`public/app/money-fundability.js:431`). Real: the engine's five business checks. (6) It keeps going: the next funding sequence, more companies over time. Diagram, no amounts. (7) Chris's guarantee for the Blueprint, his words: "We GUARANTEE it's the last tool you'll ever use to learn the funding game." (`2026-10-14.md:136`, green-lit; owner-set 2026-10-14). (8) The call.
21 blueprint-in-action (long form, 60 to 75 seconds of talk a slide): (1) Day 0: your file is read and your checklist appears, built from your own report. Real: still-01 cropped to the checklist (never "Pre-qualified"). (2) Your credit on one screen: the three scores, cards used, open accounts, hard inquiries. Real: the Credit frame. (3) Step one: pay the card down to its target; a text before each statement date (`present.js:985`); the step checks itself off on the next pull (`362...sql:86`). Real: the checklist row. (4) Letters: print and mail your dispute letters, upload the mailing proof, upload the bureau responses (`400...sql:20-36`), or have the Fundhub team run the rounds (credit optimization, done for you, no price). Real: the three letter rows on the Progress screen. (5) Businesses: file the LLC, open a business checking account, add the business in the app; each business judged on its own. Real: the two business rows on the month-6 screen. (6) Over time: your checklist and letters are updated when new credit information comes in (`485...sql:11`); never a pull date. Real: month 3 against month 6 (cards used 13.1%, three inquiries). (7) Who is with you: an AI coach on your open step, reminders, then a person on the Fundhub team (`ladder.mjs:52`). Diagram. (8) Ready to fund: when the engine says your file is ready, the Fundhub team preps you and a closer calls about funding (`present.js:975-976`); the funding sequence starts. Diagram.


**The objective, in Chris's words (2026-10-31):** the lead arrives pre-closed: "I don't care what it is, let's get this going, I need this." The closer's script says every objection is one of seven missing beliefs: pain, doubt, cost, desire, money, support, trust (`docs/sops/weekend-2026-10-24/04-sales-call-script.md:349-360`). The decks are mapped to those seven, so the call becomes a confirmation.

| Belief | Decks | After decks 16 to 19 |
|---|---|---|
| Doubt (will it work for me) | pre-underwriting, the-call, thirteen-points, bank-said-no | strong |
| Trust (is this legit) | who-we-are, soft-pull, the-call, tried-before | strong |
| Support (I won't be alone) | blueprint-12-months, after-you-say-yes | good |
| Pain and cost (what staying stuck costs) | apply-yourself, money-on-the-table, cost-of-waiting | good |
| Desire (the maximum amount of funding) | business-one-two, credit-partner, the-maximum | good |
| Money (cash is tight, payments, the other guys) | the-money-talk | covered without a price |

Closer objections with no deck even after 16 to 19, on purpose: the rate, the monthly payment, "why pay you 10%", "the lender said no" on financing. Those are the money step on the call, and prices stay off the content.

Slide plans, decks 16 to 19:

16 cost-of-waiting: (1) Hook, cause first: nobody reads the file, so nothing on it changes while you wait, and the cost keeps running. Real: the closer's own question sheet, "What is this costing you each month? Jobs you can't take, ads you can't run..." (`04-sales-call-script.md:112`; setter `02-setter.md:116`), marked. (2) The inquiries you already sent keep sitting there for the next bank. Real: the sample report's inquiries. (3) Credit optimization runs on the bureaus' clock: 30 to 45 days to answer each round, up to six rounds (`493...sql:69`), so starting later pushes every round back. Real clause marked. (4) Funding runs in rounds, about six per funding sequence, each after the one before (`present.js:109`). Diagram: start now against start later, no dates. (5) A no was a fact about the file on that day; the file only changes when something is done to it (`04:413`; offers PDF p.8). (6) The call: worst case you leave knowing exactly where you stand and the next move (`02-setter.md:96`; PB-23 idea without the price).
17 the-maximum: (1) Hook, cause first: most people take what the first bank gives and stop, because nobody showed them the order. Real: Chris's allowed record (RULES.md Part 0 rules 35 to 38: a decade, hundreds of files, a little over $1,000,000 funded for himself into cash-flowing companies, $100K lines on four companies off one personal file, stated income, no income docs). (2) Personal file first, then each company on its own (`funding-sequence.mjs:3-13`, `present.js:109`). Diagram. (3) Unlimited funding over time is true: structure aged companies right, five to ten of them, each needs revenue, it takes time (owner-set 2026-09-29, `reorg-draft-build.mjs:350-351`). Diagram: one personal file feeding company one, two, three over time, no amounts. (4) The funding circle and the credit partner (`chris-voice-profile.md:34`; `credit-partner.mjs`). (5) Real: one approval crop not used in who-we-are (`client-wins/deck.json`), names blurred, no total. (6) The call: how much you qualify for based on where you're at right now is the start of the funding sequence, not the ceiling. Say "next funding sequence", never "round two".
18 the-money-talk: (1) Hook from the approved concept PB-20 (`POST-BOOKING-15.md:118-121`): if cash is tight, say it on the call; don't cancel over it; there is a version of this that starts smaller than you think. Real: the closer's section 8 lines as the call sheet, no figures ("half today and the rest on your next payday", "a smaller first step, at its real price"; `04:316-319`). (2) What finances and what doesn't: "Financing is for the Blueprint only" (`04:374`); checking your options is a soft check, taking the loan is a hard pull (`04:379-380`). Real clause marked. (3) The other guys' price is their price (PB-15 shape, `04:395`, no figures); you see the fee in dollars before you pay and everything is in the agreement (`04:416`). (4) Real clause: "If no funding is secured, no back-end success fee is due" (`493...sql:53`, section 2), marked; the deposit covers the operations of the company (Chris, board 6a-2). No figures, no percent. (5) The only charge before the strategy call is the soft pull, and your score does not move (`02-setter.md:101`, figure left off). (6) The call: you agree on the path before you hear a price (`04:204`).
19 tried-before: (1) Hook in Chris's own words (VOICE.md Pair 2, `marketing/ads/VOICE.md:89`): "they logged into Experian, pulled up a list of lenders they use for every single client, and started blasting out applications." Real: the sample report's inquiries, marked "what blasting leaves behind". (2) "Brokers sell shady, inefficient products with bad systems, so people slip through the cracks. We don't let people slip through the cracks." (`chris-voice-profile.md:26`). Diagram: two paths. (3) What was different: nobody checked the file against what each bank approves before the applications went out (`direct-book-vsl-2026-10-15.md:41`); pre-underwriting flow. (4) What we will never do (PB-30 shape), from the agreement, word for word: never sign a loan or credit agreement for you, never make a false statement for you (section 4), never submit an inaccurate claim (section 6), never promise approval or an amount (section 3). Real clauses marked. (5) "We fulfill. We keep our word." (`chris-voice-profile.md:27`) with the two clocks as the funding agreement's own words (G-01, G-02), labeled as the funding agreement. (6) The call: you see your file before any pitch and the fee in dollars before you pay (`04:416`).


Slide plans (question, picture, headline):

2 funding-sequence: (1) Why do two files with the same score get different totals? Real: the application-order box Fundhub prints on a client's lender list, marked. "The order your applications go out decides how much funding you get." (2) What is the right order? Diagram: personal file, personal funding, business one, business two, keep applying. "Your personal file goes first, then each business on its own." (3) Why one bank at a time? Real: the lender list line "Wait for the decision before you send the next one. Never shotgun applications.", marked. "One application at a time, so each bank sees a clean file." (4) Which banks go first? Diagram: national banks, then banks in your state, then banks in your business's state. (5) What happens between rounds? Diagram, call-slide steps: Round 1, Sweep, Round 2, Sweep, about six per sequence. "Between rounds, we dispute the new hard inquiries." (6, dark) The guarantee, real clause marked. (7) The call, copy only.
3 apply-yourself: (1) Real: the sample report's three inquiries, marked "the next bank sees these". (2) Real: Fundhub's fundability checks with "No hard inquiries" marked. "Hard inquiries cost fundability, and too many bring automatic declines." (3) Diagram: on your own (one bank after another, inquiries stack) against planned rounds (banks that fit, pulls spread across three bureaus, disputes between rounds). (4) Copy: the one question to ask any company: will you pull my file and show me why before you apply anywhere? (5) Real: the soft pull form line, marked. (6) The call, copy only.
4 money-on-the-table: (1) Real: the /roadmap sample's How Much You Qualify For ($199,350 today, $221,500 once fixed, $22,150 left on the table), labeled sample. (2) Real: the sample's waterfall, all $22,150 from card use. (3) Real: the sample's paydown table, three cards to 10% of their limits. (4) Diagram: the engine's three gates (score, card use, negatives). (5) The call, copy only.
5 after-you-say-yes: (1) Real: agreement section 3, G-01 marked. (2) Real: the portal's progress stages, from documents received to round funded. (3) Diagram: two columns, the Fundhub team and you. (4, dark) The guarantee, real clause marked. (5) Real: the approval email's own words. (6) Copy: business cards carry a personal guarantee, and intro rates end on a set month. (7) Diagram: rounds and sweeps, about six per funding sequence.
6 bank-said-no: (1) Real: the REPAIR-FULL sample's negative lines ("PLACED FOR COLLECTION", "CHARGED OFF ACCOUNT", a 30-day late), marked. "When a bank says no, the reason is already on your credit report." (2) Diagram: the engine's three gates, each failing on the sample. (3) Real: the Blueprint's first steps (pay the card down, mail the letters), from the product screen. (4) Diagram: the letters in order. (5) Copy: a clean file goes back through the same review for funding. (6) The call, copy only.
7 thirteen-points: (1) "13 optimization points decide how much funding your file gets." Diagram: the count. (2) Diagram: the six named groups in order (cards to pay down, items to remove, items to add, banks to open, where to put the money, how to set up the business). Never a list of 13 names. (3) Diagram: steps row, each group sets up the next. (4) Real: the engine's fundability checks, labeled as the engine's checks. (5) Real: the Blueprint screen with fundability rising, SIMULATION. (6) The call, copy only.
8 card-paydown: (1) Real: the Blueprint screen step "Pay FIRST PLATYPUS BANK down to $800", marked. (2) Diagram: each card's share used, fullest first. (3) Diagram: one card with its 10% target mark. (4) Diagram: pay before the statement date. (5) Real: the step checking itself off after a new pull. (6) The call, copy only.
9 credit-optimization: (1) Hook from Chris's words: banks and bureaus would rather ignore a dispute than answer it. Real: the agreement's "Round one goes out the day you sign", marked. (2) Diagram: the six letters rising (dispute, method of verification, final notice, CFPB, state attorney general, final notice reissued). (3) Diagram: letters to the bureaus and straight to the company that reported the item. (4) Real: "each round waits on the answer to the one before it", marked. (5) Real: what is and is not promised, and every letter and answer in your dashboard. (6) The call, copy only.
10 credit-partner: (1) "You don't have to qualify alone." (2) Diagram: two files, each with its own consent and checklist. (3) Diagram: your amount plus your partner's amount, no figures. (4) Copy: Chris's funding circle. (5) The call: bring the partner who would apply with you.
11 business-one-two: (1) Real: the engine's own line "Form an LLC now so it can season while your credit is being repaired.", marked. (2) Real: the engine's business checks (no "$5,000" figure on the slide). (3) Diagram: how the engine reads business age. (4) Diagram: personal ready, business one, business two. (5) The call, copy only.
12 blueprint-12-months: (1) Real: a Blueprint screen, SIMULATION. (2) Real: the checklist steps on the screen. (3) Diagram: the reminder ladder ending in a person on the Fundhub team. (4) Diagram: your part and our part. (5) Copy: when your file is ready, the Fundhub team calls you about funding. (6) The call, copy only.
13 soft-pull: (1) Real: the soft pull form line, marked. (2) Copy: only you see a soft pull. (3) Diagram: soft pull against hard pull (when, who starts it, who sees it, the score). (4) Diagram: three bureaus, because different banks pull different bureaus. (5) The call, copy only.
14 the-call: (1) Diagram: the call in six parts. (2) Real: the sample report section you will see. (3) Copy: how much you qualify for based on where you're at right now. (4) Copy: your file and your path come before any price. (5) Diagram: what to have ready. (6) Copy: join from a computer, because your advisor shares the screen.
15 who-we-are: (1) Copy: Chris's allowed proof (a decade, a little over $1,000,000 funded for himself, four companies). (2) Real: approval screenshots, names blurred, no total. (3) Real: the agreement's guarantees and the line that Fundhub does not promise approval. (4) Copy: the bureaus and LexisNexis we work with (no license claim). (5) Real: "every application uses your true information". (6) The call, copy only.

**Second format: the film board (Chris, 2026-10-31).** Every deck also gets a wide version for filming. Short-form video on a phone is split top to bottom: the top half is Chris on camera, the bottom half is the slide. So each slide becomes one 16:9 board: the headline, the copy lines, the real document or diagram, no Back and Next, big enough to read on a phone at half height. `node marketing/slideshows/build.mjs --talk` writes `marketing/slideshows/talk/<deck>.txt`, the headline and talking points of every slide as plain text with a blank line between them, so Chris can paste a whole deck into the teleprompter (it pauses on a blank line) and read while the film board is on screen. The film board is built from the same deck file by `node marketing/slideshows/build.mjs --film` into `marketing/slideshows/film/<deck>.html` (one source, two shapes, so the words never drift): `_shell/film.css` lays each slide out as a 1080 x 960 board, words left and the picture right, and `_shell/film.js` steps through with the arrow keys, the space bar or a click, no buttons. Open it in a browser window, screen-record it, and put it under the camera clip.

**Handoff to chat 2, the follow-up workflows (Chris, 2026-10-31: "when this is all done, feed it into what we built on the other thread; more deliverables means more texts, pushes and emails").** When the pull request merges, this chat sends chat 2 one message with, per deck: the lane, the belief, the file, the 6a piece it carries, and the hook (slide 1's headline is the text hook and the email subject; the first copy line is the push line). Two steps belong to the send side: (1) a live address for each deck, which means serving `marketing/slideshows/*.html` and `film/` from the site (for example `public/slideshows/`), and (2) a heartbeat row for every new live page in `src/pulse/registry.mjs` in the same change (law: heartbeat-on-every-build). Until then the links in templates stay as merge tags, not hard-coded paths.

| Deck | 6a piece | Lane | Hook (slide 1 headline) |
|---|---|---|---|
| pre-underwriting | F1 | Funding | When a bank denies good credit, the reason was on the credit report first. |
| funding-sequence | F2 | Funding | The same five applications, sent in the wrong order, get declined. |
| apply-yourself | F3 | Funding | Every application you send on your own is a hard pull, and the next bank reads it. |
| money-on-the-table | B1 (as Funding) | Funding | A 762 middle score still leaves $22,150 on the table in this sample file. |
| after-you-say-yes | F7, F6 | Funding | Two clocks start the minute you sign, and your delay does not pause either one. |
| bank-said-no | R1 | Blueprint and Repair | When a bank says no, it read the reason off your credit report first. |
| thirteen-points | B2 | Blueprint and Repair | 13 optimization points decide how much funding your file gets. |
| card-paydown | B3 | Blueprint and Repair | Your card balance counts on the day your statement closes. |
| credit-optimization | R2 | Blueprint and Repair | Banks would rather ignore a dispute than take the time to answer it. |
| credit-partner | B5, R4 | Blueprint and Repair | When your own file holds your funding down, you bring in a partner with good credit. |
| business-one-two | B4 | Blueprint and Repair | A bank reads a business by its age, and the clock starts the day you file it. |
| blueprint-12-months | B9 | Blueprint and Repair | A course hands you a plan and then leaves you alone with it. |
| soft-pull | C3 | Every lane | When you apply at a bank, that bank does a hard pull, and the next bank sees it. |
| the-call | C1 | Every lane | Your file picks the path, and you see it before any price. |
| who-we-are | C2, C4 | Every lane | Brokers sell shady products on bad systems, so people slip through the cracks. |
| cost-of-waiting | new (pain, cost) | Every lane | Nobody reads your file while you wait, so nothing on it changes. |
| the-maximum | new (desire) | Every lane | Your file is worth more than the first yes, since nobody showed you where to apply first. |
| the-money-talk | new (money; B6, R5 without a price) | Every lane | People cancel over money because nobody told them the money talk happens on the call. |
| tried-before | new (trust; C6) | Every lane | You paid a company, nothing got funded, and its inquiries still sit on your report. |
| blueprint-value | new (desire, doubt) | Blueprint and Repair | A course teaches the funding game in general. It never reads your file. |
| blueprint-in-action | new (support, expectation; the long-form video) | Blueprint and Repair | Day 0: your file is read, and your checklist appears, built from your own report. |
| your-data-is-safe | new (trust, then the sell) | Every lane | Most funding companies read a consumer credit site report. A bank reads deeper. |

Headlines filled from the deck files on 2026-10-31 (`grep -m1 "<h2>"`). The handoff was sent to chat 2 the same day.

**Manifest.** Pull request: https://github.com/ZootimusMaximusSupreme/fundhub-platform/pull/347 (branch `claude/backend-selling-slideshows`). Chris's one-link review page, every deck as phone and film: https://claude.ai/artifact/XCV94LxU9ZsMxPnCVL3Vxa (private to Chris). Files: `marketing/slideshows/<22 decks>.html`, `marketing/slideshows/film/<22 decks>.html`, `marketing/slideshows/talk/<22 decks>.txt`, `_shell/slideshow.css`, `_shell/slideshow.js`, `_shell/film.css`, `_shell/film.js`, `build.mjs`, `check.mjs`. New rule `.ai/rules/show-real-proof.md` (owner-set 2026-10-31) with its links, CLAUDE.md line and index row; `copy-skills-foundation.md` and the Visual Thinking skill point to it. No routes, no workflows, no database, nothing sent. All 22 pass `check.mjs`; `rules:check` OK.

**Leftovers (not fixed here).**
- The Blueprint product screens are crops of the 6-month timelapse simulation (2026-10-21), so their "Done" dates sit in 2027. Re-shoot those screens from a live sample client when one exists, then re-crop blueprint-12-months, card-paydown, business-one-two and thirteen-points.
- Chris names Experian, Equifax, TransUnion and LexisNexis on who-we-are (his 2026-10-31 answer); RULES.md 1.4 says no vendor names. His newer answer was followed. Say the word to cut them.
- `marketing/slideshows/pre-underwriting-draft-1.html` is the rejected draft. It stays until Chris says to remove it.
- `scripts/render-crs-standard-report.mjs` is an uncommitted file in the main checkout, owned by another chat. The slideshows only copied its printed output.

#### 6e.1 Rewrite on the slide framework (Chris, 2026-10-31, evening)

Chris on the first build: the decks explain what Fundhub does but never why it matters to the viewer or how it changes their life, the talking points read like AI, and lines are recycled from his ads. Measured the same evening: `scripts/copy/recycled-lines.mjs` found 6 to 40 lines per deck copied word for word from his ads, VSLs, call scripts or another deck. The facts and pictures stay. The words are rewritten. Each deck gets a full script of about 850 to 1,000 words (5 minutes at Chris's ~200 words a minute), one teleprompter block per talk line, read on his teleprompter from `talk/<deck>.txt` (blocks 5 blank lines apart).

**The framework (Chris approved, 2026-10-31).** One job per slide, in this order: the hook, what's really going on, what it's costing them, how Fundhub handles it, what their business looks like after, the proof, the strategy call. Every slide ties its point to the viewer (what it costs them or gets them). Proof only where a viewer would doubt the claim. Slides open different ways so nothing reads cookie-cutter. Chris: proof on every slide is not needed.

**The double check (Chris, 2026-10-31).** Nothing reaches Chris until a separate agent passes it with `marketing/copy-skills/copy-reviewer/SKILL.md`. Machine floor: `node marketing/slideshows/check.mjs` (now includes the parrot check). Tools: `set-copy.mjs` writes a deck's words from JSON without touching the pictures.

**Order.** pre-underwriting first as the model deck, reviewed by the copy reviewer and by Chris. Then five writers in parallel, then fresh reviewers on every deck, then fixes, then one pull request.

| Writer | Decks | Status |
|---|---|---|
| Lead session | pre-underwriting | done, PASS, with Chris for review |
| W1 Funding | funding-sequence, apply-yourself, money-on-the-table, after-you-say-yes | waiting on Chris's review |
| W2 Credit side | bank-said-no, thirteen-points, card-paydown, credit-optimization | waiting on Chris's review |
| W3 Blueprint | credit-partner, business-one-two, blueprint-12-months, blueprint-value, blueprint-in-action | waiting on Chris's review |
| W4 Trust and process | soft-pull, the-call, who-we-are, your-data-is-safe | waiting on Chris's review |
| W5 Pre-close | cost-of-waiting, the-maximum, the-money-talk, tried-before | waiting on Chris's review |

**Writer prompt (the lead session starts the writers; Chris pastes nothing).** Each writer gets this prompt with its deck list: read Copybot and its references, `marketing/ads/RULES.md` Part 0 and 1, the copy reviewer, the model deck and this section; write each deck as JSON for `set-copy.mjs`; keep every picture, slide count, lane and fact; add a source to `data-src` for any new fact; script 850 to 1,000 words, blocks of 25 to 30 words, CAPS punch words; every line fresh; `check.mjs` must PASS; build film and talk; touch only its own decks; no git.

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

> Fix and finish Fundhub's follow-up workflows from lead to booked call and onward. Mostly email, plus texts. Read first: CLAUDE.md and AGENTS.md; section 6c of `ops/workflows/backend-selling-lanes-2026-10-30.md` (what runs today, every gap, with file paths); the intended journeys in `docs/journeys/`; and `.ai/rules/copy-skills-foundation.md` (every message is written with Copybot in Chris's voice). Fix each stage: (1) A lead with no survey, or who quit partway, gets a text and an email that send them straight back to the survey where they stopped. Today `survey.submitted` fires after the first answer, the S-02 email links to the calendar instead of the survey, there is no text and no second touch, and the welcome text says "your application is in" too early. (2) Survey done, no booking: `s-nobook-chase` starts too early, does not stop on a reply, and sends everyone the 700+ calendar. Every link must follow the two calendars (700 and up to `/funding-book-call`, everyone else to `/funding-book-call--02424`), so save the credit tier on the person. Add a setter task for finished-but-not-booked, and make the setter's "no answer" button start the no-answer cadence (`ai-set-03`). (3) Booked: confirm, reminders, reschedule, no-show and call held all work. Leave the BS-01 filler emails for the slideshows chat to replace. (4) Change the survey score ranges Chris set: 500-619, 620-699, 700-759, 760-850, Not sure. In the same change, move the calendar split, the qualified and unqualified pixel events Cortana sees, `classifySurvey` and `surveyFicoBand`. Customer send times (owner-set 2026-10-31): an instant message tied to something the person just did, like the booking confirmation, goes out right away at any hour, even midnight. Drip and follow-up sequences send only from 9 a.m. to 5 p.m. Arizona time, and a drip message due outside that window waits for 9 a.m. Do not build per-person time zones. Follow the heartbeat, scratch-only verify, no-test-data-on-production and features-stay-on rules. Prove it on a scratch database, then on live with plus-tag test leads, and show Chris what each person gets.
