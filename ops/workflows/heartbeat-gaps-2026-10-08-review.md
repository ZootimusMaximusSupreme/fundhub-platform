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

## Results

(filled in when the review ends)
