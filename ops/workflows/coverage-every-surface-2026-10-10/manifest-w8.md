# W8 manifest: whole trips (L4)

Batch board: `ops/workflows/coverage-every-surface-2026-10-10.md` (not edited by this workflow).
Branch: `cov/w8-trips`. Work folder: `.claude/worktrees/cov-w8`. Built 2026-10-10 on `main` at `dbac95319`.
Nothing was pushed. Nothing was merged. Local commits only. I fixed no product bug.

## In one minute

- I built **5 trip checks**, one lane each. A trip check follows every customer who started a trip in the last 60 days, from the first step to the last, and **names the first step that is missing**.
- They share one small walker: `src/pulse/coverage/trip-kit.mjs`.
- A customer who is waiting on a person, or on themselves, is **counted, never red**. A step goes red only when the company owes it and its wait is over, or when a clock the code already has says it is overdue.
- Every wait is a number another lane already uses. I invented none. Each step says where its number comes from.
- On live data today: **1 red** (`trip:repair`, one real file, see below), **1 green with six partners waiting** (`trip:partner`), and **3 green lines that say nobody started** (`trip:funding`, `trip:inquiry`, `trip:roadmap`).
- The brief said to use the steps in `docs/journeys/*-intended.md`. Those files hold the **route access lists**, not trip steps. No trip steps are written there. I used the step lists in the brief and traced each step to the code that makes it. Nothing was invented beyond the brief's own words.

## The five checks

Scorecard ids carry the lane in front, for example `gap-trip-funding:trip:funding`.

