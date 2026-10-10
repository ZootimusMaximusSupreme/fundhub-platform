# Application document vault (Capital Blueprint unit B3)

Offer line (`docs/finance/capital-blueprint-next-2026-09-29.md`): *"The agent collects
bank statements, tax returns and ID ahead of time, so the file is complete when the
closer calls."* Board: `ops/workflows/blueprint-launch-2026-10-06.md`, map item 15.

**Back end only.** This page is the contract for the screen that comes next. Nothing in
`public/app/` was touched.

## What it is

A required-papers list per client (and per business), a status on every line, an agent
that asks for the next missing paper, and one answer the closer can read:
`vaultComplete(db, { orgId, clientId })` → `{ complete, missing[], summary }`.

It reuses what already existed. Uploads are the `documents` registry
(`kind client_upload`, `POST /api/documents-upload`). The vault does **not** copy a file
anywhere and does **not** touch `documents` (its stored columns are immutable on purpose).
It adds only what a person decides and what a person adds. Waypoints and documents both
exist and stay separate: waypoints are the dispute-round steps (a mailing receipt closes one);
the vault is the application file. Nothing here changes `client_waypoints`, and the vault does
**not** gate the closer alert — it tells the closer what is missing.

| File | What it owns |
|---|---|
| `src/finance/document-vault-items.mjs` | the standard list, each line with its sources; the two expiry rules; settings |
| `src/finance/document-vault.mjs` | status per line (pure), per-business scopes, `vaultComplete`, the view, the staff decisions |
| `src/finance/document-vault-chase.mjs` | the ask: planner (pure) and runner (enqueue, claim, send, finish) |
| `src/workflows/document-vault-chase.mjs` | the daily clock (cron `45 16 * * *`, 9:45 am Arizona) |
| `api/money/vault.mjs` | `GET` / `POST /api/money/vault` |
| `src/blueprint/closer-ready.mjs` | puts the vault line on the CSM closing prep call and the closer alert |
| `db/migrations/472_document_vault.sql` | `document_vault_reviews`, `document_vault_items`, `tasks.detail`, 3 message templates |
| `scripts/document-vault-dry-run.mjs` | read-only look at one client (or the two proof clients) |

## The list, and where each line came from

Every standard line cites a source. A line with no source is **not** on the list: staff add it
for one client (`add_item`) and the screen says staff added it. `local` sources are pages of the
Legacy Strong scrape under `credentials/notion-scrape/output/` — gitignored, on the owner's Mac,
cited by page folder and line. The test `document-vault-items.test.mjs` opens every tracked
source and fails if one is gone.

