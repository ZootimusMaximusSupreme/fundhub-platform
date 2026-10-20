# Bank outreach — approved Astra integration

## Scope and current status

2026-10-20. Owner-required Astra Extra High authored this narrow integration.
**Local implementation and fixture proof complete: 41 Chromium + 27 WebKit passed.**
No deployment, production record, outreach send or real-device claim is made here.

Independent before review: `ops/workflows/crm-astra-rollout/bank-outreach-alignment.md`
in the CRM Astra rollout worktree. Its final report reviewed Bank source
`fe0dbfb32d74b3bc6ee5a8cbe8186fa733fb167e`, visually unchanged from `f97bc66ac`.
The approved foundation is PR81 head `7dcb0aa315b80bc9dadc93426c33a1587f1ba040`,
merged on canonical main as `f78f6b8b95ab4651b1553d942b0e4c8462a5c839` and integrated
here by `8fc8eb33584b69ab51fc54f58aa5718699311782`. This proof uses those integrated
runtime bytes plus the uncommitted Bank changes. Parent's subsequent merge of
`9cb7abc55` changed only `ops/ship-log.md`, not tested runtime files.
Exact source hashes are in `astra-browser-proof.json` and `lighthouse-mobile-fixture.json`.
Parent owns later main integration, independent review and publication.

The tested shell includes the branch's existing outreach role/navigation/header
changes; it is not byte-identical to plain main. Its SHA256 is
`aea5de25bad8a67ffa13f6013eb3770340311ee34591a316899738588e97ae2a`.
The later ship-log-only merge did not change it. Bank HTML/CSS/JS and both Astra
sheet hashes are recorded exactly in both compact JSON files; the browser
receipt also pins shell, sidebar, workspace, brand and font source hashes.

## Exact application changes

- Retain `bank-outreach-page`; add `fh-astra fh-astra-staff fh-astra--bank-outreach`.
- Load `/app/fundhub-astra.css`, then `/app/fundhub-astra-staff.css`, after Bank and legacy styles.
- Identify the existing versioned sidebar link as `fh-crm-sidebar-css`. Without
  that ID, the shell appended another copy after Astra, breaking the final cascade.
- Scope Bank `.button.primary` to its approved page class and a 48px minimum.
  The earlier selector lost to the shared control floor and rendered at 44px.
- Restore dialog focus explicitly for Safari pointer clicks. On Close, use the
  visible original opener, the same bank's replacement Open button, or visible
  Work next while the queue refresh is pending. A replaced empty-state Import
  opener falls back to the stable toolbar Import button. Save/network timing is unchanged.
- Existing IDs, role gates, API contracts, data hierarchy, queue ordering and
  manual-only outreach behavior remain unchanged.
- No shared stylesheet or shell source copied or edited. The approved foundation
  owns 16px body/editable text, 13px captions, explicit 44px native selects and
  expanded shared-menu containment. No duplicate Bank native-control or
  account-menu sizing override was needed after integration.

## Preserved and added proof

The 37 original Chromium case bodies, existing screenshot helper and fixture
function are byte-for-byte preserved. The fixture function/data moved into
`e2e/bank-outreach-fixture.mjs`, used by both browser engines.
Existing unanswered/unknown/zero/No, URI/control-character, inactive-filter,
published-data, failed-write, role and Arizona-time assertions remain intact.

Four extra Chromium cases cover both roles at 768×1024 and 1024×768, including
expanded account/Technical details, closed nested disclosures, context menus,
queue controls, touch and product editors, and reachable save/close actions.

The separate `e2e/bank-outreach-webkit.proof.mjs` has nine cases per profile:
both roles' full flows, both roles' loading/empty/error states, and failed-save
input retention/retry. Parent-owned configuration runs all nine at 390×844,
440×763 and 838×390: 27 cases, no skips/retries. Native dropdown selections,
contact/product/touch/relationship saves, manager assignment/import and rep
control exclusions use fictional intercepted APIs, not production.

