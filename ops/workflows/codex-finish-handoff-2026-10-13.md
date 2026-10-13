# Codex: finish the heartbeat coverage build — handoff, 2026-10-13

Owner: Chris Stanbridge. He reads at a 4th grade level. Spell it Fundhub. This file is a brief for Codex. It is the only thing Codex needs to start. Read it, then do the work in "What to do, in order".

Chris said, Tuesday 2026-10-13: "I want codex to know to finish what sonnet ultracode did plus the added shit." And earlier: "Tuesday is the big wiring day. We need the code really clean on the heartbeat and checking. We have about 250k lines of maintenance code."

So the job is: finish the coverage build that Claude started on 2026-10-10 AND the catalog work Codex added on 2026-10-12/13, as one clean thing. No more half-built lanes.

## 1. What Claude (Sonnet, ultracode) built on 2026-10-10 — all on main, live

- A full inventory of the company: 20 JSON lists, 3,974 rows, scored `none | ping | e2e | deep`. Board: `ops/workflows/coverage-every-surface-2026-10-10.md`. Lists: `ops/workflows/coverage-every-surface-2026-10-10/*.json`. Manifests: `manifest-w1.md` to `manifest-w8.md` in that folder.
- The definition of "checked" (the ladder): L0 known, L1 alive, L2 the control works, L3 the result is right (reads real data, goes red when wrong), L4 the whole journey ends right. Rule: anything touching money, a customer message or a customer record must reach L3.
- W1 money funding/fees/payouts, W2 money payments/checkouts/bank moves/ad spend, W3 pipelines (7 checks on every board), W4 messages, W5 customer records and banks, W6 the finished lists, W7 door and click tests, W8 five whole-journey checks (`trip:*`).
- A 5-minute outside watcher: `netlify/functions/pulse-outside-watch.mjs` runs beat `engine-alive`. It exists because the workflow engine stalled 46 minutes on 2026-10-09 and nothing live said so.
- Handoff Claude wrote: `ops/workflows/coverage-paused-until-2026-10-13.md` (state, real breaks, next steps).

## 2. What Codex added (2026-10-12 and 13) — read this, it changed the report

- A compiled catalog: `src/pulse/catalog/` and `src/pulse/catalog/generated.json`, built by `scripts/pulse/compile-catalog.mjs` from the 20 JSON lists. Lanes: `gap-catalog*.mjs`, `gap-catalog-display.mjs`, `gap-door-batch-routes.mjs`, `gap-door-batch-jobs.mjs`, `gap-door-batch-webhooks.mjs`, `gap-door-batch-keys.mjs`.
- Its rule: a row stays red until a check judges that exact business result. "Wired" is not "passed".
- Codex board: `ops/workflows/heartbeat-tripwire-repair.md` and `ops/workflows/heartbeat-tripwire-reds-2026-10-13.md` (on the Codex branches; may not be on main yet).
- Review branch `codex/heartbeat-tripwire-review-2026-10-13`, draft PR #37. It holds the fix that makes `gap-catalog-display` read compiled data. NOT merged. NOT live.

## 3. What this morning's live report shows (6:01 a.m. Arizona, 2026-10-13, read from `pulse_scorecards`)

1,506 rows: 712 green, 563 red, 2 not checked, the rest "nothing to judge". The 6 a.m. report of 2026-10-12 had 802 rows and 76 red.

| Lane | Rows | Red | What the red means |
|---|---|---|---|
| `gap-door-batch-routes` | 316 | 316 | "No fake-data test judges this exact result." Unproved. Not a measured break. 0 green. |
| `gap-catalog-flow` | 283 | 123 | Same idea for messages and journeys: "no exact proof". Mixed with a few real findings (dead senders, unwired guards). |
| `wf:` event workflows | 65 | 42 | "An event came and no receipt shows this workflow started." First seen 2026-10-11 10:15 p.m. Arizona. Needs a real look: receipts missing for 42 workflows. Could be a real break in the run recorder. |
| `gap-catalog-reads` | 27 | 27 | "No safe result probe" for a page read. Unproved. |
| `gap-door-batch-jobs` | 8 | 8 | Mix: some real (4 stuck ad-video upload claims), some unproved. |
| `catalog-data` | 66 | 5 | Saved result rows missing a business result. Real data findings. |

The problem for Chris: **"broken" and "not proved yet" share one red.** About 500 of 563 reds are "not proved yet". He cannot see the real breaks.

