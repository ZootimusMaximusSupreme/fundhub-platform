# Heartbeat review — 2026-10-17 Arizona

Read-only review after Chris asked where the heartbeat stands. Ground truth: `docs/journeys/heartbeat-flow.md`.

## Current live state

| State | Count | Evidence |
| --- | ---: | --- |
| Working | 725 | 6:02 a.m. Arizona production scorecard |
| Broken | 78 | 6:02 a.m. Arizona production scorecard |
| Not proved | 853 | 6:02 a.m. Arizona production scorecard |
| Not checked | 1 | 6:02 a.m. Arizona production scorecard |
| Nothing to judge | 265 | 6:02 a.m. Arizona production scorecard |
| Total | 1,922 | 6:02 a.m. Arizona production scorecard |

- The hourly run at 10:07 p.m. Arizona had 13 of 16 beats green. Apply links, email, and text were red.
- The five-minute backup watch was green at 10:20 p.m., so the clock itself is running.
- Live health is green now: HTTP 200, database up, 394 migrations, zero pending.

## Claude's work

- All 26 `finish-853` batches plus the catalog rebuild are merged in `676507d3a`; that commit is an ancestor of GitHub `main`.
- The old count assertions were later corrected in `677f398db` and `5b9f4b410`.
- GitHub `main` is now `0998ff499`. Its latest change is a board only; it did not change heartbeat code.
- The current production scorecard still says **853 not proved**. Do not call that backlog finished just because the batch branches merged.
- CI is red. Run `39086798824` has failed test shards and nine serial Postgres failures. `fin-b23-money-helper-poll.test.mjs` times out before reread 93.

## Release gate state

- The site is live from the October 17 Netlify deploy. Health is good.
- GitHub's ship proof is red: it saw timeouts on the morning-brief link and funnel checkout, three beats cut by budget, missing email/SMS templates, an unset FinanceOS setup fee, and skipped vendor-key proof. See run `39085770819`.
- The current ship cannot be called green until those red pulse rows and CI failures are repaired.

## Next order

1. Fix the two live-read timeouts (`/app/morning-brief.html` and `/api/public/funnel-checkout` / `/roadmap/pay.html`) so the hourly proof does not cut beats.
2. Restore the five named customer message templates and prove one provider receipt for each channel.
3. Set the FinanceOS setup-fee value so customers never see `$X` or a dead pay action.
4. Repair the batch-23 polling timeout and the nine Postgres test failures, then rerun CI.
5. After the ship gate is green, work the 78 broken rows one at a time, money/customer paths first. The 853 not-proved rows are a separate proof backlog.

## Evidence

- `docs/journeys/heartbeat-flow.md`
- `ops/workflows/two-ios-apps-launch/live-platform.md`
- GitHub Actions `39085770819` and `39086798824`
- `ops/workflows/heartbeat-ranked-2026-10-14.md` (older full ranked list; do not use its counts as current)
