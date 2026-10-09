# Heartbeat gaps — Claude review of Cursor's lanes (2026-10-08)

Chris asked: watch Cursor's heartbeat-gap batch, fill what it missed, double check every lane, prove it really works. Sonnet runs the review. Claude (Opus) checks the checkers.

Cursor's batch: `ops/workflows/heartbeat-gaps-2026-10-08/` (one file per lane) and `src/pulse/coverage/gap-<lane>.mjs` + test. 37 lanes. Cursor writes them on `main` in the main checkout, uncommitted.

## Who owns what

| Owner | Owns |
|---|---|
| Cursor | Writing each lane. Hooking the checks into the morning pulse (`run-slices.mjs` / `daily-pulse.mjs`). |
| This review | Reading each lane, fixing false passes and false alarms, filling missing breaks, running each check against the real database read-only. Edits only `gap-<lane>.mjs`, its test, and its lane board. |
| Not touched here | `registry.mjs`, `heartbeats.mjs`, `run-slices.mjs`, `daily-pulse.mjs`, HTML, other lanes. No commit until review ends. No sends. |

If Cursor has not hooked the checks in when the review ends, this review hooks them in (piece it missed).

## Live proof tool

`gap-live.mjs` (session scratchpad). It runs each lane's `gapChecks(ctx)` against the live database as `fundhub_app` inside `BEGIN READ ONLY`, with every write refused. Web calls are GET/HEAD only. It runs three ways:

- **prod** — the database handle the pulse uses, plus the staff scope, plus fetch, base URL and org.
- **staffdb** — staff access on every read. A status that differs from prod means the check cannot see the rows on the plain role.
- **bare** — only `{ db, scope, now }`, which is all `runCoverageSlices` passes today.

## First live run — 15:57, 35 lanes

- No writes. No blocked POST. No SQL errors.
- `ai-agents` sends `BEGIN READ ONLY` on `ctx.db`. In production that is the shared pool, so it can leave a connection stuck in a transaction. Must fix.
- `crm-links`: 9 of 11 checks skip in production. Staff reads answer 401 with no session, so they never test anything.
- In bare mode, 29 of 35 lanes go to skip. They need `orgId`, `fetchImpl` and `baseUrl` from the pulse. The hookup must pass them.
- Live FAILs right now: ads, email, fulfillment, jobs, partners, payments, portal, sms (1 each). Each one is a real break or a false alarm. The review decides which.

## Review groups (Sonnet)

| Group | Lanes | Status |
|---|---|---|
| 1 messaging | sms, email, nurture, webhooks | claimed |
| 2 login and portal | auth, portal, consent, soft-pull | claimed |
| 3 money | payments, banks, finance-os, partners | claimed |
| 4 funding | funding, underwrite, fulfillment, repair | claimed |
| 5 sales | calls, closer, meet, csm | claimed |
| 6 marketing | ads, pixels, funnels, marketing-queue | claimed |
| 7 files | documents, contracts, inquiry, brain | claimed |
| 8 ops | staff, training, owner-tools, jobs | claimed |
| 9 crm and ai | crm-links, ai-agents, social | claimed |
| 10 late lanes | opt-out, sales-manager | pending — Cursor still writing |

Each group: review and fix → an independent checker re-runs tests and the live tool and tries to prove the review wrong → one repair pass if the checker finds a problem. Then stop (stuck rule).

## Pieces Cursor missed — found 16:05–16:20

1. **No coverage check has ever run live.** The slice runner shipped 10-07. This morning's scorecard (6:01, 420 rows) had 0 coverage rows and no error. The runner finds files by a folder scan. The server bundle carries only `run-slices.mjs`. Cursor's 16:07 ship has 0 of 33 slice files and 0 of 37 gap files. So Cursor's line "tomorrow's heartbeat reports those reads" was not true.
2. **If they did load, the 6 a.m. text would die.** Netlify cuts each Inngest step at 26 s. Measured read-only on live data: pulse without coverage ≈ 6 s; slices + gaps ≈ 55 s; all in one step ≈ 61 s.
3. **15 checks are false alarms on the server only.** They read repo files at run time (route source, `netlify.toml`) or load a handler by a joined path. Laptop: PASS. Built bundle: FAIL (ENOENT / cannot find module). Lanes: finance-os (7), closer, csm, marketing-queue, training (2), payments (commas route), sales-manager.

## Fix (Claude, Opus) — owns these files

- `src/pulse/coverage/modules.mjs` — every slice and gap file by a literal import. `modules.test.mjs` fails when disk and list differ.
- `src/pulse/coverage/run-slices.mjs` — loaders use the list; `runGapLane` runs one lane.
- `src/pulse/daily-pulse.mjs` — takes `coverageRows` already run.
- `src/workflows/daily-pulse.mjs` — `coverage-org`, `coverage-slices`, then one `coverage-gap-<lane>` step per lane, then `run-pulse`. A dead step is one skip row.
- Proof: Netlify's own bundler (zip-it-and-ship-it) now packs 72 coverage files (was 1). Tests: runner + list 16/16, pulse + job 15/15.

