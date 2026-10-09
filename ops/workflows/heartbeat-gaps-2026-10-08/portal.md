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
