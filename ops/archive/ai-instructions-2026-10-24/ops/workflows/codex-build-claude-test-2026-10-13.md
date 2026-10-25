# Codex builds. Claude tests. — 2026-10-13

Owner: Chris Stanbridge (reads at a 4th grade level; spell it Fundhub).
Roles, set by Chris: **Codex = build. Claude = test.** Codex does not grade its own work. Claude does, from a clean checkout, with the tests in section 3 written down before Codex starts.

Context for the build: `ops/workflows/codex-finish-handoff-2026-10-13.md` (what Claude built on 2026-10-10, what Codex added, why this morning's report has 563 reds).

> **OWNER RULE (Chris, 2026-10-13): NO NEW PRODUCT FEATURES TODAY.** Codex finishes, wires and cleans the heartbeat. No new pages, routes, screens or customer-facing behavior. **The hourly beats ARE in scope** (Chris: "we do hourly beats"): they are the wiring, not a feature. Do not add other new lanes or checks beyond what the items below name.

## 1. The prompt for Codex (copy and paste this)

```text
You are Codex, the BUILDER, for Fundhub (repo: ZootimusMaximusSupreme/fundhub-platform). Claude will TEST your work afterward from a clean checkout. You do not decide it is done; the tests in section 3 of ops/workflows/codex-build-claude-test-2026-10-13.md decide.

Read first: CLAUDE.md, .claude/rules/heartbeat-on-every-build.md, ops/workflows/codex-finish-handoff-2026-10-13.md, ops/workflows/heartbeat-tripwire-repair.md.

GOAL: make the heartbeat WORK, with clean code. NO NEW PRODUCT FEATURES TODAY (owner rule): no new page, route, screen or customer-facing behavior. The hourly beats in item 4 ARE in scope (owner: "we do hourly beats"). Finish, wire and clean only. "Working" means all 8 acceptance items in section 2 pass.

HOW:
1. Work in your own worktree off origin/main. Do not touch the unsaved LNR files (src/finance/crs-client*, src/messaging/providers/crs-softview*) or the teleprompter files. Do not touch any key or secret.
2. Do the 8 items in order. Items 1 to 3 first: they make the report honest. Do not start item 5 until 1 to 3 pass your own tests.
3. Checks are READ ONLY: no send, text, email, AI call, Plaid call, card charge, event, or write to the live database. Live reads are BEGIN READ ONLY.
4. CLEAN CODE is the first rule. The company carries about 250k lines of maintenance code, so: search for an existing lane or helper before writing a new one; one idea per file; delete dead lanes you create; no copy-paste lanes (generate from the catalog data); no repo files read at run time; no secret-shaped string in a tracked file (build fakes from parts at run time); a lane stays under 20 seconds; honest status (a read that cannot happen is skip with the reason, never PASS); a PASS test and a FAIL test for every check; never weaken, skip or delete an existing test.
5. Commit to a local branch. Push ONE review branch and open ONE draft PR. Do NOT push to main. Do NOT merge. Do NOT deploy.
6. Write your manifest to ops/workflows/codex-build-manifest-2026-10-13.md in the branch: for each of the 8 items, the files changed, the exact commands you ran, the counts you got, and anything you did NOT finish. Say plainly what is not done. Never claim an item passes that you did not run.
7. Stop when you have the manifest. Claude tests next.

Never remove, unset or overwrite a key. Do not contact or act on Bram (FH-000507). Texts to Chris only 6 a.m. to 10 p.m. Arizona. Talk to Chris at a 4th grade level.
```

## 2. The 8 acceptance items (what "working" means)

| # | Item | Pass means |
|---|---|---|
| 1 | Merge the display-lane fix (PR #37 content) | `gap-catalog-display` never throws or reads a repo file at run time. It is green or red by a real GET, never `not_checked`. |
| 2 | Split "broken" from "not proved yet" | The scorecard, the morning text and the report page each show two separate counts: BROKEN (measured wrong) and NOT PROVED (no exact test yet). The 316 route rows and the 150 catalog flow/read rows leave the BROKEN count. They are still counted every day, never hidden, never green. A real break can never be filed under NOT PROVED. |
| 3 | Explain the 42 workflow receipt reds | Each `wf:` red is either gone (receipt now written) or has a written cause in the manifest that Claude can verify from the database: events came and the workflow did not run (real break, stays red) or the workflow ran and the receipt writer failed (fix the writer). No `wf:` row stays red with "unknown". |
| 4 | Hourly money beats | New beats `funding-trip` and `partner-trip` (from `trip:funding`, `trip:partner`) plus a beat for each of the W1 and W2 money checks that has none. `src/pulse/beats/index.mjs` lists them literally. Each has `selfTest.pass` and `selfTest.fail`, a fix guide, and `covers`. `npm run pulse:prove -- --beats` runs all of them green or red by truth, 0 cut, 0 refused SQL, 0 sends. At least 14 beats. |
| 5 | Money and customer routes proved | For existing money and customer routes: a fake-data test that calls the real handler and judges the exact result, or it stays in NOT PROVED with the reason. Tests only; no product code changes. The count left in NOT PROVED is written in the manifest and is lower than today's. |
| 6 | The older 2,690 rows re-scored | `src/pulse/catalog/generated.json` totals match the lists (rows, none, ping, e2e, deep) from a fresh compile, and the compile is committed. Claude re-runs `node scripts/pulse/compile-catalog.mjs` and the output is identical. |
| 7 | Real breaks stay visible and named | These stay red, by name, in BROKEN: `meta-sync` (token cannot be decrypted), `clickfunnels-night-job`, `ads-number-unmapped`, `calls:booked-no-outcome`, `calls:booked-no-join-link`, `finance-os-setup:price-set`, `bureau-config:complete`. Bram's repair file stays red and is not acted on. No real break is turned green, skipped or moved to NOT PROVED to make a number look better. |
| 8 | Clean code gates | See section 3, gate G. |

## 3. How Claude will test (written first, so nobody argues later)

Claude checks out the review branch in a fresh work folder and runs all of this. Codex's manifest is a claim; these are the proof.

**A. Build gates.** `npm run lint` parses clean. `npx tsc --noEmit`: no new error beyond the known `src/marketing/filmed-receive.mjs:159`. `npm test`: no new failure beyond known baseline; **no test skipped, deleted or weakened** (Claude diffs the test files). New check files each have a PASS and a FAIL test.

**B. Bundle proof.** `npm run pulse:prove` says OK: every lane answered, no step over 20 s, no SQL error, nothing tried to write, `audit:expected-present` all present, 0 unexplained "not checked". `npm run pulse:prove -- --beats` says OK with at least 14 beats.

**C. Breaks-when-broken.** For items 2, 3 and 4, Claude breaks the logic on purpose (make a real break file under NOT PROVED; make the receipt check always pass; make a beat always pass) and confirms a test goes RED. Then restores.

**D. Read-only and secrets.** Claude greps the diff for INSERT/UPDATE/DELETE/DDL, non-GET fetches, sends, events, `process.env` key reads in beats, secret-shaped strings, and any change to a key or a `.env`. Any hit fails the whole build.

**E. Honest counts.** Claude recomputes BROKEN and NOT PROVED from `generated.json` and the scorecard rows by hand and compares to the manifest. A number that does not match fails item 2.

**F. Live proof (after Chris says ship).** Claude merges, ships, then reads `pulse_beats` and `pulse_scorecards` on the live server, read only: the new beats tick at the next :07; the next 6 a.m. scorecard shows two counts; the 7 named breaks are still red; no real break vanished.

**G. Clean code gate.** Claude measures: no new page, route or screen file appears; new beat files are only the ones item 4 names; lines added vs removed; any new file over 400 lines; any new lane that copies another lane's SQL (diff for near duplicates); any lane without a test pair; any new dependency in `package.json`. Rule of thumb Claude applies: if the same result can be produced by data in the catalog, a new hand-written lane is a fail.

## 4. Who owns what

- Codex: builds items 1 to 7, writes the manifest, opens one draft PR. Does not merge, push to main, or deploy.
- Claude: runs section 3, reports pass or fail per item in plain words, merges and ships only after Chris says go, then does the live proof and deletes the review branch.
- Chris: says go to ship. Sets the owner numbers only he can set (FinanceOS setup price, stage time limits, commission pay day). Nothing else.