| Line (`key`) | Per | Needs | Files under subtype | Ages out | Source |
|---|---|---|---|---|---|
| Government photo ID (`id_document`) | client | 1 | `id_document` | never | Document Check prompt (`db/migrations/114_ghl_agent_seed.sql`); identity packet (`src/inquiry-ops/doc-gate.mjs`); Goldman Sachs "ID upload required" (`docs/legacy-strong/lenders-legacy-strong.csv`); scrape `aged-corps-open-biz-checking--20dc3aa7` 116-122 |
| Proof of current address (`proof_of_address`) | client | 1 | `proof_of_address`, `bank_statement` | never | Document Check prompt; `doc-gate.mjs` (a bank statement counts); `db/seed/013_section4_message_templates.sql` EMAIL-DOC-01 |
| Personal tax returns, last 2 years (`tax_returns_personal`) | client | 2 | `tax_return` | never | scrape `dec-datapoint-drop-blocs-cca-team--2d6c3aa7` 46-48 (over $150,000 of business credit: last 2 years of business and personal returns); scrape `business-lines-of-credit--72eda75d` 40; survey "Can You Verify Income?" (`src/survey/cf-question-map.mjs`) |
| Business bank statements, last 3 months (`bank_statements_business`) | business | 3 | `business_bank_statement` | 3 months | scrape `dec-datapoint-drop-blocs-cca-team--2d6c3aa7` 16, 20, 32, 40, 54, 60, 66, 74 ("3 mo bank statement"); scrape `business-auto-loans--08d811a6` 23; scrape `details-aged-corp--1b8c3aa7` 176, 204, 206; survey "Can You Verify Revenue?" |
| Business tax returns, last 2 years (`tax_returns_business`) | business | 2 | `business_tax_return` | never | scrape `dec-datapoint-drop-blocs-cca-team--2d6c3aa7` 46-48; survey "Can You Verify Revenue?" |
| Articles of Organization (`articles_of_organization`) | business | 1 | `articles_of_organization` | never | scrape `aged-corps-open-biz-checking--20dc3aa7` 43-50; Document Check prompt; EMAIL-DOC-01 |
| EIN confirmation letter (`ein_letter`) | business | 1 | `ein_letter` | never | scrape `aged-corps-open-biz-checking--20dc3aa7` 59-62 ("CP-575 or IRS e-letter", "must match entity name"). The EIN *number* is never stored (`src/finance/business-info.mjs`, last 4 only) — the letter is what banks ask to see |
| Certificate of Good Standing (`certificate_good_standing`) | business | 1 | `certificate_good_standing` | 60 days from issue | scrape `aged-corps-open-biz-checking--20dc3aa7` 51-54 ("Must be issued ≤ 60 days ago") |

### What the sources do not say (so the list does not either)

- The lender book (`lenders-legacy-strong.csv`) has `docs_requested` and `documentation_required`
  columns. **Both are empty on all 306 rows** (measured 2026-10-06). The only bank that names a
  paper is Goldman Sachs, "ID upload required". There is no per-bank document list.
- No source says lenders require **personal bank statements** (only as proof of address), a **business
  license**, or a **profit-and-loss statement / balance sheet** as a standing ask. The datapoints name a
  "full financial package" only above $150,000 of *total* business credit, which depends on what is
  applied for. All three are staff-addable (`business_license` is already an upload subtype so a
  staff-added line can file under it).
- No source gives an age limit for a proof of address ("recent" only), an ID, returns, articles or the
  EIN letter, so none of them expires.
- Pay stubs / W-2: the survey asks about them on the personal-only path. They are not a standard line;
  `proof_of_income` uploads are neither counted nor listed as stray.

### Business scopes

Business lines repeat once per **business container** (an `entities` row, `kind 'business'`, not
archived — `src/finance/containers.mjs`). A client with no container but a `businesses` row (the
$297 pull form) gets **one** business scope with `id: null`, so a file that has a business cannot read
"complete" without business papers. A client with neither gets the three personal lines only.

## Status of a line

| status | meaning | who moves it next |
|---|---|---|
| `missing` | nothing usable on file, or fewer than `need` (shows `have/need`) | client |
| `uploaded` | a file is in and nobody has accepted it | staff (`waiting_on: "staff"`) |
| `accepted` | `have >= need` accepted, current files | nobody |
| `expired` | accepted files exist but aged out, and nothing else is pending | client |
| `rejected` | a file came in and a person said no (reason attached) and nothing else counts | client |
| `waived` | staff said the line does not apply here | nobody |

**`complete` is true exactly when every line is `accepted` or `waived`.** An unreviewed upload is not
complete — the closer must not read "uploaded" as "done".

Precedence on one line: waived, then accepted (enough current accepted files), then uploaded (anything
waiting for review), then expired, then rejected, then missing.

**Counting.** Each accepted file counts `covers` toward `need` (default 1). A single PDF with three
months of statements is accepted with `covers: 3`. `need` is months for statements and years for returns.

