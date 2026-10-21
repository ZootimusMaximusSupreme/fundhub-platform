# Waypoint seeding — ACTUAL

Generated from code on 2026-09-06, branch `fix/waypoint-seeding-repair`, base `origin/main` 8010b1b9.
Every box below was traced to a line that runs. Nothing here is drawn from the plan.

**Re-traced 2026-09-06 after an adversarial review returned FAIL.** Eight defects were found by
running the code, and this page is rewritten around what the code does now. The four that changed
behaviour a client can see: the checklist no longer promises anybody a loan, a card whose creditor
has been renamed is no longer reported as new credit, a re-pull now actually closes the list, and a
blocked row has a way back.

## In one paragraph, for a person

A client who signs up for the optimization program now gets a **checklist**. It is built the
moment they enrol. It lists the things **they** have to do — pay specific cards down to specific
numbers, do not open new credit, talk to their advisor about a personal loan, file the LLC, get an
EIN, open a business bank account. The dispute letters are not on it, because those are our job. Nothing on
the list has a price on it, because we do not sell any of those services today. The list is not
written into the code: it is rows in a table, so changing what clients are asked to do is a
change to the data and not a new release.

When a client's credit is pulled again, the platform closes the parts of the list it can actually
see. A card that reached its target is ticked off. A card that did not is left alone. A card that
is missing from the new report is left alone, because we do not know what happened to it. The
EIN, the bank account and the LLC are never ticked off by a credit pull, because nothing in this
system can see any of them.

**The list only says what a client has to DO.** No step tells them they qualify for anything, that
they will be approved, that a number will move, or by when. That rule is now enforced by a test:
if `qualify`, `approved`, `guaranteed`, `boost`, `points`, `score` or a dollar figure ever reaches
a task's words, the test suite fails.

**A card is not its name.** Credit bureaus rewrite creditor names all the time — the same card can
come back as "Credit One Bank" one month and "CREDIT ONE BANK N.A." the next. The platform now
recognises a card by the day it was opened plus the last four digits of its number, so a renamed
card is still the same card. When it genuinely cannot tell whether a card is new or just renamed,
IT DOES NOTHING: no message, no flag, nothing on the client's screen.

## What was true before this change

`client_waypoints` (migration 330) and `src/waypoints/store.mjs` had both existed since
2026-09-05. **Nothing outside a test had ever written a row.** Measured 2026-09-06 by grepping
every caller of `upsertWaypoint` on `origin/main` 8010b1b9: four files, three of them `*.test.mjs`
and the fourth `docs/workflows/wave-3-checks/seed-live-client.mjs`, a manual check script. Proved
by running it too — enrolling a client on a scratch database with all 255 migrations applied left
`client_waypoints` empty.

## Seeding

```mermaid
flowchart TD
    A["Client enrols<br/>src/repair/enroll.mjs enrollRepairProgram()"] --> B["repair_programs upsert<br/>entitlement granted<br/>repair.enrolled emitted"]
    B --> C["seedClientWaypoints()<br/>src/waypoints/seed.mjs<br/>best-effort: a failure is reported, never thrown"]

    C --> D{"waypoint_definitions<br/>WHERE active<br/>migration 361 + 362"}
    D -->|"no rows"| D0["seeds nothing and says so<br/>NO hardcoded fallback list exists"]
    D -->|"6 rows"| E{"freshest crs_results row<br/>is_demo IS NOT TRUE"}

    E -->|"none, or hasBlackReportSource false"| F["hasCreditFile = false<br/>no paydown waypoints<br/>no_new_credit baseline = NULL"]
    E -->|"a real file"| G["buildBlackReportClient()<br/>revolvingAccounts()<br/>mergeByCreditor()"]

    G --> G1["ONE ENTRY PER CARD.<br/>A tri-merge lists the same card once per bureau —<br/>8 rows for 3 cards on the repair profile.<br/>balance = highest any bureau reports<br/>limit = lowest any bureau reports<br/>target = 10% of that limit"]

    F --> H["expandDefinitions()<br/>src/waypoints/definitions.mjs"]
    G1 --> H

    H --> I{"per definition"}
    I -->|"expands = per_revolving_account"| J{"account payable?"}
    I -->|"expands = once"| K["one waypoint<br/>key = the definition key"]

    J -->|"no reported limit"| J1["skipped: no_reported_limit<br/>NO TARGET IS INVENTED"]
    J -->|"no reported balance"| J2["skipped: no_reported_balance"]
    J -->|"closed on every bureau"| J3["skipped: account_closed"]
    J -->|"balance already &lt;= target, and they already have the row"| J4["the row is refreshed with the new numbers<br/>and CLOSED — completeWaypoint()"]
    J -->|"balance already &lt;= target, and they do not have the row"| J4b["skipped: already_at_target<br/>no row is created just to finish it"]
    J -->|"yes"| J5["waypoint paydown_&lt;creditor&gt;<br/>params.target_cents, integer cents<br/>due = enrolment + 30 days"]

    J5 --> L["upsertWaypoint()<br/>ON CONFLICT (client_id, key) DO UPDATE<br/>state and completed_at are NOT touched"]
    K --> L
    L --> M["client_waypoints"]
```

