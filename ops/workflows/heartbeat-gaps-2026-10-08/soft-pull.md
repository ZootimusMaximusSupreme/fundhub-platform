# Soft-pull approve door

Lane: the credit soft-pull approve screen only. Read only. Not wired into the shared pulse files.

`gapChecks(ctx)` in `src/pulse/coverage/gap-soft-pull.mjs` returns three rows. Shape: `{ id, status, detail, suggestedFix }`. Status is `PASS`, `FAIL`, or `skip`.

The plain up/down ping of both doors is already `reg:soft-pull-approve.html` and `reg:soft-pull-approve` in the registry. These rows add what that ping cannot see.

| id | What it does | FAIL means |
|---|---|---|
| `soft-pull:approve-page` | GET `/app/soft-pull-approve.html` | The page is 404 or 500, or a 200 page is not the approve screen (it does not call the read route) |
| `soft-pull:approve-read` | GET `/api/soft-pull-approve` with no link token | The read API is 404 or 500, or the JSON is not the approval read shape. A 400 or 401 with `ok: false` and an `error` string is a pass. That answer comes before any database read |
| `soft-pull:approve-signed-read` | The real handler, run in-process, GET only, with a link signed for the newest real client | The read that follows a good link does not come back with the words, the price and the consent state. That is the database half the unsigned GET never reaches. Also fails when `DOCUMENT_URL_SECRET` is missing, because then no approval link can be sent |

No fetch: the two GET rows are `skip`. No database or company: the signed row is `skip`.

## Not this lane

- Do not pull credit.
- Do not send bureau mail.
- Do not POST the approve route.
- Do not edit the approve page.
- Recon (AG-07) is the one tripwire. Do not invent a second watchdog.
- Do not auto-fix.

## Test

`node --test src/pulse/coverage/gap-soft-pull.test.mjs`

Fake fetch. No live credit pull. The signed-read tests run the real handler with a made-up database.

## Tier 1 — Claude, 2026-10-09

The lane now returns six rows. The first three are the approve door (above, unchanged). The last three read the credit-pull ledger. They read the database only. They never pull credit, send, or POST.

### What each new check asks

| Check id | The question | Red when |
|---|---|---|
| `softpull:request-failed-or-stuck` | Did a credit pull fail, or never finish? | A pull failed in the last 3 days and the client has had no newer pull since. Or a pull the job runs itself (a paid $32/$297 pull, or the Finance OS monthly pull) is still `queued` after 15 minutes. Or any pull is `processing` and untouched for 15 minutes. Or a pull that waits on staff (a staff or portal tap, or the paid dispute round) is still `queued` after 48 hours. |
| `softpull:paid-form-not-filled-2h` | Did a roadmap buyer pay and still not fill the pull form after 2 hours, with no reminder sent? | A paid "SLO diagnostic" order, paid 2 hours to 14 days ago. The order has no stored form, the client has no live soft-pull consent and no credit file, and no `EMAIL-SLO-PAID-FORM-01` or `SMS-SLO-PAID-FORM-01` went out after the payment (a reminder that failed, bounced or was blocked does not count). Company, test and bot emails are left out, because the reminder job never writes to them. |
| `softpull:approve-click-no-pull` | Did a client approve the pull and pay, and nothing ran? | A paid diagnostic order (the $297 roadmap or the $32 approve link) in the last 30 days. The client has a live soft-pull consent. 15 minutes after the later of the payment and the approval, the client has no pull that answers the payment. A pull answers it if it was asked for at or after the payment, if it is open right now (queued or processing), or if it was closed at or after the payment. (Changed in the checker round below.) |

### I changed the plan in three places. Here is why.

1. **`approve-click-no-pull` was wrong as planned.** The plan said red when a consent came through the approve link and no pull row followed in 15 minutes. But the approve click does not start a pull. It saves consent, saves identity, and makes a $32 checkout link. The pull starts only after the buyer pays (`api/soft-pull-approve.mjs` POST, then `diagnostic.paid` runs C-00). So "approved, no pull yet" is normal until the buyer pays. That rule would cry wolf at every buyer who has not paid. The honest break is "approved AND paid AND no pull", so that is what the check watches. It also covers the $297 roadmap form, which is the same ledger.
   - The approve consent is `typed`, the roadmap form is `checkbox`, and the consent page can also write `typed`. So the check cannot tell an approve-link consent from a consent-page one. It does not need to. Paid plus live consent is enough.
2. **`paid-form-not-filled-2h` reads the order, not `custom_fields.crs_paid`.** The planned flag is set by the payment event, so it would also miss a buyer whose payment landed but whose event did not. The reminder job itself reads the paid order row (`payment_links`, description "SLO diagnostic", `identity_stored_at` empty). The check reads the same row, so it sees the same buyer the job sees. The 24-hour `consent:required` check stays as the slower backstop for anything older than 14 days.
3. **`request-failed-or-stuck` does not use one 15-minute rule for every queued row.** A staff tap on the soft-pull request door, and the paid dispute round, only record a request. A person presses the staff pull button later. A 15-minute rule would be red on every one of them. So those get 48 hours. Only the pulls the job runs itself get 15 minutes. A failed pull is also forgiven once the same client has a newer pull that is open or done, because someone already retried it.

