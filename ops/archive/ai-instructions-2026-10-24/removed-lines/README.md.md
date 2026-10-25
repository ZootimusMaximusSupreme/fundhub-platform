# Removed from `README.md` on 2026-10-24

Reason: stale S5 to S11 and dedupe D9, plus decision #27 on the Vercel word in line 3. The two file bullets for `db/schema/001_init.sql` and `db/seed/002_pipelines.sql` stayed.

## D9 and decision #27, line 3

canonical copy at `fundhub-docs` → `/raw/master-rebuild-spec.md`

**one Vercel company**

`fundhub-docs/raw/` never existed in git. The live host is Netlify (`DEPLOY.md`). The Master Rebuild Spec v1 approval date 2026-07-22 stayed.

## S5, line 5

> Built WHILE the live CRM system keeps running. Nothing about launch pauses. Cut over rail by rail once gates pass.

## S6, lines 12-14

## Status: Phase 0 / B1 started

This is the **B1 (Schema + events)** deliverable — the foundation every other builder builds against (Spec §16). B1 merges first.

## S7, lines 19-20

### Open item before B2/B3 build against this
- **`clients` 252 custom fields:** the schema holds them in `custom_fields jsonb` for now. Migration `003_clients_custom_fields.sql` must generate the **typed columns** from the CRM Source of Truth field export (Rule 2 — exact the CRM names kept, e.g. `cf_svy_funding_target_amount`). Generate that before the CRM adapter (B2) writes typed data.

`003` is `003_client_indexes.sql`. The custom-field migration is `005_client_custom_fields.sql`. The typed `cf_svy_*` columns exist.

## S8, lines 22-26

## Build order (Spec §16)
Phase 0: this schema + event bus + replay harness + Cognee ingestion + swarm boot (B1–B8, V1–V4).
Then adapters (Phase 1) → pipelines + ~60 Inngest workflow ports (Phase 2) → dashboards/portal (Phase 3) → Lendflow + Deluxe scaffold (Phase 4) → ops agents (Phase 5) → validator replay + shadow mode (Phase 6).

Tooling (mandated): OpenCode + Antigravity + **Cognee** (shared memory — every agent queries the graph before writing code; no agent works from its own recollection of the spec).

Replaced with: Company Brain uses pgvector in Postgres (owner-set 2026-08-02). Cognee is not used.

## S9, the three counts

- **105 unit tests pass without a live Postgres** (`npm test`) — bus + 7 adapters. Each verifies signature accept/reject, normalize, canonical mapping, idempotent re-delivery, and handler dispatch.
- **124 unit tests pass without a live Postgres** (`npm test`) — bus + 7 adapters + 2 handler modules + router; the 2 real-DB integration tests self-skip.
- **Validated live against real Postgres 16** (2026-07-24, throwaway Docker container): `npm run migrate` applies all tables + 7 pipelines / 42 stages + indexes + default org clean; a signed Commas webhook deduped at the DB `ON CONFLICT` level with a bad-sig 401; and the **full journey integration test** (`client-lifecycle.pg.test.mjs`, runs when `DATABASE_URL` is set) drove entry→survey→payment→diagnostic→decision→analysis into real `clients`/`transactions`/`crs_results` rows, then `replay()`'d every stored event and asserted **zero double-writes**. Schema, migrations, idempotency, JSONB storage, dispatch, and replay-safety are all proven — not mocked.

## S10, lines 43 and 44

Deploy target = Vercel (Spec §2).

`public/dashboard.html`

open the page as `/dashboard.html?key=<secret>`

`public/dashboard.html` was deleted in commit `6a50fb48c`. `api/dashboard/clients.mjs` and `api/dashboard/client.mjs` stayed.

## S11, lines 120-121

## Next
Provision a Postgres, run `npm install` + `npm run migrate` to validate the schema live, then register HANDLERS on the bus (the reactions: CRM field writes, spreadsheet sync, CRS pulls, letter gen). Each adapter's `⚠️ CONFIRM` block must be checked against a real payload before that source cuts over. Deferred behind the Monday launch — builds in parallel.
