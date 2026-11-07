# repair letter send — actual

What the code **does** today when a staff member presses send on a repair
dispute letter, and what now stops the same letter going out twice. Traced from
`src/repair/send.mjs`, `src/repair/analyze.mjs`, `src/metro2/delivery/send.mjs`,
`src/messaging/providers/mail-letter.mjs`, `src/lib/outbound-fetch.mjs` and
`db/migrations/332`, `333` and `334` on branch `feat/portal-schema` — not from a
spec.

**A human still presses send.** `src/metro2/delivery/send.mjs:3` and
`api/repair/send.mjs:3` both forbid mailing from `payment.received`. Nothing in
this change touches that.

## CORRECTION — what the first version of this page got wrong

The version of this page written with `db/migrations/332` said a send that
failed left the letter "claimed, for a human to reconcile — a support ticket".
**Both halves of that sentence were untrue.**

1. It was not only a failed *send* that did it. 332 stamped `mailed_at` at
   **claim** time, before the provider was called at all. So a send the outbound
   dry-run fence held — where nothing was transmitted and a transport rigged to
   throw was never reached — left the letter marked as mailed.
2. There was no human who could reconcile it, and **the damage was not limited
   to that one letter**. A brand-new replacement letter for the same case,
   bureau, round and destination was refused too, because the unique index
   counted the false stamp. Nothing in the repository could clear either. The
   letter and every future replacement for it were dead.

Measured on a scratch Postgres on 2026-09-05, three presses, with a transport
that throws if it is ever reached (it never fired):

| press | what happened | mailer calls |
|---|---|---|
| 1 — fence held the call | row became `sending`, `mailed_at` **stamped** | 0 |
| 2 — same letter, fence off | refused `already_mailed` | 0 |
| 3 — a brand new replacement row | refused `already_mailed_duplicate_letter` | 0 |

`db/migrations/333` is the repair. The rest of this page describes what the code
does **after** it.

## CORRECTION 2 — what the 333 version of this page got wrong

The version written with `333` said the clear "cannot turn a letter that really
went out into one that may go out again". **It could**, and this is the mirror
image of the fault above: 332 could destroy a letter that never sent; 333 could
mail twice a letter that did.

The guard was the pair of columns `mailed_at` and `postgrid_letter_id`, and both
stayed empty on a **successful** mailing whenever the provider answered `200`
with no id in the body. `src/repair/send.mjs` wrote the mailing only
`if (letterId && providerId ...)`, and
`src/messaging/providers/mail-letter.mjs:259` returns
`{ ok: true, providerId: raw.id || null }` — so an empty or non-JSON `200` body
gave `ok: true` with a null id and the entire write-back was skipped. The same
`.catch(() => {})` on that write turned any momentary database error into the
identical state, silently.

Measured on a scratch Postgres on 2026-09-05, before the fix:

| press | what happened | mailer calls |
|---|---|---|
| 1 — provider answered 200, no id | `ok: true`, row left `sending`, `mailed_at` **NULL**, claim held | 1 |
| — | the row was **listed to staff as a stuck claim** | |
| — | `clearStuckSendClaim` **succeeded**, status back to `ready` | |
| 2 — same letter | mailed **again** | 2 |

A second envelope to a real person, and a second bill.

**The fix is that transmission is the fact and the id is only metadata.** The
mailing is recorded whenever the provider **accepted** the letter, id or no id;
`postgrid_letter_id` stays nullable, because a missing id is *unknown*, not
"this did not happen". The write-back is retried once and, if it still fails,
logged and returned instead of swallowed. `db/migrations/334` puts the
"you cannot un-mail a letter" rule in the database itself. The one case none of
that can cover is written out below under *Clearing a stuck claim*.

## The send loop