### What gets seeded, today

| key | whose job | deadline | closable from data? | price |
|---|---|---|---|---|
| `paydown_<creditor>` (one per card) | client | enrolment + 30 days | yes — `paydown` | none |
| `no_new_credit` | client | none | one direction only — `no_new_credit` | none |
| `personal_loan` | client | enrolment + 14 days | no | none |
| `form_llc` | client | enrolment + 30 days | no | none |
| `get_ein` | client | none | no | none |
| `business_checking` | client | none | no | none |

**Not seeded, on purpose.** DUNS / Dun & Bradstreet, net-30 vendor accounts (Uline, Quill,
Grainger) and Paydex. Owner-set: "we dont do DUNS", Chris 2026-09-05, TODO.md item 0. The platform
also holds no vendor list, no Paydex field and no business-credit tracking, so those rows could
never be closed by anything. A test in `src/waypoints/seed.pg.test.mjs` fails if any of those
words reaches the catalog.

**Three deadlines are deliberately NULL.** The six-month sequence is recorded as not finalised,
and the roadmap itself puts "open a business checking account" in Month 1 in one place and Month 5
in another. A waypoint with no due date is never overdue, so leaving it NULL is the honest state.
Setting them later is one `UPDATE`.

**Every price is NULL.** The only priced self-serve product this platform has is a dispute round,
and a dispute round is not the client's job. The column and the whole path through the seeder are
built and tested; nothing on the client's list is for sale today.

## Second way in: paying for the Capital Blueprint (added 2026-09-17)

Owner rule, Chris 2026-09-17: "paying for the blueprint should create the client checklist."
Traced from code on `main` at 1a3f8c96 plus this change.

Before this, enrolling in repair was the ONLY thing that built a checklist. Measured on production
the same day: the one Capital Blueprint buyer (Sim Eleven-Blueprint) had paid $5,000 and had zero
waypoints, and all three clients anywhere with a checklist were repair clients.

```mermaid
flowchart TD
    P["a payment event<br/>payment.received / deposit.paid / diagnostic.paid / sale.closed"] --> R["money-chain resolves the product<br/>name, then alias, never the dollar amount"]
    R --> G["grantForPurchase()<br/>src/handlers/money-chain.mjs<br/>the one funnel every purchase path goes through"]
    G --> E["grantFromTransaction()<br/>entitlements granted FIRST"]
    E --> Q{"product code = consulting-package?<br/>(the Capital Blueprint, read from src/config/offers.mjs)"}
    Q -->|"no — DIY letter pack, diagnostic, repair, anything else"| N["no checklist.<br/>returns skipped: not_a_checklist_product"]
    Q -->|"yes"| S["seedChecklistForPurchase()<br/>src/waypoints/purchase.mjs<br/>-> seedClientWaypoints(), the SAME seeder enrolment uses"]
    S -->|"it fails"| F["caught and reported as checklist.ok = false,<br/>one warn line in the log.<br/>The payment, sale, commission and entitlement all stand."]
    S -->|"it works"| W["client_waypoints<br/>(the Seeding diagram above, unchanged)"]
```

* **Thin credit file.** The seeder reads the client's latest real credit pull itself. A Blueprint
  buyer nobody has pulled yet gets the five steps that need no file and no card steps at all
  (no card, no limit, no paydown number is ever made up). Proved on a scratch database.
* **Paying twice, or the event replaying**, lands on the same rows — the seeder's upsert, unchanged.
* **The $1,000 DIY letter pack does not create one.** It shared a product code with the Blueprint
  until migration 384 split them; a test proves the split holds for the checklist too.

### People who already paid

