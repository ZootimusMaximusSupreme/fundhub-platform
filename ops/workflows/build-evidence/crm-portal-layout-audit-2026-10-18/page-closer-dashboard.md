# Closer Dashboard — layout build evidence

Owner authorization: the full CRM/portal layout repair; the existing UI design rules are not the visual authority for this work. Visual reference: `tools/fundhub-mac/FundhubMac.swift` (warm paper, rounded system type, strong hierarchy, black primary actions, fine borders and restrained color).

Scope: `public/app/closer-dashboard.html`, new page-only `closer-dashboard.css` and `closer-dashboard-layout.js`, and closer-focused browser evidence. Shared navigation, account and workspace header are owned by the foundation workflow. No backend, authentication, permission, financial rule, API, database or live-write changes. No deployment or commit was made by this page builder.

## Result

The workspace opens on the person and call tools. The shared header carries the staff account and selected client context. A same-client Client file link opens the Control Panel. Phone and desktop now share the same task order: call tools, funding estimates, then credit/deal facts and context. The permanent outcome shelf has moved into page flow, inside a native “Log this call” disclosure that starts folded on phones and open on desktop. All original choices remain available.

The independent close checklist, Up next list, funding estimates, credit and deal facts, pre-call context, two calculators and three breakdown tables remain. Calculator guardrails retain their own visible states. Exact duplicate estimate captions are visually omitted; unknown/missing-data reasons remain visible. Native disclosures work with Enter, and input text uses 16px on phone to avoid focus zoom.

## Preservation matrix

| Area | Original contract retained | Presentation and proof |
| --- | --- | --- |
| Client and scheduled call | `__FH_CLIENT_ID`, `ccp-who-name`, `ccp-who-meta`, `ccp-call-when`; canonical `current_call` and server `next_call` | Client card with time, relative time, business and stage. Timing fixtures, including next-call array ordering and later-day calls, pass. |
| Staff and scope | `whoAv`, `whoName`, `whoRole`, `[data-fh-call-head]`, `[data-fh-call-staff]` paint targets | Original staff IDs remain hidden compatibility targets. Shared account appears once. Page observer updates the foundation's presentation-only scope hook when a booked client resolves without a query parameter. |
| Call tools | `fh-join`, `fh-present`, `fh-send-contract`, `fh-pay-link`, `fh-temp-chip` | Same IDs and original business handlers. One active primary among call tools; unavailable Join remains disabled. Present still opens the contact-linked deck in a new tab. |
| Attribution | `ccp-ad`, gate/entry/primary/secondary fields | Four source-backed lines retain their text and hidden-until-loaded behavior. All three ad attribution fixtures pass. |
| Contract send | `fh-contract-panel`, template select, dynamic blanks, send/copy controls, readonly link and response text | Same panel and helper contracts, with page-only field styling. No handler or send path changed. Node contract/presentation checks pass. |
| Payment link | `fh-pay-panel`, offer/motion controls, send control and response text | Same `POST /api/closer-deck` action and validation. Existing alternate-offer motion, no-offer, error, busy/double-click and payment-watch browser checks pass. |
| Money and payment truth | `fh-money-note`, latest-payment source, fee percentage and source | Payment watch, posted state and server-resolved outcome payment remain unchanged. Browser never sends the historic transaction ID as this call's payment. |
| Funding estimates | `.bands .band` order and `.bl`, `.bv`, `.bn`; `.lever` | Conservative, realistic and stacked amounts remain canonical. No-credit, unknown amount and no-fundable-credit states retain distinct words rather than invented zeroes. |
| Credit and deal facts | First and second `.panel table` selectors and order | Same original table writers, scores, utilization, inquiries, derogatories, pull time, payment/date/product and success-fee source. Native table labels wrap cleanly at 320px. |
| Pre-call context | `.ctx h3`, first paragraph, ordered `.ctxg div b`, `.flag`, `[data-fh-said]` | All summary, goal, purpose, guessed score, message date, source and agent-context hooks remain. |
| Funding calculator | `iDraw`, `iGuard`, `iDrawRange`, `oCredit`, `oUtil`, `guardBox`, `guardTitle`, `guardBody` | Original numeric attributes, labels, listeners, request fractions and server allocation retained. Slider, typed non-step values and stale-response checks pass. Hard-stop guardrail stays visible. |
| Deal calculator | `iDeposit`, `iFee`, `iDebts`, `iMin`, all `oNet`/`oMonthly`/fee/debt output IDs, cliff fields | Original API math, deposit/fee/debt/minimum requests and missing negative-amortization computation warning retained. Real phone typing yields the fixture's $7,000 net / $500 per month. |
| Calculator details | `paymentCalculator`, `breakdown`, `.deal` total row, Method/Card headers, Lump Sum row, `D-03b`/`D-04` text lookup hooks | Native summaries retained; all three planning tables remain independent within the breakdown. Horizontal overflow stays inside table wrappers at 320px and 390px. |
| Close checklist | `d1`–`d5` and labels | Recorded call, personal guarantee, month-14 cliff, bank decision and verified incorporation checks retained. All five values are proven in the submitted fixture body. Checklist remains before Up next. |
| Outcome and belief | `.logbar`, ordered `.logrow` hooks, all five `[data-outcome]`, eight `[data-belief]`, `fh-repair-referral`, `fh-save-next`, `.foot` | Original writers and payload untouched. Disclosure is keyboard operable. Phone fixture submits callback, trust, repair referral and all five checklist values to the same client. |
| Safety and permission boundaries | Staff shell gate, original data readers/writers, source honesty and financial notices | All original nonempty inline script blocks are byte-for-byte identical to HEAD. Zero original IDs removed. No permissions, roles or financial calculations changed. |

