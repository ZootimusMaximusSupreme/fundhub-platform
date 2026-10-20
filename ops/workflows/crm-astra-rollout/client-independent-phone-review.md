# Independent customer phone review — Astra rollout

Reviewer: lane A, reviewing B's customer/entry work only. This is not a grade of lane A's staff build. App, tests, configuration, source styles and Git remain read-only. Root owns repair assignment and release.

## Scope and method

Ground truth: `docs/rules/UI-STANDARDS.md` §§3, 5, 11 and the owner's stricter 2026-10-20 requirement: body/inputs 16px, captions at least 13px, actual interactive targets at least 44px. This focused review does not certify every other UI-standard section.

Local fictional API responses only, adapted from existing browser-test fixtures and `src/demo/client-portal-sample-bundle.json`. External network requests are blocked. Writes are intercepted locally; no customer account, money, document, consent, message or password was changed.

Primary profile: Playwright iPhone 17 Pro Max WebKit, viewport **440×763**, not screen dimensions. Supporting screenshots: Chromium 390×844 and 1440×1000. These are emulations, not a real iPhone or native Mac app.

Harness: `/private/tmp/astra-client-independent-review.mjs`; ephemeral local port. Evidence: `evidence/client-independent/`. Raw screenshots live under each run's `shots/_raw/`; review images carry red numbered circles/boxes, yellow arrows and a legend. Measurement excludes hidden/inert elements, closed disclosures, invisible upload inputs and SVG coordinate-space text. Open modal contents are reviewed separately from the covered page.

## Confirmed findings sent to B and root

| ID / screen | Role | Standard | Expected | Observed | Marked evidence | Severity |
| --- | --- | --- | --- | --- | --- | --- |
| C-01 — FinanceOS Accounts, Transfers, Strategy, Applications and Connections; standalone Money section selector and account forms | Client | §5 / §11 + owner 44px floor | Native selects expose a 44px or larger actual target | WebKit renders selects **23px tall**, although their text is 16px. Examples: `#mv-sample-6`, transfer From picker, `#s-goal`, `#dc-bank`, `#ent-commas`, `#mode-commas`. Standalone section selector and expanded account/business selects show the same issue. | `evidence/client-independent/financeos-accounts-promax-module-issue1-MARKED.png`; `financeos-transfers-promax-module-issue1-MARKED.png`; `money-accounts-promax-expanded-issue2-MARKED.png` | MEDIUM |
| C-02 — Money / FinanceOS Overview, expanded trends | Client | §5 + owner 44px floor | Trend range buttons and numeric disclosures are at least 44px | “30 days,” “90 days,” “12 months,” and “Show the numbers” are **40px tall** in WebKit and Chromium. | `evidence/client-independent/financeos-promax-expanded-issue1-MARKED.png`; `financeos-promax-expanded-issue4-MARKED.png`; `desktop-phone/financeos-phone390-expanded-MARKED.png` | MEDIUM |
| C-03 — Reset password | Reset-link recipient | §5 / §11 + owner 44px floor | Back-to-sign-in link has a 44px target | “← Back to sign in” is **120.71×18.84px** in Pro Max WebKit. | `evidence/client-independent/reset-password-promax-initial-issue1-MARKED.png` | MEDIUM |
| C-04 — Customer chat, opened from the portal | Client | §3 / §11 + owner 16px input / 13px caption floors | Readable chat field and supporting text | At 390px: `#fh-chat-input` **13px**; Close and Send **12px**; “Message staff” **11px**; message body **12.5px**. These elements are visible in the opened chat, not hidden menu descendants. | `evidence/client-independent/desktop-phone/client-portal-phone390-expanded-MARKED.png` | MEDIUM |
| C-05 — Progress referral result | Client | §3 / §11 + owner 13px caption floor | Referral code remains readable after retrieval | The visible “Your code: SAFE-REVIEW” result was **12px** at 390px. | `evidence/client-independent/desktop-phone/progress-phone390-expanded-MARKED.png` | MEDIUM |

Status: **C-01 through C-05 independently rechecked clear after B's root-assigned repairs.** Original red evidence is retained above. This reviewer changed no customer app file, stylesheet, test, permission or workflow.

## Final independent recheck

`evidence/client-independent/independent-recheck/results.json` records **132 captures**: all **25 customer/entry pages** at Pro Max WebKit 440×763, Chromium 390×844 and 1440×1000, plus all **16 FinanceOS modules** in Pro Max WebKit. Account/business forms, disclosures, transfer review, strategy goal, plan drawer, soft-pull business additions, login reset and text-contract consent were expanded where fixtures allowed. No measured undersized target, small input/caption, clipped-text flag, sideways page overflow or page exception remains in these captured states. Every capture measured at least one actual control.

`evidence/client-independent/independent-landscape/results.json` adds **20 captures across 11 pages** at WebKit 838×390. Those captured states also have no measured size/overflow/page-error issue.

Observed repair checks:

- Native selects are at least 44px tall with 16px text in the affected FinanceOS modules and account/business forms. Trend buttons and numeric disclosures are at least 44px.
- Reset-password Back to sign in now exposes a 44px target; the generated Progress referral caption is at least 13px.
- Opened customer chat has a **44×44px Close control**, **48px-high input and Send control**, and **16px text** at 440, 390 and landscape. In 838×390 landscape, the input and Send finish at y363, inside the viewport. Exact screenshots: `independent-recheck/client-portal-promax-chat-open-MARKED.png`, `independent-recheck/client-portal-phone390-chat-open-MARKED.png`, and `independent-landscape/client-portal-promax-landscape-chat-open-MARKED.png`.

Short-height reachability was checked separately by scrolling each rendered control into view, waiting for a native painted frame, intersecting it with the viewport and clipping ancestors, then checking its actual hit target. **177 enabled control instances passed; 4 fixture-disabled controls were recorded, not counted as passes.** Coverage includes Money Overview, Accounts/business forms, Transfers, Strategy, Applications, Plan, expanded soft-pull forms, Progress and open portal chat. Evidence: non-portal rows in `landscape-reachability/results.json` plus `landscape-chat-reach-settled/results.json`. This does not claim every control in every unvisited state.

Harness corrections are retained transparently: invisible modal nodes originally risked an empty measurement; modal selection now requires real visibility and excludes hidden/inert ancestors. Covered page controls under the open chat/plan panel are not graded as accessible controls in that state. Early portal reach probes sampled before WebKit's scroll/layout paint and included covered controls; their red raw results remain in `landscape-reachability` and `landscape-chat-reach-confirmed`, superseded only for the portal by the settled-paint run above. No app code was changed to manufacture a pass.

Not certified here: all loading/empty/error variants, real customer data, live send/money/consent paths, PDF overlay signing, native keyboard navigation, uploads to a real backend, physical device or native app behavior, performance, deployment, or affiliate pages.
