# UnderwriteIQ and SLO pack gaps

Lane 20. Read only. Recon (AG-07) is the one tripwire. No second watchdog.

Slice 19 lists SLO job names. Slice 21 lists the underwrite door and the credit jobs. This file does not repeat those lists. It looks for four breaks:

| Check | FAIL when |
|---|---|
| `uw-paid-roadmap-no-pack` | A buyer paid the roadmap (`slo_` link, not a demo, status paid or a paid time), their credit pull finished after the payment (`analysis.completed`, older than 2 hours), and none of the four pack files is saved |
| `uw-letters-missing` | A credit file is in, and inquiries have no inquiry letter, or a dispute case has no letters |
| `uw-offer-fulfillment-failed` | The pack job is still failed in `failed_events`, or the client pack status is Delivery Failed — Retry |
| `uw-read-door` | The real `GET /api/read/underwrite` handler, run in this process on the newest real client with a stored credit file, throws or answers 500 |

Each row is `{ id, status, detail, suggestedFix }`. Status is `PASS`, `FAIL`, or `skip`.

A read door that this run could not open (login seam answered 401, 403, 404, 400, or 503) is a `skip` with the status in the words. It is never a PASS. No real client with a stored credit file is a `skip`.

No credit pull. No charge. No page edits. No change to UnderwriteIQ math.

## Where the lines are

- `daily-pulse` already pings `/api/read/underwrite` with no login (check id `suggestions`) and counts 401 as fine. That tells us the route is wired. It cannot see a 500 behind the login. `uw-read-door` is the part it cannot see.
- A buyer who paid but has not filled the pull form has no pull yet. The pack is built after the pull, so that buyer is not a break here. `slo-paid-form-nudge` chases them.

## Prove

`node --test src/pulse/coverage/gap-underwrite.test.mjs`

## Review — Claude, 2026-10-08

What was wrong:
- `uw-read-door` made one web call with no login. That always answers 401. `daily-pulse` already does the exact same call and counts 401 as fine. So it was a copy, and it could never see a 500 behind the login. This is the exact break that hit before: the handler used a name that was not defined and every request died, while the route still answered 401.
- `uw-paid-roadmap-no-pack` went red for every buyer 2 hours after paying. But the pack is built after the buyer fills the pull form and the pull finishes. A buyer who has not filled the form yet is not a break. It was also stricter than the code on what "paid" means (the code accepts status paid or a paid time).
- The tests answered by regex and never ran the door.

What changed: `uw-read-door` now loads the real handler and runs it in this process for one real client. The only fake is the staff session lookup (one statement). Nothing is written and no login is made. A test runs the real `verifySession` against that stand-in, so if the login SQL changes the test fails. `uw-paid-roadmap-no-pack` now needs a finished pull after payment. Two more tests run the real handler on a thin file (answers 200) and with a throwing read (shows the break).

Live result after (read only, production database, plain role): 4 PASS, 0 FAIL, 0 skip. Staff role gives the same 4 PASS. With only `db, scope, now` the door check skips, because it needs a company id. The pulse passes one.

Why the PASS rows are true today: production has 0 paid roadmap buyers (15 roadmap links, all still `sent`), 1 real client with the pack saved, 0 open pack job failures, and 0 clients marked Delivery Failed. The door ran the real engine on a real file with 2 tradelines and answered 200.

Proof the paid-roadmap SQL can match real rows: I ran it read only with the roadmap filters swapped for a paid custom link and an impossible pack name. It returned the one real client with a pull after payment.

Test result: 16 tests, 16 pass, 0 fail.

Real company break found in this lane: none.

## Tier 1 — Claude, 2026-10-09

Two new checks in `gap-underwrite.mjs`. The lane now has six. Read only. No send, no pull, no charge. The SQL only gathers facts. Plain JavaScript judges them, so the tests can feed it real shapes.

### What each one asks

| Check | The question | Red when |
|---|---|---|
| `uw-pack-files-incomplete` | Did the buyer get the whole pack, or only part? | A real client has any pack file saved, the newest is over 30 minutes old, and one of these is true: one of the 4 core files is missing (Credit Analysis Report, Credit Optimization Roadmap, Funding Snapshot, Bank and Lender Match List); the Capital Readiness Summary is missing from a pack built on a funding credit tier (see the fixes section: a repair or hold file is never made one); a pack file has 0 bytes; a pack file was made by the short fallback printer; or a $297 roadmap buyer's pack, first saved on or after 3 Oct 2026, has no Business Duplication Map |
| `uw-pack-email-not-queued` | Was the buyer told their pack is ready? | A buyer is owed the email (all 4 core files saved, newest over 30 minutes old, and they bought the roadmap or the pack was saved by `slo-pack` or `closer-deck`) and no `EMAIL-U02-ANALYZER-FUNDING-DELIVERY` message was queued at or after the first file. Also red when that template is missing, has draft copy, or is not approved, even before any buyer is owed |

