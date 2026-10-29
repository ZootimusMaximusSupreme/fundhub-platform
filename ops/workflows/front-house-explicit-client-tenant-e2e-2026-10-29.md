# Front-house explicit client ID tenant acceptance — October 29, 2026

**Separate front-of-house lane.** This note supplements `ops/workflows/front-house-screen-acceptance-matrix-2026-10-27.md`, which another open PR owns. Front-of-house finishes at the correctly identified paid buyer's verified handoff to the appropriate fulfillment team, not A/R settlement or funding execution.

## Source-reproduced integrity defect, not a known live incident

`src/handlers/client-lifecycle.mjs::resolveClient` accepted `event.clientId` without verifying `event.orgId` and immediately called `patchClientContact`, whose SQL updated `clients` by UUID alone. Any event carrying a real *other-organization* client UUID could therefore change that buyer's name/phone if the event reached this handler under a privileged connection. The returned foreign buyer ID could also drive `entry.captured`, survey, diagnostic, decision and payment-related handlers. RLS alone is not a substitute for explicit event-to-client ownership.

**Proposed isolated repair:** An explicit client UUID is accepted only if a read against `clients` proves the UUID belongs to the event's organization; missing org, missing client or foreign org return `null` before contact/CRM/stage/decision mutation. The normal same-organization booking overwrites stale contact fields as before. The identity check also runs with `skipCrmLink` in simulated credit tests; those tests do not call the real CRM.

## Action-level matrix

| Event/action and role | Expected source of truth | Reproduction / repair evidence | Verdict |
| --- | --- | --- | --- |
| Lead/booking explicitly carries a foreign tenant's client UUID | `clients.id` **and** `clients.org_id` must match the canonical event | Baseline code used `WHERE id = $1` without tenant validation before updating contact; dedicated fake unit and disposable PostgreSQL regression added | **FAIL BASELINE / FIX PROPOSED — NOT LIVE PROVED** until CI, merge, deployment and role readback |
| Explicit client ID with absent org ID | No client update, CRM link or sales stage | New guard returns `null` before any query or write | **NOT CI OR LIVE PROVED** |
| Explicit UUID missing from this org | No phantom customer accepted, no update | New guard checks actual tenant-scoped client row | **NOT CI OR LIVE PROVED** |
| Correct org/client booking with an updated form name/phone | Same client ID resolves; legitimate overwrite of stale contact still works | Disposable PostgreSQL fixture asserts old and new values under ROLLBACK | **NOT CI OR LIVE PROVED** |
| Guarded simulated credit decision for a valid existing buyer | Identity lookup is scoped; no external CRM/bureau call | Updated `client-lifecycle.test.mjs` exercises `skipCrmLink` | **NOT CI OR LIVE PROVED** |
| Full funnel, setter, closer, purchase and funding/repair/Blueprint entitlement to exact team | Same buyer/org, same settled provider receipt, exactly-once downstream task and correct staff role | This source guard is one prerequisite, not a full checkout-to-team proof | **NOT LIVE PROVED** |
| Owner and Justice host-specific Google Calendar booking/reschedule/cancellation | Each host's own event/organizer, guest, correct time/zone, Meet, invite delivery and matching closer Join | Google Calendar connector required interactive authorization in unattended run; no events or invites created | **NOT LIVE PROVED** |
| All 101 HTML candidates / 1,745 visible-control candidates across live roles | Per-control click/save/permission/mobile/error/notification evidence | Existing main acceptance inventory remains open and is not overwritten | **NOT LIVE PROVED** |

**Isolation:** The PostgreSQL regression runs only with `CI=true`, loopback `localhost/127.0.0.1`, and database `/fundhub_ci`. It uses a transaction that always rolls back, a synthetic plus-tag address and no network/provider sends. The unit fake similarly does not contact real services. This is NOT live Supabase write proof.

**Ship gates:** Require all 14 GitHub Actions jobs green, review accidental caller regressions, protected merge, combined-main CI and the matching successful `Ship to live` run. Even a successful production deployment does not establish read-only signed-in role-screen or external provider delivery. Do not send the owner's completion text until **every** front-house matrix action is evidenced PASS.


## October 29 — CI and main-reconciliation checkpoint

- The earlier head `8972727629e4` passed **all 14 mandatory** GitHub Actions jobs, including isolated real-PostgreSQL and browser, in [run 40897482988](https://github.com/ZootimusMaximusSupreme/fundhub-platform/actions/runs/40897482988). This is code/test evidence, **not production provider or customer acceptance**.
- The branch had diverged 28 main commits, including booking identity fixture updates in `clickfunnels-booking-moves.test.mjs` and `comms.test.mjs`; the reconciliation retains both sets of guards on the current main source. A **fresh, full 14-job CI run is required** on the reconciled head before merge. Never infer current-main verification from older green CI.
- The exact buyer's owner/Justice Google Calendar/Meet receipts and paid funding, repair and Blueprint fulfillment handoffs remain **NOT LIVE PROVED**. No production test writes or external provider sends were performed.
