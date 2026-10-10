# W3 Pipelines truth — manifest

Batch board: `ops/workflows/coverage-every-surface-2026-10-10.md` (not edited by this workflow).
Branch: `cov/w3-pipelines`. Work folder: `.claude/worktrees/cov-w3`. Built on `main` at `7bad44211`.
Nothing pushed. Nothing merged. Local commit only. The integrator merges.

## In plain words

Seven new checks. Each one reads the data and goes red when a card on a board is wrong.
None of them fixes anything. None of them writes, texts, emails or calls out.
They run in the 6 a.m. pulse, in two new lanes, each in its own step.

| Check id | The question | Today on live data |
|---|---|---|
| `pipeline:count-true` (P1) | Does every column show as many cards as the database holds? | green: 26 cards on 8 boards, all shown |
| `pipeline:age` (P3) | Is any card past a written stage time limit? | **RED: 1 Repair card in Analysis for 5 days (limit 1 hour)** |
| `pipeline:age-no-limit` (P3) | Which boards have no written limit? | nothing to judge, said out loud and re-checked each day (7 boards) |
| `pipeline:dead-stage` (P5) | Did a card land on a stage no code moves a card to? | nothing to judge: 30 stages, 0 cards, re-checked each day |
| `pipeline:nobody-lost` (P6) | Is any paying client on no board, any archived client who paid, any card off its board? | green |
| `pipeline:stage-vs-fact` (P2) | Is each card in the stage the facts say? | green |
| `pipeline:move-receipt` (P4) | Did each Funding card move in the last day fire its event, and did the result land? | green: no Funding card moved in the last day |
| `pipeline:two-records` (P7) | Do the two records that hold one fact agree? | green |

The book is small today (26 cards, 0 Funding cards, 0 repair cases, 0 inquiry cases), so most of these are green because there is nothing to be wrong.
They are proved both ways in tests with fake rows. They go red when the rows are wrong.

## Files

New:
- `src/pulse/coverage/gap-pipeline-boards.mjs` and `gap-pipeline-boards.test.mjs` (27 tests): P1, P3, P5, P6.
- `src/pulse/coverage/gap-pipeline-facts.mjs` and `gap-pipeline-facts.test.mjs` (24 tests): P2, P4, P7.
- `ops/workflows/coverage-every-surface-2026-10-10/manifest-w3.md` (this file).

Changed (shared lists, only my own lines):
- `src/pulse/coverage/modules.mjs`: two lines, the two lanes, in name order after `gap-payments.mjs`.
- `src/pulse/tripwires.mjs`: 9 entries added to `TRIPWIRES`.
- `src/pulse/tripwires-baseline.json`: 9 entries removed (494 to 485). Nothing added.
- `src/pulse/tripwires.test.mjs`: `BASELINE_MAX` 494 to 485. This line will conflict with W1, W2, W4 and W5, who each lower it. After the merge it must equal the length of the merged baseline file.
- `src/pulse/na-conditions.mjs`: two new lane codes, `no-card-on-stage` and `no-limit-set`, added at the end of the list.
- `src/pulse/na-conditions.test.mjs`: the closed-list test now says eleven codes and names them; the sample sentences include the two new codes. Other builders who add a code edit the same lines.
- No change to `self-audit.mjs`. Each lane exports `CHECK_IDS`, which is what the audit builds its list from. `audit:expected-present` read all 1,035 expected checks.
- No beat added. The brief did not ask for one and no new surface was built.

## Tripwire map

Sorted into `TRIPWIRES` (all 9 surfaces from the brief):

| Surface | Impact | Deep checks that go red on its break |
|---|---|---|
| `desk:pipeline.html` | customer | `pipeline:count-true`, `pipeline:stage-vs-fact`, `pipeline:nobody-lost` |
| `route:dashboard/pipeline` | customer | `pipeline:count-true` |
| `route:dashboard/client-archive` | customer | `pipeline:nobody-lost` |
| `route:pipeline-clients` | customer | `pipeline:count-true`, `pipeline:nobody-lost` |
| `route:inquiry-cases` | customer | `pipeline:stage-vs-fact`, `pipeline:dead-stage` |
| `desk:inquiry-remover.html` | customer | `pipeline:stage-vs-fact`, `pipeline:two-records` |
| `desk:hiring.html` | customer | `pipeline:count-true`, `pipeline:dead-stage` |
| `desk:csm-queue.html` | customer | `csm:overdue-unassigned`, `csm:missing-step` (already on main, from `gap-csm.mjs`) |
| `desk:sales-floor.html` | money | `sales-manager:totals` (already on main), `pipeline:two-records` |

**For the integrator:** `route:pipeline-cards` is W1's line. I did not touch it. After W1 merges, add these three ids to that same entry: `pipeline:count-true`, `pipeline:stage-vs-fact`, `pipeline:nobody-lost`.

## What I decided, so it can be overruled

**Paid (Sales).** A client is paid when `custom_fields.deposit_paid` or `custom_fields.sale_closed` is true (the two marks the `deposit.paid` and `sale.closed` handlers stamp), or the client has an active sale in a product that is not the $32 diagnostic and not a partner service. I did not use `payment.received` alone, because the $32 diagnostic fires it too and that client belongs on Diagnostic Paid. A payment under one hour old is not judged yet.

**Booked (Sales).** A booking that is not cancelled or no-show, made more than 15 minutes ago, and the card is still on New Lead or Survey Complete.

**Paying client with no card (P6).** The client paid for a product in category `funding` or `repair` (an active sale, or a succeeded payment whose product name resolves to one) and has no card on the board that owns it (funding, or repair). Test clients are left out with the same address pattern the other lanes use (`TEST_CLIENT_EMAIL_RE`, `is_demo`, `synthetic`). Money for a consulting or partner product routes to no board on purpose and is not judged.

