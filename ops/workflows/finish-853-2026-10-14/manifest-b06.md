# Batch 06 manifest: customer-data screen controls (tier 3, lane gap-catalog-display)

Branch `fin/b06`, built from `fin/base` at `2f4f574a0`. Generation 1 wrote 39 of the 40; generation 2 challenged the
one row left open; repair cycle 1 (2026-10-15) answered a checker that found 16 rows whose check could stay green
while the product was broken; repair cycle 2 (this update, 2026-10-15) answers a second checker that found 13 more.
Nothing was pushed.

## The number

| | |
|---|---|
| Rows in batch | 40 |
| Open before generation 1 (NOT_PROVED, offline count script) | 40 |
| Open at the start of generation 2 | 1 |
| Open after generation 2 | 0 |
| Open at the start of repair cycle 1 | 0 |
| Open after repair cycle 1 | 1 (the Save month/year button, whose handler is dead; see below) |
| Open at the start of repair cycle 2 | 1 (the same one) |
| Open after repair cycle 2 | 1 (the same one; none of the 13 cycle 2 rows is open) |
| Whole count before / after generation 1 | 853 / 814 |
| Whole count after generation 2 | 813 |
| Whole count after repair cycle 1 | 814 (one honest row went back to not proved) |
| Whole count after repair cycle 2 | 814 (unchanged: cycle 2 strengthened checks, it opened and closed no row) |

Outcomes after repair cycle 2: 33 live checks (11 of them also carry a practice test for the half no saved row can
show: the three upload doors, the consent screen, the download link, Save ready date, Add bank, Offer bank
tracker, Take the offer back, the "Needs a human read" list and Call bureau), 5 practice tests only, 1 verified
"nothing to judge" (re-read from the live page on every run), and 1 not-attachable (the dead Save month/year
button, left NOT_PROVED on purpose).

A live check reads real saved rows on the live server and goes red when one is wrong. A control nobody has used
yet has no results, so it is green ("no saved results yet, none are wrong") and goes red on the first wrong one
(`emptyAs: "quiet"`). A practice test uses fake data in a real Chromium; it is not a live check.

## What each row ended as

