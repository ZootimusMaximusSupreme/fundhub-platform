# Heartbeat finish — 2026-10-18 Arizona

Owner order: fix the broken rows and finish the proof backlog. Money and customer delivery come first. Do not weaken checks, write to production, send customer messages, or run a real charge just to turn a row green.

## Ground truth

- Full built catalog: 3,975 mapped rows, 3,942 unique checks, 3,919 wired, 23 catalog-red.
- Last stored production scorecard: 2026-10-17 6:02 a.m. Arizona, 1,922 rows: 725 working, 78 broken, 853 not proved, 1 unchecked, 265 nothing to judge.
- Current integrated offline proof inventory: **52 not proved**, measured 2026-10-18 with `node scripts/pulse/count-not-proved.mjs` after the route, climate, Present, and one-off sender repairs:
  - routes: 7
  - display controls: 45
  - flows: 0
  - reads: 0
- The old 853 number is a stale production scorecard. Claude's 26 merged batches removed 796 of those proof gaps in the current code.
- Initial production-like read-only pulse, before today's proof repairs, with the workflow registry included: **1,409 rows = 948 green + 112 broken + 57 not proved + 281 nothing to judge + 68 not checked**.
- Current inventories are saved for this run at `/tmp/heartbeat-current-scorecard.json`, `/tmp/heartbeat-not-proved-2026-10-18.json`, and `/tmp/heartbeat-red-{money,messaging,customer,plumbing}.json`.

## Workflows

| Lane | Owner | Scope | Dependency | Status |
| --- | --- | --- | --- | --- |
| A | this session | exact inventory, shared board, CI/ship gate, integration, final proof | first inventory, then integrates all lanes | active |
| B | agent | 23 money/payment broken rows | none after inventory | active |
| C | Mill + integration | 31 email/SMS broken rows | none after inventory | complete: SMS duplicate guard repaired; 30 live/config/human rows remain honestly red until their named action |
| D | Kepler + integration | 38 customer record/journey broken rows | none after inventory | complete: 4 shipped fixes and 2 exact workflow proofs; 32 live/human/external rows remain honestly red |
| E | agent | 20 staff/plumbing broken rows | none after inventory | active |
| F | Feynman | 45 display proof gaps | none after inventory | complete: 45 confirmed product defects |
| G | Rawls | 9 route proof gaps | none after inventory | complete: 2 proved, 7 confirmed product defects |
| H | Ohm + this session | 1 flow and 2 read proof gaps | none after inventory | complete: climate measured red; Present and one-off sender controls repaired and proved; 0 proof gaps remain |

B–H run together. A waits only for the exact current pulse result, then integrates, runs targeted tests, runs the full guard set, and verifies the ship gate. Each repair stays in its own worktree or agent branch. The dirty main checkout and unrelated iOS/auth files are off limits.

## Copy-paste prompts

### B — money and payment reds

Read `AGENTS.md`, `CLAUDE.md`, `docs/journeys/heartbeat-flow.md`, the relevant money journey, and this board. Work only on the exact money/payment broken rows listed under Current inventory. Use the existing check that found each break. Fix the smallest product cause, add or strengthen focused proof without weakening any guard, run the same check plus targeted tests, and report named files and commands. Use your own worktree. Do not run a real charge, write production data, send a customer message, touch `.env`, or modify unrelated dirty files.

### C — email and SMS reds

Read `AGENTS.md`, `CLAUDE.md`, `docs/journeys/heartbeat-flow.md`, the intended messaging journey, and this board. Work only on the exact email/SMS broken rows listed under Current inventory. Preserve opt-outs and provider safety. Repair templates, lookup, routing, or receipt reads with the smallest diff. Prove with fake sinks, saved receipts, or owner-only evidence; do not send a customer message. Use your own worktree and report named files and commands.

### D — customer record and journey reds

Read `AGENTS.md`, `CLAUDE.md`, `docs/journeys/heartbeat-flow.md`, every relevant `*-intended.md` journey, and this board. Work only on the exact customer-record/journey broken rows listed under Current inventory. Do not rewrite intended journeys to excuse code. Fix the smallest product cause and prove the final saved result. Use stand-in records or a scratch database only; never write production customer data. Use your own worktree and report named files and commands.

### E — staff and plumbing reds

Read `AGENTS.md`, `CLAUDE.md`, `docs/journeys/heartbeat-flow.md`, and this board. Work only on exact non-money, non-message, non-customer broken rows listed under Current inventory. Fix routing, time budgets, environment reads, jobs, or staff-only surfaces with the smallest diff. Re-run the original red check and targeted tests. Use your own worktree and do not touch unrelated dirty files.

### F — display proof gaps