Measurements attach viewport/page width, body text, every rendered control's
size/font, captions and primary buttons. Closed disclosure ancestors and closed
dialogs are excluded from visible measurements. Offscreen controls are measured
and saves are separately reached through real scrolling; Sign out is trial-clicked
without changing the session. This is browser emulation, not physical-phone or
foldable-device certification.

## Final browser results

| Raw receipt | Result | Coverage |
| --- | --- | --- |
| `/private/tmp/bank-outreach-astra-chromium-verified.json` | 41 passed, 0 failed/skipped/flaky; 61.4s | Original 37 plus four intermediate-role cases |
| `/private/tmp/bank-outreach-astra-webkit-complete.json` | 27 passed, 0 failed/skipped/flaky; 37.2s | Nine cases at each of the three required WebKit sizes |

Runtime: Playwright 1.62.1, Node v22.23.2, Darwin 25.6.0 arm64.
Raw paths, byte counts, SHA256 values, failures and measured ranges are in
`astra-browser-proof.json`; bulky raw reports stay in `/private/tmp`.
No retries were configured. This proves fictional UI behavior, not production
authentication isolation, live writes, native iPhone or foldable-device behavior.

Across 81 WebKit and 28 intermediate Chromium measurement snapshots:
body and editable text were 16px, native selects 44px and primary buttons 48px.
No measured target was below 44px, no visible caption below 13px and no page
overflow occurred.

Permanent focus assertions in the required `.proof.mjs` cover hero close,
row-open → saved touch → replaced row close, a deliberately pending queue
refresh with a connected but hidden row, toolbar import close, and empty-state
import → successful import → removed opener close. The pending read is released
in `finally`; no app timing or network behavior was changed.

### Red receipts retained

The compact proof retains all earlier runs, including failures:

- First Chromium: original 37 passed; four new helper checks failed because
  `scope` was not passed into the browser closure. The helper was corrected.
- First WebKit: 24 cascade failures and three of the same helper failures.
  The Bank sidebar-link ID fixed the measured duplicate stylesheet.
- Next WebKit: 15 passed, 12 failed on 44px primary height; four intermediate
  Chromium checks failed on the same condition. The scoped 48px Bank rule fixed it.
- Next WebKit: 21 passed, six full-flow cases failed on Close focus.
  Explicit pointer-opener focus repaired that measured Safari behavior.
- Strengthened WebKit 440: all three row-repaint/empty-import focus checks failed.
  `/private/tmp/bank-outreach-astra-webkit-repaint-before.json` retains this red
  receipt; stable bank-ID/visible-target and toolbar fallback repaired it.

No check was skipped, weakened or retried to turn these failures green.

## Speed proof

Fresh Lighthouse 13.5.0 run at `2026-10-20T09:31:52.547Z`:
**98 performance; LCP 1,888.6ms; CLS 0.02331; TBT 23.6ms;
198,533 JS transfer bytes; 420,724 total transfer bytes.**
No Lighthouse warnings. CRM LCP, CLS, JS and page-size budgets passed.

390×844 mobile, actual DevTools 150ms request latency / 1,600Kbps down /
750Kbps up, 4× CPU; Chromium 151, Node v22.23.2, Darwin 25.6.0 arm64.
The separate post-audit render check confirmed a rep page, 25 rows, loaded Astra
styles, 16px body and no horizontal overflow. The audited final screenshot was
opened and inspected. Field INP and production TTFB are **not measured**;
2ms local TTFB is not live proof.

Raw Lighthouse report:
`/private/tmp/fundhub-outreach-lighthouse.ApQVDL/lighthouse-mobile-fixture.report.json`,
262,360 bytes, SHA256
`fc19b35198996c2482a5922fa8d763dc33ece351fe367f67bb34a9237e58ab83`.
The compact JSON includes source hashes, runtime, read-only request log and
reproduction commands. Its saved runner uses repository-relative paths, fictional
sessions, rejects writes and never proxies a production API.

