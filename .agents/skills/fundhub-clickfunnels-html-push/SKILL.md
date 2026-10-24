---
name: fundhub-clickfunnels-html-push
description: Push Fundhub funnel HTML and tracking to live ClickFunnels via Custom HTML Pages API (GA 2026-09-18). Use when shipping marketing/landing-pages, apply.fundhub.ai pages, $297 slo HTML, thank-you, UTM catcher, Meta pixel, or vsl-watch beacon. Never tell Chris to paste into the builder as the default path.
---

**Docs first:** https://developers.myclickfunnels.com/ (changelog: https://changelog.myclickfunnels.com/)

# Fundhub ClickFunnels HTML push (API)

## When to use

- Ship or update `marketing/landing-pages/**` on **live ClickFunnels** (`apply.fundhub.ai` or the $297 funnel workspace).
- Add or fix **tracking**: `fh-attribution.js`, `vsl-watch-beacon.js` (watch only), Meta pixel, UTM hidden fields (via attribution script — do not double-load `06-utm-hidden-fields.html` if `fh-attribution.js` is already on the page).
- Chris says Custom HTML Pages / SDK / changelog 2026-09-18 — **this skill wins** over “paste in CF.”

## Auth (names only — never print values)

1. Read gitignored `.env` and Netlify production env.
2. Use **`CLICKFUNNELS_API_KEY`** + **`CLICKFUNNELS_SUBDOMAIN`** (default workspace host: `chrisstanbridgestea3f77f.myclickfunnels.com`).
3. Or **`analytics_connections`** row `platform = clickfunnels` (encrypted JSON with `api_key` + `subdomain`) via `DATABASE_URL`.
4. Optional: **`CLICKFUNNELS_WORKSPACE_ID`** (else resolve via `/teams` → `/workspaces`).
5. Meta pixel: **`META_PIXEL_ID`** (or `FACEBOOK_PIXEL_ID`, `FB_PIXEL_ID`, `PIXEL_ID`). If unset, script uses repo ground truth documented in `ops/workflows/archive/ads-revenue-model-2026-08-24.md`.
6. Clarity: **`CLARITY_PROJECT_ID`** only if set — never invent a project id.

If **`CLICKFUNNELS_API_KEY`** is missing after searching `.env`, Netlify, and DB → **stop** and report that env name. Do not ask Chris to paste. Do not rotate keys unless a known-good API call returns **401**.

## API (GA 2026-09-18)

- Changelog: https://changelog.myclickfunnels.com/2026-09-18-the-clickfunnels-sdk-and-custom-html-pages-are-here
- OpenAPI: https://developers.myclickfunnels.com/openapi/clickfunnels-api.json
- Create: `POST /workspaces/{workspace_id}/pages/custom_html`
- Read body: `GET /pages/{id}/custom_html`
- Update body: `PUT /pages/{id}` with `page.custom_html` (custom HTML pages only)
- Builder pages (not custom HTML): `PUT /pages/{id}` with `head_code` / `footer_code` **`append`** for tracking inject only

**Bearer** + **User-Agent** required on every call (see `src/analytics/clickfunnels.mjs`).

## Replace-whole-step warning

A **Custom HTML Page is a full document**. It **replaces the funnel step**. Native **survey, checkout, and booking calendar do not carry over**.

| Step | Rule |
|------|------|
| `/funding-book-call` | **Never** full-page replace. Inject tracking via `footer_code` append only. Calendar must stay native. |
| `/apply` | Multi-block builder — inject tracking; do not wipe survey with custom HTML unless Chris names that migration. |
| `/watch`, `/thank-you` | Prefer custom HTML **only if** page is already custom HTML type; else inject tracking first, then plan step swap with snapshot. |
| $297 `slo-02-booking` | Fragment expects native calendar slot — **do not** swap apply calendar with 297 booking HTML on the live apply funnel. |

## Tracking checklist (every push)

- [ ] `https://fundhub.ai/funnel/fh-attribution.js` on all funnel steps (UTM → hidden fields / webhook)
- [ ] `https://fundhub.ai/funnel/vsl-watch-beacon.js` on **watch / VSL only**
- [ ] Meta base pixel + `PageView` in custom HTML `<head>` (or confirm CF site pixel on builder pages — view-source `fbq('init'`)
- [ ] Do **not** paste `06-utm-hidden-fields.html` twice if `fh-attribution.js` is present
- [ ] Do **not** add field-capture trackers on pull/SSN pages
- [ ] No invented CAPI unless env provides it

## Tooling in repo

```bash
node scripts/cf-push-custom-html.mjs list
node scripts/cf-push-custom-html.mjs push --dry-run
node scripts/cf-push-custom-html.mjs push
```

Manifest: `marketing/landing-pages/tracking-manifest.mjs`  
Operator doc: `docs/sops/clickfunnels-custom-html-push.md`

Snapshots before overwrite: `ops/workflows/cf-push-snapshots/` (gitignore if contains live HTML).

## Live prove (required)

1. View-source live URLs (`apply.fundhub.ai/watch`, `/apply`, `/funding-book-call`, `/thank-you`).
2. Confirm `fbq('init'` and `fh-attribution.js` where expected.
3. Open `/funding-book-call` — real calendar still books (look only; no pay, no SSN).
4. Do **not** `npm run ship` for `/roadmap` unless you changed those files.

## Never

- Default answer: “paste into ClickFunnels editor.”
- Print API keys or webhook secrets.
- Full-replace `/funding-book-call` with `slo-02-booking.html`.
- Mint Commas products or restyle `public/app/`.
