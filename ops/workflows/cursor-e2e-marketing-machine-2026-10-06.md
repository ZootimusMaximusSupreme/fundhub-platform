# Cursor prompt — end-to-end test of everything built 2026-10-05/06 (marketing machine, teleprompters, bridge, FinanceOS)

Paste everything below the line into Cursor (Claude model, agent mode, repo `/Users/chrisstanbridge/Developer/fundhub-platform`).

---

You are testing, end to end, everything Fundhub shipped on 2026-10-05 and 2026-10-06. Read `CLAUDE.md` first; it is law. Talk to Chris in 4th-grade English. **Test only — do not fix anything in this pass.** Write every result to the scorecard and stop.

## What was built (read these, do not guess)

- Board and every unit: `ops/workflows/marketing-machine-2026-10.md`, `ops/workflows/finish-builds-2026-10-05.md`, `ops/workflows/perfect-machine-2026-10-05.md`
- Spec and design: `docs/specs/marketing-machine-2026-10-04.md`, `docs/specs/command-center-design-2026-10-05.md`, `docs/specs/command-center-tabs.md`, `docs/specs/marketing-machine-api.md`
- Test method that already works (driving the button code without a password, wake adapters, dry-run settings, safety): `docs/specs/blueprint-funnel-test-plan-2026-10-06.md` §0 and §8
- Teleprompter: `docs/specs/teleprompter-requirements-2026-10-06.md`, `public/app/teleprompter.html`, `tools/teleprompter-ios/README.md`
- The Claude Code bridge: `src/agents/claude-code.mjs`, `src/marketing/run-queue.mjs`, `scripts/marketing-run-queue.mjs` (`MARKETING_AI_RUNNER=local` is set on Netlify)
- Ship log: `ops/ship-log.md`. Live: https://fundhub.ai

## Rules for this test

- **Never type Chris's password** and never mint a session in the auth tables. Drive owner-only routes the way the Blueprint test plan §0 does (run the shipped route code from a worktree pinned to the live commit, with the production database).
- **No API spend.** The Anthropic API account has no credit by owner choice. Every AI job must run through the bridge: queue it from the route, then `npm run marketing:run-queue -- --once` on this Mac.
- Never change an existing live page. Never create a Meta ad or turn one on. Never message a customer. Never move money. Never delete data. Never remove a key. Production reads are SELECT-only (`BEGIN READ ONLY`).
- One known red test is not a failure of this work: `src/http/climate-match.test.mjs` (owner question).

## Test list, in this order

1. **Ship and health.** `https://fundhub.ai/api/health` reads pending 0. The live commit equals the last line of `ops/ship-log.md` and `origin/main`.
2. **CI.** The newest GitHub Actions run on `main`: name every red test. Anything red besides the climate test and the 4 known `must be owner of table` hook errors is a FAIL.
3. **Command Center page.** Load https://fundhub.ai/app/marketing-command-center.html with Playwright at 390x844 and 1280: logged out it must send you to login with zero console errors. Then render every tab (Today, Ideas, Scripts, Shoot, Launch, Numbers, Settings) with answers built from REAL rows (SELECT) and confirm no tab shows "This tab did not open", no fake number, no $0 where the data is unknown, no sideways scroll at 390px.
4. **Clock and worker.** `marketing_heartbeats`: the clock ticked in the last 20 minutes; the worker beat after the last queued job.
5. **The bridge, one real job.** Queue **Write ad copy** through its shipped route code. Confirm the job waits ("Waiting for your Mac"). Run `npm run marketing:run-queue -- --once`. Confirm the copy is saved, the copy checker ran, and the ledger shows $0 with model `claude-code`.
6. **The bridge, flywheel.** Retry the Blueprint avatar job `95c0a082-2d05-40a2-a884-1ecd70816619` (steps 1-3 are saved) through `POST marketing/flywheel/run` with `retry_job_id`, then run the queue. Record each step, its sources and its time. Do not start research or offer unless the avatar finishes.
7. **Scripts.** Queue **Write now** with count 1 through the route, run the queue, then approve the script through the route. Confirm: a new ad number of 91 or higher, the script in the Scripts list, the repo file waiting in `repo_outbox` (the GitHub token is not set, so "held: no_token" is correct).
8. **Shoot and teleprompter.** Make a shoot plan with that approved script (route code). Load https://fundhub.ai/app/teleprompter.html (Playwright, iPhone and iPad sizes, touch, answers from the real rows): tap pauses, tap resumes, double tap scroll mode, drag moves, hold a line edits it, the edit saves as a new version through the script edit route, offline edits wait and send, the status line says "Saved".
9. **Numbers.** Total Meta spend in `ad_metrics_daily` equals Meta ($1,563.13 through Oct 4, plus any days since). The Numbers tab's 7-day and 30-day figures match a SELECT over the same Arizona days.
10. **Launch safety.** The Launch tab and `POST marketing/meta/load` load PAUSED only and refuse without the needed ids. Do not actually load anything to Meta.
11. **iPhone app.** `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild test` for `tools/teleprompter-ios` on the iPhone 17 Pro Max and iPad simulators. Note what only a real phone can prove (camera 4K/60, Photos, remote, real login).
12. **Funnel builder (not live, by owner choice).** Confirm the Blueprint funnel `d6e3726c-d9ee-4dff-9721-268582ef1f9f` is still a draft and no apply.fundhub.ai page changed. Do not push it.

