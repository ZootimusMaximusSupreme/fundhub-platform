# SLO offer — actual (first slice)

Generated from the code in this worktree. Not from the spec.

Public folder is `public/roadmap/`. Since 2026-10-02 `fundhub.ai/roadmap`, `/roadmap/`, `/roadmap/index.html` and `/slo` 301 to the live sales page `https://apply.fundhub.ai/roadmap` (netlify.toml, query kept); `pay.html` and `pull.html` still serve. On apply.fundhub.ai the page itself rewrites `/roadmap/` to `/roadmap` before any tracking loads (`marketing/landing-pages/slo/slo-canonical-head.html`). APIs stay `/api/public/slo-*`. The live pages do not use a new product name.

## What the code does

```mermaid
flowchart TD
  S["/roadmap/ — sales page public/roadmap/index.html"] -->|every CTA| P["/roadmap/pay.html — email required, first + last optional"]
  CF["apply.fundhub.ai/roadmap — ClickFunnels custom HTML page 25516164 (funnel Fundhub $297 Roadmap), clickfunnels-fragments/slo/slo-01-sales.html"] -->|"every CTA scrolls to the checkout part #fh-order"| CFB["Checkout box: Get My Roadmap · $297"]
  CFB -->|"https://fundhub.ai/roadmap/pay.html + first-touch utm_* from the page"| P
  S -. fills every price slot .-> A
  P -. fills price + server notices .-> A
  A["GET /api/public/slo-checkout"] --> B["Price $297, next /roadmap/pull.html"]
  P -->|"valid email"| C
  P -->|"empty / bad email"| P
  P -->|"checkout.ready false"| PAUSE["'Checkout is paused' — button hidden, nothing charged"]
  C["POST email, first_name, last_name, utm_*"] --> D["Find or create client + portal account"]
  D --> ATTR["First-touch UTMs onto client_ad_attribution"]
  ATTR --> E["Mint Commas $297 Assessment"]
  E --> F["payment_links purpose=diagnostic"]
  F --> G["success_url = /roadmap/pull.html?ref + client_id"]
  E --> EMB["Mint embedded session on the same Commas session"]
  EMB -->|"/roadmap widget: card typed on the page"| CARDIN["Commas card form inside step 2 — no navigation"]
  E -->|"/roadmap/pay.html only: https checkoutUrl"| CARD["location.assign(checkoutUrl) — Commas card page"]
  E -->|"checkout_failed / 503 / network"| PFAIL["Stay on /roadmap/pay.html — 'Nothing was charged'"]
  CARDIN -->|"checkout:success"| G
  CARD -->|paid| G
  G --> H["public/roadmap/pull.html"]
  H -->|"Build My Pack"| I["POST /api/public/slo-pull"]
  I -->|"ref + client_id match"| J["store identity + checkbox consent + diagnostic.paid"]
  I -->|"naked client_id or unknown ref"| K["404 not_found"]
  J --> L["C-00 CRS pull"]
  L --> M["analysis.completed"]
  M --> N["slo-pack-delivery if slo_ref"]
  N --> O["Gold HTML pack saved: 4 analysis pages + Business Duplication Map, + EMAIL-U02-ANALYZER-FUNDING-DELIVERY"]
```

## Traced paths

