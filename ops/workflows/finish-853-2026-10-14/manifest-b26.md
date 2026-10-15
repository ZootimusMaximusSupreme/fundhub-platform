# Batch 26 manifest (finish the 853) — Sonnet builder, lane gap-door-batch-routes

Branch `fin/b26` (worktree `.claude/worktrees/fin-b26`), cut from `fin/base`. Not pushed. Not merged.
Generation 1 of at most 3.

## Numbers

| | Count |
|---|---|
| Rows in this batch (all open at the start) | 16 |
| Still open after this branch | 0 |
| Whole catalog, before / after (`node scripts/pulse/count-not-proved.mjs`) | 853 / 837 |
| Route lane `gap-door-batch-routes`, before / after | 135 / 119 |
| Route lane per file (routes-0 / 1 / 2 / 3) | 54/36/25/20 to 43/35/22/19 |

Words used on purpose: every attached row is a **practice test**. The real `api/` handler and the real
library under it run over in-memory stand-in tables, with fake data, no network and no database. None is
a live check. None is called "deep" or "proof" in what is handed back. The stand-ins answer by the
conditions the statement text itself names (company, partner, client, state), and where the stand-in
cannot run a statement the file pins the clauses of the statement text. Postgres never ran any SQL here.

## Every row

| # | Row (file : surface : first words of the control) | Outcome | Test that judges it |
|---|---|---|---|
| 1 | routes-2 route:read/inbox : GET every conversation in the company, newest first | practice-test | `src/http/fin-b26-read-inbox-messages.test.mjs` |
| 2 | routes-0 route:read/inquiry-cases : active case queue with document packets | practice-test | `src/http/fin-b26-read-inquiry-cases.test.mjs` |
| 3 | routes-3 route:read/message-templates : the copy library with body and who uses it | practice-test | `src/http/fin-b26-read-message-templates.test.mjs` |
| 4 | routes-0 route:read/messages : one thread both directions, or blocked messages | practice-test | `src/http/fin-b26-read-inbox-messages.test.mjs` |
| 5 | routes-0 route:read/my-numbers : closer's own performance; finance may view another | practice-test | `src/http/fin-b26-read-my-numbers.test.mjs` |
| 6 | routes-0 route:read/portal-contracts : agreements on the client's file, fresh sign link | practice-test | `src/http/fin-b26-portal-contracts.test.mjs` |
| 7 | routes-0 route:scripts/write : save an ad script, a rewrite points at its parent | practice-test | `src/http/fin-b26-scripts-write.test.mjs` |
| 8 | routes-0 route:social/channels : a partner's connected channels, tokens redacted, can_post | practice-test | `src/http/fin-b26-social-channels.test.mjs` |
| 9 | routes-2 route:social/oauth : connect a channel by OAuth, start and callback | practice-test | `src/http/fin-b26-social-oauth.test.mjs` |
| 10 | routes-0 route:social/posts : queue / schedule / approve / reject / discard (POST) | practice-test | `src/http/fin-b26-social-posts.test.mjs` |
| 11 | routes-0 route:social/posts : the queue read (GET) | practice-test | `src/http/fin-b26-social-posts.test.mjs` |
| 12 | routes-1 route:social/publish : run publishDue, one partner or all | practice-test | `src/http/fin-b26-social-publish.test.mjs` |
| 13 | routes-0 route:social/settings : owner flips approve_before_launch (POST) | practice-test | `src/http/fin-b26-social-settings.test.mjs` |
| 14 | routes-0 route:social/settings : module settings read (GET) | practice-test | `src/http/fin-b26-social-settings.test.mjs` |
| 15 | routes-0 route:training-progress : record a partner's module or gate | practice-test | `src/http/fin-b26-training-progress.test.mjs` |
| 16 | routes-2 route:trials/dashboard : the $297 trial buyer's live screen | practice-test | `src/http/fin-b26-trials-dashboard.test.mjs` |

16 practice tests, 0 live checks, 0 verified N/A, 0 not-attachable. The full row ids are the ones in
`ops/workflows/finish-853-2026-10-14/batch-26.json`; each is named in
`src/pulse/catalog/proofs/fin-b26-door-contracts.mjs` by the 20-hex id the catalog compiler gives it.

## What each practice test judges

- **read/inbox + read/messages** (`fin-b26-read-inbox-messages`, 9 tests). Inbox: this company's threads only,
  newest activity first, who/channel/last message, `needs_reply` true when they spoke last, false when we
  did, null (not false) when nobody did; the needs-reply filter is in the database; a thread with no
  messages is still listed; paging. Messages: one thread both directions newest first, who sent each
  reply, a held reply says it was held and why, no phone number or provider key leaves the door, blocked
  list is the company's, a forgotten thread id is a 400 and never "every message".
