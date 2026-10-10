# SMS and email opt-out

Lane: SMS and email opt-out only. Read only. This check does not send a message. It does not change an opt-out row.

breaks: 4
new checks: 4

One tripwire stays Recon. No second watchdog.

Voice is not this lane. Consent papers are not this lane. The SMS gap already skips people who opted out of texts. This check does not look at whether a text was queued.

## Breaks

| id | What fails |
|---|---|
| `opt-out:table-unreadable` | The opt-out table cannot be read, or the app cannot save a STOP to it: no right to add rows, no right to change rows, or the unique key on client and channel is gone (the save needs that key). |
| `opt-out:stop-did-not-stick` | In the last 30 days, a person sent STOP or unsubscribe (the whole message, same words as the inbound handler) and is not opted out now. A later START is fine. Also a FAIL: a STOP reply that matched no client, because there was nobody to opt out. Also a FAIL: an email marked as spam (`complained`) for a person who has no email opt-out. The mail webhooks write the opt-out first, so a complaint with no opt-out means the save did not stick. |
| `opt-out:send-ignores` | The real gate lets an opted-out person through. Or the real dispatcher goes past the gate to the send step. Or another file sends a text or email and never reads opt-out. Or someone who was opted out got a text or email after that time. |
| `opt-out:unsubscribe-link` | The email unsubscribe link cannot be made or checked. This runs the real link code with the signing secret this run has: sign a link, put it in the footer, check it, and check that a link with a changed signature is refused. No database. No network. If the secret is missing, under 32 characters, or a masked copy (asterisks), the dispatcher still sends the mail, with no unsubscribe link, and only writes a warning. |

The gate and the dispatcher are run for real, on an in-memory database that says "this person opted out of texts" (and then "of email"). Nothing is sent. The network is closed. A dispatcher that skipped the gate would stop at "no route", because the made-up database holds no routing row.

The scan of other files looks at `src/` for a file that pulls in the Twilio, Resend, or Mailgun provider (a normal import or `import()`, any name for the send function) and never reads opt-out. Comments do not count as a read. **If the shipped function holds no `src/` folder, the scan is skipped and the detail says so.** It is not a FAIL and it is not counted as a clean scan. Today `src/` is in the function zip, but only because other lanes' files make the bundler pull in the whole repo, not because of this lane. The gate and dispatcher proofs above still run for real, so the main protection holds without it.

Owner and staff alerts are not a client opt-out. They stay off this list: the morning pulse text, the instant pulse text, the ad-video text, the Blake lead text, staff pay mail, and staff login mail.

The count is read only. It counts texts and emails that left (`sent`, `delivered`, `complained`) while the person was opted out: after the opt-out time, and before they opted back in if they did. A later delivery stamp does not count as a new send.

## Already watched, not repeated here

- `public/unsubscribe` (registry): the unsubscribe page answers.
- `gap-sms`: a queued text for a person who opted out of texts.
- Signing of the unsubscribe link is checked here (row 4). Whether a click on it saves is not: that is a write. The registry only pings that the page and `public/unsubscribe` answer.

## What this check cannot see

- A reply like "please stop texting me". The inbound handler only honors the exact keyword, so this check only looks for the exact keyword too.
- An unsubscribe link click that fails to save. That is a write, and there is no row to see. Only the signing and the check of the link are covered.
- A spam complaint on a message that has no client. There is nobody to count, so it is not read.
- A sender outside `src/`. The only one is `netlify/functions/teleprompter-live-text.mjs`, which texts the owner.

## New checks

