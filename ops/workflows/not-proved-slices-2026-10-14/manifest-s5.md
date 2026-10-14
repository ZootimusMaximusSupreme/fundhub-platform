# Builder S5 manifest — staff-only and everything else

Branch: `prf/s5-rest`. Work folder: `.claude/worktrees/prf-s5`. Nothing was pushed.

This file was rewritten after the repair pass. The first half is what is true now. The repair section says what the independent checker found and what I did.

## The number

My slice had **789** rows. All 789 said "not proved" at the start.

Now **181** of them are no longer "not proved". **608** are still not proved.

| Kind | Rows in slice | Now proved | Still not proved |
|---|---|---|---|
| Routes (handler tests) | 148 | 52 | 96 |
| Screen controls | 641 | 129 | 512 |
| Total | 789 | 181 | 608 |

Before the repair pass the number was 182. One screen row went back to "not proved" (see "One row I took back").

I measured this by running the four lanes offline. I used the stub fetch (status 200, empty bodies), and I counted rows from `slice-5.json` that still print `NOT_PROVED`.

## The repair pass: what the checker found, what I did

The checker broke the product on purpose and found proofs that stayed green. Each one is now strong enough to go red on the exact break it named, and I repeated the break to prove it.

| # | Row | What was wrong | What I changed | Break that now goes red |
|---|---|---|---|---|
| 1 | `route:demo/mode` (wipe) | The test sent DELETE with an empty stand-in database, so no demo client was found and no delete ran. | New case in `s5-door-staff-floor.test.mjs`. The stand-in returns two demo clients. It checks every DELETE is bound to the signed-in company or to the found client ids, that 14 money and customer tables are named, that `is_demo` is in every statement, that the roster logins and partner are kept, and that the client row goes last. It runs once for each of two companies. | Skip every per-org DELETE. Drop `AND is_demo` on the client delete. Drop the roster guard on accounts. Bind to a different company. |
| 2 | `route:creative/approvals` | Only `state=blocked` ran, and only the brand arm was judged. | `s5-door-hiring-creative-reads.test.mjs` now checks each arm's own condition in the SQL text. A new table runs all five states (`blocked`, `pending`, `awaiting_approval`, `all`, none) and checks which arms are asked for. | Campaign arm changed to `approved`. Asset arm widened to `passed` and `approved`. Brand arm loses `partner_id`. Brand arm changed to `approved`. Campaign arm never asked for on `awaiting_approval`. |
| 3 | Money credit "Accounts" table | The named case never judged the Status or Opened columns. | New case in `src/http/money-credit-screen.test.mjs`. It parses the table row by row, column by column, with one closed account, one account with no opened date and one line of credit. | Open and Closed swapped. Opened column reads the wrong field. |
| 4 | Ideas "Try again" | The case only saw the button, it never clicked it. | `e2e/cc-tab-ideas.spec.mjs` now has one case for each of the 7 cards that can fail. Each one fails the read, clicks Try again, and checks the real rows are painted, the error is gone, and the part was read exactly once more. It runs at 390px and 1280px. | Each of the seven reload handlers made a no-op, one at a time. |

Notes 5 and 6 from the checker (the guard numbers and the "held by name" rows) are covered in "Shared lines I touched" and "What proves each row".

### The same weakness, found in my other proofs

I went through every proof for the four classes the checker named and fixed what I found. Each fix was broken on purpose and went red.

**1. A role gate tried only with roles it lets in, or with one role it refuses.**

- New helper `assertRoleGate` in `s5-route-kit.mjs`. It signs in as ten roles (owner, admin, sales manager, closer, funding advisor, inquiry specialist, CSM, setter, partner, client). Each role that is not allowed must get a 403 before any data is read. Each allowed role must get past the gate. The allowed list is written by hand in the test, so a role slipped into the gate by mistake turns it red.
- Used for the 29 staff doors in my own test files, and for the 8 older-test rows through `s5-door-attached.test.mjs` (each such row now has a `gate` in `s5-door-contracts.mjs`). `shifts` has no role gate (any signed-in staff), so it is not in the sweep.
- Doors that serve a partner or staff (creative, campaigns): a client account and an affiliate account must both be refused, with no data read.
- `read/call-outcomes`: every role that is not in the finance set now has to read only its own calls. Before, only a closer was tried.
- The Command Center page gate: owner and admin stay on the page, and sales manager, funding advisor, inquiry specialist, CSM and setter are all sent away. Before, only a closer was tried.