| # | Screen | Control | Outcome | Where |
|---|---|---|---|---|
| 1 | climate/index.html#See how man | See how many banks in our book fit your state: scrolls to the form (drawn by bundled scripts... | na-verified | live page read every run, section below |
| 2 | client-control-panel.html | Authorized rep: Take them off this file button | live-check | check `authorized-rep-removed` |
| 3 | client-control-panel.html | Businesses cards: Save month/year button (stamp incorporation) | not-attachable | button is dead today (handler calls a function that does not exist); row stays NOT_PROVED, see repair cycle 1 |
| 4 | client-control-panel.html | Capital Blueprint: Add bank to the list button (Bank, Account, Notes inputs) | live-check | check `blueprint-bank-todo` (+ practice test of what the page sends, cycle 2) |
| 5 | client-control-panel.html | Capital Blueprint: Add credit partner button and First/Last/Email/Phone inputs | live-check | check `blueprint-credit-partner` |
| 6 | client-control-panel.html | Capital Blueprint: Bank list state buttons | practice-test | practice test in fin-b06-display-browser.test.mjs (two banks, each button must send its own row's id) |
| 7 | client-control-panel.html | Capital Blueprint: Offer bank tracker button | live-check | check `blueprint-tracker-offered` (+ practice test of the button, cycle 2) |
| 8 | client-control-panel.html | Capital Blueprint: Save ready date button | live-check | check `blueprint-ready-date`, now also reads the closer task (+ practice test of the page, cycle 2) |
| 9 | client-control-panel.html | Capital Blueprint: Take the offer back button | live-check | check `blueprint-tracker-taken-back` (+ practice test of the button, cycle 2) |
| 10 | client-control-panel.html | Declines: Record decline and build the plan button (bank, product, date, bureaus, letter text) | live-check | check `blueprint-decline-recorded` |
| 11 | client-control-panel.html | Declines: Save and mark done / Skip / Open again step buttons | live-check | check `blueprint-decline-steps` |
| 12 | client-control-panel.html | Declines: Save call date button | live-check | check `blueprint-decline-call-date` |
| 13 | client-control-panel.html | Declines: Upload letter button | live-check | check `blueprint-decline-letter` |
| 14 | client-control-panel.html | Documents toggle, drop zone, file input, drag and drop upload | live-check | check `documents-staff-dropzone` |
| 15 | client-control-panel.html | Identity-on-file state line and client approval link box + Copy link | practice-test | eleven practice tests in fin-b06-display-browser.test.mjs and fin-b06-display-browser-2.test.mjs (the live check judged another control and was removed) |
| 16 | client-control-panel.html | Issue Inquiry Removal button (opens a case, goes to Inquiry Remover) | live-check | check `inquiry-removal-case-opened` |
| 17 | client-control-panel.html | Lender row: Apply button (proxy launch, opens bank page) | live-check | check `proxy-apply-session` |
| 18 | client-control-panel.html | Lender row: Pending button | live-check | check `bank-decision-pending` |
| 19 | client-control-panel.html | Notes textarea and Save notes button | live-check | check `client-notes-saved` |
| 20 | client-portal.html | Agreements tab: Review & sign link per contract | live-check | check `contract-sign-link` |
| 21 | client-portal.html | Authorized-rep file switcher buttons (one per file) | live-check | check `authorized-rep-file-switch` |
| 22 | client-portal.html | Sign to authorize dispute letters: legal name input | practice-test | practice test in fin-b06-display-browser.test.mjs |
| 23 | client-portal.html | Sign to authorize dispute letters: signature pad (draw) | practice-test | practice test in fin-b06-display-browser.test.mjs |
| 24 | client-portal.html | Sign to authorize dispute letters: submit button | live-check | check `dispute-authorization-signed` |
| 25 | client-portal.html | Upload door: bureau response (type select, Upload button, file picker) | live-check | check `documents-door-bureau` (+ practice test of what the page posts and says) |
| 26 | client-portal.html | Upload door: ID and personal documents (type select, Upload button, file picker) | live-check | check `documents-door-identity` (+ practice test of what the page posts and says) |
| 27 | client-portal.html | Upload door: Inquiry documents (type select, Upload button, file picker) | live-check | check `documents-door-inquiry` (+ practice test of what the page posts and says) |
| 28 | client-portal.html | What You Own: Download link per file | live-check | check `documents-download-link` (+ practice test of which file each link opens, cycle 2) |
| 29 | consent-capture.html | Consent wording, version badge and current status banner (read from the server, never typed ... | live-check | check `consent-wording-matches-server` (+ practice tests of the banner, its dates, and what the page posts) |
| 30 | content-admin.html | Locked tile editor: client-facing name box | live-check | check `content-tile-name` |
| 31 | content-admin.html | Locked tile editor: outcome copy box (one line shown to the client) | live-check | check `content-tile-copy` |
| 32 | content-admin.html | Locked tile editor: Showing/Hidden switch per tile (keyboard Space/Enter too) | practice-test | practice test in fin-b06-display-browser.test.mjs |
| 33 | content-admin.html | Save changes button (saves tiles and the tier-to-video map) | live-check | check `content-save-changes` |
| 34 | contracts.html | PDF editor: drag on a page to draw a box; click a box to select; drag to move; drag corner t... | live-check | check `contract-pdf-boxes` |
| 35 | contracts.html | Save (create a new wording) | live-check | check `contract-wording-created` |
| 36 | contracts.html | Save (edit an existing wording) | live-check | check `contract-wording-edited` (editor role and the frozen copy's checksum, cycle 2) |
| 37 | documents.html | Contract cell: Void button (asks for a reason in a prompt; owner/admin only) | live-check | check `contract-voided` |
| 38 | climate/index.html#Four answer | Four answers (home state required, business state, do you have a business, your credit guess... | live-check | check `climate-lead-saved` |
| 39 | inquiry-remover.html | 'Needs a human read' list: low-confidence bureau answers and stuck clients; 'Mark as checked... | live-check | check `repair-parse-confirmed` (+ practice test of the list, cycle 2) |
| 40 | inquiry-remover.html | Case drawer: 'Call bureau' button (AI voice call to the bureau, uses DOB/SSN; disabled once ... | live-check | check `inquiry-bureau-call` (rebuilt, cycle 2; + practice test of the button) |

## Repair cycle 1 (2026-10-15): 16 rows a checker showed could stay green

An independent checker broke the product on purpose under each of these and the check stayed green. Each one
below says what was broken, what the check does now, and how it was proved. "Red on" means a stand-in row the
judge and the printed SQL both count as wrong; every break was run through both (see "How the checks work").

| # | Row | The break that stayed green | Outcome now | What is red now |
|---|---|---|---|---|
| 1 | climate button ("See how many banks...") | the button hidden by `import()`, an iframe, a tag between the words, or words joined at run time | na-verified, with a much stronger live read | all four, and more: see "Row 1" below |
| 2 | Save month/year (stamp incorporation) | the button is dead (ReferenceError) and the check read rows from other doors | not-attachable. Row left NOT_PROVED | not a check any more. The requirement text names the missing function |
| 3 | Save ready date | 2026-02-31 and 2026-04-31 passed the day pattern; Postgres then fails the daily closer read | live-check, now a real calendar day | 31 Feb, 31 Apr, 31 Jun, 30 Feb, 29 Feb in a non-leap year and in 2100, padding. 29 Feb 2028 and 2000 stay green |
| 4 | Bank list state buttons | a test with one bank cannot tell which row's id a button sends | practice-test with two banks | a button that sends the first row's id, or the last row's id (both run on the real page) |
| 5 | Add bank to the list | only two clauses could ever go red, both already database rules; the "offer first" rule and Notes were not judged | live-check | a row written by this button (no FinanceOS bank name) on a client who was never offered, on a client with no paid Blueprint order, with a blank or padded note, or with a key not trimmed lower case |
| 6 | Offer bank tracker | a failed or pending Blueprint order passed | live-check, paid order only | a flagged client whose only Blueprint order failed or is pending |
| 7 | Take the offer back | same | live-check, paid order only | same. The same paid-order rule now sits on the credit partner and ready date checks too, because the handlers use one gate |
| 8 | Identity-on-file line, link box, Copy link | the check read the approval page's result, so no change to this control could turn it red | practice-test (four tests), live check removed | an inverted line, an empty link box, a Copy link that copies nothing, a missing "why no link" sentence, a revoked consent that still offers the link (9 breaks run on the real page) |
| 9 to 11 | the three upload doors | the type picked was never compared with the type filed; a file filed as "other" because the server did not know the type stayed green | live-check, plus a practice test of what each door posts | a file whose picked type is not the type filed; a file with no sender or the wrong sender in its metadata; a file with no label written after labels shipped; a file with a missing current version, object or checksum. Page: a dropped door kind, a dropped type, a wrong client, every door reading the first door's select (5 breaks run on the real page) |
| 12 | What You Own: Download link | judged 5 of the 11 deliverable types | live-check, every deliverable that has not expired | a missing object on any of the 11 types, each one on its own. An expired file is left out on purpose: the portal gives it no link by design |
| 13 | Consent wording, version badge, status banner | soft pull consents were not judged; marketing use was untested; the banner was not judged | live-check on all four kinds, plus a practice test of the screen | a soft pull consent (last 60 days, real clients) with the caller's words, a wrong version, or no version; marketing use with other words. Screen: words drawn as markup, a hardcoded version badge, each server status painting the wrong tone or sentence, the words posted back (9 breaks run on the real page) |
| 14 | Save (edit an existing wording) | false red on every edited PDF wording (its body is empty by design), and an edit that stopped recording who made it dropped out of the sample | live-check | a changed wording with no editor, when no migration ran near that moment; an editor who is not staff in this company; a sent contract whose words no longer match its fingerprint |
| 15 | 'Needs a human read' list | only answers already marked checked were read, so a list that hid an answer stayed green | live-check, both halves | an answer left unchecked past the repair program's own 24 hour clock (this is how a hidden answer shows up); a checked answer with no confidence at all and no confirmer |
| 16 | Call bureau | a second launch on one case, or a call whose case stamp never landed, stayed green | live-check, with one limit said out loud | more bureau calls logged in 30 days than cases marked fired, for one client. Limit: below |

### What each outcome rests on

- **Rows 5, 6, 7 (paid order).** `isCapitalBlueprintBuyer` needs `status = 'succeeded'`. Nothing in the repo updates
  `transactions.status` after it is written (checked: no `UPDATE transactions` outside tests), so a later refund
  leaves the order paid and cannot turn an old flag red. The earlier manifest said the opposite. It was wrong.
- **Row 5 split.** Migration 461 gave the table a `bank_name`. This button's insert never sets it; FinanceOS
  `planBank` and `openAccount` always do and have no offer gate. So a row with no bank name was written by this
  button. Taking the offer back later sets the flag to "false" and leaves the rows, so only a client who was never
  offered (flag absent) is wrong. Blank bank keys and account kinds other than personal or business are refused by
  database rules, so those two old clauses were removed rather than kept as checks that cannot fire.
- **Rows 9 to 11.** The type select is optional ("What is this? (helps us file it)"). A client who picks nothing is
  filed as "other" with source `none_given`, which is not wrong. So the saved row can show a type the server did
  not know (picked and filed differ) but cannot show a dropped choice. That half is the practice test of the page.
  The phone-text intake also writes `client_upload` files (generated_by `inbound-mms`, no label); the door checks
  now select their own files by `generated_by` starting with `client:` or `staff:`, which only
  `api/documents-upload.mjs` writes. Label rules only judge files created from 2026-09-07 on, the day after labels
  shipped (commit `7d9a80f58`).
- **Row 13.** Soft pull consents are judged for the last 60 days only. The wording table and the consent record both
  arrived on 2026-07-31 and older rows can predate them. A demo client's consent is left out. The status banner has
  no saved result of its own (it is worked out from the same rows when the screen opens), so it is covered by the
  practice test of the screen and not by the SQL.
- **Row 14.** `created_by` is NOT NULL on every template (migration 124), so it cannot tell a person's wording from a
  seed. Migrations 273, 287 and 288 rewrite seeded wordings and record no editor. `schema_migrations.applied_at`
  says when each migration ran (the app role already reads that table in `src/http/health.mjs`), so a wording whose
  `updated_at` is within 5 minutes of a migration is left out as "a migration is not a person". Blank name, words and
  signature sentence are refused by database rules (124, 125), so those clauses were removed.
- **Row 15.** `STAGE_SLA.response_received` in `src/repair/sla.mjs` is 24 hours, task `owner_reviews_parse`. The
  check imports that number, so the two cannot drift. Demo clients are left out of the stuck half.
- **Row 16.** `outbound_calls` stores no case id and the launch writes the call row and the case stamp in two steps.
  So a repeat is read at the client over 30 days: calls logged must not exceed cases marked fired. Limits that
  need a product change (store `case_id` on the call, or refuse a launch when `call_fired_at` is set): a repeat on
  one case is hidden when the same client has other cases the scheduler already stamped fired
  (`call-scheduler.mjs` stamps `call_fired_at` without placing a call); and a call that was placed but whose log write
  failed leaves nothing to read (the launch swallows that error).

## Repair cycle 2 (2026-10-15): 13 rows a second checker showed could stay green

A second independent checker broke the product under 13 of the rows above and the check (or its practice test)
stayed green. Each row below says what was broken, what the check does now, and how it was proved. Where a saved
row cannot show the break (a button wired to the wrong action, a box read wrongly, a message the page did not
say), the answer is a practice test of the page next to the live check, never a clause that pretends. Where the
data could show it, the live check now does.

| # | Row | The break that stayed green | Outcome now | What is red now |
|---|---|---|---|---|
| 1 | Identity-on-file line, link box, Copy link | the box never offered when consent is missing, the consent sentence replaced by the identity one, an unknown identity (null) read as missing, the expiry line removed, the clipboard fallback saying nothing | practice-test (7 new, 11 in all) | all five breaks and four more (no-clipboard branch, box not selected, expiry words, both missing); see "Row 1" |
| 2 to 4 | the three upload doors | a login filing on another client's file, an html or 80 MB file stored past the validator, a file stored and never announced, a refused upload still saying "Sent" | live-check, stronger, plus the practice test (now also the refused-upload half) | see "Rows 2 to 4" |
| 5 | What You Own: Download link | the two copies of the object key could differ, a missing checksum passed, and which file each link opens was untested | live-check, stronger, plus a practice test of the page | keys that differ, a missing or different checksum; a page that opens the wrong document's file |
| 6 | Save ready date | the page posting a wrong day, and the promise "the closer gets a task on that day" that nothing read | live-check (now reads the sweep's task) plus a practice test of the page | a past day with no closer task after the sweep has had a run; a button that posts another day |
| 7 | Add bank to the list | the page sending the wrong Account, dropping the note, posting the notes box as the bank | practice-test of the page next to the live check; the note clauses left the live check | each page break, run on the real page |
| 8, 9 | Offer bank tracker, Take the offer back | the two buttons swapped | practice-test of the page next to the live check | a button that posts the other action |
| 10 | Consent wording, version badge, status banner | the expired and expires lines removable; Record consent left on with no words or after a failed read | live-check plus practice tests | each of the four breaks, run on the real page |
| 11 | Save (edit an existing wording) | a closer changing legal wording; words and fingerprint rewritten together on a signed contract | live-check, stronger | the editor's role, and the words against the frozen copy's checksum for sent, viewed, signed and voided contracts |
| 12 | 'Needs a human read' list | a card stalled for 60 days; a confirm that flips the flag and advances nothing | live-check (two new halves) plus a practice test of the page | see "Row 12" |
| 13 | Call bureau | a repeat hidden by another case the scheduler stamped; an earlier reveal log answering a later call; a renamed kind going quiet; a check whose own tests did not pin its SQL | live-check rebuilt, source pins, a practice test of the page | see "Row 13" |

### What each outcome rests on (cycle 2)

**Row 1, identity line and approval link (practice test).** There is nothing saved by this control, so no live
check could ever judge it (the cycle 1 manifest says so). Seven new practice tests in
`fin-b06-display-browser-2.test.mjs` drive what cycle 1 did not: consent missing with identity on file (the box is
offered, with the consent sentence, and the identity line is still true); both missing (the sentence for both);
identity missing with a valid consent (the identity sentence, not the consent one); an identity the server did not
answer (null means "not asked": no line, no box for a valid consent, the consent sentence alone for a missing
one); the expiry line (22:42 UTC reads 3:42 PM, the Phoenix clock, with the exact sentence, and is hidden with no
expiry); the clipboard refused (the box is selected and the button says "Press Ctrl+C", then goes back); and no
clipboard at all (same fallback). The assertion text on the proof case now lists exactly what the tests drive and
no more.

**Rows 2 to 4, upload doors (live check, stronger, plus practice test).** The saved row now has to pass these, for
each door (staff drop zone, ID, inquiry, bureau response):

- the sender in `metadata.uploaded_by.id` is a login (client doors: `accounts`) or a person (staff door: `staff`)
  of this company. For a client login the account must belong to the file (`accounts.client_id` equals the
  document's client) or be an authorized representative linked to it (`client_authorized_reps`, a link removed
  later still counts, because the file was filed while linked). A client login that filed a paper on another
  client's file is red. This matters most on the ID door.
- the stored object is one of the three types the door accepts (`ALLOWED_MIME_TYPES`, imported so it cannot
  drift), has a size, the size is above zero and not over `DEFAULT_MAX_BYTES` (10 MB). A NULL size used to pass.
- the `docs.received` event the handler emits exists on that client's file and names this document. A file that
  was stored and never announced leaves the "Missing Documents" hold on and the document agent asleep.
- what was already judged still is: current version, object and checksum equal on both rows, sender kind, the
  label rules.

The page half (a refused upload must say "Try again", keep the picked file so the next press sends it again, and
only an accepted one says "Sent") is a practice test across all three doors with a 400, a 500 and then a 200.
Limit, said plainly: the 10 MB number is `DEFAULT_MAX_BYTES`. `DOCUMENT_UPLOAD_MAX_BYTES` can raise the real limit
and this check does not read env at run time (query contracts are compiled), so a deliberate raise past 10 MB
reads red until the number is moved in `fin-b06-display-contracts.mjs`. Nothing in the repo sets that variable.

**Row 5, download link (live check, stronger, plus practice test).** The signed link carries the current version
id, and the download route reads that version's object (or the document row's own copy when the link names no
version) and verifies the bytes against the stored checksum when there is one. So the live check now also needs
`documents.storage_key` equal to the version's, a checksum on the version, and the document's checksum equal to
it. The page half (each Download link is its own document's link, matched by type and not by position) is a
practice test: documents in a different order from the owned items, one with its link withheld, one unclaimed
deliverable, one upload that is not a deliverable, and no two rows sharing a link.

**Row 6, ready date (live check, now reads the task; practice test of the page).** The button's own promise is
"Saved. The closer gets a task on that day." The daily sweep (cron 06:30 UTC) makes that task: source workflow
`blueprint-next-funding-sequence`, body `blueprint-next-sequence:<client>:<day>`. A second part of the check reads
it: a paying buyer with a real saved day at least two days past, whose client record has not changed for 36 hours,
must have that task. Limit: the save time is not stored, so a record changed in the last 36 hours is not judged
yet (the client record's `updated_at` is the nearest lower bound), and a client record that is touched every
day by something else is never judged. A dead sweep still reds on every other client. The page half (the day
typed is the day posted, an empty box posts nothing, the saved sentence) is a practice test.

**Row 7, add bank (practice test of the page, note clauses left the live check).** The handler stores the note as
given and never trims it, so "the note has no padding" asserted something only the page does, and a direct call
that stores padding would have gone red on a result the handler allows. Those two clauses were removed from the
live check (the offer gate, the paid order, the same-company client and the trimmed lower case bank key stay).
The practice test drives the page: an empty Bank box posts nothing, the Bank box is the bank, the Account choice
is the account kind, the note is trimmed and goes as null when empty, the boxes clear, and a refusal because the
tracker was never offered puts the Offer button back.

**Rows 8 and 9, offer and take back (practice test of the page).** The flag cannot show which button wrote it. The
practice test drives both buttons: Offer posts `offered: true` and shows the bank form and the take-back button,
take-back posts `offered: false` and puts the Offer button back, a refusal says the client has not paid and does
not flip the screen, and a client who was already offered opens on the take-back button.

**Row 10, consent (practice tests).** The "It expired on" and "It expires on" lines are pinned (and absent with no
expiry), and Record consent is off, with nothing posted, when the server sends no wording and when the read fails.

**Row 11, edit wording (live check, stronger).** Two holes closed. (1) The editor must be an owner or an admin: the
handler (`api/contracts.mjs` `OWNER_ADMIN_ACTIONS`, `hasRole`) refuses every wording write from any other role, so
a closer's name on a wording is a write the gate let through. The role is read as it is today: an editor who was
an admin then and is not now reads as wrong until an admin saves the wording again. (2) The tamper half compared
`rendered_body` with `body_sha`, both on the same mutable row. It now anchors on `document_versions.checksum`, the
frozen copy the contract row cannot rewrite (the schema's own header says so), for sent, viewed, signed and voided
contracts, and also compares the row's own fingerprint to it, so words and fingerprint rewritten together are red.
No migration rewrites a contract's words (273, 287 and 288 write only `contract_templates`).

**Row 12, 'Needs a human read' (live check, two new halves, plus practice test).**

- What "Mark as checked" does (`confirmHeldParse`): `confirmParse` advances the case's items and writes a
  `repair_decision_log` row `parse.confirmed` carrying the confirmer's id; only then is the answer flagged
  confirmed with its confirmer. Every answer a person confirmed must have that record, for that client and case,
  within five minutes of the confirm and naming the same person. A flag flipped with nothing advanced has none.
  What this cannot see: whether each item row was then written (the items move on afterwards, so their status
  now is not what the confirm wrote).
- The stuck half. The list also prints cards parked on the Stalled stage. The program sets no clock for that
  stage ("the only human queue", and the morning pulse already reds any card there). A card is judged by the fact
  the list exists to change, a person has moved it: a real client's repair card still on Stalled 24 hours after it
  last changed is red. The 24 hours is the one human-read clock the program has (`STAGE_SLA.response_received`),
  borrowed because no clock exists for Stalled. It is one line to change if Chris wants another number.
- The page half: the stuck client is printed by email, each Mark as checked posts THAT row's response id, and a
  refused one shows the server's reason and not "Checked".

**Row 13, Call bureau (live check rebuilt, source pins, practice test of the page).**

- Tied by time, not by count. `outbound_calls` stores no case id, so each call in the last 30 days must have, for
  that client, a case whose `call_fired_at` is within five minutes of the call row, and a reveal log entry
  (`ssn (bureau_dispute_call)`) within five minutes of it. The launch keeps the first stamp (`coalesce`), so a
  second launch on a stamped case has no stamp near it and is red, even when the same client has another case the
  scheduler stamped with no call (that stamp is not near any call, so it answers for none). A call whose stamp
  never landed is red. An earlier reveal log no longer answers for a later call.
- Said in the requirement text (it was only in this manifest): a repeat placed within five minutes of a launch on
  another case of the same client matches that case's stamp and is not seen, and a call placed whose dispatch
  record failed to write leaves nothing to read.
- A source pin test reads `bureau-call.mjs`, `pii/index.mjs` and `call-scheduler.mjs` and fails if the kind
  (`inquiry_bureau`), the reveal reason (`bureau_dispute_call`), the `ssn (<reason>)` log format or the
  first-stamp-wins `coalesce` change, so a rename can no longer turn the check quiet.
- The check is one definition that prints the SQL and runs the judge (no hand-written second copy of a count that
  could drift, which is what cycle 1's two `custom()` subqueries were). The tests now pin every clause: another
  client's log, another company's log, an old log, another reason, another client's stamp, another company's
  stamp, a stamp an hour away, a repeat beside a scheduler-only stamp, a 10 day old bad call, a 40 day old one
  that must stay quiet, and another kind of call.
- The page half: Call bureau is off, with the title "Call already started", for a fired case and posts nothing;
  for an open case it posts the launch door with that case's id and nothing else; a refused launch says the
  server's words and leaves the button usable.

## Row 1: the climate button, challenged in generation 2 and again in repair cycle 1 (na-verified)

Generation 1 said not-attachable: the button is on no shipped page. Generation 2 read the real page and the real
handler and agrees the sentence is exactly true, so no saved-result check and no click test can exist for it. It
was a permanent NOT_PROVED. That is the one outcome the heartbeat law does not allow (a "nothing to judge" must be
re-checkable), so it now ends as a verified N/A that reads the live page on every run.

What is true, read on 2026-10-14:

- `public/climate/index.html` is the lending-climate dashboard ("Loading lending climate..."). Its page script
  calls only `/api/climate` and `/api/climate/geocode`. The `climate-lead-magnet` page and form were reverted in
  commit `f39cec357` ("Revert Claude climate visitor page; keep API and map JSON").
- A read-only GET of `https://fundhub.ai/climate/` and each script it loads (7 own chunks plus `/funnel/rb2b.js`)
  found neither the words "See how many banks in our book fit your state" nor the string `climate-match`. The live
  page is byte-for-byte the repo page (4820 bytes).
- No file under `public/`, `marketing/` or `api/` names the button. Only `docs/` and `ops/` do.

How it works (`src/pulse/coverage/fin-b06-not-shipped.mjs`, GET only, redirects not followed, 4 s per request and
an 8 s budget for the whole read):

1. GET the page, and the sibling route `/climate/lender-climate/` (the claim lists both). Not 200, not a web page, or
   a network error: row says `skip` with the reason.
2. Follow what the page leads to on the same site, up to 5 hops and 40 files: script tags, preloaded modules,
   iframes, `import()` targets, static imports, workers, and any string that names a script or page (a Next build
   payload, a webpack chunk map). A file the page really loads that fails is `skip`, never "absent". A path that
   was only guessed from a string may be missing (a 404 is ignored); guesses past the cap are dropped.
3. Search every file after undoing the easy ways to hide a word: tags between words, entities, escapes,
   `"a" + "b"`, `.concat`, `["a","b"].join(" ")`, `atob(...)`, `String.fromCharCode(...)`. The markers are the
   button words, `climate-match`, `climate_match` and `website:climate`.
4. Nothing found and every file read: the row says `na`, code `catalog-display-control-not-shipped`. The morning
   audit asks this file again before it lets `na` stand.
5. Anything found: the control ships now. The row goes back to `NOT_PROVED` with a fix line, and a person attaches
   a real check for the scroll and for the form it saves (the form row already has the `climate-lead-saved` live
   check).

What it still cannot see, said plainly: words built at run time from something that is not a literal in any file
(an API reply, a computed template). A page that does that can ship the button and this read will not find it.
The form it opens is judged on its saved lead by `climate-lead-saved`, so a working form still shows up there.
The real page is read in 10 GETs (page, sibling route, 8 files), about 1 second on 2026-10-15.

The claim data lives on the contract (`contract.notShipped` in `fin-b06-display-contracts.mjs`), so it travels
through `generated.json` like the rest. The contract is still `mode: "always-red"` (no saved result exists).

The climate form row (`POST /api/public/climate-match`) is a live check on the saved lead, so a lead filed by any
caller (the door has `Access-Control-Allow-Origin: *`) is judged. With no caller today it reads "no saved
results yet". That is quiet, not proved by use.

## How the checks work (no local Postgres on this Mac)

There is no local Postgres here. Each check is written once in a small builder (`fin-b06-sql-kit.mjs`) that prints
the read-only SQL and also runs the same definition as a JavaScript judge over stand-in rows. The test file builds a
good world for each check (green, with a real sample, not vacuous) and then breaks it one way at a time (250+ cases
across breaks and "still green" cases that prove a check does not cry wolf).

Repair cycle 1 added a second execution of the same cases: `fin-b06-sqlite.mjs` runs the PRINTED SQL for real in
SQLite (`node:sqlite`, built in to Node 22) over the same stand-in rows, after a small mechanical dialect step, and
the test requires its `sample_count` and `bad_count` to equal the judge's, for every world, every break and every
"still green" case. It also sweeps every calendar day for 12 years against JavaScript's own calendar. That catches
a typo or a wrong NULL rule that only lives in the SQL. It is not Postgres: its regular expressions and timestamp
parsing are stood in by JavaScript. The first live pulse is still the first Postgres run.

The SQL text is also checked by `fin-b06-schema.mjs`: every table named after FROM or JOIN and every
`alias.column` must exist in `db/schema` + `db/migrations` (plus `schema_migrations`, which `db/migrate.mjs` makes).

Proof that the tests are not decoration: after the repair, each new rule was removed from the check definition and
the contracts test went red every time (27 definition mutants, 5 kit mutants, 22 mutants of the not-shipped read, 23
breaks of the shipped pages; two of the not-shipped mutants first stayed green and two tests were added). Every page was restored after its run and `git status` shows the pages untouched.

## Files added

- `src/pulse/catalog/proofs/fin-b06-sql-kit.mjs` (the builder; repair cycle 1 added `realDay`, `startsWith`, `onOrAfter`
  and the paid-order rule; repair cycle 2 added `asText`, `withinMinutes` and `dayNotAfterDaysAgo`)
- `src/pulse/catalog/proofs/fin-b06-schema.mjs` (the migration reader; repair cycle 1 added `schema_migrations`)
- `src/pulse/catalog/proofs/fin-b06-sqlite.mjs` (repair cycle 1: runs the printed SQL in SQLite over the stand-in rows;
  cycle 2: a stand-in table with no columns is skipped)
- `src/pulse/catalog/proofs/fin-b06-display-contracts.mjs` (33 checks and 2 gaps; cycle 2 rewrote the three upload
  doors, the download link, ready date, add bank, edit wording, needs-a-human-read and call-bureau definitions)
- `src/pulse/catalog/proofs/fin-b06-display-contracts.test.mjs`
- `src/pulse/catalog/proofs/fin-b06-display-practice.mjs` (16 practice proof cases: 5 practice only, 11 that also keep a
  live check; cycle 2 added 7 and gave 5 of the others a second test file)
- `src/pulse/catalog/proofs/fin-b06-display-browser-2.test.mjs` (cycle 2: 21 Chromium tests, listed in
  "Repair cycle 2" above)
- `src/pulse/catalog/proofs/fin-b06-display-browser.test.mjs` (11 Chromium tests)
- `src/pulse/coverage/fin-b06-not-shipped.mjs` (the live-page read for a control that is not shipped; rebuilt in repair cycle 1)
- `src/pulse/coverage/fin-b06-not-shipped.test.mjs` (36 practice tests)
- `ops/workflows/finish-853-2026-10-14/manifest-b06.md` (this file)

## Shared lines touched (for the integrator)

| File | What |
|---|---|
| `src/pulse/catalog/proofs/display-saved-result.mjs` | one import line; eight old `gap(...)` lines removed (Save changes, Showing/Hidden switch, name box, outcome copy box, Save create wording, Save edit wording, Consent wording banner, Void button); one `...FIN_B06_DISPLAY_CONTRACTS,` line at the end of the array |
| `src/pulse/catalog/compiler.mjs` | `compileDisplayRuntimeData`: a tracked money or customer row that owns a registered contract is now judged even when no browser spec names it (16 new lines, plus `DEEP_IMPACT`). Without this a contract keyed by control text was never attached or queried |
| `src/pulse/catalog/proofs/display-proof-cases.mjs` | one import line and one `...FIN_B06_DISPLAY_PROOF_CASES,` line |
| `src/pulse/catalog/proofs/display-proof-cases.test.mjs` | red count 672 to 662 (rows that now have a live check or a practice test); repair cycle 1 wrote 661, which was never run (measured 658 at the end of cycle 1: the pattern in the cycle 1 command used `\|` for "or", which matches nothing); repair cycle 2: 658 to **651** (seven rows that keep a live check also have a practice test of the page now). One line and its comment |
| `src/pulse/coverage/gap-catalog-display.test.mjs` | guard numbers 40 / 27 / 13 became 68 / 62 / 6 (contracts, pass-capable, unmeasured), `SQL_BATCHES` 27 to 62, result cases 40 to 68. Repair cycle 1 moved them again to 67 / 60 / 7 and `SQL_BATCHES` 60: the identity-on-file row left the live lane for a practice test, and Save month/year became an unmeasured contract. The two `NOT_PROVED` counts are 6 |
| `src/pulse/catalog/generated.json` | recompiled with `npm run pulse:catalog` (a conflict is expected; recompile after merging). Generation 2 changes one contract in it (the climate button gains `notShipped`) |
| `src/pulse/coverage/gap-catalog-display.mjs` | generation 2: one import line; in `gapChecks` a `notShipped` map and one `if (notShipped.has(entry.id)) return ...` line at the top of `judge`; one `[NOT_SHIPPED_CODE]` entry at the end of `naVerify` |
| `src/pulse/coverage/gap-catalog-display.test.mjs` | generation 2: two `NOT_PROVED` counts 6 became 5 (the climate row is no longer NOT_PROVED while the live page lacks the button). Comment says why |
| `src/pulse/na-conditions.mjs` | generation 2: one new code `catalog-display-control-not-shipped` (`verify: "lane"`), inserted before the `no-sender` block. The closed list is now 15 codes |
| `src/pulse/na-conditions.test.mjs` | generation 2: the closed list (14 to 15), the lane-code list, and the sample args for the sentence test. Three lines |

Do not trust my guard numbers after the merge (they are 67 / 60 / 7 and `SQL_BATCHES` 60 on this branch, and the
display red count in `display-proof-cases.test.mjs` is 651; measure that one with the script in the cycle 2 commands
table, because the 661 cycle 1 wrote was wrong). Re-derive: contracts = base contracts minus replaced gaps plus every
batch's contracts; pass-capable = base query contracts plus every batch's queries.

## Product findings (one line each, nothing fixed)

1. `api/soft-pull-approve.mjs` line 279 calls `stampIncorporatedAsStaff`, which is not defined anywhere in the repo
   (commit `ddcd92d18` added it; a later change removed the function). A POST with `action: "stamp_incorporated"`
   throws `ReferenceError`, so the "Save month/year" button on the client file and the same call from the present deck
   fail. Confirmed by calling the handler.
2. The dispute-authorization signature pad never saves the drawing: the page checks that ink exists and then sends
   only the typed name and `capture_method: "signature"`. No image is stored anywhere.
3. `api/consent/capture.mjs` takes `document_id` from the request body and stores it on the consent with no check that
   the document belongs to that client or company (the column is only a foreign key).
4. The climate lead-magnet page and its form are described in `docs/journeys/climate-lead-magnet-intended.md` but are
   not on the shipped page; no page calls `/api/public/climate-match`. Re-confirmed on the LIVE site on 2026-10-14
   (page and all its scripts read by GET). The page was reverted on purpose in `f39cec357`. (Also found by slice 4.)
5. `api/content/tiles.mjs` Save runs no transaction by design (its own comment says so): tile words can be saved and
   the video map fail. A read cannot see which half landed.
6. `parseReadyDate` in `src/blueprint/next-funding-sequence.mjs` accepts a day that is not on the calendar (JavaScript
   rolls `2026-02-31` to 3 March) and stores the text as typed. `dueForNextSequenceAlert` then casts every saved day
   with `::date` in Postgres, which refuses `2026-02-31`, so the daily closer-alert read fails for the WHOLE company
   on one bad day. The ready date check goes red on it now; the product is not fixed.
7. `launchBureauCallForCase` (`src/inquiry-ops/bureau-call.mjs`) never refuses a launch when the case already has
   `call_fired_at` set ("disabled once fired" is the page only), uses `coalesce(call_fired_at, now())`, and
   `outbound_calls` stores no case id. A second launch places a second call to the bureau. A call whose log write
   fails is swallowed in a `catch`, so it leaves nothing to read.
8. `api/repair/exceptions.mjs` lists only unconfirmed answers that are under 0.85 confidence or stamped held. An
   answer with no confidence at all is auto-confirmed by `runParseAdvanceLoop` (NaN is not under the threshold) and
   is hidden from that list too. The check now reads a confirmed answer with no confidence as one that needed a person.
9. (cycle 2) Add bank, refused because the tracker was never offered: `client-control-panel.html` writes the sentence
   "Offer the bank tracker to this client first." into `#bp-todo-status`, which sits inside `#bp-todo-form`, and the
   same handler hides that form (`paintOffered(false)`). So the person sees the form vanish and the Offer button come
   back, and the words are written and not shown. Pinned as it is by the practice test; not fixed.
10. (cycle 2) `confirmHeldParse` writes the `parse.confirmed` log row and queues the client's email (inside
    `confirmParse`) BEFORE it persists the items and flags the answer confirmed. A failure in between leaves a log
    row and an email for an answer the list still shows as unchecked, and pressing Mark as checked again logs and
    queues again. The cycle 2 check ties a confirm to its record by time, so it still reads that answer as unchecked.
11. (cycle 2) The call scheduler stamps `call_fired_at` and sets `ai_call_status = 'queued'` on a due case and places
    no call. Nothing in this repo places a call for such a case, and the page turns Call bureau off for any stamped
    case. So a scheduler-stamped case can only be called by a direct API launch (or by something outside this repo
    that reads that status; none was found). The rebuilt check does not count such a stamp as an answer for a call.
12. (cycle 2) Cycle 1's display red count (661) was never run: the command used `\|` between test names, which the
    runner reads as a literal pipe, so it matched nothing and printed no result. The real number then was 658.

## Things the integrator and Chris should know

- The display lane now runs 60 SQL reads one after another (it ran 27). Each is scoped to one company, and the heavy
  ones (events, documents, account sessions, client notes) use equality joins the planner can index. I could not time
  them against the real database. If the morning pulse step gets slow, split the lane. The 26 second step cut is the
  limit.
- First live run: these checks have never touched real rows. A red on day one means either a real wrong result or a
  legacy row the code path no longer writes. Each check's requirement text names the exact invariant, so the red
  names itself.
- The `blueprint-*` checks now need a PAID Blueprint order (`status = 'succeeded'`, the handlers' own gate). Nothing
  updates a transaction's status afterwards, so a refund cannot turn an old flag red.
- The not-shipped read does up to 40 GETs of the site's own static files (10 on the real page) inside the display lane's
  step, under an 8 second budget for the whole read. If it runs out of time the row says `skip`, never `na`.
- Day-one reds are real findings, not noise, but they will name old rows: the ready date check will name any client
  already holding a day that is not on the calendar; the unchecked-answer half will name every bureau answer nobody
  has read in 24 hours; the bureau call check names a client with more calls than fired cases in 30 days.

- (cycle 2) Day-one reds will be real and will name old rows: a paying buyer whose saved ready date is two or more days
  past with no sweep task (this also happens to any client the sweep skipped because one bad day broke its read);
  any real client's repair card sitting on Stalled for more than 24 hours; a bureau call in the last 30 days with no
  case stamp or no reveal log within five minutes of it; an editor of a contract wording who is not an owner or an
  admin today; a signed or voided contract whose words do not match its frozen copy; a door file with no
  `docs.received` event.
- (cycle 2) Two numbers are mine and are one line each to change: the 24 hour clock for a card on Stalled
  (`STUCK_CARD_MINUTES`, borrowed from the response-read clock because the program sets none for Stalled), and the
  10 MB upload ceiling (`MAX_UPLOAD_BYTES`, `DEFAULT_MAX_BYTES`; `DOCUMENT_UPLOAD_MAX_BYTES` is not read).
- (cycle 2) The SQL still has never run on Postgres. The new casts that SQLite does not care about (`uuid::text`
  before a compare with json text or a `btrim`) are pinned by tests that read the printed SQL. The first live
  pulse is the first Postgres run, same as cycle 1.
- (cycle 2) The lane still runs 60 SQL reads (no read was added or removed). The door checks gained three joins and
  an events probe per document, the ready date check a second pass over clients, and the repair check two more
  parts; none was timed against the real database.

## Commands run and results

| Command | Result |
|---|---|
| `node scripts/pulse/count-not-proved.mjs` before | `{"total":853,...,"gap-catalog-display":680}` |
| `npm run pulse:catalog` | `coverage catalog: 3975 mapped, 33 marked repeats, 3942 unique; 3919 wired, 23 red` |
| `npm run pulse:catalog -- --check` | up to date |
| `node scripts/pulse/count-not-proved.mjs` after | `{"total":814,...,"gap-catalog-display":641}`; batch rows 40 before, 1 after |
| `node --test src/pulse/coverage/*.test.mjs src/pulse/catalog/*.test.mjs` plus both new test files | 2375 tests, 2175 pass, 0 fail, 200 skipped (pg tests, no database here) |
| `node --test src/pulse/*.test.mjs src/pulse/beats/*.test.mjs` | 1090 pass, 0 fail |
| `node --test --test-name-pattern="every display proof case names\|unmapped display rows" display-proof-cases.test.mjs` | 2 pass (the third test in that file spawns every proof test in the repo; not run to the end, see below) |
| `node --test src/pulse/catalog/proofs/fin-b06-display-browser.test.mjs` | 4 pass |
| mutation script (15 breaks in 3 real pages, each restored after its run) | all 15 red |

Not run to the end: the third test in `display-proof-cases.test.mjs` ("the focused proof test runs every executable
test named by every case") spawns every proof test file in the repo in one process. With 26 agents on this Mac it did
not finish in 15 minutes, so I stopped it. My own files run inside it and pass alone.

### Generation 2 commands (2026-10-14)

| Command | Result |
|---|---|
| `node scripts/pulse/count-not-proved.mjs` at the start | `{"total":814,...,"gap-catalog-display":641}`; batch rows open: 1 |
| `node scripts/pulse/count-not-proved.mjs` after | `{"total":813,...,"gap-catalog-display":640}`; batch rows open: 0. The stub page here is empty, so the climate row reads `skip` offline; served the real `public/` files it reads `na` |
| display lane run with the real `public/climate` files served as the live site | climate row `na`, code `catalog-display-control-not-shipped`; "/climate/ opens, and neither the page nor its 8 own scripts carry it or the door it would call" |
| read-only GET of `https://fundhub.ai/climate/` and its 7 chunks plus `/funnel/rb2b.js` | 200 each; none carry the button words or `climate-match`; page is 4820 bytes, same as the repo file |
| `node --test src/pulse/coverage/fin-b06-not-shipped.test.mjs` | 20 pass |
| mutation of the real page (button text added to `public/climate/index.html`; script made to call the lead door), each restored after its run | 4 and 3 tests red, then 20 pass after restore |
| mutation of the new check's own code (9 breaks: scripts not read, non-200 read as absent, failed script ignored, audit verify always true, door string not looked for, other sites fetched, redirects followed, script cap removed, empty body accepted) plus lane hook removed and audit hook removed | every one red (1 to 15 tests each), restored, 20 pass |
| `npm run pulse:catalog` then `node scripts/pulse/compile-catalog.mjs --check` | exit 0, `3975 mapped, 33 marked repeats, 3942 unique; 3919 wired, 23 red` |
| `node --test src/pulse/coverage/*.test.mjs src/pulse/catalog/*.test.mjs src/pulse/catalog/proofs/fin-b06-display-contracts.test.mjs` | 2391 tests, 2191 pass, 0 fail, 200 skipped (pg tests, no database here) |
| `node --test src/pulse/*.test.mjs src/pulse/beats/*.test.mjs scripts/pulse/*.test.mjs` | 1113 tests, 1097 pass, 0 fail, 16 skipped |
| `node --test src/pulse/na-conditions.test.mjs` | 36 pass |
| `node --test src/pulse/catalog/proofs/fin-b06-display-browser.test.mjs` (re-run) | 4 pass |
| `node --test --test-name-pattern="every display proof case names\|unmapped display rows" display-proof-cases.test.mjs` | 2 pass |
| every other `src/pulse/catalog/proofs/*.test.mjs` in one run | NOT finished. It spawned playwright e2e specs and ran for over 15 minutes on a busy Mac; stopped. 13 results before the stop, 0 failed. Nothing in it touches this change |

What was not run: `npm run pulse:prove` (it builds the bundle and reads the live database; there is no database
here and the brief says never to run against production). The new read adds up to 9 GETs (4 s each, in parallel
after the first) to the display lane, plus the audit asks once more. If the lane step gets slow, this is the first
thing to look at.

### Repair cycle 1 commands (2026-10-15)

| Command | Result |
|---|---|
| `node scripts/pulse/count-not-proved.mjs` after | `{"total":814,...,"gap-catalog-display":641}`. Batch rows open: 1 (Save month/year). The count went from 813 to 814 on purpose: one false green went back to not proved |
| `npm run pulse:catalog` then `node scripts/pulse/compile-catalog.mjs --check` | exit 0, `3975 mapped, 33 marked repeats, 3942 unique; 3919 wired, 23 red` |
| `node --test src/pulse/coverage/*.test.mjs src/pulse/catalog/*.test.mjs src/pulse/catalog/proofs/fin-b06-display-contracts.test.mjs` | 2408 tests, 2208 pass, 0 fail, 200 skipped (pg tests, no database here) |
| `node --test src/pulse/*.test.mjs src/pulse/beats/*.test.mjs scripts/pulse/*.test.mjs` | 1113 tests, 1097 pass, 0 fail, 16 skipped |
| every `src/pulse/catalog/proofs/*.test.mjs` that opens no browser and is not display-proof-cases | 1465 tests, 1465 pass, 0 fail |
| `node --test src/pulse/catalog/proofs/fin-b06-display-browser.test.mjs` | 11 pass |
| `node --test --test-name-pattern="every display proof case names\|unmapped display rows" display-proof-cases.test.mjs` | 2 pass |
| `node --test src/security/*.test.mjs` | 15 pass, 1 skipped |
| `node scripts/lint.mjs` | 3571 files and inline scripts parse clean |
| definition mutants (27) of `fin-b06-display-contracts.mjs`, kit mutants (5) of `fin-b06-sql-kit.mjs`, each restored after its run | all red |
| mutants (22) of `fin-b06-not-shipped.mjs` | all red, restored |
| breaks of the real pages: `client-control-panel.html` 9, `consent-capture.html` 9, `client-portal.html` 5, each restored after its run | all red; `git status` shows no page changed |
| read-only GET of `https://fundhub.ai/climate/` and `/climate/lender-climate/` and what they lead to, through the new read | `absent`, 10 GETs, no marker found |

Not run: `npm run pulse:prove` (no database here, and the brief forbids production), and the third test in
`display-proof-cases.test.mjs` (it spawns every proof test in the repo).

### Repair cycle 2 commands (2026-10-15)

| Command | Result |
|---|---|
| `node scripts/pulse/count-not-proved.mjs` | `{"total":814,...,"gap-catalog-display":641}`; none of the 13 cycle 2 ids is open; the one batch row open is Save month/year |
| `npm run pulse:catalog` then `node scripts/pulse/compile-catalog.mjs --check` | exit 0, `3975 mapped, 33 marked repeats, 3942 unique; 3919 wired, 23 red` |
| `node --test src/pulse/coverage/*.test.mjs src/pulse/catalog/*.test.mjs src/pulse/catalog/proofs/fin-b06-display-contracts.test.mjs` | 2413 tests, 2213 pass, 0 fail, 200 skipped (pg tests, no database here) |
| `node --test src/pulse/*.test.mjs src/pulse/beats/*.test.mjs scripts/pulse/*.test.mjs` | 1113 tests, 1097 pass, 0 fail, 16 skipped |
| every `src/pulse/catalog/proofs/*.test.mjs` that opens no browser and is not display-proof-cases (78 files) | 1484 tests, 1484 pass, 0 fail |
| `node --test src/pulse/catalog/proofs/fin-b06-display-browser.test.mjs src/pulse/catalog/proofs/fin-b06-display-browser-2.test.mjs` | 32 pass (11 + 21), 0 fail |
| `node --test --test-name-pattern="every display proof case names\|unmapped display rows" src/pulse/catalog/proofs/display-proof-cases.test.mjs` (a plain pipe inside the quotes; escaped here only for this table) | 2 pass; the red count is 651 |
| `node --test src/security/*.test.mjs` | 15 pass, 1 skipped |
| `node scripts/lint.mjs` | 3572 files and inline scripts parse clean |
| 34 breaks of the real pages (`client-control-panel.html` 18, `client-portal.html` 5, `consent-capture.html` 4, `inquiry-remover.html` 7), each run on the real page and each restored after its run | all red. One stayed green the first time: the Call bureau test opened the first case in the list, so a button that posted the first row's id looked right. The test now opens the middle and the last case and a fired first one; then the first-row and last-row breaks were both red |
| 55 mutants of the check definitions in `fin-b06-display-contracts.mjs` (upload door sender, cross-client, type, size, announcement, download keys and checksum, ready date task parts, editor role, frozen copy, confirm record, stuck card, call bureau scoping, window, tolerance, reason literal), each restored after its run | all red. One clause stayed green because it was redundant (a NULL size is already "not above zero"); it was removed rather than kept as a clause that cannot fire |
| 6 mutants of `fin-b06-sql-kit.mjs` (`withinMinutes` judge and both SQL bounds, `dayNotAfterDaysAgo` SQL and judge, `asText` cast) | all red |
| red count script (rows with no exact proof case, over the display maps) | 651 now; 658 at the cycle 1 commit; the 7 rows that left red are the 7 listed in the shared lines table |

Not run: `npm run pulse:prove` (no database here, and the brief forbids production), and the third test in
`display-proof-cases.test.mjs` (it spawns every proof test in the repo).
