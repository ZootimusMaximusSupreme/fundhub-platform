# Specialist workspace recovery — 2026-10-18

Source branch: codex/recover-inquiry-remover. Exact parent: 0998ff49969c6e2663a6e1851b4634ab5896113d.
Source checkpoint: 1be3ce2fb8a8ed7edb0c03e408a836d250b1eec9.

## Scope and presentation

Only inquiry-remover.html and inquiry-workspace.css change the product. The HTML adds one body class and one final stylesheet import. The page stylesheet establishes rounded neutral cards, readable section hierarchy, a dedicated next action, quiet filter controls, 44px action targets, visible keyboard focus, local table scrolling, mobile stacking and reduced-motion support. Legacy page logo/LIVE header is suppressed in favor of the shared workspace header. The existing footer retains staff identity and update description.

Root must retain the current shared chrome in the three-way merge; this source branch deliberately starts at the requested older parent.

## Before/after feature inventory

All behavior is preserved by retaining every script and DOM ID. Connector-side string comparison against the exact parent confirmed all 7 script blocks unchanged, all 56 ID attributes in the same order, and aside markup unchanged.

| Area | Preserved controls, conditions and contracts |
| --- | --- |
| Navigation | Existing aside, all compatibility links, sidebar collapse/group handlers and shared imports unchanged. Inquiries/Repair tabs and remembered pane remain. |
| Main action | Ready count, comparison, next eligible action, no-action/loading labels and session identity IDs remain. |
| Inquiry cases | Oldest-first cases, pagination, row details, bureau state, document readiness, delivery, calls and round status remain. |
| Inquiry detail | FTC/police PDF or image upload; generated letters; document link scoped by client; letter review and send; call bureau; mark cleared; close. Existing disabled-send and call conditions remain. System never files an FTC report; nothing mails without Send. |
| Work queue | Bureau filters, open/worked/call/confirmed metrics, row expansion, call-kind selector, call action, Mark confirmed, status input/update, expected-name input/save, identity reason/reveal, hold and attempts remain. |
| Letters | Actual issued-letter feed, no-letter state and All letters document link remain. |
| Repair | Need me/ready/waiting/stuck/trial filters, exception review, parsed-response confirmation, expanded file, staged letters, signed-agreement signature, individual letter drawer/send, bulk Send, Stage, Enroll remain. |
| Role limits | CRS soft pull only owner/admin/closer/funding_advisor. Erasure only owner/admin with existing irreversible-action confirmation. PII reason/audit and server roles unchanged. |
| Soft pull | Existing PULL typed confirmation, disabled confirmation button and error handling remain. |
| States | Existing loading placeholders, empty copy, error rendering, full queues, pagination and live status regions unchanged. No substitute customer rows or invented success data. |

API paths retained: /api/inquiries (including inquiry_id and recent=letters reads), /api/pii, /api/inquiry-cases, /api/inquiry?action=launch, /api/documents-upload, /api/read/inquiry-cases?active_only=true, /api/auth/session, /api/repair/send, /api/repair/exceptions, /api/finance/crs-pull, /api/read/repair-cases (including client_id), /api/repair/generate, /api/privacy/erasure, /api/repair/enroll. Request methods, bodies, authentication, consent/signature and provider gates are unchanged.

## Verification

PASS: connector-side exact comparison of every script block, ID sequence and aside against the requested parent. This is source preservation evidence only.

UNRUN: Playwright rendered 1440/390/320 full/empty/loading/error, screenshots, keyboard/touch exercise, lint, TypeScript and regressions. Executor is disconnected (exec-server 409 environment_offline / Environment is not connected). No local server or build is running. Existing e2e/specialist-desk.spec.mjs was read: its fixture intercepts cover inquiry confirmation columns, repair filter reloads and refused soft-pull feedback. Root should run that fixture and fresh responsive state checks after integration using current shared chrome.

No new tests were claimed or run. No live API/provider/money/customer writes were performed. The presentation is reviewable source, not browser-verified completion.
