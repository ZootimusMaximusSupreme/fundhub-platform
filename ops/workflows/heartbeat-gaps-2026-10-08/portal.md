# Portal gaps — after they are a client

Lane 17. What the client sees once they are a client: the portal page, the file summary, the entitlement, and the next step.

Report only. This lane does not fix, does not sign in as a real client, and does not edit the portal page.

Slice 26 already lists which portal doors are in the morning watch list. These checks do not repeat that list.

## Checks

| id | What it looks at | FAIL means |
|---|---|---|
| portal:page | Signed-out GET of `/app/client-portal.html` | The page is a 404, or it is not the portal (no tiles). The plain up/down ping is also `reg:client-portal` |
| portal:summary | Read-only SQL. The four selects that turn `GET /api/read/portal-summary` into a 500 when they throw, plus the documents read, run for one real client | One of those reads throws (a dropped column, a missing table). The signed-out ping of that URL is `reg:read/portal-summary` |
| portal:paid-entitlement | Read-only SQL, two reads | (1) A real client paid for a mapped product, more than 1 hour ago, and has no entitlement row. (2) A real client paid under a product name that matches no product or alias, came through the payment door, and holds no entitlement of any kind |
| portal:next-step | Read-only SQL | A blueprint payment or a repair enrolment, more than 1 hour old, has no journey steps, so there is no next step |

Each row is `{ id, status, detail, suggestedFix }`. Status is `PASS`, `FAIL`, or `skip`.

## Rules

- One tripwire: Recon (AG-07) on the daily pulse. Do not invent a second watchdog. This lane does not read Recon. The daily pulse already has a `recon` check.
- Test clients are left out of the SQL: the demo flag, the synthetic flag, the `+walk-N` and `+sim-N` tags the sim seeder writes, and addresses on reserved test domains (`.test`, `.example`, `.invalid`, `.localhost`, `.local`, and `@example.com/net/org`). A sample person is not a broken client. The PASS line says how many test clients had no entitlement.
- A payment younger than 1 hour is left alone. The webhook may still be on its way.
- A revoked entitlement still counts as a row. The fail is a payment with no row at all.
- Do not create a new catalog product to paper over a missing entitlement.
- A product name that matches nothing is not a break by itself. The one real purchase on file ("Consulting Services Standard") has an old name and its client still holds an entitlement from another path. So read (2) only fails a client who holds nothing at all.
- Read (2) only counts a payment that left a `payment.received` event for its client within a day of it. That is the mark of a payment that came in through the Commas door. A row dropped straight into `transactions` leaves none, and is named in the PASS line instead of failed.
- Do not invent a new checklist. Use the one that already runs for a blueprint payment or a repair enrolment.

## Review — Claude, 2026-10-08

What was wrong:
- The live FAIL "7 paid clients have no entitlement" was a false alarm. All 7 are Chris's own walk and sim clients (`+walk-01` to `+walk-04`, `+sim-09`, `+sim-10`, `+sim-12`). They were made in one batch at 07:07 UTC on 10-07. Nobody flagged them as test clients. The 3 real purchases all have their entitlement.
- `portal:recon` was a copy of the daily pulse `recon` check. Removed.
- `portal:summary` was a copy of `reg:read/portal-summary`. A signed-out 401 never reaches the SQL, so it could not see a real 500.
- The page fetch had no timeout. One hang could hold up the whole pulse.

What changed:
- `portal:paid-entitlement` and `portal:next-step` leave test clients out and leave payments under 1 hour old alone. Demo payments are out too. The PASS line says how many test clients had none (7 today).
- `portal:summary` now runs the 4 selects that make the summary 500 when they throw, plus the documents read, for one real client. The 4 selects are copied word for word, and a test fails if `api/read/portal-summary.mjs` changes one.
- `portal:page` keeps its tiles check. It has a 15 second timeout and also accepts `ctx.fetch`.

Proof:
- Both SQL statements were run on the live database in a read-only transaction with made-up rows. A real client with no entitlement shows up. Test, flagged, demo, too-new and failed payments do not.
- Tests: 10 before, 24 after, 0 fail. 16 deliberate breaks of the code: 15 caught. The one left is the 404 branch: removing it still fails with "answered 404", so it is not a real gap.
- Live, prod mode: 4 PASS, 0 FAIL, 0 skip.

Leftover (not touched): the 7 walk and sim clients are not flagged `synthetic`. `scripts/sim/flag-sim-clients.mjs` was never run on them.