## Control and state inventory

Call actions: Join, Present, Send contract, Send pay link. Contract panel: wording select, source-defined manual fields, Send, Copy link, readonly link. Pay panel: offer, alternate-offer motion, Send pay link. Calculators: six number inputs, one range input, Payment Calculator disclosure and breakdown disclosure. Close checklist: five checkboxes. Call log: five outcome choices, eight belief choices including None, repair-referral checkbox, Save/next-call action, and Log this call disclosure. Client file navigation is new presentation-only navigation for the current client.

States inspected: fully populated call; loading; no booked call; failed read; unavailable Join; hidden send controls without a call; credit missing/unknown; real credit/estimates; failed/empty/busy pay link responses; calculator unknown, hard-stop and typed server answers; open calculator and breakdown; long client/business names; mobile folded and expanded outcome log. All API traffic in these browser checks is intercepted by local fixtures. No client message, contract, payment or outcome was sent to a live backend.

## Measured layout

| Viewport | Client name starts | Call tools start | Funding estimate starts | Credit facts start | Main horizontal overflow | Initially visible page controls |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 390 × 844 | 173px | 292px | 422px | 677px | 0px | 5 |
| 320 × 844 | 173px | 311px | 441px | 700px | 0px | 5 |

Exact measurements are in `closer-dashboard/390-layout-metrics.json` and `320-layout-metrics.json`. The five page controls are Client file and the four call tools; the shared header controls are separate. On both phones all three estimates appear after the call tools, and the credit panel begins in the initial view. The final focused review removed only the phone-only reversal of this order; all panels, facts, gates and calculators remain. The original safe-default baseline had a 212px top area followed by the fixed outcome shelf, leaving no useful view of file facts.

## Verification

- Full browser batch before the final responsive-order refinement: **46/46 pass** across `closer-dashboard-layout`, `closer-dashboard-calculators`, `closer-call-rhythm`, `closer-ad-lines` and `fin-b01-closer-dashboard` (Chromium; 1440/390/320 layout checks; every API intercepted).
- Final focused responsive-order and state proof: **4/4 pass** (1440/390/320 full-call views, expanded calculator/table overflow, and phone loading/no-call/error states). The test explicitly asserts call → funding → credit ordering at every viewport. See `closer-dashboard/finishing-browser-checks.txt`.
- Node checks: **66/66 pass** across `src/http/closer-dashboard-view.test.mjs`, `closer-ui-honest.test.mjs`, and `closer-deck-present.test.mjs`.
- All four original nonempty inline business script blocks are identical to HEAD; no original ID removed.
- Page JS and both edited/new browser specs parse with `node --check`; scoped `git diff --check` passes.
- Root workflow owns repository-wide lint and aggregate checks. The repository has no TypeScript check script or configuration for this page.

## Review evidence

- `closer-dashboard/390-before-marked.png` — red boxes around the original tall header and pinned outcome shelf. This is the root's safe-default baseline fixture.
- `closer-dashboard/390-after-marked.png` — green boxes around client/call tools, the complete funding estimate, and the beginning of credit facts in a representative full-call fixture. The fixture differs from the baseline and is labeled accordingly.
- `closer-dashboard/320-after-marked.png` — the same call → funding → credit order at narrow phone width.
- `closer-dashboard/1440-after-marked.png` — green boxes around call workspace, facts and independent close checklist.
- `closer-dashboard/{1440,390,320}-full-call.png` — unmarked integrated screens with the shared header.
- `closer-dashboard/390-{loading,no-call,error}.png` — state checks.
- `closer-dashboard/390-calculator-open.png` and `390-calculator-results.png` — source-backed phone inputs, guardrail and computed outputs.

Limit: this is local Chromium fixture proof, not live-backend or physical iPhone proof. No release is claimed.