- **read/inquiry-cases** (8 tests). Active statuses only, oldest request first (no date last), the
  whole-queue total, the identity packet per case (complete, or exactly what is missing; a live signed
  consent counts; expired papers and revoked consents do not; another company's papers do not), a failed
  paper read says nothing rather than "incomplete", filters, the one-client read, the Specialist desk role
  set (four roles in, the other four out), no company, 503 when the database is down.
- **read/message-templates** (6). This company's copy with the words, approval, and who uses each one
  (workflow code read from this repository, a saved journey step including nested branches, or nothing);
  channel and search filters; journeys unreadable does not take the list down; no company reads nothing.
- **read/my-numbers** (6). Calls held, no-shows, show rate, close rate, cash for this month from this
  closer's rows in this company, demo rows and last month left out; last month's close rate; a closer
  cannot name another closer; owner, admin and sales manager can; the other staff roles are told this
  page is for closers.
- **read/portal-contracts** (8). A client sees only their own file, only sent/viewed/signed; a fresh signed
  link for the client's own signer only while the agreement is open and they still owe a signature (the
  signature is checked against the real HMAC and the 30 day life); template name with key fallback;
  another company's agreement for the same client id is not shown; staff must name a client in their own
  company; refusals.
- **scripts/write** (13). New script under the house partner as a draft with tidied labels and a learned
  dictionary that never overwrites a typed name; rewrite is a new version pointing at its parent, parent
  archived with its words untouched, same root and number, locked/filmed parent gives a locked rewrite,
  machine parent becomes superseded; stale (archived parent, lost race, unique index) is 409 with the live
  version; a failed insert rolls the archive back; another company's parent reads like a missing one; the
  input refusals; role set.
- **social/channels** (7), **social/settings** (13), **social/posts** (15), **social/publish** (6),
  **social/oauth** (12): see the test titles. Highlights: no token or ciphertext in any answer, even if the
  statement were `SELECT c.*`; partner pinned to own id; owner-only switch with only that column written and
  another company's row left alone; approve/reject owner or admin only, a partner never approves own post,
  the lost-race refusal rolls the screen row back; publish records an action row before the platform call,
  gives up after three tries and opens a task, one dead channel does not stop the rest, "all" is staff
  only; OAuth state is signed for the partner's own company, expires, and the row follows the signed state
  not the clicker, tokens are stored encrypted and bound to the partner, "not configured" says what is
  missing.
- **training-progress** (9). Module attended/complete with dates and who wrote it, attended never undoes
  complete and the first completion date stands, a gate needs its modules complete and the gate before it
  passed, a failure is always recorded, a revoke only takes back a standing pass and the newest decision
  wins, entitlement (paused, unsigned, another company) refuses with a reason, owner/admin only, the body
  may not name the company or the staff member.
- **trials/dashboard** (10). Counts in the trial window for this partner and company only, spend null (not
  0) when nothing synced, zero booked calls shows 0, a held-start trial shows null counts and reads
  nothing, no trial is a 404, a partner's `partner_id` in the address is ignored, staff must name one and
  another company's staff get 404, no earnings claim and no lender data keys.

## Break checks (the product was broken on purpose, the test seen red, the line put back)

About 150 single breaks across 13 test files. A helper (`mut.py`, kept in the scratchpad, not in the repo)
applied one break, ran the file, and put the product file back with its original text; `git status` was
clean of product edits after every run. Roughly, per file the breaks tried and how many went red: trials
9/9, training-progress 14/14 (two went green first and the test was made stronger), social-settings 9/9,
social-channels 8/8, social-posts 12/12, social-publish 10/10 (one made stronger), social-oauth 10/10 (two
made stronger), scripts-write 15/15 (the role gate and a stale-parent layer made stronger),
portal-contracts 11/11 (one made stronger), message-templates 9/9 (two made stronger), my-numbers 11/11,
inquiry-cases 12/12, inbox-messages 17/17 (one made stronger). Examples: company condition turned into
`$n IS NOT NULL`, a dropped partner or client condition, ORDER BY flipped, `needs_reply` literal swapped,
LEFT JOIN made inner, status guards dropped, role set widened by one role, role gate removed, session-owned
body field allowed, company check removed, signed-state expiry removed, token stored plain, ON CONFLICT
guard removed, advance guard removed, rollback guard removed.

Stayed green on purpose, written down because they are not product breaks (a second layer already does
the same job, so nothing a person sees changes):

- `social/oauth` and `read/portal-contracts`: adding "partner" to the `requirePrincipal` kinds list. The
  next line refuses a partner account anyway because its `role` is undefined.
- `scripts/write`: removing only the early `if (parent.archived_at)` check, or only the `AND archived_at IS
  NULL` guard in the archive UPDATE. Each is covered by the other. Both removed is red.

## Files added

Tests (`src/http/`, all `.test.mjs`): `fin-b26-trials-dashboard`, `fin-b26-training-progress`,
`fin-b26-social-settings`, `fin-b26-social-channels`, `fin-b26-social-posts`, `fin-b26-social-publish`,
`fin-b26-social-oauth`, `fin-b26-scripts-write`, `fin-b26-portal-contracts`,
`fin-b26-read-message-templates`, `fin-b26-read-my-numbers`, `fin-b26-read-inquiry-cases`,
`fin-b26-read-inbox-messages`. Largest is 370 lines.