### Second pass — Claude, 2026-10-08 (later)

What was wrong:
- `portal:paid-entitlement` could not see a payment whose product name matches no product. The join drops it, so a renamed or brand-new product name would say PASS. Today 8 of 40 paid payments are in that state.
- The test client pattern missed the demo roster (`@demo.fundhub.local`). One of those would raise a false FAIL if it ever lacked an entitlement.
- The PASS line said "real purchases" but counted rows, not purchases.
- A grace of `0 hour` left every test green.

What changed:
- New second read inside `portal:paid-entitlement` (`UNRESOLVED_PAID_SQL`). It fails a real client who paid under an unknown product name, came through the payment door, and holds no entitlement at all.
- I checked the 8 live cases with read-only SQL before choosing the rule. 4 are demo clients. 1 is a test product on an example.com address. The one real purchase on file (09-17, "Consulting Services Standard", $1000) has an old product name, but its client holds an entitlement and 5 steps. So "unknown name" alone would be a false alarm. The last case is a $32 "soft-pull assessment" row from the 10-07 test batch: no payment event, no pay link, 55 seconds from the sim payments. It is a pasted row, not a buyer. It is counted in the PASS line, not failed.
- `.local` added to the test domains.
- The PASS line says "paid rows read, plus N under a product name that matches no product", plus how many test clients and how many payment-event-less rows were left out.
- Tests pin `GRACE` as `"1 hour"` and pin the entitlement join text.

Overlap, kept on purpose: `payments:paid-no-entitlement` in `gap-payments.mjs` reads the same join (keyed on the transaction id, and it leaves out simulated receipts by provider ref). This row leaves out test clients by address and flag, and adds the unknown-name read. A real unentitled payment can show two red rows. They are one break. `payments.md` is not this lane's file, so it was not touched.

Not done (leftover): `portal:next-step` only sees an empty checklist. A client whose first step is done and whose next step never unlocked is not seen. `client_waypoints.state` is not read. That is partial cover of "a step that should unlock and did not". No false alarm comes from it.

Proof, second pass:
- Both SQL statements ran on the live database engine, read-only, with made-up rows: unknown name and nothing held FAIL; the same with an entitlement PASS; no payment event PASS and counted; +sim, demo, synthetic and demo roster clients PASS; paid 10 minutes ago PASS; failed and demo payments PASS; payment event 3 days away PASS; 20 hours away FAIL; a known name with no entitlement FAIL; odd-case status still counted. 14 of 14 as designed.
- Tests: 31 pass, 0 fail, 0 skipped (24 before).
- 19 deliberate breaks of this file: 18 caught. The one left is the 404 branch. Removing it still fails with "answered 404", so it is not a real gap.
- Live, prod mode: 4 PASS, 0 FAIL, 0 skip. Same in the staff view and the bare view. 0 SQL errors, 0 writes.

## Tier 1 — Claude, 2026-10-09

Three new checks. The lane now has 7 rows. All three are read only: GET for the web, SELECT for the database.

### What each one asks

| id | The question | Red when |
|---|---|---|
| portal:page-scripts-load | Do the customer pages have all their scripts? | One of the six customer pages answers anything but 200, is empty or cut short, or has lost its form or tiles. Or a script or style file the page names answers 404, comes back empty, or comes back as a web page. The check reads each page's own list, so it follows the page when a file is added. |
| portal:progress-read-real-client | Does the progress page show real numbers for a real client? | The real progress read, run for the newest paying client, throws. Or any read under it fails (the page code hides these and shows an empty section). Or the answer is the wrong shape. Or it disagrees with the client's own rows: steps, documents, or repair stage. |
| portal:paid-client-never-signed-in | Did a paying client get access and never sign in? | A paying client has held access for over 72 hours and has never signed in. "Never signed in" means no login on a client account and no sign-in link ever used. |

### What I changed from the plan, and why

