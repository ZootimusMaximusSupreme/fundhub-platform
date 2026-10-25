---
description: Known traps that have already cost time. Read them before trusting a green result.
alwaysApply: true
---

# Traps in this repo

These have already cost time. Read them before you trust a green result.

* **`npm test`'s glob is `src/**` and `scripts/**` only.** A test placed under `api/` silently never runs. Endpoint tests live at `src/http/<name>.pg.test.mjs` and import the `api/` handler.
* **The suite is not as green as it looks.** Both counts below are dated history (2026-08-01 and 2026-08-27); the schema has moved since (346 migration files). Re-measure before quoting. With `DATABASE_URL` unset, **442** `.pg.test.mjs` tests skip and the suite reports **3730 passing, 0 failing** — measured 2026-08-01 on this branch. That number is real but partial: it proves nothing about anything that needs a database.

  Against a real Postgres there are pre-existing failures, and **the recorded count has never been stable**: 24 and 29 were recorded against one environment, 45 against a local Postgres 16.13 on `main` at `e67e2db` (2026-07-31). Do not trust any of these three as *the* number. Measure it yourself, and **record where you ran it** — the environment demonstrably moves the count.

  What changed on 2026-08-01: the bulk of those failures are multi-tenant isolation tests, and they were failing because the connection role was a Postgres superuser, which bypasses row-level security entirely. `db/migrations/104_app_role.sql` fixes that by giving the app an unprivileged `fundhub_app` role. The measurement runs on every push — see the "Partner isolation, as the unprivileged app role" step in `.github/workflows/tests.yml`. Read that step's result before quoting any failure count in this file.
  **MEASURED 2026-08-27 — the new number is 0.** Local Postgres 16.14 (Homebrew, macOS), a scratch database created for the run, all 210 migrations applied to it empty, suite run as the database owner exactly as CI does: **6867 tests, 6866 pass, 1 fail, 0 skipped.** The single failure was `the app's database role holds no superuser-level privilege`, which is an artifact of connecting as the owner — that guard is written to run as `fundhub_app`. Re-run as `fundhub_app`: `npm run guard:db` 3/3 pass, `npm run guard:rls` 4/4 pass. So the real count is **zero failures and zero skips**, measured on branch `fix/full-width-shell-v2`. The superuser fix is CONFIRMED. The historic 24 / 29 / 45 / 39 / 30 are all dead — do not quote them. Re-measure rather than quoting this line if the schema has moved since.

  Either way: diff against the baseline commit before concluding you broke something.
* **`npm run verify:e2e` is scratch-only, as `fundhub_app`.** The harness used to resolve the default company and set `messaging_settings.outbound_enabled=false`. Pointing it at production (2026-08-22) paused live sending; snapshot-and-restore is not a safeguard if the run dies. An admin/superuser login also makes the isolation journeys a false green — that login bypasses row-level security. `src/verification/scratch-guard.mjs` refuses both before any write. Never run it against the live database. Law: verify-scratch-only (.ai/rules/verify-scratch-only.md).
* **A handler file is not a route.** `netlify/functions/api.mjs` holds a hardcoded `ROUTES` map; a handler absent from it 404s locally and deployed. This has shipped twice. `src/http/routes.test.mjs` now fails if a handler is neither routed nor on an explicit allow-list — keep it passing.
* **`requireAuth` ignores a `roles` key.** It forwards `opts` to `authenticate()`, which reads only `db` and `env`. Gate with `requireRole` after it. `src/http/auth-gate.test.mjs` fails on the broken shape.
* **Editing an applied migration is a silent no-op.** `migrate.mjs` records each file in `schema_migrations` keyed `<dir>/<file>`. Supersede it with a new file instead.
* **Money is integer cents** via `src/commissions/money.mjs`. `fromCents` returns a string; `percentOf` takes percent units (`10` = 10%). NULL means unknown and must survive — never default it to 0.
* **Outbound transmission is permitted in `src/messaging/providers/*` and nowhere else.** That directory is the only place new outbound `fetch` may be added. `src/lib/`, `src/handlers/` and `src/mail/` contain none, and none may be added to them.

  Three call sites predate this rule and are exceptions, not precedent — do not cite them to justify a fourth: `src/adapters/lendflow.mjs` (submits an application), and `src/workflows/ds-02-diy-letters.mjs` plus `src/workflows/c-06-crs-results-router.mjs` (both POST to the same letter-delivery URL). Anything new that transmits belongs behind a provider module.

  `sendTemplated` still only writes `messages` rows with `status='queued'`. Handing those rows to a provider is the dispatcher's job (`src/messaging/dispatch.mjs`). The dispatcher is scheduled by `src/workflows/message-dispatch-sweeper.mjs`, which is registered in `src/workflows/index.mjs` on cron `*/5 * * * *`.
* **`src/mail/` mails nothing, deliberately.** No scheduler, no send path, no activation flag. The build is not gated; the drop is not built. Law: product-is-live (.ai/rules/product-is-live.md) - direct mail (`src/mail`) stays unbuilt until Chris names the switch.