The checklist is written once, when the payment is processed, so shipping this gives nothing to
anyone who paid earlier. `backfillPurchaseChecklists()` in `src/waypoints/purchase.mjs` walks every
succeeded transaction, resolves its product the same way the entitlement reconcile does, and seeds
a checklist for each Blueprint buyer. It is kept separate from `reconcileFromTransactions()` on
purpose — that one only writes entitlement grants, and an operator fixing one should not rewrite
the other by surprise.

Run it with `node scripts/backfill-blueprint-checklists.mjs` (a dry run that writes nothing), then
`--write`. It only adds or refreshes steps and never re-opens a finished one, so a second run
changes nothing. **UNVERIFIED on production: it has not been run there.**

## Idempotency

```mermaid
flowchart LR
    S1["seed run 1"] --> R["client_waypoints"]
    S2["seed run 2<br/>(the double dispatch enroll.mjs already performs,<br/>or a re-run months later)"] --> R
    R --> U1["UNIQUE (client_id, key)<br/>+ ON CONFLICT DO UPDATE<br/>= same key, one row"]
    R --> U2["DO UPDATE leaves state and completed_at alone<br/>= a finished task is never re-opened"]
    R --> U3["a paydown is matched to its card by PRINT first<br/>(opened date + last four digits), then by creditor name<br/>= a bureau renaming the creditor does not<br/>open a second waypoint for the same card"]
    R --> U4["an existing due_at is kept<br/>= a re-seed never pushes a client's deadline forward"]
    R --> U5["the no_new_credit baseline is WRITE-ONCE<br/>= a re-seed cannot fold the account that caused<br/>a block into the list of accounts that were<br/>always there"]
```

## Closing it from the data

```mermaid
flowchart TD
    A["evaluateWaypoints()<br/>src/waypoints/verify.mjs"] --> B["listVerifiableWaypoints()<br/>verify_kind IS NOT NULL<br/>AND state NOT IN (done, skipped)"]
    B --> C{"a usable credit file?"}
    C -->|"no"| C0["EVERY row unchanged, reason no_credit_file.<br/>Nothing is closed. Nothing is blocked."]
    C -->|"yes"| D{"verify_kind"}

    D -->|"paydown"| E{"is the card on the new file?"}
    E -->|"no"| E0["OPEN — account_not_on_file.<br/>Unknown is not paid off."]
    E -->|"yes, balance not reported"| E1["OPEN — balance_unknown"]
    E -->|"balance &gt; target"| E2["OPEN — above_target"]
    E -->|"balance &lt;= target"| E3["completeWaypoint()<br/>state = done, completed_at set together"]

    D -->|"no_new_credit"| F{"classifyAgainstBaseline()"}
    F -->|"NULL baseline — no file existed at enrolment"| F0["OPEN — no_baseline.<br/>Nothing may be concluded."]
    F -->|"the new file reports no cards at all"| F1["OPEN — no_accounts_reported.<br/>A thin pull is not a client closing every card."]
    F -->|"a card matches nothing by name,<br/>but its PRINT matches one we knew about"| F4["the same card, renamed.<br/>NOTHING HAPPENS."]
    F -->|"a card matches nothing, and it has no print —<br/>or the enrolment file had a card we could not identify"| F5["UNKNOWN. Nothing happens, and the run<br/>records which fact was missing.<br/>Unknown is never an accusation."]
    F -->|"a card with its own print that the baseline<br/>positively did not have"| F2["markWaypointState blocked<br/>state_reason: 'Your credit file now shows an<br/>account that was not on it when you enrolled: X.<br/>Let our team know if this is not yours.'<br/>completed_at stays NULL"]
    F -->|"no new cards, and the row is BLOCKED"| F6["back to not_started, state_reason cleared.<br/>The evidence has gone, so the flag goes."]
    F -->|"no new cards"| F3["OPEN — no_new_accounts_seen.<br/>NEVER completed: keeping a rule is not provable."]

    D -->|"NULL"| G["not looked at.<br/>get_ein, business_checking, form_llc, personal_loan.<br/>Nothing in this repository observes any of them."]
    D -->|"anything unrecognised"| H["OPEN — matches no branch.<br/>A typo in the catalog leaves a row open, which is the safe direction."]
```

## What fires the closing pass

```mermaid
flowchart LR
    P["a credit pull comes back"] --> E["analysis.completed"]
    E --> H["onAnalysisCompleted()<br/>src/handlers/client-lifecycle.mjs<br/>registered on the event bus"]
    H --> S["the crs_results row is stored<br/>(the line that makes 'we pulled' true)"]
    S --> W["reviewChecklistAfterPull()<br/>-> evaluateWaypoints()"]
    W --> X["never throws.<br/>The pull is already stored, and a checklist<br/>that could not be re-read must not lose it."]
```