1. **The progress page is `/progress.html`.** The plan said `/app/progress.html`. That file does not exist. The pulse registry has it at `/progress.html`, and a test now checks all six paths against the registry and `public/`.
2. **The progress check is not "no stage, no scores, no date".** I ran the real read for the one real paying client first. It has a stage (`analysis`), three score panels with no score yet (no pull has been made), and no expected date (that date only exists once the letters are out). The planned red would have been a false alarm every morning. The real danger is different: the page code catches every failed read and shows an empty section, so a dropped column gives a client an empty page and no error. So the check counts every read that failed underneath, and holds the answer against the client's own rows.
3. **It runs `readClientProgress`, not the handler.** The handler needs a signed-in client and opens its own database pool. `readClientProgress` is the function the handler calls for the data. It writes nothing: I read every function it calls. As a second wall, the check hands it a guard that refuses anything that is not one plain SELECT. If someone later makes the read write, the guard refuses it and the row goes red.
4. **The sign-in check includes clients with no account row.** The plan said "has an accounts row". The first sign-in link creates the account (`provisionClientAccount`), so a paying client with no account row has not signed in either. The 72 hours start when access was first given, not when they paid.
5. **"Paying" means a succeeded payment that came through the payment door** (a `payment.received` event within a day), same mark `portal:paid-entitlement` uses. A wider test-address list is used for these two checks only (`test+...@fundhub.ai`, `e2e+...`, `+test.`, any `@fundhub.ai`). The old checks keep the old list, so their results do not move.

### Live result (real database, real pages, 2026-10-09)

- **Run from the repo:** 6 PASS, 1 FAIL, 0 skip. Same in all three views (app role, staff role, bare). 0 SQL errors, 0 writes, 0 non-GET calls. About 3.3 seconds for the whole lane.
- **Run from inside the built bundle** (`npm run pulse:prove -- --lanes=gap-portal`): OK. Step `coverage-gap-portal` took 3.1 s. The three new checks ran from the bundle with the same results.
- `portal:page-scripts-load` PASS: 6 pages, 36 script and style files, all answered with content.
- `portal:progress-read-real-client` PASS: real read ran for the newest paying client, no read failed, stage `analysis`, 5 checklist steps, counts match.
- `portal:paid-client-never-signed-in` **FAIL (real)**: 1 paying client has held access for 3 days and has never signed in. This client paid $1,000 on 09-17, sent documents on 09-22, and got the repair welcome email with the sign-in link on 10-05. The account is still "invited". They did type their email into the sign-in page once, on 09-27, and were refused (the email was not on file yet; it was fixed that night). That was 8 days before access was given. They have not asked for a link since access was given on 10-05. That is a real customer to call, not a code break. (Corrected in the fix round below: this line used to say no link was ever asked for. That was wrong.) Tomorrow's run will say the same thing: I ran the check on today's data with a 1-hour window (so the 10-07 test batch is old enough to count). It saw 25 clients with access: 23 test clients, 1 with no payment event, and this one client. Only this client is waiting.

### Proof that each one can go red (read only)

- **Sign-in query, made-up rows:** run on the real database engine with fake tables laid over the real ones, inside a read-only transaction. 14 made-up clients, 14 of 14 behaved: a waiting real client, a login, a used link, a +sim tag, no payment event, access only 1 day old, a revoked grant, a stored pack only, no account at all, a failed payment, only an authorized rep signed in, a synthetic flag, a demo client, a fundhub.ai test address. The picker query took the newest real paying client and skipped the test, demo, no-event and failed ones.
- **Progress read, real client, broken on purpose:** wrapped the live read so one query fails. A step read that throws: FAIL. A step read that quietly comes back empty (5 steps on file, 0 on the page): FAIL. A lost repair stage: FAIL. A write attempt: refused and FAIL. Untouched: PASS.
- **Live pages, broken on purpose (GET only):** a script 404, an empty script, a style file that comes back as a web page, a page 500, a page cut short: each one FAIL and names the file. Untouched: PASS.

### Tests

