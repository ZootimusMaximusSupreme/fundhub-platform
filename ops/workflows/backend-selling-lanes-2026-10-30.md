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

Each person has one lane at a time. The lane is a label saved on the person. Lanes set by Chris on 2026-10-30 (decision 1, answered):

| Lane | Who | Content theme |
|---|---|---|
| Funding | score 700 and up | how funding works, lender matching, stacking, what approved means |
| Blueprint | score 620 and up (650 is better), OR $5,000 or more in cash | Capital Blueprint, the 13 optimization points, how funding order works |
| Repair and partners | under the Blueprint bar AND under $5,000 cash | the other ways to get funded: credit repair, credit partners, finding someone to do it with you. Teach, never "you will not get funded" |

Chris's words: Blueprint fits when they have $5K cash or more, or a 620 FICO, ideally 650. Below that and under 699, they look into repair, credit partners and funding with help. The tone is education, not a no.

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