```mermaid
flowchart TD
    POST([Staff presses send<br/>api/repair/send.mjs]) --> GATE{"mail = true?"}
    GATE -->|No| REF1["refused: no_channel<br/>a human must press send"]
    GATE -->|Yes| EACH["for each letter in the payload"]

    EACH --> ROUTE["resolve the destination<br/>bureau / furnisher / CFPB / state AG"]
    ROUTE --> ADDR{"Is there an address?"}
    ADDR -->|"no state AG address on file"| REF2["refused: ag_postal_address_unknown<br/>no send, no filing row"]
    ADDR -->|Yes| CLAIM

    CLAIM{"CLAIM the letter<br/>UPDATE dispute_letters<br/>SET status='sending', send_claimed_at=now()<br/>WHERE send_claimed_at IS NULL AND mailed_at IS NULL<br/>AND status NOT IN (sending, sent, delivered)"}

    CLAIM -->|"0 rows, and the row carries a mailing<br/>or is already sent / delivered"| REF3["refused: already_mailed<br/>permanent — nothing releases this"]
    CLAIM -->|"0 rows, and the row holds a claim<br/>with no mailing behind it"| REF5["refused: send_claim_held<br/>NOT permanent — a human can clear it"]
    CLAIM -->|"unique violation on<br/>uq_dispute_letters_one_send_claim"| REF4["refused: already_mailed_duplicate_letter<br/>a different row for the same case,<br/>bureau, round and target holds the claim"]
    CLAIM -->|"0 rows and no such letter row exists"| SEND
    CLAIM -->|"claimed"| SEND

    SEND["mailBureauLetter → sendLetter<br/>POST PostGrid /letters"]

    SEND -->|"ACCEPTED — ok:true, id or NO id"| MARK["status = 'sent'<br/>mailed_at = now() — stamped HERE, on acceptance<br/>postgrid_letter_id = the id, or stays NULL = unknown"]
    SEND -->|"NOTHING WAS TRANSMITTED<br/>preTransmission = true from the mailer,<br/>or the error text matches the fallback list"| REL["RELEASE the claim<br/>status back to what it was<br/>send_claimed_at = NULL<br/>mailed_at untouched (and NULL)"]
    SEND -->|"anything else<br/>(HTTP error, timeout, dropped socket)"| STUCK["claim KEPT, status stays 'sending'<br/>we do not know whether it went,<br/>so nothing auto-retries it"]
    SEND -->|"the mailer answered neither ok nor an error"| STUCK

    MARK --> WROTE{"did that write succeed?"}
    WROTE -->|"yes — the normal case"| CLOCK
    WROTE -->|"no, twice over"| UNREC["mailingRecorded: false on the result<br/>+ unrecordedMailings on the send<br/>+ console.error DO NOT RE-SEND IT<br/>THE ROW STILL LOOKS CLEARABLE — reconcile by hand"]
    UNREC --> CLOCK
    CLOCK["dispute_cases.response_due_at = now() + 30 days<br/>only when it was NULL"]
    CLOCK --> EV[["event: repair.letters.sent"]]
    STUCK --> HUMAN["listStuckSendClaims → a staff member checks<br/>the provider's own record"]
    HUMAN --> CLEAR["clearStuckSendClaim(staffId, reason)<br/>status back to 'ready', claim released,<br/>who / when / why written to the row<br/>and to repair_decision_log"]
    CLEAR --> POST
```

## Was anything actually transmitted? The fact, then the strings

This one decision is the whole guard. Wrong one way, a real person gets two
identical dispute letters and we get two bills. Wrong the other way, a send that
never happened destroys the letter and every replacement for it.

`src/lib/outbound-fetch.mjs` — the single place an outbound request is made —
now returns `transmitted` on every result. It is **proven by control flow, not
guessed from a status code**: every `false` is returned from a branch that sits
above the `fetch` call.

* `transmitted: false` — the dry-run fence held it, no fence was declared, or
  there is no fetch implementation. Nothing left this process.
* `transmitted: true` — a request was started. A timeout and a dropped socket
  are **both** `transmitted: true` with `status: 0`, because the vendor may have
  accepted the work before the connection died.

`src/messaging/providers/mail-letter.mjs` carries that up on every failure as
`preTransmission`, and `src/repair/send.mjs` reads it before it reads any
message text. Under 332 it read only the text, against a list of eight fixed
strings, and the fence's wording was not on the list.

