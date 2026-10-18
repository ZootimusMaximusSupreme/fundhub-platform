# Client portal page implementation

Owner: `page_client_portal`. Scope: `public/app/client-portal.html`, page-only `client-portal-ios.css`.

Read AGENTS.md, CLAUDE.md, UI and performance standards, client intended journey, call-confirmation intended journey, heartbeat flow and approved HTML. Approved split remains in effect.

## Before / after preservation matrix

| Existing capability / controls / states | Implemented home |
|---|---|
| Session, staff impersonation by id, authorized representative switcher, refusal and loading | Existing handlers and DOM retained; visual activation gated by lead shared verified client session. Staff keeps original visual layer. |
| Welcome video, no-video empty state, playback metadata and retry | Original player and mapped content endpoints retained; rounded media panel below real file summary. |
| Booked-call skeleton, none/confirmed/unconfirmed/failure and confirm button | Same card and POST `/api/bookings`; elevated in page, no booking creation. |
| Dispute disclosure, legal name, canvas, clear, sign, refusal / signed states | All original IDs, consent reads and POSTs retained. |
| Community and FinanceOS link, staff query forwarding | Same links and handlers; paired grouped cards desktop, stacked phone. |
| Agreements, sent signing link, signed copies | Same conditional list and contracts links. |
| Real funding / precall progress, real estimate, credit scores and sample marker | Existing server-derived text and stages retained in dark approved hero; no design sample step constants added. Scores and conditional estimates unchanged. |
| Upload entitlement doors, document type selectors, multiple file picker, pending/sent/refused status | Same three doors and `/api/documents-upload`; no upload writes performed. |
| Owned products, reports, downloads, letter packs, included courses, readiness / unavailable / pending states | Same renderers, entitlement gates and file URLs, course expansion and module controls. |
| Offers, unlock modal, unavailable-checkout honesty, booking / chat entry | All original controls, hidden states and handlers retained. |
| Account tabs: payments, agreements, documents, activity, messages | Same account details disclosure, tab IDs and server data; horizontal touch scroll added for narrow tab bar. |
| Advisor and booking rail / chat | Original advisor data and chat controls retained; advisor panel visually beside real file status desktop. |
| Referral join, copy, error, direct-only counts and rates | POST now requires HTTP success as well as valid payload. Valid enrolled GET exposes Affiliate Dashboard. Successful POST requests shared `refreshAffiliate()` and re-reads original card. Failure exposes no dashboard. |
| PWA manifest, iOS install, web push, marketing opt-in/loading/refusal | Original manifest and all preference/subscribe/unsubscribe handlers retained. |
| Modals / focus / touch / reduced motion | Existing modal logic retained, >=44px controls, visible focus rings, narrow-width modal bounds and reduced-motion scroll. |

Machine inventory `page_client_portal-inventory.json`: 112 original IDs preserved; zero removed. The seven existing nonempty inline programs are unchanged except the referral success check and shared navigation refresh. No new dependency or API introduced.

## Verification status

- Focused node run: 79 tests, 65 pass / 14 fail, zero skips. Ten failures are existing VM fixture mismatch (`callSummary.then is not a function`); four own-footer tests assume body has exactly one class attribute and no other attributes, so reject the required new data-client-page attribute. Do not count these as passes.
- Attempted 28 browser regressions across client-portal-ux, portal-call-confirmation and portal-refer-a-friend; browser missing (`chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell`). No browser checks or screenshots claimed yet.
- Widths 1440 / 390 / 320, loading / empty / error / full, and keyboard / touch clicks remain awaiting runnable browser and lead shared foundation.
- No production data, payments, outbound messages, bank actions or real client writes performed.
- Lint and global integration checks remain lead-owned; TypeScript package has no tsc script.

## Browser runtime follow-up