**2. An org check decided by params only, never by the SQL.**

- Every call that binds the company now also has the condition checked in the SQL text (`WHERE id = $1 AND org_id = $2` and the like). A bound value the SQL never uses is not a scope.
- This covers suspend, staff role, staff update, invite, admin reset, authorized rep, consent, telemetry, shifts, demo, marketing, call outcomes, shadow log, video stats, funnel pages, agents and creative actions.

**3. A compound row bound to a test that covers only half of it.**

| Row | The half that was missing | Now |
|---|---|---|
| `auth/invite` | "emails that link through Resend to a real address" was never tried | Mail stand-in (fake key, fake host, `fetch` replaced, fence put back): a real address gets exactly one mail with the same link; a non-address and no address get none; with the messaging fence up nothing is sent |
| `auth/admin-reset` | "nothing is emailed" was never tried | Same stand-in, mail fully on, still zero mails |
| `staff/telemetry` | "hours from shifts" was never judged | `hours` checked: 16 payable hours, 16 worked, 1 for review (8 logged plus an 8 hour estimate for the auto-closed shift) |
| `demo/mode` | POST enabled:true and a switch that did not stick | Both checked |
| `marketing/script` | "check results" never looked at | `check_results` and `flagged` checked on the script and on every version |
| `marketing/funnel` | which jobs | the exact kinds and the funnel id are bound |
| `campaigns/action-log` | only `agent` was tried | `agent`, `human`, `revertible`, `failed`, `all` each checked |
| `campaigns/spend` | `exhausted` and `approaching` flags, and `ok` state | flags in the SQL checked; `breached`, `ok`, `all` checked |
| `creative/library` | "never selects storage_key" | the SQL may only say `IS NOT NULL AS has_storage_key` |
| `read/agent-shadow-log` | the whole-company read | no agent named means `null` bound |
| Ideas "Make the funnel" | the chosen offer and the typed address | new case sends `funding_dfy` and the typed address, and clears the address |
| Ideas "Drop an idea" | blank format and funnel, and an empty box | new case |
| Ideas "Quick copy" | the offer select | one case per offer |
| Ideas "Accept" on each of 3 | only the first was clicked | all three clicked, each saves its own angle |
| Ideas "Which offer" picker | never switched | new case checks the flywheel is read for the chosen offer |
| Shoot "Got it" | only "Another take" was clicked | new case |
| Numbers filters | the angle select and the first and last day | new case |
| Write ad copy select | only "Funding" was sent | one case per offer |
| Settings "Try again" | only the funnels part was clicked | settings part clicked too |
| Settings "Save" and "campaigns" | the link-a-campaign, pick-its-ad-set case was not named | named |
| Numbers "Try again" | only the Ads part | angles, funnels and the ad drawer too |
| Money connections tiles | Fees and Paid out tiles never judged | all four tiles judged with distinct numbers |
| Money credit "Sample report" | only the shown side | a real pull and a missing flag show no banner |
| Money fundability "What drives it" | "Not on file" never seen | a check with no answer judged |
| Money helper status | "Rules helper only" and the server's AI | all four brains judged |
| Money next "Capital Blueprint card" | owner flag alone | an owned client with a link still sees nothing |
| Money pages nav (9 pages) | only the words, not where they go | every link's place is checked, for the client and for staff |
| Money pages "inline styles" | not judged | the page's own style block is checked |

**4. A wait that is a timer.**

- `s5-display-money-chrome.test.mjs` waited a fixed 400 ms for the first read. It now waits until every read the page makes has been asked for, then waits for the network to go quiet.

## One row I took back

`Scripts: 'Try again' buttons on a failed part` (`cc-scripts-retry`) is back to NOT_PROVED.

The scripts list, the ideas list and the batch history Try again buttons are all proved now (new cases in `e2e/marketing-cc-scripts.spec.mjs`). The Rules fold and the "Every version" fold are not. When their read fails, `public/app/marketing-cc-scripts.js` asks the server again on every repaint, so the failed read repeats without end (627 reads in 1.2 seconds in the test). The Try again button is repainted faster than it can be clicked. I cannot honestly say all the buttons work, so the row is not attached. This is a product problem. I did not fix it.

## What proves each row

**Routes, 52 rows.** Each one has a real test. The test calls the real `api/` handler with fake data and a stand-in database. It checks the exact answer, the exact values bound to the SQL, the conditions in the SQL text, and who is refused (every role).

