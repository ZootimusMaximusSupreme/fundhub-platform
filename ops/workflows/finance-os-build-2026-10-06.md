# Finance OS — full build (2026-10-06)

Chris said go: "get it all done, including dashboard."
Direction: `docs/finance/finance-os-direction-2026-10-06.md` (wins) + `docs/finance/client-finance-os-build-spec-2026-09-19.md`.

Orchestrator: the main Claude session. It merges branches, regenerates journeys, ships, and runs the final live proof. Agents do NOT merge to main, push, ship, or run `npm run journeys`.

## Units

| # | Unit | Status | Migration # (if needed) |
|---|---|---|---|
| A | Plaid charges + deposits → `bank_transactions`, repeating bills, sandbox test bank v2 | claimed | 431 |
| B | Containers (business / personal) + billing count per container | claimed | 432 |
| C | Card due dates (Plaid liabilities) + reminder texts | claimed | 433 |
| D1 | Money overview read (`GET /api/money/overview`) + client can link a bank | claimed | 434 |
| D2 | The dashboard page `/app/money.html` | claimed | — |

All 5 run at once. The tables are the contract. D2 builds to the JSON contract below.

## Owner gaps (not blocking)

- Price per container: not set. Read from `FINANCE_OS_PRICE_PER_CONTAINER_CENTS`; unset = "price not set".
- Merchant processor: which one is not named. Merchant deposits show up as bank deposits through Plaid for now.
- Real banks: Plaid production access not granted yet.

## Contract — GET /api/money/overview

Client session: own file only (any `client_id` in the URL is ignored). Staff (owner/admin/sales_manager): `?client_id=` required, org-scoped.

```json
{
  "ok": true,
  "client": { "id": "uuid", "name": "Test Test" },
  "as_of": "ISO",
  "sandbox": true,
  "containers": [{ "id": "uuid|null", "kind": "personal|business|unknown", "name": "Fundhub LLC", "accounts": 2 }],
  "cash": {
    "personal": { "cents": 421055, "is_floor": false, "accounts": 1 },
    "business": { "cents": 1875000, "is_floor": false, "accounts": 1 },
    "unknown":  { "cents": null, "is_floor": false, "accounts": 0 }
  },
  "debt": {
    "total_cents": 672040, "is_floor": false,
    "by_kind": { "personal": 132040, "business": 540000, "unknown": null },
    "by_container": [{ "container_id": "uuid|null", "name": "Personal", "kind": "personal", "owed_cents": 132040, "is_floor": false }],
    "cards": [{ "account_id": "uuid", "name": "Business Amex", "mask": "4404", "container_id": "uuid|null", "kind": "business",
                "balance_cents": 540000, "limit_cents": 2500000, "room_cents": 1960000, "used_pct": 21.6,
                "due_on": "2026-10-21|null", "min_due_cents": 13500, "past_due_cents": null }]
  },
  "accounts": [{ "id": "uuid", "name": "Personal Checking", "mask": "1101", "type": "depository", "subtype": "checking",
                 "kind": "personal|business|unknown", "container_id": "uuid|null", "institution": "First Platypus Bank (Plaid sandbox — test data)",
                 "current_cents": 421055, "available_cents": null, "limit_cents": null, "provider": "plaid" }],
  "cashflow": {
    "has_transactions": true,
    "months": [{ "month": "2026-09",
                 "personal": { "in_cents": 500000, "out_cents": 310000 },
                 "business": { "in_cents": 1200000, "out_cents": 800000 },
                 "unknown":  { "in_cents": null, "out_cents": null } }]
  },
  "bills": [{ "name": "Rent", "amount_cents": 250000, "cadence": "monthly", "next_on": "2026-11-01", "kind": "personal", "container_id": "uuid|null" }],
  "upcoming": [{ "type": "card_due|bill", "name": "Business Amex", "on": "2026-10-21", "amount_cents": 13500 }],
  "billing": { "containers": 2, "price_per_container_cents": null },
  "tip": "engine sentence, verbatim, or null"
}
```

Rules: money is integer cents. Unknown = `null`, never 0. Cash is never added across kinds. Debt total may add across kinds.

## Manifests

(orchestrator fills these in from each agent's report)
