# W5 manifest: customer records and banks

Batch: `ops/workflows/coverage-every-surface-2026-10-10.md`. Builder: W5.
Branch: `cov/w5-records-banks` (worktree `.claude/worktrees/cov-w5`). Built 2026-10-10.
Nothing is pushed. The integrator merges. No product bug was fixed. This change builds checks only.

## What was built, in plain words

Nine checks that read the data and go red when a client's result is wrong. All read only.

| Check id | The yes or no question | Lane file | Live answer today |
|---|---|---|---|
| `banks:login-broken` | Is any client's newest login at a bank broken for over a day with nobody told? | `src/pulse/coverage/gap-bank-links.mjs` | green (3 logins, 1 bank, none in error) |
| `banks:merchant-sync` | Is any live pull connection late (an error, or no sync in 2 days)? | `gap-bank-links.mjs` | nothing to judge (no live pull connection) |
| `helper:rows-stuck` | Is a Do task row, a helper chat message, a money proposal or a ready-to-fund press stuck? | `gap-money-helper.mjs` | green |
| `privacy:erasure` | Is an erasure or bank-revoke request waiting over a day, or failed? | `gap-records.mjs` | green |
| `privacy:pii-company` | Did staff from one company reveal a client of another company? | `gap-records.mjs` | green (0 reveals in 7 days) |
| `bureau-config:complete` | Does each of EX, EQ, TU have a number and a menu path? | `gap-records.mjs` | RED |
| `consent:recording-and-ads` | Does every saved recording have a call-recording consent, and every ad clip a live marketing consent? | `gap-records.mjs` | green (0 recordings) |
| `partner-pages:live` | Does every published partner page answer 200 at `/sites/<partner>/<slug>`? | `gap-partner-pages.mjs` | green (8 of 8 answer 200) |
| keys (8 added to `keys:launch-secrets-present`) | Are `PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_TOKEN_ENC_KEY`, `MERCHANT_SECRET_ENC_KEY`, `FINANCE_OS_SETUP_FEE_CENTS`, `LENDFLOW_WEBHOOK_SECRET`, `RESEND_WEBHOOK_SECRET`, `TWILIO_AUTH_TOKEN` set and not a mask? | `gap-keys.mjs` (mine alone) | not judged from a laptop (see below) |

The row ids on the morning report carry the lane name in front, for example `gap-records:bureau-config:complete`. That is how the pulse names every lane row.

### Choices worth knowing

- **Newest login per bank.** "Same bank" means the same client and the same Plaid institution id. With no institution id it falls back to the bank name, then to the row's own id. A client who links the same bank again clears the red, because the old row is no longer the newest.
- **"Told" is a staff task, or a message that really left (sent, delivered, complained), for that client, after the break, that talks about the bank login.** No code in the repo opens such a task or message today. So a real broken login is red after 1 day until a person follows up. That is the point.
- **The windows are the code's own numbers where one exists.** 10 minutes is `STALE_RUNNING_MS` in `money-helper.mjs`. 3 days for a money proposal is `EXECUTION_GRACE_DAYS` in `money-transfers.mjs`, with the same New York date rule as `overdueProposals`. 1 day for a login is one daily sweep, and the money helper's own first late rung. 2 days for a merchant pull is the brief's number. Tests pin each one to its source.
- **Two windows have no written source, so they are the pulse's own line and are named settings in the lane file:** an erasure request waits 1 day (`ERASURE_WINDOW_MS`), and a cross-company reveal stays red for 7 days (`PII_LOOKBACK_DAYS`, the same 7 days the consent lane uses).
- **Test clients are left out** of the helper and consent readings, the same way the consent and portal lanes do it.
- **A read that fails is a skip with the reason, never a PASS.** An empty merchant list is "nothing to judge" with the code `not-connected`, and the lane re-checks it every morning (`naVerify`).

### Two things done differently from the brief, and why

1. **The consent reading is in `gap-records.mjs`, not inside `gap-consent.mjs`.** The existing consent test file pins exactly 5 rows and exactly 4 queries in about 10 places. Adding a row there would have meant editing all of them. The new row reuses `gap-consent.mjs`'s exports (`TEST_CLIENT_EMAIL_RE`) and the one live-consent rule (`CONSENT_VALID_SQL`). It is its own lane step. `gap-consent.mjs` and its tests are untouched.
2. **`privacy:pii-company` is a ninth check the brief did not list.** The brief sorts `route:pii` out of the baseline, and a customer route needs a deep check that goes red when it breaks. The board's own leftover card says `api/pii.mjs` has no company check. This check reads `pii_access_log` (written with the client's company) against the staff member's company, so it goes red on exactly that break.

## Surfaces sorted out of the baseline (22)

