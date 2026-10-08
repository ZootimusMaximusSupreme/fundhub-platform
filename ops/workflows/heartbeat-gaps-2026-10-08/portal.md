# Portal gaps — after they are a client

Lane 17. What the client sees once they are a client: the portal page, the file summary, the entitlement, and the next step.

Report only. This lane does not fix, does not sign in as a real client, and does not edit the portal page.

Slice 26 already lists which portal doors are in the morning watch list. These checks do not repeat that list.

## Checks

| id | What it looks at | FAIL means |
|---|---|---|
| portal:page | Signed-out GET of `/app/client-portal.html` | The page is a 404, or it is not the portal |
| portal:summary | Signed-out GET of `/api/read/portal-summary` | The summary crashes (500) or is missing (404). A 401 with no login is a pass |
| portal:paid-entitlement | Read-only SQL | A real client paid for a mapped product and has no entitlement row |
| portal:next-step | Read-only SQL | A blueprint payment or a repair enrolment has no journey steps, so there is no next step |
| portal:recon | Read-only SQL on AG-07 | Recon is missing or not live. This is the only tripwire |

Each row is `{ id, status, detail, suggestedFix }`. Status is `PASS`, `FAIL`, or `skip`.

## Rules

- One tripwire: Recon (AG-07) on the daily pulse. Do not invent a second watchdog.
- Demo clients are left out of the SQL. A sample person is not a broken client.
- A revoked entitlement still counts as a row. The fail is a payment with no row at all.
- Do not create a new catalog product to paper over a missing entitlement.
- Do not invent a new checklist. Use the one that already runs for a blueprint payment or a repair enrolment.
