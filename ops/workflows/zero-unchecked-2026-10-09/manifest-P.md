# Manifest P — the signing box starts the repair letters (2026-10-09)

Round 1: branch `build/ZU-P-2026-10-09`, cut from `main` at `e8e8e086`, commit `ed4987da`.
Round 2 (repair after the checker): branch `build/ZU-P-r2-2026-10-09`, cut from `ed4987da`. One commit on top.
The round 1 text below is kept. Where round 2 changed a fact, the round 2 section says so and wins.


## ROUND 2 — what the checker found and what I did

| # | severity | finding | result |
|---|---|---|---|
| 1 | blocker | On the server the writer cannot find the verified ID name, so it refuses the paying client AFTER he signs (`identity_not_verified`). | **Fixed and proved from a built bundle.** See below. |
| 2 | low | Two writer runs at the same moment can make two letter sets. | **NOT fixed. Reason below.** The journey doc now says it is known and open. |
| 3 | low | Desk says "Needs agreement" as fact when the consent read failed. | **Fixed**, plus its mirror (contract read failed). 6 tests. |
| 4 | low | `api/consent/capture.mjs` header said the endpoint only writes consents. | **Fixed.** The header now names the letter start. |
| 5 | low | Journey doc: "Three things" with four bullets; PATH drawn after the name gate; ID read not marked. | **Fixed.** |
| 6 | low | CHANGELOG line was a run-on with code words. | **Fixed.** Short sentences. |
| 7 | low | pg suites could not run. | **Still could not run here.** Reason below. |

### 1. The blocker, in plain words

`src/repair/analyze.mjs` found the verified ID name with `import(path)` over four relative strings. The server folds `netlify/functions/api.mjs` into one file, and a relative string is then read from `netlify/`, where there is no `identity` folder. All four tries threw, the answer was "no verified name", and for a client on the repair path the writer says `identity_not_verified`. Round 1 put FH-000507 on the repair path (A3), so A3 made the hole bite him. The checker was right.

**Fix.** `analyze.mjs` now has a plain static import at the top: `import { verifiedIdentity as readVerifiedIdentity } from "../identity/verified.mjs"`. The bundler sees it and puts the code in the bundle. The old path list, the cache and the resolver are gone. `loadVerifiedIdentity(db, ids, override)` has the same arguments and the same answers. `resetVerifiedIdentityCache()` is still exported (older tests call it) and now does nothing, because nothing is cached. `src/identity/verified.mjs` has no imports, so there is no import loop.

**Proof from a bundle, not from the source tree.** Scratchpad `zup-r2/` (not in the repo). `build.mjs` bundles a one-line entry that re-exports `analyzeAndGenerate`, with the same esbuild that zip-it-and-ship-it uses. It writes the layout of the shipped zip: the one bundled file in `netlify/functions/`, with the raw `src/` tree and `vendor/` beside it. `run.mjs` imports that bundle and runs the REAL writer on FH-000507's live data. Read only: the connection is `BEGIN READ ONLY` and rolls back. Every non-SELECT is answered by a fake and never reaches the database. fetch is off. The consent row is faked (the one thing he has not given). Counts only are printed.

| bundle | consent | result |
|---|---|---|
| round 1 file (old import) | faked signed | `ok:false`, `identity_not_verified`, 0 letters. **The blocker, reproduced.** |
| round 2 file (static import) | faked signed | `ok:true`, 3 letters (TU 13, EX 5, EQ 14 items), `verified_identity:true`. 40 writes faked, 0 reached the database. |
| round 2 file | faked signed, program row hidden (= before A3) | 3 letters (TU 9, EX 1, EQ 10). Matches the checker and round 1. |
| round 2 file | none | `ok:false`, `no_authorization`. The stop still holds. |

I also bundled the REAL `netlify/functions/api.mjs` with the same esbuild into the scratchpad and searched it: the string `IDENTITY_MODULES` is gone and `verifiedIdentity` is inlined.

I could not run `npm run pulse:prove` or zip-it-and-ship-it itself on this worktree: zip-it-and-ship-it fails with `EISDIR` here because `node_modules` is a symlink to the main checkout. The esbuild bundle above is the same bundler and the same file layout. It is not the zip itself.

