# What the proofs found — real product problems, 2026-10-14

Found while writing exact-result tests for the 1,553 'not proved yet' rows. Nothing here was fixed (tests only). Each is a leftover card for the walk-through, not a headline. Wording is the builders' own; verify before acting.

**Highest weight first (read these before the rest):**
- `api/pii.mjs` read, reveal and history look a person up by client id only, with no company check (S3). Same shape: `api/partner-brand.mjs` (S3).
- Any signed-in staff role, including setter, closer and CSM, can save an AI agent's prompt and promote it live (S2).
- Present 'Save month/year' crashes: `api/soft-pull-approve.mjs:279` calls `stampIncorporatedAsStaff`, which is not defined anywhere (S3; already a leftover card).
- The SMS duplicate-text guard is imported by nothing, so it never runs (S2). Web push `sendToClient` has no caller (S2). Finance alerts are written to `owner_notifications` and nothing sends them (S2).

## S1 — Money routes and screens
- closer-deck send_ebook: the row says it mints an ad-hoc priced pay link and sends it, but the handler refuses the action as unknown_action (retired). The map row is stale or the feature was removed. Left not proved; the refusal is pinned in s1-door-closer-deck.test.mjs.
- Sales floor 'Funded, not just sold' target bar: public/app/sales-floor.js sets the bar width to 0% every time, so the target bar never moves. The row names the bar. Left not proved.
- Products and Commissions ledger table: the page hardcodes Client and Rule version as dashes, so the table cannot show the values the row names. Left not proved.
- public/optimize.html has no Pay for Audit control and never POSTs to /api/public/optimize (it only GETs the config); the map row says it posts and mints the $32 checkout. The route itself is proved; the page row is left not proved.
- pipeline-cards: a Funded move with no confirmed bank yes answers 404 with error no_confirmed_approvals, the same status as a missing stage, because the handler only maps funded_amount_required and approval_amounts_missing to 400. Nothing moves, but the status is misleading.
- api/products.mjs: default_success_fee_percent uses COALESCE($9, default_success_fee_percent), so the fee percent can never be cleared back to empty through save.
- GET /api/read/sales-floor attaches Drive recordings to calls and clients (a write on a GET), as the row itself notes. Not provable from a browser; left as is.
- Shared scratchpad collision: another builder overwrote scratchpad measure.mjs mid-run. Builders should use unique file names.

