# CRM screen links — heartbeat gap

Lane: CRM links and records that should show and do not.
Date: 2026-10-08.
Company: Fundhub.

This lane does not text anyone. It does not charge. It does not pull credit.
Recon (AG-07) stays the only tripwire. This is not a second watchdog.

The check is `gapChecks` in `src/pulse/coverage/gap-crm-links.mjs`.
It takes `db`, `orgId`, `now`, `fetchImpl` and `baseUrl` from the morning run. It only uses GET and HEAD and plain SELECTs. It does not submit a form. It reads no file from the repo.

## Already watched (this lane does not repeat it)

The morning registry pings these. It does not read what is inside them.

- The four screens: `reg:pipeline`, `reg:client-control-panel`, `reg:closer-dashboard`, `reg:sales-floor`. A desk page must answer 2xx.
- Every other `/app` page. Each has a `reg:` row.
- The read routes: `reg:dashboard/pipeline`, `reg:dashboard/pipeline-counts`, `reg:dashboard/clients`, `reg:dashboard/client`, `reg:read/sales-floor`, `reg:read/tradelines`, `reg:read/documents`, `reg:read/lenders`, `reg:read/lender-matches`. A 401 counts as up. That only shows the route loads.
- `live-playwright:desks`: the nightly staff-login walk of the desks. It is red if no good sweep ran in 26 hours.

Other lanes own these reads, so this lane leaves them: the sales floor numbers (`sales-manager:*`), the client's next step (`fulfillment:*` and `funding:*`), and documents (`documents:*`).

## Checks (10, plus one row per dead link or script)

| Id | FAIL when |
|---|---|
| `crm-links:pages` | (PASS or skip only.) Every `/app` link on the four screens was read over HTTP. See the dead-link rows below. A screen that will not load is a skip with the reason. |
| `crm-link:<file>` | A screen links to a page that is not a desk page, and that page answers 404 or 500. |
| `crm-script:<file>` | A screen loads a script that answers 404 or 500. The screen cannot work without it. |
| `crm-links:bank-logos` | A bank logo file does not load (HEAD), or a stored logo path is one the page can never load (`assets/lenders/x.png` with no leading slash, or any path with `..`). Each morning: the 10 newest logos and a rotating 40 (all 596 come round in 15 days), plus the placeholder. Bad paths are always all named. |
| `crm-data:pipeline-cards` | There is no sales rail, the sales rail has no columns, or a card sits on a rail with no column or with no client or partner. The board drops those cards. |
| `crm-data:pipeline` | The Pipeline board read for the sales rail throws, or the sales rail has no columns (the route answers 404). Runs the same two SELECTs as `api/dashboard/pipeline`. |
| `crm-data:pipeline-counts` | The rail count read throws or returns no pipelines (every rail tab would show a dash). Runs the same SELECT as `api/dashboard/pipeline-counts`. |
| `crm-data:clients` | The Pipeline client list read throws, or comes back empty while a client is on file. Runs the same SELECT as `api/dashboard/clients`. |
| `crm-data:lenders` | The bank book is empty, or banks are on file and the bank list read returns nothing, or the read throws. Uses `listLenders`. |
| `crm-data:client` | A client is on file and the control panel read returns no person, or throws. Uses `readClientStepRows` plus the payments and messages SELECTs from the same route. |
| `crm-data:lender-matches` | The bank match read returns no list, says the bank book is empty while banks are on file, or throws. Uses `matchForClient`. Zero matches for one person is a PASS. |
| `crm-data:tradelines` | The closer dashboard card read throws or returns no list. Uses `listTradelines`. An empty card list is a PASS. |

No fetch: the page and logo rows are `skip`. No database or no org id: the record rows are `skip`. A read that throws is a `FAIL`, never a `PASS`.

### How the three Pipeline route reads work

The routes need a staff sign-in and keep their SQL inside the route file. They cannot be called from the pulse (the database handle and the sign-in gate are imported inside the route). So the same SELECTs are copied into the check file. The test reads the three route files and fails the moment a copy no longer matches its route, or the route passes its values in a different order. That keeps the copy honest. The better fix is for each route to export its SQL. That is a product file, so it is not done here.

## Dropped, and why

These were GET calls to staff-only routes with no sign-in. Each answered 401 and each skipped, every morning. A skip that can never be anything else is not coverage.