Real breaks in the same report (these are true, keep them red and visible):
- `meta-sync`: the Meta ad token cannot be decrypted ("Invalid initialization vector / decryptToken: malformed auth tag"). Meta ad numbers are not refreshing. Do NOT touch or replace the key. Fix around it or report.
- `clickfunnels-night-job`: no active ClickFunnels connection.
- `ads-number-unmapped`: 2 ads have spend and no Fundhub ad number.
- `calls:booked-no-outcome` (2) and `calls:booked-no-join-link`: calls run on Google Meet and ClickFunnels never sends a join link. Justice and Sarah must connect their calendars (a person's step, owner-known).
- `pipeline:repair`, `pipeline:clients`: one repair file and one paying client with no progress. The repair file is Bram (FH-000507). Owner closed it: do not contact, do not act, do not re-raise.
- `live-playwright:desks`: the desk sweep is 135 hours old. Run `node scripts/live-playwright-sweep.mjs` on the Mac.
- `gap-catalog-display:threw` (not checked): `ENOENT /ops/workflows/.../public-pages.json`. The live bundle has no repo files. This is the exact bug PR #37 fixes. Merge it.

## 4. What to do, in order

1. **Do not touch** the unsaved edits in the Codex checkout that are LNR (`src/finance/crs-client*`, `src/messaging/providers/crs-softview*`) or the teleprompter files. Not in scope.
2. **Merge PR #37** (display lane as compiled data). Prove with `npm run pulse:prove` that `gap-catalog-display` no longer throws. This clears the not-checked row.
3. **Split the red into two honest states** in the report and the morning text. Keep `red` for "measured broken". Add a distinct, countable state for "not proved yet" so the 500 do not bury the 60. Use the existing status vocabulary in `src/pulse/scorecard.mjs` and `na-conditions.mjs` rather than inventing a new one if one fits. Chris must be able to read "N things are broken, M things are not proved yet" in one line. The pulse must never go quiet about the unproved ones: they stay counted.
4. **Investigate the 42 `wf:` receipt reds.** Find out whether events really started workflows and only the receipt is missing, or the workflows never ran. Look at `src/pulse/run-evidence.mjs`, `src/pulse/workflow-runs.mjs`, the `workflow_runs` table, and Inngest. First seen 2026-10-11 10:15 p.m. Arizona: find what changed then.
5. **Finish the wiring from the 2026-10-10 build** (this is the "big wiring day" list):
   a. Hourly beats for the money checks. First two: `trip:funding` (bill after funded) and `trip:partner` (payable commission). Then W1 and W2 deep checks. Follow `.claude/rules/heartbeat-on-every-build.md`: beat file under `src/pulse/beats/`, literal list `src/pulse/beats/index.mjs`, read only via `ctx.read`/`ctx.http`, pass and fail selfTest, fix guide, `npm run pulse:prove -- --beats`.
   b. Turn the 316 route "unproved" rows into proofs, money and customer routes first. One fake-data test per route that calls the real handler and judges the exact result. Reuse the door tests and the stand-in database harness Claude wrote in W7 (`src/testing/handler-harness.mjs`; the list of files is in `ops/workflows/coverage-every-surface-2026-10-10/manifest-w7.md`). Do not weaken a test to make a row green.
   c. The ~880 rows that were `none` in the 2026-10-10 inventory: deep checks, money then customer.
   d. Re-score the older 2,690 rows. The catalog compiler already links rows to proofs; make the count true and put the totals in `src/pulse/catalog/generated.json`.
6. **Clean code is the priority**, not more code. The company carries about 250k lines of maintenance code. Rules: one idea per file, small, read only, honest status (a read that cannot happen is `skip` with the reason, never PASS), tests both ways (a PASS and a FAIL), under 20 seconds per lane, no repo files read at run time (the live bundle carries none), no secret-shaped string in any tracked file (GitHub push protection blocks it; build fakes from parts at run time), no `pkill` by pattern, never a duplicate of something that exists (search first: `src/pulse/coverage/`, `src/pulse/beats/`, `src/pulse/catalog/`). Delete dead lanes you create.
7. **Owner numbers that only Chris can set** (leave red, do not invent): FinanceOS setup price `FINANCE_OS_SETUP_FEE_CENTS`; stage time limits for Sales, Funding, Alt-Fin, Inquiry, AR, Partners, Hiring (34 stage keys, listed in `heartbeat-tripwire-repair.md`); the commission pay day.

## 5. Rules that never bend

- Never remove, unset or overwrite a key. Never print a secret. `meta-sync` and `OPENAI_API_KEY` are examples: fix in code around the key or report.
- Checks are read only. No send, no text, no email, no AI call, no Plaid call, no card charge, no write to the live database, no event emitted. Reads on the live database are `BEGIN READ ONLY`.
- Texts to Chris only 6 a.m. to 10 p.m. Arizona time.
- Work in a worktree, not by switching the branch of a shared checkout. Keep no branches on GitHub: merge, push `HEAD:main`, delete the branch. Commit locally every session.
- Heartbeat law: every new live thing gets a ping row, a deep check if it touches money or a customer, a tripwire-map sort, a place on `src/pulse/coverage/modules.mjs`, proof from `npm run pulse:prove`, and a line in `docs/lessons/pulse-lessons.md` for every fixed break. Do not weaken `registry.test.mjs`, `heartbeats.test.mjs`, `tripwires.test.mjs`, `beats.test.mjs`, `modules.test.mjs`.
- `npm run pulse:prove` on the Mac reads masked keys: `brain:embed-key`, `opt-out:unsubscribe-link`, `keys:*`, `gmail` read red there and are green on the live server. The live `pulse_scorecards` row is the truth.
- Final report to Chris in plain words: how many things are broken, how many are not proved yet, what changed, what is left.