## Part 2 — FinanceOS (run after FinanceOS wave 5 is shipped)

Check first: `ops/workflows/finance-os-wave5-2026-10-06.md` must show every unit done and shipped. If any unit is not shipped, test what is live and mark the rest NOT RUN (not shipped).

Read: `docs/finance/finance-os-direction-2026-10-06.md` (owner vision wins), the boards `ops/workflows/finance-os-build-2026-10-06.md`, `finance-os-pages-2026-10-06.md`, `finance-os-wave3-2026-10-06.md`, `finance-os-wave4-2026-10-06.md`, `finance-os-wave5-2026-10-06.md`, and `docs/journeys/` for FinanceOS.

Extra rules: use sim clients only (never a real client's file); Plaid in **sandbox** only; no real money moves; no text or email to a real client (sim plus-tag email and the agent phone only, per `.cursor/rules/full-end-to-end-audit.mdc`).

13. **The page.** https://fundhub.ai/app/financeos.html (and the older /app/finance-os.html): every tab renders at 390 and 1280 with a sim client's real rows, no console errors, numbers match a SELECT.
14. **Turn on.** A paid setup fee turns FinanceOS on for that sim client; staff see the FinanceOS card and open it from the client control panel.
15. **Loans.** A loan gets a due date, a payment and reminders; the loan table shows on Overview; Plaid (sandbox) loan due dates fill in.
16. **Payments in.** A Commas payment marks the matching Clarity / BNPL installment paid; merchant processing pulls by API key (Commas, Whop) for the sim.
17. **Wave 5.** Waypoints timeline (`GET /api/money/plan`) shows dated pins from every plan source; bank strategy (`GET /api/money/banks`); fundability now / projected / per business (`GET /api/money/fundability`); payment strategy goal date to monthly amount (`GET/POST /api/money/strategy`); "Ready to get funded" hands off to the CSM with the Blueprint upsell; every "Do task" button works.
18. **The money agent.** Runs through the Claude Code bridge (no API spend): a role-play simulation with a sim client, shadow mode first; it proposes, it does not act alone.
19. **Plaid sandbox transfer.** Propose, the sim client approves, the transfer runs in sandbox, and events, ledger and limits are written. Nothing real moves.

## Output

Write `ops/workflows/e2e-marketing-machine-2026-10-06-scorecard.md`: one row per test above with PASS / FAIL / NOT RUN, the proof (SQL result, URL + status, file, CI run), and the time. Then a 5-line summary for Chris in 4th-grade English and the single next action. Commit the scorecard locally. Do not fix anything.
