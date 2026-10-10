# Next funding sequence planner (Capital Blueprint, unit B4)

Board: `ops/workflows/blueprint-launch-2026-10-06.md`, map item 10. Offer line (owner-set 2026-09-29): "After funding, the system calculates when the file has recovered enough for another round and alerts the closer, which sets up the next success fee."

**Naming (owner, 2026-10-06).** A funding sequence holds about six rounds. The push after it is **the next funding sequence**. Nothing the planner says, writes or sends calls it anything else. A test scans the files and every sentence the planner builds.

## What it answers

`computeNextSequenceDate(db, { orgId, clientId, asOf })` in `src/blueprint/next-sequence-plan.mjs`. Read only. `null` when the client is not in that org.

```
{ suggested_date, not_before, reasons[], blockers[], confidence: 'computed' | 'partial',
  ready, staff_date, effective_date, effective_source: 'staff' | 'suggested' | null,
  flags[], declines{ tracked, open, notes[] }, after_funding{ ..., alert_key }, blueprint_buyer }
```

- `reasons[]` has three entries, one per factor: `inquiries`, `new_credit`, `utilization`. Each is `{ factor, title, status: ready | waiting | unknown, ready_on, not_before, text, source{label, ref}, also, detail }`. `ready` with a null date means nothing to wait for. `unknown` carries no date.
- `suggested_date` is the LATEST date any known factor names. A factor that is unknown does not move it, but it makes `confidence` "partial". `not_before` is the lower bound the unknown factors could still give.
- `blockers[]` are things that are not a date: `no_credit_file`, `not_fundable` (score under 700 or a negative item), `credit_file_stale` (the file is older than the sequence), `no_funding_yet`, `decisions_pending` (an application with no final answer), `open_reconsiderations` (a decline defense row still open).
- `ready` = computed, no blockers, and `suggested_date` is today or earlier.
- `effective_date` = the staff date when set; else the suggested date, but only when computed with no blockers; else null. The staff date always wins and the suggestion rides next to it. `flags` says when the staff date is earlier than the file math.

## The windows, and where each is written

| Window | Number | Source |
|---|---|---|
| Hard inquiries, per bureau | under 3 in the last 6 months AND under 6 in the last 12 | Legacy Strong page "Hard inquiries - Bureau stacking" (`hard-inquiries-bureau-stacking--f3a39877`) |
| Inquiry ages (shown, they do not gate) | matter most inside 6 months, stop mattering after 12, drop off at 24 | pages "Live Bootcamp (FUNDING) - July 2026" (`live-bootcamp-funding-july-2026--395c3aa7`), "Factors Of Credit Score" (`factors-of-credit-score--ff7e0bb0`), "Inquiry Training" (`inquiry-training--ab7693a7`) |
| New credit spacing | about every 6 months | page "Factors Of Credit Score": "Apply for new credit products every 6 months" |
| Card use | 30% or less | `src/underwrite/vendor/underwriter.cjs` (`fundable` needs `util <= 30`, `target_util_pct 30`) |
| Fundable | score 700 or more, no negative items | same file |
| A new card counts toward the funding estimate (a note, not a gate) | 24 months old, from the first of the month | same file (`seasoned`) |
| One at a time | wait for the decision before the next application | `src/underwrite/black-report-node.mjs`, Application Order Warning |

The pages are in the gitignored scrape, `credentials/notion-scrape/output/<folder>/FULL.md`. The math and every window are in `src/blueprint/next-sequence-math.mjs`; a test pins each number and each source name.

**Day counting.** A thing counts through the day it turns N months old. The next day is the first clear one, so the planner never names a day early.

**Inquiries.** All three bureaus must be under both limits. Inquiries come from the newest credit pull that carries a score (the same pick as the Credit tab, so a newer empty sandbox pull never wipes out the real file), plus one inquiry per application sent AFTER that pull, at the bureaus its bank pulls (the bureau staff saw, else the bank book). Two applications at one bank on one day are one pull. A bureau that was not pulled, an application whose bank's bureau is not known, or counts with no dates when 3 or more are on file: unknown, never zero.

