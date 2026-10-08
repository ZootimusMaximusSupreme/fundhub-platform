# Documents — upload and delivery gaps

Lane 9. Report only. Recon (AG-07) is the one alarm. There is no second alarm.

Slice 09 already checks that the doors are on the morning list and the jobs are in the workflow index. This file does not repeat that.

The check only reads. It sends a GET with no file. It does not upload a file. It does not email a client. It does not open a client file.

## The four breaks

| Check | What it looks for | Pass | Fail |
|---|---|---|---|
| `documents:upload-route` | Upload door is dead | GET `/api/documents-upload` answers 405 (or 200, 400, 401, 403). No file sent. | 404, a 500, or the door cannot be reached. |
| `documents:required-unchased` | A required paper was asked for, never came back, and nobody chased | No client still tagged `docs:missing` past 3 days with a request stamp, no upload, and no chase. | One or more of those clients. |
| `documents:stuck-processing` | A document row stuck mid-send, or a read still processing | No `documents` row left `delivery_status = pending` past 3 days. No `doc-check` read on `failed_events` overdue past 60 minutes. | Either count is above zero. |
| `documents:cannot-open` | A client cannot open their file | GET `/api/documents-download` answers (401 with no login is enough). Every document row has a version and a storage key. No file opened. | The download door is missing, or a row has no version to open. |

3 days is 3 times the daily vault chase. 60 minutes is 3 times the 20-minute document read retry.

A chase is a vault ask (`SMS-VAULT-ASK-1`, `EMAIL-VAULT-ASK-2`, `SMS-VAULT-ASK-3`), a follow-up (`SMS-DOC-02-REQUEST-MORE`), a `doc-vault` task, or a staff task from `document-vault`, `document-vault-review`, or `doc-check`. The first request (`SMS-DOC-01` / `EMAIL-DOC-01`) is not a chase.

Each row is `{ id, status, detail, suggestedFix }`. Status is `PASS`, `FAIL`, or `skip`. No fetch and no database skips all four. A failed read on one check does not drop the other three.

## Test

`node --test src/pulse/coverage/gap-documents.test.mjs`

9 tests. 9 pass. 0 fail. 0 skipped.
