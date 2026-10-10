# Laptop reds vs live reds — 2026-10-09

`npm run pulse:prove` on the Mac reads the Mac's masked `.env`. Some of its reds are the laptop's copy, not the live site.

## Measured (read-only) against this morning's live scorecard, 2026-10-09 6:01 a.m. Arizona

| Prove run on the Mac said | What the live server said | Verdict |
|---|---|---|
| `brain:embed-key` red (OPENAI_API_KEY is a mask) | green: "set and is not a mask" | laptop mask only. Key not touched. |
| `opt-out:unsubscribe-link` red (UNSUBSCRIBE_TOKEN_SECRET) | green: "can be signed, put in the footer, and checked" | laptop mask only. Key not touched. |
| `gap-outside-inngest:outside:inngest-crons-stale` red | green at 6 a.m. (288 runs each, longest quiet 8 min) | the 6 a.m. read ended before the gap the Mac saw (2:05 to 2:51 p.m. Oct 9). Not judged yet. |
| `gap-funnels:funnel:order-price-matches-till` red | red | REAL. /order charges $297, the till says $147. |
| `calls:booked-no-join-link`, `fulfillment:next-action`, `repair-letter-round`, `portal:paid-client-never-signed-in` | red | REAL (already on fix-batch-2026-10-09). |

## Done 2026-10-10 (red 7 / F4): /order now charges $147

Owner call already on record in `order-price-draft-build.mjs` ("the roadmap is $147 now, the price was lowered, that is fine"). Chris said finish.

- ClickFunnels price `5157777` (product `1035377`, Complete Funding Diagnostic): amount `297.00` -> `147.00`, name `One-time $297` -> `One-time $147`, by API (`PATCH /api/v2/products/prices/5157777`, key from `.env`, never printed).
- Proved: live `https://apply.fundhub.ai/order` now embeds `"price_cents":14700` in all 45 places and none at 29700. The page took a few minutes to refresh. `pulse:prove` no longer lists `funnel:order-price-matches-till`.
- Undo: same call with `{"products_price":{"amount":"297.00","name":"One-time $297"}}`.
- Left: the line "Secure checkout — $297 one-time." and the product's `seo_description` still say $297. They are builder text, not reachable by the API. The native /order page is old and not the sales path (`/roadmap` is).
