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

### 6d. Slideshows: build board (2026-10-31)

Owned by the slideshows chat (branch `claude/backend-selling-slideshows`). Other chats: leave this section alone. Words and design only. Nothing here sends anything.

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

**Rules that bite here.** No Fundhub prices. Never "CRS". The guarantee line word for word, funding lane only: "Applications go out within 72 business hours. That's our guarantee, and it's in your contract. That typically means approvals come very shortly after." Never promise an approval, an amount or a deletion. One sample file per deck. Blueprint: "the Fundhub team" and "an AI coach", never "your advisor", no "every step has a due date". Never EIN, DUNS, net-30 or gas cards. "Funding sequence", never "round two". Never the Social Security number. The fact bank lists every do-not-say line per deck: `/private/tmp/claude-501/-Users-chrisstanbridge-Developer-fundhub-platform/1cfbffaf-2a37-4e37-a006-93eba2f2ad5b/scratchpad/fact-bank.md`.

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

**Second format: the film board (Chris, 2026-10-31).** Every deck also gets a wide version for filming. Short-form video on a phone is split top to bottom: the top half is Chris on camera, the bottom half is the slide. So each slide becomes one 16:9 board: the headline, the copy lines, the real document or diagram, no Back and Next, big enough to read on a phone at half height. It is built from the same deck file by `node marketing/slideshows/build.mjs --film` into `marketing/slideshows/film/<deck>.html` (one source, two shapes, so the words never drift): `_shell/film.css` lays each slide out as a 1080 x 960 board, words left and the picture right, and `_shell/film.js` steps through with the arrow keys, the space bar or a click, no buttons. Open it in a browser window, screen-record it, and put it under the camera clip.

**Manifest so far.** `marketing/slideshows/_shell/slideshow.css`, `_shell/slideshow.js`, `build.mjs`, `check.mjs`, `pre-underwriting.html`. New rule `.ai/rules/show-real-proof.md` (owner-set 2026-10-31) with its links, CLAUDE.md line and index row. No routes, no workflows, no database, nothing sent.

**Leftovers (not fixed here).**
- The Blueprint product screens are crops of the 6-month timelapse simulation (2026-10-21), so their "Done" dates sit in 2027. Re-shoot those screens from a live sample client when one exists, then re-crop blueprint-12-months, card-paydown, business-one-two and thirteen-points.
- Chris names Experian, Equifax, TransUnion and LexisNexis on who-we-are (his 2026-10-31 answer); RULES.md 1.4 says no vendor names. His newer answer was followed. Say the word to cut them.
- `marketing/slideshows/pre-underwriting-draft-1.html` is the rejected draft. It stays until Chris says to remove it.
- `scripts/render-crs-standard-report.mjs` is an uncommitted file in the main checkout, owned by another chat. The slideshows only copied its printed output.

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
