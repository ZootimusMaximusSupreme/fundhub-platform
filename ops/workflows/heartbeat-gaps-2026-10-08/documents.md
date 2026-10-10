# Documents — upload and delivery gaps

Lane 9. Report only. Recon (AG-07) is the one alarm. There is no second alarm.

Slice 09 already checks that the doors are on the morning list and the jobs are in the workflow index.
The morning list already pings `GET /api/documents-upload` (answers 405) and `GET /api/documents-download` (answers 401).
This file does not repeat any of that.

The check only reads. It does not upload a file. It does not email a client. It does not open a client file.
The only store call is "does this file exist" (a HEAD request).

## The four checks

| Check | What it looks for | Pass | Fail |
|---|---|---|---|
| `documents:upload-store` | Uploads are not landing in the right place | `DOCUMENT_STORE_PROVIDER` is a real store (not memory), and the newest saved file is in it. | The store is memory or unknown, or the newest saved file is not there. |
| `documents:required-unchased` | A required paper was asked for, never came back, and nobody chased | No client tagged `docs:missing` for 3 days with no file and no chase after the first ask. | One or more of those clients. |
| `documents:stuck-processing` | A document stuck mid-send, or a read that is not working | No document left `pending` past 3 days, none `failed` or `bounced`, no `doc-check` read late past 60 minutes, none unread after 3 days. | Any of those counts is above zero. |
| `documents:cannot-open` | A client cannot open their file | Every document row has a version with a storage key, and the 5 newest saved files exist in the store. | A row has no version to open, or a sampled file is missing from the store. |

3 days is 3 times the daily vault chase. 60 minutes is 3 times the 20-minute reader retry. The reader backs off to once a day, so 3 days of retries is 3 times that.

A first ask is the first request on any path that tags `docs:missing`: `SMS-DOC-01-REQUEST` / `EMAIL-DOC-01-REQUEST` (deposit and inquiry), `SMS-F02-ID-PORTAL-NEEDED` / `EMAIL-F02-ID-PORTAL-NEEDED` (onboarding nudge), `SMS-F06-MISSING-DOCS` / `EMAIL-F06-MISSING-DOCS` (bank asked for more). The earliest one, or the `doc_01_request_sent_at` stamp, is when the client was asked.

A chase is a vault ask (`SMS-VAULT-ASK-1`, `EMAIL-VAULT-ASK-2`, `SMS-VAULT-ASK-3`), a follow-up (`SMS-DOC-02-REQUEST-MORE`, `EMAIL-F02-ID-PORTAL-NEEDED-FOLLOWUP`), a `doc-vault` task, or a staff task from `document-vault`, `document-vault-review`, or `doc-check`. A first ask is not a chase.
A file counts as received when it is a `client_upload` or an `inquiry_doc` made after the ask.

Each row is `{ id, status, detail, suggestedFix }`. Status is `PASS`, `FAIL`, or `skip`. No database skips all four. A failed read on one check does not drop the other three.

## Test

`node --test src/pulse/coverage/gap-documents.test.mjs`

## Review — Claude, 2026-10-08

What was wrong:
- Two of the four checks were copies. The upload and download pings ask the same two doors the morning list already asks. A 405 does not say if an upload works.
- "File received" only counted one kind of file. A client who sent their ID as an inquiry file looked like they sent nothing.
- It only knew the DOC-01 ask. Asks from the onboarding nudge and from the bank were never seen.
- Demo clients and demo documents could turn a row red.
- "Stuck read" only caught a retry that was late. A document the reader could not read for days (retry pushed to tomorrow) looked fine. Failed and bounced delivery was not seen.
- The tests used canned numbers. The SQL never ran, so a wrong SQL would still pass.

What changed:
- Dropped the two door pings. Added `documents:upload-store`: is the store real, and did the newest upload land.
- `cannot-open` now also reads the 5 newest files back from the store (HEAD only, 8 second limit each).
- Unchased: counts both file kinds, reads all three ask paths, leaves out demo and test clients, and no longer breaks on a bad stamp.
- Stuck: also counts failed and bounced delivery, and a read still unread after 3 days.
- Fix text now says the vault chase only covers paid Capital Blueprint buyers.
- 13 tests, up from 9. They check the SQL text, the settings passed in, and the FAIL path of every check.

Live result after (production database, read only): prod 4 PASS, 0 FAIL, 0 skip. Staff view the same. No write tried.

How it was proved:
- 45 made-up rows run through the real SQL on the live database engine (read only, tables shadowed). Every row came out as expected.
- Broke one thing at a time on the real database: memory store, missing files, renamed table. Each went red.
- 12 deliberate breaks in the code. The tests caught all 12.
- Today the production tables hold no client waiting on a document, so the red paths could only be proved this way.

Test result: 13 pass, 0 fail, 0 skipped.

Left alone: `exhausted` reads. The sweeper already asks a person after about 9 days.
