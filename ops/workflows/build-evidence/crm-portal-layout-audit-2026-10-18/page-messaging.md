# Messaging page — professional layout evidence

Owner: `/root/page_messaging`. Scope: `public/app/messaging.html`, focused messaging browser spec, this note and its screenshots. Read AGENTS, assigned prompt, UI standards (owner's newer visual direction takes precedence), role-closer intended journey, heartbeat flow, shared audit board, messaging screen view-model checks, messaging inbox browser tests, CRM fixture harness, and data.js contracts.

## Before inventory (recorded before editing)

| Surface / condition | Existing contract | After / proof |
| --- | --- | --- |
| Staff gate and navigation | shell.js staff session/role gate; shared sidebar and header own account, scope, global search/chat | Preserved; no shared file edited |
| Inbox | GET `/api/read/inbox?limit=200`, default Needs reply adds `needs_reply=1`; all/reply buttons and exact IDs `nAll`, `nReply`, `convoList`; newest first from server | Preserved; existing 18 inbox browser cases + new keyboard/list/filter cases |
| Search | `q` filters names/body/channel among loaded rows; typing lifts reply filter through refetch; `hasMore` scope disclosure | Preserved; new per-width search asserts broad-query request and honest no-match state; unit scope checks |
| Thread | GET `/api/read/messages?conversation_id=…&limit=200`; reverse newest-first response for reading; exact `thName`, `thSub`, `thAv`, `thread` IDs; escaped message body and HTML email readable text; sender/automatic distinction; held/failed status on message | Preserved; existing thread reading/escaping/automatic cases; new per-width read order and message layout |
| Context | GET `/api/dashboard/client?id=…`; GET `/api/read/conversations?client_id=…&limit=50`; last activity, waiting on us, email, other-thread disclosure, `client-control-panel.html?id=…` link | Preserved; new per-width context assertions, same file destination; readable desktop rail / phone dialog |
| Channel | `chEmail`, `chText`, `composeChannelToggle`; switch opens existing conversation or empty channel for same client; never changes selected thread's channel | Preserved; new per-width Text→Email checks, prefill and quiet-note change; active state now also aria-pressed |
| Destination | `composeTo`, visible label/note; prefill from client record only while empty; override is message-only; valid email/E.164 check; empty retains server fallback; malformed disables button | Preserved; new override payload/invalid/empty-fallback cases; Enter now respects disabled Send rather than bypassing malformed destination |
| Reply | `composeBody` textarea, max 4000, disabled until selection, Enter sends / Shift+Enter newline; `sendBtn` | Preserved; existing disabled/empty/body/send cases; new keyboard rows, labelled textarea and touch/16px input check |
| Send | POST `/api/messages`; `body`, `idempotency_key`, optional `to`, existing `conversation_id` or new `client_id`+`channel`; no client writes | Preserved; existing successful send/idempotency case + new destination payload assertions; all requests mocked |
| Outcomes | Visible `sendStatus`; sending, sent, queued/deferred, opted-out blocked, unknown, unauthorized/clock-in, request refused; blocked/error preserves draft; accepted clears; no delivery claim from acceptance | Preserved; existing deferred/blocked/sent cases + new in-flight/opt-out/403 cases; busy button and live status added |
| Texting hours | Arizona 8am–8pm; displayed before typing and updates every minute; email hidden | Preserved; existing 3 texting-hours browser cases and unit boundary/source parity checks |
| Refresh | 30s list refresh skips hidden tab/in-flight send; failed quiet refresh retains screen; selection/draft preserved | Preserved unchanged timed refresh contract; source tests verify quiet failure/hidden/send skip; new manual refresh/retry |
| Deep links | UUID-validated `client_id` with optional email/sms; `conversation_id` can open older thread outside inbox page | Preserved; new browser checks both client+email and older conversation UUID outside loaded list |
| Reference | `demoToggle`, `demoBody`, `demozone` disclosure explains sender appearance; `footName` updates selection | Reference DOM/disclosure IDs preserved; it was and remains hidden by shared fundhub-brand.css demo-chrome rule. footName retained as accessible text; false nominal/version footer removed |
| Loading / empty / errors | Honest inbox/thread empty vs loading vs failed reads; no customer sample rows; composer off without selection | Preserved and improved; all 4 states checked at 1440/390/320, inbox/thread retry tested; initial skeleton and aria-busy added |
| Templates / attachments / contacts | No live template picker, attachment upload/download, contact-write or retry-send control exists. Only unused `.tmpl-btn` / `.attach` / `.retry-btn` CSS. Read contract does not return attachment UI. Preserve actual features, add none of those paths | Confirmed by inventory |

## Initial visual issues

Desktop compressed sender/preview/status hierarchy into dense rows. Phone inherited a shared `.client` panel-width rule that stretched avatars/status text and clipped row content, and stacked inbox, thread and context in independent scroll areas: conversation and compose destination were separated by long vertical travel. Old footer claimed “systems nominal” without proof. Sidebar/header are shared and out of scope.

## Verification

All browser APIs use an intercept-all `/api/**` fixture; unexpected writes return 403. No real sends or customer writes.

| Check | Exact command / scope | Result |
| --- | --- | --- |
| Messaging view model / contracts | `node --test src/http/messaging-screen.test.mjs` | 60 passed; 0 failed; 0 skipped |
| Existing + focused rendered journeys | `PLAYWRIGHT_CHROMIUM=/workspace/scratch/browser-tools/chromium E2E_PORT=43224 npx playwright test e2e/messaging-layout-professional.spec.mjs e2e/messaging-inbox.spec.mjs --reporter=line` | 30 passed in 12.6s; 18 existing + 12 focused |
| Focused syntax | `node --check e2e/messaging-layout-professional.spec.mjs` | Passed |
| Whitespace | `git diff --check -- public/app/messaging.html e2e/messaging-layout-professional.spec.mjs ops/workflows/build-evidence/crm-portal-layout-audit-2026-10-18/page-messaging.md` | Passed |
| Whole-repo lint / TypeScript / combined regressions | Root owns integration checks | Not rerun by this page builder |
| Backend delivery / production / real iPhone | Deliberately outside the safe page layout proof | Not run; mocked acceptance is not delivery proof |

Focused browser cases prove full/initial-loading/empty/read-error at 1440×1000, 390×1000 and320×1000. Every width checks no page overflow, circular avatar geometry and content containment within each inbox row, header clearance, reading order, channel identity, reachable composer/Send, keyboard ArrowUp/Down/Enter, search query behavior and thread/inbox retry. Phone cases also prove pane visibility, focused back navigation, client dialog focus loop/Escape, retained draft and file link. A 1024×900 case proves the details drawer does not squeeze three columns. A real Playwright touch context at 320×740 taps person/details/back and the composer; form fonts compute 16px to avoid iOS input zoom. A 390×844 case proves Sending→blocked and draft preservation without duplicate Enter send. Dedicated cases cover malformed-destination Enter refusal, 403 clock-in feedback and both deep links.

The first evidence fixture counted the shared hidden chat `.msg` along with thread messages; the assertion was scoped to `#thread .msg`. An initial reference-control test attempted the drawer hidden by the existing global demo-chrome rule; it now verifies the visible client-detail focus loop instead. Final 30-case run is all green. Visual review also caught the shared ≤390px `.client` panel rule stretching client avatars and status spans; page-scoped geometry now overrides that rule and the new row-containment assertions cover the actual clipping failure. A successful thread retry now clears its own prior error banner; recovery tests check the banner is hidden after both thread and inbox recovery.

## Render review

Reviewed the marked desktop inbox/thread/context composition and the 390/320 phone inbox/thread/context, loading, empty, failed-read and blocked-send images. Red boxes identify the affected workspace/pane and each image carries its review caption. Before images use the original HEAD page served through a local HTML response with the same shared frame and safe API fixtures.

| Width / state | Before | After |
| --- | --- | --- |
| 1440 full | [before](messaging/before-1440.png) | [thread/workspace](messaging/after-1440-thread.png) |
| 390 full | [before](messaging/before-390.png) | [inbox](messaging/after-390-inbox.png), [thread](messaging/after-390-thread.png), [client details](messaging/after-390-context.png) |
| 320 full | [before](messaging/before-320.png) | [inbox](messaging/after-320-inbox.png), [thread](messaging/after-320-thread.png) |
| 1440 states | — | [loading](messaging/after-1440-loading.png), [empty](messaging/after-1440-empty.png), [error](messaging/after-1440-error.png) |
| 390 states | — | [loading](messaging/after-390-loading.png), [empty](messaging/after-390-empty.png), [error](messaging/after-390-error.png), [blocked send](messaging/after-390-blocked.png) |
| 320 states | — | [loading](messaging/after-320-loading.png), [empty](messaging/after-320-empty.png), [error](messaging/after-320-error.png) |

## Result and limits

The inbox now has a stable list/conversation/context hierarchy, useful row spacing, visible sender/channel identity and a reply area tied to the active person. Phones show one pane at a time with explicit back controls; the desktop context column becomes a focus-managed dialog before it can compress the conversation. No endpoint, business payload, role rule or send outcome was replaced. No journeys, shared files, credentials, migrations, commits, deployment or live customer writes changed. Backend execution and an actual mobile OS keyboard remain unproven by these offline browser checks.