### Live result (read only, real database)

`node gap-live.mjs soft-pull`, run 2026-10-09:

- prod mode: 6 pass, 0 fail, 0 skip, 646 ms for the whole lane.
- staff-database mode: 6 pass, 0 fail, 0 skip, 828 ms.
- 0 SQL errors. 0 write attempts. Each read took 89 to 279 ms.
- All green on real data because there is nothing to catch yet: the ledger holds 1 pull row, a Finance OS pull for a `+sim-11` test client (fulfilled, 2026-09-30). The check leaves test clients out, so it reads 0 rows. There are 0 paid roadmap orders (15 roadmap links exist, all `sent`, none paid). There are 0 paid diagnostics.
- Proved it reads real rows: with the clock set to 2026-09-30 08:00 and test clients let in, the same check reads that 1 real row.

### Proof each one can go red (real SQL, made-up rows, read only)

I ran the real check code against the real schema inside a read-only transaction, with made-up rows laid over the real tables (a `WITH` that hides the table for that one statement). Nothing was written. 26 cases. Every case did what it should:

- Ledger: a pull failed 1 hour ago is red. Failed, then retried and fulfilled is green. Queued 30 min (paid job) is red. Queued 5 min is green. Processing and untouched 40 min is red. A staff tap queued 60 hours is red. A failed pull for a `+sim-` test client is left out.
- Paid form: paid 3 hours ago, no form, no reminder is red. The same buyer with a sent reminder is green. A bounced reminder is red. Live consent is green. A revoked consent is red. Paid 1 hour ago is green. Form stored, demo order, the $32 order, and a company email are all left out.
- No pull: approved, paid 3 hours ago, no pull row is red. A pull row made after the payment is green. A pull from 10 days ago does not count, still red. No consent, revoked consent, paid 5 min ago, demo order, and a repair payment are all left out.

### Tests

`node --test src/pulse/coverage/gap-soft-pull.test.mjs`: 53 tests, 53 pass, 0 fail, 0 skipped when the builder finished. That is the 21 old tests plus 32 new ones. The count after the checker round is in the last section.

- Every threshold is walked at both edges (14, 15 and 16 minutes; 47, 48 and 49 hours; 1:59, 2:00 and 2:01 hours; 3 days).
- Each check has a PASS test and a FAIL test.
- I broke the logic on purpose 10 ways (no forgiveness for a retry, dead reminders counted, the consent guard removed, the clock slop flipped, the person filter removed, the staff queue treated as a job queue, processing counted from the request time, live consent ignored, "later of the two" dropped, the 3-day window ignored). Each one failed at least one test. I put every file back and re-ran: 53 pass.

Three old tests were changed, because the lane went from 3 rows to 6: `gap checks skip when there is no fetch`, `a loaded screen and an unsigned read both pass`, and the lane-together test (now `all six rows go out together in the lane`). Every door assertion is unchanged. The shared `assertShape` helper now expects six ids and checks the door rows with the same Recon text as before. Nothing was deleted, skipped or weakened.

### Not built

- **Approve click that saved consent but could not make the $32 checkout.** The handler tells the buyer "ask your advisor for the pay link" and only says so in the web reply. Nothing is saved. A read-only watcher cannot see it, and a consent with no pay link looks the same as a consent taken on the consent page. Not faked.

### Other notes

- The lane file was already on the `modules.mjs` list. No change there.
- Nothing in this lane runs at run time from repo files. It imports `consent/index.mjs`, `slo/visitor.mjs` and `gap-consent.mjs` (for the shared test-client pattern); the bundler packs them.
- Whole-bundle proof (`npm run pulse:prove`) was not run from this lane. Three other lanes' files (`gap-keys`, `gap-handoff` and others) are mid-edit and not on the list yet, so the shared checks (`modules.test`, `run-slices.test`, the outbound-fence scan) are red for those files, not for this one.
- Files: `src/pulse/coverage/gap-soft-pull.mjs`, `src/pulse/coverage/gap-soft-pull.test.mjs`, this board. Copies are in the scratchpad `c-backup/soft-pull/`.

## Tier 1 fix, checker round — Claude, 2026-10-09

An outside checker read the three new checks and found three things. Here is each one and what I did.

### 1. The tests did not prove the SQL (fixed)

The checker changed a copy of the lane 16 ways in the SQL. Seven changes lived with all 53 tests still green. The worst one dropped the "is it paid" filter. Then the 15 unpaid roadmap links that exist today would read as paid buyers, and the check would go red every morning.

Why it happened: the tests handed the judge ready-made rows. A broken WHERE clause never reached them.

What I added to the test file:

- **A clause-by-clause test of all 7 reads.** It pins each read's FROM, every AND-ed condition, the sort and the row cap, with the spacing taken out. A dropped filter, a wider window, or a lost per-client scope now fails. The window numbers must also equal the JS ones.
- **A self-test of that test.** It applies 22 kinds of break to the SQL text (the paid filter, the windows, the company filter, the per-client scope, the consent rule, the sort, the cap) and checks each one is seen.
- **A real-SQL suite, 49 cases plus 1 sanity check.** It runs the real check functions on a real Postgres. Every table the lane reads is hidden behind made-up rows, so nothing real is read or written. It follows the same pattern as `gap-payments.test.mjs`. It needs `DATABASE_URL`. Without one it is skipped and says so.
- **One small export.** `withReader` is now exported so a test can prove the read-only guard is wired in. It was the only piece no test could reach.

Proof (a copy of the lane, 48 deliberate breaks, the full test file run against each):

- The 7 breaks that got through are now all caught: the paid filter dropped, the 14 day window widened, the 30 day window widened, the 3 day ledger window removed, the per-client scope dropped from the pull read and from the credit-file read, the company filter dropped from the paid-form read. Every one is caught **without a database**.
- I ran 48 breaks in all: those 7, plus 41 more across the SQL and the judge logic (a retry no longer forgiven, the staff queue treated as a job queue, the clock slop flipped, dead reminders counted, a failed read turned into a PASS, the read-only guard removed, and the new pull rule and its plumbing broken nine ways). Before the fix 7 of the checker's 16 got through. Now 48 are caught and 0 are left.
- The real-SQL suite catches the ones that change meaning on its own, with the text tests off: the paid filter, the company filter, the per-client scope, the demo filters, the consent rule, and the "open pulls sort first" rule.

### 2. A false red that could last 30 days (fixed)

The case: a staff member queues a pull. Then the buyer pays. The job (C-00) sees a pull is already open and writes no new row (`already_open`). Staff finish that pull. The check only looked at when a row was asked for. It saw nothing newer than the payment and said "no pull was started" for up to 30 days.

The fix: a pull now answers a payment in three ways.

1. It was asked for at or after the payment (as before).
2. It is open right now, queued or processing. If it sits too long, row 1 goes red (3 days for a stalled job, 48 hours for staff).
3. It was closed at or after the payment. A closed row's close stamp (`resolved_at`) is the truth. If that stamp cannot be read, `updated_at` stands in.

A pull that closed before the payment still does not answer it. A later touch of `updated_at` does not change that.

The read for this (`PULL_TIMES_SQL`) now also returns the pull's state, its close time and its touch time.

Proof, the old judge next to the new one, same made-up payment 3 hours ago, live consent:

| Case | Before | After |
|---|---|---|
| Staff pull queued 1 day before the payment, done 1 hour ago | red | green |
| Pull queued 1 day before the payment, still queued | red | green |
| Pull done 2 days before the payment, nothing since | red | red (correct) |
| No pull row at all | red | red (correct) |

The same cases are also in the real-SQL suite.

A pull staff cancelled after the payment counts as handled by a person. I followed the checker's rule on that.

### 3. Half of the approve click is still not watched (stays in "Not built")

The checker agrees the right call is to leave it. I checked the code again, so this is my own finding too.

- `api/soft-pull-approve.mjs` saves the consent, then the identity, then tries to make the $32 checkout. If the checkout fails, the error goes into the web reply (`checkout_error`) and nowhere else. No table gets a row.
- The consent is saved as `typed`. The consent page can also save `typed` (`api/consent/capture.mjs` takes the method from the caller). So an approve-link consent and a consent-page consent look the same.
- Real data today: 2 soft-pull consents, both test clients. That tells us nothing about how a real one looks.
- "Consent, identity on file, no pay link" would be red for every client who consented some other way. It would cry wolf. So I did not build it.

### Numbers

- `node --test src/pulse/coverage/gap-soft-pull.test.mjs`, no database: **61 tests, 61 pass, 0 fail**. The 50 real-SQL tests are in a suite that skips with no `DATABASE_URL`.
- Same file with `DATABASE_URL` set (run on this Mac, tables hidden behind made-up rows): **111 tests, 111 pass, 0 fail, 0 skipped**.
- The count before this round was 53. That is 8 new always-on tests (2 SQL shape tests, 4 for the pull answer rule, 1 close-time test, 1 read-only guard test) and 50 real-SQL tests.
- `node scripts/lint.mjs`: 3142 files parse clean.
- Live tool (`gap-live.mjs soft-pull`, read only, real database): prod mode 6 pass, 0 fail, 0 skip in 644 ms. Staff-database mode 6 pass, 0 fail, 0 skip in 817 ms. 0 SQL errors. 0 write attempts. Each read took 88 to 279 ms. All green because there is nothing to catch yet: no paid roadmap order, no paid diagnostic, and the one real pull is a test client's.
- Whole-bundle proof (`npm run pulse:prove`) was not run from this lane. `modules.test` and `run-slices.test` are red only for `gap-handoff`, `gap-keys`, `gap-leads` and `gap-outside-inngest`, which are other lanes' files that are not on the list yet.

### Left over, not fixed (owner hard lock)

- Both paid-order reads sort oldest first and stop at 200 rows. In a very busy window the newest buyers would be cut off. Nothing is near that today (0 paid orders).