**New credit.** The newest of: an account that opened, an application that was sent (it pulls credit even when the bank says no), an approval day. An open account with no open date could be newer, so it makes the factor unknown.

**Card use.** Linked cards first (same number as the Strategy tab), else the credit file's number. Neither is used if it is older than the sequence. Over 30%: the date the saved payment plan says card use crosses 30%, if that plan was saved after the sequence. No plan, a plan from before the sequence, a plan that already missed its own date, or one that never gets there: unknown.

## Where it shows up (no screen work in this unit)

- **`POST /api/blueprint/staff-actions { action: "get_next_sequence_plan", client_id }`** → `{ ok, plan, summary }`. Staff roles, client in the staff member's org. Read only. `set_next_sequence_date` is unchanged.
- **`GET /api/money/banks`**: the field is **`next_sequence`**. It was `next_round`. **`next_round` is still sent, the same object, as an alias kept for one release** so the screen that reads it keeps working. Every field the screen reads is unchanged (`date` is still the staff date; `ready` still means a staff date with nothing left to do). Added: `suggested_date`, `effective_date`, `effective_source`, `suggestion` (the whole plan). If the suggestion's reads fail the page still loads and `suggestion` is null. A client's own read carries no `suggestion.flags` (they are commentary for staff). `POST` accepts `set_next_sequence_date`; `set_next_round_date` is its old name, kept for one release. `not_set` says "Next funding sequence date" (its key keeps the old spelling).
- **FinanceOS Plan tab** (`src/finance/plan-sources/funding-rounds.mjs`): with a staff date, one pin on that date (the staff date wins, and the file math is not read). With none, one planned pin on the suggested date, only for a Blueprint buyer when the answer is computed with no blockers. A date already passed pins on today. Past funding rounds still pin as "Funding round N".
- **Closer alert** (`blueprint-next-funding-sequence-sweeper`, daily 06:30 UTC, no new cron): pass 1 is the staff date (unchanged). Pass 2 covers funded Blueprint clients with no staff date: when the plan is `ready`, the closer gets "Next funding sequence — file is ready, close it". One task per FINISHED SEQUENCE (the key holds the last funded round, not the date), so a moving suggestion cannot alert twice and a later sequence earns its own alert. A partial answer or a blocker never alerts.

**A bug fixed on the way.** The staff-date task used a body that held a timestamp. That body is the dedupe key, so it changed every run and the closer got the same task every day. It is now a stable key.

## Declines (decline defense, `blueprint_declines`, migration 470)

An open reconsideration blocks. Declines that ended "still declined" or "re-apply later" ride in `declines.notes` through decline defense's own seam (`declineNotesForNextSequence`). They are notes. A re-apply day never sets this date (decline defense's own rule). If the table is not there yet, `declines.tracked` is false: not tracked, not "none open", not a blocker.

## Choices made (named, changeable)

- Inquiries gate on the bureau limits (under 3 / under 6). The 12-month "stop mattering" and 24-month "drop off" dates are shown per bureau and do not gate. To gate on "no inquiry in the last 12 months" instead, change `bureauPlan`.
- All three bureaus must be open, not just one.
- Card use counts linked cards of both kinds, the same number the Strategy tab uses.
- The engine's 24-month card rule is a note (`detail.estimate_counts_new_cards`), not a reason to wait.
- Not modeled: bank-by-bank spacing ("1 in 8", "wait 1-2 weeks"), and the bank relationship seasoning gaps (already on `next_sequence.readiness_gaps` against the date).

## Tests

`src/blueprint/next-sequence-{math,facts,plan}.test.mjs`, `src/http/blueprint-staff-actions-next-sequence.test.mjs`, and the renamed-words tests in `src/finance/bank-strategy.test.mjs`, `src/finance/plan-sources/w2-plan-sources.test.mjs`, `src/http/money-banks.test.mjs`. No migration.
