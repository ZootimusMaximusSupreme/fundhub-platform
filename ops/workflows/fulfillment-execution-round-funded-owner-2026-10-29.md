# Fulfillment A50 — funding result cannot borrow another buyer's round

**Independent lane:** fulfillment execution. **Date:** 2026-10-29 UTC. **State:** SOURCE FAIL / PROPOSED FIX; CI and live proof pending.

## Source reproduction
`src/handlers/money-chain.mjs:onRoundFundedMoney` previously selected supplied `fundingRoundId` with only `id=$1`, fell back to `resolveClient` (lead-capture mutation) and `client_id+round_number` without organization, and wrote `UPDATE funding_rounds ... WHERE id=$1`. An event referencing another organization's/customer's round could therefore enter updates, client funded aggregate, closeout and commission generation. This is source evidence, **not** proof of an actual production incident.

## Targeted guard / exact acceptance
- Validate event organization and existing client; if ID supplied, require exact `funding_rounds.id + org_id + client_id`; do **not** fall back on an explicit missing/foreign ID.
- If no ID, require positive explicit round number plus exact organization/client; never guess round 1.
- Existing-email-only paths resolve `clients` read-only in same org; unknown buyer cannot create a CRM row.
- Refuse supplied sale IDs not belonging to the same existing buyer/org active funding purchase, or contrary to the frozen round sale. Funding UPDATE checks org + buyer as well; closeout references verified round.client_id, never lead-creating resolver.
- Synthetic no-database tests must prove foreign organization, same-org wrong client, explicit stale ID, nonexistent email, absent number, wrong sale and legitimate lookup. Real **disposable loopback fundhub_ci PostgreSQL** TEMP/ROLLBACK tests must prove exact ID/round ownership and unchanged rows for all refusals.
- No success-fee invoice, status, client, message, or external mutation on refused events. **CI-only PASS** requires passing 14 mandatory jobs, then protected merge; actual end-to-end success also needs successful matching main `Ship to live`, read-only merchant/lender evidence, signed contract terms, staff/client role and provider receipts. Keep **NOT LIVE PROVED** until then.

## Explicitly separate unresolved contracts
- F-07 consumes a `round.funded` envelope in a separate workflow and presently trusts approval amount and fee percent supplied on the event; downstream invoices must be independently tied to the correct round and signed sale in a distinct targeted PR.
- Confirmed **approved credit limits** and actual **disbursed cash** remain different facts. The historical owner-set fee basis says confirmed approvals, while new acceptance demands verified funding and contractual authority before an A/R receivable; obtain signed terms, don't invent a rate or silently switch basis.
- This PR changes the canonical money-chain funding writer only. The separate A/R lane owns invoices/collections, and front-house owns bookings/paid handoff; no active PR shares this file. Production customer data remains read-only.
