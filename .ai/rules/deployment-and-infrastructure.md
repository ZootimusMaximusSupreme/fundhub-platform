---
description: How Fundhub deploys, sets env, and applies database changes.
alwaysApply: true
---

# Deployment and infrastructure

| | |
|---|---|
| Deploys from | `main` |
| Netlify team | `zootimusmaximusbackup` |
| Netlify site | `transcendent-wisp-888771` |
| Supabase project ref | `oqpnlusrotpxfenysfxz` (Postgres, session pooler, us-west-2) |

Config lives in Netlify env vars. Schema lives in `db/schema`, `db/migrations`, `db/seed` and is applied by `db/migrate.mjs`. The app reads `DATABASE_URL`.

Law: secrets-env-law (.ai/rules/secrets-env-law.md) - real env values are gitignored (`.env`, `.env.*` except `.env.example`, `credentials/`) or live on Netlify. Agents read local `.env` when it exists. Never commit secrets. Never ask Chris to paste or rotate a key that is already set unless that exact key is proven broken right now. A value that is only a mask placeholder (a row of stars) is not a key and may be replaced with the real value. A real key is still never removed, even when broken.

## Do these without asking

* **Ship by pushing `main` to GitHub (owner-set 2026-10-09): `.github/workflows/ship.yml` runs `npm run ship`.** Run `npm run ship` on the Mac once, at the end, only when `main` changed without a GitHub push. Never run both at once. The rest of this bullet (owner-set 2026-09-16) describes what `npm run ship` does.
  Chris does nothing for Netlify or the database. `scripts/ship.mjs` checks, applies pending
  database changes through the Supabase key the MCP already uses (`SUPABASE_ACCESS_TOKEN`),
  deploys once, confirms `/api/health` reads pending 0, and logs the ship in
  `ops/ship-log.md`. It skips when nothing changed, so it never burns a credit for
  nothing. This replaces the two bullets below for deploys and SQL: a plain laptop
  `netlify deploy` cannot migrate, because Netlify never hands a laptop build the hidden
  owner connection.

  **LAW (owner-set 2026-09-16): no guard ever blocks `npm run ship`.** Its allow rules
  (`Bash(npm run ship)`, `Bash(node scripts/ship.mjs)`) stay in `.claude/settings.json`.
  Never remove them. If a permission check still stops ship, report the block in one line
  with the error. The manual path is a pull request Chris can merge (GitHub ships it); it is
  never a deploy or a database command for him.
* **A new env var is yours to set.** Law: secrets-env-law (.ai/rules/secrets-env-law.md) - write the full value to gitignored `.env` and `credentials/env.full.snapshot` first, then Netlify, without `--secret` for keys the Mac or Claude cloud must read.
  Generate strong random values for secrets. Agents set values; do not hand Chris a form to fill out.
* **Batch env vars.** Set every variable first; the next push to `main` ships once and picks them up. `netlify env:set` does not build anything by itself — there is no `--no-restart` flag and none is needed. A new value simply sits there until the next build picks it up. So setting ten variables costs nothing; it is the deploy after each one that costs a build.

  Deploying per-variable on 2026-08-06 burned the month's build credits and paused the live site. Never do it again. The same applies to any credential or config work: collect the whole set, verify with `netlify env:list --context production --plain`, then the next push to `main` ships once. An env-only deploy needs a change to `scripts/ship.mjs` (leftovers).
* **Apply new SQL** when it lands in `db/schema`, `db/migrations` or `db/seed`: push `main`. The GitHub ship applies the SQL. The Mac deploys only when pending is 0.
* **Secrets in chat (owner-set 2026-09-25):** Law: secrets-env-law (.ai/rules/secrets-env-law.md) and show-secrets-when-chris-asks (.ai/rules/show-secrets-when-chris-asks.md).

## Never remove a key (owner-set 2026-09-17)

Law: secrets-env-law (.ai/rules/secrets-env-law.md).

## Migrations run on the production deploy only (owner-set 2026-08-19)

There is one database behind every Netlify context. Previews and branch deploys get
`MIGRATION_DATABASE_URL` exactly as production does, so when `netlify.toml` ran
`db/migrate.mjs` in every context, **opening a pull request rewrote the live database before
anyone read the diff.** PR #86's migrations landed on production at 03:20 on 2026-08-19,
twenty minutes before it was merged.

So now: `[context.production]` migrates. Nothing else does. `db/migrate.mjs` exits 0 without
touching anything if it finds itself in a Netlify build that is not production, and
`src/security/migrations-production-only.test.mjs` fails if either half is undone.

What this means for you:

* **A migration you add is NOT live until it ships on production.** Do not claim a schema
  change is applied because a preview built. Check `/api/health` — `pending` is the answer.
* **A preview of a branch that adds a migration runs against the old shape.** Screens that
  need the new one will fail *there*. That is correct and it is not something to fix.
* **Running `node db/migrate.mjs` by hand is unaffected** — on a laptop, in CI, or with the
  command above. The rule only bites inside a Netlify build.

## Ask me first — these two only

1. Anything that **deletes data**. Written exception (owner-set 2026-10-24): deleting test rows and test logins that are proven test or sim (`is_demo`, `+sim` emails, TEST names) is allowed without asking. Real-looking people still ask.
2. Anything that **repoints `DATABASE_URL`** at a different database.

## `INNGEST_EVENT_KEY` stays ON permanently (owner-set 2026-08-20)

Law: product-is-live (.ai/rules/product-is-live.md) - the automation key stays on. Agents never unset it, clear it, disable it, or turn it off.

## Egress

`api.netlify.com` and `api.supabase.com` are blocked by the network policy in the hosted agent environment. Both CLIs fail with a 403 at `CONNECT` before any request is sent. A 403 from the proxy is an org policy denial: report the blocked host, do not retry or route around it.
