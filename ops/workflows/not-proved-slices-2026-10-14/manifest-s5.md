# Builder S5 manifest — staff-only and everything else

Branch: `prf/s5-rest`. Work folder: `.claude/worktrees/prf-s5`. Nothing was pushed.

## The number

My slice had **789** rows. All 789 said "not proved" at the start.

Now **182** of them are no longer "not proved". **607** are still not proved.

| Kind | Rows in slice | Now proved | Still not proved |
|---|---|---|---|
| Routes (handler tests) | 148 | 52 | 96 |
| Screen controls | 641 | 130 | 511 |
| Total | 789 | 182 | 607 |

I measured this by running the four lanes offline. I used the stub fetch from the README, and I counted rows from `slice-5.json` that still print `NOT_PROVED`.

## What proves each row

**Routes, 52 rows.** Each one has a real test. The test calls the real `api/` handler with fake data and a stand-in database. It checks the exact answer, the exact values bound to the SQL, and who is refused.

| Test file | Rows | What it covers |
|---|---|---|
| `s5-door-staff-people.test.mjs` | 12 | suspend, staff role, staff update, invite, admin reset, authorized rep, monitoring consent, telemetry, shifts (2), chat peers, demo mode |
| `s5-door-marketing-reads.test.mjs` | 4 | marketing scripts, script, batches, funnel |
| `s5-door-hiring-creative-reads.test.mjs` | 14 | hiring postings (2), funnel, candidates, application; creative brand kits (2), library (2), jobs, approvals; campaigns action log, spend, connections |
| `s5-door-staff-reads.test.mjs` | 12 | failed events, commissions (2), documents, eeo aggregate, slo connections, funnel pages, video stats (2), call outcomes, agent shadow log, ai bureau config |
| `s5-door-writes.test.mjs` | 2 | agent promote and demote gate, creative approve, reject, archive |
| Older tests, held by name | 8 | read invoices, ai bureau save, marketing flags (2), partner marketing usage, paydown simulator, finance alerts (2) |

The 8 older-test rows use tests that already judge the exact result. `s5-door-attached.test.mjs` holds each row to the named cases in the older test. It also checks that the older test still imports the real handler.

**Screens, 130 rows.**

| Test file | Rows | How |
|---|---|---|
| `s5-display-sidebar.test.mjs` | 21 | Real Chromium. It clicks each nav link a person can see and checks it lands on its own screen. It also folds and unfolds every section a person can see. |
| `s5-display-money-chrome.test.mjs` | 41 | Real Chromium. Nine money pages, opened as the client and as staff. It checks the nav bar, the back link, the script, the read on load, and Try again on a failed read. |
| Older render tests, held by name | 41 | `src/http/money-*-screen.test.mjs` run each page's own script on a fixture. `s5-display-attached.test.mjs` holds each row to the named cases. |
| Older browser specs, held by name | 27 | Command Center specs in `e2e/`. `s5-display-specs.test.mjs` runs them in one Playwright pass. It checks every case a row names ran and passed. |

## Every proof was broken on purpose and went red

For each proof file I changed the product on purpose, ran the test, saw red, and restored the file with `git checkout`. I did this more than once for most files.

| Proof file | Breaks tried | All red? |
|---|---|---|
| staff-people | 9 (shift guard, peers filter, demo wipe confirm, consent gate, admin reset, invite owner, set role owner, telemetry role, client scope) | yes |
| marketing-reads | 4 | yes |
| hiring-creative-reads | 5 (application scope, partner scope, token redaction, archived filter, hiring role) | yes |
| staff-reads | 10 | yes |
| writes | 5 (prompt gate, demote status, archived approve, partner scope x2) | yes |
| older handler tests | 9 handlers, one break each | yes (one welcome-video break was green, a different break on the same file was red) |
| sidebar | 2 | yes |
| money-chrome | 6 | yes |
| money screen render tests | 9 pages, then 2 more for next and connections | yes after I chose lines the tests really read |
| command center specs | 15 | 12 red. 3 stayed green (5-minute reload, gear, tab strip), so I dropped those 3 rows. |

Rows I dropped because I could not make a break go red: the Command Center frame rows for the 5-minute reload, the gear button, and the tab strip.

## Shared lines I touched (for the integrator)

| File | What I changed |
|---|---|
| `src/pulse/catalog/proofs/door-proof.mjs` | one import line and one `\|\| s5DoorProof(sourceFile, row)` line |
| `src/pulse/catalog/proofs/display-proof-cases.mjs` | one import line and one `...S5_DISPLAY_PROOF_CASES,` line |
| `src/pulse/coverage/gap-door-batch-routes.mjs` | the four numbers in `EXPECTED_ROUTE_GAP_COUNTS` went down by my rows per file: routes-0 −15, routes-1 −19, routes-2 −14, routes-3 −4 |
| `src/pulse/catalog/generated.json` | rebuilt with `node scripts/pulse/compile-catalog.mjs` (a display row only leaves the lane after this) |

Run `node scripts/pulse/compile-catalog.mjs` again after you merge all five slices. It is deterministic.

## Guard tests whose numbers went down

These existing tests pin a count that must go down when rows become proved. I changed the number to what I measured. I did not skip, delete, or weaken any check.

