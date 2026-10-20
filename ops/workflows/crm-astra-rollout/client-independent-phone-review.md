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

## Independent PDF repair cross-review — 2026-10-20

This separate review covers B's named seven-line PDF-annotation CSS repair and its new regression, not the whole signing journey. The UI-auditor skill kept app, tests, configuration and Git read-only; the PDF skill required inspection of the rendered fields, not text extraction alone. Ground truth is the owner's phone addendum, the original percentage-coordinate placement in `public/contract.html`, and the existing fictional fields in `e2e/page_contract.spec.mjs`. `client-intended.md` was read; its after-the-fact role map does not define PDF dimensions.

**Source review:** the only client CSS delta is scoped to `body.fh-astra.fh-astra-document .pagewrap .fld` and its text inputs: no ordinary form field is reduced. `public/contract.html` is byte-identical to release SHA `4560cceb2`; all **3 script blocks** and **25 IDs** also match baseline `f1ab024ee`. Current HTML SHA-256: `aca02a727798c8ca936d9f1265514582e9b7e56ba038524c437671ce6aba1843`. Percentage styles, endpoint construction, consent gate, signer identity, local storage and sign handlers remain original.

**Independent exact regression run:** `E2E_PORT=43246 npx playwright test e2e/astra-pdf-field-geometry.spec.mjs --reporter=line --workers=1 --output=ops/workflows/crm-astra-rollout/evidence/client-independent/pdf-suite` passed **6/6 in 7.6 seconds**. Each of Chromium and actual WebKit ran 390×844, 440×763 and 1440×1000. The explicit WebKit executable prevents the runner's Chromium path override from selecting the wrong engine. Evidence is isolated under `evidence/client-independent/pdf-suite/`, not overwritten author evidence.

| Screen / role | Standard / contract | Expected | Independently observed | Evidence / status |
| --- | --- | --- | --- | --- |
| Public signed-link recipient — PDF boxes | Original percent placement; owner-approved document exception | Inputs remain inside assigned borders; signature and initials retain saved fractions | Both engines: box/input heights **23.03/19.03px at390**, **26.27/22.27px at440**, **53.33/49.33px at1440**. All x/y/width/height and inline percentage checks pass; no fixture-box overlap. | All six `pdf-suite/*/geometry.json` and `pdf-fields-MARKED.png`; named defect clear |
| Surrounding name / consent / Sign | UI §§3,5,11 + owner16/44/48 | Readable ordinary forms are not included in the PDF exception | Name **52px/16px**; consent **49.59px phone or44px desktop/16px**; Sign **52px/16px**; bottom Sign **50px phone or48px desktop/16px**. | Same six exact geometry receipts; clear |
| Local field keyboard activation | Original handlers / no business-logic changes | Text entry, checkbox Space, signature Enter and initials Space preserve existing behavior | All six cases pass keyboard entry, explicit-focus activation, name targeting, required-field/consent gates, rendered name/initials and enabled Sign. Sign is focused but never activated. | Exact new suite,6/6; bounded interaction proof |

Actual Pro Max WebKit screenshot visually inspected: Address text, signature and initials fit their marked boxes. A supplementary independent harness captured ordinary form controls and measured all four PDF labels at **13px**. The three Chromium profiles also passed sequential Tab navigation from Address through the overlay controls/name/consent and into Sign, plus visible center-hit controls. Raw and numbered red-circle/yellow-arrow review images are under `evidence/client-independent/pdf-controls/shots/`.

**Supplemental red retained, not passed:** the first standalone harness attempt incorrectly compared the `request.method` function rather than calling it, so its fail-closed guard refused the initial local GET; `pdf-controls/setup-failure.json` preserves that harness timeout, not a product failure. After that harness correction, three Chromium profiles completed. The first WebKit390 profile moved default Tab focus from `#name` to BODY instead of the native consent checkbox; consent therefore remained unchecked and Sign disabled. `pdf-controls/results.json` retains this exact result and the run stopped on its Tab-target assertion. This is an **unclassified default-Tab navigation limit**: no baseline engine comparison was performed, so it is neither called a new CSS regression nor a keyboard pass. Explicit-focus Space/Enter activation remains separately proved by the unchanged six-case geometry suite. Root was informed and asked this supplemental investigation to stop so the separately named Linux layout repair could proceed.

All six exact-suite cases record two fictional local API GETs, **zero attempted writes**, zero attached Authorization headers, zero unexpected APIs and zero page exceptions; the planted fictional staff token remains unchanged. External requests are blocked. The supplemental captured states likewise record no writes or attached credentials. No real token, backend submission, signed PDF, customer consent, physical device, native app, live authentication or production result is certified. The named annotation-size defect is independently clear within these fixtures; broader signing and default native keyboard navigation remain outside that conclusion.