**The live route now carries the flag.** The `mailSender` closure in
`api/repair/send.mjs` used to rebuild the mailer's result as
`{ ok, outcome, error }` and drop everything else, so the one path a staff
member actually presses decided on the error text alone. It now passes
`preTransmission` through exactly as the provider gave it, including absent —
absent stays absent, because defaulting it to `true` would hand back the claim
on a letter nobody can prove did not go out.

**The string list still exists, on purpose.** `mailBureauLetter`'s own address
refusals (`src/metro2/delivery/send.mjs:139`, `:158`, `:162`) are plain objects
that never carried the flag, and `createFakeMailLetterProvider`'s failure return
(`src/messaging/providers/mail-letter.mjs:342`) does not either. Those are
genuinely pre-transmission and the list is what still catches them. Delete the
list and they start keeping claims they should release; trust the list alone and
the 332 bug comes back.

## Two facts, two columns, two indexes

| | `send_claimed_at` | `mailed_at` |
|---|---|---|
| means | this row is **taken** | this row **was mailed** |
| stamped | before the provider is called | after the provider **accepted** the letter — `ok`, with or without an id |
| released automatically | yes — when nothing was transmitted | **never** |
| released by a human | yes — `clearStuckSendClaim`, on the record | **never, by anybody** |
| its unique index | `uq_dispute_letters_one_send_claim` | `uq_dispute_letters_one_mailing` |

Both indexes are partial, over `(org_id, case_id, bureau, round, target)`. The
claim index is a deliberate **superset** of the mailing index — a mailed row
keeps its claim, enforced by `dispute_letters_mailed_implies_claimed_ck` — which
is what lets a regenerated replacement for an already-mailed letter be refused
at **claim** time, before the call, rather than by a unique violation after the
envelope is in the post.

## Clearing a stuck claim, and what it cannot do

`clearStuckSendClaim(db, {orgId, letterId, staffId, reason})` in
`src/repair/send.mjs`. `listStuckSendClaims(db, {orgId})` is the read a screen
would list first.

It refuses unless all of these hold: the row is `sending`, it holds a claim, it
carries **no** `mailed_at`, it carries **no** `postgrid_letter_id`, and the claim
is at least **15 minutes** old (the transport's own hard timeout is 10 seconds,
so this cannot race a call that is merely slow). A staff id and a written reason
are both required and both stored on the row, and a
`repair.letter.send_claim_cleared` entry goes to `repair_decision_log`, which
`src/repair/lens.mjs` renders in plain English.

It clears `send_claimed_at` only. It never touches `mailed_at`.

**The database enforces that, not just the reads above.** Three constraints, and
a hand-written `UPDATE` hits them exactly as this function would:

* `dispute_letters_mailed_implies_claimed_ck` (333) — `send_claimed_at` cannot
  go back to NULL while `mailed_at` is set.
* `dispute_letters_no_clear_after_mailing_ck` (334) — a clear cannot be stamped
  at or after a mailing time. It is an ordering rule, not a flat ban: cleared at
  T1, re-sent, mailed at T2 is the legitimate happy path and stays legal.
* `dispute_letters_no_clear_after_provider_id_ck` (334) — a clear cannot be
  stamped on a row that carries a provider id with no mailing time behind it.

**THE HOLE THAT IS LEFT, and it is real.** All of that depends on the row saying
the letter was mailed. If the write-back in `sendRepairLetters` could not be made
— the database was unreachable for both of its two attempts — nothing in the
table knows an envelope went, so nothing in the table can refuse a clear, and the
letter can go out a second time. That case is no longer silent: it is logged as
`MAILING NOT RECORDED — ... DO NOT RE-SEND IT`, returned on the letter's own
result as `mailingRecorded: false`, and collected on the send's
`unrecordedMailings`. A letter named there must be reconciled against the
provider, never re-sent. **Nothing reads `unrecordedMailings` yet** — it reaches
the HTTP response body and the function log and stops there.

**A second way it can be wrong, and that one is accepted.** If the letter did
reach the provider and only the reply was lost — a timeout, a dropped socket —
`ok` was never `true`, so no mailing is recorded, and clearing lets a second one
go out. That is why the clear is deliberate, attributed and recorded, and why
nothing calls it on a timer.