Helper: `src/testing/fin-b26-kit.mjs` (one handler call over a stand-in database, `inSql` that reads a
statement's WHERE including `= ANY($n)` and ignores OR groups, session rules, snapshot-and-rollback tables).

Plug-in: `src/pulse/catalog/proofs/fin-b26-door-contracts.mjs` and `fin-b26-door-contracts.test.mjs`.

This manifest: `ops/workflows/finish-853-2026-10-14/manifest-b26.md`.

## Shared lines touched (smallest possible edits)

| File | Edit |
|---|---|
| `src/pulse/catalog/proofs/door-proof.mjs` | one import line, and `\|\| finB26DoorProof(sourceFile, row)` added at the end of the plug-in chain in `proofForDoor` |
| `src/pulse/coverage/gap-door-batch-routes.mjs` | `EXPECTED_ROUTE_GAP_COUNTS` 54/36/25/20 to 43/35/22/19 |
| `src/pulse/coverage/gap-door-batch-routes.test.mjs` | the row total 135 to 119 (title, three lengths, results length) |
| `src/pulse/catalog/proofs/door-batch-route-result.test.mjs` | rows 135 to 119, unique routes 115 to 101 |
| `src/pulse/catalog/generated.json` | regenerated with `npm run pulse:catalog` (16 rows change from red monitor to wired) |

`door-proof.test.mjs` was NOT edited: none of the 16 rows is money / customer-message / customer-data, so
its "deep proof" regex does not apply. The integrator will see conflicts on the plug-in chain and the three
count lines from the other route batches; each batch's count change is its own number of attached rows
(16 here: routes-0 minus 11, routes-1 minus 1, routes-2 minus 3, routes-3 minus 1). Recompile
`generated.json` after merging.

## Product findings (written down, not fixed)

1. `social/channels` GET, `social/posts` GET and `social/publish` POST take a partner id from the address
   or body and never compare that partner's company with the signed-in staff member's company. Measured
   with a staff login of company B naming company A's partner: channels 200, queue 200, publish 200.
   Any staff role of any company can read a partner's channels and queue and run its publisher. (The
   publish row's own words say "staff may publish all partners".)
2. `social/oauth` start looks up the partner by id with no company check and signs that partner's company
   into the state, so an owner or admin of one company can start a connect flow for another company's
   partner. The partner-account branch of `writeScope` is dead code: `requirePrincipal(["staff"])` refuses
   a partner account, and only a staff login whose role is `partner` (migration 036) gets in.
3. `read/portal-contracts` is a GET that writes: `mintLinks` updates `link_expires_at` on every signer
   and the contract, and flips a `pending` signer to `sent`, every time the page loads.
4. `read/my-numbers`: the team table's cash (`teamLeaderboard`) has no demo-row exclusion, while the
   closer's own cash line excludes demo rows, so the two numbers on one screen can disagree.
5. `getActiveCaseForClient` orders `requested_at DESC` with no `NULLS LAST`, so an active case with no
   request date is returned ahead of a dated one for the same client (the queue list uses NULLS LAST).
6. `read/inbox`: the last-message lateral is not company-scoped; it relies on conversation ids being
   unique. Not exploitable today, noted because the thread read (`read/messages`) does filter on the
   message's own company.
7. `training-progress`: a closer cannot record G3 (the call certification is scored by a closer). Already
   named in the handler header as a known gap.

## Commands run

- `node scripts/pulse/count-not-proved.mjs` before and after: 853 / 837 total, route lane 135 / 119,
  this batch 16 / 0.
- `node --test src/http/fin-b26-*.test.mjs src/pulse/catalog/proofs/fin-b26-door-contracts.test.mjs`:
  127 tests, 127 pass, 0 skipped, three runs in a row.
- `node --test src/pulse/catalog/*.test.mjs src/pulse/catalog/proofs/door-*.test.mjs
  src/pulse/catalog/proofs/s1-door-contracts.test.mjs s2-door-contracts.test.mjs s3-door-contracts.test.mjs
  fin-b26-door-contracts.test.mjs flow-read-contracts.test.mjs src/pulse/coverage/gap-door-batch-routes.test.mjs
  gap-door-batch-keys.test.mjs`: 1,094 tests, 1,094 pass, 0 skipped.
- `node --test src/lib/no-unfenced-transmit.test.mjs`: 5 of 5 pass (no new outbound call was added).
- `node scripts/lint.mjs`: 3,578 files and inline scripts parse clean.
- `npm run pulse:catalog`: regenerated `generated.json` (3,975 mapped, 3,919 wired, 23 red).
- Not run: the browser suites and the `.pg.test.mjs` tests (no local Postgres on this Mac, and the brief
  forbids pointing them at production).
