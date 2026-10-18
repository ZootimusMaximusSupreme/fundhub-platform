# Batch 27 manifest — Workflow F display-proof recheck

Branch `codex/heartbeat-display-proof-f`, cut from `2d7bd9bbb`. Nothing was pushed or merged.

## Numbers

| | Count |
|---|---:|
| Assigned display rows | 45 |
| Open before | 45 |
| Attached to an exact saved-result contract | 0 |
| Attached to an exact fake-data practice test | 0 |
| Honestly not attachable | 45 |
| Open after | 45 |

These are not unclaimed rows. Each one was already left red by an earlier batch because the shipped
control is wrong or cannot be reached. This recheck read the current product and reran the focused
guards. Attaching a passing check would either pin the bug, invent data the product does not return,
or test only the working half of a broken control. All 45 therefore remain `NOT_PROVED`.

## Every assigned row

| # | Exact row ID | Outcome | Current blocker | Evidence |
|---:|---|---|---|---|
| 1 | `catalog-display:desks-a.json:agent-editor.html:Agent list row (click to open an agent, confirm discard of unsaved edits)` | not-attachable | Confirming discard keeps the edited words but clears the unsaved mark. | `fin-b09-g2-findings.test.mjs` |
| 2 | `catalog-display:desks-a.json:client-control-panel.html:Businesses cards: Save month/year button (stamp incorporation)` | not-attachable | The click path calls the undefined `stampIncorporatedAsStaff`. | `fin-b06-display-browser-2.test.mjs` |
| 3 | `catalog-display:desks-a.json:client-control-panel.html:Credit partner links: Open the partner's file, Record the partner's own consent` | not-attachable | The page changes `href` but leaves the old `data-fh-href`; the shell rewrites both links to the primary client. | `fin-b10-client-control-panel.test.mjs` |
| 4 | `catalog-display:desks-b.json:documents.html:Status filter select (not generated, generation failed, not delivered, bounced, awaiting signature, signature expired)` | not-attachable | The saved schema/page mapping cannot produce the first two promised states. | `fin-b12-not-attachable.mjs` |
| 5 | `catalog-display:desks-b.json:galaxy.html:Rail pulses (six rails: Sales, Card Stacking, Optimization Rounds, Inquiry Removal, AR + Collections, Affiliates + Hiring) and hand-off threads` | not-attachable | The handoff routes and client names are randomly invented instead of read from a saved handoff. | `fin-b12-not-attachable.mjs` |
| 6 | `catalog-display:desks-b.json:galaxy.html:Legend strip (size, brightness, pace colors)` | not-attachable | Output, activity, and state are randomized; a blocked saved state never reaches the legend. | `fin-b12-not-attachable.mjs` |
| 7 | `catalog-display:desks-c.json:hiring.html:Page load: fires demo/mode + candidates + postings + decisions + bench reads, paints tiles, board and tables` | not-attachable | The page still anchors its window to the fixed date July 30, 2026. | `fin-b13-hiring-page.test.mjs` |
| 8 | `catalog-display:desks-c.json:hiring.html:Funnel: role select + days select (30, 90, 180, 365, 730) -> where applications come from` | not-attachable | The same fixed 2026 date makes the selected day window wrong. | `fin-b13-hiring-page.test.mjs` |
| 9 | `catalog-display:desks-c.json:hiring.html:Decisions log: role select, days select, decision-kind rail (advance, reject, offer, offer_accepted, offer_declined, withdraw, hold)` | not-attachable | The same fixed 2026 date makes the selected day window wrong. | `fin-b13-hiring-page.test.mjs` |
| 10 | `catalog-display:desks-c.json:lenders.html:Export CSV button (downloads lenders.csv for the current filters)` | not-attachable | The page downloads a 403/error body as `lenders.csv` instead of refusing the export. | `fin-b14-lenders.test.mjs` |
| 11 | `catalog-display:desks-c.json:lenders.html:Lender row Save button (writes the 7 fields, stamps last_updated_by)` | not-attachable | A blank name is sent as null; the handler stringifies null and reaches a database failure. | `fin-b14-lenders-handlers.test.mjs` |
| 12 | `catalog-display:desks-c.json:lenders.html:AI bureau config: Add bureau row button (adds an empty editable row)` | not-attachable | Redrawing the table discards unsaved edits in existing bureau rows. | `fin-b14-lenders.test.mjs` |
| 13 | `catalog-display:desks-c.json:messaging.html:Right panel: 'Their other threads' list and 'Open elsewhere -> Their file' link` | not-attachable | The conversation-id stub has no client, so the file link becomes `?id=null`. | `fin-b16-messaging.test.mjs` |
| 14 | `catalog-display:desks-c.json:messaging.html:Reference disclosure (who-sent-it colour key)` | not-attachable | The disclosure is hidden by `display:none !important`. | `fin-b16-messaging.test.mjs` |
| 15 | `catalog-display:desks-c.json:messaging.html:Deep links: ?client_id=, ?channel=, ?conversation_id= open a thread straight from another desk` | not-attachable | An unknown conversation opens an unnamed client with no client record. | `fin-b16-messaging.test.mjs` |
| 16 | `catalog-display:desks-c.json:journeys.html:Page gate: owner and admin author journeys (PUT/ask/run answer 403 to others); no sidebar row exists (NAV_HIDDEN), reached only by URL or link` | not-attachable | The run endpoint still admits `sales_manager`. | `fin-b14-journeys-handlers.test.mjs` |
| 17 | `catalog-display:desks-c.json:journeys.html:Step panel: 'Make the change' (AI rewrites one step) and canvas ask box 'Make the change' + example prompts` | not-attachable | A delete-only AI patch is treated as empty, so the review bar never appears. | `fin-b14-journeys.test.mjs` |
| 18 | `catalog-display:desks-c.json:journeys.html:Step panel: 'Run from here' (plays the journey in the browser from this step)` | not-attachable | Starting inside an unchosen branch begins at the top instead of the selected step. | `fin-b14-journeys-run.test.mjs` |
| 19 | `catalog-display:desks-c.json:journeys.html:Bottom bar: Discard (revert unsaved edits)` | not-attachable | The page-wide dirty counter is zeroed while edits in another journey remain stranded. | `fin-b14-journeys.test.mjs` |
| 20 | `catalog-display:desks-c.json:money-banks.html:Page gate: client reads own file; staff (owner, admin, sales_manager, closer) need ?client_id=; only staff see plan controls` | not-attachable | Any client can reveal staff controls by adding `?client_id=` because staff is derived from the query value. | `fin-b07-page-gates.test.mjs` |
| 21 | `catalog-display:desks-c.json:inquiry-remover.html:Page gate: inquiry_specialist, owner, admin, funding_advisor roles; setter/closer-only roles bounced` | not-attachable | A work-queue endpoint still allows broad staff access. | `fin-b07-page-gates.test.mjs` |
| 22 | `catalog-display:desks-c.json:inquiry-remover.html:'Show more' button under the case queue (25 rows a time)` | not-attachable | One click sets the page size to every case instead of adding 25. | `fin-b13-specialist-desk.test.mjs` |
| 23 | `catalog-display:desks-c.json:inquiry-remover.html:Case row: click or Enter expands the case drawer (items, letter draft, identity packet, send options)` | not-attachable | A general case row opens by click but has no Enter-key path. | `fin-b13-specialist-desk.test.mjs` |
| 24 | `catalog-display:desks-c.json:inquiry-remover.html:Work queue table: one row per disputed inquiry line (Client, Bureau, Actual, Expected, Call state, Hold, Attempts, Status)` | not-attachable | The page checks `holding`, while the saved enum returns `on_hold`. | `fin-b07-live-cases-work.test.mjs` |
| 25 | `catalog-display:desks-c.json:inquiry-remover.html:Stat tiles: Still open, Worked, Calls, Confirmed (move by the server's counts after each write)` | not-attachable | The client increments confirmed/worked even when the row was already worked. | `fin-b13-specialist-desk.test.mjs` |
| 26 | `catalog-display:desks-e.json:public/app/ops-admin.html:AR column header sort (click or Enter on Client, Invoice, Amount owed, Overdue, Status)` | not-attachable | Handlers bind before `paintAr` replaces the header, leaving the visible header inert. | `fin-b18-ops-admin.test.mjs` |
| 27 | `catalog-display:desks-e.json:public/app/ops-admin.html:AR row expand (terms, payment method, owner, outstanding, collection history)` | not-attachable | Painted rows have no expansion marker and the read lacks the promised fields. | `fin-b18-ops-admin.test.mjs` |
| 28 | `catalog-display:desks-e.json:public/app/partner-galaxy.html:Sky canvas: click a cluster to zoom (5 static clusters: Fundhub fulfillment, Sales & Funding, Inquiry Removal, Client-Facing Agents, Ops Agents)` | not-attachable | Display and pointer coordinates differ; Inquiry Removal zooms the wrong cluster. | `fin-b18-partner-galaxy.test.mjs` |
| 29 | `catalog-display:desks-e.json:public/app/partner-galaxy.html:Sky canvas: click a worker to open the detail panel (NODES, CLIENTS and ROUTES are empty arrays, so no worker exists to click)` | not-attachable | No worker exists because all three source arrays remain empty. | `fin-b18-partner-galaxy.test.mjs` |
| 30 | `catalog-display:desks-e.json:public/app/partner-galaxy.html:Sky canvas: click empty space or press Escape to pull back; panel close button (esc)` | not-attachable | Pullback works, but the detail panel cannot be opened, so its close control is unreachable. | `fin-b18-partner-galaxy.test.mjs` |
| 31 | `catalog-display:desks-e.json:public/app/pipeline.html:Search box (placeholder says name, phone, or email; the filter compares the card's name text only)` | not-attachable | Search still compares names only. | `fin-b19-pipeline-controls.test.mjs` |
| 32 | `catalog-display:desks-e.json:public/app/pipeline.html:Sort: Manual / Name A-Z / Amount high first / Longest in stage / Amount needed first` | not-attachable | Choosing Manual does not restore the original order. | `fin-b19-pipeline-controls.test.mjs` |
| 33 | `catalog-display:desks-e.json:public/app/pipeline.html:The x on each active filter chip (clears that one filter)` | not-attachable | Closing the sort chip clears the select but leaves the cards sorted. | `fin-b19-pipeline-controls.test.mjs` |
| 34 | `catalog-display:desks-f.json:products-commissions.html:Commission rule 'See these payouts ->' (opens the ledger filtered to the people the rule pays)` | not-attachable | The ledger read does not return `rule_id`, so every rule opens the Everyone view. | `fin-b17-products.test.mjs` |
| 35 | `catalog-display:desks-f.json:products-commissions.html:Ledger table (date, person, client, product, rule version, basis, rate, payout, status)` | not-attachable | Client and rule version are hardcoded blank; basis is parsed as a number and split percent is shown as rate. | `fin-b02-live-contracts.test.mjs` |
| 36 | `catalog-display:desks-f.json:sales-floor.html (+ sales-floor.js):Hero: 'Today' deposits, booked and held, 'Funded, not just sold' rate and target bar` | not-attachable | The bar is always painted at 0%, and the read has no daily target. | `fin-b02-hero-bar.test.mjs` |
| 37 | `catalog-display:desks-f.json:social-studio.html:Load-time probe: three silent GETs of the connect URL (facebook, instagram, linkedin) to grey out a button whose app is not set up` | not-attachable | The probe runs before partners load, finds no partner, and is never rerun. | `fin-b21-display-practice.mjs` |
| 38 | `catalog-display:desks-f.json:social-studio.html:Writer: 'Send at (optional) - times are UTC' box` | not-attachable | The writer interprets the local browser value with `new Date(value)`, shifting Phoenix input by seven hours. | `fin-b21-display-practice.mjs` |
| 39 | `catalog-display:desks-f.json:social-studio.html:Tab 'Could not be sent' (posts that gave up after 3 tries, plus the one open 'job to fix' strip)` | not-attachable | The tab reads only `marketing_content_queue`, which cannot contain failed `social_posts`. | `fin-b04-display-results.test.mjs` |
| 40 | `catalog-display:desks-f.json:social-studio.html:Tab 'Sent' (posted, with the reference on the account)` | not-attachable | The tab reads only `marketing_content_queue`; posted rows and their references live in `social_posts`. | `fin-b21-display-practice.mjs` |
| 41 | `catalog-display:desks-f.json:social-studio.html:Post row click / Enter (expand details) and 'See the details' (opens the side drawer)` | not-attachable | The drawer reads `p.screening`, but the API never returns that object, so it throws before opening. | `fin-b21-display-practice.mjs` |
| 42 | `catalog-display:desks-f.json:social-studio.html:Side drawer: close X, click outside, Escape` | not-attachable | A real API row cannot open the drawer, leaving all close paths unreachable. | `fin-b21-display-practice.mjs` |
| 43 | `catalog-display:desks-f.json:teleprompter.html (+ teleprompter.js, teleprompter-edits.js):Settings sheet: speed, text size, line width, reading line, extra time on a gap sliders; mirror, flip, countdown toggles; 4K / 1080p pills; Learn remote (6 slots); Clear learned buttons` | not-attachable | The sheet exists, but no on-screen control opens it. | `fin-b21-teleprompter.test.mjs` |
| 44 | `catalog-display:desks-f.json:teleprompter.html (+ teleprompter.js, teleprompter-edits.js):'This shoot' script list sheet (tap a script to roll it)` | not-attachable | The sheet exists, but no on-screen control opens it. | `fin-b21-teleprompter.test.mjs` |
| 45 | `catalog-display:public-pages.json:button:climate/index.html#Click a state: shows its sco:Click a state: shows its score and a plain sentence (drawn by bundled scripts; listed from docs/journeys/climate-lead-magnet-intended.md)` | not-attachable | The shipped result shows score/band/numbers but no plain-language state sentence. | `fin-b09-g2-findings.test.mjs` |

All evidence paths above are under `src/pulse/catalog/proofs/`.

## Commands and results

- `node scripts/pulse/count-not-proved.mjs /tmp/heartbeat-display-f-before.json`: 57 total; 45 display.
- Focused current-behavior suites for batches 09, 13, 14, 16, 18, and 19: 58 tests, 58 pass.
- The batch 09 browser finding suite initially could not bind localhost inside the sandbox; the same command rerun with local permission passed 3/3.
- Combined prior-batch display guards: 1,146 tests, 1,143 pass, 3 fail. The three failures are existing batch-21 database-backed wiring assumptions returning `skip` instead of `PASS`; no Workflow F file changed them.
- `display-proof-cases.test.mjs` stale aggregate-count guard: expected 637 red rows, actual 119. It was not changed to a guessed number.
- No lint run: this batch changes documentation only.

## Files and safety

- Added only this manifest.
- No product, proof registry, generated catalog, route proof, flow/read proof, environment, production, or customer-data file changed.
- No mutation check was run because no passing contract or practice test was attached. The focused tests instead confirm the present product fails or cannot reach every assigned promise.