| Test file | Rows | What it covers |
|---|---|---|
| `s5-door-staff-people.test.mjs` | 6 | suspend, staff role, staff update, invite (with the mail stand-in), admin reset, authorized rep |
| `s5-door-staff-floor.test.mjs` | 6 | monitoring consent, telemetry, shifts (2), chat peers, demo mode (read, switch, wipe) |
| `s5-door-marketing-reads.test.mjs` | 4 | marketing scripts, script, batches, funnel |
| `s5-door-hiring-creative-reads.test.mjs` | 14 | hiring postings (2), funnel, candidates, application; creative brand kits (2), library (2), jobs, approvals (all arms and states); campaigns action log, spend, connections |
| `s5-door-staff-reads.test.mjs` | 12 | failed events, commissions (2), documents, eeo aggregate, slo connections, funnel pages, video stats (2), call outcomes, agent shadow log, ai bureau config |
| `s5-door-writes.test.mjs` | 2 | agent promote and demote gate, creative approve, reject, archive |
| Older tests, held by name | 8 | read invoices, ai bureau save, marketing flags (2), partner marketing usage, paydown simulator, finance alerts (2). Each row also has its role gate swept. |

The 8 older-test rows use tests that already judge the exact result. `s5-door-attached.test.mjs` holds each row to the named cases in the older test. It also checks that the older test still imports the real handler, and it sweeps the role gate.

**Screens, 129 rows.**

| Test file | Rows | How |
|---|---|---|
| `s5-display-sidebar.test.mjs` | 21 | Real Chromium. It clicks each nav link a person can see and checks it lands on its own screen. It also folds and unfolds every section a person can see. |
| `s5-display-money-chrome.test.mjs` | 41 | Real Chromium. Nine money pages, opened as the client and as staff. It checks the nav bar (words and where each goes), the back link, the script, the read on load, and Try again on a failed read. |
| Older render tests, held by name | 41 | `src/http/money-*-screen.test.mjs` run each page's own script on a fixture. `s5-display-attached.test.mjs` holds each row to the named cases. Five of these older test files got new cases in the repair pass. |
| Older browser specs, held by name | 26 | Command Center specs in `e2e/`. `s5-display-specs.test.mjs` runs them in one Playwright pass. It checks every case a row names ran and passed. Six spec files got new cases in the repair pass. |

## Every proof was broken on purpose and went red

For each proof I changed the product on purpose, ran the test, saw red, and restored the file with `git checkout`. The first manifest's breaks still stand. This table is the new breaks from the repair pass.

| Proof | New breaks tried | All red? |
|---|---|---|
| staff-people and staff-floor | 19 (suspend, role and update company scope, consent, telemetry and peers gates, telemetry hours and review count, authorized rep removed or inactive, demo wipe x5, demo gate, invite never mails, invite mails the wrong person) | yes, apart from the equal outcomes below |
| marketing-reads | 6 (four role gates, check results, funnel pages company scope) | yes |
| hiring-creative-reads | 10 (hiring role, partner kinds, library storage key, action log human, hiring company, approvals x5) | yes |
| staff-reads | 4 (commissions role, call outcomes floor, failed events role, video platform) | yes |
| writes | 4 (creative kinds, agents gate, agents company scope, approve scope) | yes |
| older handler tests (role sweep) | 5 (invoices, flags, bureau, trigger, usage) | yes |
| ideas spec | 13 (seven retry handlers one at a time, accept, campaign switch, funnel path, funnel offer, quick offer, idea format) | yes |
| other specs | 10 (shoot Got it, shoot retry, numbers angle, numbers dates, numbers retry x4, settings retry, page gate) | yes |
| money screen render tests | 12 (credit x3, connections x3, helper x2, fundability x2, next, plus plan, setup and payments spot checks) | yes |
| money-chrome | 1 (a nav link pointed at the wrong place) | yes |

Two breaks stayed green on purpose, and I wrote them down because they are not product breaks:

- `auth/suspend` and `auth/staff-role`: I added `sales_manager` to the outer gate. Still green. The store checks the same owner and admin list a second time and answers the same 403 before any SQL. The answer a person sees does not change, so there is nothing to catch.
- `auth/invite`: I mailed anything that was not blank. Still green. The mail sender checks that the address looks like an address and refuses it.

## Shared lines I touched (for the integrator)