**NOT WIRED TO A SCREEN YET.** Both functions are exported and proved by test,
and there is no HTTP route and no button. Until one exists a staff member cannot
reach this without a developer. See the handoff in the task report.

## Re-staging a round does not route around any of this

`src/repair/analyze.mjs` treats a letter in `generated`, `ready`, `queued`,
`sending`, `sent` or `delivered` as already staged. `sending` and `delivered`
were missing, so a re-stage of a round whose letter held a claim did not report
the round as already staged — it wrote a **second** `dispute_letters` row, which
the claim index then refused at send time. Re-staging was never a way out of a
stuck claim; it just made another dead letter. The way out is
`clearStuckSendClaim`.

## Why the claim happens before the provider call

`src/repair/send.mjs` used to set `status = 'sent'` after the mailer returned,
with no check of the current status, and `dispute_letters` carried no unique
index of any kind. Re-POSTing the same payload therefore mailed the same letters
again: two envelopes to the consumer, two to the bureau, two PostGrid bills. The
only thing in the way was a disabled button in a browser, which a retry, a
second tab or `curl` walks straight past.

Claiming after the call would not fix it, because two callers can both finish a
`SELECT` before either reaches its `UPDATE`. The claim is one statement, it runs
before anything is transmitted, and Postgres decides who wins.

## What NULL means here

* `dispute_letters.mailed_at` **NULL** — **not mailed.** That covers a claim in
  flight, a claim that died above the network, a claim a human cleared, and
  every row predating `db/migrations/332`. Never backfilled to a guessed value:
  the only write to this column in `333` is the `NULL` that undoes 332's false
  stamps on rows still sitting in `sending`.
* `dispute_letters.send_claimed_at` **NULL** — free to claim. Says nothing about
  whether anything was mailed; that is `mailed_at`.
* `dispute_letters.postgrid_letter_id` **NULL** — **UNKNOWN**, never "not
  mailed". The provider can accept a letter and answer with no id, and a row
  with `mailed_at` set and this column NULL is exactly that letter. The
  write-back `COALESCE`s it, so a later null can never wipe an id an earlier
  write already got.
* `dispute_letters.mail_cost_cents` **NULL** — UNKNOWN. It is not "free".
  **Nothing writes this column yet**; reading a price off the provider response
  is a later change.

## Still unguarded, on purpose

A letter posted with **no `letterId`** has no row in `dispute_letters` to claim,
so nothing stops a second one. That is unchanged behaviour, not a new hole:
`src/repair/send.mjs` has always accepted an ad-hoc `{bureau, html}` letter with
no stored row. The guard covers every letter the system generated.

## The schema behind the portal's paid round

`db/migrations/330` and `331` add the two tables the self-serve round sits on.
No endpoint reads them yet.

```mermaid
flowchart LR
    W["client_waypoints<br/>ordered checklist per client<br/>owner_kind: client | fundhub<br/>state, due_at, completed_at<br/>paid_alternative_price_cents"]
    P["paid_service_requests<br/>one row per 'do it for me'<br/>priced line items + total<br/>idempotency_key<br/>round_no"]
    R["repair_programs.rounds_cap<br/>rounds the client BOUGHT<br/>with their program"]

    W -->|"waypoint_id"| P
    P -. "no column, no join, deliberately" .- R
```

* **Overdue is a computed fact**: `due_at < now() AND state NOT IN (done,
  skipped)`. A NULL `due_at` means nobody set a deadline, and is never overdue.
* **`paid_alternative_price_cents` NULL** means no paid alternative exists. A
  CHECK refuses `0` outright, so nothing can read a zero and call it free.
* **A paid round does not consume a purchased round.** `round_no` on
  `paid_service_requests` is the self-serve counter;
  `repair_programs.rounds_cap` is the program counter. There is no column
  joining them, which is the enforcement.
* **A double press is one row**, adjudicated by
  `uq_paid_service_requests_idem (org_id, idempotency_key)` — the same partial
  unique index `events` and `soft_pull_requests` already use.

## Proven by

