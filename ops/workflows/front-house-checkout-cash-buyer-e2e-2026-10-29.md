# Front-house checkout-to-closer cash attribution: buyer ownership, 2026-10-29

**Scope:** supplemental acceptance evidence for the main board
`ops/workflows/front-house-screen-acceptance-matrix-2026-10-27.md`.
The main board is actively edited by PR #228; this separate file avoids cross-agent
write conflicts. This front-house lane ends at a verified paid sale sent to the
correct fulfillment team; A/R and fulfillment own all later financial operations.

## Source-reproduced failure and targeted fix

`src/sales/call-outcomes.mjs::paidTransactionForLink` previously joined
`sale_payments.transaction_id` to `transactions.id` only by **organization**,
not by the paid link's **client**. A misassociated payment row for another
buyer in the same organization could make the closer's disposition for customer A
report customer B's transaction as cash collected. This is a **source-level
integrity risk, not evidence of an actual production misattribution**.

The proposed fix adds `t.client_id = pl.client_id` to the paid-link JOIN.
The exact paid-link ID, product code, org, buyer and link creator remain required;
the already-existing settled payment state / positive deposit filters remain
unchanged. The change does not affect charges, receipts, provider actions,
billing ledgers or client entitlements.

## Acceptance matrix

| Action and role | Expected | Evidence | Verdict |
| --- | --- | --- | --- |
| Closer/owner logs offer disposition with a mismatched same-org buyer transaction linked to this checkout | No foreign transaction ID or foreign cash can be attached to this call | **FAIL baseline from SQL**: JOIN omitted `t.client_id`. Proposed fix and `call-outcomes-checkout-owner.pg.test.mjs` run against isolated temporary Postgres tables | **FAIL BASELINE / FIX PROPOSED — NOT LIVE PROVED** pending 14 CI checks and deploy |
| Closer/owner logs a genuine paid deposit for the exact buyer, product, staff and checkout | Exact buyer transaction resolves, no false rejection | Temporary-table PG regression includes wrong-buyer + correct-buyer receipts, including a newer wrong-buyer record | **NOT LIVE PROVED** pending green CI and signed-in provider readback |
| Wrong client, staff, product or missing payment-link ID | No cash-bearing transaction is resolved | PG regression for all four identity mismatches | **NOT LIVE PROVED** pending green CI |
| Invoice/transaction belongs to a foreign organization | Never counted as this client's paid amount | Existing `org_id` checks in both joins; cross-org production provider proof unavailable | **NOT LIVE PROVED** |
| Closer Present/checkout UI shows paid vs accepted-but-unpaid, saves disposition and reloads | Decisions never impersonate provider-paid cash; persisted outcome aligns with provider transaction and correct org/client | SQL unit/PG tests alone cannot prove live browser or provider source | **NOT LIVE PROVED** |
| Funding, repair, Blueprint paid purchase -> correct first team entitlement/task/doc | Same sale+buyer+org+receipt; exactly-once handoff | Covered separately on the main front-house board and purchase-routing tests | **NOT LIVE PROVED** |
| Owner/Justice real-calendar meeting, guest, Meet and staff Join | Exact correct host, timezone, attendee and event | Google Calendar connector requires interactive authorization in unattended execution; no event was created | **NOT LIVE PROVED** |

**Test isolation:** `call-outcomes-checkout-owner.pg.test.mjs` refuses
anything except `CI=true` and `localhost/127.0.0.1` at database
`/fundhub_ci`. Tests use temporary shadow tables and ROLLBACK; they are
not Supabase tests and do not create any production customer, payment or message.

**Release gate:** Require all 14 pull-request checks green, branch protection,
protected merge, latest combined-main checks and a successful matching
`Ship to live` before claiming the patch deployed. A green CI or ship does
**not** establish an external processor receipt or the correct customer's
live closer readback. No owner-completion SMS until every scoped front-house
action is independently accepted.