`evaluateWaypoints()` had **no production caller at all** until this change — a grep across the
branch found it in test files and nowhere else, so a client who paid a card down was told to pay it
down forever. It now hangs off `analysis.completed`, which is the event a finished credit pull
raises and the same event the `crs_results` INSERT already reacts to. It is best-effort in exactly
the way seeding is best-effort at enrolment: the pull is committed before it runs, so nothing
inside it can undo or block the pull. It is outside every transaction in `src/finance/soft-pulls.mjs`
for the same reason.

`src/waypoints/seed.pg.test.mjs` drives the real handler — not a stub — with a real
`crs_results` row: pay a card down, fire the event, the card's row moves to `done` and nothing else
on the list moves. Firing the same event again changes nothing.

## UNVERIFIED / not wired

* **No screen reads the checklist as a tick-box list.** `api/read/client-progress.mjs` already
  returns the rows via `listWaypoints` (`src/progress/read.mjs:187`), so the data reaches the
  browser; nothing lets a client tick one off. Deliberately out of scope for this lane.
* **No nudge, no message.** Nothing here queues or sends anything.

## Files

| file | what it does |
|---|---|
| `db/migrations/360_waypoint_verification.sql` | `verify_kind` and `params` on `client_waypoints` |
| `db/migrations/361_waypoint_definitions.sql` | the catalog table |
| `db/migrations/362_waypoint_definitions_seed.sql` | the six tasks |
| `db/migrations/363_waypoint_definitions_copy_and_grants.sql` | the corrected wording, and the policy/grant fix, for any database that already applied 361 and 362 |
| `src/waypoints/definitions.mjs` | catalog → one client's waypoints, pure |
| `src/waypoints/seed.mjs` | the write, idempotent |
| `src/waypoints/verify.mjs` | closing from a re-pull |
| `src/waypoints/store.mjs` | `verify_kind`/`params` on the upsert, `listVerifiableWaypoints`, `markWaypointState` |
| `src/repair/enroll.mjs` | calls the seeder beside the `repair.enrolled` emit |
| `src/waypoints/purchase.mjs` | which product creates a checklist, the best-effort wrapper, and the backfill for people who already paid |
| `src/handlers/money-chain.mjs` | `grantForPurchase()` calls the wrapper right after the entitlement grant |
| `scripts/backfill-blueprint-checklists.mjs` | operator run of the backfill; dry run unless `--write` |
| `src/handlers/client-lifecycle.mjs` | `reviewChecklistAfterPull()` — the credit pull that closes the list |

## Who may change the checklist

The point of holding the list in a table is that Chris can change what clients are asked to do with
one `UPDATE` instead of a release. That promise was broken on the first attempt and is fixed here.

Migration 361 puts `FORCE ROW LEVEL SECURITY` on `waypoint_definitions`, and FORCE applies the
table's own policies **to the table's owner as well**. With the SELECT-only policy 361 originally
carried, every write to the table failed for any database role that is not a superuser:

| as a plain (non-superuser) role, under the old shape | result |
|---|---|
| `INSERT` | `ERROR: new row violates row-level security policy` |
| `UPDATE` | `UPDATE 0` — **and no error at all** |
| `DELETE` | `DELETE 0` — **and no error at all** |

Two things were wrong with that. Migration 362 inserts the six rows **as the migration role**, so on
a production database whose migration role is not a superuser the deploy itself would have failed.
And an `UPDATE` that reports success while changing nothing is the worst possible way for the
"edit it with SQL" promise to break.

So the policy now permits (the same `USING (true) WITH CHECK (true)` shape migration 330 already
runs in production), and the application's read-only-ness is a **grant**:

* `fundhub_app` holds `SELECT` on `waypoint_definitions` and nothing else, verified by reading
  `information_schema.role_table_grants` in a test rather than by asserting it in prose.
* That took an explicit `REVOKE`. `104_app_role.sql` runs `ALTER DEFAULT PRIVILEGES … GRANT SELECT,
  INSERT, UPDATE, DELETE`, so the app was handed all four rights the moment the table was created.
  The earlier claim that it "holds SELECT and nothing else" was **not true**: writes were stopped by
  row-level security, not by the grant.
* An attempted write by the application now raises `permission denied for table
  waypoint_definitions`. A refusal that raises is a refusal somebody notices.
