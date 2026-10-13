# Workflow receipt reds — read-only evidence, 2026-10-13

Scope: acceptance item 3 only. No event was sent. No live row was written, changed, or deleted.

## Result

The October 13 scorecard has exactly **42 red `wf:` rows**. All 42 are
`workflow-did-not-run`. None has evidence that the workflow ran while only the
receipt writer failed.

The rows came from four real-Postgres test files being run against the shared
database. Their saved event rows have the tests' own stable markers. No matching
`workflow_runs.bus_event_id` exists for those rows.

The receipt writer itself is not the cause:

- `fundhub_app` still has both `INSERT` and `UPDATE` on `workflow_runs`.
- The table has 31 non-marker rows for 16 workflows. Earlier start marks were
  saved, and a later finish mark was saved on October 13.
- The same shared middleware writes both the start and finish marks.

## Database-verifiable source rows

| Saved event | Event rows with no receipt | Test source proved by its marker |
| --- | ---: | --- |
| `entry.captured` | 1 | `src/handlers/comms.pg.test.mjs` (`cpg:`) |
| `booking.created` | 1 | `src/handlers/comms.pg.test.mjs` (`cpg:`) |
| `call.completed` | 1 | `src/handlers/comms.pg.test.mjs` (`cpg:`) |
| `message.inbound` | 1 | `src/handlers/comms.pg.test.mjs` (`cpg:`) |
| `mail.response` | 1 | `src/handlers/comms.pg.test.mjs` (`cpg:`) |
| `deposit.paid` | 3 | `src/handlers/purchase-routing.pg.test.mjs` (`purchaserouting_pg:`) |
| `round.started` | 16 | approval guard test 11; card-stacking test 3; purchase-routing test 2 |
| `round.submitted` | 14 | approval guard test 11; card-stacking test 3 |
| `round.approved` | 14 | approval guard test 11; card-stacking test 3 |
| `round.funded` | 9 | approval guard test 6; card-stacking test 3 |
| `round.closeout` | 8 | approval guard test 5; card-stacking test 3 |

The round-event sources are proved by the linked test-client email prefixes,
without recording any address here:

- `appguard_` -> `src/funding/approval-amount-guard.pg.test.mjs`
- `cs_round_` -> `src/funding/card-stacking-rounds.pg.test.mjs`
- `purchaserouting_pg` -> `src/handlers/purchase-routing.pg.test.mjs`

## Cause for every red row

Every name below has the same cause: the named test event exists in `events`,
but there is no `workflow_runs` row for that exact event id. The workflow did
not run from that test event. The receipt writer did not lose a receipt for a
run that happened.

| Event | Red workflow rows |
| --- | --- |
| `entry.captured` | `wf:af-02-referral-ownership-capture`; `wf:at-01-first-touch-capture`; `wf:s-00-welcome`; `wf:s-01-new-lead-intake`; `wf:s-02-incomplete-survey-nudge` |
| `booking.created` | `wf:ai-set-01-josh-setter`; `wf:ai-set-04-3way-handoff`; `wf:bs-01-precall-launcher`; `wf:dpc-02-call-outcome-enforcement`; `wf:dpc-05-no-progress-escalation`; `wf:s-04-call-booked`; `wf:s-04b-booking-reminders`; `wf:s-04c-staff-booked-alert`; `wf:s-portal-invite` |
| `call.completed` | `wf:ai-set-03-no-answer-cadence`; `wf:ds-01-repair-referral`; `wf:s-08-post-call-funding-declined`; `wf:s-offer-bucket` |
| `round.started` | `wf:bc-01-customer-responsiveness`; `wf:bc-02-customer-friction`; `wf:c-05-pre-funding-review`; `wf:f-01-funding-intake`; `wf:f-02-portal-id-missing`; `wf:f-10-client-funding-inbox-provisioner`; `wf:round-started-client-notify` |
| `deposit.paid` | `wf:c-02b-inquiry-removal-requested`; `wf:s-06-post-call-funding-purchased`; `wf:s-doc-collection` |
| `message.inbound` | `wf:dpc-03-inbound-reply-router`; `wf:slo-genuine-reply` |
| `round.submitted` | `wf:f-03-round-submitted` |
| `round.approved` | `wf:f-04-round-approvals`; `wf:f-05-inquiry-cleanup-gate`; `wf:sys-01-client-value-calculator` |
| `mail.response` | `wf:f-06-funding-conditions-missing-docs`; `wf:f-09-funding-declined-no-path`; `wf:f-11-bank-email-event-router` |
| `round.funded` | `wf:f-07-funding-locked`; `wf:f-08-post-funding-monitoring`; `wf:n-06-renewal-second-wave`; `wf:sys-01-ltv-calculator` |
| `round.closeout` | `wf:n-04-post-funding-nurture` |

Count check: `5 + 9 + 4 + 7 + 3 + 2 + 1 + 3 + 3 + 4 + 1 = 42`.

## How Claude can re-check it

Run these statements through a connection that has already issued
`BEGIN READ ONLY`; finish with `ROLLBACK`.

```sql
SELECT current_setting('transaction_read_only') AS must_be_on;

WITH latest AS (
  SELECT checks
    FROM pulse_scorecards
   ORDER BY ran_at DESC
   LIMIT 1
)
SELECT item->>'id' AS id, item->>'status' AS status, item->>'proof' AS proof
  FROM latest, LATERAL jsonb_array_elements(checks) AS item
 WHERE item->>'id' LIKE 'wf:%'
   AND item->>'status' = 'red'
 ORDER BY id;

SELECT current_user,
       has_table_privilege(current_user, 'public.workflow_runs', 'INSERT') AS can_insert,
       has_table_privilege(current_user, 'public.workflow_runs', 'UPDATE') AS can_update;
```

For one-to-one event proof, join each saved event to its receipt by the same key
the pulse uses:

```sql
SELECT e.name, e.created_at, e.idempotency_key,
       count(w.*)::int AS receipt_rows
  FROM events e
  LEFT JOIN workflow_runs w ON w.bus_event_id = e.id::text
 WHERE e.idempotency_key LIKE 'cpg:%'
    OR e.idempotency_key LIKE 'purchaserouting_pg:%'
 GROUP BY e.id, e.name, e.created_at, e.idempotency_key
 ORDER BY e.created_at;
```

For round events, join `events.client_id` to `clients.id` and group on these test
prefix checks: `lower(email) LIKE 'appguard_%'`, `lower(email) LIKE 'cs_round_%'`,
and `lower(email) LIKE 'purchaserouting_pg%'`. Then left-join
`workflow_runs.bus_event_id = events.id::text`. The counts must match the table
above and every receipt count must be zero.

## Receipt logic test

`src/pulse/workflow-runs.test.mjs` already has the required mutation guard:

- `c: an event came, over 15 minutes ago, after receipts began, and no run carries it: FAIL...`
- `today's bundle with a missed round.started event: exactly the round.started workflows turn FAIL`
- `f: a run is judged PASS only with a run behind it...`

Making the receipt check always return PASS makes these tests fail. No duplicate
test was added.