- Chromium supplied by lead: `/workspace/scratch/browser-tools/chromium`. All 36 focused browser cases pass (client-portal-ux, page_client_portal, portal-call-confirmation, portal-refer-a-friend). No database checks counted here.
- Diagnosed overlap: main flex layout stretched page to viewport height, then mobile flex children shrank and painted over each other. Fixed page `align-self:flex-start` and main `min-height:0`; real clicks now pass without force.
- Captured top-of-home at 1440,390,320 (`page_client_portal-home-*.png`), account tab views at all widths, and loading/empty/error views. Tests prove no document-width overflow, real Documents tab click, HTTP500 success-shaped refusal and staff visual isolation.
- Inspected 1440 and390 screenshots against approved visual: calm pale canvas, dark gradient file card, rounded advisor card, approved shared desktop/mobile navigation. Kept real file status as supporting text under generic `Your file.` title, avoiding sample progress. Existing eight-stage precall progress remains horizontally scrollable on phone with readable stage widths.
- Verified baseline VM failures in isolated `/tmp/page-client-baseline` mirror using HEAD source/test versions: 13 cases,3pass/10fail, same exact `callSummary.then is not a function` failures. These predate this page change. Lead owns test fixture maintenance.
- Staff heading and new file title hidden by default; browser test proves Home hidden and no data-client-ios activation for staff.

Final page-only rerun after title/type refinement:8/8pass, screenshots refreshed from current source. Home screenshot fixtures are explicit safe mocks (`Portal Sample`, NO DB) and are review evidence rather than live account proof.

## Independent visual review repair

Replaced the clipped resting eight-stage row with native progressive disclosure. Client summary names the current stage by reading the existing real `.step.current` renderer; it adds no inferred percentage or fixed sample step. Expanding shows every original stage in a two-column desktop / single-column phone list with complete words. Staff keeps the original open stage list. The original progress link (same ID/href and staff ID-forwarding handler) is moved into the active hero only after verified client presentation activates, and reads View progress. Desktop duplicate header wordmark hidden while phone wordmark remains. Removed page max-width cap. Inspected fresh1440/390 captures, which show readable summary and prominent CTA without the clipped stage row.

Post-review full focused browser rerun:36/36pass, including visible all8stage disclosure and in-hero CTA at1440/390/320. Screenshots refreshed from this rendered source.

## Font request follow-up

Legacy Google font CSS now loads with media=print and switches to all on load; noscript fallback preserved. Own8 browser cases pass after source change. Exact throttled lab rerun Home LCP2616ms / CLS0.0131; isolated repeat2640ms / sameCLS. The2.5s LCP budget remains missed and is not marked passed. Both raw runs retained in page_client_portal-font-performance.json. Second shared lab run also observed login CLS0.15745 (prior run0); login is outside this agent scope, reported to lead without modification.

## Cold-load performance repair

Waterfall showed verified client presentation waited behind the140KB shared staff shell and full234KB HTML parse due defer ordering. Home now preloads the existing independent shared foundation and runs it asynchronously immediately after body exists. The same real session check still decides client presentation; original shell authentication, role gates and all control/data handlers still execute unchanged. The existing page presentation observer is registered before async foundation so progressive disclosure does not briefly paint expanded. No comment stripping, dependency or feature removal.

Measured exact constrained390px lab: Home LCP1008ms,CLS0.06546 (prior2640ms,CLS0.0131); both LCP<2500ms and CLS<0.1 now fit. This is mocked API/local static server lab evidence, not a live backend or INP claim. Raw result in page_client_portal-async-performance.json; full focused browser rerun underway.

Final cold-load placement guarantees both body and header exist before async shared foundation can run, preserving Sign out even on fast cache. Added visible shared Sign out assertion to every own client fixture. Final lab Home LCP1024ms,CLS0.06546; own8/8pass after header placement; full36/36pass on preceding async/early-observer source. No push or deployment.

## Canonical stage consistency repair

Disclosure status now reads the same actual portal-summary `stage.key` used by hero copy; it no longer derives current status from the older funding stepper, which proves only booking/payment. Canonical soft_pull sample now shows Current: Credit pull received while the hero says soft-pull assessment is in. Unknown/unloaded stage says Status updating. All eight original stage nodes and handlers remain intact. Added regression using the tracked canonical sample bundle; checks hero/current summary agreement and all8stages preserved.
