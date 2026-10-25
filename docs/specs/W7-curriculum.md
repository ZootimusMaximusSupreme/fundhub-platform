# W7 — The $10,000 training curriculum

> **COMPLIANCE REVIEW REQUIRED** — this curriculum covers credit-repair messaging, fee
> timing, and consent capture. It is a marker,
> not a recommendation.

**Status:** specification only. Nothing built. **Written:** 2026-08-31.
Reads with `W0-decisions.md` (owner terms) and `W6-pricing-menu.md` (what the $10,000 buys).

---

## The shape

COMPLIANCE REVIEW REQUIRED — this curriculum design covers credit-repair messaging, fee timing, and consent capture. Thirteen modules, run as a fixed-date live cohort of twelve partners over twelve weeks, with four hard gates a partner must pass before they may sell anything under FundHub's fulfilment. The weight sits on three things, because those are the three things the evidence says stop people producing: the partner's own money math, the sales call, and a supervised first three paying clients — not on content volume. Compliance is split into two certified modules rather than one, because FundHub's machine screener only reads ad copy and cannot see where a partner is registered, how they take money, or how they dial a phone. Nothing here invents a FundHub fact: where the research found something absent, it stays absent and appears in the gaps list, which is long enough to be the more valuable half of this report.

## Format

```
FORMAT: FIXED-DATE COHORT, LIVE, MAX 12 PARTNERS, 12 WEEKS TOTAL — 4 WEEKS OF TEACHING, 8 WEEKS OF SUPERVISED PRODUCTION. NOT SELF-PACED.

THE SHAPE
- Weeks 1-4: two live 90-minute sessions a week. Eight teaching sessions. Cameras on, roll called, discussion required.
- Weeks 5-12: one 45-minute pod call a week, 4-6 partners per pod, reviewing each partner's own numbers against the plan they wrote in week 1. No new content.
- Recordings exist as reference only. Attendance is a gate, not a suggestion. A partner who misses a live session sits it again in the next cohort before their gate clears.
- Everything sits inside 90 days, on purpose.

WHY LIVE COHORT, FROM THE EVIDENCE
Self-paced courses on large marketplaces complete at 3-15%, with a median MOOC completion of 12.6%. Cohort courses in the largest dataset found (about 32,000 courses) complete at 64.2% versus 48.2% self-paced, and inside that same dataset simply turning on discussion moved completion from 42.6% to 65.5%. Peer interaction alone is worth roughly 23 points. A $10,000 self-paced program would, on this evidence, leave most partners unfinished, unqualified and holding a chargeback — and high-ticket coaching is already classified high-risk by payment processors precisely because unmet expectations become "services not as described" disputes. Do not put the widely-circulated "90%+ cohort completion" number anywhere; it traces to self-reported vendor data.

WHY SHORT AND INTENSE, NOT SIX MONTHS
The coaching meta-analysis (Theeboom et al.) found real effects (g = .43 to .74) but found that the NUMBER of sessions did not moderate outcomes. More sessions did not produce better results. So four weeks of teaching, then coaching switches to production review. Do not price or design this on hours of contact.

WHY 90 DAYS IS THE WHOLE CLOCK
Forrester's guidance is blunt: a partner who has not started to market and sell inside the first 90 days of recruitment almost certainly never will. Managed partner programs activate 30-50% of recruits; unmanaged programs fall below 20%. FundHub's own production floor gives a 90-day grace and a first evaluation at day 180 (W1 §6), so the curriculum has to produce a selling partner long before the system starts judging one.

THE ACCOUNTABILITY MECHANISM
Every session ends with a written if-then plan — "when it is 9am Tuesday, I will make X dials from Y list" — not a monthly goal. This is the best-evidenced thing in the whole design: a meta-analysis across 94 independent tests found forming implementation intentions produced a medium-to-large effect on goal attainment (d = .65). It costs nothing to run and it is better evidenced than any format choice.

FOUR HARD GATES, IN ORDER. NO GATE, NO SELLING.

G1 — CAPITAL AND PLAN GATE (end of week 1, before the partner's brand is issued).
Deliverables: a written 90-day budget with a funded lead line; a break-even booked-call count derived from their own assumptions; a state operating map naming every state they will sell into. Justification: undercapitalisation is the single best-documented killer of new brokers — practitioners put the real cost of opening a shop at $25,000-$50,000 in marketing while new entrants arrive with about $2,000. A FundHub partner has just spent $10,000, often financed, so this risk peaks on day one. The franchise literature is also consistent that franchisee prior experience and financial capacity predict performance more than training does — and FundHub's entry no longer filters anyone (financeable to a 405 FICO), so this gate is where selection has to happen instead.

G2 — COMPLIANCE CERTIFICATION (end of week 3, before any public asset goes live).
Written exam, must miss zero. Copies the staff ramp rule that already exists in this repo ("Day 5 files say must miss zero — that rule is in the packs, not invented"). Plus a live check that the three day-1 disclosure placements are actually on the partner's page and that the three locked legal blocks are intact. Plus the signed state operating map from G1 accepted.

G3 — CALL CERTIFICATION (end of week 4, before any live buyer call).
A recorded full mock close, scored by a FundHub closer, never-say list clean. This is a direct copy of the staff closer ramp: 20 checks, then AI drills, then a named person's sit, and live clients only after that person says yes. Certification before live selling is also standard sales-onboarding practice — front-load the repetitions.

G4 — SUPERVISED PRODUCTION RELEASE (weeks 5-12).
FundHub sits on the partner's first live calls or reviews the recordings, and reviews the first ad set before spend. The partner is not released to sell unsupervised until three clients have paid. This is the thing no comparable program does, and it is what the entire complaint record in this market points at.

TWO STANDING CONDITIONS, NOT LESSONS
- Ad-account connection is required and free (W6 Law 2). It is a condition of using FundHub's fulfilment. Treat it as a gate at week 1, not a module.
- FundHub's three machine launch-readiness blockers must be clear before a campaign runs: connection active, platform business verification approved, and for credit-repair campaigns the Consumer Credit File Rights disclosure linked (src/partners/onboarding.mjs).

THE FIRST 30 DAYS
Week 1 — Money math (M1) and the belt (M2). Gate G1 clears. Ad account connected. Brand issued.
Week 2 — Reading a file (M3), the lanes and offers (M4), why repair is not an upsell (M5).
Week 3 — Compliance I (M7) and Compliance II (M8). Gate G2 clears. Landing page live with disclosures verified.
Week 4 — The call (M6), ads and where the machine stops (M9), what you get and what you don't (M10), the stop list (M11). Gate G3 clears. First traffic live, supervised.
Day 30 target: first paid client, on a supervised call.
Day 90 target: ten clients in a month, with the partner's own measured booked-call-to-paid rate on the board.

WHY GATES AND NOT JUST GRADES
Franchise legal commentary is unanimous that courts examine whether the franchisor actually supported the operator before terminating for missing a performance minimum, and expect a real cure path. A bare "ten clients or you're out" rule with no support record is the legally weak version. Every gate above produces a dated record that the support happened. That protects the partner and it protects FundHub.

DELIVERY BUILD NOTE: there is no place in this platform to put any of it. src/education/enrollments.mjs states plainly that a row there is a request to enroll and nothing more — no lessons table, no player, no entitlement check. The nearest working pattern in the repo is the staff ramp: markdown packs with study/learn/test/roleplay boxes plus public/app/ramp-quizzes.js scoring answers client-side. Build the partner version on that pattern rather than buying an LMS.
```