* `src/repair/send-double-mail.pg.test.mjs` — 12 tests on a real Postgres: the
  same payload twice makes one mailer call and one letter row; a duplicate row
  is refused; a pre-transmission refusal releases; a possibly-transmitted call
  keeps the claim; **a send the outbound fence held releases and the letter then
  really mails**; **a replacement letter claims after a released one**; **two
  simultaneous presses on one letter call the mailer exactly once**, and two
  simultaneous presses on two duplicate rows also mail once; **a stuck claim is
  cleared by a named human and the letter is sendable again**; clearing is
  refused on a letter that really was mailed; and the database itself refuses to
  release a mailing.
* `src/repair/analyze-restage-claim.pg.test.mjs` — a re-stage sees a letter stuck
  on `sending`, and one that is `delivered`, and writes no second row for either.
* `src/repair/send-guard.test.mjs` — the fact beats the string list in both
  directions, and the list still catches the chokepoint's own refusals.
* `src/lib/outbound-fetch-transmitted.test.mjs` — a fence hold, an unrecognised
  fence and a missing fetch implementation all report `transmitted: false`; a
  completed request, a thrown transport error and a timeout all report `true`.
* `src/messaging/providers/mail-letter.test.mjs` — every refusal above the
  network says `preTransmission: true`; an HTTP failure and a dropped connection
  say `false`.
* `src/repair/send-claim-migration-order.test.mjs` — `333` drops 332's claim
  CHECK **before** the backfill clears `mailed_at`. Written after the original
  order failed to apply to a database holding a stuck row.
* `src/waypoints/store.pg.test.mjs` — NULL price survives, `0` is refused, a
  receipt that does not add up is refused, a double press is one row, the
  program cap does not move.
* `src/waypoints/pricing.test.mjs` — $100 / +$10 / +$20 in integer cents.

## A second claimer: the client's paid $97 mailing (unit MAIL, branch candidate, not live)

Source: branch `claude/fos-mail-repair-letters-20261107`, migration 591 (not applied anywhere yet).
A Blueprint client can now pay the existing $97 batch mailing for a repair
round's bureau letters (`src/blueprint/letter-mailing.mjs`). That path takes a
`dispute_letters` row with the same claim this page describes — `status =
'sending'`, `send_claimed_at` stamped, only from `generated` or `ready`, never
with `mailed_at` set — inside the same transaction as its own envelope claim, and
also requires the dispute authorization SQL this send loop uses
(`currentRepairMailAuthorizationSql`). So whichever path claims first wins: a
staff press on a letter the client's paid mailing holds is refused
`send_claim_held` or `already_mailed`, and a paid mailing on a letter staff
already claimed holds its order for review instead of mailing.

Unlike this loop, it does not call the letter mailed when PostGrid accepts it
(Codex CX28). On acceptance it only COALESCEs `postgrid_letter_id` (so PostGrid's
delivery webhook finds the letter) and leaves the letter `sending`: the mail
house has it, but it is not in the mail yet. `listStuckSendClaims` skips a
letter that carries a PostGrid id, and this page's 334 provider-id rule refuses
a clear on it. The mail tracker writes `status = 'sent'` and `mailed_at` only
when PostGrid reports `processed_for_delivery` (handed off to the post office)
or the later `completed`, dated by that report or an earlier post office scan;
the round's items and the case move then too, and `repair.letters.sent` fires
then. It also does not start the bureau's 30-day clock on mailing: the bureau's
30 days start when the bureau gets the letter (Codex CX27). The mail tracker
sets `response_due_at` to PostGrid's expected delivery date (its "completed"
date) + 30 days when that date first lands, and only when the case has none.
A send PostGrid never received releases the letter (the 333 rule); an unknown
outcome keeps the claim. Migration 591 adds one database rule here: a
`clearStuckSendClaim` is refused while the paid mailing's envelope is `sending`
or `accepted`. An envelope held for review stays clearable by a person after
checking PostGrid's own record, exactly like a stuck staff claim. The desk check
`fin-b07-row-send` leaves such a letter to `blueprint:letter-mailing` while its
accepted envelope waits on the handoff or the expected delivery date.