All 22 moved into `TRIPWIRES` in `src/pulse/tripwires.mjs`, as one block after `route:consent/capture`. `tripwires-baseline.json` went from 494 to 472.

| Surface | Checks that go red |
|---|---|
| `route:banking/link-token` | `keys:launch-secrets-present`, `banks:login-broken` |
| `route:banking/link-exchange` | `banks-active-link-no-accounts`, `banks-linked-not-on-screen`, `keys:launch-secrets-present` |
| `route:banking/revoke` | `privacy:erasure` |
| `route:banking/sync-accounts` | `banks:login-broken`, `banks-sync-stale` |
| `route:banking/sync-transactions` | `banks-sync-stale`, `banks:login-broken` |
| `route:banking/sync-liabilities` | `banks:login-broken`, `banks-sync-stale` |
| `route:money/connections` | `banks:merchant-sync`, `keys:launch-secrets-present` |
| `route:money/helper` | `helper:rows-stuck`, `finance-os:helper` |
| `route:money/tasks` | `helper:rows-stuck` |
| `route:privacy/erasure` | `privacy:erasure` |
| `route:pii` | `privacy:pii-company` |
| `route:partner-pages` | `partner-pages:live` |
| `route:partner-brand` | `partner-pages:live` |
| `route:ai-bureau-config` | `bureau-config:complete` |
| `desk:money-accounts.html` | `banks:login-broken`, `banks-linked-not-on-screen`, `banks-active-link-no-accounts` |
| `desk:money-banks.html` | `crm-data:lenders`, `crm-data:lender-matches` |
| `desk:money-connections.html` | `banks:merchant-sync` |
| `desk:money-helper.html` | `helper:rows-stuck`, `finance-os:helper` |
| `desk:brand-studio.html` | `partner-pages:live` |
| `desk:lenders.html` | `apply-links` (hourly beat), `crm-data:lenders`, `bureau-config:complete` |
| `job:plaid-transactions-sweeper` | `banks-sync-stale`, `banks:login-broken` |
| `job:merchant-pull-sweeper` | `banks:merchant-sync` |

Honest note: `route:banking/sync-liabilities` and `desk:money-banks.html` have no check built for exactly their own data. They name the closest deep checks that exist (the login and bank-book reads behind them). No new page, route, job or send was added, so no new ping row was needed.

## Files touched

New (lanes): `src/pulse/coverage/gap-bank-links.mjs`, `gap-money-helper.mjs`, `gap-records.mjs`, `gap-partner-pages.mjs`.

New (tests): `gap-bank-links.test.mjs`, `gap-money-helper.test.mjs`, `gap-records.test.mjs`, `gap-partner-pages.test.mjs`, and `gap-customer-records.pg.test.mjs` (the SQL, run on a real Postgres over made-up rows).