`gapChecks` in `src/pulse/coverage/gap-opt-out.mjs`. Each row is `{ id, status, detail, suggestedFix }` with PASS, FAIL, or skip. It needs `db` and `orgId` for the reads. The pulse passes both. With no database it still runs the gate and dispatcher proof, the file scan, and the link row. The link row reads `ctx.env` (the function's own settings when the pulse passes none).

## Prove

`node --test src/pulse/coverage/gap-opt-out.test.mjs`

- tests 43
- pass 43
- fail 0
- skipped 0

That is the run with no `DATABASE_URL`. The 15 real-database tests (below) do not run then. With `DATABASE_URL` set (run from the repo with `node --env-file=.env --test ...`): tests 58, pass 58, fail 0, skipped 0.

## Review — Claude, 2026-10-08

What was wrong:

- **It read FAIL every morning in the shipped function.** The check looked for `src/` in a folder that is not there when the code runs on Netlify. It found nothing, so it said "gate.mjs does not read opt-out" and "dispatch.mjs sends without the opt-out gate". Both were false. Proven by running the lane from a built bundle: 1 FAIL before, 3 PASS after.
- **A comment could fool it.** The old check matched text in the gate file. Take out the real opt-out line, leave a comment that names it, and the old check still passed. Proven on a scratch copy.
- **A person who sent STOP twice looked like a STOP that did not stick.** The second STOP moves the opt-out time later. The old read then thought the first STOP was never saved. Proven on made-up rows: the old read counted 4 people, the right answer is 3.
- **STOP replies that matched no client were dropped from the count.** In production 273 of 274 inbound texts match no client. A real STOP from an unmatched number would have been invisible.
- **A message sent while someone was opted out was forgotten once they opted back in.** The old count only joined people who are still opted out.
- **Nothing watched the save itself.** Drop the unique key on client and channel and every STOP would throw. With no STOP in the history, every row would still read PASS.
- A sender that pulled the provider in under another name than `send`, or with `import()`, was not seen.

What changed:

- The scan now looks where the shipped function keeps `src/` (next to `netlify/`, the task folder, and the working folder). If it finds no source files it skips the scan and says so. It never turns that into a FAIL or a PASS.
- The real gate and the real dispatcher are run on a made-up database. Four runs each: opted out of text or email, message by text or email. Same channel must be held. The other channel must get through. If the control case is held, the proof says it could not run and falls back to the old text check. If neither the run nor the text shows a file, the row is a skip that names the file. It is never a PASS.
- The STOP read asks "is this person opted out now, or did they opt back in after the STOP". It also counts STOP replies that matched no client.
- The table read also checks the app can add and change rows and that the unique key is there.
- The sent-after count also catches a message that left between an opt-out and a later opt-in.
- The file scan strips comments, sees `import()`, and counts any name for the send function.

Live result after (read only, as the app role): prod 3 pass, 0 fail, 0 skip. Staff run 3 pass, 0 fail, 0 skip. Bare run (no company id) 3 skip. Plain and staff reads match (370 messages, 61 clients, 0 opt-outs both ways), and the policies on those tables are open, so the role is not blind. 0 query errors, 0 write tries. From a built bundle (the shipped shape): 3 pass with the source files beside it, and 3 pass with none (the scan is skipped and the detail says so).

The company right now: the opt-out table has 0 rows, ever. No STOP has ever arrived (274 inbound texts, 0 STOP words). So the STOP path has never run in production, and every PASS here is true but untested by real traffic.

Tests: 28 pass, 0 fail, 0 skipped. 13 deliberate breaks of the code were tried in a scratch copy. All 13 were caught. The SQL cannot run in the unit tests (no local Postgres), so it was run on the live database inside a read-only transaction against made-up rows: STOP read gave 3 people and 1 unmatched as expected, sent-after gave 3 people as expected, table read gave `can_add`, `can_change`, `has_key` all true on the real table.

Left alone: no real break was found, and nothing outside this lane was changed.

## Review 2 — Claude, 2026-10-08

What the checker found, and what changed:

- **No test ran the three database reads.** Tests only looked at the words in them. Nine deliberate breaks (a flipped test, a dropped channel match, a status taken out, a dead key pattern) all left the 28 tests green. Now each read runs on the real database engine inside the test file. A few made-up rows stand in for the real tables for one SELECT. Nothing is written. No table is made. No real row is read. 15 tests cover STOP (open opt-out, STOP twice, START after, opt-in before, another person, channel or company, a number that matched no client, the word list, the 30-day window, demo rows), sent-after (after, in between, before, which statuses count, other channel, last try wins), complaints, and the table row (the real unique key is found, each wrong shape is refused, the two right names are really used). They skip when `DATABASE_URL` is not set. The words in each read are also pinned line by line, so a flipped test turns the file red even with no database.
- **Gap: spam complaints.** The mail hooks mark the email `complained` and write the opt-out. A complaint that did not stick was invisible. The STOP row now counts it. Today there are 0 complained emails, so it reads PASS. The FAIL path is proven on made-up rows.
- **Gap: the unsubscribe link.** `dispatch.mjs` signs a link for every client email. If the secret is missing, it sends the mail anyway, with no link, and only writes a warning. Nothing watched that. New row `opt-out:unsubscribe-link` runs the real signer, footer and checker in this process. It also checks that a link with a changed signature is refused. A masked secret (asterisks) is named as that in the detail. The secret is never printed.
- **Wording:** when the opt-out table could not be read, the send row said "No database in this run". Now it says the table could not be read.
- **The outer catch had no test.** A change that turned its three FAIL rows into PASS rows survived. A test now trips it on purpose and expects FAIL on every row.
- **Board:** it said the scan of other files looks at `src/`. It now says the scan is skipped when the function holds no `src/`.

Left as is, on purpose: a plain text "STOP" from the proving line would read FAIL for 30 days. A STOP from a number that matched no client has no one to opt out. That is the case this row exists to see. Today 273 of 274 inbound texts match no client, and none is a STOP word.

Live result after (read only, as the app role, 0 query errors, 0 write tries):

- Run as this laptop is set up: prod 3 pass, 1 fail, 0 skip. Staff run the same. Bare run (no company id) 1 fail, 3 skip.
- The one FAIL is `opt-out:unsubscribe-link`. It is the laptop, not proof of a company break. The `UNSUBSCRIBE_TOKEN_SECRET` in the laptop `.env` (and in `credentials/env.full.snapshot`) is a 20-character masked copy, like the ones Netlify prints for hidden variables. The signer takes that one first and refuses it. So the row is right to say it cannot sign.
- Same run with only that one masked value blanked, so the signer uses the real `DOCUMENT_URL_SECRET`: prod 4 pass, 0 fail, 0 skip. Staff run the same. Bare run 1 pass, 3 skip.
- **Not known: the value in production.** Netlify prints that variable as a 20-character mask. It does that for every hidden variable, so it says nothing either way. One read-only GET to the public unsubscribe page, with a link signed by `DOCUMENT_URL_SECRET`, answered 400. So production has the variable set to something other than the document secret. A real secret (fine) and a stored mask (every client email leaves with no unsubscribe link) both look like that from outside. `dispatch.mjs` says production has it set. The first morning run in production will answer it. If this row reads FAIL there, it is real.
- Plain and staff rows are the same for all four reads (0 complained emails, 0 STOP words, 0 sent after an opt-out, 370 messages both ways). The role is not blind.
- Built bundle, run in an empty folder (the shipped shape): the link row is PASS with a good secret and FAIL with none. The scan of other senders is skipped and the detail says so.

Tests: 43 pass with no database. 58 pass with one. Deliberate breaks of the code were tried in a scratch copy. 41 with no database: every one caught. 14 more with a database: 12 caught. The other 2 were an edit that changed nothing, and a company check dropped from the clients join, which cannot change an answer because client ids are unique.

Not mine, not touched: the local `.netlify/functions/api.zip` (16:37 build) holds a 7540-byte `.env` at its root. `netlify.toml` leaves out `credentials/**` only. Two other lanes' files pull the whole repo into the bundle.
