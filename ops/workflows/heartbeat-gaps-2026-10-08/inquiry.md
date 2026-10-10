# Lane 19 — inquiry removal gaps

Read only. Report only. Company name is Fundhub.

Slice 29 already checks that the specialist doors and jobs are on the morning list.
The morning list already pings `GET /api/inquiry` and `GET /api/read/inquiry-cases` (a 401 is a live door).
The daily pulse reads Recon (AG-07) itself (id `recon`).
This lane repeats none of that.

## Checks

`gapChecks(ctx)` in `src/pulse/coverage/gap-inquiry.mjs` returns 4 rows. Shape is `{ id, status, detail, suggestedFix }`. Status is `PASS`, `FAIL`, or `skip`.

| id | What it reads |
|---|---|
| `inquiry:case-stuck` | A case nothing will move: Escalated and quiet for 72 hours, or Queued / Scheduled / In Progress with no call scheduled, none fired, and quiet for 72 hours, or a call that came due and was not fired after 45 minutes (3 runs of the 15 minute call sweeper). A case waiting on a call to come, or on the bureau after a call, is not stuck. Blocked cases wait on client documents. Demo and test clients are left out. |
| `inquiry:letter-round` | A funding round, made by the inquiry gate, that still has open inquiries and has no letter draft and no letter already sent. |
| `inquiry:specialist-api` | The same reads the specialist desk runs behind the login, run on the real database: the case list, the document packet reads, and the desk cases select. A throw, or a packet read that cannot answer, is a fail. |
| `inquiry:upload-door` | GET `/app/client-portal.html` and look for the `inquiry_doc` upload box. |

## Rules kept

- No bureau mail.
- No real ID upload.
- GET only. No POST. SELECT only.
- One tripwire: existing Recon (AG-07). No second watchdog.
- HTML was not edited.

`ctx` is `{ db, orgId, fetchImpl (or fetch), baseUrl, now }`. No database skips the three reads. No fetch skips the portal page.

## Test

`node --test src/pulse/coverage/gap-inquiry.test.mjs`

## Review — Claude, 2026-10-08

What was wrong:
- `recon` was a copy of the daily pulse's own Recon check. Removed.
- `inquiry:specialist-api` only did a GET with no login. It always got a 401, which counts as alive. A crash behind the login would still PASS. It also repeated the two pings on the morning list.
- "Stuck" counted any case quiet for 72 hours. After a call is fired the case waits on the bureau for a long time. Those would have turned red every morning. A call due "right now" also counted before the sweeper had its 3 runs.
- "No letter" counted every case that had a round, even ones from the IRA webhook, which never get a letter.
- The tests used canned numbers. The SQL never ran.

What changed:
- 4 checks, not 5. Recon removed. The specialist check now runs the desk reads on the real database.
- Stuck now means "nothing is going to move it", with a 45 minute grace on due calls.
- Letter check only counts cases from the inquiry gate.
- 10 tests, up from 9.

Live result after (production database, read only): prod 4 PASS, 0 FAIL, 0 skip. Staff view the same. No write tried.

How it was proved:
- 25 made-up cases run through the real SQL on the live database engine (read only, table shadowed). Every row came out as expected, including waiting cases that must stay green.
- Broke one thing at a time on the real database: renamed the cases table, served a portal page with no upload box. Each went red.
- 7 deliberate breaks in the code. The tests caught all 7.
- The `inquiry_removal_cases` table in production holds 0 rows today, so the red paths could only be proved this way.

Test result: 10 pass, 0 fail, 0 skipped.

Left alone: a case that is In Progress after its call and never closes. Nothing in the data says how long that should take. Chris sets that line.
