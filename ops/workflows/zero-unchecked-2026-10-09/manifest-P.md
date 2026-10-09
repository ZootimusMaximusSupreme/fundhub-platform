# Manifest P — the signing box starts the repair letters (2026-10-09)

Branch `build/ZU-P-2026-10-09`, cut from `main` at `e8e8e086`. One commit.

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
