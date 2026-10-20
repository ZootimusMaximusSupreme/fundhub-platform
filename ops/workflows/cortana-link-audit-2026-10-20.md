# Cortana link audit — 2026-10-20

## Goal

Find the existing Cortana setup thread, trace every stated connection, and list the exact missing links with evidence. This is discovery only: do not change code, configuration, credentials, or live services.

**Owner scope correction, 2026-10-20:** this audit covers only `/watch` → `/apply` → `/funding-book-call` → `/thank-you`. It does not cover the Roadmap or any paid offer. Checkout, Commas, price, sale, Purchase, and paid-offer pages are out of scope.

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
- Book-a-call tracking ground truth: `docs/tracking/tracking-spec.md`, `docs/tracking/meta-events.md`, and `docs/tracking/page-inventory.md`

## Findings

### 1. Tag coverage — partial, not proved

- The repo can add and preserve the DirectROAS hub tag through `marketing/landing-pages/tracking-manifest.mjs` and `scripts/cf-push-custom-html.mjs`.
- `docs/tracking/page-inventory.md` records DirectROAS on all four book-a-call pages. That is documentation, not fresh live proof.
- Needed: prove one hub request—not zero or two—on `/watch`, `/apply`, `/funding-book-call`, and `/thank-you` in live browser network logs.

### 2. Named funnel events — missing

- There is no Fundhub-owned DirectROAS/Cortana custom-event sender in `src/`, `api/`, or `db/`. Existing first-party and server event work is for Fundhub and Meta.
- The public hub script now exposes the event and identity contract, so no vendor guess is required.
- Needed: send the in-scope page, survey, Lead, calendar, Schedule, and thank-you events using the same timing and IDs as the first-party/Meta path. Prove them in Cortana.

### 3. Ad-to-booking identity — partial, not complete

- The current funnel already keeps UTMs plus Meta `fbc`/`fbp`, but it does not persist DirectROAS's `ak_tid` through the Fundhub lead and booking records.
- Needed: carry `ak_tid`, UTMs, Meta IDs, email, and phone across `/watch`, `/apply`, the framed/direct booking calendar, and the confirmed booking; prove one tagged ad-to-booking route.

### 4. Server feed and reconciliation — missing

- No DirectROAS server integration, Lead/Schedule sender, or date-range reconciliation job exists.
- Needed: build the supported Lead/Schedule server feed, then compare Fundhub leads and confirmed bookings with Cortana for the same date range.

## Evidence boundary

No app code, configuration, credentials, test data, or live services changed in this audit. The repo has deployment-capable tag injection, but there is no current live browser, Cortana dashboard, or lead/booking count-match proof for all four links.
