# Claude's test of Codex PR #41 — 2026-10-13

Tested from a clean checkout of `codex/heartbeat-eight-items-build-2026-10-13` @ `ce3aac2bc` against the written plan in `ops/workflows/codex-build-claude-test-2026-10-13.md`. Tester: Claude (Opus 5.5). Nothing was merged, shipped or changed.

## Verdict: NOT ready to ship. 6 of 8 items pass. 2 need work. Plus 3 urgent live breaks found while testing (not caused by the PR).

| # | Item | Result | Proof |
|---|---|---|---|
| 1 | Display lane | PASS | Lane ran 1,123 rows from compiled data, no throw, no repo file read. |
| 2 | Broken vs Not proved | FAILS ITS PURPOSE | 460 rows moved to Not proved (310 routes, 123 flow, 27 reads). But 1,113 of the 1,209 "Broken" rows are display rows that say "no exact safe action/result contract is attached yet". That is "not proved", filed as broken. Real broken is about 96. The guard works: I made a real break file under Not proved and `named-real-breaks.test.mjs` went red. |
| 3 | 42 workflow receipt reds | PASS, with a bigger finding | All 42 are events that test suites wrote straight into the live `events` table. Nothing sent them to the engine, so no workflow ran. See urgent break C. |
| 4 | Hourly money beats | PASS | 15 beats load from the real bundle, 0 cut, 0 refused SQL, 0 sends. I made a failing money check pass on purpose and 3 tests went red. Caution: `money-funding` is red on 9 "funded rounds" that are fake test rows (break C), so shipping it now texts a false alarm. |
| 5 | Route proofs | PASS (small) | 316 to 310 not-proved routes; 6 real handler proofs. Honest count. |
| 6 | Recount | PASS | Two fresh compiles gave the same hash (`8d3bee44…`); git diff clean. |
| 7 | Named real breaks stay red | PASS by test | 4 of 7 show red in a Mac run. `meta-sync`, `clickfunnels-night-job`, `finance-os-setup:price-set` do not print in a Mac run on main either; confirm on the live report. |
| 8 | Clean gates | NEEDS WORK | Lint clean. Suite 21,916 pass, 0 fail, no test skipped, deleted or weakened. No write, send, secret or new dependency in the diff. BUT: the branch conflicts with main in 9+ files (main moved 19 commits); it changed a product file outside scope (`public/app/agent-editor.html`, a load-order fix); and the self-audit row `audit:na-verified` is red (27 rows) on main and on the PR, and once timed out on 224 rows under load. |

Numbers, Mac run: main today = 1,675 red. PR = 1,209 Broken + 460 Not proved.

## What Codex must do before a re-test

1. Rebase on main and resolve the conflicts.
2. Make the display lane's "no exact contract attached yet" rows Not proved, not Broken. Target: Broken shows only measured breaks (about 96 today).
3. Explain or fix `audit:na-verified` (27 failing rows; the time budget that let 224 fail once).
4. Take the `agent-editor.html` change out, or get Chris's yes for it.

## Urgent live breaks found while testing (read only; none caused by PR #41)

A. **No text can leave. Since Oct 10, 12:07 p.m. Arizona.** The hourly `vendor-keys` beat: "Twilio refused our text key (HTTP 401)". Our stored Twilio values have not changed since August (Netlify shows last change 2026-08-07 and 08-14), so the change is on Twilio's side. The morning and evening texts have not gone out for 79 hours; 6 texts failed. The heartbeat cannot text Chris.

B. **Welcome messages are missing from the live database.** `EMAIL-S00-WELCOME`, `SMS-S00-WELCOME`, `EMAIL-S04-01-CONFIRM`, `CONTRACT-SEND-EMAIL`, `SMS-DOC-01-REQUEST` are not in `message_templates` (188 rows, 0 of those 5). `email-path` went red Oct 11, 11:07 p.m. Arizona. The table's last change is Oct 12, 11:12 a.m. Arizona, the same minute as the last fake client in C. A new lead gets no welcome email or text.

C. **Test suites were run against the live database.** Oct 11, 9:40 p.m. to Oct 12, 11:12 a.m. Arizona: 116 fake clients (`example.com`, `is_demo` false, codes `FH-000688` to `FH-000841` and `csmq-*`), 21 fake funding rounds, and test events. That is the source of the 42 workflow reds and of the false "9 funded rounds with no bill". `CLAUDE.md` section 12 says database tests are scratch-only. Cleaning this up deletes data, which needs Chris's yes.
