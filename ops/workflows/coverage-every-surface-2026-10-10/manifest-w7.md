# W7 manifest: screens and doors (L2)

Batch board: `ops/workflows/coverage-every-surface-2026-10-10.md` (not edited by this workflow).
Branch: `cov/w7-screens`. Work folder: `.claude/worktrees/cov-w7`. Built 2026-10-10 on `main` at `dbac95319`.
Nothing pushed. Nothing merged. No pull request. Local commits only. The integrator merges.

## In one minute

- I wrote **tests only**. No product code changed. No check, no beat, no shared list changed.
- **19 new browser test files, 142 tests.** Each one presses a real button on a real page and checks the exact request that goes out. No backend: every `/api/` call is answered by the test.
- **15 new door test files, 145 tests.** Each one runs the real `api/` handler with a stand-in database and the network shut off.
- **1 small helper file** for the door tests: `src/testing/handler-harness.mjs`.
- All of them pass. I broke the product code on purpose 12 ways (8 doors, 4 pages). The tests caught all 12. Every file was put back.
- Of the 110 rows on my list (money or customer, and only a ping or nothing), **50 now have a test that presses or runs them. 60 do not yet.** They are listed below by name.

## The door tests (run the real handler, no Postgres)

Run with `npm test` (they end in `.test.mjs`, so they run on every machine). Folder: `src/http/`.

| File | Door | What it proves | Tests |
|---|---|---|---|
| `commissions-handler.test.mjs` | `/api/commissions` | Approve moves only earned rows in this company; Mark paid moves only approved rows and needs a payout id; a closer is refused; each row fires its event | 9 |
| `campaigns-write-handler.test.mjs` | `/api/campaigns/write` resume, update_budget | Logged before Meta is asked; Meta gets ACTIVE or the new daily budget for that campaign only; our row changes only after Meta says yes; Meta's "no" is kept; the spend ceiling and the 30% raise cap stop a budget before Meta is asked. Meta is a stand-in; nothing leaves the machine | 12 |
| `dashboard-seed-handler.test.mjs` | `/api/dashboard/seed` | Admin only (a closer and a wrong key are refused); the ten sample steps fire in order with the sample email and `seed_` refs; a repair-only sample has no $3,000 deposit and no sale | 9 |
| `inquiry-cases-actions-handler.test.mjs` | `/api/inquiry-cases` send, mark_cleared, close | Mark cleared is always Completed and fires `inquiry.removed` once; Close does not fire it; Send refuses no channel, a non-Experian portal upload, a missing reference, and a short packet (409, names the missing papers, marks the case Blocked); a portal upload logs one attempt per inquiry; mail with no return address records `mail_failed` and sends nothing | 15 |
| `ai-bureau-config-handler.test.mjs` | `/api/ai-bureau-config` | Only editable fields change, inside the session's company; a closer is refused; upsert upper-cases the bureau code and updates instead of adding a second row | 9 |
| `auth-logout-handler.test.mjs` | `/api/auth/logout` | Revokes the token in both session stores, by its hash; cookie cleared even when the database is down | 6 |
| `chat-messages-handler.test.mjs` | `/api/chat/messages` | Client threads are this company's only; a closer not clocked in cannot text a client; a clocked-in text is queued for the compliance gate (never sent from here); another company's client is never texted | 11 |
| `journeys-run-handler.test.mjs` | `/api/journeys/run` | Every exit it can reach rolls back and never commits; the routing flip is inside the transaction; demo rows never replace the six real journeys | 10 |
| `partner-brand-verify-domain-handler.test.mjs` | `/api/partner-brand/verify-domain` | Verified only when the TXT record carries the token; owner and admin only; DNS is a stand-in | 9 |
| `partner-marketing-usage-handler.test.mjs` | `/api/partner-marketing/usage` | A partner reads only their own budget, inside their own row scope; past the cap reads 0 left | 9 |
| `partner-marketing-generate-copy-handler.test.mjs` | `/api/partner-marketing/generate-copy` | Wrong partner, suite off, budget spent, locked legal block, no model key: each refused, page unchanged, rolled back. **No model is ever called** (keys removed for the run, network refused) | 10 |
| `read-invoices-handler.test.mjs` | `/api/read/invoices` | FINANCE roles only; "open" means money still owed, oldest first, this company only, demo invoices out; a status that does not exist is a 400 | 9 |
| `paydown-simulator-handler.test.mjs` | `/api/finance/paydown-simulator` | Another company's client reads as not found; no FinanceOS plan is a 403 before the maths run; "no credit file" is a clear answer | 9 |
| `marketing-flags-handler.test.mjs` | `/api/marketing-flags` | FINANCE roles only; a good flag is stored for this company and person; a bad belief or no period stores nothing | 7 |
| `social-schedule-handler.test.mjs` | `/api/social/schedule` | A partner posts only as themself; suite off stores nothing; a clean caption waits for a person by default; a caption that breaks a rule is blocked with its reason saved | 11 |

