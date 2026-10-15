# Batch 05 manifest — finish the 853 (tier 2, lane gap-door-batch-routes, 1 row)

Branch `fin/b05`, built from `fin/base` (`2f4f574a0`). Nothing was pushed or merged.
Generation 1 of 3. Builder: Sonnet. Repair cycle 1 (this file's last section) is done.

## Numbers

| | Rows |
|---|---|
| Batch rows | 1 |
| Open before (`count-not-proved.mjs`, batch ids only) | 1 |
| Open after | 0 |
| Whole book before / after (all four lanes, this branch) | 853 / 852 |

Lane totals after: routes 134, display 680, flow 23, reads 15.

## The row

| Row id | Outcome | What judges it |
|---|---|---|
| `catalog-route:routes-1.json:route:closer-deck:POST action=generate_letters {client_id, offer_key, edu?, force_repair?} (build the repair letter pack or funding deliverables pack, save the PDFs, email the client)` | **practice-test** | `src/pulse/catalog/proofs/fin-b05-door-closer-deck-letters.test.mjs` (14 tests after repair cycle 1), bound by `src/pulse/catalog/proofs/fin-b05-door-contracts.test.mjs`, which now reads the test source (`fin-b05-test-binding.mjs`) instead of searching for the title text |

This is a practice test: fake data, a stand-in database, the in-memory provider, any
outbound request fails the test. It is not a live check. The slice 2 manifest said this
row could not be done because the letter pack "needs a document store and a PDF build
that a stand-in database cannot answer honestly". That was wrong: the real pack builder
runs on the vendor sandbox pull, the memory document store is the default store, and the
documents registry has a double (`src/documents/fake-db.mjs`) that enforces its unique
keys. `src/sales/closer-deck.test.mjs` already ran the function that way; this batch runs
the route (sign-in, role gate, company check, response) the same way.

### What the test judges (the real `api/closer-deck.mjs` and `generateDeckLetters`)

1. Repair button: 200, `delivered`, the PDFs are saved with this company and this client on
   every row, each is a real `%PDF`, dispute letter pack plus CFPB and state AG complaints
   are among them, one email is queued with the letters template to this client's address,
   went through dispatch and reached the (in-memory) provider once, client tagged
   `client:diy-letters`, file stamped `diy_status: Delivered`.
2. Education button: funding pack (analysis pages saved as HTML, bureau letters as PDF), no
   dispute letters, the deliverables email (not the letters email), tag `client:deliverables`.
3. Empty pack (no stored pull), both buttons: nothing saved, no email, no tag, a reason is
   returned, file stamped `Delivery Failed — Retry`.
4. Store cannot be opened: letters built, nothing saved, reason names the store, no email,
   no tag, stamped failed.
5. Template not approved: no message row is queued, response says `template_pending`, PDFs
   still saved.
6. Refusals: funding route (three tier and flag shapes), an offer that forbids letters, an
   unknown offer. Nothing built, saved, queued or stamped.
7. Another company's client, staff of another company, a bad id, no sign-in: 404, 404, 400,
   401, nothing written.
8. The company comes from the sign-in, not from `org_id` in the request body.
9. Role gate: all 8 staff roles tried; exactly admin, closer, owner, sales_manager get in;
   the others are refused before a pack is built.
10. Pressed twice: one message row, one send.

### Can it go red? (break, run, red, restore with `git checkout`)

16 breaks in product code, each made once, run, seen red, and restored. One test (company
from the request body) was added after its break first stayed green; it is red now.

| Break | Red test |
|---|---|
| Role gate widened to `setter` | role gate |
| `ownsClient` drops the company condition | another company |
| Documents saved under the staff id, not the client | repair button |
| `delivered` ignores whether anything was saved | store down |
| Education button sends the letters email | education button |
| Letter pack refusal removed entirely | refusals |
| Email goes out over an empty pack | empty pack, store down |
| Education button asks for the repair pack | education button |
| Education route gets the letters tag | education button |
| Email event key changes every press | pressed twice |
| PDFs never saved | 5 tests |
| `diy_status` always `Delivered` | empty pack, store down |
| Company read from the request body | company from sign-in (added after this break stayed green) |
| Tag step removed | repair button, education button |
| Email queued but never dispatched | repair button, company, pressed twice |
| Pack built for the staff id, not the client | 6 tests |

One mutation stayed green on purpose: removing only `fundingRoute ||` from the refusal
condition. It is an equivalent change. `FUNDING_DFY` has `letters: false`, so
`!offerAllowsLetters(offerKey)` already refuses it. The refusal test goes red when the
whole `if` is removed.

Guard breaks: removing the plug-in line from `door-proof.mjs` turns the guard and the lane
test red; renaming a bound test title turns the guard red.

## Files added (all tests or proof binding, no product code changed)

- `src/pulse/catalog/proofs/fin-b05-door-closer-deck-letters.test.mjs` (the handler test)
- `src/pulse/catalog/proofs/fin-b05-door-contracts.mjs` (the row binding, one entry)
- `src/pulse/catalog/proofs/fin-b05-door-contracts.test.mjs` (the guard)
- `src/pulse/catalog/proofs/fin-b05-test-binding.mjs` (repair cycle 1: reads a test file and says which named tests are live)
- `src/pulse/catalog/proofs/fin-b05-test-binding.test.mjs` (repair cycle 1: 11 tests of that reader)
- `ops/workflows/finish-853-2026-10-14/manifest-b05.md` (this file)

## Shared lines touched (the integrator must merge these)

| File | Change |
|---|---|
| `src/pulse/catalog/proofs/door-proof.mjs` | 1 import line, and `\|\| finB05DoorProof(sourceFile, row)` appended to the plug-in chain (after `s5DoorProof`) |
| `src/pulse/catalog/proofs/door-proof.test.mjs` | regex word `fin-b05-door-contracts` added to `exactSafeHandler`; "known partial rows" sample `generate_letters` replaced by `send_ebook` (still red). The totals test is unchanged: it counts rows that have any proof, and a red monitor already counted. |
| `src/pulse/coverage/gap-door-batch-routes.mjs` | `EXPECTED_ROUTE_GAP_COUNTS` `routes-1.json` 36 to 35 |
| `src/pulse/coverage/gap-door-batch-routes.test.mjs` | 135 to 134 in five places (title, row count, check ids, unique ids, result count) |
| `src/pulse/catalog/proofs/door-batch-route-result.test.mjs` | `rows.length` 135 to 134. The unique handler count (115) is unchanged: closer-deck stays a target through `send_ebook`. |
| `src/pulse/catalog/generated.json` | recompiled with `npm run pulse:catalog`; one row changed (`463a479e544c3dc23d9b`, now `deep`, no red verdict). A conflict here is expected; recompile after merging. |

Other batches that also remove route rows add their decreases to these numbers. This
batch's decrease is 1.

## Product findings (not fixed)

1. The screen says "Letters sent." when the PDFs were saved, even when no email was
   queued. With an unapproved or missing template the response carries
   `email: { sent: false, reason: "template_pending" }`, `delivered` is still `true`, the
   client is still tagged `client:diy-letters` and stamped `diy_status: Delivered`, and
   `public/app/present.js` prints only `documentsStored`. The presenter is not told that
   the email did not go. (The test pins the response and that no message row is written; it
   does not pin the toast.)
2. No live check covers the repair-letters email. The existing tripwires
   `uw-pack-files-incomplete` and `uw-pack-email-not-queued` (`gap-underwrite.mjs`,
   `PACK_EMAIL_PATHS` includes `closer-deck`) read the funding pack subtypes and the single
   funding delivery template only. `EMAIL-DS02-DIY-LETTERS-READY` from this door is not read
   by anything live. A live check there is a new gap lane and was out of scope here.
3. The education button saves its analysis documents as `text/html` pages, not PDFs, while
   the catalog row, the code comment and the email speak of PDFs and documents. Only the
   bureau letters in that pack are PDFs. Wording mismatch, nothing is lost.
4. `api/closer-deck.mjs` cannot be given a document store (it calls `storeFromEnv()`), so
   a handler test has to select the store with `DOCUMENT_STORE_PROVIDER`. Not a bug.

## Commands run and results

- `node scripts/pulse/count-not-proved.mjs` before: `{"total":853,...}`, batch row open.
- `node --test src/pulse/catalog/proofs/fin-b05-door-closer-deck-letters.test.mjs`: 10 of 10
  pass (about 35 s, the PDF builds dominate).
- `node --test src/pulse/catalog/proofs/fin-b05-door-contracts.test.mjs`: 6 of 6 pass.
- Lane and door group: `src/pulse/coverage/gap-door-batch*.test.mjs`,
  `src/pulse/catalog/proofs/door-*.test.mjs`, `s1/s2/s3-door-contracts.test.mjs`,
  `src/pulse/catalog/*.test.mjs`, the new guard: 1,093 tests, 1,092 pass, 1 fail on the
  first run (`door proof totals are deliberate`, my own wrong edit, reverted); rerun of
  `door-proof.test.mjs`: 989 of 989 pass.
- Wider related set (`s1-door-*`, `s2/s3-door-contracts`, `fin-b05-*`,
  `flow-read-contracts`, `read-proof-cases`, `data-proof-cases`, `closer-deck-endpoints`,
  `closer-deck-present`, `src/sales/closer-deck.test.mjs`, gap-door-batch, catalog): 209 of
  209 pass.
- `npm run pulse:catalog`: `3975 mapped, 33 marked repeats, 3942 unique; 3919 wired, 23 red`.
- `node scripts/pulse/count-not-proved.mjs` after: `{"total":852,"byLane":{"gap-door-batch-routes":134,"gap-catalog-display":680,"gap-catalog-flow":23,"gap-catalog-reads":15}}`, batch row closed.
- `npm run lint`: 3,565 files parse clean.

## Repair cycle 1 (independent checker found 5 breaks that stayed green)

The checker made 12 breaks once each. 10 stayed green. This cycle closes the 5 named
weaknesses and the 4 lower-weight ones. Outcome for the row is unchanged: **practice-test**
(fake data, stand-in database, in-memory provider), now with every break below red.
Still not a live check. Nothing in product code was changed.

### What changed in the test

| Weakness the checker named | What the test does now | Break that went red |
|---|---|---|
| 1. Email key never tested across two clients (second client silently not emailed, response still `delivered:true`) | New test: two clients of one company, same offer, pressed one after the other. Two messages, two different keys, each to its own address, "Hi Fixture" and "Hi Second", the provider got both, each client's PDFs, tag and stamp are on that client | `eventId` without the client id: red |
| 2. PDF content never read (letters to the wrong person stay green) | Every saved PDF is read back with `extractPdfText` (pdfjs). Each must carry the client's name and home street, and none may carry another client's name or street. Same check on the education pack's letters and HTML pages. Second client's letters carry her own name and street | Name forced to "Wrong Person": red in the repair test and the two-client test |
| 3. Sworn complaints only tested on the Round 4 side | New test: no recorded bureau answer and a confirmed Round 3 answer both save the bureau letters and **no** CFPB or state AG complaint; Round 4 saves both | Escalation check turned off: red |
| 4. `closer_deck_letters_at` never asserted (the closer desk tripwire `deck_no_outcome` reads it) | Asserted on all four paths (repair, education, empty pack, store down): a string, an ISO date-time (the shape `gap-closer.mjs` matches), parses, and is from this press | Line deleted: red in 5 tests. Written as a number: red |
| 5. Guard searched for the title text (`test.skip` or a title in a comment stays green) | The guard reads the test source: comments and strings are blanked first; a named test must be a call at bracket depth 0 and column 0, with no options object, and hold an assertion; the file must hold no `skip`, `todo`, `only` or `process.exit`; every top-level test must be one the row names | `test.skip`, title left in a comment, `{ skip: true }`, gutted body, `process.exit`, test under an `if`: all six red |

Lower-weight items, now pinned:

| Item | Pinned how | Break that went red |
|---|---|---|
| 405 method guard | New test: GET, PUT, PATCH, DELETE answer 405, `Allow: POST`, the database is asked nothing, nothing saved or sent | Guard disabled: red |
| Not-delivered reason wording | No stored pull: `reason` is exactly `no_crs_result`, `engineSkip` the same, both buttons. Store down: `reason` equals the store's own message `unknown DOCUMENT_STORE_PROVIDER "no-such-store"` | `reason` forced to `empty_pack`: red in both |
| Document titles | Repair pack: exact complaint titles, dispute letters match `Metro 2 Dispute Letter Pack — <file>.pdf`, all unique. Funding pack: the five analysis titles and `Inquiry removal — EX/TU/EQ`, `Personal info — EX/TU/EQ` | Titles reduced to the file name or the bureau: red |
| Email opt-out branch | New test with an opt-out shelf that answers only for this client, this channel and "not opted back in". Email opt-out: PDFs saved, nothing reaches the provider, message `blocked`, reason names `opted_out`. A text-only opt-out, a reversed email opt-out and another client's opt-out all still send | Opt-out branch in `gate.mjs` disabled: red |
| `generated_by` | Every saved document says `closer-deck` (it was only pinned by source text elsewhere) | Renamed: red |

Extra break run for the repair button: pack asked for the funding path: red.

Two things looked at and left alone, by reason:
- `sourceEventId` made unique per press: still equivalent. The document registry keys a
  document on (company, kind, subtype, client, file), so a second press versions the same rows
  and no duplicate row appears either way. Pinning the exact string would pin an internal
  replay key, not a result a client feels.
- `eventId` without `offerKey`: not reachable as a break. The message key also carries the
  template key (`workflow:<template>:<event>`), so repair and education never collide.

### Numbers (cycle 1)

| | |
|---|---|
| Handler tests | 14 of 14 pass (was 10) |
| Guard | 7 of 7 pass (was 6; new: the named titles are every test the file runs) |
| Reader tests | 11 of 11 pass; 5 breaks of the reader itself each turn at least one red |
| Open rows (`count-not-proved.mjs`) | 852 total, batch row still closed (unchanged) |
| `npm run pulse:catalog` | `3975 mapped, 33 marked repeats, 3942 unique; 3919 wired, 23 red`, `generated.json` unchanged |
| `npm run lint` | 3,567 files parse clean |
| Related group (gap-door-batch, door-*, s*-door-contracts, fin-b05-*, catalog, closer-deck) | 1,146 of 1,146 pass |

Breaks run (each made once, run, seen red, put back): 12 in product code, 6 in the handler
test file against the guard, 5 in the reader against its tests. Every file was restored
from its own text; `git status` is clean for product code.

### Shared lines touched in cycle 1

None. `door-proof.mjs`, `door-proof.test.mjs`, the lane files and `generated.json` are as
cycle 0 left them.

### Product findings added in cycle 1 (not fixed)

5. A client who opted out of email still gets the PDFs saved, is tagged `client:diy-letters`
   and stamped `diy_status: Delivered`, and the response is `delivered: true` with
   `email.outcome: "blocked"`. Same family as finding 1: `delivered` means "saved", and the
   presenter's toast prints only `documentsStored`. The test pins what happens, not that it
   is right.
6. Other bound-title guards in this folder search the test text for the title the same way
   the old guard here did (`s1-door-contracts.test.mjs` does: `text.includes(title)`). A
   skipped test there keeps its guard green. Not touched here: they are other batches' files.
   `fin-b05-test-binding.mjs` is written to be reused by them.