## S2 — Customer messages
- Any signed-in staff role, including setter, closer and CSM, can save an AI agent's prompt and guardrails and promote it live: api/agents.mjs gates on every staff role and the promote action has no role check.
- The consulting page does not match its intended journey: the journey says three posted prices ($5,000, $5,000, $10,000), education wording, and an enrollment mail to support@fundhub.ai; the live page says marketing consulting for agencies, shows no posted price, and mails support@fhconsulting.online.
- GET /api/social/posts?partner_id= returns a partner's queued posts to any staff role; the journey reading limits it to owner and admin, but that limit only guards approve and reject.
- The client journey says clients stay blocked from banking, but banking/link-token and banking/link-exchange answer a signed-in client, and the 17 money/* routes plus blueprint/declines serve a client's own file; the written journey reading calls them staff-only.
- The SMS duplicate guard (src/messaging/sms-dedup.mjs) is imported by nothing, so it never runs.
- Web push sendToClient has no caller, so no client push can ever be sent.
- owner_notifications rows are written for finance alerts and nothing reads or sends them.
- A staff text or email to a client with no address on file is still queued with no destination and only fails later at the sender.
- Several routes (partner-marketing/*, social/*, brand/review, money/setup) refuse an empty body with 400 before checking the role, so an empty signed-in request cannot tell their role gate; the probe names them and does not count them.

## S3 — Customer-data routes and reads
- POST /api/soft-pull-approve with action=stamp_incorporated crashes: api/soft-pull-approve.mjs line 279 calls stampIncorporatedAsStaff, which is never defined or imported, so it throws ReferenceError. The Present screen (public/app/present.js:1610) calls this action, so the stamp-the-incorporation-date button gets a server error.
- GET and POST /api/pii have no company check: readIdentity, revealSsn and accessHistory look a person up by client_id only and the handler never calls requireClientInOrg. A signed-in owner, admin, funding advisor or inquiry specialist of one company who has another company's client id can read that person's date of birth, addresses, last four and access history, reveal the full SSN, or overwrite the identity. Demonstrated with a stand-in database: session in company A got company B's row, and the query had no org filter.
- GET and PUT /api/partner-brand have no company check: the gate is role only (owner or admin) and the read is WHERE partner_id = $1; the write looks up the partner's own company and writes into it. An admin of company A holding a white-label partner id of company B can read and change B's brand (trading name, address, support email, domain, funnels). Demonstrated: session in company A got 200 and the write was bound to company B.
- Wording only: auth/authorized-rep remove says it ends their sessions, but the code stamps the link removed and repoints (or clears) the sessions' active file; the session rows are not revoked. The login can no longer act on the removed file, so I proved the real behaviour and kept the row proved.
- Stale lane list, not a product bug: 12 of the 27 read rows were still printed NOT_PROVED by gap-catalog-reads.mjs although exact real-browser proofs already existed in flow-read-contracts, display-contracts-ab and display-contracts-ef-public; I verified each by breaking its page and moved them to the proved list.

## S4 — Customer-data screens
- Contracts PDF editor: dragging a box changes the saved position (x 0.40 to 0.50) but the box on screen stays where it was drawn until something redraws it, so what you see is not what Save boxes stores. Row 'PDF editor: drag on a page to draw a box; click a box to select; drag to move; drag corner to resize' left NOT_PROVED.
- Lenders: one Apply press can start two proxy sessions. proxy-apply.js binds a click handler to every [data-fh-apply] button at DOMContentLoaded and lenders.html also adds its own handler to each Apply button it draws; if the list is drawn before the page finishes loading, one press sends two /api/proxy/launch requests (seen as launch count 2 on a busy machine). The two Apply rows are left NOT_PROVED.
- Climate lead magnet is not on the shipped page: public/climate/index.html is a lending-climate dashboard with no 'See how many banks in our book fit your state' button and no four-answers form, and no page in public/ calls /api/public/climate-match. Both rows describe controls that do not exist there.
- Leads list page is not in the repo: the row names public/leads/<32-hex>/index.html but no such folder is committed, so it cannot be tested.
- Pipeline map rows say every column 'shows count and funding est.', but the page deliberately shows the funding total only on the Sales, Card Stacking and altfin rails (owner call 2026-08-28). 46 column rows have stale text; proof checks count, no total on other rails, and the exact drop request. Map text should be corrected; not a product bug.
- Content admin: Clear leaves the old file's name in the Title box, so choosing a second file keeps the first file's title (small; not tied to a row).
- Read-lane tests 'the 64 proved read rows ...' and its nested rendered-page proofs fail when the whole catalog set runs at once (agent-editor promote/demote spec timing); not caused by this slice.

## S5 — Staff-only and the rest
- Eleven links are in public/app/sidebar.fragment.html but shell.js hides them from every role that has a rail (owner, admin, sales manager, closer, funding advisor, CSM, setter, inquiry specialist, partner): Home, Galaxy, Ops & Admin, Agent Editor, Workflows, Journeys, Consent, Finance OS, Hiring, Brand Studio, Affiliate. No person can click them from the rail, so the map rows that describe them are stale or the rows are hidden by mistake.
- The sidebar sections Home, Watch and Automation have no visible head for any role, so the row that says 9 section heads fold and unfold is only true for 6.
- hiring/postings, hiring/funnel and hiring/candidates filter on (SELECT id FROM orgs WHERE is_default LIMIT 1) instead of the signed-in staff member's company, unlike every other read in this slice. Fine with one company; a leak risk if a second company is ever added.
- In e2e/marketing-command-center.spec.mjs the case named 'the footer clock, the 5-minute reload, the reload on focus...' stayed green when REFRESH_MS was changed to 50 minutes, and the 'gear' and 'tab strip' cases stayed green when tab placement was forced to 'strip'. Those cases may not check what their names say.
- In e2e/marketing-cc-settings.spec.mjs the case named 'a 409 shows both versions; Keep mine saves over the newer one; Use the saved one drops mine' never clicks Keep mine; the separate case 'Keep mine sends the same change again...' does.
- e2e/marketing-cc-settings.spec.mjs / catalog map: the map evidence for many Command Center rows names broad spec cases for compound rows (six flywheel steps each with run, Read it, Approve, Tweak, Resume/Start over/Retry) that cover only part of the claim; those rows were left not proved.