### Where I changed the plan, and why

- **Dropped "failed delivery_status" from the files check.** `documents:stuck` in the documents lane already goes red for any real document that failed or bounced. Nothing in the pack path ever writes `failed` on a pack file (all 5 live files read `not_delivered`). A second red for the same fact would be noise.
- **The email is owed only on the paths that send it.** The pack email is queued by `src/slo/deliver.mjs` (roadmap buyers) and `src/sales/closer-deck.mjs`. The CRS router (c-06) saves a pack and sends no pack email. That was the owner's call when the old U-02 mail was retired on 22 Aug. So a pack saved only by the router is not owed one. If I had flagged it, the one real pack on live would be red every morning for a reason nobody can fix.
- **I added the template check to the email check.** `sendTemplated` writes no row at all when the template is missing, draft or not approved. A buyer would never be told and no row would show it. Now the check goes red before the first buyer, not after.
- **The guide is never required.** The Business Readiness Guide is only built for a thin-file client. Its absence is normal. The map is required only of a roadmap buyer, and only for packs first saved after the code that builds it shipped (2 Oct).
- **No size floor.** A normal Capital Readiness Summary is a one-page PDF of about 1.4 to 1.6 KB (I built one to see). The live one is 1,603 bytes. A floor would have raised a false alarm. Only exactly 0 bytes is red. An unknown size (NULL) is left alone.
- **g09 G12 (the print service falls back to smaller documents) is old.** The 4 core pages are now saved as hosted HTML. Every live core page says `engine: html`. The print service is not called. I kept one leg that reads the old `pdf-lib` stamp, so if printing ever comes back the short printer shows up. On today's path that leg cannot fire. It is not the only way the check goes red.

### Live result (production database, read only, plain role)

`gap-live.mjs underwrite`: 6 PASS, 0 FAIL, 0 skip. Staff role gives the same 6 PASS. Query errors: 0. Write attempts: 0. Run time 1.9 s. With only `db, scope, now` (no company id) the email check skips on purpose, same as the read door. The pulse passes the company id.

Why they are green today, in plain words: there is 1 saved pack for a real client (client 029964c5, saved 30 Sep by the CRS router). It has all 5 files, none empty, none from the short printer. It was not a roadmap buyer and not a closer-deck save, so no pack email is owed. The pack email template is approved. Nobody has paid for the roadmap yet: all 15 roadmap links are still `sent`, none has a paid time.

### Proof that each one can go red (read only, real history)

I ran the lane's own SQL on the live database, then the lane's own judges. Each flip changes one thing:

- Left out `funding_summary` from what the SQL sees: the real pack goes red, "is missing the Capital Readiness Summary".
- Counted the real files as 0 bytes: red, "has 5 pack files with 0 bytes".
- Counted the real HTML pages as the short printer: red, "has 4 pack files made by the short fallback printer".
- Judged the same pack 5 minutes after its newest file: not judged. 31 minutes after: judged and red.
- Said the CRS router owes the email: the real pack goes from owed 0 to owed 1, not told 1, red.
- Said the client got a different real email (`EMAIL-DOC-03-APPROVED`, sent after the first file): owed 1, not told 0, so the control stays quiet.
- Asked for a template key that does not exist: red, "has no row, so no pack-ready email can be queued".
- A write attempt in the same transaction: refused, "cannot execute UPDATE in a read-only transaction".

The map leg and the roadmap-buyer email have no real case yet (the one client with an `slo_ref`, d6ee1b12, has 0 pulls and 0 pack files). Those are proved by tests only. The `slo` flag itself reads `true` for that buyer and `false` for the pack client on live.

### Tests

`node --test src/pulse/coverage/gap-underwrite.test.mjs`: 42 tests, 42 pass, 0 fail, 0 skip at first. The 16 that were here before still pass with the same assertions. I only grew the id list from 4 to 6, the row count from 4 to 6, and gave the "clear book" fixture an approved template. After the checker fixes below it is 53 tests (see the fixes section for the numbers).

New tests: PASS and FAIL for every leg, the neighbour cases that must stay quiet (not a roadmap buyer, saved before the map existed, guide absent, router-only pack, fewer than 4 files, still saving), read errors are skip, no company id is skip, and pins that fail if the template key, the `slo-pack` and `closer-deck` names, or the saver's subtype names drift.

I also broke the code on purpose 21 ways (drop each leg, flip each window, turn a skip into a PASS, swap the template key, and so on). All 21 made a test fail. None survived.

### Real breaks found

None in this lane. Nothing is switched off: `slo-pack-delivery` is registered in `src/workflows/index.mjs`. The in-process twin `onAnalysisCompletedSloPack` is not registered, and the Inngest one is the live path.