## Results — 2026-10-08 17:55

All 37 lanes reviewed by Sonnet (30 agents, 0 died). Each group got an independent checker, and a repair pass where the checker found a problem.

| Group | Lanes | Status |
|---|---|---|
| 1 messaging | sms, email, nurture, webhooks | done |
| 2 login and portal | auth, portal, consent, soft-pull | done (reviewer came back empty; checker + repair did the work, auth edits restored from stash@{0}) |
| 3 money | payments, banks, finance-os, partners | done |
| 4 funding | funding, underwrite, fulfillment, repair | done |
| 5 sales | calls, closer, meet, csm | done |
| 6 marketing | ads, pixels, funnels, marketing-queue | done |
| 7 files | documents, contracts, inquiry, brain | done |
| 8 ops | staff, training, owner-tools, jobs | done |
| 9 crm and ai | crm-links, ai-agents, social | done |
| 10 late lanes | opt-out, sales-manager | done |

What the review fixed, in short: checks that could never fail, a failed read counted as a pass, a pool transaction leak (ai-agents), staff reads that only ever skipped (crm-links: 9 of 11), copies of checks the registry already runs, and server-only false alarms (source-file reads). Every lane now has PASS and FAIL tests.

Proof, from a Netlify bundle built with the real `netlify.toml` settings and unzipped, read-only on the live database:

- 37 lanes, 0 SQL errors, 0 write attempts, 0 refused POSTs.
- 39 coverage steps. Slowest 11.4 s (finance-os). None over 20 s. Netlify cuts at 26 s.
- Full morning brief built read-only: 970 checks, 662 green, 9 red, 299 not checked (was 420 checks).
- Tests: pulse + coverage + job 990 run, 986 pass, 0 fail, 4 skip (need a local Postgres).

Real breaks the new checks catch today (not fixed — product, owner hard lock):

1. A real lead captured 2026-10-02 never got the welcome text or email (client 0dd6d7f4…). `gap:sms-journey-zero`.
2. The roadmap drip steps people forward even when no email queued. Everyone shares the key `workflow:<template>:null`, so the second person at a step gets nothing. `email:drip-step-no-email`, `email:morning-no-failure-check`.
3. Paying repair client FH-000507 stuck in analysis since 2026-10-05 (1 hour clock), no letters, no next step on the screen. `fulfillment:next-action`, `repair-letter-round`.
4. Company Brain has not embedded anything since about 2026-09-18. `brain:embed-key`.
5. Email unsubscribe links cannot be signed. `UNSUBSCRIBE_TOKEN_SECRET` on Netlify production is a 20-character mask that starts with `*`, so email goes out with no unsubscribe link. `opt-out:unsubscribe-link`. Not overwritten (never remove or replace a key); Chris's call.

## Shipped

- `81b50d23` shipped 2026-10-08 18:44 (`bbbc6288` ship log). Health: pending 0. Inngest re-registered. The live api bundle carries all 72 coverage files (37 gap). Local `main` = GitHub `main`.
- The test text to 480 was NOT sent. Twilio answered 401 "invalid username": `TWILIO_SEND_ACCOUNT_SID` and `TWILIO_SEND_AUTH_TOKEN` are masks in `.env`, `credentials/env.full.snapshot`, and Netlify (stored as `--secret`, so the CLI never returns them). The live site still has the real values; this morning's text went out at 6:01 to the number ending 0865.

## Leftovers (not this hole — not fixed)

- Every function zip carries the laptop `.env` at its root (14 of 14, older than today). Likely `scripts/load-env.mjs` (`path.join(ROOT, ".env")`) is reachable from function code, and nft packs the file. `"!credentials/**"` does not cover it.
- `src/lib/no-unfenced-transmit.test.mjs` still fails on `src/pulse/funnel-doors.mjs` and `src/pulse/instant-watch.mjs` (failing before today). Today's 19 lanes and 2 conduits were read and listed.
- `scripts/daily-pulse.test.mjs` pins an exact count of staff-scope calls; it failed before today and fails by more now.
- Failing before today, unrelated: diagrams and journeys generators stale, climate page copy, read-endpoint org scope, journeys runner registry, repo edit-ops, workflow index pin. `npx tsc` error in `src/marketing/filmed-receive.mjs`.
- The morning text layout Chris called bad at 3:14 pm is unchanged, and its "Full report" link (`/app/morning-brief.html`) still answers 404.
- Cursor's stashes `stash@{0..6}` are still in the stash list. Nothing in them is newer than the files on disk.
- The laptop has no working Twilio send keys (see Shipped). No agent on this Mac can text Chris until the real SID and token are back in `.env`.
- `claude/creator-incentive-program-6s4371` is rejected on every full push (GitHub has a newer tip). Left alone.
