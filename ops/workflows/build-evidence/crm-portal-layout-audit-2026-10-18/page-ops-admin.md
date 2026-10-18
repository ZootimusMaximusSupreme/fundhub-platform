# Ops Admin layout recovery — 2026-10-18

Source commit: c0717a1d30c0ae7ccafd1c816da4bcf5a87e8f9c
Recovery branch: codex/recover-ops-admin
Exact parent: 0998ff49969c6e2663a6e1851b4634ab5896113d

## Feature inventory and retained behavior

| Surface/control | API or destination | Retained states and rules |
| --- | --- | --- |
| Money / People tabs | Local panel switching | Both panels, selected tab and hidden panel semantics preserved |
| Period menu | GET /api/dashboard/kpis?period=; GET /api/read/ops-pulse?period= | Today, 7d, 30d, quarter; computed dates; unavailable metrics stay unknown |
| Daily briefs | GET /api/read/ops-pulse | Loading, error, empty, briefs and conditional action remain |
| Write today's C-suite tasks | POST /api/ops/hire-closer | Conditional visibility, working/disabled and saved/failure messages preserved; never invoked during this work |
| Collections | GET /api/read/invoices?status=open&limit=50 | Unpaid ordering, client/invoice labels, balance null versus zero, overdue words, total, 25-row limit, empty/failure preserved |
| Compliance | GET /api/read/messages?status=blocked&limit=30 | Full/empty/error renderers; initial state now truthfully loading |
| Failed events | GET /api/read/failed-events?status=pending&limit=200 | Existing dynamically cloned tile and count preserved |
| Staff compensation / monitoring consent | GET /api/read/staff?limit=200 | Names, roles, unknown pay, consent labels, hidden owner/seeded counts preserved; initial state now loading |
| Outbound mail | GET /api/messages-outbound | Queue summary and routing; controls hidden until status read |
| Send / toggle / invoice backlog | POST /api/messages-outbound | Existing real-recipient confirmation and queue checks unchanged; staff can read, owner/admin actions enforced by API per existing source comment |
| Affiliates + Hiring | Details and affiliate.html link | Summary, empty detail and separate real destination preserved |
| Table interactions | Existing page scripts | Sort headers, expandable AR wiring preserved |

Shared sidebar markup, script imports, all 41 IDs and the complete business-script suffix are unchanged. No role gates, backend, schemas, URLs, request bodies or API implementations were changed. Endpoint paths traced through data.js; role comment is source evidence, not a live permission test.

## Presentation changes

Daily briefs precede supporting KPI tiles. Page-specific CSS gives warm off-white surfaces, quiet black type, rounded panels and controls, readable tables and keyboard-focusable horizontal table regions. Money and People remain visible destinations. Supporting affiliate/hiring details remain expandable. Local topbar brand/clock and obsolete signed-in-as-owner footer are hidden; shared shell retains identity. Footer period element remains for its existing handler.

## Proof and remaining integration work

- Source inspection performed through GitHub.
- String comparison verified business scripts unchanged byte for byte; ID counts remain 41 before and after.
- Browser renders, screenshots, keyboard/touch tests, loading/full/empty/error fixtures, lint and TypeScript: **UNRUN**, because the cloud executor is disconnected.
- No rendered quality, mobile fit or real-session permissions claim is made.
- Root owns integration against current shared chrome and the 1440/390/320 fixture/browser matrix.
- No real customer, outbound, payment, bank or migration actions were taken.
- No new isolated test was added: the parent is running the combined page/browser fixtures and existing feature assertions after integration.