**New guard test** (`src/repair/analyze.test.mjs`, 9 tests): the five server files here (`analyze.mjs`, `start-letters.mjs`, `handlers.mjs`, `read-repair-signals.mjs`, `api/consent/capture.mjs`) may `import()` only a quoted string, and `analyze.mjs` must carry the static identity import. Twins: the guard flags the old shape, a template path and a computed path, and stays quiet on quoted paths and comments. Mutation: with the round 1 `analyze.mjs` put back, 2 of these fail; with the fix, all pass. A unit test cannot build a bundle inside the suite, so the guard holds the rule at the source.

**Who else this turns on.** On the server, the verified-name read now works for everyone, not only him. I counted, read only: exactly **1** client in the whole database has a verified name (`pii_identity.verified_legal_name`), and it is FH-000507. There have been 0 dispute cases ever. For every other client the read still answers "none", as it did before, so nothing changes for them. The Capital Blueprint letters do not change. The rule itself is old and intended (the comments in `analyze.mjs` dated 2026-09-06 say letters take their name and address from the ID read). The checker asked the orchestrator or Chris to confirm this is wanted in this piece. It is the behaviour the code has always had from the source tree. It was just never true on the server.

### 2. The race: not fixed, and why

Two writer runs at the same moment can each pass the "letters already on file" check before either saves. Both would write a full set. I did not fix it. The checker rated it low, and the safe fixes are not trivial:

* **A lock on one connection** (the checker's first option). `db.query` is the shared pool, so the writer's queries run on different connections. A lock has to be held on a dedicated connection for the whole run. The repo's safe form is a transaction-scoped advisory lock (`pg_advisory_xact_lock`), taken on one pool client that stays in `BEGIN` while the writer runs on the pool, then `COMMIT`. A second run waits, then sees the first run's letters and answers `already_generated`. It should fail open (if the lock cannot be taken, run anyway and log). It needs a real Postgres to prove the wait and the release. There is no Postgres here and I will not test it on the live database.
* **A unique rule** on `dispute_cases` is a migration and needs Chris's OK.

The journey doc now says plainly that this is known and open. Staff mailing is still a human click, so a double set needs a person to mail both. If it should be closed, the advisory lock is about 25 lines in `startRepairLetters` (`src/repair/start-letters.mjs`) and needs the real-Postgres run in item 7.

### 3. The desk chip

`src/repair/read-repair-signals.mjs`: each paper is read on its own. `authorization_ok` is `true` if either found a paper, `false` only if BOTH reads worked and found nothing, and left OFF (unknown) if one read failed and the other found nothing. The checker named the consent-read case. The contract-read case is the same defect, so I fixed both. Tests added (6): consent read fails and no contract (unknown, no chip); consent read fails and a signed contract (true); contract read fails and no consent (unknown); contract read fails and a live consent (true); both fail (unknown); both work and find nothing (false). The round 1 tests for the same function pass unchanged.

### 7. Tests that could not run here

`src/http/repair-generate.pg.test.mjs`, `src/repair/analyze-restage-claim.pg.test.mjs` and `src/consent/consent.pg.test.mjs` need a real Postgres. There is no `DATABASE_URL` for a scratch database, no local Postgres, no Docker. They register 0 tests here, so the count shows no skips, but **a skipped pg test is not green**. They have NOT been run against this change. By reading: the first two call the writer with no program row and no identity override, so the static import behaves as the old dynamic one did from the source tree (the module is found either way), and the new program rule is not touched by them. They must run in CI (`.github/workflows/tests.yml`) before ship. I did not point them at the live database and never will: they write.

### Round 2 test results (this worktree, `DATABASE_URL` unset)

| run | result |
|---|---|
| `src/repair/analyze.test.mjs` | 51 pass (was 42) |
| `src/repair/read-repair-signals.test.mjs` | 18 pass (was 12) |
| neighbours (`src/repair/*.test.mjs`, `src/http/consent-capture.test.mjs`, `src/http/repair-cases-read.test.mjs`, the two pg files, `metro2/letters/*`, `ws-b-engine`, `pulse/coverage/{slice-33-fulfillment,gap-consent,gap-repair}`) | 393 pass, 0 fail |
| `npm run lint` | clean |
| `npx tsc --noEmit` | the same one error as `main`: `src/marketing/filmed-receive.mjs(159,75)`. Not mine. |
| full `npm test` | 19628 tests, 19590 pass, **15 fail**, 23 skipped. The failing names are the same set as the untouched `main` run (diffed). Round 1 had 19613 tests and 15 fail. This round adds 15 tests and none fail. |

### Round 2 files

`src/repair/analyze.mjs`, `src/repair/analyze.test.mjs`, `src/repair/read-repair-signals.mjs`, `src/repair/read-repair-signals.test.mjs`, `api/consent/capture.mjs` (header comment only), `docs/journeys/repair-documents-actual.md`, `docs/journeys/CHANGELOG.md`, this manifest. `netlify/functions/api.mjs` not touched.

### Round 2 requests for others (files I do not own)

* `docs/journeys/dispute-rounds-actual.md` line 53 still says `loadVerifiedIdentity()` "loads `src/identity/` dynamically". It is now a static import. Words only.
* Left over, not mine and not touched: other server files import a computed path (`src/pulse/coverage/gap-finance-os.mjs`, `slice-21-underwrite.mjs`, `run-slices.mjs`, `src/journeys/runner/registry.mjs`). The heartbeat law already says to prove those from the bundle. I did not check whether any of them fail on the server.

---

## ROUND 1 (kept as written; the counts in its Tests section are round 1's)

## What this does, in plain words

The one paying repair client (FH-000507) paid $1,000. His letters never started. The letter writer asks for a signed paper first. He had signed nothing, so it said no. It saved nothing and nothing ever asked it again.

Now the portal box "Sign to authorize dispute letters" is the paper a repair buyer signs, and **signing it starts the letters**. The Repair desk now says "Needs agreement" for a client who has signed nothing. Making letters mails nothing and emails the client nothing.

## Files

| file | change |
|---|---|
| `src/repair/start-letters.mjs` | **new.** `startRepairLetters` and `startLettersAfterAuthorization`. The one shared call (A1) |
| `src/repair/handlers.mjs` | the `repair.docs.complete` branch now calls `startRepairLetters` instead of its own copy of the call. Same arguments, same result shape |
| `api/consent/capture.mjs` | after a `dispute_authorization` is stored, calls `startLettersAfterAuthorization`. Response is unchanged: `{ ok, consent }` |
| `src/repair/read-repair-signals.mjs` | A2: the "enrolled program counts as authorized" shortcut is deleted |
| `src/repair/analyze.mjs` | A3: new export `hasActiveRepairProgram`; an ACTIVE `repair_programs` row now puts a client on the repair path in the writer |
| `src/repair/start-letters.test.mjs` | **new.** 21 tests |
| `src/repair/read-repair-signals.test.mjs` | 1 test replaced by 4 (see "Tests changed") |
| `src/repair/analyze.test.mjs` | 9 tests added; the `dbFor` helper got two options (`program`, `entitlement`) |
| `src/http/consent-capture.test.mjs` | 9 tests added at the end |
| `docs/journeys/repair-documents-actual.md` | A4: redrawn |
| `docs/journeys/CHANGELOG.md` | one line, top |

`netlify/functions/api.mjs` was **not** edited. `docs/journeys/repair-documents-intended.md` does not exist and I did not create it.

## Exports (exact shapes)

```js
// src/repair/start-letters.mjs
export const LETTER_WAIT_STAGE = "analysis";

startRepairLetters(db, { orgId, clientId, staffId = null, round = "R1" }, deps = {})
  // -> the writer's answer (analyzeAndGenerate), or { ok:false, reason } if it throws. Never throws.
  // deps (test seam only): { analyzeAndGenerate, storeFromEnv }

startLettersAfterAuthorization(db, { orgId, clientId, staffId = null }, deps = {})
  // -> { started:false, reason:"missing_ids" }
  //  | { started:false, reason:"card_not_waiting_on_letters", stage }
  //  | { started:true, letters }        // letters = the writer's answer
  //  | { started:false, reason }        // a card read that threw. Never throws.
  // deps (test seam only): { readRepairStage, analyzeAndGenerate, storeFromEnv }

// src/repair/analyze.mjs
hasActiveRepairProgram(program)   // program = loadRepairProgram()'s row or null. true only when program.status === "active"
```

## A1 — what I checked

* **Idempotent per round: verified by reading and by test.** `analyzeAndGenerate` looks for letters already on file for the round (`loadExistingRoundLetters`) before it writes anything and answers `already_generated`. Test: `asking the writer twice does not make a second set` (second call writes zero rows).
* **The writer's refusal reasons are untouched.** I only moved the call.
* **The shared function.** Both doors call `startRepairLetters`. A test runs `onRepairEvent("repair.docs.complete")` and checks it reaches the real writer (answer `no_authorization` on an empty stand-in), and that another event (`repair.letters.sent`) does not.
* **Only a card on `analysis` is acted on.** The signature door reads the card with the existing `readRepairStage`. Any other stage, or no card (a non-repair client has no optimization card), does nothing.
* **Order does not matter.** Documents first then signature: the signature finds the card on `analysis` and starts the letters. Signature first then documents: the card is not on `analysis` yet, so the signature does nothing, and the `repair.docs.complete` door starts the letters when the documents land. Whichever paper arrives last starts them.
* **A writer failure cannot fail the signature.** The consent is stored before the hook runs. The hook never throws (inner try/catch). Tests: a writer that throws still gives 200 with the consent; a card read that throws still gives 200.
* **The response is unchanged.** A test pins the body keys to `["consent","ok"]`.
* **Revoke and other kinds do nothing.** The hook sits after the grant path and checks `kind === "dispute_authorization"`. Tests: a revoke and a soft-pull consent never read the card.
* **Emails: none.** `TEMPLATE_BY_EVENT` in `src/repair/notify.mjs` has no template for `repair.docs.complete`, `repair.analysis.complete` or `repair.letters.ready`, the three events this path fires. A test pins that. If someone adds one later, signing would start emailing the client and that test goes red.
* **Mails nothing.** No fetch added. Mailing stays Specialist Send.

The full story runs through the **real** writer in one test on a stand-in database that remembers state: documents land, nothing signed, the writer says `no_authorization`, nothing is written, the card stays on `analysis`; the client signs; the signature door makes the letters; the card moves `analysis -> letters_generated -> ready_to_send`.

## A2 — what I checked

`authorization_ok` is now a live `dispute_authorization` consent **or** a signed repair contract, nothing else. That is the same two papers the writer reads (`hasDisputeAuthorization`, `hasRepairAgreement`) and the same two the `consent:dispute-required` pulse check reads. The "Needs agreement" chip in `src/repair/lens.mjs` is unchanged and now shows for FH-000507. An unknown (both reads failed) stays unknown, as before.

## A3 — dry run on the real FH-000507 data (read only)

Run from `/private/tmp/.../scratchpad/zup-dryrun.mjs`. Read-only: `BEGIN READ ONLY`, a wrapper that throws on anything that is not a `SELECT`, and it attempted zero writes. It prints counts only.

```
signed repair agreement: false | program status: active | outcome tier: (none)
onRepairPath BEFORE the change: false | AFTER: true
claims BEFORE: {"TU":9,"EX":1,"EQ":10} | claims AFTER: {"TU":13,"EX":5,"EQ":14}
verified name present: true
```

That matches the research (TU 9, EX 1, EQ 10 now; TU 13, EX 5, EQ 14 with the fix). The claim counts come from the same pure functions the writer uses, fed with his stored credit file and verified identity. I did **not** run the writer itself.

The rule is keyed to the `repair_programs` row (status `active`), **not** to the `metro2-letter-pack` entitlement. The writer never reads entitlements; a test proves it (a client with the entitlement, no program, tier `FULL_FUNDING` gets `no_violations` and no query touched entitlements). `cancelled`, `complete` and `upsell_pending` programs do **not** count (tests). The identity wall still applies: an active program with no verified name still gets `identity_not_verified` (test).

## Tests

Run here with `DATABASE_URL` unset.

| file | result |
|---|---|
| `src/repair/start-letters.test.mjs` | 21 pass |
| `src/repair/analyze.test.mjs` | 42 pass (was 33) |
| `src/repair/read-repair-signals.test.mjs` | 12 pass (was 9) |
| `src/http/consent-capture.test.mjs` | 75 pass (was 66) |
| `npm run lint` | clean |
| `npx tsc --noEmit` | one error, `src/marketing/filmed-receive.mjs(159,75)`. Not my file. It is on `main` already |
| full `npm test` | 19613 tests, 19575 pass, **15 fail**, 23 skipped |
| the same full `npm test` on the untouched `main` copy (`git archive HEAD`) | 19571 tests, 19533 pass, **15 fail**, 23 skipped |

The 15 failures are the **identical set** on `main` and on this branch (I diffed the names). They are not mine: the pulse `src/pulse/funnel-doors.mjs` and `src/pulse/instant-watch.mjs` outbound-fetch fence, `docs/diagrams` stale, the generated journey pages stale (`client`, `role-*`), the workflow registry acceptance trio, the registry handler/desk check, a climate-page wording test, the read-endpoint scope test, the workflow index count pin, and six ad-registry add-ad and dispatch tests. I did not touch any of them. This branch adds 42 tests and none fail.

Mutations I checked by hand (each makes the new tests fail, then I put the file back): removing the stage guard, removing the active-program rule, removing the capture hook.

**Pg tests that could not run here (no `DATABASE_URL`, no local Postgres):** `src/repair/analyze-restage-claim.pg.test.mjs` and `src/http/repair-generate.pg.test.mjs` run the real writer against Postgres. By reading, neither creates a `repair_programs` row, so the new active-program rule is not exercised by them and their results should not change. `src/consent/consent.pg.test.mjs` is also skipped. All three are unverified by running. In the pg half of the full run, 844 of 927 tests skipped. A skipped pg test is not green.

### Tests changed (A2)

`src/repair/read-repair-signals.test.mjs`: the test **"enrolled repair program is authorization_ok without consent"** encoded exactly the deleted shortcut. I replaced it with "an enrolled repair program with nothing signed is NOT authorized" (which also checks the chip is `needs_agreement`), plus three twins (program plus live consent is authorized; program plus signed repair contract is authorized; program plus a revoked consent is not). **"cancelled program alone is not agreement"** stays and still passes. No other test encoded the shortcut. `src/http/repair-cases-read.test.mjs` passes valid consent rows, so it never leaned on it.

## Heartbeat check

No new page, route, Inngest job or outbound send path, so no new heartbeat row. I read the rules in `src/pulse/registry.mjs` and `src/pulse/tripwires.mjs`: `api/consent/capture.mjs` is already a registered route (`reg` row `consent/capture`, tripwire `route:consent/capture` with checks `consent:store` and `consent:required`). The money and customer checks that guard this path already exist: `repair-letter-round` (`src/pulse/coverage/gap-repair.mjs`, aliased to `repair.docs.complete` in `link.mjs`), `fulfillment:next-action` (`gap-fulfillment.mjs`) and `consent:dispute-required` (`gap-consent.mjs`). The pulse suites ran in the full run and added no new failures.

## Hard checks

* `consent/capture` is in the `ROUTES` map: `netlify/functions/api.mjs:1238` (`"consent/capture": consentCapture`). Not edited.
* Endpoint tests are at `src/http/consent-capture.test.mjs` (stand-in database, no `DATABASE_URL` needed), per CLAUDE.md §12.

## What I could not do or could not verify

1. **Not run on the live site.** Nothing is shipped. FH-000507 still has no consent on file, so until he signs the box the writer still refuses him. This change does not record a consent for anyone and does not message him.
2. **Timing.** The writer now runs inside the consent POST (awaited, because a serverless function freezes after it answers). The same is already true for the documents door. I did not measure how long it takes for his file. The signature is saved first, so a slow or killed writer cannot lose it, but the client could see a slow save.
3. **Double-submit race: UNVERIFIED, unlikely.** `captureConsent` writes a row each time and there is no unique rule on dispute cases. The portal button has a busy flag. Two signature POSTs at the same moment could each start the writer. I did not add a lock.
4. **`upsell_pending` is not counted** as the repair path, on purpose (the plan said ACTIVE). A trial that is waiting on its upsell would get only the narrow letters if a round ran. The round cap would normally stop it anyway.
5. Live proof after ship is still to do: sign as FH-000507 (needs his words and his sign-in, or a staff entry on a call), then check that letters exist and the card moved.

## Requests for others (files I do not own)

* `src/pulse/coverage/slice-33-fulfillment.mjs` line 149 names the letter build as `src/repair/handlers.mjs analyzeAndGenerate`. The call now lives in `src/repair/start-letters.mjs`. Words only; nothing breaks.
* The Client Control Panel step (needs Chris's words) is still open and was out of scope.
* The `tsc` error in `src/marketing/filmed-receive.mjs` and the 15 failing suite tests above are on `main` and are not mine.
