# Lane 13 — contracts and e-sign

Read only. Report only. This lane does not sign a contract and does not edit a page.

Recon (AG-07) is the one tripwire. The daily pulse reads it itself (id `recon`). This lane does not read it again.

## Not repeated

`src/pulse/coverage/slice-10-contracts.mjs` already watches two things:

- The contract chaser has no machine row.
- The sign door is not on the morning ping list.

This lane does not score those again. A GET with no token answers 404. That 404 is the closed door. It is not a break.

## Checks

`gapChecks(ctx)` in `src/pulse/coverage/gap-contracts.mjs` returns 4 rows. Each row is `{ id, status, detail, suggestedFix }`. Status is `PASS`, `FAIL`, or `skip`.

| id | FAIL means |
|---|---|
| `contracts:sent-unsignable` | A contract was sent or viewed, and the client cannot sign it. No frozen copy, the words no longer match the frozen copy, a missing PDF, or nobody whose turn it is. A signer who said no shows up here too, labeled "a signer said no", because only staff can void it or send a new one. |
| `contracts:sign-route` | The sign route is missing from the route map. Or a GET with no token answers something other than the door's own 404 (the router's "no such route" 404 counts as a break). Or a GET with a forged link answers 503 (no signing secret) or anything but 404. |
| `contracts:signed-not-stored` | Status is signed, and the signed file was not saved. |
| `contracts:template-missing` | A live offer has no active contract template. |

A read that fails is a FAIL with the reason. No database: the three reads are `skip`.
Demo contracts and demo templates are left out.

Live offer templates this lane expects: `CAPITAL-BLUEPRINT-AGREEMENT`, `CREDIT-REPAIR-AGREEMENT`, `FUNDING-AGREEMENT`, `FUNDING-MASTERY-AGREEMENT`, `REPAIR-AND-FUNDING-AGREEMENT`, `REPAIR-TRIAL-AGREEMENT`, `SOFT-PULL-CONSENT`. Offers with no contract key are not required.

## Test

`node --test src/pulse/coverage/gap-contracts.test.mjs`

## Review — Claude, 2026-10-08

What was wrong:
- `contracts:tripwire` was a copy of the daily pulse's own Recon check. Removed.
- "Content changed" only compared two saved hashes. The sign door re-hashes the words, so a changed contract slipped through. The check now re-hashes the same way.
- The forged-link branch for "not configured" could never fire. A bare GET is refused before the secret is read. A GET with a forged link reaches it. Live it answers 404, so the secret is set.
- A 404 could mean "closed door" or "route is gone". Both looked the same. The router's own 404 carries a `path`, the sign door's does not. The check now tells them apart.
- Reading the route map file would crash the whole lane if the file is not in the bundle. It now falls back to the live call.
- Demo contracts and demo templates could count.
- A broken read was a quiet skip. It is now a FAIL, so a dropped column cannot switch the watch off.
- The tests used canned rows. The SQL never ran.

What changed:
- 4 checks, not 5. Hash re-check, forged-link probe, router-404 test, safe file read, demo left out, read errors red.
- 14 tests, up from 10.

Live result after (production database, read only): prod 4 PASS, 0 FAIL, 0 skip. Staff view the same. The bare GET and the forged-link GET both answered 404. No write tried.

How it was proved:
- 32 made-up contracts, signers, versions and templates run through the real SQL on the live database engine (read only, tables shadowed). Every row came out as expected, including a changed-words contract, a declined first signer, and a signed contract with no stored file.
- Broke one thing at a time against the real site: a route that is not there, a 503 with no secret, all templates off, a renamed table. Each went red.
- 11 deliberate breaks in the code. The tests caught all 11.
- The `contracts` table in production holds 0 rows today, so the red paths could only be proved this way.

Test result: 14 pass, 0 fail, 0 skipped.

### Second pass — after the checker

What was wrong:
- The "nobody can sign" part of the query had no test that would break if it broke. Taking out the whole signer clause, or changing the signer states, passed every test. The same for the company filter on the template read and the "signed file still exists" parts of the signed read.
- A contract whose only signer said no showed as "nobody can sign it". That is a person's answer, not a system fault, and the label did not say so.
- The two web calls to the sign door had no time limit. A stuck door would show as one skipped row, not a FAIL.
- Wording: a router 404 on the forged-link call would print "not the expected 404".

What changed:
- Tests that read the real rules. The signer states in the query are checked against the table's own list of states and the `TERMINAL` set in `src/contracts/signers.mjs`. The whole signer clause is pinned in the WHERE. Every query is pinned to one company. The forged link is run through the real `verifyContractRequest`: with a secret it is `bad_signature` (a 404), with none it is `no_secret` (a 503).
- Four new tests run the real queries on a real Postgres over made-up rows. 29 made-up sent contracts (changed words, no frozen copy, a missing PDF, parallel and sequential signers, a declined first signer, unicode text, draft, void, demo, other company), 9 signed contracts, 5 templates, and the whole lane end to end. The tables are shadowed for one statement inside `BEGIN READ ONLY` and rolled back, so nothing is written, even on the live database. They run when `DATABASE_URL` is set (CI, the live proof) and are skipped without it. The pins above run everywhere.
- The label "a signer said no, so staff must void it or send a new one". Still a FAIL, because the contract stays stuck until staff acts.
- Both web calls now carry a 15 second limit.
- Router 404 on the forged-link call now says so.
- 22 tests, up from 14.

Judged wrong, no code change for it: the checker said a forged link with `exp=1` would make the live check FAIL forever with a 410. It would not. The door checks the signature before the expiry (`verifyContractUrl` in `src/contracts/signed-link.mjs`), so a forged link is a 404 whatever its expiry. A test now proves that with `exp=1`. The live call also answered 404. The link still keeps a far-future expiry.

Live result after (production database, read only): prod 4 PASS, 0 FAIL, 0 skip. Staff view 4 PASS. Bare (what the pulse passes today): 1 PASS, 0 FAIL, 3 skip. The 1 PASS in bare mode is the route map only. 0 SQL errors, 0 writes. The `contracts` table holds 0 rows in production, so the sent and signed reads are quiet today and can only be proved on made-up rows. The 11 contract templates are there and the 7 wanted ones are active.

How it was proved:
- 25 deliberate breaks in the code. The tests that run everywhere caught 24. With `DATABASE_URL` set they caught all 25 (the 25th, a wrong label on a null words-hash, needs the real-rows test).
- All 22 tests pass against the live database (read only). Without a database: 18 pass, 4 skipped.

Test result: 22 pass, 0 fail, 0 skipped with a database. Without one: 18 pass, 0 fail, 4 skipped.

