# Cortana link audit — 2026-10-20

## Goal

Find the existing Cortana setup thread, trace every stated connection, and list the exact missing links with evidence. This is discovery only: do not change code, configuration, credentials, or live services.

## Parallel workflows

| Owner | Scope | Status |
| --- | --- | --- |
| This session | Read the Cortana setup thread, locate its written journey, and join the findings into one owner-ready list. | Active |
| Repository trace | Search the repository for Cortana-related routes, integrations, environment keys, and tests; report what is wired versus only documented. | Ready |
| Delivery evidence | Check Git history, workflow notes, and deployment-facing configuration references for the links called for by the setup thread; report evidence gaps only. | Ready |

No dependencies — all discovery work runs in parallel. The final list waits for the two trace reports.

## Copy-paste prompts

### Repository trace

```text
Read-only task in /Users/chrisstanbridge/Developer/fundhub-platform. Find every Cortana reference in src/, api/, scripts/, db/, docs/, and tests. Start from ops/workflows/cortana-funnel-setup.md. Report: each required link, code/config/test evidence, and exact missing piece. Do not edit files, run sends, or claim live proof from code.
```

### Delivery evidence

```text
Read-only task in /Users/chrisstanbridge/Developer/fundhub-platform. Starting from ops/workflows/cortana-funnel-setup.md, inspect Git history, GitHub workflow/deploy notes, docs, and configuration references for each requested Cortana connection. Report only observable evidence and evidence gaps. Do not edit files, credentials, or live services.
```

## Ground truth and source thread

- Setup thread: `ops/workflows/cortana-funnel-setup.md`
- Tracking plan and the four required links: `ops/workflows/cortana-tracking-2026-10-06.md`
- Related money journey: `docs/journeys/slo-offer-intended.md` and `docs/journeys/slo-offer-actual.md`

## Findings

### 1. Tag coverage — partial, not proved

- The repo can add the DirectROAS hub tag to ClickFunnels pages through `marketing/landing-pages/tracking-manifest.mjs` and `scripts/cf-push-custom-html.mjs`.
- Fundhub-hosted buyer pages under `public/` have no DirectROAS/Cortana reference. The source plan also names the ClickFunnels appointment page as a vendor-owned exception.
- Needed: put the tag on every controllable buyer page, choose an alternate route for the vendor-owned appointment page, and prove one hub request per page in live browser network logs.

### 2. Named funnel events — missing

- There is no DirectROAS/Cortana custom-event call or server sender in `src/`, `api/`, or `db/`. Existing browser/server event work is for Meta.
- Needed: obtain DirectROAS's documented event API, then send PageView, Lead, Schedule, InitiateCheckout, Purchase, and any agreed money events using the same event IDs, value, and currency as the first-party/Meta path. Prove the events in Cortana.

### 3. Ad-to-sale identity — partial, not complete

- The $297 checkout accepts and stores UTMs plus Meta `fbc`/`fbp`, but the Commas metadata contains only `link_ref`, `client_id`, `source`, and `business_count`.
- No DirectROAS visitor/click ID, full checkout identity handoff, or payment-to-Cortana match is present.
- Needed: confirm the DirectROAS identifier from its documentation; carry it and agreed attribution fields across ClickFunnels, booking, checkout, Commas metadata, and the payment record; prove one tagged route from ad URL to sale.

### 4. Server feed and reconciliation — missing

- `CORTANA_COMMAS_API_KEY` is a healthy Commas checkout credential, not a Cortana tracking feed. It does not show that Cortana receives sales.
- No DirectROAS server integration, no booking/sale sender, and no date-range reconciliation job exists.
- Needed: confirm DirectROAS's server intake or Commas integration, build the supported sale/booking feed, then compare Fundhub leads, bookings, and sales with Cortana for the same date range.

## Evidence boundary

No code, configuration, credentials, test data, or live services changed in this audit. The repo has deployment-capable tag injection and a working Commas checkout key path, but there is no current live browser, Cortana dashboard, or count-match proof for any of the four tracking links.
