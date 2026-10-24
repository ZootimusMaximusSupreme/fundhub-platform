# Deploy

The live host is **Netlify** (site `transcendent-wisp-888771`). The database is Supabase Postgres. The old Vercel and Neon steps that used to be on this page are gone. Do not use them.

## How a change goes live

- **Push `main` to GitHub.** `.github/workflows/ship.yml` runs `npm run ship`. That is the normal path (CLAUDE.md section 11, `github-ships-main`).
- **If `main` changed without a GitHub push,** run `npm run ship` on the Mac once, at the end of the session. Never run both at once.
- `npm run ship` checks, applies pending database changes, deploys once, confirms `/api/health` reads pending 0, and logs the ship in `ops/ship-log.md`.
- Only the production deploy runs `db/migrate.mjs` (`netlify.toml`, `[context.production]`). Previews never migrate.
- Set env vars with `netlify env:set`, all in one batch, then ship once. Never per-variable deploys. Real values live in gitignored `.env`, never in git (`secrets-env-law`).

## Verify

- Health: `https://fundhub.ai/api/health` returns `{"ok":true,"db":"up",...}`.
- Machine check: `https://fundhub.ai/api/health?strict=1` has the same body, but the status code is **200 only when the deployment is healthy** and **503** when it is not. Give this URL to an uptime monitor. The plain one always answers 200 on purpose (the CRM status chip reads its body), so a monitor pointed at it stays green through a database outage.

## When it breaks

See [docs/sops/RUNBOOK.md](docs/sops/RUNBOOK.md). It holds the rollback steps, what each `/api/health` state means (`up`, `behind`, `unreachable`, `unconfigured`, `error`) and its first action, how to apply migrations a deploy did not run, and what is not monitored. It is linked from here, not copied, because two copies of a procedure disagree eventually.

- **Rolling back moves the code, not the database.** Netlify, Deploys, Publish deploy puts the previous version live in seconds. Migrations only move forward.

## Notes

- No `DASHBOARD_SECRET` set plus `NODE_ENV=production` means dashboard endpoints return 401 (fail-closed).
- Webhook endpoints live at `POST /api/webhooks/{commas|twilio|mailgun|bland|clickfunnels}`. Provider webhook secrets are set as env vars when a live source is wired.
- Inngest workflow functions are served at `/api/inngest`. `INNGEST_EVENT_KEY` stays on permanently (CLAUDE.md section 11). `INNGEST_SIGNING_KEY` verifies requests from Inngest.