| Check id | Who is followed | The steps (who owes each) | Red when |
|---|---|---|---|
| `trip:funding` | A client who paid the diagnostic, paid a funding deposit, or has a round, started in the last 60 days | diagnostic paid (client), Sales card (system), booked (client), call held (person), deposit paid (client), Funding card at Apply Now (system), round opened (system), sent to banks (person), a bank yes with an amount (person), funded (person), closeout (system), success-fee bill (system), staff commission rows (system) | the Sales card is not at Diagnostic Paid 1 hour after paying; no Funding card 1 hour after the deposit; no round 15 minutes after the card; no closeout, bill or commission 30 minutes after funded; the card says Funded and no round is funded; a round is funded with no bank yes that carries an amount (unless every yes was marked "does not count") |
| `trip:repair` | A client who bought a repair plan (sale or paid repair link) or has a repair program, started in the last 60 days | repair purchase (client), program opened (system), ID read and accepted (client), round 1 letters made (system), letters mailed (person), bureau answer read and confirmed (client), round 1 complete (system) | no program 1 hour after the purchase; no letters 1 hour after the last of the ID read, the credit file and the signed agreement; no Round Complete 15 minutes after the answer was confirmed; the file is past the desk's own stage clock (`src/repair/sla.mjs`) or in Stalled; a letter was made after 2026-09-06 with no ID read |
| `trip:inquiry` | A client with an inquiry case, or a `deposit.paid` event, started in the last 60 days | gate ran (system), one case per bureau (system), draft letter on each case (system), bureau call fired (person), every case completed (person), `inquiry.removed` fired (system), funding ready for the next round (system) | no case or gate event 15 minutes after a deposit; a bureau the gate raised has no case; a gate case has no draft letter; a case is idle 72 hours or a call came due and the sweeper did not fire it (gap-inquiry's clocks); all cases completed and no `inquiry.removed`; the client bought funding and funding was not marked ready |
| `trip:partner` | Every affiliate and every white-label partner who applied in the last 60 days (test rows left out) | applied, approved, page published and live, referral clicked, referral converted, commission, payout paid (two ladders, below) | no referral code; a click credited to nobody; a paid referred client and the referral never converted; a converted referral with no commission number; an active partner with no published page, or a page that does not answer 200; a partner's client paid on a shared product and no accrual row; a payout held over a day or stuck over a week; commission payable under the monthly rules and on no run |
| `trip:roadmap` | A buyer whose $297 roadmap link was paid in the last 60 days | paid (client), pull form filled (client), pack saved whole and pack-ready email queued (system), signed in to the portal (client) | form empty 2 hours with no reminder; no pack 2 hours after the pull finished (or was due to); a saved pack is not whole or has no email; access held 72 hours with no sign-in |

### The partner ladders (the brief's seven steps, worded for what each kind really has)

| Step | Affiliate | White-label partner |
|---|---|---|
| applies | the `affiliates` row | the `partners` row |
| approved | status active (self-signup) | status active (a person approves) |
| page published and live | the referral link has a code | a published page that answers 200 at `/sites/<partner>/<slug>` (GET only) |
| referral clicked | a click credited to the affiliate | a lead owned by the partner |
| referral converted | a referral marked converted | an owned lead paid for a product the partner shares in |
| commission | the converted referral has a commission number | a `partner_revenue` row |
| payout paid | a payout with status paid | a partner payout with status paid |

## Reuse (the brief said "reuse the W1, W2 and W3 check functions")

| Reused | From | Used for |
|---|---|---|
| `roundProblems`, `FUNDED_BILL_WAIT_MS`, `LOOKBACK_MS`, `CARD_STACKING` | W1 `gap-money-funding.mjs` | the funded steps (closeout, bill, commission): the trip and `funding:funded-no-bill` can never disagree; the 60 day window; the 30 minute wait |
| `PAID_GRACE_MS`, `SETTLE_GRACE_MS` | W3 `gap-pipeline-facts.mjs` | the paid-to-card wait (1 hour) and the event wait (15 minutes) |
| `getOffer` / checkout facts | W2 | **not reused.** W2's checks read checkout links (links and doors). The trips read what the money chain wrote after the payment, so there was nothing to share. I read the paid link itself for the repair purchase and the roadmap. |
| `readPage`, `pickPages`, `PAGE_CAP` | W5 `gap-partner-pages.mjs` | the live read of a published partner page |
| `money-reads.mjs` helpers | W2 | `row`, `plural`, `ageOf`, `readRows`, `runnerOf`, `nowOf` |
| `STAGE_SLA`, `isBreached` | `src/repair/sla.mjs` | the repair stage clocks (the same ones the desk and `repair-case-stuck` read) |
| `CALL_GRACE_MS`, `STUCK_AFTER_MS`, `LETTER_STATUSES`, `GATE_SOURCE` | `gap-inquiry.mjs` | the inquiry stuck clocks |
| `judgePackFiles`, `judgePackEmail`, `GRACE_MS` | `gap-underwrite.mjs` | "pack saved whole" and "buyer was told" |
| `PAID_FORM_HOURS`, `NUDGE_KEYS`, `NUDGE_DEAD_STATUSES` | `gap-soft-pull.mjs` | the reminder owed to a buyer with an empty form |
| `SIGN_IN_GRACE` | `gap-portal.mjs` | the 72 hour portal wait |
| `DEAD_LINK_WINDOW_MS`, `PAYOUT_STUCK_AFTER_MS` | `gap-partners.mjs` | the partner click and payout clocks |
| `qualifyingOutcome` rules (product codes) | `src/affiliates/economics.mjs` | which paid referrals must convert |
| `PARTNER_SHARE_PRODUCT_CODES` | `src/partners/revenue.mjs` | which payments must accrue to a partner |

Tests pin every borrowed number to its source (for example `FUNDED_BILL_WAIT_MS` is 30 minutes, `GRACE_MS` is 2 hours).

## Honest limits (plain words)

1. **A person step is never red from waiting alone.** The code has no clock for "the call was held and logged", "round sent to the banks", "a bank said yes", "letters mailed after the desk's clock", or "the customer filled the form" except where I named one above. Those customers are counted by step in the green line. If Chris wants a limit, it is one named number per trip (a stage limit, like the Pipelines one W3 left off).
2. **Funding follows the newest round only.** An older round is read by `funding:funded-no-bill`.
3. **A deposit with no sale row is not on the funding trip.** That is `payments:paid-no-entitlement`.
4. **A client with no `client_id` on their events is invisible to the inquiry gate step.** Most live `deposit.paid` events have no client id (the email is in the payload). The gate step needs it, so it can only judge clients whose event was linked. This leaves a customer unseen, never a false red.
5. **The partner ladders are two ladders.** The brief's seven steps mix affiliate words (click, referral) and white-label words (page). I kept the brief's keys and order and worded each for what the kind has. A white-label partner has no click table; a lead owned by the partner stands in for it.
6. **Test partners.** Live holds about 18 sim, e2e and test affiliates and partners that nobody flagged `is_demo`. The lane leaves a payee out when its name or contact address looks like a test run, or when it has no contact address at all (`TEST_PAYEE_NAME_RE`, `TEST_PAYEE_EMAIL_RE`). Those patterns are mine. They come from the shapes in live today.
7. **"Page live" for a partner is a GET of `/sites/<partner>/<slug>`, one per active partner with a page, at most 60 a morning.** With no web client in the run, the row says the pages were not opened.
8. **An empty trip is a plain green line, not "nothing to judge".** See "What went wrong once" below.

## What went wrong once (and is fixed)

My first version said "nothing to judge" (code `low-traffic`) for an empty trip, like W2 does. `npm run pulse:prove` then failed: the audit re-checks every "nothing to judge" row **together inside 2.5 seconds**, and three more rows pushed about 50 workflow rows past the deadline (they read "not true any more"). I made the re-check one cheap read, then one shared read, and it was still borderline on a laptop where each read costs three round trips. So an empty trip is now green with plain words ("Nobody started the funding trip in the last 60 days, so nobody is stuck"). That costs the audit nothing. Written up in `docs/lessons/pulse-lessons.md`.

## Live reds found (real breaks, plain words)

1. **`trip:repair` is RED today: one real file, FH-000507, has sat in Analysis since 2026-10-05.** The letter engine is waiting on a signed repair agreement or a live dispute authorization, and none is on file (the ID is read, a credit file exists, the program is open). The file paid a repair link on 2026-09-17 and has no sale row. It is the same file `pipeline:age`, `repair-letter-round` and `fulfillment:next-action` already name (W3 card). The owner's standing note on this file is no outreach. I did not touch it.

Nothing else is red from these checks. `trip:partner` reads green: 6 partners (5 real affiliates and one invited white-label applicant), 0 finished, 6 waiting.

## Found, not fixed (one line each)

- About 18 sim, e2e and test affiliates and partners sit in the live books with `is_demo = false` (names like `Sim Aff Deep`, `E2E WL Click Co`, `t10affstats-alpha`, `principalread Alpha`). The trip leaves them out by pattern; flagging them is a cleanup for a person.
- FH-000507 paid a repair link and the money chain made no `sales` row for it. The trip reads the paid link as the purchase.
- One affiliate referral on live is `converted` with no commission number (`commission_due` is null). It belongs to a test affiliate (`t10affstats-payee`), so the trip leaves it out. The same shape on a real affiliate goes red.
- `src/marketing/filmed-receive.mjs(159,75)` has a TypeScript error on `npx tsc --noEmit`. Not my file. Same on `main`.
- The whole-morning step of `npm run pulse:prove` reads 23 to 34 seconds on `main` itself when other builders are running tests on this machine (limit 20). It read 13.7 seconds on this branch in a quiet run. It is the live-site pings, not the lanes. Not caused by this change.

## Choices Chris can overrule (each is a named constant)

| Choice | Value | Where it is |
|---|---|---|
| How far back a trip is followed | 60 days from its start | `WINDOW_MS` = `LOOKBACK_MS` (W1's number), in each lane |
| Who is a "started" funding client | paid the diagnostic, or a funding-category sale, or a round | `TRIP_SQL` in `gap-trip-funding.mjs` |
| The day letters were gated on a verified name | 2026-09-06 | `IDENTITY_GATE_FROM` in `gap-trip-repair.mjs` |
| The pull is due this long after the form | 15 + 15 minutes | `PULL_DUE_MS` in `gap-trip-roadmap.mjs` (gap-soft-pull's own two clocks) |
| What ends a trip (not red) | Sales card Lost, call "not a fit" or "downsell" with no deposit, repair card Cancelled, a gate that found nothing, a fraud alert (funding held on purpose), a paused partner or affiliate | `toTripRow` in each lane |

## Files

New:
- `src/pulse/coverage/trip-kit.mjs` and `trip-kit.test.mjs` (the walker, the verdict, the words)
- `src/pulse/coverage/trip-test-kit.mjs` (test helper: shadow tables pinned to the real columns; not a test, not a lane)
- `src/pulse/coverage/gap-trip-funding.mjs`, `gap-trip-repair.mjs`, `gap-trip-inquiry.mjs`, `gap-trip-partner.mjs`, `gap-trip-roadmap.mjs`, each with `.test.mjs` and `.pg.test.mjs`
- this manifest

Changed (shared lists, only my own lines):
- `src/pulse/coverage/modules.mjs`: 5 literal lines, in name order after `gap-training.mjs`.
- `src/pulse/tripwires.mjs`: 15 new entries at the end of `TRIPWIRES`, and the trip id added to 5 entries that already existed (`route:pipeline-cards`, `page:roadmap/pull.html`, `job:slo-pack-delivery`, `job:slo-paid-form-nudge`, `route:read/affiliates`).
- `src/pulse/tripwires-baseline.json`: 15 lines removed (420 to 405).
- `src/pulse/tripwires.test.mjs`: `BASELINE_MAX` 420 to 405.
- `docs/journeys/heartbeat-flow.md` (a "Whole trips" section), `docs/journeys/CHANGELOG.md` (one line), `docs/lessons/pulse-lessons.md` (one entry).

Not changed: `na-conditions.mjs` and its test (no new code; the final design needs none), `self-audit.mjs` (each lane exports `CHECK_IDS`, which the audit builds its list from), `beats/index.mjs`, the board, any product code, any migration, any workflow, any existing test.

## Surfaces sorted out of the baseline (15)

Each one is a handler, door or job whose break turns a trip red.

| Surface | Impact | Checks that go red on its break |
|---|---|---|
| `job:f-07-funding-locked` | money | `trip:funding`, `funding:funded-no-bill` |
| `job:affiliate-payout-run` | money | `trip:partner`, `partners:commission-payable`, `partners:payout-stuck` |
| `job:doc-check` | customer | `trip:repair`, `documents:stuck-processing` |
| `job:doc-check-retry-sweeper` | customer | `trip:repair`, `documents:stuck-processing` |
| `job:repair-bureau-response-reader` | customer | `trip:repair`, `repair-case-stuck` |
| `route:repair/enroll` | customer | `trip:repair` |
| `route:repair/generate` | customer | `trip:repair`, `repair-letter-round` |
| `route:repair/send` | customer | `trip:repair`, `repair-case-stuck` |
| `route:repair/inbound-mail` | customer | `trip:repair`, `repair-case-stuck` |
| `job:c-03-inquiry-removed-resume-or-hold` | customer | `trip:inquiry` |
| `job:inquiry-call-sweeper` | customer | `trip:inquiry`, `inquiry:case-stuck` |
| `route:inquiries` | customer | `trip:inquiry` |
| `route:inquiry` | customer | `trip:inquiry`, `inquiry:case-stuck` |
| `route:partners/approve` | customer | `trip:partner`, `partner-pages:live` |
| `route:public/affiliate-click` | customer | `trip:partner`, `partners:referral-link` |

`trip:roadmap` has no new baseline surface: every roadmap door and job was already sorted by an earlier wave. The trip id was added to three of them.

Not sorted, on purpose: `route:call-outcomes`, `route:read/funding-rounds`, `job:f-01-funding-intake`, `job:f-03-round-submitted`, `job:f-04-round-approvals`, `job:s-portal-invite` (retired, it does nothing), `job:c-02b-inquiry-removal-requested`. A break in one of them does not turn a trip red (the trip reads a waiting step there, or does not read that fact), so naming the trip would be a false claim.

## Proof

All run in this folder, 2026-10-10. Live reads were read only (`BEGIN READ ONLY`), GET only on the web, nothing written, sent or charged.

| What | Result |
|---|---|
| Unit tests, `trip-kit` + 5 lanes | **178 tests, 178 pass** (trip-kit 30, funding 36, repair 30, inquiry 24, partner 34, roadmap 24) |
| Real-Postgres tests, shadow tables on live, read only | **89 of 89 pass** (funding 16, repair 15, inquiry 16, partner 26, roadmap 16). RED and GREEN for every check. Every shadow table selects its columns from the real table, so a column that is not on the schema fails. |
| All pulse tests, `src/pulse/**` plus the fence and the daily-pulse workflow | 3,519 tests, 3,293 pass, 0 fail, 226 skipped (the `.pg.test.mjs` files with no database) |
| `src/lib/no-unfenced-transmit.test.mjs` | passes. The partner lane makes no raw call: it hands the web client to W5's `readPage`. |
| `npm run lint` | 3,286 files parse clean |
| `npx tsc --noEmit` | 1 error, in `src/marketing/filmed-receive.mjs`, not my file, same on `main` |
| `npm run pulse:prove` (built bundle, live data, read only) | see below |

`npm run pulse:prove`, last run (quiet machine): **`OK: every listed file is in the bundle, no step threw or passed 20 s, no SQL error, nothing tried to write.`** 66 steps. The five lanes ran in under a second each (the slowest step in the whole run was the older `gap-finance-os` at 11.1 s). `audit:expected-present`: all 1,077 checks showed up (1,072 before this change). `audit:lanes-ran`: all 63 lanes answered (58 before). `audit:na-verified`: all 65 "nothing to judge" rows still true (the same 65 as `main`). `audit:totals` adds up. The whole morning read 13.7 s. I did not add a beat, so `pulse:prove -- --beats` was not needed.

The proof ran seven times. Runs 1 to 5 failed `audit:na-verified` for the reason in "What went wrong once". Run 6 passed everything but the whole-morning time (29.6 s, other builders were running tests; `main` read 23.4 s and 34.1 s the same hour). Run 7 is the clean one.

## Heartbeat law, item by item

1. Ping row: no new page, route, job or send path was added, so no new ping row.
2. Tripwire: the five trip checks are the tripwires, each on the literal list (`modules.mjs`).
3. Tripwire map: 15 surfaces sorted (above).
4. Under the clock: each lane is its own step; the slowest read is under 1 second live.
5. Read only: one SELECT per lane (two for the partner lane) and GET only on pages.
6. Honest status: a read that cannot happen is a `skip` with the reason (tested).
7. Tests both ways: every lane has RED and GREEN unit tests and RED and GREEN real-Postgres tests.
8. Prove from the bundle: done (above).
9. No hourly beat: the brief asked for daily lanes, and no new money surface was built.

## Left undone

- **Not pushed, not merged, no pull request.** The integrator merges.
- The board file and its task table were not edited (the override said so).
- **No hourly beat.** A stuck trip is read once at 6 a.m. If Chris wants an hourly watch, `trip:funding` (bill after funded) and `trip:partner` (payable commission) are the two to start with.
- A written clock for the person steps (limit 1 above).
- `docs/journeys/*-actual.md` were not touched: no product journey changed. Only the heartbeat flow and the changelog.

## For the integrator (merge notes)

- Shared lines: `modules.mjs` (5 lines, after `gap-training.mjs`), `tripwires.mjs` (a block at the end of `TRIPWIRES` plus a trip id on 5 existing lines), `tripwires-baseline.json` (15 removals), `tripwires.test.mjs` (`BASELINE_MAX`).
- **`BASELINE_MAX`:** I set 405 (420 minus my 15). After every wave merges, set it to the real length of `tripwires-baseline.json`. It must never go up.
- `trip-test-kit.mjs` is a test helper. Its name does not start with `gap-` or `slice-`, so `modules.test.mjs` does not ask for it.