**Expiry.** Only two rules, both from sources. Bank statements: three months, from the statement's end
date (`period_end`, typed on accept) or the upload date when none was typed; a statement is good *through*
`period_end + 3 months` and expired the day after. Good-standing certificate: 60 days from the issue date.
`DOCUMENT_VAULT_STATEMENT_MAX_AGE_DAYS` and `DOCUMENT_VAULT_GOOD_STANDING_MAX_AGE_DAYS` (whole days) move
either window. A registry document whose own `documents.expires_at` has passed is expired too.

## How an upload finds its line

**The file type decides, never the file name.** A document counts toward a line through its registry
`subtype`, or through a person filing it there (`document_vault_reviews.item_key`).

- Measured 2026-10-06 on the Blueprint sim client (`029964c5-…`): six `client_upload` documents, all
  labelled `dispute_mail_receipt`, two of them named `proof-of-address-1.png`. The vault counts none of them
  toward any line and does not list them as stray (a mailing proof is not a vault paper).
- Subtypes added to `src/documents/kinds.mjs` (`SUBTYPES.client_upload` + titles):
  `business_bank_statement`, `business_tax_return`, `articles_of_organization`, `ein_letter`,
  `certificate_good_standing`, `business_license`.
- **Which business.** `POST /api/documents-upload` now accepts an optional `entity_id` field — the business
  container's id — validated against the caller's own active business containers (400 for a malformed id,
  404 for one that is not theirs, personal or archived) and kept on the document as `metadata.entity_id`.
  With exactly one business a business paper needs no `entity_id`; with two or more and none, the file is
  listed under `unfiled` (`choose_business`) until staff accept it with `entity_id`.
- **Who accepts.** A person (`POST … accept`). The one exception is the identity pair: when the document
  reader (DOC-CHECK) accepted an ID or a proof of address it recorded which document proved the name, date of
  birth and address (`pii_identity.verified_field_sources`). The vault reads that as an accept
  (`accepted_by: "doc-check"`) for `id_document` and `proof_of_address` only. A person's reject beats it.
- **The identity reader is kept off the vault-only papers.** `shouldRunDocCheck` now returns false for
  `business_bank_statement`, `business_tax_return`, `ein_letter`, `certificate_good_standing`,
  `business_license` (`VAULT_ONLY_SUBTYPES`). Its prompt knows ID, address and Articles; on anything else it
  would text the client "documents approved, Round 1 shortly" or "one thing needs fixing". Every other upload
  is read exactly as before.
- **`unfiled`** — uploads the vault cannot place: `no_label` (subtype `other`), `choose_business`,
  `unknown_business` (container archived or not theirs), `no_business` (a business paper before any business
  exists), `no_line` (matches nothing). A person files one by accepting it with `item_key` (and `entity_id`).

## API — `GET` / `POST /api/money/vault`

Same two callers and gate as `api/money/overview.mjs` and `ready-to-fund.mjs`.

| Caller | GET | POST |
|---|---|---|
| client session | own file; `client_id` is read off the session, never the query | **403** — accepting a paper is a person's job |
| staff, `ROLE_SETS.FINANCE` (owner, admin, sales_manager) | any client in their org (`?client_id=`) | accept, reject, add, retire, waive, unwaive |
| staff, any other role (closer, csm, …) | **403** | **403** |
| another org's client | **404** (not 403) | **404** |

Errors: `401` no login, `403` wrong kind/role, `404` not found, `405` other methods
(`allow: GET, POST`), `400` bad input. The staff screens should know a CSM cannot accept files through
this endpoint (that is the FINANCE gate).

### GET answer

```json
{
  "ok": true,
  "audience": "staff",                 // "client" for a client session
  "client": { "id": "f1cb9c27-…", "name": "Test Test" },
  "as_of": "2026-10-07T12:00:00.000Z",
  "complete": false,
  "summary": { "required": 8, "accepted": 0, "waived": 0, "uploaded": 0, "missing": 8, "expired": 0, "rejected": 0 },
  "scopes": [ { "kind": "business", "id": "386c687a-…", "name": "Fundhub LLC" } ],   // business scopes only
  "items": [ /* one per line per scope, in the order a client is asked — see below */ ],
  "unfiled": [ { "id": "…", "title": "…", "subtype": "other", "filename": "scan.pdf",
                 "uploaded_at": "…", "reason": "no_label", "download": { "url": "…", "expires_at": "…" } } ],
  "settings": { "ask_every_days": 3, "statement_window_months": 3,
                "statement_max_age_days": null, "good_standing_max_age_days": 60 }
}
```