**Cleared inquiry (P2).** Every case of the client is Completed (Canceled ones ignored) and the card is not on Removed, Resume Funding or Hold. I let Hold count because a fraud alert lands there. One Completed case of three is not a cleared client.

**Repair case against card (P7).** Only the client's newest round is read. Round 1 cases never leave `awaiting_response` (nothing writes the next state), so reading every round would call every round 2 client wrong. Red when the newest round says letters are out and the card is before In Transit, or when every case in it is still open and the card says letters are out.

**Funding card with no round, round with no card (P7).** A round still `started` or `open` with no card on any Funding board, and a card past Apply Now with no round row at all.

**Sales floor against board (P7).** For every client the floor counted a deposit for this month, the Sales card must be on Closed Won; for a downsell only, on Downsell. The month is the UTC month the floor uses (`monthWindow` in `src/sales/metrics.mjs`; a test holds them equal).

**Move receipt (P4).** Looks at Funding cards that entered a stage in the last day and more than 15 minutes ago. The event key is `card_stacking:<client>:<round>:<stage>:<event>` (a test fires the real emitter and splits the key the way the SQL does). The result is: the event row exists, no dead letter is open on it, `apply_now` has a round row, `funded` has a round saying funded. The invoice and commission behind `round.funded` belong to W1's `funding:funded-no-bill`.

**Time limits (P3).** Only Repair has a clock per stage (`src/repair/sla.mjs`). The 72 hour line in `gap-funding.mjs` is the same no-progress line DPC-05 uses and it only reddens when the screen shows no next step, so it is not a stage clock and I did not copy it as one. Sales, Funding, Alt-Fin, Inquiry, AR, Partners and Hiring have no written stage limit. Each has one named setting, `AGE_LIMIT_HOURS` in `gap-pipeline-boards.mjs`, set to `null` (off). A number turns the check on for that board's open stages.

**Dead stages (P5).** The 30 stages from the brief (`DEAD_STAGES` in the lane). A test checks every key exists in a seed or migration. The Hiring ones also count `candidate_applications`, because the real hiring board is applications, not cards.

**Hiring count (P1).** The Hiring page reads `candidate_applications` with limit 200 (`api/hiring/candidates.mjs`, `MAX_LIMIT`). A test reads the page and the cap and fails if either moves. The CRM Hiring tab is cards and is always empty by design; it is counted too.

**Where the brief said the same pair twice.** `funding_rounds.status` against the card, and `dispute_cases.status` against the repair card, are in both P2 and P7 in the brief. Each is written once: round funded against card funded is in P2 (as worded there); the repair case ladder and the rounds-with-no-card are in P7. P7 does not repeat "card says Approved while the round says started": the code never writes `submitted` or `approved` on a round, so that would be red for every client in flight forever.

## Live reds found

1. **One Repair card has sat in Analysis for 5 days.** The limit is 1 hour. File `64212914-1e0d-4ec1-bd6e-07fa156108b8`. `pipeline:age` is the third check red on the same file; `repair-letter-round` and `fulfillment:next-action` already name it. Not touched. The owner's standing note on this file is no outreach.

That is the only break these checks found on live data. Test clients on the board (7 `example.com` / `e2e+` cards on New Lead) are left out of age, dead-stage and paid reads; they are counted in the column count because the board paints them.

## Chris decides

Stage time limits for these boards (one number each, in hours, or "none"): Sales, Funding, Alt-Fin, Inquiry removal, AR and collections, Partners, Hiring. Until a number is set, each board is "nothing to judge" on `pipeline:age-no-limit` and is re-checked every morning.

## Leftover cards

None new from the lanes. Found while proving, not mine to fix:
- [ ] `npx tsc --noEmit` has one error on `main` today: `src/marketing/filmed-receive.mjs(159,75)` TS2345. Not touched.
- [ ] `src/http/climate-match.test.mjs` "climate page: no approval odds, no promised amount, no guarantee" fails on `main` today (the page text matches `approval odds`). Not touched.
- [ ] A fresh worktree has no `public/leads/` (git-excluded), so `src/pulse/registry.test.mjs` fails there until the folder is copied in. This is the same trap as the 2026-10-09 lesson. Not touched.

## Proved

- `node --test` on `gap-pipeline-boards.test.mjs` and `gap-pipeline-facts.test.mjs`: 51 of 51 pass.
- All pulse unit tests (`src/pulse/**` and `src/workflows/daily-pulse.test.mjs`, no pg): 2,841 tests, 2,822 pass, 0 fail, 19 skipped (the skips were already there).
- `npm run lint`: 3,230 files parse clean.
- `npm run pulse:prove`: **OK**. 48 steps, nothing over 20 seconds, no SQL error, nothing tried to write. `gap-pipeline-boards` took 3.7 s, `gap-pipeline-facts` is not in the five slowest. `audit:na-verified` re-checked all 63 nothing-to-judge rows (mine included) and they hold. `audit:expected-present` found all 1,035. `audit:lanes-ran` found all 45 lanes.
- No beat was added, so `pulse:prove -- --beats` was not run.
- Full `npm test` with no database: unit phase 19,973 tests, 19,946 pass, 4 fail, 23 skipped. One is the climate page test above (fails the same on `main`). Three were my own age tests, caught mid-run while I changed the Funding clock; all three pass in the final tree (the 51 above). The database phase skipped 844 tests because no database was set, as in CLAUDE.md section 12.
- All live reads were `BEGIN READ ONLY` with a savepoint per query. No secret was printed or copied into a tracked file.
