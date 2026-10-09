# Consent capture gap

Lane: consent capture only. Read only. One tripwire. No second monitor.

The check is `gapChecks(ctx)` in `src/pulse/coverage/gap-consent.mjs`. It returns five readings. Each one is `{ id, status, detail, suggestedFix }`. Status is `PASS`, `FAIL`, or `skip`.

It does not record consent for a real person. It does not write a row. It does not edit the consent page. It does not start another monitor.

The morning pulse already pings the consent page and the consent API (`reg:consent-capture`, `reg:consent/capture`). This file does not ping the API again. It reads the page body once, and it reads the database.

It does not look at files on disk. The pulse runs inside the deployed function. `public/` and `api/` are not there to read.

## Breaks

| id | What fails |
|---|---|
| `consent:page` | The consent page does not load, or it loads and no longer calls `/api/consent/capture`. The plain up/down ping is `reg:consent-capture`. The API ping is `reg:consent/capture` |
| `consent:required` | A client paid for a credit report more than 24 hours ago, the credit is not in, and there is no live soft-pull consent. Same people as the desk count `needs_consent`, less the ones who paid in the last 24 hours |
| `consent:store` | A signed soft-pull paper, more than 1 hour old, has no consent row. A later withdrawal is not a failed store |
| `consent:slo-store` | A roadmap order saved the buyer's identity (1 hour to 7 days ago) and no soft-pull consent row exists for that client. The pull form saves the identity, then the consent, in one request |
| `consent:dispute-required` | An active repair program, older than 7 days, whose client has no live dispute authorization and no signed repair agreement. Letters cannot be prepared for that client. A withdrawn authorization is a real no, not a break |

Test clients are left out of all four database rows: the demo flag, the synthetic flag, the `+walk-N` and `+sim-N` tags, and reserved test domains (`.test`, `.example`, `.invalid`, `.localhost`, `.local`, and `@example.com/net/org`).

## Run

`node --test src/pulse/coverage/gap-consent.test.mjs`

Fakes only. The SQL was also run read-only on the live database with the real tables swapped for made-up rows, to prove each row can fail and can pass.

## Review — Claude, 2026-10-08

What was wrong:
- `consent:doors` read files on disk (`public/app/consent-capture.html`, `api/consent/capture.mjs`, `netlify/functions/api.mjs`). The live function does not carry those files. Cursor measured the same thing for the gap files. So this row would have said "page file is missing" every morning. The rest of it was a copy of `reg:consent-capture` and `reg:consent/capture`.
- `consent:required` would go red for any buyer who paid last night and had not filled in the form yet. That is a normal wait, not a break.
- `consent:store` had no time limit, and it did not skip test clients.
- A count that never came back was read as 0.
- The main live path was not watched at all. The roadmap pull form saves the identity first and the consent second. If the second fails, nothing said so.

What changed:
- `consent:doors` is now `consent:page`. It GETs the page once and checks it still calls the capture API. No file reads.
- `consent:required` leaves out buyers who paid in the last 24 hours.
- `consent:store` leaves out papers signed in the last hour.
- New `consent:slo-store`: a roadmap order saved an identity 1 hour to 7 days ago and no consent row exists. A withdrawn consent still counts as stored.
- All three database rows leave out test clients and accept `ctx.scope` (the staff view) first.

Proof:
- All three SQL statements were run on the live database in a read-only transaction with made-up rows. Each fails when it should (a real buyer with no consent, a paper with no row, a paper with no signed PDF, an identity with no consent) and passes when it should. A revoked consent still counts as no live consent. A withdrawal after signing is not a failed store.
- Tests: 16 before, 23 after, 0 fail. 17 deliberate breaks of the code: all caught.
- Live, prod mode: 4 PASS, 0 FAIL, 0 skip.

What today's data cannot show: no client has the `crs_paid` flag (0 of 61) and there are 0 contracts. So `consent:required` and `consent:store` cannot go red on today's data. The made-up rows prove they can.

Looked at and left out on purpose: one real repair buyer has an identity on file and no soft-pull consent. A repair buyer does not need a soft pull, so a check on "identity with no consent" would false-alarm on a real customer. That is why `consent:slo-store` only looks at roadmap orders.

### Second pass — Claude, 2026-10-08 (later)

What was wrong:
- Gap against the lane brief ("a client who must have consent and has none when the product path requires it"). Only the soft-pull consent was read. The repair path needs a different paper: a live dispute authorization or a signed repair agreement. Without one, `analyzeAndGenerate` refuses with `no_authorization` and no letters are prepared. Nothing in the pulse read it.
- The demo roster address (`@demo.fundhub.local`) was not in the test pattern.
- The rule that a withdrawal after signing is not a failed store was not pinned. Flipping it left all tests green.
- PASS lines do not say how many rows were examined. Left as is (see below).

What changed:
- New `consent:dispute-required`. It follows the same two doors the letter gate follows. It counts an active repair program older than 7 days whose client has neither a live `dispute_authorization` consent nor a signed repair agreement. A withdrawn authorization (any revoked row) is left out. Test clients are left out.
- The 7 days is a number I picked. The repair desk chases a missing contract after 3 business days (`src/repair/sla.mjs`). A week is that plus a weekend, so the desk has had its turn first. It is one constant, `DISPUTE_GRACE_DAYS`, and a test pins it.
- A test fails if `src/repair/dispute-auth.mjs` or `analyze.mjs` change what counts as a signed repair agreement or as authorized. That keeps the copy honest.
- Not covered: funding-offer clients also sign this paper, but they have no program row to read. Left alone.
- `.local` added to the test domains. The withdrawal rule in `consent:store` is pinned.

Today's data, checked with read-only SQL: 1 active repair program, enrolled 2026-10-05 (3 days ago), one real client, no authorization, no signed agreement. With the 7 day wait it passes today. If that client has still signed nothing on 2026-10-12, this row turns red. That would be a real chase item, not a false alarm. It is not red now, so it is not reported as a break.

Proof, second pass:
- The new SQL ran on the live database engine, read-only, with made-up rows: nothing on file FAIL; live authorization PASS; withdrawn PASS; expired and not-yet-live FAIL; signed repair agreement PASS (by template subtype and by the key saying REPAIR with no template row); signed paper that is not repair FAIL; unsigned repair paper FAIL; 3, 6 days old PASS; 8 days old FAIL; cancelled, complete and upsell_pending PASS; test client PASS; wrong consent kind FAIL; two clients count 2. 18 of 18 as designed. On the real data a 2 day wait finds the 1 client and a 7 day wait finds 0.
- Tests: 28 pass, 0 fail, 0 skipped (23 before).
- 19 deliberate breaks of this file: all 19 caught. The one that survived before (the withdrawal rule) is caught now.
- Live, prod mode: 5 PASS, 0 FAIL, 0 skip. Staff view the same. The bare view is all skip because it passes no org and no fetch. The real pulse passes both, so that is not a production problem.

Not done (leftover): PASS lines do not say how many rows were looked at. Today all four database readings are empty-population passes (0 paid clients, 0 contracts). The made-up rows prove they can fail. Printing the population would mean changing every statement to return two numbers.
