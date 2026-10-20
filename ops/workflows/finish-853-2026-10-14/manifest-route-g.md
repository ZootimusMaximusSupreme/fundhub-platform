# Workflow G — route proof gaps

Date: 2026-10-18 Arizona
Branch: `codex/heartbeat-route-proofs`

## Numbers

- `openBefore`: 9 route rows (`57` total NOT_PROVED rows)
- `openAfter`: 7 route rows (`55` total NOT_PROVED rows)
- Attached exact practice tests: 2
- Honestly not attachable without a product or map change: 7

## Outcomes

1. `catalog-route:routes-1.json:route:public/eeo-survey:POST submit the EEO self-ID answers (Postgres submit_eeo_response inserts and severs the link to the application in one transaction; same reply for first or duplicate)`
   - Outcome: `practice-test`
   - Exact handler test: `src/http/fin-b25-public-doors.test.mjs`
   - It calls `api/public/eeo-survey.mjs`, checks the one database function call, checks first and duplicate replies match, and checks bad values and unknown tokens stay red.

2. `catalog-route:routes-1.json:route:read/company-activity:GET Galaxy presence feed (who is on shift, calls, agent activity)`
   - Outcome: `practice-test`
   - Exact handler test: `src/http/fin-b25-read-doors.test.mjs`
   - It calls `api/read/company-activity.mjs`, checks shifts, calls, live agents, company scope, demo filtering, money totals, role gates, and the read-only query shape.

3. `catalog-route:routes-0.json:route:climate/geocode:Turn a typed address into a state / county for the lending-climate map (no lenders read, no record).`
   - Outcome: `not-attachable`
   - The real handler returns state, point and formatted address, but never county. The exact handler test proves that mismatch. The product must return county or the map claim must change.

4. `catalog-route:routes-0.json:route:inquiry:GET action=cases or status: open inquiry-removal cases for the Specialist desk, or one outbound call row.`
   - Outcome: `not-attachable`
   - The real handler lists all company cases, including completed and canceled, unless a status is supplied. The claim says open-only. The handler or map claim must change.

5. `catalog-route:routes-1.json:route:contracts/sign:POST action=decline {reason} (signer declines; recorded and the sender is told)`
   - Outcome: `not-attachable`
   - The decline, reason and time are saved. No message, event, task or notification tells the sender, even though the response says it did. The sender-notice path must be built before this claim can pass.

6. `catalog-route:routes-1.json:route:soft-pull-approve:POST action=stamp_incorporated (staff stamp a business incorporation date from Present or the control panel)`
   - Outcome: `not-attachable`
   - The handler calls `stampIncorporatedAsStaff`, which is not defined or imported, so this action returns an error and saves nothing.

7. `catalog-route:routes-2.json:route:inquiry-cases (clear_inquiry):POST /api/inquiry-cases action clear_inquiry — marks one inquiry cleared; when that clears its case it emits inquiry.removed on the event bus (which wakes C-03 and the funding path). Caller: ROLE_SETS.STAFF, org from the session.`
   - Outcome: `not-attachable`
   - The clear operation reads and updates the inquiry by id without company scope. A staff member from one company can clear another company's inquiry and emit an event stamped with mixed company data.

8. `catalog-route:routes-2.json:route:pii:GET/POST /api/pii — a client's identity data: GET masked identity (last four) or the access history; POST reveal (full SSN, reason required, access-logged) and store (ssn, dob, addresses encrypted). Caller: staff owner, admin, inquiry_specialist, funding_advisor only. The handler and src/pii/index.mjs read, reveal and list by client_id with no org check, and no row-level policy on pii_identity was found in db/.`
   - Outcome: `not-attachable`
   - Read, reveal and history use client id without company scope. The existing real-handler test proves role, encryption and access-log behavior, but company isolation is still broken.

9. `catalog-route:routes-3.json:route:marketing/costs:GET what each paid job kind cost last time and the month and batch caps. Every cost line on the Command Center reads this.`
   - Outcome: `not-attachable`
   - The real handler returns the month cap and per-run caps, not the batch cap. The batch cap lives on `marketing/settings`. The handler or map claim must change.

## Files changed

- `src/pulse/catalog/proofs/fin-b25-door-contracts.mjs`
- `src/pulse/catalog/proofs/fin-b25-door-contracts.test.mjs`
- `src/pulse/catalog/proofs/door-batch-route-result.test.mjs`
- `src/pulse/catalog/proofs/door-proof.test.mjs`
- `src/pulse/coverage/gap-door-batch-routes.mjs`
- `src/pulse/coverage/gap-door-batch-routes.test.mjs`
- `ops/workflows/finish-853-2026-10-14/manifest-route-g.md`

Shared route guard changes: the routes-1 red-monitor count moved from 5 to 3, the total monitored route rows moved from 10 to 8, and the NOT_PROVED route count moved from 9 to 7. One of the eight monitored rows is the existing retired-route skip, so it is not counted as NOT_PROVED.

`src/pulse/catalog/generated.json` was not touched, as ordered.

## Checks

- Before: `node scripts/pulse/count-not-proved.mjs /tmp/heartbeat-route-proofs-before.json` — 57 total, 9 routes.
- Baseline focused suite — 42 passed, 0 failed.
- After first attachment, the old route-count guards failed at the old values. They were updated to the measured counts, not removed.
- Final focused route suite — 47 passed, 0 failed.
- `node --test src/pulse/catalog/proofs/door-proof.test.mjs` — 989 passed, 0 failed.
- After: `node scripts/pulse/count-not-proved.mjs /tmp/heartbeat-route-proofs-after.json` — 55 total, 7 routes.
- `npm run lint` — 3963 files and inline scripts parsed cleanly.
- `git diff --check` — passed.

The two attached handler tests already include wrong-value, refusal and company-scope cases. No product file was temporarily changed because Workflow G owns route-proof files only.
