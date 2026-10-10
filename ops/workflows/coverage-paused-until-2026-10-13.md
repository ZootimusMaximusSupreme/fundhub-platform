# Coverage batch — PAUSED until Tuesday 2026-10-13, 10:00 a.m. Arizona (MST)

Owner order (Chris, 2026-10-10): "pause, save this until Tuesday at 10am MST." Do not continue this batch before then unless Chris says so. Nothing is running. The live heartbeat itself is NOT paused: it keeps ticking by itself.

## Where it stands (main = GitHub, one branch, nothing left in a work folder)

- Heartbeat: 1,077 checks across 63 lanes. The self-audit says all of them show up (`audit:expected-present`).
- Hourly beats: 10, all green. The 5-minute outside watcher (`pulse-outside-watch`, beat `engine-alive`) ticks every 5 minutes.
- Built and shipped, 2026-10-10: W1 money (funding, fees, payouts), W2 money (checkouts, setup fee, bank moves, ad spend), W3 pipelines, W4 messages, W5 records and banks, W6 the finished lists (L0, JSON files only), W7 click and door tests, W8 five whole-journey checks.
- Board with the definition, counts and prompts: `ops/workflows/coverage-every-surface-2026-10-10.md`. Lists: `ops/workflows/coverage-every-surface-2026-10-10/*.json`. Manifests: `manifest-w1.md` to `manifest-w8.md` in that folder (W6 manifest holds the new totals).
- Suite: 20,574 pass, 0 new failures. `npm run pulse:prove` OK (full and `-- --beats`).

## The honest limit (said to Chris in plain words)

1. About 800 of about 4,000 listed things have a deep check; about 880 have none.
2. The first 2,690 rows were scored before the wave 1 checks existed and were not scored again. Recount first.
3. The new tests use a stand-in database. They prove handler code, not the SQL against real Postgres (this Mac has no local Postgres).
4. Most new checks run once a day at 6 a.m. Only 3 families run hourly.

## Real breaks the new checks found (none fixed; this batch builds checks only)

- Booked call with no join link. Justice and Sarah are past due to join the booking page (a person's setup step).
- `FINANCE_OS_SETUP_FEE_CENTS` is not set, so the FinanceOS setup page shows "$X" and Pay answers 409. The price is Chris's call.
- AI bureau config is empty for Experian, Equifax, TransUnion (`bureau-config:complete`).
- Bram's repair file (FH-000507): owner-closed, do not touch or re-raise.
- Not red yet but real: no code stamps affiliate license or tax-form dates (first payout will hold); `src/handlers/paid-service-payment.mjs` is not registered in `src/register-all.mjs`; the billing sweeper has no charger; AG-04 Setter Josh retired but still wired; 75 key names have no watch; Mailgun bank-yes door is only pinged.
- Leftover cards in the board section 4 and in `manifest-w7.md` (7 cards). Not fixed.

## What to do on Tuesday, in this order

1. Read the 6 a.m. scorecards for Sun, Mon and Tue (`pulse_scorecards`, newest rows). Read only, `BEGIN READ ONLY`. Compare to this list. Ignore the laptop-mask reds (`brain:embed-key`, `opt-out:unsubscribe-link`, `keys:*`, `gmail`): they are green on the live server (see memory `laptop-prove-reds-are-masks`).
2. Tell Chris what the new lanes found live over the weekend. Plain words, 4th grade.
3. Ask ONE question: which next step, if any:
   a. Hourly beats for the money checks (W1, W2): `trip:funding` and `trip:partner` are the first two.
   b. Recount and re-score the 2,690 older rows (the L0 truth).
   c. Deep checks for the ~880 with none, money then customer first (needs a new wave; use the heartbeat build rules).
   d. Set the real numbers Chris owns: FinanceOS setup price, stage time limits for 7 boards, commission pay day.
4. Do not start a build until Chris answers.

## Rules that still apply

- Never remove, unset or overwrite a key. Never print a secret.
- No branches kept on GitHub. Work in a temporary work folder, merge locally, push `HEAD:main`, delete the folder and branch.
- Never write a secret-shaped string in a tracked file, even a fake one in a test (GitHub push protection blocked a fake `sk_live_` fixture on 2026-10-10). Build it from parts at run time.
- Never `pkill` by pattern (one builder killed another builder's test run that way).
- Texts to Chris only 6 a.m. to 10 p.m. Arizona.
