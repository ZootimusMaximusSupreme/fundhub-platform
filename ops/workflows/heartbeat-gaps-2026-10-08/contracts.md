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
| `contracts:sent-unsignable` | A contract was sent or viewed, and the client cannot sign it. No frozen copy, the words no longer match the frozen copy, a missing PDF, or nobody whose turn it is. |
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