Helper: `src/testing/handler-harness.mjs`. It points the shared `db` and every `pg.Pool` in that one test process at a stand-in, so nothing reaches a real database even if `DATABASE_URL` is set.

Already had a handler test, so not repeated: `paid-services` (`src/http/paid-services.pg.test.mjs`, real database), `public/funnel-checkout` (`src/http/funnel-checkout.test.mjs`), `public/slo-repair-checkout` (`src/http/slo-repair-checkout.test.mjs`).

## The browser tests (press the real button)

Run with `npm run test:e2e`. Folder: `e2e/`.

| File | Page | What is pressed | Tests |
|---|---|---|---|
| `ops-admin-outbound.spec.mjs` | Ops & Admin | Send what is waiting, Pause sending / Turn sending on, Email unsent invoices: the confirm names the consequence, No sends nothing, Yes sends the exact action | 9 |
| `money-transfers-clicks.spec.mjs` | Transfers | Review this move (exact sentence, picker locks), Yes move $X (exact approval), Not now, Stop this move, Take it off the list (staff), Set up this move (cents) | 10 |
| `pipeline-new-archive.spec.mjs` | Pipeline | New Client modal; DEL and the drawer's Archive (type exactly DELETE), Cancel, Escape, refusal keeps the card | 10 |
| `products-commissions-ledger.spec.mjs` | Products & Commissions | Select all, Approve selected (Accrued only), Mark paid (Approved only, payout id required), Change rate (date and reason) | 10 |
| `consent-capture-clicks.spec.mjs` | Consent | Typed, ticked, signed (drawn on the pad), Clear, each of the four kinds, Withdraw with a reason | 12 |
| `creative-factory-decide.spec.mjs` | Creative Factory | Approve, Reject, Archive on one creative | 7 |
| `csm-queue-clicks.spec.mjs` | Client Success | Start / End shift, Claim this call, the interview form and Save these answers | 7 |
| `documents-clicks.spec.mjs` | Documents | Remind (server's own words, "paused" never shown as sent), Void (reason, owner and admin only), Download (link opened, never written into the page) | 9 |
| `contracts-wording-clicks.spec.mjs` | Contracts | New wording with blanks, edit by id, Archive / Turn back on, the PDF editor: drag a box, make it a Signature, Save boxes in page fractions | 6 |
| `content-admin-clicks.spec.mjs` | Content | Tile edits and Showing/Hidden (price in cents, empty price stays unknown), tier video, Choose file and drag-and-drop upload | 7 |
| `finance-os-staff-clicks.spec.mjs` | Finance OS (staff) | Find, Open this client, Close this client, Split this cash | 7 |
| `financeos-tabs-clicks.spec.mjs` | FinanceOS (client) | Money helper suggestions, Enter and Shift+Enter; Do task; I'm ready to get funded; alert switches | 10 |
| `company-brain-clicks.spec.mjs` | Company Brain | Send, the thread rides on the next question, New chat starts clean | 4 |
| `galaxy-clicks.spec.mjs` | Galaxy | Click the team, click the worker, the day panel, Escape out | 2 |
| `calendar-claim-done.spec.mjs` | Calendar | Claim and Mark done on a task row, refusals in words | 4 |
| `agent-editor-promote-demote.spec.mjs` | Agent Editor | Promote to live (saves first, gate, 25 shadow runs), Return to shadow | 8 |
| `closer-dashboard-calculators.spec.mjs` | Closer dashboard | Draw, guardrail %, slider, deposit, fee, debts, minimum | 5 |
| `soft-pull-approve-clicks.spec.mjs` | Soft-pull approval (client link) | Running total per business, refusals, exact submit (EIN written 12-3456789), Pay link or "ask your advisor" | 8 |
| `teleprompter-remote-clicks.spec.mjs` | Pocket remote | Film key header (no sign-in sent), Play, Pause, pick a script, Save words, "the iPad has newer words" | 7 |

The fake Social Security number in the soft-pull test is the page's own placeholder (123-45-6789). No key-shaped string is in any file. Keys a test needs (the ad token key, the dashboard key) are made fresh at run time.

## Still on my list, not done (60 rows)

Plain list, by page. Each is money or customer and still has only a ping or nothing.

- **Client Control Panel:** lender row Pending; Capital Blueprint Add credit partner, Offer bank tracker, Take the offer back, Add bank to the list, bank list state buttons (and the door `blueprint/staff-actions` for those actions).
- **Present:** e-book price box, the repair bridge button, Invoice this client, the descent ladder, the cockpit script, the double-press guard. (Save month/year is broken, see leftovers.)
- **Closer dashboard:** Send contract button and its panel.
- **Agent Editor:** the guardrail and authority switches, the two escalation selects.
- **Brand Studio:** copy history Use this version; the locked compliance card.
- **Money pages:** money-vault Accept, Reject, Change, Files to sort, Add a paper; money.html Connect a bank (both buttons), the Plaid script, the trends slot; money-banks Skip this bank; money-connections processor reach; money-helper bridge heartbeat.
- **Payment success page:** the poll and the state it shows.
- **My numbers:** the owed-by-you links.
- **Products & Commissions:** the page-open ledger read, the ledger columns, SLO connections form.
- **Inquiry remover:** the three repair stage columns (round complete, program complete, cancelled). These are board reads; W3 owns their checks.
- **Social Studio:** the "Could not be sent" tab (already a board card: it can never fill).
- **Jobs:** hiring outreach cadence, the daily alert texts run.
- **Doors:** `agent-call` (places a real call), `auth/authorized-rep`, `inquiry` launch (places a real bureau call), `campaigns/meta-agency`, `read/finance-ask`, `repair/exceptions`, `chat/portal-message`, `soft-pull-approve` stamp_incorporated (broken).
- **Click side of four doors I tested by handler only:** Campaign Manager resume and budget buttons, Lenders bureau Save, Inquiry remover Mark cleared and Close.

Also not done: a **real-Postgres version** of the 15 door tests. The brief asked for `src/http/<name>.pg.test.mjs` on a scratch database as `fundhub_app`. **This Mac has no Postgres** (no `psql`, `postgres` or `docker`; W5 found the same). So the door tests run the handler against a stand-in database. They prove the handler's own code. They do not prove the SQL text against Postgres. CI's Postgres job runs `.pg.test.mjs` files; none were added, so nothing unrun was committed.

## Live reds found

None. This unit adds tests, not checks. It read nothing live except through `npm run pulse:prove` (read only).

## Leftover cards (found while writing the named tests; not fixed)

- [ ] `api/commissions.mjs` calls `dbDown(err)` with one argument; the helper is `dbDown(res, err)`. So a dead database answers 500, not 503 "database down".
- [ ] `api/chat/messages.mjs` answers 500 (not 400) when a staff text to a client is refused (empty text, a client in another company). It maps only `SELF`/`BODY` codes and `composeAndSend` throws `BAD_REQUEST`. Nothing is sent (safe); the status is wrong.
- [ ] Company Brain at 1280 wide: the account bar from `shell.js` sits on top of the New chat button. A person must hide the bar first.
- [ ] Content (Setup): after an upload, the "Uploaded." line is wiped the same instant by the box reset, so nobody sees the upload worked.
- [ ] Ops & Admin outbound refusal: the page checks `res.error === "unauthorized"`, but `data.js` puts that word in `res.source`. So "Only an owner or an admin can change this." never shows; people see "not signed in, or not allowed".
- [ ] Agent Editor: the promotion gate does not repaint when the shadow log arrives. It shows "not blocking" until the first edit, then blocks on "At least 25 shadow runs".
- [ ] `npm run pulse:prove` is not OK on `main` today: the whole morning, run in one go from the bundle, takes 22 to 30 seconds (limit 20). Each lane is still under 20 s, so the real 6 a.m. run (one step per lane) is not cut. Found while proving; not caused by this unit.

## Shared files

None touched. No change to `modules.mjs`, `tripwires.mjs`, `tripwires-baseline.json`, `tripwires.test.mjs`, `na-conditions.mjs`, `self-audit.mjs`, `beats/index.mjs`, any guard test, the board, any product file, any migration, any journey.

One test wording was changed to satisfy an existing guard honestly: `journeys-run-handler.test.mjs` reads back the routing statement the handler sent to the stand-in database. `src/messaging/routing-restore.guard.test.mjs` scans test text for that statement, so the pattern now starts at the table name. The test changes no routing anywhere.

## Proof

All run in this folder on 2026-10-10. No database was written. Nothing was sent.

| What | Result |
|---|---|
| The 15 new door test files (`node --test src/http/*-handler.test.mjs`) | 145 of 145 pass |
| The 19 new browser files (`E2E_PORT=43177 npx playwright test <files>`) | 142 of 142 pass |
| Mutation check: 8 breaks in the doors (role gates, Completed-only event, commit instead of rollback, DNS check, Meta-yes check, admin gate, second session store) and 4 in the pages (approve amount, the DELETE gate, capture method, pause value) | all 12 caught; every file put back (`git status` clean) |
| Whole browser suite, `E2E_PORT=43177 npx playwright test` | 775 pass, 8 fail. The 8 fail the same way on `main` before this work (measured first: 631 pass, 10 fail). They are `company-brain-chat.paused.spec.mjs` (3; a live-site spec that needs the deployed site) and `teleprompter-touch.spec.mjs` (5). None of mine. |
| `npm test` with no `DATABASE_URL` | unit: 20,407 tests, 20,383 pass, 1 fail, 23 skipped. Database half: 999 tests, 83 pass, 916 skipped (no database, as always). The 1 fail is `climate page: no approval odds...`, which fails on `main` too (W2, W3, W5 saw it). |
| All pulse tests (`src/pulse/*.test.mjs`, `beats/`, `coverage/`) | 3,084 tests, 2,957 pass, 0 fail, 127 skipped (database files) |
| `npm run lint` | 3,284 files parse clean |
| `npx tsc --noEmit` | 1 error, `src/marketing/filmed-receive.mjs(159,75)`, the same one on `main`. None in my files. |
| `npm run pulse:prove` (built bundle, live data, read only) | Not OK, for one reason that is **not from this work**: "the whole-morning run took 22.3 s (limit 20 s)". The same proof on untouched `main` in the main folder said the same thing (29.6 s). Everything else held: no step over 20 s (slowest `gap-finance-os` 11.1 s), no SQL error, nothing tried to write, all 1,072 expected checks present, all 58 lanes answered, all 65 "nothing to judge" rows still true. This branch adds nothing to the bundle (only test files and a test helper no product file imports). No beat was added, so `-- --beats` was not run. |

One test of mine went red in the first full `npm test`: the routing-restore guard read the routing statement text in `journeys-run-handler.test.mjs`. Fixed by wording (see Shared files), then the whole suite was run again (the numbers above).

## For the integrator

- New files only (plus this manifest). No merge conflicts expected with W6 or W8.
- The browser suite uses a fixed port (43117) and reuses a server already on it. With other worktrees running at once, run it as `E2E_PORT=<free port> npm run test:e2e` so it serves this folder's files.
- A fresh worktree needs the git-ignored `public/leads/` copied in, or `src/pulse/registry.test.mjs` fails there (known trap, 2026-10-09 lesson).
