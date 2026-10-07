# File-protection alerts — the contract (back end → screen)

Capital Blueprint 48-hour launch, unit B2 (`ops/workflows/blueprint-launch-2026-10-06.md`,
map items 11–14). Offer (owner-set 2026-09-29): `docs/finance/capital-blueprint-next-2026-09-29.md`.
This file is for the unit that builds the screen. It says what goes out, what the
API returns, and what you may call.

The alerts **send**. They go out as texts through `sendTemplated`, which only queues a
`messages` row. The dispatcher sends it, behind the dry-run switch, quiet hours and the
opt-out check. Nothing here moves money.

## 1. The four alerts

| Kind (`kind`) | Goes out when | Once per | Text (plus "Reply STOP to opt out.") |
|---|---|---|---|
| `payment_timing` | a card's statement closes in 0–3 days | card per cycle | "Fundhub reminder: pay your Business Amex ending 4404 down before Oct 15. That is the day it reports to the bureaus. Balance now $5,400.00 (22% of your limit). Pay about $2,900 to get under 10%." |
| `promo_end` | a card's promo ends in 60, 30 or 7 days | card per threshold | "Fundhub reminder: the promo rate on your Business Amex ending 4404 ends Dec 6 (in 60 days). You still owe $5,400.00. Pay about $2,700 a month for the next 2 months to clear it in time." |
| `cash_reserve` | personal **or** business cash is under 6 × that kind's monthly minimums | drop (re-arms when cash recovers) | "Fundhub alert: your personal cash is $4,210.55. 6 months of your personal minimum payments is $4,296.12. A missed payment can hurt your file before your next funding sequence." |
| `new_credit` | a new card or loan on a linked login, or a new account or inquiry between two stored credit pulls | account, or pull | "Fundhub alert: a new card showed up on your linked accounts: Chase Freedom ending 4321. New credit can push back your next funding sequence. If this is not yours, reply and tell us." |

The word is **"the next funding sequence"**, never "round two" (owner-set 2026-10-06).

Every number in a text is computed from a stored fact, never invented:

* **Close date** — the card's statement close day (`account_statement_cycles.statement_close_day`),
  worked out by `src/banking/statement-cycles.mjs` (the one month-end rule: a close day of 31
  lands on the 28th or 29th of February).
* **Balance, limit, percent** — the card's balance and limit, the same ones the Money page shows.
* **"Pay about $X to get under 10%"** — the balance minus 10% of the limit, rounded **up** to the
  dollar. 10% is the target the checklist's paydown steps use (`PAYDOWN_TARGET_FRACTION`).
  With no limit on file the text says the balance and stops. With no balance it says the day and stops.
* **Promo payoff** — payments left = days left ÷ 30, rounded, at least 1 (60 days is 2 payments;
  30 or fewer is 1, "pay all of it"). Monthly = balance ÷ payments, rounded up. No interest is
  modelled, so it says "about". With no balance on file it says where to look.
* **Cash cushion** — see §3.

## 2. Who gets them, and when

* **Audience:** every client who paid for the Capital Blueprint (`isCapitalBlueprintBuyer`) **or**
  holds an active `finance-os` subscription — once each.
* **Schedule:** the existing daily job `blueprint-finance-os-alerts` (cron `30 7 * * *`, 07:30 UTC).
  It was extended, not replaced: same Inngest function id, so the registered-workflow count did not move.
* **Opt-out:** a client who texted STOP is not texted. Nothing is written for the text, so if they opt
  back in while the alert's window is still open it goes then. A Blueprint client's `new_credit` alert
  still opens a CSM task (see below).
* **Per-kind switch:** the client (or staff) can turn any kind off. Off means not sent.
* **CSM task (new credit, Blueprint buyers only):** `createTask` with `source_workflow`
  `blueprint-file-protection`, `assignee_role` `csm`, assigned to the client's CSM when there is one.
  The task body starts with the alert's key, so a repeat never opens a second task. If the client is
  opted out the alert is still recorded, with `delivery: "task_only"`.

## 3. Choices made here (so nobody has to guess)

Nothing in the repo or the offer fixed these, so each is a named, changeable value in
`src/finance/file-alerts/common.mjs`.

