# Fundhub A/R: collections buyer / tenant ownership guard

**2026-10-29 UTC — A/R independent lane. Status: FIX PROPOSED / NOT LIVE PROVED.**

## Source-reproduced finding

The pre-fix `invoice.sent` handler in `src/workflows/ar-collections.mjs` checked that the supplied `event.orgId` / `event.clientId` matched `invoices.org_id` / `invoices.client_id`, but never looked up `clients.org_id`. The legacy `invoices.client_id REFERENCES clients(id)` FK does not enforce tenant consistency. As a result, an inconsistent org-A invoice pointing to org-B's buyer could enter A/R collections.

The shared `sendTemplated` helper loads the buyer's email and phone by client ID alone. An inconsistent invoice could therefore queue day-zero, seven-day and fourteen-day collections communications under org A to org B's buyer. At AR-04 the `addTags` helper updates `clients` by ID alone and might tag the foreign buyer, as well as opening an incorrect CSM task. This is a **source-level risk**, **not evidence of a real production occurrence**.

## Isolated A/R repair

`src/workflows/ar-collections.mjs` now verifies that the actual client row belongs to the invoice organization, before the day-zero stage, at each delayed notice after waking, and again inside the AR-04 transaction prior to any tag, task or escalation. A failed database lookup throws, rather than sending a notice on guessed identity. An owned-client mismatch fails closed with `invoice_client_not_owned`.

The behavior is pinned by three stand-in regressions: foreign client at day zero; buyer ownership lost before day seven; ownership lost before AR-04 handoff. Additionally, `src/workflows/ar-collections-owned-client.pg.test.mjs` creates two distinct tenants, a valid invoice and an intentionally inconsistent invoice in a **rollback-only** transaction. It must run with `CI=true` and a local `/fundhub_ci` PostgreSQL URL. The test proves incorrect buyer receives zero messages, payment links, CSM tasks and tag changes; a valid buyer reaches the first step, stopped by a no-send fake. No Commas call, SMS, email or production Supabase write is performed.

## Release and evidence gates

This is separate from [A54 / PR #235](https://github.com/ZootimusMaximusSupreme/fundhub-platform/pull/235), which addresses manual invoice email and backlog with tenant-owned joins. The current branch touches only `src/workflows/ar-collections.mjs`, `src/workflows/ar-collections.test.mjs`, this dedicated document, and the new A/R-only PostgreSQL test. It does not touch active front-house PRs #228/#233 or fulfillment PR #232.

**NOT LIVE PROVED:** exact 14/14 PR checks and protected merge; exact main deployment; read-only processor/customer receipt; true delivered SMS/email; staff CSM queue and ledger. No PR merge before all required checks green. This guard does not prevent an upstream producer from creating a contradictory invoice; confirm source ownership jointly with fulfillment. The authoritative A/R acceptance matrix `ops/workflows/accounts-receivable-e2e-2026-10-28.md` is held by active #235 until its protected merge; record this as the next discrete acceptance item after that merge. Never treat green CI as delivery evidence.