The separate retained CDP lab is `mobile-performance.json`: LCP 1,832ms,
CLS 0.04303, measured drawer interaction 96ms, 197,624 JS bytes and 420,910 page
bytes. It is neither Lighthouse nor field INP.

## Inspected marked previews

All paths below are inside this evidence folder. Red boxes mark exact measured
controls; captions label synthetic data. These are aligned-source captures,
not historical before images. The retained suite refreshes older mutable filenames;
Git history, not their current contents, is the older-source reference.

- `astra/outreach-webkit-440-manager-account-open.png`
- `astra/outreach-webkit-landscape-manager-account-open.png`
- `astra/outreach-webkit-390-rep-queue.png`
- `astra/outreach-webkit-390-rep-product-footer.png`
- `astra/outreach-webkit-landscape-manager-product-footer.png`
- `astra/outreach-webkit-440-rep-row-save-close-focus-restored.png`
- `astra/outreach-webkit-440-rep-pending-refresh-close-focus-restored.png`
- `astra/outreach-webkit-390-manager-empty-import-close-focus-restored.png`
- `astra/outreach-webkit-390-manager-error.png`
- `astra/outreach-webkit-440-manager-loading.png`
- `astra/chromium-768-manager-account-open.png`
- `astra/chromium-1024-rep-product-footer.png`
- `1440-manager-full.png` and `320-rep-drawer.png`

The marked intermediate issue images
`astra/webkit440-before-primary-44px-needs-48px.png` and
`astra/webkit440-before-close-focus-stays-on-closed-dialog-not-button.png`
are genuine before-fix evidence, not current rendered failures.
Parent independently inspected six selected aligned previews and the technical
peer reviewed cascade/focus integration; both reported no blocker.

## Reproduction

From the Bank worktree:

```sh
BANK_OUTREACH_CAPTURE=1 E2E_PORT=43129 PLAYWRIGHT_JSON_OUTPUT_FILE=/private/tmp/bank-outreach-astra-chromium-verified.json npx playwright test e2e/bank-outreach.spec.mjs --reporter=line,json --output=/private/tmp/bank-outreach-astra-chromium-verified-results
BANK_OUTREACH_CAPTURE=1 E2E_PORT=43147 PLAYWRIGHT_JSON_OUTPUT_FILE=/private/tmp/bank-outreach-astra-webkit-complete.json npx playwright test --config=playwright.bank-outreach-webkit.config.mjs --reporter=line,json --output=/private/tmp/bank-outreach-astra-webkit-complete-results
LIGHTHOUSE_TOOL_ROOT=/private/tmp/fundhub-outreach-lighthouse.ApQVDL node ops/workflows/build-evidence/bank-outreach/lighthouse-local-fixture.mjs
node ops/workflows/build-evidence/bank-outreach/summarize-astra-proof.mjs /private/tmp/bank-outreach-astra-chromium-verified.json /private/tmp/bank-outreach-astra-webkit-complete.json
```

Use distinct raw paths for a new run to preserve these receipts. The summarizer
can take all prior paths to preserve failure history as in the saved compact.
The temporary Lighthouse install command is in its compact JSON; no application
dependency or lockfile changed. Parent owns required Mac WebKit CI wiring.

## Source checks and release boundary

- Changed-file syntax passed for Bank JavaScript, the fixture, both browser files,
  Lighthouse runner and compact-report generator.
- Scoped `git diff --check`: passed.
- Parent reported full lint (4,030 scripts), TypeScript and broader integration
  gates passed; parent owns the final batch recheck.
- A Node assertion compared the original case block and extracted fixture function
  with `git show HEAD:e2e/bank-outreach.spec.mjs`; both are byte-for-byte unchanged.
- This lane has not committed, pushed, deployed or changed production data.
- Any later shared-shell/style change requires affected-source proof before release.