## The thirteen modules

### M1 — Your Money Math (gated)

**Why it exists.** Running out of money before the first commission is the best-documented killer of new brokers. Practitioners put the real cost of opening a shop at $25,000-$50,000 in marketing; new entrants arrive with about $2,000. A FundHub partner has just paid $10,000, often financed, so this risk is at its peak on day one. FundHub also has no measured conversion rate of any kind, so a partner who does not build and track their own numbers has nothing to steer by.

**What it covers.** What FundHub pays and when: half the $3,000 deposit, half the 10% success fee, half of repair, $2,000 once for recruiting another partner, and sub-affiliates paid out of the partner's own half — FundHub's 50% never moves. Payouts are fast and final: no hold-backs, no clawbacks. Then the partner builds their own four numbers: cost per booked call, cost per paid client, cost per funded file, and the break-even booked-call count. Market lead prices ($45 a fresh exclusive lead, $75-$150 a live transfer) and FundHub's own recommended Lead Flow price of $197 per booked call are used as placeholders and labelled out loud as market data, never as FundHub results. Exit: a written 90-day budget with a funded lead line.

*Basis:* docs/specs/W0-decisions.md (50% front and back, $2,000 recruit bonus, no hold-backs or clawbacks); docs/specs/W1-money-model.md (the $120,000 worked example); docs/specs/W6-pricing-menu.md (Lead Flow at $197 per booked call, FundHub's own measured ~$33 per booked call on a thin sample). Failure evidence: deBanked's 'Should I Start an ISO With Only $2,000?' and MCA lead price data.

### M2 — The Belt: what FundHub does after the sale

**Why it exists.** The most common complaint across every comparable program is a buyer who was sold an outcome and got a method. Credit Stacking sits at 2.8 on Trustpilot and C- at BBB largely on this. A partner who promises 'two weeks to funded' is selling something the operation does not do, and FundHub carries the consequence.

**What it covers.** The whole conveyor with its owner-locked clocks: lead, book, show, close on a logged deposit, prep with a 30-day hard stop and about 15 days healthy, three to four funding rounds with about a two-week bank wait each, an inquiry sweep between rounds, funded, then the 10% invoice. The six pipelines and the card-stacking stages. The round events, and the guard that refuses to move a file to funded unless the funded amount is above zero. That the 10% is calculated from the round's funded amount, never from approved applications — using applications produced a silent $0 invoice in the live harness. And the clean line between what the partner does (sell) and what FundHub does (everything else).

*Basis:* docs/workflows/archive/fundhub-conveyor-kpis-2026-08-23.md; db/seed/002_pipelines.sql; src/funding/card-stacking-rounds.mjs; docs/CLOSEOUT-FEE-BASIS.md. Failure evidence: the Credit Stacking and Oz Konar complaint records.

### M3 — Reading a Credit File (the arithmetic)

**Why it exists.** This is the one genuinely hard skill, and it is the biggest gap in every online program under $8,000. CCTG charges $25,500 partly to teach it. A partner who cannot do this arithmetic on a whiteboard cannot price a lead, cannot judge a file, and will promise numbers the engine will not produce.

**What it covers.** Card stacking: the highest open, seasoned (24 months or older) revolving limit, which must be at least $5,000, times 5.5. Loan stacking: the highest seasoned installment amount, at least $10,000, times 3.0, and zero late payments on that bureau or the whole loan side is zero. Business funding: the primary bureau's card figure times 0.5, 1.0 or 2.0 by time in business, which changes the headline by up to four times. The one-bureau penalty — if only one bureau qualifies, the whole personal total is cut to a third. Fundable is a triple gate on the primary bureau: score 700 or above, utilisation 30% or less or unknown, negatives exactly zero. And that a null banner figure means 'no figure available' and must never be shown to a client as $0.

*Basis:* src/underwrite/vendor/underwriter.cjs (all arithmetic taught from the vendored file, not the header comment, which contradicts it); src/underwrite/engine.mjs (the null banner rule and the wall-clock caveat). Competitor gap: CCTG at $25,500 is the only program in the comparison set that teaches underwriting seriously.

### M4 — The Three Lanes and the Six Offers

**Why it exists.** A partner who names the wrong lane sells an offer the buyer cannot pay for, or promises financing that does not exist. Several of FundHub's rules here are counter-intuitive and are exactly the ones people get wrong: no business is required, the deposit counts toward the 10%, and only two products can be financed.

**What it covers.** The six offers with their exact prices and contract keys: soft pull $32, funding deposit $3,000 plus a 10% success fee, repair $1,000, repair trial $200, the UnderwriteIQ pack, and Funding Mastery. The three lanes and their extra gates — 700-749 with under $1,000 cash is not a $3,000 buyer today, and stated negatives means look first even at 700-plus. Only the UnderwriteIQ pack and Funding Mastery may be financed; everything else is cash and the funding deposit never finances. Soft-pull pricing is $32 plus $10 per business. Consent and payment before any pull, with the disclosure wording owned by the server. A typed score is not a bureau score. And the single most-drilled fact, with the worked example: funded $75,000, 10% is $7,500, $3,000 already paid, $4,500 due later.

*Basis:* src/config/offers.mjs; docs/company-resources/closer-funding-education-2026-08-24.md; docs/workflows/fundhub-closer-pack-from-alec-2026-08-24.md; src/finance/soft-pull-pricing.mjs; src/consent/index.mjs.

### M5 — Why Repair Is Not An Upsell

**Why it exists.** The owner's rule is that funding and repair are one ecosystem, always set up together, with no funding-only version. The mechanical reason is in the code, not the marketing, and a partner who does not understand it will read a paused file as FundHub failing and will say so to a client.

**What it covers.** The pause: a negative item makes the primary bureau not fundable, and when a fresh snapshot shows negatives the funding round is held with exactly two exits — fund on the clean bureaus, or sell repair. If any negative cannot be tied to a bureau, no bureau is certified clean. Trial is two rounds and the full program is six, and the full program resumes where the trial stopped. The stage clocks and what breaches each one. Mail is expedited, never overnight, and never UPS or FedEx because bureaus use P.O. boxes. Nothing mails without a person clicking send. The six contract keys required before intake can be left, and that the owner removed the 3-business-day hold on 2026-08-21. The observed / absent / not-visible idea, and why confusing absent with not-visible gets a dispute called frivolous and burns the round. And that a soft pull only unlocks 12 of the 38 dispute checks.

*Basis:* docs/specs/W0-decisions.md; src/crs/snapshot-negatives.mjs; src/repair/sla.mjs; src/repair/croa.mjs; src/repair/safety.mjs; docs/metro2/README.md; docs/metro2/CRS-FIELD-COVERAGE.md.

### M6 — The Call (certified)

**Why it exists.** The partner is the closer. FundHub does everything else. This is the only revenue-producing skill the partner owns and the one that decides whether they reach ten a month. FundHub already has a written closer motion and a staff ramp that ends in a recorded mock and a named person's sit — copy it rather than invent one.

**What it covers.** The call order: read the card and write one sentence naming the likely lane before joining; a two-minute plan-setting open ending 'Sound fair?'; listen for most of the call using seven soft questions in order and never lead with 'do you have $3,000'; name one lane in one sentence; explain one offer in about two minutes then check 'did I miss something?'; ask for the yes; send the matching contract AND the pay link; stay on the call until they pay, set a real next time, or say no. The seven failed beliefs behind every objection and the four-step answer pattern. The written objection bank, including the banned rebuttals it names. The never-say list. And that cash collected is derived from a paid transaction row and can never be typed by the person on the call.

*Basis:* docs/workflows/fundhub-closer-pack-from-alec-2026-08-24.md; docs/company-resources/ramp-closer-2026-08-24.md (20 checks, recorded mock, final sit, must-miss-zero); src/sales/beliefs.mjs; src/sales/call-outcomes.mjs.

### M7 — Compliance I: what you may never say (certified)

**Why it exists.** A partner saying the wrong thing in an ad creates liability for FundHub. Credit Repair Cloud and its founder paid $3 million in CFPB penalties in 2024 on an assisting theory — providing the tools, the templates and the funnel was enough. FundHub does more than provide tools, so the exposure is larger, not smaller.

**What it covers.** The twelve machine-enforced copy rules and the law behind each: no guaranteed score increase, no promise to remove accurate information, no removing lates or collections, no advance fee, no file segregation or CPNs, no guaranteed timeline, no guaranteed approval, no guaranteed funding amount, no fabricated testimonial including the phrase 'results are typical', no income or wealth targeting cue, the Consumer Credit File Rights disclosure must be present, and credit repair is never allowed on TikTok. All twelve are hard blocks; there is no warn. The exact day-1 consumer disclosure — that FundHub, not the partner, provides and performs the services — and its three placements: page footer, booking confirmation above the fold, and the first outbound message on any channel. The three locked legal blocks the partner may not edit and the AI writer may not touch. No earnings claim about the partner program on any public page, ever. And the banned franchise and business-opportunity words on the offer page.

*Basis:* db/migrations/047_compliance_rules.sql; src/compliance/screen.mjs; src/brand/templates.mjs; docs/specs/W4-live-trial.md §9.1; docs/specs/W5-offer-page-funnel.md.

### M8 — Compliance II: what you may never do (certified)

**Why it exists.** The screener only reads ad copy. It cannot see where a partner is registered, how they take money, or how they dial a phone. Two real FTC cases match this program's exact shape: Seed Consulting, which was credit-card stacking sold as funding to pay for a training program ($2.1M judgment), and The Credit Game, which was credit repair sold together with a business opportunity to run your own credit-repair company ($10.9M returned to victims in March 2026). This program is all three elements in one package.

**What it covers.** CROA's advance-fee ban and that there is no exception for a setup, enrollment or onboarding fee. The stricter telemarketing rule when repair is sold by phone, and what it cost Progrexion and Lexington Law — a $2.66 billion redress judgment and $1.8 billion returned to consumers. Georgia, where operating a credit repair organisation for a fee is a misdemeanour, not a paperwork problem. State registration and bonds: Texas $10,000, Florida $10,000, Georgia $50,000. State commercial-financing registration and disclosure across ten states — Utah above five transactions a year, Georgia fines to $100,000 per violation. Phone and text rules at $500 a message and $1,500 if wilful, with ringless voicemail counting as a call. And the FTC's standing notice to money-making-opportunity sellers, now $53,088 per violation. Exit: a signed state operating map naming every state the partner will sell into and what each requires.

*Basis:* External enforcement and statute research (FTC v. Seed Consulting; FTC v. The Credit Game; CFPB v. Progrexion; O.C.G.A. § 16-9-59; state CSO bond schedules; state commercial-financing disclosure laws; TCPA damages; FTC Notice of Penalty Offenses). Repo side: src/repair/croa.mjs and the COMPLIANCE REVIEW REQUIRED fee-timing header on src/config/offers.mjs.

### M9 — Ads, and where the machine stops

**Why it exists.** A partner running their own ad account is outside FundHub's screen entirely. The campaign guard only runs when handed something to check and no production caller hands it anything, so none of the nine Meta targeting rules can fire today. They are written, tested, correct and unreachable. On their own account, the partner is the control — so they have to know the rules by heart rather than trust the machine.

**What it covers.** Meta's special ad category and the nine refusals: no plan at all, an unreadable plan, ZIP or postal targeting, a map radius under 15 miles, location exclusions, any age range other than 18 to 65+, gender narrowing, lookalike audiences including a custom audience that is a lookalike underneath, and detailed-targeting expansion. Every one is a refusal — the system will never quietly widen a radius and spend the partner's money differently than they asked. TikTok plus credit repair is rejected in code before any rule is read. Needs-approval is not a pass and nothing reaches a platform in that state. The screener fails closed on any error and has no override, no force flag and no skip option. The three launch-readiness blockers FundHub can raise: connection not active, platform business verification not approved, and the CROA disclosure not linked. And the required, free ad-account connection that is a condition of using FundHub's fulfilment.

*Basis:* docs/compliance/creative-block-reasons.md; src/compliance/screen.mjs; src/partners/onboarding.mjs (checkLaunchReadiness); docs/specs/W6-pricing-menu.md Law 2.

### M10 — What you actually get, and what you don't

**Why it exists.** High-ticket coaching is classified as high-risk by payment processors because unmet expectations turn into 'not as described' chargebacks. Every bad review in the comparable set is somebody who expected an outcome or a system and got less. Saying this plainly and in writing, before the first client, is a control, not a downer — and it is the difference between a partner who is disappointed and a partner who disputes the charge.

**What it covers.** The four screens a partner can open: Home, Brand Studio, Social Studio, Creative Factory. That they are blocked from the CRM entirely and cannot see or move a single client file, pipeline card, contract, payment link or lender match. The one money read they get — a lifetime accrued and paid balance with no date dimension. That six production tiles were deleted from the partner home screen because no partner-readable source exists for any of them, including cash collected today and funded today. That the marketing suite is off per partner by default and only the owner can turn it on. The 250,000-token monthly creative cap. And an honest statement of the 2026-08-27 end-to-end walk result, so the first cohort is not surprised by it.

*Basis:* public/app/shell.js (ROLE_TABS.partner); docs/journeys/white-label-actual.md (146 of 202 routes blocked); public/app/partner-galaxy.html (the deleted KPI strip and why); api/read/partners.mjs; docs/journeys/white-label-intended.md; docs/workflows/full-e2e-audit-2026-08-27.md.

### M11 — The Stop List

**Why it exists.** The repo tells staff to stop and ask a manager on a long list of questions, and several of those answers do not exist anywhere in the system. A partner with no escalation path will invent an answer. Inventing an answer about refunds, timelines or credit outcomes is exactly how a compliance violation gets created, and it happens on the phone where no screener can see it.

**What it covers.** The questions a partner must never answer on their own: refunds on any offer; who the lender of record is; how long funding takes; whether a score will move; whether a bad mark will come off; what a client will be approved for; whether repair can be financed; what happens if the 10% works out to less than the deposit already paid; anything about a chargeback; anything about a client's own state rules; and any earnings question about the partner program itself. The holding lines that ARE permitted, said exactly: 'lenders decide, we help you apply on a plan', 'I cannot promise a lender will say yes', 'I cannot promise the score will move', 'we cannot finance the $3,000'. And the escalation route — which does not exist yet and is listed as a build item.

*Basis:* docs/workflows/fundhub-closer-pack-from-alec-2026-08-24.md (never-say card and 'stop and ask a manager'); docs/company-resources/closer-funding-education-2026-08-24.md (the 95/5 collection figure marked UNVERIFIED, with an explicit ban on inventing a collections script); docs/specs/W1-money-model.md O5 (refund window open); docs/company-resources/ramp-closer-2026-08-24.md.

### M12 — Your Numbers and the Floor

**Why it exists.** The owner's bar is ten clients a month and below it the partnership ends. Industry guidance treats five to eight funded deals a month as a strong, established broker — the level at which you start hiring — so this is a top-decile number being asked of a beginner in month one. Setting an activity minimum without tying it to conversion data produces more dials and no more deals, and in a regulated product, gaming an activity minimum is how violations get made.

**What it covers.** The floor mechanism as it stands: a rolling 90-day window, a 90-day grace after activation, the first evaluation at day 180, evaluated on the 1st of each month, and the ladder — warning, then final notice with a 30-day cure, then a downgrade to 20% on new business, then restoration after one full window at or above the bar. That past accruals never restate because the rate is frozen on every row at the moment it is written. Then the working part: taking ten backwards into a booked-call target using the partner's OWN measured rates, because FundHub has none to give them. And writing an if-then plan for every prospecting block rather than a monthly goal.

*Basis:* docs/specs/W0-decisions.md (10 clients a month, client count not dollars); docs/specs/W1-money-model.md §6 (window, grace, ladder, frozen rate). Evidence: Gollwitzer and Sheeran's implementation-intentions meta-analysis (d = .65 across 94 tests); MCA broker production guidance (6-8 funded deals a month before hiring); franchise minimum-performance case law on support records and cure periods.

### M13 — First Three (supervised production)

**Why it exists.** This is the module every comparable program is missing, and it is the reason they get bad reviews. Every complaint pattern in the market is a person who finished the videos and never did a deal — Credit Stacking's reviewers specifically note there are no real-world student success examples. Channel data says a partner who has not started selling inside 90 days almost never will. So the program owns the first deal instead of hoping for it.

**What it covers.** Weeks 5 to 12. A FundHub closer sits on the partner's first live calls or reviews the recordings, and reviews the first ad set before any spend. The partner is not released to sell unsupervised until three clients have paid. A weekly 45-minute pod call of four to six partners reviewing their own numbers against the plan they wrote in week 1 — no new content, just what happened and what changes. And a dated support record for every one of those touches, which is what makes the ten-a-month rule enforceable rather than just written down.

*Basis:* Forrester's 90-day activation guidance; channel activation data (managed programs activate 30-50% of recruits versus under 20% unmanaged; fewer than 30% of registered partners ever transact); Credit Stacking and Oz Konar complaint records; docs/company-resources/ramp-closer-2026-08-24.md (the graduation-gate pattern this copies).

---

## Gaps — things a partner must know that FundHub has not documented

This list is the more valuable half of the research. Each one is a build item, and
several block the program from being sold at all.

- WHAT COUNTS AS A CLIENT. W0 sets the production floor at 10 clients a month. W1 §6 measures dollars — the sum of partner_revenue.gross_amount. Nothing anywhere says whether a $32 soft pull, a $200 trial and a $3,000 deposit each count as one client. The bar that ends a partnership has no definition.

- THE FLOOR CANNOT BE COMPUTED TODAY. W1 §6's measurement reads partner_revenue, and the only INSERT INTO partner_revenue in the whole repo is a test fixture. The threshold unit also changed to client count with no matching query written. So the entire quality control on the partner base is currently unmeasurable.

- NO PARTNER AGREEMENT TEMPLATE EXISTS. A partner_license subtype exists in the taxonomy and the payout gate depends on agreement_signed_at being stamped, but no PARTNER-LICENSE row is seeded in db/seed or db/migrations. The document that makes someone a partner is not in the system.

- REFUND POLICY IS UNWRITTEN AT EVERY LEVEL. The $10,000 window is recorded as 'short, 3 days pending the exact figure'. There is no written refund rule for the $3,000 deposit, the $200 trial or the $1,000 repair — the closer instruction is 'stop and ask a manager'. A partner will be asked this on their first call.

- LENDER OF RECORD IS UNVERIFIED. Staff are told not to say FundHub is the lender AND not to say FundHub is not the lender of record. The only permitted line is 'lenders decide.' A partner selling under their own brand inherits the ambiguity with no answer to 'so who am I borrowing from?'

- NO CONVERSION OR FUND RATE EXISTS. W1 records it explicitly: what percentage of deposits ever reach a funded round is unknown, and the absence is the finding. There are zero measured partners and no ad-spend-to-client figure. So no funnel model, no lead budget and no ROI statement can be built from FundHub data — only from market placeholders that must be labelled as such.

- NO PARTNER SUPPORT OR ESCALATION PATH IS DOCUMENTED. No named seat, no SLA, no channel. Partners cannot open a task at all — createTask throws on a partner assignee by design and /api/tasks is staff-only. The only partner-visible surface is partner_onboarding_tasks, which is written only by campaign launch-readiness checks. Every staff ramp doc names an escalation target; the partner has none.

- THERE IS NO COURSE DELIVERY SYSTEM. src/education/enrollments.mjs is enrollment requests only and its header forbids implying otherwise: no lessons table, no player, no entitlement check anywhere in db/. The $10,000 curriculum has nowhere in this platform to live.

- NO PARTNER RAMP PACK, QUIZ SET OR GRADUATION GATE EXISTS. Four complete 5-day, 20-check staff ramp packs exist with per-day quizzes, trainer keys, a recorded mock and a named final sit, plus a client-side scorer. There is no partner equivalent of any of it.

- THE LENDER DATABASE SHIPS EMPTY. Decision 4 of the lender build was no seed rows — real data comes from the spreadsheet by owner or funding advisor. A partner cannot learn which lenders, in what order, or with what requirements, from this system.

- THE REPAIR CONTRACT CONTRADICTS THE PRICE. offers.mjs prices REPAIR_DFY at $1,000 once, but the seeded CREDIT-REPAIR-AGREEMENT body reads 'You pay {{field.monthly_fee}} per month while services are active' and offers.mjs fills monthly_fee with the $1,000 price and term_days with 180. A client signing it is agreeing to $1,000 a month for 180 days. REPAIR-AND-FUNDING-AGREEMENT has the same ambiguity. A human must decide this before any partner sends either.

- CROA FEE TIMING IS UNADDRESSED AGAINST THE PRODUCT AS SOLD. Repair is charged up front ($200 and $1,000) and the 3-business-day hold was removed by the owner on 2026-08-21. Whether that sits with CROA's advance-fee ban, and with the stricter Telemarketing Sales Rule timing when repair is sold by phone, is not written down anywhere in the repo. Recorded as a documented gap, per the COMPLIANCE REVIEW REQUIRED marker already on those files.

- NO STATE OPERATING MAP EXISTS. Nothing in the repo lists which states a partner may sell credit repair in, or what registration or bond each state requires. Georgia makes operating a credit repair organisation for a fee a misdemeanour. Texas, Florida and Georgia require registration and bonds. Ten states have commercial-financing disclosure regimes. A partner needs this map on day one and it does not exist.

- THE PROGRAM'S OWN LEGAL CHARACTERISATION IS UNADDRESSED. W5 bans franchise and business-opportunity WORDS at the copy level, but no document addresses whether the structure — a brand licence plus a mandated method plus a $10,000 fee plus a production minimum plus parent-run fulfilment — is itself a franchise or a business opportunity under the FTC rules. Naming it is a build item.

- W6 PROMISES A PORTAL THE PARTNER DOES NOT HAVE. W6's included list says the base $10,000 buys 'Their portal — Brand Studio, CRM, partner screens'. A partner can open four screens and is blocked from the entire CRM. W0's own open item says the deliverable list must be real before it is published. It is not real yet.

- THE ADD-ON PRICES ARE NOT OWNER-SET. W6 marks $497, $2,497 and $197 per booked call as recommendations, explicitly not owner decisions. A partner cannot be quoted a menu price today.

- A PARTNER ADD-ON CANNOT BE RECORDED AT ALL. subscriptions.client_id is NOT NULL REFERENCES clients(id) and entitlements are client-scoped. A partner is not a client, so no monthly add-on can be sold until that is resolved. W6 names it as the blocker.

- AFFILIATE BACK-END EARNING IS DECIDED BUT NOT LIVE. W0 closes it as yes — affiliates earn on the 10% success fee. Migrations 260/261 still use a deposit_collected basis, so they earn nothing on the success fee today. A partner's downline math is not what the system currently pays.

- THE MANDATORY AD-ACCOUNT CONNECTION HAS NO PROCEDURE OR ENFORCEMENT. W6 Law 2 makes it required and free and a condition of fulfilment, but nothing documents how a partner connects it and nothing gates fulfilment on it being connected.

- THE MACHINE SCREEN DOES NOT REACH A PARTNER'S OWN AD ACCOUNT. The campaign guard only runs when handed something to check and neither caller hands it anything; nothing creates a campaign or ad set in production. Because the nine Meta targeting rules fire from inside ad-set creation, none of them can fire today. A partner running their own Meta account is outside the screen entirely.

- DAY ONE DOES NOT WORK YET. The end-to-end white-label walk on 2026-08-27 failed: no pipeline card created, CRM search cannot find partners, Partner Home told a real signed-in partner 'No partners on file', zero welcome email and zero SMS delivered, zero events fired, and the page promising a human review had already set status=active and issued a login. There is no documented working first-day experience to train against.

- THE MONEY SPINE WAS NOT LAUNCH-READY. As of 2026-08-21 deposits failed to save with a Postgres 23502, no real card had ever been charged or refunded, and credit pulls were sandbox only. Re-verify before teaching any payment step as current.

- FOUR OF FIVE SOPs DO NOT EXIST. docs/sops/README.md indexes manual SMS, manual email, manual call and booking follow-up, manual dispute letters and a daily handoff checklist. Only the README and the SMS SOP are present, and that one has UNKNOWN where the console URL should be.

- THE UNDERWRITING HEADER CONTRADICTS THE VENDORED ENGINE. src/underwrite/engine.mjs's header says the engine collapses unknown to zero; the vendored underwriter.cjs now preserves nulls via measuredCount, measuredPct and inquirySlot. Only 'score ?? 0' still matches. Teaching material must be built from the vendored file, and someone must resolve which side moved.

- NOTHING SAYS WHAT HAPPENS TO A PARTNER'S BOOK WHEN THE PARTNERSHIP ENDS. The share downgrade to 20% is defined. Who services their existing clients, and whether they keep back-end revenue on files already funded, is not written anywhere.

---

## What is genuinely uncertain

WHAT IS GENUINELY UNCERTAIN.

The ten-clients-a-month bar has no measured basis anywhere and cannot currently be measured by the system. Market guidance puts five to eight funded deals a month at established, hiring-level broker output. So the bar may be right as a filter and wrong as a target, and until FundHub has one measured partner nobody knows which. The curriculum is built to reach it; it does not assume it is reachable.

No published data anywhere measures deals closed by delivery format. Every statistic that exists measures course completion. So the cohort recommendation is well-evidenced for finishing the program and unevidenced for producing revenue. Anyone who claims that correlation is guessing, including the vendors selling cohort platforms.

Several widely-quoted benchmarks used in the surrounding research could not be verified and are not load-bearing here: the '90%+ cohort completion' figure (self-reported vendor data), the 'over 70% of partners never transact' figure (repeated everywhere, original research not located), the Forrester 2025 channel numbers of 87 versus 52 days (report not locatable), and the '82% higher retention' franchise onboarding stats (vendor blog, no citation). The '91% of new brokers quit in year one' number is about M&A business brokers, not loan brokers, and should never be used.

The repo's own documents disagree by date. W0 and W6 are both owner-set 2026-08-31 and win over W1 through W5. The launch-readiness blockers are dated 2026-08-21 and the failed end-to-end walk 2026-08-27; both may be partly fixed by now. Re-verify any operational failure before teaching it as current, particularly the deposit save error and the sandbox credit pulls.

Most of the richest teaching sources are staff ramp documents carrying a BETA / DRAFT banner and a COMPLIANCE REVIEW REQUIRED header, and several of their figures are recorded as owner-said or as a model rather than measured — including the desk-time model, the pod bars, and the 95/5 payment rate. They are the clearest statement of intent in the repo and they are not approved material.

The legal content in M8 is research, not an opinion on this program. I have not seen the partner contract, the fee schedule, or which states partners will operate in. Georgia's criminal credit-repair statute and the franchise-versus-licence question are the two places where the gap between fine and serious is widest and the facts matter most; both are named as build items in the gaps list, with no recommendation attached.

I did no live verification: no tests run, no database opened, no live behaviour checked. Read-only.