Changed:
- `src/pulse/coverage/gap-keys.mjs`: 8 names added to `LAUNCH_SECRETS`, header note updated.
- `src/pulse/coverage/gap-keys.test.mjs`: two pinned-list tests updated to the new decision (Lendflow's webhook secret is now a launch key), four new tests for the eight keys.
- `src/pulse/coverage/modules.mjs`: 4 lines (the literal list).
- `src/pulse/tripwires.mjs`: 22 entries.
- `src/pulse/tripwires-baseline.json`: 22 lines removed.
- `src/pulse/tripwires.test.mjs`: `BASELINE_MAX` 494 to 472.
- `src/lib/no-unfenced-transmit.test.mjs`: one line, `gap-partner-pages.mjs` on the reviewed read-only web list (the same entry every other web-reading lane has).

Check ids reach `src/pulse/self-audit.mjs` through each lane's exported `CHECK_IDS` (that is how its manifest is built), so that file is untouched. `audit:expected-present` counted all of them (1035 checks).

## Proof

- Unit tests for the new lanes: 63 pass, 0 fail (bank-links 18, money-helper 10, records 21, partner-pages 14).
- `gap-keys.test.mjs`: 81 pass, 0 fail (was 77).
- SQL on a real Postgres, read only, made-up rows: `gap-customer-records.pg.test.mjs` 30 pass, 0 fail, 0 skipped. Run through the live connection inside `BEGIN READ ONLY`, every table shadowed so no real row is read.
- Mutation check: 13 deliberate breaks of the SQL rules (newest login flipped, told-after-break removed, message must really leave, one-day window removed, pull mode only, held rows, person rows, round bodies, replaced erasure, same bank login, company compare, consent live at save time, revoked before save). The pg tests caught all 13. The files were put back.
- `npm run pulse:prove`: `OK: every listed file is in the bundle, no step threw or passed 20 s, no SQL error, nothing tried to write.` 50 steps, 635 coverage rows, 47 gap lanes answered, `audit:expected-present` all 1035 present, `audit:na-verified` 62 of 62 still true. My lanes ran in 0.2 to 2.4 seconds each. Slowest lane in the proof was the existing finance-os lane at 11.1 s.
- `npm run lint`: 3234 files parse clean.
- `npx tsc --noEmit`: 1 error, `src/marketing/filmed-receive.mjs(159,75)` TS2345. Not my file. The same on `main`.
- `npm test` with no `DATABASE_URL`, run in this worktree: unit run 19,989 tests, 19,964 pass, 2 fail, 23 skipped. The 957 database tests (`*.pg.test.mjs`) skip with no database: 83 pass, 874 skipped. The 2 failures are not from this change (see "Left undone"). My own pg file was run separately against the live connection, read only, and passed 30 of 30.
- No beat was added, so `pulse:prove -- --beats` was not needed.

## Live reds found (real breaks the new checks found on live data)

1. **`bureau-config:complete` is RED today.** All three bureau rows (Experian, Equifax, TransUnion) are active, and none has a service number or a menu path. Read on the live database, read only.
   - Plain note: nothing that places the call reads these two columns. The call builders in `vendor/inquiry-remover` carry their own phone number. So filling the table will make the check green and will not change a call. That needs an owner call about which one is the truth.
2. **The eight keys cannot be judged from this Mac.** The check reads the live server's own values at 6 a.m. and says `skip` on a laptop. What the local `.env` shows (names and shape only): `FINANCE_OS_SETUP_FEE_CENTS` and `LENDFLOW_WEBHOOK_SECRET` are not in it; `RESEND_WEBHOOK_SECRET` and `TWILIO_AUTH_TOKEN` are masks in it; the four Plaid and merchant names look real. Older notes in the code say the Lendflow secret and the Resend receipt secret were absent on Netlify. So expect the 6 a.m. row `keys:launch-secrets-present` to name some of these. Naming them is correct.
3. **No red yet, but two will turn red when the real break happens, because no code follows up:**
   - A broken bank login has no client message and no staff task anywhere in the code, so `banks:login-broken` is red one day after any real break.
   - Queued "Do task" rows are worked only by the Mac runner (`npm run money:run-queue`). If it is off, `helper:rows-stuck` goes red.
4. **One thing to watch tomorrow:** one money proposal for a client with a normal address is `needs_approval` since 2026-10-07. It passes the 3-day expiry on 2026-10-11. The 15-minute transfer job should close it. If it does not, `helper:rows-stuck` is red on the 11th.

## Leftover cards (one each, not fixed)

- [ ] `ai_bureau_config.service_number` and `menu_path` are read by no code that places the call. The check follows the brief; the table and the call builders disagree.
- [ ] `banks-plaid-item-error` (in `gap-banks.mjs`) keeps counting a login the client already replaced, because a new link makes a new row and nothing retires the old one. `banks:login-broken` judges the newest login per bank instead. The old row is left as is.
- [ ] `api/pii.mjs` has no company check (already a board card). `privacy:pii-company` now goes red on a cross-company reveal. It only sees reveals, because only reveals are logged.
- [ ] `erasure_requests` is only ever written as `completed` (both paths do it in one transaction). `privacy:erasure` can only go red on a future path that leaves a `requested` or `failed` row.

## Left undone

- **No hourly beat.** The brief did not ask for one. `partner-pages:live` and `banks:login-broken` are the two best candidates if Chris wants an hourly watch.
- **Not run against a scratch database as a whole.** There is no local Postgres on this Mac. The SQL was proved with shadow tables on a read-only connection, as `gap-portal.pg.test.mjs` does.
- **Full suite, no database: 2 failures that are not from this change.**
  - `src/http/climate-match.test.mjs` "climate page: no approval odds..." fails on `main` too.
  - `src/pulse/registry.test.mjs` "every registry row names a real handler or desk file" fails in a fresh worktree because `public/leads/...` is a git-ignored file that exists only on the Mac's main folder. It passes in the main folder.
  - A third failure was mine (the no-unfenced-fetch fence flagged `gap-partner-pages.mjs`). It is fixed by the reviewed allow-list line above.
- **Custom domains** are not read by `partner-pages:live` (it reads the `/sites/<partner>/<slug>` address only).

## Notes for the integrator

- Shared files I touched, each with my own lines only: `modules.mjs` (4 lines), `tripwires.mjs` (one block of 22 after `route:consent/capture`), `tripwires-baseline.json` (22 removed), `tripwires.test.mjs` (`BASELINE_MAX`), `no-unfenced-transmit.test.mjs` (1 line).
- **`BASELINE_MAX` will conflict.** Every builder lowers that one number. After merging all five, set it to the final length of `tripwires-baseline.json` (494 minus the total sorted).
- `gap-keys.mjs` is W5's alone in this batch, as the board says. W4 adds nothing there.
- `route:pipeline-cards` is not in my list. I did not touch it.