| Choice | Value | Why / how to change |
|---|---|---|
| Lead time before a statement close | **3 days** | The repo has no rule for it. 3 matches the card-due reminder window, and a payment takes 1–3 days to post. Env `FILE_ALERT_PAY_BEFORE_CLOSE_DAYS` (1–10) changes it. The screen shows the live value in `settings.pay_before_close_days`. |
| Promo windows | 60 / 30 / 7, firing on the day and the two days after a missed run, never earlier | A promo typed in with 45 days left skips the 60-day text — it is already past. |
| Cash cushion size | **6 months** of minimums | Owner-set offer. |
| Fundhub payment plans (Clarity) in the cushion | the next unpaid payment of each open plan, counted against **personal** cash only | The plans carry no personal / business tag. `CLARITY_CASH_KIND`. |
| Old cash balances | a balance dated more than **30 days** ago is treated as unknown | The Plaid balance feed does not refresh daily yet; this stops an alert on a year-old number. A balance with no stated date (hand-entered) is allowed. |
| First read of a login | accounts created within **60 minutes** of the login are the baseline, not new credit | Linking your cards is not opening them. |
| Look-back for new credit | an account or pull seen in the last **3 days** | A backlog from before launch stays quiet. |

**Cash is never added across personal and business.** `reserve` has one verdict for each, judged against
that kind's own minimums, and no total anywhere. A card or loan nobody has sorted into personal or
business is in **neither** check; `reserve.not_counted` lists it so the screen can say "sort these".

**Unknown is never zero.** A minimum that is not on file is not counted as 0: the need becomes "at
least" (`minimums_is_floor: true`). A cash total with a hole in it is a floor (`cash_is_floor: true`):
covering the need with a floor is fine; falling short of it proves nothing, so nothing is sent.

**New credit never accuses.** A credit-pull diff matches an account by its **print** (the day it was
opened plus the last four digits), because a bureau renames creditors — one renamed creditor once told
a client they had opened new credit. An account with no print is unknown, never new. Nothing is
compared when the older pull had no accounts, or when the newer pull has a bureau the older one lacked.
An inquiry dated before the older pull is not new. A card already announced from Plaid is not
announced again from the pull (matched by last four), or the other way round.

## 4. `GET /api/money/alerts`

Same two callers and gate as `GET /api/money/overview`:

* a signed-in **client** reads their own file (`client_id` comes off the session; one in the query is ignored);
* **staff** (`owner`, `admin`, `sales_manager`) pass `?client_id=<uuid>`. A client in another org is 404.

The full sample answer is **`src/finance/file-alerts/file-alerts.fixture.json`** — build the screen
against that file. A test (`read.test.mjs`) fails if the endpoint stops returning exactly it.

Top-level keys:

* `ok` — `true`.
* `as_of` — ISO time of the read.
* `client` — `{ id, name }`.
* `enrolled` — `{ blueprint, finance_os, any }`. `any: false` means the daily job will not text this client.
* `settings` — `kinds` (one `{ enabled, label }` per kind, in the order the screen lists them),
  `saved` (false until anyone changes a switch; defaults are all on), `pay_before_close_days`,
  `promo_thresholds_days` (`[60,30,7]`), `reserve_months` (`6`), `texts_blocked` (the client opted out
  of texts: say so on the screen, and expect nothing to send).
* `cards` — one entry per open credit card (below).
* `reserve` — `months`, `personal`, `business`, `not_counted` (below).
* `alerts` — what already went out, newest first, up to 50 (below).

### `cards[]`

```
account_id, name, mask, kind ("personal"|"business"|"unknown"),
balance_cents, limit_cents, used_pct            // null when unknown
statement_close_day                             // 1-31 or null
close_day_source                                // "provider" (Plaid) | "manual" | null
pay_before: {
  next_close_on, days_to_close,                 // null with no close day
  unknown_reason,                               // null, or "no_statement_close_day"
  text_on,                                      // the first day the text can go (close - lead time)
  texted, texted_at                             // already sent for that close?
}
promo: null | {
  ends_on, days_left, ended,
  apr_pct,                                      // 0 = a 0% promo; null = rate not given
  source ("client"|"staff"), set_at,
  balance_cents,
  payoff: null | { payments, monthly_cents, total_cents },
  next_alert: null | { threshold, on },         // the next of 60/30/7 whose day has not passed
  alerted_thresholds: [60, ...]                 // already sent for this end date
}
```