| File | What I changed |
|---|---|
| `src/pulse/catalog/proofs/door-proof.mjs` | one import line and one `\|\| s5DoorProof(sourceFile, row)` line (unchanged in the repair) |
| `src/pulse/catalog/proofs/display-proof-cases.mjs` | one import line and one `...S5_DISPLAY_PROOF_CASES,` line (unchanged in the repair) |
| `src/pulse/coverage/gap-door-batch-routes.mjs` | the four numbers in `EXPECTED_ROUTE_GAP_COUNTS` (unchanged in the repair, route rows did not move) |
| `src/pulse/catalog/generated.json` | rebuilt with `node scripts/pulse/compile-catalog.mjs` (a display row only leaves the lane after this) |
| `src/pulse/catalog/proofs/display-proof-cases.test.mjs` | the red count 909 became 910 (one screen row went back) |

Older test files I strengthened (new cases only, nothing deleted or loosened):

- `src/http/money-credit-screen.test.mjs`, `money-connections-screen.test.mjs`, `money-fundability-screen.test.mjs`, `money-helper-screen.test.mjs`, `money-next-screen.test.mjs`
- `e2e/cc-tab-ideas.spec.mjs`, `cc-tab-shoot.spec.mjs`, `cc-tab-numbers.spec.mjs`, `marketing-cc-scripts.spec.mjs`, `marketing-cc-settings.spec.mjs`, `marketing-command-center.spec.mjs`

Run `node scripts/pulse/compile-catalog.mjs` again after you merge all five slices. It is deterministic.

## Guard tests whose numbers went down

These existing tests pin a count that must go down when rows become proved. I changed the number to what I measured. I did not skip, delete, or weaken any check.

| Test | Was | Now | Why |
|---|---|---|---|
| `src/pulse/coverage/gap-door-batch-routes.test.mjs` (4 numbers) | 310 | 258 | 52 route rows left the lane |
| `src/pulse/catalog/proofs/door-batch-route-result.test.mjs` rows | 310 | 258 | same rows |
| `src/pulse/catalog/proofs/door-batch-route-result.test.mjs` targets | 240 | 197 | fewer unique routes still in the lane |
| `src/pulse/catalog/proofs/display-proof-cases.test.mjs` red count | 1039 | 910 | 129 screen rows now have exact proofs |
| `src/pulse/catalog/proofs/door-proof.test.mjs` sample list | authorized-rep | marketing/research/approve | the sample row left the lane, so I pointed the sample at a row that is still in it |

When the other four slices merge, each number is `310 − all route rows proved`, `1039 − all screen rows proved`. Do not trust my numbers after the merge. Re-derive them.

## Left undone and why

- **96 route rows.** Most need the model, Meta, YouTube or ClickFunnels. I did not call any vendor. Some handlers need a long chain of stores (marketing flywheel, research, funnel build, social posts, journeys run, campaign sync, closer call). I did not reach them.
- **512 screen controls.** Big pages with many controls (hiring, lenders, creative factory, campaign manager, company brain, pipeline, present deck, teleprompter, brand studio, agent editor). I did not reach them.
- **Rows I did not attach because the older test does not judge the whole claim:** chat/messages (staff to staff send is not tested), journeys/run (the full walk is not tested), creative/run (staff `all=1` is not tested), vsl-watch (only the helper functions are tested), marketing/settings and marketing/funnels (only the bad-body paths are tested), read/message-templates, read/closer-call, read/closer-now, read/company-activity.
- **Three rows left out on purpose:** `route:content/tiles`, `route:content/welcome-video`, `route:marketing/offer/generate`. Their older tests pass here (26 of 26 and 13 of 13). But the repo has them on its own failed-focused-test list in `door-proof.test.mjs`. I obeyed that list. Chris or the integrator can take them off the list and attach them.
- The stand-in database does not run SQL. Where a row says "excludes demo rows" or "cells under 5 are hidden", I proved the handler sent the right SQL text and values. The `.pg.test.mjs` files prove the SQL itself on a scratch database, and I did not run those.
- `cc-scripts-retry`: back to not proved, because of the product problem below.

## What I found in the product (not fixed)