- `crm-data:documents` — the documents lane reads documents.
- `crm-data:sales-floor` — the sales manager lane reads the floor numbers.

The other three dropped reads (`clients`, `pipeline-counts`, `pipeline`) came back in the second review as real reads of the data. See above.

## Honest limits

- A link that is built in code from pieces (a string plus an id) cannot be read. Only whole quoted page names are.
- Only links to `/app` pages are read. A link to a page in the root of the site, such as `/login.html`, is not read. The registry pings those public pages.
- All 51 links found today point at desk pages the registry already pings. So today no extra page is fetched. The fetch only happens for a page that is not a desk page. That is where a typo shows up.
- The logo check looks at about 50 of 596 each day, not all of them. It says so in its line.
- A request that throws (a dropped connection) is tried once more. A status code (404, 500) is never retried.
- `crm-data:lenders` and `funding:lender-book` both go red when the bank book is empty. They read the same table from two angles (the client control panel and the funding match), so one empty book shows two reds. `crm-data:lenders` also reads through `listLenders`, which the funding row does not.
- The Pipeline board read is for the sales rail only, 500 cards at most (the route's own default). It judges that the SQL runs and the rail has columns. Cards that cannot show are `crm-data:pipeline-cards`.
- The board, the counts and the client list run the same SQL as the routes, but not the route's own JavaScript that shapes the answer. A bug there is not seen.

## Test

`node --test src/pulse/coverage/gap-crm-links.test.mjs`

## Review — Claude, 2026-10-08

First pass:

- The page check and the logo check read `public/app` and `public/assets/lenders` from the disk. A Netlify function does not carry those folders. On the server the page check would have found no links and said PASS. The logo check would have called all 596 logos missing and gone red every morning.
- The script finder only matched `<script src=...>` when `src` came first. So the nav links in `shell.js` were never read. The board said 34 links. The real count is 51.
- A screen name that only sat inside a comment (`card-stack.html` in `shell.js`) counted as a link and answered 404. That was a false alarm. Comments are stripped now.
- Nine `crm-data` checks sent GET to staff-only routes with no sign-in. All nine skipped, every time, in production.
- The page check fetched all 34 pages again, which is the same as the registry ping.
- Screens, scripts and logos are read over HTTP. The record checks call the same library functions the routes call. `crm-data:pipeline-cards` is new.

Second pass (the checker found more):

- **Gap: the Pipeline screen's own routes were not read by anything.** `dashboard/pipeline`, `dashboard/pipeline-counts` and `dashboard/clients` hold their SQL inside the route file. A renamed column would blank the Pipeline screen and no row would go red. Three new rows (`crm-data:pipeline`, `crm-data:pipeline-counts`, `crm-data:clients`) now run the same SELECTs. A test reads the route files and fails if a copy drifts.
- **The desk list was too wide.** It held every registry row, so a link like `careers.html` (a public page) looked watched while `/app/careers.html` would 404. It now holds desk pages only.
- **A lost check came back.** The old check failed a stored logo path with no leading slash (`assets/lenders/x.png`) or with `..`. The rewrite had dropped it. It is back, and it is tested.
- Checker point that the fix is not committed or shipped: true. The pulse at 06:00 runs what is committed and shipped. This session does not commit or ship. Someone must, before the next pulse, or the old disk-reading version runs.
- Checker point on the old tests that were replaced: they tested disk reads and 401 skips that were removed. Their live equivalents are tested now (dead link, dead script, dead logo, bad logo path, empty board, empty book, client read, route reads). The old "relative logo path fails" test is covered again by a new one.

Proof:

- Live, read only, as the app role: prod 10 pass, 0 fail, 0 skip. Staff run: 10 pass. Bare run: 1 pass, 9 skip (no fetch, no org id). Same from inside the built server bundle: prod 10 pass, 0 fail, 0 skip. 0 query errors, 0 write tries.
- Break tests on the live database (one query changed on the way in): a renamed column in the client list, the counts, the board, or the demo setting made the right row FAIL and the others PASS. A sales rail with no columns, a client list that came back empty with a client on file, and a company with no pipelines each made the right row FAIL.
- Tests: 45 pass, 0 fail, 0 skipped. 60 deliberate breaks of the code were tried in a scratch copy. 59 were caught. The one that got past changes nothing (an unused default length).
