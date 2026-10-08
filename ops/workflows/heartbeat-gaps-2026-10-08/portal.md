# Portal gaps — after they are a client

Lane 17. What the client sees once they are a client: the portal page, the file summary, the entitlement, and the next step.

Report only. This lane does not fix, does not sign in as a real client, and does not edit the portal page.

Slice 26 already lists which portal doors are in the morning watch list. These checks do not repeat that list.

## Checks

| id | What it looks at | FAIL means |
|---|---|---|
| portal:page | Signed-out GET of `/app/client-portal.html` | The page is a 404, or it is not the portal (no tiles). The plain up/down ping is also `reg:client-portal` |
| portal:summary | Read-only SQL. The four selects that turn `GET /api/read/portal-summary` into a 500 when they throw, plus the documents read, run for one real client | One of those reads throws (a dropped column, a missing table). The signed-out ping of that URL is `reg:read/portal-summary` |
| portal:paid-entitlement | Read-only SQL | A real client paid for a mapped product, more than 1 hour ago, and has no entitlement row |
| portal:next-step | Read-only SQL | A blueprint payment or a repair enrolment, more than 1 hour old, has no journey steps, so there is no next step |

Each row is `{ id, status, detail, suggestedFix }`. Status is `PASS`, `FAIL`, or `skip`.

## Rules

- One tripwire: Recon (AG-07) on the daily pulse. Do not invent a second watchdog. This lane does not read Recon. The daily pulse already has a `recon` check.
- Test clients are left out of the SQL: the demo flag, the synthetic flag, the `+walk-N` and `+sim-N` tags the sim seeder writes, and addresses on reserved test domains. A sample person is not a broken client. The PASS line says how many test clients had no entitlement.
- A payment younger than 1 hour is left alone. The webhook may still be on its way.
- A revoked entitlement still counts as a row. The fail is a payment with no row at all.
- Do not create a new catalog product to paper over a missing entitlement.
- Do not invent a new checklist. Use the one that already runs for a blueprint payment or a repair enrolment.