- `clickfunnels-fragments/slo/slo-01-sales.html` (live at https://apply.fundhub.ai/roadmap) — every CTA is
  `href="#fh-order"` and a click handler scrolls to the checkout section. The checkout box `#fh-pay-go` links to
  `https://fundhub.ai/roadmap/pay.html`; on load and on press it adds the five `utm_*` tags from the page's own
  `fh_attribution` session store (first touch, written by `fh-attribution.js`) or from the page URL, because a
  session store on apply.fundhub.ai is not readable on fundhub.ai. `landing_path` and `referrer_domain` are not
  carried across; pay.html records its own. The box holds no form fields and collects nothing itself.

- `api/public/slo-checkout.mjs` — mint + write a diagnostic payment link so the existing Commas adapter emits `diagnostic.paid`.
  **Since 2026-09-29** it also mints an embedded checkout session on that same Commas session
  (`POST /public-api/checkout-sessions/embedded`) and answers an `embedded` block — `creatorId`, `productId`,
  `sessionSecret`, `environment`. The /roadmap widget draws Commas' own card form from it on step 2, so the buyer
  types the card without leaving the page. Commas publishes no endpoint that accepts a card number, so none is
  ever posted to Fundhub. `checkoutUrl` is still answered and still written to `payment_links` — the webhook is
  matched to that row, and `public/roadmap/pay.html` is the one door that still navigates to it.
- `api/public/slo-pull.mjs` — POST only. Matching `ref` + `client_id` required. Server stores `soft-pull-v3` consent text (`ROADMAP_SOFT_PULL_VERSION`, "Fundhub LLC", since 2026-10-02; other consent screens still store v2). Then `diagnostic.paid`.
- `src/slo/buyer.mjs` — client, portal account, `slo_ref` stamp.
- `src/handlers/payment-links.mjs` — a signed checkout receipt must match the saved link's buyer, invoice, and link ID when those IDs are present. A `slo_` link opens paid access only when the captured amount covers its saved `amount_cents`; a smaller receipt leaves the link open.
- `src/slo/deliver.mjs` — same UnderwriteIQ funding pack and email the closer deck uses. The four analysis docs are the gold HTML pages (`src/deliverables/`), not the short PDFs. Since 2026-10-02 the pack also carries the free bonus, the Business Duplication Map (`src/deliverables/business-duplication-map.mjs`), saved as its own `business_duplication_map` document — see `docs/journeys/business-duplication-map-flow.md`.
- `src/workflows/slo-pack-delivery.mjs` — on `analysis.completed`, only if `slo_ref` is on the client.
- C-00 / C-06 / U-03 / U-04 are unchanged. ClickFunnels adapter is unchanged.
- `public/roadmap/index.html` — sales copy verbatim from `clickfunnels-fragments/slo/slo-01-sales.html`. Every
  price slot filled from GET `priceDisplay`; none typed. Cut: the layout-preview sample results, the empty
  result placeholders, and the video player (`funnel/slo-vsl.mp4` is 404). A failed price read shows a dash
  and a line saying the exact price is on the next page. Every call to action goes to `/roadmap/pay.html`.
- `public/roadmap/pay.html` — email required before any POST. Leaves only for an `https` `checkoutUrl` the server
  returned. The charge / soft-pull / keep lines are the server's `notices`, plus "We do not sell your data."
  Every failure path says nothing was charged. Back link is `/roadmap/`. Pay POST also sends the five `utm_*`
  tags plus `landing_path` and `referrer_domain` from hidden fields the existing catcher stamps
  (`clickfunnels-fragments/06-utm-hidden-fields.html` / `public/funnel/fh-attribution.js`). First touch is
  written onto the client (`client_ad_attribution` + custom fields). No email guessing beyond find-or-create.
- `public/roadmap/index.html` and `pay.html` load `/funnel/fh-attribution.js` so an ad link to `/roadmap/`
  keeps `utm_content` (ad id) through checkout. Pull form does not; the tags are already on the file.
- ClickFunnels paste of `clickfunnels-fragments/slo/slo-01-sales.html`, `slo-02-order.html`,
  `slo-03-thank-you.html` loads the same script from `https://fundhub.ai/funnel/fh-attribution.js`.
  Sales and thank-you also load the VSL watch beacon. A third funnel is not built yet.
- `public/roadmap/pull.html` — reads `?ref=` and `?client_id=`. Submit POSTs `/api/public/slo-pull`, then clears SSN.
- `clickfunnels-fragments/slo/slo-02-booking.html` (live at https://apply.fundhub.ai/roadmap-book, CF page
  25516165) frames https://apply.fundhub.ai/funding-book-call in `#fh-book-frame`. That native calendar page
  (CF page 25062844) carries `clickfunnels-fragments/04c-book-framed.html` in its head code: only when it is
  inside a frame, it hides its own hero, logo, marquee and footer, hides the scheduler's big logo, and posts
  `fh-book-height` to https://apply.fundhub.ai. The booking page sets the frame to that height (never under
  600px). Once the visitor has touched the calendar, picking a time sends where the picked time + Confirm sit
  (after Confirm: the contact form + Book), and the booking page scrolls only as far as needed to put that on
  screen. Framed on any other address the calendar posts nothing. Opened on its own, /funding-book-call is
  unchanged. A booking still writes `fh_booking_v1` inside the frame and the booking page
  still moves to `/roadmap-thank-you` on it (unchanged).
- `netlify.toml` — `/slo` and `/slo/*` 301 to `/roadmap/` and `/roadmap/:splat`.

## Not in this code

ClickFunnels builder still has to publish the apply.fundhub.ai paste (fragments now include the tracking tags). `SLO_POST_PURCHASE_ENABLED` stays unset (off). A third funnel is not built yet.
