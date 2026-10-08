# Webhook doors

Lane: inbound webhooks only. Twilio status, Commas (Fanbasis), ClickFunnels, and calendar booking.

Calendar bookings come in on the ClickFunnels webhook. There is no second booking door.

## What this check does

It sends a GET. It does not send a webhook. It does not replay a payment.

401 or 405 means the door is there and it said no. That is a pass. 404 means the door is missing. That is a fail. Any other answer is a fail too. A webhook door must not look open on a GET.

Then it reads the database. It counts Commas inbox rows that are still failed after the sweeper has used all 10 tries. Those rows sit there. The sweeper will not pick them up again. Twilio status and ClickFunnels do not keep a failed queue. They answer inside the request.

## Checks

| id | what |
| --- | --- |
| webhooks:twilio-status | GET /api/webhooks/twilio-status |
| webhooks:commas | GET /api/webhooks/commas |
| webhooks:clickfunnels | GET /api/webhooks/clickfunnels |
| webhooks:calendar-booking | same ClickFunnels GET (booking posts land there) |
| webhooks:stuck-failed | commas_inbox status failed, attempts at the sweeper limit |

No fetch in the run skips the four doors. No database skips the stuck-row read. A skip is not a pass.

## One tripwire

Recon (AG-07) is the one tripwire. This check does not add a watcher. It does not restart the sweeper. It does not POST. It does not replay a payment.

## Files

- src/pulse/coverage/gap-webhooks.mjs
- src/pulse/coverage/gap-webhooks.test.mjs