Read `AGENTS.md`, `CLAUDE.md`, `docs/journeys/heartbeat-flow.md`, `ops/workflows/finish-853-2026-10-14/BRIEF.md`, and this board. Own only the 45 IDs in `/tmp/heartbeat-not-proved-2026-10-18.json` whose lane is `gap-catalog-display`. Prefer real saved-result read-only contracts that can go red; otherwise attach an exact fake-data test and mutation-check it. Never clear a row with a name-only match or generic completeness test. Use your own worktree. Return openBefore/openAfter, named files, and tests.

### G — route proof gaps

Read `AGENTS.md`, `CLAUDE.md`, `docs/journeys/heartbeat-flow.md`, `ops/workflows/finish-853-2026-10-14/BRIEF.md`, and this board. Own only the 9 IDs in `/tmp/heartbeat-not-proved-2026-10-18.json` whose lane is `gap-door-batch-routes`. Attach each exact handler to an executable route proof that checks the promised outcome. Do not clear a route with a nearby route's test. Use your own worktree. Return openBefore/openAfter, named files, and tests.

### H — flow and read proof gaps

Read `AGENTS.md`, `CLAUDE.md`, `docs/journeys/heartbeat-flow.md`, `ops/workflows/finish-853-2026-10-14/BRIEF.md`, and this board. Own only the 1 flow and 2 read IDs in `/tmp/heartbeat-not-proved-2026-10-18.json`. Attach an exact final-result flow recipe or safe read proof that can go red. Do not send messages or write production. Use your own worktree. Return openBefore/openAfter, named files, and tests.

## Current inventory

- Broken rows: 112 total — 23 money, 31 messaging, 38 customer records/journeys, 20 staff/plumbing.
- Not proved: 57 total — 45 display, 9 routes, 1 flow, 2 reads.
- Not checked: 68 total — the 57 explicit proof gaps above plus 11 additional rows. The extra 11 include one event-only no-op, one auth reset-mail read, two consulting-journey rows whose old N/A reasons expired, two role-gated links, and five key/config reads.
- Current report: `ops/workflows/pulse-2026-10-18.md`.
- This is a fresh read-only run. It sent no message, wrote no production row, charged no money, and created no customer result.

## Integration log

- 2026-10-18: protected the existing dirty checkout; no unrelated file is assigned to this workflow.
- 2026-10-18: confirmed the 26 Claude batches are present and measured 57 remaining proof gaps, not 853.
- 2026-10-18: ran the full production-like pulse read-only with the workflow registry; measured 112 broken and 57 not proved. The old 78/853 scorecard is stale.
- 2026-10-18: started Feynman (display), Rawls (routes), and Ohm (flow/read). The agent limit is full; B–E start as these finish.
- 2026-10-18: started the money, messaging, and customer-record lanes when the next three agent slots opened. Staff/plumbing remains queued for the next free slot.
- 2026-10-18: merged current `origin/main` into the isolated integration branch, preserving the iOS launch and UX notes. Four stale focused failures were reduced to three corrected fixtures plus the route sample owned by lane G; all three corrected focused files pass.
- 2026-10-18: F proved the 45 display gaps are 45 concrete shipped-control defects and left every one honestly red. G attached 2 exact route proofs and isolated 7 endpoint defects. H attached the climate read and isolated 2 remaining product gaps. Integrated total is now 54 not proved: 45 display, 7 route, 1 flow, 1 read.
- 2026-10-18: started staff/plumbing lane E plus product-repair batches for display rows 1–6 and the seven remaining route defects.
- 2026-10-18: repaired Present's two incomplete send controls: delivered letter packs now read `FHData.data`, and soft-pull sends use the shared Sending / cooldown / Sent-at UI. The full rendered send-lock proof passes 8/8. Integrated proof backlog is now 53: 45 display, 7 route, 1 flow, 0 read.
- 2026-10-18: repaired the three hand-run one-off sender scripts with one explicit `--send` fence and an append-only, script-tagged final receipt that stores counts and provider references without message copy or destination addresses. The focused sender proof passes 4/4, the complete flow monitor passes 24/24, the flow/read shard passes 2/2, and the integrated proof backlog is now 52: 45 display, 7 route, 0 flow, 0 read.
- 2026-10-18: integrated customer/journey lane D. Added the missing private-leads page, restored real outlines for all 50 states plus DC, repaired two workflow final-result paths, and added exact tests. The integrated focused page/workflow command passes 5/5. No production customer row was changed; 32 rows still require the named live, human, provider, or owner action and remain red.
- 2026-10-18: integrated messaging lane C. The SMS dispatcher now blocks same-batch and recent sent/delivered duplicate copy to the same normalized phone before Twilio. The integrated messaging, dedupe, and push command passes 84/84. No message was sent; 30 rows still require live data, configuration, templates, provider evidence, or human decisions and remain red.