Real read of the FinanceOS test client (Test Test, read-only, 2026-10-06): 8 lines — three personal, five
for "Fundhub LLC" (`386c687a-…`) — all `missing`, `complete: false`.

One `items[]` entry (staff view; a client gets the same without `sources` and without `expires.from_env`
and without `documents[].reviewed_by`). Documents shown are illustrative (three statements: accepted,
rejected, waiting):

```json
{
  "slot": "bank_statements_business:386c687a-167d-4d44-a000-8d50b5a80191",   // stable id for this line + scope
  "key": "bank_statements_business",
  "scope": { "kind": "business", "id": "386c687a-167d-4d44-a000-8d50b5a80191", "name": "Fundhub LLC" },
  "priority": 40,
  "title": "Business bank statements, last 3 months",
  "ask_text": "your last 3 months of business bank statements for Fundhub LLC",
  "label": "Business bank statements, last 3 months — Fundhub LLC",
  "why": "Lenders read three months of statements to see money coming in and staying in the account.",
  "custom": false, "custom_id": null,               // custom_id = the id to pass to retire_item
  "subtypes": ["business_bank_statement"],
  "need": 3, "unit": "month", "have": 1, "pending": 1, "expired_have": 0, "rejected": 1,
  "status": "uploaded",                              // missing | uploaded | accepted | expired | rejected | waived
  "waiting_on": "staff",                             // "client" | "staff" | null (done)
  "detail": "sent, waiting for review",              // short words for the status, "2 of 3 accepted", …
  "waived": null,                                    // { reason, at } when waived
  "expires": { "kind": "months", "value": 3, "note": "…", "from_env": null },   // or null; from_env staff only
  "documents": [
    { "id": "0d0c…01", "title": "Business Bank Statement", "subtype": "business_bank_statement",
      "filename": "fundhub-llc-jul.pdf", "uploaded_at": "2026-10-01T15:00:00.000Z",
      "status": "accepted",                          // uploaded | accepted | rejected
      "accepted_by": "staff",                        // "staff" | "doc-check" | null
      "covers": 1, "period_end": "2026-07-31",
      "reason": null,                                // the reject reason, shown to the client
      "reviewed_at": "2026-10-02T09:00:00.000Z", "reviewed_by": "Sam Staff",   // reviewed_by staff only
      "expired": false, "valid_through": "2026-10-31",
      "download": { "url": "https://…/api/documents/<id>?exp=…&sig=…", "expires_at": "…" } },   // 15 minutes; null if no signing secret
    { "…": "…", "status": "rejected", "reason": "Page 2 is missing", "covers": null, "valid_through": null },
    { "…": "…", "status": "uploaded", "reviewed_at": null }
  ],
  "sources": [ { "ref": "…", "lines": "16, 20, …", "note": "…", "local": true } ],    // staff only
  "upload": {                                        // what the client sends to the EXISTING upload endpoint
    "endpoint": "/api/documents-upload", "method": "POST",
    "fields": { "kind": "client_upload", "subtype": "business_bank_statement", "entity_id": "386c687a-…" }
  }
}
```

`upload.fields` is exact: send them as multipart form fields next to the file (the endpoint is
`multipart/form-data`, unchanged). `entity_id` is present only for a line that belongs to a business
container. A staff-added line with no subtype uploads as `other` and staff file it.

### POST — staff only, JSON body, `client_id` required

Every success answers `{ "ok": true, "action": "<name>", "result": {…}, "vault": <the fresh GET answer> }`,
so a screen can redraw without a second call. A refusal answers `{ "ok": false, "error": "<code>", "message": "<words>" }`.