A card with `statement_close_day: null` cannot get the pay-before-close text. **A hand-entered card
never has one**, so the screen should ask: "Which day of the month does this card's statement close?"
and call `set_statement_close_day`. (A Plaid card gets it from Plaid, and Plaid's daily read overrides a day typed in.)

### `reserve.personal` and `reserve.business`

```
state            "below" | "ok" | "unknown"
reason           "below_need" | "covered" | "no_minimums" | "minimums_unknown" | "no_cash_accounts"
                 | "cash_unknown" | "balance_stale" | "cash_is_a_floor"
months, cash_cents, cash_is_floor, cash_accounts,
minimums_cents, minimums_is_floor, clarity_cents,   // clarity_cents is counted in personal only
need_cents, short_cents,                            // short_cents only when state is "below"
open_alert_id                                       // the alert still open for this drop, or null
```

Plain words for `reason` when `state` is `unknown`: `no_minimums` "No payments on file yet";
`minimums_unknown` "Add each card's minimum payment"; `no_cash_accounts` "No {kind} checking or savings account linked";
`cash_unknown` "A balance is missing"; `balance_stale` "That balance is more than 30 days old";
`cash_is_floor` "One balance is missing, so this is a floor".

`reserve.not_counted` is `{ debts, minimums_cents }` — cards and loans whose kind is not sorted yet.

### `alerts[]`

```
id, kind, kind_label, account_id, label, threshold, due_on, cash_kind,
body,                      // the sentence the client was told (no opt-out line)
delivery,                  // "text" | "task_only"
message_id, task_id,       // the messages row; the CSM task (new credit, Blueprint)
sent_at,                   // when it was queued (the provider's own send time is on the messages row)
cleared_at, open           // cash alerts only: open until the cash recovers
```

## 5. `POST /api/money/alerts`

Body `{ action, ... }`. Staff add `client_id`. Clients cannot name another client. Staff outside
`owner`/`admin`/`sales_manager` get 403. Success is always `{ ok: true, action, saved }`; re-read the GET
for the new picture.

| `action` | Fields | `saved` |
|---|---|---|
| `set_alert` | `kind` (one of the four), `enabled` (true/false) | `{ kind, enabled }` |
| `set_promo` | `account_id`, `ends_on` (`YYYY-MM-DD`, today or later, within 5 years; **null clears it**), `apr_pct` (optional percent 0–100; `0` for a 0% promo) | `{ account_id, cleared, promo: { ends_on, apr, source, set_at } \| null }` |
| `set_statement_close_day` | `account_id`, `day` (1–31; null clears it) | `{ account_id, statement_close_day }` |

`apr_pct` is **always a percent**: `0.5` is half a percent, not fifty. `account_id` must be this
client's own open credit card.

Errors: `400 { ok:false, error:"invalid_input", field, message }` (`field` names the input: `kind`,
`enabled`, `account_id`, `ends_on`, `apr_pct`, `day`); `400 { error:"unknown_action", actions:[...] }`;
`404` for a card that is not theirs (no hint the id is real); `405` for any method but GET / POST.

## 6. What is stored (migration 471)

* `account_statement_cycles` gains `promo_ends_on`, `promo_apr` (a fraction, like `apr`), `promo_source`,
  `promo_set_at` — all four set together or none. A promo lives with the card's other billing terms,
  not on `client_cards` (that table is the payment instrument a client pays Fundhub **with**).
  Plaid's daily read replaces only the columns it names, so it never wipes a typed-in promo.
* `file_protection_settings` — one row per client, one boolean per kind. No row means all on.
* `file_protection_alerts` — one row per alert that went out. A unique key per org makes each alert fire
  once; a partial unique index allows one open cash alert per client per kind. A row exists only when a
  text was queued or a CSM task was opened.
* Four SMS templates, `SMS-FILE-PROTECT-PAY-BEFORE-CLOSE`, `-PROMO-END`, `-CASH-RESERVE`, `-NEW-CREDIT`,
  seeded the way 433 and 444 seed theirs (an edited copy is never overwritten). A test renders each against
  the sentence the planner stores, so the text and the list cannot drift.

## 7. Known limits

* The alerts read `bank_accounts` as it is. Those rows (and the balances on them) are written when a login
  is linked; nothing re-reads the Plaid account list or balances every day yet. So a new Plaid card shows up
  as soon as something writes its row (a re-link), and the cash cushion uses the balance as last written.
  The 30-day stale rule above is the only guard.
* Real Plaid banks are not live yet (sandbox only), so for launch the data is hand-entered accounts and the
  sandbox test client.

## 8. Check it yourself

* **Dry run (read only, queues nothing):**
  `node --env-file=.env scripts/blueprint-file-alerts-dry-run.mjs` — runs the real daily pass over the test
  client (`f1cb9c27-f858-4db1-b6bb-4eddc898bb8e`) for 50 days with an in-memory alerts store and a `send` that
  only prints. Part B layers labelled simulated changes (a promo date, a cash drop, a new card, a new inquiry).
* **Tests:** `src/finance/file-alerts/*.test.mjs`, `src/http/money-alerts.test.mjs`,
  `src/workflows/blueprint-finance-os-alerts.test.mjs`, and `store.pg.test.mjs` (real Postgres, runs in CI).
