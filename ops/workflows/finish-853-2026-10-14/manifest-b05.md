# Batch 05 manifest — finish the 853 (tier 2, lane gap-door-batch-routes, 1 row)

Branch `fin/b05`, built from `fin/base` (`2f4f574a0`). Nothing was pushed or merged.
Generation 1 of 3. Builder: Sonnet.

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
| `catalog-route:routes-1.json:route:closer-deck:POST action=generate_letters {client_id, offer_key, edu?, force_repair?} (build the repair letter pack or funding deliverables pack, save the PDFs, email the client)` | **practice-test** | `src/pulse/catalog/proofs/fin-b05-door-closer-deck-letters.test.mjs` (10 tests), bound by `src/pulse/catalog/proofs/fin-b05-door-contracts.test.mjs` |

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