| `action` | Body | `result` | Refusals |
|---|---|---|---|
| `accept` | `document_id`, optional `item_key`, `entity_id`, `covers` (1-24), `period_end` (`YYYY-MM-DD`, not future) | `{ id, status: "accepted", lines: [slot…] }` | `409 unfiled` — the file would count toward no line (send `item_key`, and `entity_id` with 2+ businesses); `404 document_not_found`; `404 unknown_business`; `400 invalid_covers / invalid_period_end / invalid_item_key / invalid_entity_id` |
| `reject` | `document_id`, `reason` (required, ≤ 300 chars — the client reads it as what to fix) | `{ id, status: "rejected", lines }` | `400 invalid_reason`, as above |
| `add_item` | `title` (≤ 120), optional `note`, `entity_id`, `subtype` (a `client_upload` subtype), `need` (1-24) | `{ id, item_key: "custom_<8 hex>" }` | `400 invalid_title / invalid_subtype / invalid_need`, `404 unknown_business` |
| `retire_item` | `item_id` (the line's `custom_id`) | `{ id }` | `404 item_not_found` |
| `waive` | `item_key` (a standard key), optional `entity_id`, `reason` (required) | `{ id, created }` | `400 invalid_item_key` (custom lines cannot be waived — retire them), `400 choose_business` (2+ businesses and none named), `404 unknown_business` |
| `unwaive` | `item_key`, optional `entity_id` | `{ id }` | `404 item_not_found` |
| anything else | | | `400 unknown_action` |

A second decision on the same document updates the same row (one row per document); an accept can be
changed to a reject and back. Nothing is ever deleted: retiring a line and unwaiving stamp `retired_at`.

## The chase

`src/workflows/document-vault-chase.mjs`, daily at 16:45 UTC, for **paid Capital Blueprint buyers only**
(the same read as `blueprint-closer-ready-sweeper`). The shape is the waypoint nudge's
(`src/nudge/ladder.mjs`): a text, an email, a text, then a person. Three constants, not a loop —
the lesson of 2026-09-03 (51 identical texts in two hours).

- **One ask per client per N days** (N = 3; `DOCUMENT_VAULT_ASK_EVERY_DAYS`, whole days 1-30). The ask is about
  **one** line — the first still open — and says how many documents come after it. Counted in calendar days
  (UTC), so a cron firing a few seconds early still counts the day.
- **Three asks per line**: `SMS-VAULT-ASK-1` (text), `EMAIL-VAULT-ASK-2` (email, lists every open line),
  `SMS-VAULT-ASK-3` (text). "Or reply to this text with a photo" appears only for the three personal papers
  (a texted photo is filed as an ID, address proof, statement or return — never a business paper).
- **Then a person**: after a line's third ask and a quiet window, one CSM task per client per round
  (`tasks.source_workflow = 'document-vault'`, role `csm`, the client's assigned CSM when there is one,
  dedupe `vault-csm:<client>:<date of the round>`) listing what is open. While it is open the chase says
  nothing; once the CSM closes it the chase goes on with lines that still have asks left. A line that used its
  three is never asked a fourth time.
- **Files waiting on us tell a person, not the client.** Vault-only papers skip the identity reader, so
  nothing else announces an upload. While any line is `uploaded`, the pass opens one task per client —
  "Documents are waiting for your review" (`tasks.source_workflow = 'document-vault-review'`, role `admin`,
  dedupe `vault-review:<client>:<date>`, `detail` lists the lines) — and opens no second while that one is
  open. It goes to `admin` because accept/reject needs the FINANCE gate; a CSM would be handed a task the
  endpoint refuses them (`REVIEW_TASK_ROLE` in `document-vault-chase.mjs` is the one constant to change if
  the gate is widened).
- **Stops**: vault complete; line waiting on our review (never chased); an escalation on file
  (`client_escalations`) means nothing at all; any outbound message on that channel in the last 20 hours,
  from anyone, holds the ask until tomorrow. The dispatcher still owns quiet hours, the opt-out read and
  the dry-run switch.
- **A file that arrives ends the round.** Asks are counted from the newest file on that line, so a statement
  that goes stale three months later starts a fresh count of three.
- Kill switch: `DOCUMENT_VAULT_CHASE=off` (anything else, or unset, is on).

**Through the existing task contract** (`docs/finance/money-agent-tasks.md`, section 10). Each ask is one
`money_agent_tasks` row: `kind 'other'` (there is no document kind), `source 'doc-vault'`,
`task_key 'vault:<line>:<scope>'`, `assignee 'agent'`, `requested_by_kind 'staff'`, moves no money, `detail`
holds `{ vault: true, slot, item_key, rung, channel, … }`. The vault's own worker enqueues **and claims it in
one statement** (the row is born `claimed`, `claimed_by 'doc-vault-rules'`), works it (`sendTemplated` only
**queues** the message; the dispatcher sends), and finishes it `done` with
`result { asked, queued, rung, channel, template }`. Not sent (opted out, template not approved) finishes
`cancelled` with `result.reason`; a send that throws finishes `failed`. Every row counts as an attempt, so the
ladder always ends in a person. `money_agent_tasks_one_open` is the cap: two schedulers cannot both ask for one
line, and a row left `claimed` by a crash is closed `failed` by the next pass after an hour.

**The money helper (W6) needs no change.** Its claim (`claimAgentTask`, `WHERE status = 'queued'`) takes any
agent row that is `queued`; a vault ask is never `queued`, so the helper can never claim one and work it as a
chat turn.

`money_agent_log` is not touched (other units rebuild its CHECK lists from migration 464's words).

## What the closer sees

`createBlueprintCsmPrepCallTask` and `createBlueprintCloserReadyTask` (`src/blueprint/closer-ready.mjs`)
write one sentence to the new `tasks.detail` column when they open the task:

- `Document vault: file complete — 8 of 8 items accepted.`
- `Document vault: 5 of 8 items done. Still open: Business bank statements, last 3 months — Fundhub LLC
  (2 of 3 accepted); Government photo ID (sent, waiting for review); …; and 2 more.`
- `Document vault: could not be checked just now. Open the client's vault.` — a vault that cannot be read is
  never "complete" and never stops the alert.

`tasks.body` is still the dedupe key (so are the title and the source): nothing about how the tasks are
created or deduped changed, only what the person reads. `GET /api/tasks` returns `detail` on every task.
`requestReadyToFund` (FinanceOS "Ready to get funded") goes through the same function, so its prep call
carries the line too. The note is a snapshot at ready time; the live answer is `GET /api/money/vault`.

## Settings

| Env var | Default | What it moves |
|---|---|---|
| `DOCUMENT_VAULT_ASK_EVERY_DAYS` | 3 | one ask per client per this many days |
| `DOCUMENT_VAULT_STATEMENT_MAX_AGE_DAYS` | unset (3 months) | replaces the three-month statement window with whole days |
| `DOCUMENT_VAULT_GOOD_STANDING_MAX_AGE_DAYS` | unset (60) | the certificate window, whole days |
| `DOCUMENT_VAULT_CHASE` | on | `off` stops the daily chase |

## Migration 472

`document_vault_reviews` (one row per document: `status accepted|rejected`, optional `item_key`,
`entity_id`, `covers`, `period_end`, `reason`, the reviewer); `document_vault_items` (`kind custom|waiver`
overrides, retired not deleted); `tasks.detail text`; and the three ask templates for every company that
exists when it runs. A reject with no reason, a second decision row for one document, a custom line with no
title, a waiver with no reason, and a second live waiver for one line are all refused by the database.
Row-level security is on with a policy, and the app role gets no DELETE. It does not touch `documents` or
`money_agent_log`.

On a deploy preview the new tables do not exist (previews do not migrate): the vault endpoint fails there and
only there, and `closer-ready` falls back to opening the task with no note.

## Proof (read-only, 2026-10-06)

`node --env-file=.env scripts/document-vault-dry-run.mjs` — every read inside `BEGIN READ ONLY … ROLLBACK`;
the chase runs with `dryRun`, so not one INSERT, UPDATE or message. A table that is not on the live
database yet reads as empty and the output says so: at the time of this proof that was 472's two tables
(`money_agent_tasks`, 464, was live, so the chase read its real, empty ask history).

The whole daily pass was dry-run the same way (`sweep(db, { dryRun: true })` inside `BEGIN READ ONLY`): 1 paid
Blueprint buyer on the live database, 0 errors, plan `ask_1` for it, nothing written, nothing sent.

Every SQL statement the vault sends was also parse-checked against the live Postgres (17.6) with
`EXPLAIN (GENERIC_PLAN)` inside `BEGIN READ ONLY … ROLLBACK` (planned, never executed, no session state):
the statements on existing tables and on `money_agent_tasks` plan clean, including the claim and finish
UPDATEs and the ask INSERT; the ones on 472's tables got as far as "relation does not exist" (syntax
accepted); the one `INSERT INTO tasks … detail` correctly failed with "column detail does not exist",
which is exactly what migration 472 fixes — and the case `closer-ready` falls back on until it ships.

- **FinanceOS test client** (`f1cb9c27-…`, org `fb789b0b-…`): no uploads; a personal container and the business
  container "Fundhub LLC". 8 lines, all `missing`, `complete: false`. Not a paid Blueprint buyer, so the daily
  chase would not ask it (the plan shows what it would do: rung 1, text, Government photo ID, 7 more).
- **Blueprint sim** (`029964c5-…`): paid buyer, no business, 17 documents of which six are mailing proofs
  (`dispute_mail_receipt`, two named `proof-of-address-1.png`) — none count. 3 personal lines, all `missing`.
  Chase today: rung 1, text, Government photo ID, 2 more. Closer sentence: `Document vault: 0 of 3 items
  done. Still open: Government photo ID (not sent); Proof of current address (not sent); Personal tax returns,
  last 2 years (not sent).`

## Not built, and owner calls

- No front end (the next unit). Suggested use of this contract: a checklist grouped by scope from `items`,
  an upload control per line from `upload.fields`, `unfiled` as a "file these" list for staff, and the
  closer sentence from `GET /api/tasks`.
- The vault does not gate the closer alert on completeness. It tells the closer. Making "file complete" a
  condition of `evaluateBlueprintCloserReady` is a one-line owner call.
- The chase is on by default for paid Blueprint buyers once shipped. A read-only dry run of the whole daily
  pass against the live database (2026-10-06) found **one** paid Blueprint buyer — the Blueprint sim,
  `029964c5-…` — and the plan for it is "rung 1, text, Government photo ID". So the first day sends at most
  one text, to that sim. `DOCUMENT_VAULT_CHASE=off` is the switch.
- Message copy (`SMS-VAULT-ASK-1`, `EMAIL-VAULT-ASK-2`, `SMS-VAULT-ASK-3`) was written for this unit and is
  editable in the template editor; a company that edits one keeps its words.
- Staff who can read or accept files here: `ROLE_SETS.FINANCE` only (owner, admin, sales_manager — the gate
  the brief named, same as the rest of `api/money/*`). Every employee (`ROLE_SETS.STAFF`, CSM and closer
  included) can already list and open a client's documents, and the offer has the CSM "collect client data",
  so a CSM or closer opening the vault gets a 403 today. Widening it is one line in `api/money/vault.mjs`
  (and the review task's role above); it is left as the brief set it.
- Personal-only funding (no business at all) asks for ID, address and two years of returns; pay stubs / W-2
  are staff-addable.
