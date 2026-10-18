# Contract templates — recovered page draft

Recovered through the GitHub connector from the original builder's retained tool-argument history. Base: `0998ff49969c6e2663a6e1851b4634ab5896113d`; isolated branch: `codex/recover-contracts`. Only the Contracts HTML, its page CSS, focused browser spec and this note are included. No shared assets, APIs, credentials, workflows, main-branch changes, legal/outbound writes or deployment.

## Recovery and reconciliation

The fetched production page still has the same template-authoring business behavior as the original layout assignment. Its inline sidebar is preserved byte-for-byte; the root owns integration with the recovered shared staff foundation. All 43 literal IDs in the fetched production page remain. The historical count of 49 additionally included six shared nav-group IDs from the original foundation. None of those page controls is removed.

| Feature | Preserved behavior |
| --- | --- |
| Access | Existing `shell.js` session resolution; hidden-until-confirmed owner/admin page. Server-side `OWNER_ADMIN_ACTIONS` remains untouched. |
| Library | Text and PDF templates; active/archived labels; same `tr[data-tid]` selection. Native buttons add keyboard access. |
| Text authoring | `tKey/tName/tKind/tSubtype/tBody/tTags/tFields/tStatement`; unchanged default signature sentence; manual field key/label/required/removal; optional subtype remains null. |
| Save / archive | Exact `create_template`, `save_template` and `archive_template` actions to `/api/contracts`; short key only on create, ID on edits; reversible active state. |
| Upload | Same PDF picker, short-name prompt, FileReader Data URL and `upload_template` payload with template_key/name/filename/file. Visible local feedback survives a hidden text editor. |
| PDF read | `FHData.read('contracts',{file:'template',template_id})`; same base64 payload and vendored pdfjs/worker; sequential page rendering. Width fits the available workspace. |
| PDF fields | Same text/date/checkbox/signature/initials and all manual/contact/signer/today sources. Fields remain on-page fractions; pointer/tap and keyboard equivalents preserve placement/move/resize/remove. |
| Consent / signers | Signature and initials force manual source; selecting auto-fill converts them to text. Default Client role, signer order and `signer_roles` are retained. |
| PDF save | Exact `save_fields` action/id/fields/signer_roles; only explicit Save boxes writes. |
| Read states | Same `view=templates` read after deferred data.js loads; real loading, zero/empty, failed read/retry and full states. Starting wording during a read failure does not erase the error. |
| Sent agreements | Existing Documents handoff retained. No client queue, sending, signer progress or download feature is invented on this admin template page. |
| Shared frame | Shared foundation owns title, scope, Search, Chat, Account and navigation. The hidden legacy status IDs remain available. |

## Verification status

**No recovered-branch browser, Node suite, lint or TypeScript run has occurred.** Executor/filesystem are offline. The historical local draft passed 27 browser cases and 43 source/security cases; those are historical evidence only and are not new passes for this commit. The original raster captures are not recoverable from text history and are not represented as attached artifacts.

Current connector-only checks: all 43 fetched production literal IDs retained; production sidebar exact; non-module inline page script and recovered browser-test bodies parse in-memory. These narrow checks do not substitute for integration testing.

Root should run after shared-foundation integration:

```sh
node --test src/http/contracts-screen.test.mjs
PLAYWRIGHT_CHROMIUM=/path/to/chromium E2E_PORT=43153 node node_modules/@playwright/test/cli.js test e2e/contracts-layout.spec.mjs e2e/contracts-wording-clicks.spec.mjs --reporter=list
```

The recovered spec contains 21 checks plus the 6 existing unchanged feature checks. It intercepts every API, blocks external HTTPS and uses fixture arrays for writes. It covers full/empty/loading/error at 1440/390/320, keyboard selection/cancel/new, exact PDF fractions and manual-signature guards, touch tap, real generated-PDF upload and refusal, owner/admin/closer boundaries, and mouse move/resize. It regenerates 18 marked review screenshots with red task-area boxes and captions.

Combined lint/TypeScript/regressions, physical-device use and live session/legal/outbound verification remain unrun by this builder. No live readiness or deployment claim is made.