| Test | Was | Now | Why |
|---|---|---|---|
| `src/pulse/coverage/gap-door-batch-routes.test.mjs` (4 numbers) | 310 | 258 | 52 route rows left the lane |
| `src/pulse/catalog/proofs/door-batch-route-result.test.mjs` rows | 310 | 258 | same rows |
| `src/pulse/catalog/proofs/door-batch-route-result.test.mjs` targets | 240 | 197 | fewer unique routes still in the lane |
| `src/pulse/catalog/proofs/display-proof-cases.test.mjs` red count | 1039 | 909 | 130 screen rows now have exact proofs |
| `src/pulse/catalog/proofs/door-proof.test.mjs` sample list | authorized-rep | marketing/research/approve | the sample row left the lane, so I pointed the sample at a row that is still in it |

When the other four slices merge, each number is `310 − all route rows proved`, `1039 − all screen rows proved`. Do not trust my numbers after the merge. Re-derive them.

## Left undone and why

- **96 route rows.** Most need the model, Meta, YouTube or ClickFunnels. I did not call any vendor. Some handlers need a long chain of stores (marketing flywheel, research, funnel build, social posts, journeys run, campaign sync, closer call). I did not reach them.
- **511 screen controls.** Big pages with many controls (hiring, lenders, creative factory, campaign manager, company brain, pipeline, present deck, teleprompter, brand studio, agent editor). I did not reach them.
- **Rows I did not attach because the older test does not judge the whole claim:** chat/messages (staff to staff send is not tested), journeys/run (the full walk is not tested), creative/run (staff `all=1` is not tested), vsl-watch (only the helper functions are tested), marketing/settings and marketing/funnels (only the bad-body paths are tested), read/message-templates, read/closer-call, read/closer-now, read/company-activity.
- **Three rows left out on purpose:** `route:content/tiles`, `route:content/welcome-video`, `route:marketing/offer/generate`. Their older tests pass here (26 of 26 and 13 of 13). But the repo has them on its own failed-focused-test list in `door-proof.test.mjs`. I obeyed that list. Chris or the integrator can take them off the list and attach them.
- The stand-in database does not run SQL. Where a row says "excludes demo rows" or "cells under 5 are hidden", I proved the handler sent the right SQL text and values. The `.pg.test.mjs` files prove the SQL itself on a scratch database, and I did not run those.

## What I found in the product (not fixed)

1. **Eleven links are in the sidebar file but no role can see them.** Home, Galaxy, Ops & Admin, Agent Editor, Workflows, Journeys, Consent, Finance OS, Hiring, Brand Studio, Affiliate. `sidebar.fragment.html` lists them. `shell.js` hides them from owner, admin, sales manager, closer, funding advisor, CSM, setter, inquiry specialist and partner. So no person can click them from the rail. I left those 11 rows, and the "9 section heads" row, not proved.
2. **Three sidebar sections never show.** Home, Watch and Automation have no visible head for any role, so the "9 heads fold" claim is only true for 6.
3. **Hiring reads use the default company, not the session's company.** `hiring/postings`, `hiring/funnel` and `hiring/candidates` filter on `(SELECT id FROM orgs WHERE is_default LIMIT 1)`. Every other read here filters on the session's company. This is fine if there is one company. It is a risk if there is ever a second.
4. **`marketing-command-center.spec.mjs` reload test passes even with the 5-minute timer set to 50 minutes.** The case named "the footer clock, the 5-minute reload..." did not go red when I changed `REFRESH_MS`. So that case may not check the timer. I dropped the rows that relied on it.
5. **The case named "a 409 shows both versions; Keep mine saves over the newer one..." does not click Keep mine.** A different case, "Keep mine sends the same change again...", does. I named the case that really clicks.

## How to re-run

```
node --test src/pulse/catalog/proofs/s5-*.test.mjs
node --test src/pulse/catalog/*.test.mjs src/pulse/catalog/proofs/*.test.mjs src/pulse/coverage/gap-catalog*.test.mjs src/pulse/coverage/gap-door-batch*.test.mjs
```

The `s5-display-*` tests open a real Chromium. The `s5-display-specs` test runs 140 Playwright cases and takes a few minutes.

## Files added

- `src/pulse/catalog/proofs/s5-route-kit.mjs`
- `src/pulse/catalog/proofs/s5-browser-kit.mjs`
- `src/pulse/catalog/proofs/s5-door-contracts.mjs`
- `src/pulse/catalog/proofs/s5-door-staff-people.test.mjs`
- `src/pulse/catalog/proofs/s5-door-marketing-reads.test.mjs`
- `src/pulse/catalog/proofs/s5-door-hiring-creative-reads.test.mjs`
- `src/pulse/catalog/proofs/s5-door-staff-reads.test.mjs`
- `src/pulse/catalog/proofs/s5-door-writes.test.mjs`
- `src/pulse/catalog/proofs/s5-door-attached.test.mjs`
- `src/pulse/catalog/proofs/s5-display-contracts.mjs`
- `src/pulse/catalog/proofs/s5-display-sidebar.test.mjs`
- `src/pulse/catalog/proofs/s5-display-money-chrome.test.mjs`
- `src/pulse/catalog/proofs/s5-display-attached.test.mjs`
- `src/pulse/catalog/proofs/s5-display-specs.test.mjs`
- `ops/workflows/not-proved-slices-2026-10-14/manifest-s5.md`
