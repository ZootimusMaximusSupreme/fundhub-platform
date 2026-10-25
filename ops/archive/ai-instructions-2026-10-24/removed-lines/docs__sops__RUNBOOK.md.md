# Removed from `docs/sops/RUNBOOK.md` on 2026-10-24

Reason: decision #27, dedupe D218 and D219, stale S20 to S24. The morning pulse, hourly beats, texting window, production migrate, and live sending replace the old "nothing watches" and "nothing sends" claims. Headings, `/api/health?strict=1`, and the 503 note stay because `src/http/monitoring.test.mjs` reads them. Line 173 (`--secret` goes on anything holding a password. Always.) was not cut. D218 says that fight is phase 3 call #10.

## S20, opening (lines 7-13)

One thing to know before you start. Almost nothing in this system watches
itself. If the database stops answering at 2am, nothing sends an email, a text,
or a phone alert on its own. Someone finds out when they open the CRM in the
morning. [Monitoring](#monitoring) and [Alerting](#alerting) explain the one
check you can turn on in about five minutes. [What nobody is
watching](#what-nobody-is-watching) is the honest list of everything still
uncovered.

## S21, hardcoded migration counts

`{"ok":true,"db":"up","state":"up","migrations":69,"expected":69,"pending":0,"error":null,"checkedAt":"..."}`

"database is behind: 51 of 69 migrations applied, 18 pending"

There are 69 of them today.

**Nothing applies them automatically.** Not the deploy. There is no automated
build or test step in this project at all. Applying them is something a person
does by hand, every time new ones are added.

## Decision #27, line 129

**Claude cannot run this for you.** The company network blocks
`api.netlify.com` and `api.supabase.com` from the agent environment. Any attempt
fails immediately with a "403" refusal before it even connects. That is a policy
block, not a bug, and there is no way around it from there. A human on a normal
machine runs it.

Same network note as above: a human runs this, not Claude.

The 403 block on `api.netlify.com` and `api.supabase.com` for a hosted cloud session stays in the page. An agent on the Mac runs the command.

## D218, paste rule (lines 184-185)

- Never paste that value into a chat, a ticket, or a document. Confirm it by name
  only — "DATABASE_URL is set" — never by showing it.

Meaning now: secrets-env-law. Paste a value only when Chris asks.

## S22, monitoring opener

Right now nothing checks the site on a schedule.

## Decision #27 line 269 and S23

An email nobody reads at 2am is the same as no monitor at all.

Nothing else in this system alerts on anything. There is no error reporting and
no metrics. This one check is the whole of it, and it is not switched on yet.

There is no rota today and no agreed response time. The honest current answer to
"who gets called at 2am" is **nobody**.

Meaning now: texting-hours (6:00 a.m. to 10:00 p.m. Mountain Standard Time) and `docs/journeys/heartbeat-flow.md`.

## D219, on-call item 3

they are safe and they are reversible or additive. Two things must always wait for you, per
the project's own rules: anything that **deletes data**, and anything that
**points the site at a different database**. `INNGEST_EVENT_KEY` stays **ON
permanently** (owner-set 2026-08-20) — never disable it.

The owner-set date 2026-08-20 stays on the product-is-live pointer. The delete exception for proven test rows and test logins is the newer finish-the-answer line (owner-set 2026-10-24). "Rolling back a deploy and running the migrate command should both be on that list" stays.

## Decision #27 lines 308 and 328, and S24

**There is no monitoring and no alerting running today.** None. If something
breaks, the way it gets found is that a person opens the CRM and notices.

Specifically, none of this exists:

- **No alarms.** Nothing sends an email, a text, or a phone alert when anything
  fails. [Monitoring](#monitoring) and [Alerting](#alerting) are how you would
  add the first one.
- **No error collection.** When a screen fails for a user, nothing records it
  anywhere you can look later. You only learn about it if that person tells
  someone.
- **No speed or usage tracking.** Nobody can answer "was it slow this week" or
  "how many people used it". There is no data to answer from.
- **No automatic checks before a deploy.** Code goes live without anything
  verifying it first. There is no automated build or test step at all.
- **No automatic database updates.** Covered in [The database is
  behind](#the-database-is-behind). This is the single most likely thing to bite
  you, because everything looks fine when it happens.
- **Nobody on call.** See [On-call](#on-call).

**One more, and it is easy to misread.** This system does not send anything out.
No emails, no texts, no letters — not because something is broken, but by design.
Messages are written into a list and wait there. So "the emails stopped going
out" is not an outage you can fix from this page. Nothing was ever going out. Ask
before treating it as a fault.

Meaning now: heartbeat flow, `ship.yml` checks, production migrate (owner-set 2026-08-19), and product-is-live. Plaid affiliate payouts stay in test mode (owner-set 2026-10-21). An outside uptime monitor on `/api/health?strict=1` is still not set up. `pulse-outside-watch.mjs` watches the workflow engine. It does not poll that health address.
