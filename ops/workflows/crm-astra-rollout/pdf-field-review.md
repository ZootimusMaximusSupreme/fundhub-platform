# PDF signing field geometry — Astra integration review

## Read-only finding (before repair)

**Proven regression, not a whole signing-journey result.** Astra's general form-control minimum sizes enlarge PDF overlay inputs and signature/initial boxes on phones. The saved annotation coordinates are unchanged, but the rendered controls no longer fit those coordinates.

Baseline is commit `f1ab024ee0fca5b236ecac50957ec0286c628101` (the unambiguous commit matching root's `f1ab`). Both comparisons serve their own public assets locally: baseline assets come from that Git object; current assets come from the approved Astra checkout. The renderer is the real vendored PDF.js, rendering a real one-page 612×792 PDF made with the existing `pdf-lib` dependency. Field coordinates and fictional content are copied unchanged from `e2e/page_contract.spec.mjs`.

Read `docs/journeys/client-intended.md`, the existing signing page, its iOS stylesheet, and both Astra sheets. The intended client document is a role/route map, explicitly written after the fact; it is not a PDF geometry specification. This review therefore uses the unchanged existing percent-coordinate placement contract and root's explicit preserve-placement instruction. It does not invent a new signing flow.

| Engine / viewport | Version | Address assigned height | Actual input height | Input escape above / below | Signature and initials height |
| --- | --- | ---: | ---: | ---: | ---: |
| WebKit / 440×763 Pro Max profile | baseline | 26.27px | 22.27px | 0 / 0 | 26.27px |
| WebKit / 440×763 Pro Max profile | Astra before | 26.27px | 48px | 10.86 / 10.88px | **44px** |
| Chromium / 390×844 | baseline | 23.03px | 19.03px | 0 / 0 | 23.03px |
| Chromium / 390×844 | Astra before | 23.03px | 48px | 12.48 / 12.48px | **44px** |
| Chromium / 1440×1000 | baseline | 48.86px | 44.86px | 0 / 0 | 48.86px |
| Chromium / 1440×1000 | Astra before | 53.33px | 49.33px | 0 / 0 | 53.33px |

At 1440px this particular 5%-height field is large enough, so the defect does not reproduce there. The Astra page is wider by design; expected dimensions are calculated from each actual rendered page's content size, not incorrectly held to the older layout's pixel dimensions.

The cause is specific: `fundhub-astra-client.css` applies a 48px input minimum, overriding the overlay input's `height:100%`; shared Astra applies a 44px minimum to `[role="button"]`, reaching the signature and initials annotation boxes. PDF annotations are document coordinates, not ordinary page-form rows. Their original 2px borders remain part of the assigned box.

## Before evidence

- [Pro Max marked regression](evidence/pdf-field-review/before/shots/astra-promax440-MARKED.png): red boxes show actual input/signature bounds; blue dashed boxes show assigned bounds.
- [390px marked regression](evidence/pdf-field-review/before/shots/astra-phone390-MARKED.png).
- [Matched Pro Max baseline](evidence/pdf-field-review/before/shots/baseline-promax440-MARKED.png).
- [1440px current control](evidence/pdf-field-review/before/shots/astra-desktop1440-MARKED.png).
- [All exact geometry, matched CSS rules and isolation receipts](evidence/pdf-field-review/before/results.json). Raw screenshots remain in `before/shots/_raw/`.
- Read-only harness: `/private/tmp/astra-pdf-field-review.mjs`; captured output: `/private/tmp/astra-pdf-fields.4kYZHM`.

All six comparisons had zero page exceptions, zero API write attempts and zero authorization-header attachments. Every external-origin request was blocked, and any non-GET API attempt would be recorded and refused. Address entry was fictional; Sign was not clicked. No customer record, live backend, physical device or complete signing journey is proved.

## Named repair assignment

Root accepted the read-only finding and separately authorized a narrowly scoped repair in `public/app/fundhub-astra-client.css`, with a new `e2e/astra-pdf-field-geometry.spec.mjs` regression spec. Preserve all original HTML, scripts, IDs, data, percentage coordinates and existing signing/auth behavior. Only document-overlay controls may escape normal 44/48px minimum heights; surrounding forms retain their readable sizes. After-repair measurements and receipts follow below when verified.

## Repair and measured result

The fixer skill kept this repair to the named surface: seven CSS lines under `body.fh-astra.fh-astra-document .pagewrap .fld`. They remove the general minimum size from document-coordinate boxes and their text inputs, retain the original full-box input width/height, zero vertical padding/border, and use a compact line height with 16px input text. No `public/contract.html`, shared CSS, script, coordinate, API or state change was made.

The new regression spec uses the real vendored PDF.js renderer, the existing fictional one-page PDF fixture, and all four unchanged annotation definitions. Each engine runs all three widths:

| Both Chromium and WebKit | Address / signature / initials box height | Address input height / font | Name input | Agreement label | Sign / bottom Sign |
| --- | ---: | ---: | ---: | ---: | ---: |
| 390×844 | 23.03px | 19.03px / 16px | 52px / 16px | 49.59px / 16px | 52px / 50px, both 16px |
| 440×763 Pro Max profile | 26.27px | 22.27px / 16px | 52px / 16px | 49.59px / 16px | 52px / 50px, both 16px |
| 1440×1000 | 53.33px | 49.33px / 16px | 52px / 16px | 44px / 16px | 52px / 48px, both 16px |

Every box's x/y/width/height follows its original fractions within 0.6px rounding tolerance. All four inline percentage values are asserted unchanged. Input bounds stay inside the original 2px annotation borders; signature/initial text bounds stay inside their boxes; distinct fixture boxes do not overlap. The phone document annotations are truthfully smaller than normal controls because the whole PDF scales. That exception does not apply to the surrounding signing form or any other client page.

Local interaction proof: click/focus and keyboard-type the Address; Space activates the PDF checkbox; Enter on Signature and Space on Initials focus the ordinary name field; keyboard typing fills the existing signature/initial display; the ordinary agreement checkbox enables the existing Sign and bottom Sign controls. Sign can receive focus but is **not activated by the geometry spec**. Both the empty and filled states are measured.

All six cases seed an explicitly fictional existing staff session and assert that it is neither sent as an Authorization header nor changed. Exactly two local fixture API GETs occur (contract metadata and source PDF); zero write attempts, zero unexpected APIs and zero page exceptions. External requests are aborted, including the page's Google Fonts request. No real staff/customer credential, backend or external send is used.

### After evidence

- [WebKit Pro Max fields](evidence/pdf-field-review/after/webkit-promax440-MARKED.png) and [exact measurements/isolation](evidence/pdf-field-review/after/webkit-promax440.json).
- [WebKit 390px fields](evidence/pdf-field-review/after/webkit-phone390-MARKED.png) and [exact measurements/isolation](evidence/pdf-field-review/after/webkit-phone390.json).
- [Chromium 390px fields](evidence/pdf-field-review/after/chromium-phone390-MARKED.png) and [exact measurements/isolation](evidence/pdf-field-review/after/chromium-phone390.json).
- [Chromium 1440px fields](evidence/pdf-field-review/after/chromium-desktop1440-MARKED.png). All six marked captures and JSON records are in `evidence/pdf-field-review/after/`.
- Reviewed the actual Pro Max marked image: Address entry, rendered name and initials are visibly inside their unchanged boxes. Automated geometry also checks the other five engine/width combinations.

### Test receipts and retained failures

1. First new-spec collection attempt was rejected because Playwright cannot vary worker-scoped `browserName` inside describe groups. No product assertion ran. The new spec now explicitly launches each engine in its isolated context.
2. First collected run: **8 passed, 3 failed (3.2m)** plus three worker-teardown timeouts. The three failed cases were WebKit launch stalls, not geometry assertions. [Preserved red records](evidence/pdf-field-review/test-setup-red/phone390-worker-timeout.md).
3. Bounded `DEBUG=pw:browser,pw:api` diagnostic proved the exact cause: the test worker inherited the repository's Chromium executable override and launched Google Chrome with WebKit's `--inspector-pipe` flags. The explicit 10-second launch timed out; Playwright killed only its own child. [Exact launch receipt](evidence/pdf-field-review/test-setup-red/bounded-launch-diagnostic.md). Setting `executablePath:webkit.executablePath()` for the WebKit launch fixes the harness without changing any geometry assertions or replacing the engine.
4. Corrected engine setup: **11 passed (11.0s)**. After adding the fictional existing-staff-token isolation assertion, final command `E2E_PORT=43241 npx playwright test e2e/astra-pdf-field-geometry.spec.mjs e2e/page_contract.spec.mjs --reporter=line --output=test-results/astra-pdf-field-repair-final`: **11 passed (11.6s)**. This is six new geometry cases plus five unchanged existing contract cases. The existing suite separately exercises mocked sign submissions, guards, print, download error and touch action; those mocked submissions are not included in the new geometry spec's zero-write claim.
5. `node --test src/contracts/fields.test.mjs src/contracts/signed-link.test.mjs src/contracts/pdf.test.mjs src/http/fin-b08-contracts-sign-fields.test.mjs src/http/fin-b08-contracts-sign.test.mjs`: **97 passed, 0 failed, 0 skipped**. These are local unit/handler fixtures, not database proof.
6. `npm run lint`: **4006 files/inline scripts parse clean**. `npx tsc --noEmit`: **exit 0**. Source diff check is clean. Root retains the final combined-tree checks and independent review.

The new default regression spec really launches WebKit as well as Chromium. CI must install both browser engines; root owns that workflow dependency. Earlier native credit-picker keyboard failures remain untouched and red on their original record. No test has been weakened, skipped or replaced with `selectOption`.

## Scope remaining

This is verified local fictional-fixture geometry and interaction evidence, **not** a complete signing journey, a live backend result, physical-device approval, or production deployment. No Git/release action was taken by this lane. Root owns independent rerun, final integration and release.
