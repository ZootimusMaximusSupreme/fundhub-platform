# Fundhub merchant open API

Send your sales, refunds, fees and payouts from any merchant processor into your Fundhub Finance OS. Fundhub only reads them. It never moves money.

Built 2026-10-06, unit P3 of `ops/workflows/finance-os-pages-2026-10-06.md`. Code: `api/merchant/events.mjs`, `src/merchant/normalize.mjs`, `src/merchant/store.mjs`. Tables: `db/migrations/442_merchant_connections.sql`.

## 1. Get a key

Open `/app/money-connections.html`, pick the business, and click **Connect Open API**. The key starts with `fhm_`. It is shown **one time**. Fundhub keeps only a scrambled copy (sha256) and cannot show it again. If you lose it, turn that connection off and make a new one.

One key = one business container. Everything sent with that key lands in that business.

## 2. Send events

```
POST https://fundhub.ai/api/merchant/events
Authorization: Bearer fhm_…
Content-Type: application/json

{
  "events": [
    { "id": "ch_1001", "kind": "sale",   "amount_cents": 49700, "currency": "usd",
      "occurred_at": "2026-10-03T15:04:00Z", "description": "Coaching package" },
    { "id": "rf_88",   "kind": "refund", "amount_cents": 9700,
      "occurred_at": "2026-10-04T10:00:00Z" },
    { "id": "po_12",   "kind": "payout", "amount_cents": 120000,
      "occurred_at": "2026-10-05T00:00:00Z", "description": "Weekly payout" }
  ]
}
```

One event object without the `events` wrapper also works. Up to 100 events per call.

| Field | Required | Meaning |
|---|---|---|
| `id` | yes | Your processor's id for this event, up to 200 characters. Sending the same `id` again is safe: it is stored once. |
| `kind` | yes | `sale`, `refund`, `fee`, or `payout` |
| `amount_cents` | yes | Whole number in the currency's smallest unit (cents for usd). A sale cannot be negative. For refunds, fees and payouts, send the amount as positive or negative — Fundhub stores it as money going out. |
| `currency` | no | 3-letter code, default `usd`. Only usd is added into the monthly totals today; other currencies are stored and counted separately. |
| `occurred_at` | yes | ISO 8601 date and time the money moved. |
| `description` | no | Up to 500 characters. |
| `reversed` | no | Only for a `payout` that was sent back to your processor balance: `true` stores it as money coming back. |

## 3. Answers

| Status | Body | Meaning |
|---|---|---|
| 200 | `{ ok: true, inserted, duplicates, rejected, errors }` | Good events saved. `duplicates` were already here. `errors` lists bad events by `index` with the reason; those were not saved. |
| 400 | `{ ok: false, error }` | The body was not JSON, was empty, had more than 100 events, or every event was bad. |
| 401 | `{ ok: false, error: "missing_api_key" \| "invalid_api_key" }` | No key, a wrong key, or the connection was turned off. |
| 405 | | Only POST is allowed. |

## 4. How it shows up

`GET /api/money/connections` returns `summary` — month over month, per business:

- **Sales** = sum of sales
- **Refunds**, **Fees**, **Paid out** = money that left, shown as positive amounts
- **Net** = sales − refunds − fees. Payouts move money to your bank; they are not taken out of net.

## Whop and Commas

Whop and Commas do not use this API. They post signed webhooks to a per-connection address shown on the Connections page:

- Whop: `/api/webhooks/merchant-whop/<connection id>` — Standard Webhooks signature (`webhook-id`, `webhook-timestamp`, `webhook-signature`), checked with the `ws_…` secret Whop gives you. Events kept: `payment.succeeded` (sale, plus Whop's fee), `refund.created` / `refund.updated` once `status` is `succeeded`, `payout.created` / `payout.updated` once `status` is `completed`, and `payout.reversed`. Source: https://docs.whop.com/developer/guides/webhooks
- Commas: `/api/webhooks/merchant-commas/<connection id>` — `x-webhook-signature` HMAC-SHA256 of the raw body, checked with the Commas signing secret you paste in. Events kept: succeeded payments and subscription renewals (sale) and refunds.

Paste the signing secret the processor shows you into the Connections page. It is stored encrypted (`MERCHANT_SECRET_ENC_KEY`), never in plain text.
