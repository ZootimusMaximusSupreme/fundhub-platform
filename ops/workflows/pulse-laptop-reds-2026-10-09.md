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

## Open owner decision (red 7 / F4)

`/order` is a native ClickFunnels page. Drafts are built and never pushed (`marketing/landing-pages/slo/preview/order-price-draft.html` red, `order-price-fixed.html` green, `order-price-clean.html` live-ready). Chris picks: change `/order` to $147 (match the till), or take `/order` down.
