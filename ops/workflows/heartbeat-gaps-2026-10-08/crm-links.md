# CRM screen links — heartbeat gap

Lane: CRM links and records that should show and do not.
Date: 2026-10-08.
Company: Fundhub.

This lane does not text anyone. It does not charge. It does not pull credit.
Recon (AG-07) stays the only tripwire. This is not a second watchdog.

The check is `gapChecks` in `src/pulse/coverage/gap-crm-links.mjs`.
It is not hooked into the morning run from this lane. Shared pulse files were left alone.
A later lane can call it. Pass `fetchImpl`, `baseUrl`, `db`, and `orgId`.
It only uses GET. It does not submit a form.

## Already watched

The morning desk list already GETs these pages. A 404 on the page itself is already red there.

- Pipeline — `/app/pipeline.html`
- Client control panel — `/app/client-control-panel.html`
- Closer dashboard — `/app/closer-dashboard.html`
- Sales floor — `/app/sales-floor.html`

34 internal `/app` links on those screens (and the scripts they load) all point at files that are already on that same desk list. Counted from the files on disk on 2026-10-08. None of those 34 files are missing.

These reads are already pinged. A 401 with no staff session counts as up. The ping does not look at the JSON.

- `GET /api/dashboard/pipeline`
- `GET /api/dashboard/pipeline-counts`
- `GET /api/dashboard/clients`
- `GET /api/dashboard/client`
- `GET /api/read/sales-floor`
- `GET /api/read/tradelines`
- `GET /api/read/documents`
- `GET /api/read/lenders`
- `GET /api/read/lender-matches`

Slices 23 (pages), 27 (closer), and 30 (sales floor) only check that those names are on the list. They do not open a link or read a record.

The Apply door copy check in the daily pulse only loads the client control panel. It does not follow a bank, client, or document link.

## Not watched until this check runs

1. A button link whose file is missing, or whose live GET answers 404 or 500. Today the 34 links are on disk. A future typo that is not on the desk list would be missed by the page ping. This check names the screen that links it.
2. A read that answers 200 with an empty body when the database says a record should be on the screen. The desk ping never sees that. A 401 still skips, because there is no staff session. A 404 or 500 fails with no session.
3. A bank logo under `/assets/lenders/` that is missing. The client control panel hides a broken logo. The desk list does not ping those files.

Not this lane: texts, email, bank balance math, Plaid, funnels, or the Apply button that opens a bank site. Those stay with their own lanes. This check does not GET a bank's own website.

## What each row does

| Id | Fail means |
|---|---|
| `crm-links:pages` | Pass only. Every internal page link resolved. |
| `crm-link:<file>` | That page link is missing or the GET was 404 or 500. |
| `crm-links:bank-logos` | A same-origin bank logo file is missing. |
| `crm-data:pipeline` | Sales columns are on file and the board read was empty, or the read was 404 or 500. |
| `crm-data:pipeline-counts` | The sales rail is on file and the counts left it out, or the read was 404 or 500. |
| `crm-data:clients` | Clients are on file and the list was empty, or the read was 404 or 500. |
| `crm-data:client` | A client is on file and the control panel read did not return that person. |
| `crm-data:tradelines` | The closer dashboard read did not return a card list. An empty card list is a pass. |
| `crm-data:lender-matches` | The bank match read failed, or it says the bank book is empty while banks are on file. Zero matches for one person is a pass. |
| `crm-data:sales-floor` | The sales floor read did not include the numbers block. |
| `crm-data:documents` | Documents are on file and the list was empty, or the read was 404 or 500. |
| `crm-data:lenders` | Banks are on file and the bank list was empty, or the book itself is empty. |

With no fetch and no database, the file check is 1 pass and 10 skips. No live site was called from the test.

## Test

`node --test src/pulse/coverage/gap-crm-links.test.mjs`

11 tests, 11 pass, 0 fail. Fake fetch and a fake database only. No live `DATABASE_URL`.
