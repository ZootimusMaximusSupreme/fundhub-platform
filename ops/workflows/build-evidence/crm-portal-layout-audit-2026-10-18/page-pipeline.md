# Pipeline page layout rebuild

Scope: `public/app/pipeline.html`, pipeline-only styling and focused browser evidence. No backend, live writes, or outbound messages. Owner-authorized visual rebuild; current UI standards were read for behavior and technical constraints, not used as visual authority.

## Before: inventory and observed issue

Reviewed `AGENTS.md`, app field notes, UI standards, funding-advisor/closer generated journeys, pipeline source, four existing pipeline e2e specs, and the provided 390px before capture.

The phone capture spends ~240px on legacy header/session chrome, then internal R-01 labels, stacked triage totals, toolbar rows, and a long payment paragraph. The first card starts around y=770 and its actions are hover-dependent. Page-level LIVE/systems-nominal claims add no trustworthy task information.

Preserved inventory:

- Seven existing pipeline keys/rail mappings, parked Alt-Fin destination stays parked, API-derived stages and cards, stage and board counts/funding totals with existing per-rail semantics.
- Waiting-on-us/bank/client/no-record filters; oldest waiting-card link and visible ring; search; dynamic owner/age/sort/wait controls; active chips and Clear all; board/fulfillment view switch.
- Drag to stage and cross-pipeline MOVE with exact IDs/data attributes/API payloads, optimistic rollback, saved destination navigation.
- New Client apply-form save, required fields/products, error/cancel behavior; card/client drawer, credit/survey/prequal/round/agreements/messages deep links; archive gate requiring exact DELETE.
- Fulfillment client list, six honest rollups, chips/blockers, unknown/error/empty states, and read-only semantics.
- Payment versus sales-stage explanation; staff/role/tenant/client context remains controlled by unchanged shared/session/API logic.

## Planned composition

Compact page heading and All clients scope; accessible pipeline button strip; compact waiting summary; search/view/filter controls directly above the board; payment-stage guidance in Board details; useful client cards in the initial phone screen. Board scroll remains inside its container. Legacy footer becomes optional technical details. Native buttons, keyboard focus, touch-visible card controls and a same-board stage picker provide an accessible alternative to dragging.

## After and validation

Implemented in `public/app/pipeline.html` and `public/app/pipeline-workspace.css`; focused coverage in `e2e/pipeline-workspace.spec.mjs`.

- Removed the legacy page topbar, LIVE badge, clock and nominal-systems footer. Shared header supplies the single Pipeline / All clients identity. Board details retain technical reference and interaction guidance behind a disclosure.
- Native pipeline buttons keep all seven data-rail mappings and now expose pressed state. No parked destination was restored.
- Warm paper surfaces, quiet stage columns, readable client cards and one black New Client action. Filter controls stay compact; the entire board scrolls in its own region. On phones, a compact summary row shows waiting and card counts. Category filters, the funding total and the zero-wait explanation remain in the native Details disclosure; the oldest waiting-client link stays visible when relevant. Desktop retains the expanded breakdown.
- Move and Archive are native buttons visible without hover. Same-pipeline destinations join the unchanged cross-pipeline routes in Move; arrows navigate, Escape restores focus, and keyboard activation saves through the same API. A touch-only handle retains drag while the rest of a card can scroll naturally.
- Search label now accurately says name search (existing logic remains name-only). Select labels and keyboard-clear buttons added. Closed drawer is inert; keyboard opening moves focus into it. Phone preview fills the space below the shared header; modal focus stays within controls, Escape/cancel returns focus.
- Sales instruction is now one short sentence in Board details, preserving the fact that payment never advances a sales card automatically. Card-count grammar uses “1 card.”

Measured with 40 synthetic cards at 900px height:

| Viewport width | Page overflow | First card top | First card bottom | Board height |
|---|---:|---:|---:|---:|
| 1440 | 0px | 390px | 614px | 568px |
| 390 | 0px | 395px | 605px | 553px |
| 320 | 0px | 395px | 623px | 553px |

The provided before capture puts the first card near 770px on a 390px phone. The finished capture starts that card at 395px, showing the entire first card and its actions by 623px even at 320px width. With zero waiting, the phone summary is 58px tall and the first card starts at 374px (390px and 320px views, 780px tall). The 320px drawer uses the full width and more than 600px of usable height at a 780px viewport.

Verification:

- Existing four pipeline specs + the new workspace spec: **42 browser tests passed**, including honest loading/empty/error/full states, exact move/archive/new-client payloads, archive/new-client refusal behavior, waiting filters and stage clock, visible focus ring, drag, keyboard and touch.
- Initial workspace recheck after drawer/focus refinements: **7 passed**; includes a real Chromium touch event sequence dragging the handle into Booked.
- Finishing pass: **25 focused browser checks passed** (waiting-on + workspace specs), including full and zero-wait states at 1440/390/320, a measured in-viewport details popup, keyboard disclosure/counter filters/Move, Board details guidance, touch drag and the phone drawer/form. The old phone counter-position check now opens the new disclosure using the keyboard before measuring it.
- Visual QA caught and fixed an inherited max-width squeezing the disclosure; the new popup-width assertion prevents that regression. All finishing captures were opened and inspected.
- `node --test src/http/pipeline-screen.test.mjs`: **100 passed**, no skips.
- All four inline pipeline script blocks and the focused spec parse; `git diff --check` is clean. Shared/global lint belongs to integration. No TypeScript configuration/script exists for this HTML/CSS page.
- All API interactions intercepted by the offline harness. No backend/live/customer write or outbound action occurred. Browser touch emulation is verified; a physical phone was not used.

Evidence:

- `pipeline-before-390-marked.png`, `pipeline-after-390-marked.png`, `pipeline-after-320-marked.png`: red-boxed review captures with captions.
- `pipeline-after-1440.png`, `pipeline-after-390.png`, `pipeline-after-320.png`: unmarked full workspace captures.
- `pipeline-zero-after-1440.png`, `pipeline-zero-after-390.png`, `pipeline-zero-after-320.png`, `pipeline-zero-after-320-marked.png`, `pipeline-zero-details-390.png`: compact zero-waiting states and expanded details.
- `pipeline-drawer-320.png`, `pipeline-new-client-320.png`, `pipeline-fulfillment-390.png`: focused states.
- `pipeline-metrics-*.json`, `pipeline-zero-metrics-*.json`, `pipeline-playwright.txt`, `pipeline-workspace-playwright.txt`, `pipeline-finishing-playwright.txt`, `pipeline-source-tests.txt`: measured output and checks.

Limitations: stage/pipeline scrolling remains horizontal inside its own region by design. Search remains the existing name-only filter; phone/email values keep their messaging deep links. This page relies on the new shared staff header for its h1 and scope. No commit, push or deploy performed by this page builder.