One fact to know, not a bug: the one live pack has never had a pack email, and the router path will never send one.

### Fixes after the independent checker — Claude, 2026-10-09

The checker found two problems in the two new checks. Both were real. Both are fixed. Read only, no product code touched.

**1. The Capital Readiness Summary is not owed to every pack (was high).**

What was wrong: `uw-pack-files-incomplete` wanted the Capital Readiness Summary in every pack. But the engine only makes that file when the credit file is a funding tier (`FULL_FUNDING`, `FUNDING_PLUS_REPAIR`, `PREMIUM_STACK`). A `REPAIR_ONLY` file gets a repair package. `FRAUD_HOLD` and `MANUAL_REVIEW` get a hold package. Neither makes the summary. The roadmap pack job runs for every tier. So the first repair-path roadmap buyer would have turned this check red every morning, and nothing in the data could clear it.

What it does now: the check reads the credit tier of the pull the pack was built on. That is the newest pull saved at or before the pack's newest file. A later pull cannot change it. The tier comes from the pull's stored tier, or the engine answer stored in the pull.
- Funding tier and no summary: RED, as before.
- Repair or hold tier and no summary: fine. The PASS line says how many packs are not owed one.
- No stored tier and no summary: `skip`, with the reason. It is never a PASS and never a false red.
- Everything else (a core file gone, 0 bytes, the short printer, the missing map) still turns it red on a repair or hold file too.

Why the "newest pull at pack time" rule matters: on live, the one real pack was built 5 seconds after a `PREMIUM_STACK` pull. A simulated `MANUAL_REVIEW` pull came 90 minutes later. If the check used the newest pull, it would wrongly say this client is not owed a summary. I proved that on live (below).

A test runs the real `buildDocuments` over all six tiers and fails if the lane's two lists drift from what the engine really makes.

**Leftover card (not fixed, owner lock): the pack email promises the summary to everyone.** The email `EMAIL-U02-ANALYZER-FUNDING-DELIVERY` lists "5. Your Capital Readiness Summary". `slo-pack-delivery` has no tier gate. So a repair-path or hold roadmap buyer would be told they got a file that was never made. No live case today (nobody has paid for the roadmap, so 0 roadmap buyers have a pack). This is a product choice for Chris. I did not touch it.

**2. The SQL that decides who is owed what was not tested (was medium).**

What was wrong: the tests fed made-up rows to the judges. A broken SQL line (the roadmap-buyer flag, the email path flag, the message join, the file count) would still have passed 42 of 42.

What changed, two ways:
- **Always runs:** a test pins the exact lines of both SQL texts (the roadmap-buyer flag, the file counts, the first and last file times, the email path flag, the message join on client and company, the template key, and the tier lookup). Change one and it fails, no database needed.
- **Runs when a database is there:** a test runs the real SQL on made-up rows inside a read-only transaction that is always rolled back. The made-up rows stand in for the four tables, so no real table is read and nothing can be written. It checks every fact the checker said was never seen live: the roadmap flag, the email path flag, the core file count with a file saved twice, the newest pack email against an older one and a different template, another company's mail, an email queued before the files, a demo client, a client in another company, and the tier lookup. Then it hands the SQL's own rows to the two judges and checks the verdicts. Without a database these 2 tests skip and say why.

**Numbers I saw**
- Lane test with a database: 53 tests, 53 pass, 0 fail, 0 skip. Without a database: 51 pass, 0 fail, 2 skip (the two that run the SQL).
- Three old assertions got a fuller shape, not a weaker one: the judge now also returns `unsure` and `exempt`, so three `deepEqual` lines list those two keys too. The test fixture row now carries a funding tier by default, so the old tests keep their meaning.
- Mutation test in a scratch copy of the repo (the real repo is not touched): 50 deliberate breaks. All 7 the checker said survived are now caught. Result: 50 of 50 caught with a database, and 50 of 50 caught with no database too (the pinned lines).
- Live, read only, `fundhub_app` inside `BEGIN READ ONLY`: `gap-live.mjs underwrite`: prod mode 6 PASS, 0 FAIL, 0 skip. Staff mode 6 PASS. No company id: 4 PASS and 2 skip, on purpose. 0 query errors, 0 write attempts, about 2 s.
- Red paths on the real pack (client 029964c5, tier `PREMIUM_STACK`), one change each: summary removed gives RED; the same with `FULL_FUNDING` gives RED; `REPAIR_ONLY`, `MANUAL_REVIEW` or `FRAUD_HOLD` gives PASS with 1 exempt; no tier gives skip; `REPAIR_ONLY` plus one 0 byte file gives RED. With the time bound taken out of the tier lookup, the same pack reads `MANUAL_REVIEW` (wrong). The email rows on live read owed 0; flipping the path flag on gives owed 1, not told 1 (RED). A write attempt in the same transaction was refused.