1. **Eleven links are in the sidebar file but no role can see them.** Home, Galaxy, Ops & Admin, Agent Editor, Workflows, Journeys, Consent, Finance OS, Hiring, Brand Studio, Affiliate. `sidebar.fragment.html` lists them. `shell.js` hides them from owner, admin, sales manager, closer, funding advisor, CSM, setter, inquiry specialist and partner. So no person can click them from the rail. I left those 11 rows, and the "9 section heads" row, not proved.
2. **Three sidebar sections never show.** Home, Watch and Automation have no visible head for any role, so the "9 heads fold" claim is only true for 6.
3. **Hiring reads use the default company, not the session's company.** `hiring/postings`, `hiring/funnel` and `hiring/candidates` filter on `(SELECT id FROM orgs WHERE is_default LIMIT 1)`. Every other read here filters on the session's company. This is fine if there is one company. It is a risk if there is ever a second. The tests now pin this on purpose.
4. **`marketing-command-center.spec.mjs` reload test passes even with the 5-minute timer set to 50 minutes.** The case named "the footer clock, the 5-minute reload..." did not go red when I changed `REFRESH_MS`. I dropped the rows that relied on it.
5. **The case named "a 409 shows both versions; Keep mine saves over the newer one..." does not click Keep mine.** A different case, "Keep mine sends the same change again...", does. I named the case that really clicks.
6. **The Scripts tab asks the server again forever when the Rules read or the "Every version" read fails.** `onToggle` in `public/app/marketing-cc-scripts.js` restarts the load while the status is "error", and every repaint fires the toggle again. 627 reads in 1.2 seconds in the test. A real server would be hit the same way.
7. **Any staff role can turn an agent live.** `api/agents.mjs` gates `promote` and `demote` with the whole-floor set, so a setter or a CSM can do it. The test now pins the whole-floor set so a change either way is seen.
8. **Turning demo mode on flips the switch before it checks that demo staff exist.** When there is none, the answer is a 500 but the switch is already on.

## Flaky check

A test that fails on unchanged code is not a proof, so I ran each new or changed proof many times.

| What | Runs | Result |
|---|---|---|
| All `s5-door-*` tests, the five money render tests I touched, `s5-display-attached` | 10 | 10 passed |
| The 51 new or changed Playwright cases, at 390px and 1280px | 10 each (510 runs) | 510 passed |
| `s5-display-money-chrome` alone | 10 | **9 passed, 1 failed** (then fixed, see below) |
| `s5-display-money-chrome`, six at once with four busy loops, three rounds | 18 | 18 passed after the fix |
| `s5-display-sidebar`, three at once, two rounds | 6 | 6 passed |
| The whole catalog group (`src/pulse/catalog`, `gap-catalog*`, `gap-door-batch*`), run three times on the final commit | 3 | all of my files passed in all three. One run was fully green (1374 of 1374). The other two each had one failure in a test that is not mine (below) |

**The money-chrome flake, and what it really was.** It was not a timing guess. It was a false pass. On the money declines page, the retry read was answered with the stand-in's default body, which has no `view`. The page's own `classify` calls that a server error and paints the error again. The test only waited for "no Try again button". While the page was loading there is no button, so the test passed on a race, and failed when the polling happened to see the error come back. The test now answers the retry with a valid read for each page (credit, declines, fundability, helper) and waits for that page's own success words and no button. I broke the page on purpose (it paints the error again after the retry, and the button is dead) and both go red.

**The two group failures that are not mine.**

- `read-reviewed-e2e` and `display-proof-cases` run `e2e/agent-editor-promote-demote.spec.mjs`. Its line `#a_esc toHaveValue("Sarah Whitfield · Sales Manager")` times out after 5 seconds when five builders run browsers at once. Alone, that spec passed 40 of 40. I did not touch it.
- "Display EF/Public wave 2" had a `page.goto` that took over 30 seconds under the same load.

Both are in other builders' proofs and fail only under load. I am naming them so the integrator does not blame this slice.

## How to re-run

```
node --test src/pulse/catalog/proofs/s5-*.test.mjs
node --test src/pulse/catalog/*.test.mjs src/pulse/catalog/proofs/*.test.mjs src/pulse/coverage/gap-catalog*.test.mjs src/pulse/coverage/gap-door-batch*.test.mjs
```

The `s5-display-*` tests open a real Chromium. The `s5-display-specs` test runs the Command Center specs and takes a few minutes.

## Files added

- `src/pulse/catalog/proofs/s5-route-kit.mjs`
- `src/pulse/catalog/proofs/s5-browser-kit.mjs`
- `src/pulse/catalog/proofs/s5-door-contracts.mjs`
- `src/pulse/catalog/proofs/s5-door-staff-people.test.mjs`
- `src/pulse/catalog/proofs/s5-door-staff-floor.test.mjs`
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
