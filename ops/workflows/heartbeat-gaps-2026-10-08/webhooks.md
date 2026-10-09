# Webhook doors

Lane: inbound webhooks only. Twilio status, Commas (Fanbasis), ClickFunnels, and calendar booking.

Calendar bookings come in on the ClickFunnels webhook. There is no second booking door.

## What this check does

Two probes per door. It does not send a webhook. It does not replay a payment.

1. A GET to the live site. 401 or 405 means the webhook function is up. 404 means the whole `/api/webhooks/` prefix is gone. Anything else is a fail.
2. The webhook router, called inside the pulse. Empty body, no signature, no secrets, and a database that refuses every query. A mounted provider answers 401. A provider the router does not know answers 404. That 404 is the "door is missing" signal.

Why two: the live handler answers 405 to a GET before it reads the provider name. `GET /api/webhooks/does-not-exist-xyz` is 405 too. So the GET alone can never say a door is missing.

Then it reads the database. It counts Commas inbox rows the sweeper will never pick up again: status failed at all 10 tries, or status processing at 10 tries and older than 15 minutes. Twilio status and ClickFunnels do not keep a failed queue. They answer inside the request.

## Checks

| id | what |
| --- | --- |
| webhooks:twilio-status | live GET + router, provider `twilio-status` |
| webhooks:commas | live GET + router, provider `commas` |
| webhooks:clickfunnels | live GET + router, provider `clickfunnels` |
| webhooks:calendar-booking | same ClickFunnels door (booking posts land there) |
| webhooks:stuck-failed | commas_inbox failed, or processing and old, at the sweeper limit |

No fetch in the run skips the four doors. No database skips the stuck-row read. A skip is not a pass.

## One tripwire

Recon (AG-07) is the one tripwire. This check does not add a watcher. It does not restart the sweeper. It does not POST. It does not replay a payment.

## Files

- src/pulse/coverage/gap-webhooks.mjs
- src/pulse/coverage/gap-webhooks.test.mjs

## Review — Claude, 2026-10-08

What was wrong:

- The four door checks could never FAIL. I sent the same GET to `/api/webhooks/does-not-exist-xyz` on the live site. It answered 405, the same as the real doors. A missing door and a real door looked the same. Add the router probe above and a missing provider comes back 404.
- The stuck-row read missed a row left on `processing` at the 10 try limit. The sweeper never claims it again, and it was not counted because its status is not `failed`.
- A test banned the router from this file outright. That kept the check blind. I replaced the blanket ban with a narrow one: the router is named once, and the only call uses an empty body, no headers, no secrets, and a database that throws. The other bans (the Commas handler, the inbox worker, drain) stay.

Live result after (read-only, production): prod 5 PASS / 0 FAIL / 0 skip. Staff access gives the same. 0 SQL errors, 0 writes, only GET left the machine.

Proof the door check can fail: the real router answers 401 for all three providers and 404 for a provider that is not there. A test pins both. The stuck SQL was also run on a copy that pretends `done` is failed. It counted 36, so the columns and tests match real rows. There are no stuck rows today.

Not done, left for the owner to name (hard lock): other doors the router serves (Twilio inbound, Resend, Lendflow, Mailgun, PostGrid, Bland, Submagic) get no door check. Lendflow is the only source of the `round.*` events and was once unmounted without anyone knowing. The same one-line router probe would cover each of them.

One more fix: each live GET now has an 8 second abort. The lane runs as one pulse step with a 26 second ceiling, and a door that hangs would have killed the step instead of showing as a FAIL.

Tests: `node --test src/pulse/coverage/gap-webhooks.test.mjs` = 21 pass, 0 fail, 0 skipped.

### Second look — Claude, 2026-10-08 (a checker found more)

The checker agreed with the lane. One thing it flagged as medium: the first read-only test banned the router name everywhere, and the review loosened that to let the router probe run. That is a weaker test on its face. Here is why it stayed, and what was added so it is not weaker in practice:

- The lane was asked for a door check that can fail. A live GET answers 405 for any provider name, so only the router can say a door is missing. The blanket ban made the check blind.
- The first ban is now back, word for word, on the whole file minus the one pinned import and the one pinned call. Any other mention of a handler, the inbox worker, or a drain still fails.
- New proof the probe is safe. The real router is called with a database that counts every query. For the three doors it answers 401. For a door that does not exist it answers 404. The count of queries is 0. If the router ever starts touching the database before it checks the signature, that test fails. Before, the database only threw, which a router could swallow and hide.

Kept on purpose, both low:

- `webhooks:commas` overlaps `payments:commas-webhook-route`. The webhooks lane prompt names Commas as in scope, so both stay. One missing door shows as two red rows.
- `webhooks:calendar-booking` is the ClickFunnels door. The prompt names it. One missing door shows as two red rows.

Live result now (read-only, production): prod 5 PASS / 0 FAIL / 0 skip. Staff access gives the same. 0 SQL errors, 0 writes. Only GET left the machine.

Tests: `node --test src/pulse/coverage/gap-webhooks.test.mjs` = 23 pass, 0 fail, 0 skipped.
