# Documents — completed page pass

Owner-authorized CRM layout rebuild. One page builder: `/root/page_documents`. Safe source and intercepted-API fixture checks only; this is not a live customer/session audit. No shared styles, APIs, backend, upload/download stores, outbound services, credentials, commits, or deployment changed.

## Files

- `public/app/documents.html` — task hierarchy, native controls, responsive row labels, explicit load states; existing data/action logic retained.
- `public/app/documents-workspace.css` — page-owned typography, quiet overview/library surfaces, contained desktop table and phone file list.
- `e2e/documents-workspace.spec.mjs` — 16 focused fixture checks and 1440/390/320 captures.
- This evidence note and `documents/*.png` — original and red-box/caption-marked review captures.

Shared integration request completed by foundation: Documents with a valid URL `client_id` or `id` shows selected-client scope in the shared header; unfiltered Documents shows All clients. Page does not duplicate shell logo, account, global Search, or breadcrumb/title bar.

## Before / after feature matrix

| Feature / exact hook | Before | After / proof |
| --- | --- | --- |
| Identity and context | Shared Documents header plus another Work / Documents bar | Shared identity retained; task heading Files & signatures. URL scope checked for both aliases and unfiltered view. |
| `#kTotal`, `#kSign`, `#kUndel` | Three coded metric cards in a forced four-column grid; phone stacked | One three-column overview at every checked size. Same DOCS-derived counts. Unknown/loading/error is `—`, verified empty is `0`. |
| `#staleChip`, `#staleTxt` | Count of pending rows aged 14+ days | Same calculation; clear overdue wording and no success marker for unknown state. |
| Five classes | Five large repeated clickable cards plus duplicate tabs | Counted native class buttons in `#tabs`; original class definitions, pending/settled counts, descriptions, and `#classbar` filters retained in an optional native details guide. |
| `#q` | Unlabelled client/document input | Accessible Search documents input; same document/client/subtype matching. Search and clear-filter behavior checked. |
| `#statusFilter` | Any status plus six named predicates | All values and filtering predicates retained; named native select. Awaiting-signature filter checked. |
| `#pendingBtn` | Global top-bar toggle | Library-local toggle with `aria-pressed`; same pending predicate and checked result count. |
| `#tbl th[data-s]` | Pointer-only sorting; seven keys | Native keyboard buttons, `aria-sort`, same keys/directions; all seven available in phone native sort select. Enter-key sorting checked. |
| `#body` | Wide eight-column data table; phone required sideways reading | Same eight facts/actions in desktop table; phone rows label each status, client/class, age, and contract actions. Document action controls measured inside the card and at least 44px tall on phones. |
| `data-dl` | Only drawn for an id with MIME/file bytes | Same condition and `/api/documents-download?id=…`; fresh URL opened with `_blank,noopener`, never inserted in markup. Successful/refused mint checks retained; queued/no-bytes row has no Download. |
| `data-ct="open"`, `data-cid` | Contract PDF read, base64-to-Blob, local filename | Same endpoint/query and signed-copy choice. Added safe byte/read/local-name check; anchor click intercepted, no file saved. |
| `data-ct="remind"` | Only sent/viewed contracts, `/api/contracts` write | Same action/id and server-written result. Successful and paused-message cases pass. |
| `data-ct="void"` | Owner/admin only, no signed/void contracts; reason prompt | Gate, cancel behavior, reason payload, refusal message, and contract-state reread retained and checked. |
| `#ctMsg` | Persistent response outside rerendered body | Same persistent region, now announced with a status/live region. Server response remains visible after list interactions. |
| Data/source semantics | URL-only client scope; five named classes; templates/unknown kinds skipped; received uploads not “undelivered”; delivered is not an invented open; age from last change | Unchanged. `FHData.documents(docParams)`, `FHData.wire`, contract batching (200 ids), session role resolution, schema and API permissions preserved. Source fixture suite passes. |
| Empty / loading / failed reads | Initial zero/empty-looking library and global banner | Separate inline states, loading busy state, retry action for errors, clear filters for no match; all states checked at every target width. |
| Upload / delete | No staff Documents upload/delete control or handler existed | None invented. Client-upload metadata and existing real Download path preserved; upload API fixtures separately rechecked. |

## Review captures

All linked images have a red box around the relevant area and a caption. Fixtures use fictional people/files. Desktop **viewport** capture is the authoritative sidebar review: Chromium's full-page capture clips fixed sidebar paint although computed geometry and the viewport paint are correct. This capture artifact is not treated as a product defect or a permission proof.

| Width | Before | After | Empty | Loading | Error |
| --- | --- | --- | --- | --- | --- |
| 1440 | [marked before](documents/marked-before-1440.png) | [marked viewport after](documents/marked-after-1440-viewport.png) | [marked empty](documents/marked-empty-1440.png) | [marked loading](documents/marked-loading-1440.png) | [marked error](documents/marked-error-1440.png) |
| 390 | [marked before](documents/marked-before-390.png) | [marked after](documents/marked-after-390.png) | [marked empty](documents/marked-empty-390.png) | [marked loading](documents/marked-loading-390.png) | [marked error](documents/marked-error-390.png) |
| 320 | [marked before](documents/marked-before-320.png) | [marked after](documents/marked-after-320.png) | [marked empty](documents/marked-empty-320.png) | [marked loading](documents/marked-loading-320.png) | [marked error](documents/marked-error-320.png) |

Rendered review found and corrected two local collisions: shared `.stats` rules forced the phone summary into one column, and shell table wrapping imposed max-content width on the phone file list. Page-specific overview naming and a phone-only table containment rule fix both. The phone first document is now above 650px in the checked viewport; useful file and contract controls remain in the card rather than being clipped by it.

## Exact checks

- **PASS — 25 browser tests:** `PLAYWRIGHT_CHROMIUM=/workspace/scratch/browser-tools/chromium E2E_PORT=43228 npx playwright test e2e/documents-workspace.spec.mjs e2e/documents-clicks.spec.mjs --reporter=line` (21.0s). Includes the original nine action/refusal/gate cases plus 16 focused full/empty/loading/error, keyboard, touch, both URL scope aliases and PDF cases. All `/api/**` calls are intercepted by the existing harness; writes are recorded in fixtures only. No live API write or real file download.
- **PASS — 29 node tests, zero skipped:** `node --test src/http/documents-screen.test.mjs src/http/s3-documents-handler.test.mjs src/http/fin-b08-documents-upload.test.mjs` (1.45s). Screen routes/hooks, own-company access, client-only document access, signed URL refusal, upload byte/type/size/auth/company checks use fake handlers/stores.
- **PASS — inline JavaScript parse:** both non-empty inline scripts compiled with `node:vm.Script`.
- **PASS — rendered review:** full, empty, loading, error at 1440, 390, 320; no page overflow; all phone row action buttons contained and at least 44px tall; native keyboard filter/sort and actual touch taps pass.
- **Not run by this page builder:** combined repository lint/TypeScript/full regression suite (root owns integration), database-backed tests, live account/session acceptance, deployment. No skipped database check is claimed as proof.

## Limits / remaining scope

No new uploader or delete path was added because the assigned staff page has neither; uploads remain in their existing client/file flows. Existing server-side constraints and all file/contract APIs remain the authority. Narrow tablet widths retain a contained horizontally scrollable table; checked phone widths use the file list. No live or customer-data claim is made from fixtures.
