# SLO public pages — fundhub.ai/slo/

**Opened 2026-09-17.** Owner: build ONLY the public SLO pages on fundhub.ai (not
apply.fundhub.ai yet). Then ship together with the other session's in-flight SLO
backend work once it is committed. Local git only. No GitHub.

## Hard lines (owner)

- Law: `docs/UI-STANDARDS.md`. Trust first.
- No fake testimonials. No SIM MODE. No earnings claims. No new Commas product.
- Do NOT change checkout math, Commas titles, CRS, or the live apply funnel.
- Receipt title is already "Consulting Services Assessment" — untouched.
- Do not paste into ClickFunnels. Do not touch /watch or /apply.
- Price is never typed in HTML — read from `GET /api/public/slo-checkout`.
- SSN never on the address bar.

## Tasks

| # | Task | Owner | Status | Waits on |
|---|------|-------|--------|----------|
| W1 | `public/slo/index.html` (sales) + `public/slo/pay.html` (pay) | this session | **done** | other session's `api/public/slo-checkout.mjs` edits being committed |
| W2 | `public/slo/pull.html` (Commas success URL) | W2 agent | **done** | nothing |
| SHIP | `npm run ship` once W1, W2 and the other session are all committed | this session | **done — live** (proved 2026-10-05, see below) | — |

## Shared context

- Endpoint: `api/public/slo-checkout.mjs`, routed as `public/slo-checkout` in
  `netlify/functions/api.mjs`. Being edited by another session right now
  (with `src/slo/offer.mjs`, `src/slo/buyer.mjs`, `src/slo/deliver.mjs`,
  `db/migrations/385_vsl_funnels.sql`). W1 reads its FINAL shape, never guesses.
- Copy source: `clickfunnels-fragments/slo/slo-01-sales.html` (sales),
  `slo-02-order.html`, `slo-03-thank-you.html`.
- Flow: `/slo/` → `/slo/pay.html` → Commas card page → `/slo/pull.html?ref=…`.

## Manifests

### W1 — done, commit 2259d459

- **Added:** `public/slo/index.html`, `public/slo/pay.html`, `src/http/slo-public-html.test.mjs` (15 tests).
- **Changed:** `docs/journeys/slo-offer-actual.md`, `docs/journeys/CHANGELOG.md`.
- **Reads:** GET `/api/public/slo-checkout` → `priceDisplay`, `checkout.ready`, `notices`.
- **Writes:** POST `/api/public/slo-checkout` `{ email, first_name, last_name }` → `checkoutUrl`.
- **Routes:** none added. Static pages; `/slo/` and `/slo/pay.html` are served from `public/`.
- **Not touched:** checkout math, Commas titles, CRS, `/watch`, `/apply`, `api/`, `netlify.toml`.
- **Cut from the fragment:** layout-preview sample results; empty result placeholders; the video (404).

### W2 — done, commit 0bc3ff8f

- **Added:** `public/slo/pull.html`, `src/http/slo-pull-html.test.mjs` (14 tests).
- **Reads from URL:** `?ref=` and optional `&client_id=`, via `URLSearchParams` on load.
  Kept in memory-only JS variables (`orderRef`, `orderClientId`); never re-written to the
  URL, never displayed, never invented when missing — the form still renders with `ref`
  absent.
- **Never stores:** SSN and date of birth never reach the address bar, `localStorage`,
  `sessionStorage`, a cookie, or the console. SSN input is `autocomplete="off"`,
  `inputmode="numeric"`, and its value is cleared from the DOM immediately after a valid
  submit reads it locally.
- **No pull API in this task.** No `fetch`, `XMLHttpRequest`, or `sendBeacon` anywhere on
  the page — the soft-pull endpoint is explicitly out of scope here (code comment says so).
  Valid submit only clears the SSN field and shows a calm "Building your pack" state.
- **Consent gate:** checkbox authorizing Fundhub Credit Solutions LLC to run a soft pull;
  submit is refused with a plain-word message until it is ticked. All eight fields (legal
  first/last name, DOB, SSN, street address, city, state, ZIP) are validated with
  plain-word messages naming what's missing.
- **Trust copy:** reuses fragment wording verbatim — "$297 credits toward your $3,000
  deposit" (`clickfunnels-fragments/slo/slo-01-sales.html:406`), "Soft pull only. Zero
  score impact.", "We never sell your data." No invented claims, no testimonials, no SIM
  MODE, no earnings or score-increase promises.
- **Not touched:** `/watch`, `/apply`, checkout math, Commas titles, CRS, `api/`,
  `netlify.toml`, and nothing under `src/slo/` or `db/migrations/385_*` (the other
  session's in-flight files).
- **Tests:** `npm run lint` clean (2038 files), `npx tsc --noEmit` clean, `node --test
  src/http/slo-pull-html.test.mjs` — 14/14 pass. Live Playwright pass against `public/`
  served with `python3 -m http.server` at 375px and default width: consent refusal shown,
  valid submit shows the building state, URL never gained `ssn`, zero console errors, no
  horizontal scroll at 375px. Server killed after.

### SHIP — done, proved live 2026-10-05 (W2 of `ops/workflows/finish-builds-2026-10-05.md`)

- The pages moved before they shipped: `0b19e17fe` (2026-09-20, "Put the $297 Capital Playbook on
  /roadmap, not /slo") renamed `public/slo/` to `public/roadmap/`. Since 2026-10-02 the sales page has one
  address, `https://apply.fundhub.ai/roadmap` (owner ask; `netlify.toml`).
- Live, with a cache-bust query: `https://fundhub.ai/slo` and `/slo/` answer 301 to
  `https://apply.fundhub.ai/roadmap` (which answers 200). `/slo/pay.html` and `/slo/pull.html` answer 301 to
  `/roadmap/pay.html` and `/roadmap/pull.html`, and both of those answer 200.
- Byte check: live `/roadmap/pay.html` and `/roadmap/pull.html` are byte-for-byte the files on `main`
  (sha256 starts `1322d261d39a5152` and `6d9b37be3f4d1890`).
- Nothing left to ship for this board.

## Owner decisions

- **2026-09-17 — the soft pull on `/slo/pull.html` is run by Fundhub Credit Solutions LLC.** Owner-set.
  The sales and pay pages name Fundhub LLC (the funding advisory service); the pull consent names
  Fundhub Credit Solutions LLC. That difference is deliberate. Pinned by
  `src/http/slo-pull-html.test.mjs`.

## Blockers

_none_