- `node --test src/pulse/coverage/gap-portal.test.mjs`: **78 tests, 78 pass, 0 fail, 0 skipped.** (31 before: 31 still pass. 47 new.)
- **43 deliberate breaks of the code, 43 caught.** (The first run caught 42; one test lacked an assertion on the fragment of a file address, so I added it and the 43rd was caught.)
- Existing tests I had to change, and how. None deleted, skipped or weakened in what they prove:
  - The row count is now 7 and the id list has the three new ids.
  - "One page fetch" now says: the portal page is fetched once for the whole run, and the summary is never pinged. The run shares one answer per address, so that is still true.
  - "Does not log in" used to reject any address with `login` in it. The customer sign-in page is now read as a static file, so it rejects any `/api/` call or `magic-link` instead. Nothing here calls the auth API.
  - The source scan for the word "password" now lets through exactly two things: the reset page's own path and the box the page must still have.
  - The fake database now answers an unknown query that carries no `gap:` tag with no rows (those are the real progress read's own queries). An unknown tagged query still throws, as before.

### Not covered, said plainly

- The score part of the progress page is not held against an independent read. If a client has a pull on file and the page shows no scores, the check cannot tell a bad pull from a lost one. The step, document and stage counts are held.
- Only the newest paying client is read. A client of another kind (a roadmap buyer, say) is not read until they are the newest.
- Text on the pages is not pinned, except the form on the two sign-in pages and the tiles on the portal. A copy change is not a false alarm.

### Leftover card (not looked at, per the hard lock)

- 13 sign-in link requests since 08-12 ended `no_account` (no client with that email). The newest was 10-07 21:11. Not checked.

### Fix round for the checker's two notes, Claude, 2026-10-09

**Note 1 (medium): the SQL had no test of its own.** The tests used a fake database with canned rows. A checker broke six lines of `NEVER_SIGNED_IN_SQL` and all 78 tests stayed green. Fixed.

- New file `src/pulse/coverage/gap-portal.pg.test.mjs`. It runs the three real statements (`NEVER_SIGNED_IN_SQL`, `PROGRESS_CLIENT_SQL`, `PROGRESS_ROWS_SQL`) on a real Postgres over made-up people. Same method as `gap-handoff.pg.test.mjs`.
- It is harmless. Each query runs inside `BEGIN READ ONLY` and is rolled back. Every real table the query names is covered by a copy that holds only the made-up rows, so no real row is read. The real table is only read with `WHERE false`, to take its column types, so a dropped column still breaks the test. A write is refused by the database (one test proves that).
- It skips when `DATABASE_URL` is not set, like every other `.pg.test.mjs`. It runs in CI.
- 110 scenarios, each one a named person: who is listed and the clock (71h vs 73h, first grant starts the clock, revoked, expired, demo, stored pack, other company), who has signed in (login OR used link, not AND), who asked for a link, test clients (flags, 7 test addresses, 4 buyer addresses), who paid through the door (20 hours vs 3 days, odd-case status, demo, failed), which client the progress page reads (newest, not oldest; 11 kinds skipped), and the step, document and stage counts.
- I broke the three statements in 50 ways, each time in a copy outside the repo: the checker's 6, 43 of my own, and the old file from before this fix. **50 of 50 caught.** (6 of 6 of the checker's.)

**Note 2 (medium): the FAIL text said "1 never asked for a sign-in link". That was false.** The checker was right. I confirmed it on the live data with read-only SQL: request `6d7731f7`, outcome `no_account`, 2026-09-27 00:06. It has no client id and no account id (a refused request is stored that way), so matching on client id could not see it. Its email is the client's email.

- The question is now: did the client ask for a link **since access was given**? A request is theirs if it is tied to the client, **or** if the email typed is the client's own email (lowercased, trimmed). A request made before access was given does not count, because it could not have worked.
- Column renamed `asked_for_link` to `asked_since_access`. The FAIL text now reads `(longest wait 3 days; 0 of 1 asked for a sign-in link since access was given)`. It no longer says "never asked".
- Live, read-only: the fixed query still lists the one waiting client (3.7 days, not signed in) and says asked = false. With the since-access filter taken off, the same real data says asked = true, which proves the 09-27 refusal really matches by email. A made-up request by email yesterday: true. A made-up request tied to the client id yesterday: true.
- The check stays RED today. The red is correct. The wording is now true.

Numbers after this round (all seen on this laptop, today):
- `node --test src/pulse/coverage/gap-portal.test.mjs`: 79 tests, 79 pass, 0 fail, 0 skipped (78 before, plus 1).
- `node --test src/pulse/coverage/gap-portal.pg.test.mjs` on the live database engine (read-only, all tables covered by made-up rows): 110 tests, 110 pass, 0 fail, 0 skipped.
- Live tool (`gap-live.mjs portal`): 6 PASS, 1 FAIL, 0 skip in the app role, staff and bare views. 0 SQL errors, 0 writes.
- From inside the built bundle (`npm run pulse:prove -- --lanes=gap-portal`): OK. Step `coverage-gap-portal` 3.2 s. The new wording shows in the bundle's red row.

Unit tests I changed (none deleted, skipped or weakened): the two FAIL-text tests now expect the new wording (`0 of 1` and `1 of 2 asked ... since access was given`) and one adds a check that the word "never asked" is gone; the fake rows use `asked_since_access`; the SQL-text test pins the two new lines. One new test: a row with no answer reads as not asked.

Not mine, same as before: the 13 `no_account` sign-in requests since 08-12 are still the leftover card above.
