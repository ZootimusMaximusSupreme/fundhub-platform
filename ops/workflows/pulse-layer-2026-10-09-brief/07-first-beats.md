# Brief 07 — The first beats (2026-10-09)

Area: what each first beat must do, step by step, and which are safe to build tonight.
Read-only research. No app code, tests, config or env were changed. Netlify values were never read, only names.

## In plain words

Chris named three things that broke. A payment notice did not arrive. The Apply button died on one bank. A client did not get a text. This brief gives one beat for each, plus beats for the first steps a new customer walks.

Each beat sends a fake signal down the real code. It checks that every step answers. Then it throws the fake data away, so no fake customer is ever saved and no real person is ever texted.

Five beats are safe to build tonight. They are the payment door, the bank links, the bank proxy, the text path and the email path. Four more are safe once one small shared helper exists: the lead forms, the checkout, and the sign-in link. The rest wait for the door switch from brief 06.

The bank test found something real. I looked at 40 banks once each. 3 of 40 were already broken. One page is gone (404). One page says "404" but answers 200. One bank has a bad security certificate. A few banks block robots with a 403. That is not the same as broken. The beat must tell the two apart, or it will cry wolf every hour.

Two traps will bite the builder. First, `src/http/router.mjs:318` loads every event handler the first time a webhook comes in. Never call that router inside the runner. Second, the text alert goes out on Twilio. If Twilio is the thing that broke, the alert cannot leave. The alert needs a second road (ntfy or email).

## 0. Summary table

| # | Beat id | Covers (owner failure) | Safe tonight? | Needs |
|---|---|---|---|---|
| 1 | `pay-webhook` | (1) payment webhook | Yes | none |
| 2 | `apply-links` | (2) Apply on a bank | Yes | new state table + one allow-list line |
| 3 | `apply-proxy` | (2) Apply, the proxy half | Yes | none |
| 4 | `text-path` | (3) text not received | Yes | the sandbox helper (section 1) |
| 5 | `email-path` | email not received | Yes | the sandbox helper |
| 6 | `lead-survey` | lead capture, website form | Yes, after helper tested | helper |
| 7 | `lead-cf-hook` | lead capture, ClickFunnels hook | Yes, after helper tested | helper, brief 06 bus flag preferred |
| 8 | `checkout-mint` | roadmap $297 checkout | Yes, after helper tested | helper |
| 9 | `sign-in-link` | portal sign-in link | Yes, after helper tested | helper, a pulse account made inside the transaction |
| 10 | `booking-hook` | booking | Half: the hook to event only | handler-level capture for the booking row (later) |
| 11 | `lead-slo-interest` | /roadmap opt-in | Later | helper plus a ClickFunnels write capture |
| 12 | `text-canary` | a text really reaches a phone | No: needs Chris's yes | owner decision D3 |

"Safe tonight" means: new files only, a GET or a rolled-back local call, nothing that can reach a customer, and no change to a live door.

## 1. Shared rules every beat obeys (the sandbox helper)

All of these come from code I read. File:line after each.

1. **One private database connection per beat, always rolled back.** `src/db.mjs:76-78` makes `db.query` use the shared pool, so `BEGIN` on it leaks to other callers. A beat takes `pool().connect()` (`src/db.mjs:29`), runs `BEGIN`, then `SET LOCAL statement_timeout = '5s'` and `SET LOCAL idle_in_transaction_session_timeout = '10s'` (LOCAL only; a bare `SET` stuck on the live pool once, see memory note "Pooler SET leaks"). It ends with `ROLLBACK` in a `finally` and `client.release(true)` (destroy, do not recycle). The wrapper handed to code refuses any text that starts with COMMIT or END. The last step of every beat reads from a different connection to prove the pulse rows are gone.
2. **Handlers must not be registered in the runner.** `src/events/registry.mjs:14` `getHandlers` is empty until `ensureRegistered()` (`src/register-all.mjs:97`) runs. `src/http/router.mjs:318` calls it on every webhook. So the runner must not import or call `handleWebhook`. Call the adapter functions directly (`handleCommasWebhook`, `handleClickFunnelsWebhook`). Each beat starts with `assert getHandlers("payment.received").length === 0` and the same for `entry.captured`. If the router is ever pulled in, the beat goes red with step `handlers-unregistered`. Handlers are what send Meta purchase events (`src/handlers/meta-purchase.mjs`) and start credit pulls (`registerDiagnosticSoftPull`, `src/register-all.mjs:20`).
3. **Stop the Inngest hand-off.** `src/events/bus.mjs:49-53` sends every event to Inngest whenever `INNGEST_EVENT_KEY` is set, and it is set permanently (CLAUDE.md section 11). `sendTemplated` also emits `message.queued` (`src/workflows/messaging.mjs:287`). The helper replaces `inngest.send` (`src/workflows/client.mjs:14`) with a recorder for the life of the beat and restores it in `finally`. It never touches the stored env value. Preferred: the pulse flag in brief 06 section "pulse mode" (`bus.mjs` treats pulse as `skipInngest`). Tonight the replacement works alone.
4. **Capture, do not send.** Sends use a recording `fetchImpl`. The seam is real: `dispatchOne(db, message, {fetchImpl, now, env})` passes `fetchImpl` to `provider.send` (`src/messaging/dispatch.mjs:373, 656`), and `src/messaging/providers/http.mjs` forwards it to `transmit` (`src/lib/outbound-fetch.mjs:190`). The fence is NOT bypassed by it: `MESSAGING_DRY_RUN` still has to be open (`outbound-fetch.mjs:190-192` comment). So a closed fence shows as a red beat, which is correct.
5. **Every pulse person is Chris, never a stranger.** Email `e2e+pulse-<runid>@fundhub.ai`. The `e2e+` prefix is the sanctioned prove identity (`src/messaging/gate.mjs:185-205`) and it skips quiet hours, so the beat does not go false-red at night. Phone is `PULSE_SMS_TO` made E.164 (`src/pulse/notify.mjs:21-35`). If a send ever leaked, it would land on Chris's own phone and inbox, loudly.
6. **A client made inside the transaction still burns a code.** `assign_client_code()` uses `nextval('client_code_seq')`; sequences are not rolled back (brief 06 F8e). Gaps will appear in client codes. Owner decision D2.
7. **Do not set staff scope for door beats.** Real doors run without `fundhub.actor`. `commas_inbox`, `webhook_captures`, `lenders`, `proxy_sessions` and `message_channel_routing` all have an open policy (`USING true`; read-only SQL on `pg_policies`), so they work either way. Only the new state table read needs `set_config('fundhub.actor','staff',true)`.
8. **A swallowed error aborts the transaction.** `captureInboundWebhook` (`src/http/router.mjs:209`) swallows its own insert error. Inside a transaction Postgres then rejects every later statement (25P02). The helper wraps each risky step in `SAVEPOINT` / `ROLLBACK TO` or reads the 25P02 and reports the step that caused it.
9. **Result shape.** `{ ok, step, detail, ms, evidence }`. `step` is the name of the step that failed, or `done`. Each step also records its own `ms` so a slow step is visible before it fails.
10. **The runner has a 25 s abort.** The scheduled function limit is 30 s (task brief). Every beat gets its own deadline: db beats 8 s, GET beats 12 s. A beat that hits its deadline reports `step: "deadline"` and the step it was in.

Honest limit of all in-process beats: they run in the runner's own bundle. They prove the logic, the database shape, the keys and the vendor request shape. They do not prove the deployed `api` function loads (the fontkit incident was a per-function bundle failure, `netlify/functions/commas-inbox-sweeper.mjs:27-35`). The cheap partner proof is the GET ping to the door: `GET /api/webhooks/commas` must answer 405 (`src/pulse/coverage/gap-payments.mjs` `pingDoor`, line 399). A 405 comes from `api/webhooks/[provider].mjs:54-58`, so the module loaded. Only the phase 2 door call (brief 06 header `x-fundhub-pulse`) proves the whole path.

## 2. Beat 1 — `pay-webhook` (owner failure 1)

**Surfaces.** `job:commas-inbox-drain` (`src/pulse/tripwires.mjs:44`), `route:payment-links` (`:43`). There is no key for the webhook door itself: `webhooks/` is reached by prefix, not by a `ROUTES` key (`netlify/functions/api.mjs:1458`), so `tripwires.test.mjs` cannot see it (brief 06 F3). Proposal for the contract author: a new key `route:webhooks/commas` in `TRIPWIRES` pointing at this beat. Not invented here, flagged.

**What the real door does** (so the beat copies it):
- Netlify api function → `api/webhooks/[provider].mjs:54` reads the raw bytes (`readRawBody`, `:25`) → `handleWebhook` (`router.mjs:300`) → table entry `commas` (`router.mjs:64`: header list `COMMAS_SIG_HEADERS`, secret `COMMAS_WEBHOOK_SECRET`, second key `SIM_WEBHOOK_SECRET`) → `handleCommasWebhook` (`src/adapters/commas.mjs:570`).
- It verifies HMAC-SHA256 hex over the exact bytes (`commas.mjs:67-79`). Header `x-webhook-signature` first, `x-commas-signature` second (`commas.mjs:53`).
- It does ONE durable thing: `enqueue` writes the bytes to `commas_inbox` (`src/payments/commas-inbox.mjs:82-111`) and answers 200. Everything else is the sweeper's job (`commas.mjs:536-566` comment: Commas delivers at most once, no retries).
- Then `captureInboundWebhook` writes a `webhook_captures` row (`router.mjs:209`).

**Can the runner sign a real receipt?** Yes, inside the live function. The secret is hidden from the CLI (laptop copy of `COMMAS_WEBHOOK_SECRET` is a row of asterisks; `SIM_WEBHOOK_SECRET` is real on the laptop, length 48), but the live function reads the real value at run time: `webhook_captures` holds 3 Commas deliveries with `outcome.signedWith = "live"` (read-only SQL), and `gap-keys.mjs:142-147` already calls an asterisk value a red on the server. The name `COMMAS_WEBHOOK_SECRET` is on Netlify production (names list). The beat signs with the REAL key and passes no `simSecret`, so it proves the live key path, not the sim key. `PULSE_SECRET` is a different thing: it only signs the `x-fundhub-pulse` header (phase 2). It does not replace the Commas key.

**What a made-up customer does.** The door does not look at the customer at all. The money chain (client create, entitlement, commission, Meta purchase) runs later in `processCommasInboxRow` → `emit` (`commas.mjs:845`) → registered handlers. That is exactly the dangerous part (Meta purchase, `meta-purchase.mjs`; credit pull on `diagnostic.paid`). So the beat uses an event type that maps to nothing: `pulse.receipt_check`. `mapToCanonical` returns `[]` for it (`commas.mjs:430-535`: no `subscription.`, `expired`, `cancel`, `refund`, `dispute`, `chargeback`, `failed`, `succeeded`), and `processCommasInboxRow` returns `{ignored:true, reason:"no_canonical_mapping:pulse.receipt_check"}` before touching the database (`commas.mjs:785`). No `emit`, so no Inngest, no handler.

**Steps** (name reported when it stops):
1. `secret-present` — `COMMAS_WEBHOOK_SECRET` set and not a mask (`keyState`, `gap-keys.mjs:142`). Skipped with a clear reason off the live server (`onServer`, `:137`).
2. `door-mounted` — `GET {site}/api/webhooks/commas` answers 405 (reuse `pingDoor`).
3. `handlers-unregistered` — rule 2 above.
4. `signature-accepted` — build body `{"id":"pulse-evt-<run>","type":"pulse.receipt_check","data":{"payment_id":"pulse-<run>","amount":297,"email":"e2e+pulse-<run>@fundhub.ai"}}`, sign the exact bytes, call `handleCommasWebhook({db: tx, rawBody, signatureHeader, secret})`. Expect `ok:true, status:200, signedWith:"live"`. A 401 `bad_signature` stops here.
5. `inbox-write` — `queued:true` and an `inboxId`; read the row back in the same transaction: `raw_body` is byte-equal to what was sent, `status='pending'`, `org_id` is the default org.
6. `row-processable` — `processCommasInboxRow(row, tx)` returns the ignored result above, no throw.
7. `dedupe` — post the same bytes again; expect `deduped:true` (`enqueue`, `commas-inbox.mjs:95-110`).
8. `rolled-back` — ROLLBACK, then a fresh connection finds 0 rows with `payment_id = 'pulse-<run>'`.
9. `sweeper-alive` — one read-only SELECT: the oldest `pending`/`failed` row with attempts left is younger than 10 minutes (same rule as tripwire `payments:commas-inbox-waiting`, `gap-payments.mjs:769`). This is the check that catches the 2026-09-17 incident (six rows pending, attempts 0; `src/workflows/commas-inbox-drain.mjs:3-30`).

**Duration.** About 0.7 s: connect 0.33 s measured, then 8 round trips at 44 ms each (measured from this machine to the live pooler). Step 2 adds one site GET (about 0.2 s, in parallel).

**Fix guide.**
- `secret-present` / `signature-accepted` red: the live key is empty, a mask, or Commas now signs with a different secret. In Commas open the webhook settings, copy the signing secret, set `COMMAS_WEBHOOK_SECRET` on Netlify production WITHOUT `--secret`, ship once. Never delete the old value first (CLAUDE.md section 11). If the pulse itself is green but real payments stop, see "cannot prove".
- `door-mounted` red: 404 means the `webhooks/` prefix or `api/webhooks/[provider].mjs` is gone from `netlify/functions/api.mjs:1458`; 5xx or no answer means the api function is not loading (look at the Netlify function log for "Cannot find module").
- `inbox-write` red: read the message. A 25P02 or permission error means the app role lost its right on `commas_inbox`; a missing column means a migration did not ship (`/api/health` field `pending`).
- `sweeper-alive` red: the inbox clocks are dead. Two clocks exist: Netlify `commas-inbox-sweeper` (`netlify.toml:197`) and Inngest `commas-inbox-drain`. Check which one ran last in `job_heartbeats`. A scheduled function that throws at load stops silently (netlify.toml:104-117 records it).

**Cannot prove (say it plainly).** Whether Commas still sends to us, and whether its signing secret matches ours. The pulse signs with OUR copy, so a changed secret on the Commas side stays invisible. The repo has no "list recent payments" call (`src/payments/commas-api.mjs` exports `getPayment` and `reconcilePayment` only, header lines 38-44 call missed deliveries NOT COVERED). Real traffic is rare: last real `payment.succeeded` in `commas_inbox` is 2026-09-15, last real `payment.failed` 2026-10-01 (read-only SQL). Closing that hole needs a Commas list endpoint or a daily payout compare. Open question U1.

**Safe tonight: yes.**

## 3. Beat 2 — `apply-links` (owner failure 2, the bank page)

**What Apply is.** A button on two staff screens: `public/app/client-control-panel.html:4811-4821` and `public/app/lenders.html:377-388`. It shows only when the bank has an `application_url`; otherwise the row says "No online application on file" (`client-control-panel.html:4828`). Click runs `FHProxyApply.applyToLender` (`public/app/proxy-apply.js:232`), which POSTs `/api/proxy/launch` (`proxy-apply.js:243`), then hands the proxy login and `application_url` to a Chrome extension that opens the bank page through a US residential exit near the client. "Works" for the advisor means two things: (a) the proxy session starts and the exit city is verified (beat 3), and (b) the bank URL really opens the application (this beat). Roles allowed: owner and funding_advisor (`api/proxy/launch.mjs:10`). The extension itself cannot be tested from a server.

**The book.** `lenders`: 1,106 rows, all active, 1,058 with `application_url` (read-only SQL; matches Chris's numbers). 987 distinct URLs on 365 hosts. But 587 of those URLs sit on only 4 hosts: `creditcardlearnmore.com` (325 online + 22 in-branch + 6 personal), `www.mycommunitycc.com` (181), `www.mycardapply.com` (61), `app.thecardservicescenter.com` (16). These are issuer tracking links (query strings like `ecdma-lc=...&ecid=...`). So "check each host once" would test 365 hosts and still miss 587 links. The unit must be the URL, not the host. Lender rows by table: OnlineBizCC 836, InBranchBizCC 167, PersonalCC 29, PersonalLoans 26.

**One bad row already.** One URL has a literal space inside it (`...?ecdma-lc= 27795&ecid=...`). Found by `application_url !~ '^https?://[^ ]+$'`. A URL-shape step would catch this; it is the first catch. Not fixed (read-only brief).

### 3.1 Calibration — 40 hosts, one GET each, from this machine

Method: seeded pick, 40 distinct hosts (the 4 big tracking hosts, the 8 biggest other hosts, 28 random), one URL each, `GET`, user agent `FundhubPulse/1.0 (+https://fundhub.ai)`, 8 s timeout, redirects followed by hand up to 6 hops, first 64 KB read for the page title. No host was hit twice (two redirects moved to a `www.` name, once each). Raw results live in my scratch folder only.

| Result | Count | Which |
|---|---|---|
| 200, real page | 30 | includes 2 that redirected once (301/302) then 200; includes all 4 tracking hosts |
| 200 but a bot wall | 1 | `baycoastbank.myapexcard.com`, title "Pardon Our Interruption" |
| 200 but a soft 404 | 1 | `www.bankatpeoples.com`, title "404 - File Not Found" |
| 403 | 5 | `www.flagstar.com` and `www.carterbank.com` ("Just a moment..." = Cloudflare challenge), `www.alliantcreditunion.org` (normal title), `www.traditions.bank` and `www.veritycu.com` (plain "403 Forbidden") |
| 404, real | 1 | `www.westernalliancebancorporation.com`, title "Page Not Found" |
| TLS name mismatch | 1 | `www.citywidebanks.com` (certificate is for another name) |
| Timeout at 8 s | 1 | `www.penfed.org` |
| DNS failure / connection refused / 5xx | 0 | none in this sample |

Timing: median 316 ms, 90th percentile 1,012 ms, one 8,002 ms timeout, sum 25.3 s over 40 requests at concurrency 8.

Reading: about 3 of 40 (7.5%) are really broken: the 404, the soft 404, the bad certificate. About 7 of 40 (17.5%) are bot walls, not breaks. 1 of 40 is slow and unknown. Caveat that matters: this machine is a home or office address. The live runner is an AWS address, which banks block more. Expect more 403s from Netlify. Small sample, one URL per host; the 8% rate is a rough guide for the 400 non-tracking URLs (about 30, range maybe 8 to 60), not a measurement. The 4 tracking hosts all answered 200 here, but one URL each says little about the other 586.

### 3.2 The rule: down or moved versus bot wall

Classes (stored per URL):
- `OK`: 2xx and the title is not a not-found page; redirects allowed (max 5).
- `WALL` (never red by itself): status 403 or 429; or 503 with a challenge marker; or a 200 whose title matches `just a moment|pardon our interruption|access denied|attention required|verify you are human|robot|captcha`; or header `cf-mitigated: challenge`. Plain "403 Forbidden" on its own is ambiguous, so it is `WALL`, shown as "unproven", never red.
- `HARD` (can be red): DNS `ENOTFOUND`; `ECONNREFUSED`; TLS error (`ERR_TLS_CERT_ALTNAME_INVALID`, `CERT_HAS_EXPIRED`, `UNABLE_TO_VERIFY_LEAF_SIGNATURE`; a browser shows a warning too, so the customer is blocked); 404 or 410 whose title looks like not-found; 200 with a not-found title (`404|not found|page unavailable|no longer available|doesn't exist`); 5xx without a challenge marker; a redirect chain that ends on the site root `/` when the stored path was deeper ("moved to home").
- `SLOW`: timeout or `EAI_AGAIN`. Red only at 3 reads in a row on 3 different hours.
- `BAD_URL`: fails `^https://[^\s]+$` (the space case above). Free to check, no network. Red when the count goes up from the stored baseline.

Red when: `HARD` or `BAD_URL` on a URL that was `OK` before (it has a `last_good_at`) AND a second read of the same URL (60 s later, in the same run, only for hard fails; at most 5 per run) says the same. That is "a bank that WAS good and now is dead or 404".

Never red: a URL that was never good (this is link debt, counted in the weekly digest, not hourly), and anything `WALL`.

Wall second opinion (optional, owner decision D4): the real customer path is the Oxylabs residential exit, so a `WALL` on first sight can be re-read once through the proxy (`fetchThroughProxy`, `src/adapters/oxylabs.mjs:185`); a 2xx from the proxy marks it `OK via proxy`. Cost is a few KB per URL, once per URL per week. Default: off.

First run: the first pass over all URLs only fills the state table. It raises nothing. After that only changes raise a break. If the first pass raised alerts for every never-good URL, the beat would be red all day and Chris would stop reading it.

### 3.3 Rotation design

- Unit: distinct `application_url` (987). Default 40 per hour so each URL is read about every 25 hours, "about daily" as Chris asked. If Chris wants it tighter, 60 per hour covers the book in 16.5 hours.
- Pick order: oldest `last_checked_at` first, never-checked first. Cap 6 per tracking host per run and 2 per other host, so no host gets 40 hits in an hour. Global concurrency 20.
- Deadline: stop starting new reads at 12 s; unfinished URLs keep their old date and are first in line next hour.
- Never hit a host more than the cap, honest user agent, GET only, read at most 64 KB then cancel, no cookies. HEAD was not tested; some banks refuse it.
- Storage: new table `pulse_bank_links` (one row per distinct URL). Columns: `url_hash text primary key` (sha-256 of the URL), `lender_ids uuid[]`, `host text`, `last_checked_at timestamptz`, `last_class text`, `last_status int`, `last_detail text`, `last_good_at timestamptz`, `fail_streak int`, `final_host text`. Not the URL's query string in the detail text. RLS like its sisters (open policy, staff reads). Needs a migration after brief 03's 475; it is not live until it ships.
- Outbound rule: new GETs may not be added outside `src/messaging/providers/*` unless the file is on `ALLOWED_RAW_FETCH` with a written reason (`src/lib/no-unfenced-transmit.test.mjs:50-67`). Precedent: the gap lanes (`:59-65`). Add `src/pulse/beats/apply-links.mjs` there with the reason "read-only GET of public bank application pages, honest user agent, never POST, never a client record". One reviewed-list edit.

**Steps.** 1 `url-shape` (SQL only: count with URL, count malformed, count non-https; red if the count with URLs drops more than 5% since last run, which means a data wipe); 2 `pick` (state read, staff scope); 3 `fetch` (the 40 reads); 4 `classify`; 5 `confirm` (hard fails only); 6 `store` (upsert state); 7 `verdict` (new breaks only). Reported step names: `url-shape`, `fetch`, `confirm`, `store`.

**Duration.** 1.5 to 3 s typical at concurrency 20 (median read 316 ms, 40 reads). Capped at 12 s.

**Surfaces.** `route:proxy/launch`, `desk:client-control-panel.html`, `desk:lenders.html`, `route:lenders`, `route:read/lenders`. All five are on the unsorted baseline today (`src/pulse/tripwires-baseline.json`), not in `TRIPWIRES`. They must be moved into `TRIPWIRES` (impact `customer`, check id `pulse:apply-links`) in the same change, or the baseline cannot shrink. Note brief 06: the baseline list may only shrink.

**Fix guide (per break).** The alert names the bank, the lender row id, the class and the final address.
1. Open the URL by hand from a phone. If it opens, it was a wall; mark nothing, the beat will settle.
2. `404` / soft 404 / moved to home: the bank moved its page. Find the new application page on the bank's own site, put it in `lenders.application_url` for that row (Lenders screen). If the bank no longer takes online applications, clear the URL so the button turns into "No online application on file". Do not delete the lender.
3. TLS or DNS: the bank's site is misconfigured or retired. Re-check in 24 hours; if still dead, same as 2.
4. Tracking host (`creditcardlearnmore.com`, `mycommunitycc.com`, `mycardapply.com`, `thecardservicescenter.com`): the issuer program changed its link id. Get the new link from the affiliate dashboard; many rows on the same host break together, so the alert groups them by host.

**Safe tonight: yes.** New files plus one allow-list line plus one migration. No live door touched. GET only.

## 4. Beat 3 — `apply-proxy` (owner failure 2, the proxy half)

**What it proves.** The Oxylabs login works and an exit near a test city answers. This is exactly `launchCredentials` (`src/adapters/oxylabs.mjs:385`), the first thing `launchProxySession` does (`src/proxy/launch.mjs:107`). The beat calls it directly with a fixed test place (Phoenix, AZ). It does not call `launchProxySession`, so it writes no `proxy_sessions` row. (That table has 0 rows today: Apply has never been used on live, read-only SQL. So there is no real-traffic proof anywhere that this works.)

**Steps.** 1 `creds-present` (`oxylabsConfigFromEnv`, `oxylabs.mjs:63`; it detects a masked password); 2 `door-mounted` (`GET /api/proxy/launch` answers 405, `api/proxy/launch.mjs:44-47`, before auth); 3 `exit-verified` (`launchCredentials({city:"Phoenix", state:"AZ"})` returns `ok:true` with a granted city or region; it tries city first, then state). Error codes map to the screen's own sentences in `api/proxy/launch.mjs:14-38`: `oxylabs_credentials_missing`, `oxylabs_auth_failed`, `geo_unavailable`. The beat reports the code as the step detail.

**Duration.** 0.8 to 3 s (CONNECT plus TLS to `ip.oxylabs.io`, `oxylabs.mjs:21`). Deadline 10 s. Cost: a few KB per call through a residential exit, 24 calls a day. Residential traffic is billed per GB, so this is pennies, but it is a real vendor call.

**Fix guide.** `oxylabs_credentials_missing`: set `OXYLABS_USERNAME` and `OXYLABS_PASSWORD` (names exist on Netlify production). `oxylabs_auth_failed`: the account id is wrong or has a `customer-` prefix (`NEXT_STEP`, `api/proxy/launch.mjs:19-20`). `geo_unavailable`: the vendor has no exit for that city right now; retry; red only after 3 in a row.

**Cannot prove.** The Chrome extension, the staff role gate, a client with a city on file, or the advisor's browser. Those need a real Apply click by a person.

**Safe tonight: yes.** (Outbound code path is `oxylabs.mjs`, already a reviewed adapter.)

## 5. Beat 4 — `text-path` (owner failure 3)

**The send path.** `sendTemplated` writes a `queued` message (`src/workflows/messaging.mjs:153-300`) → the dispatcher `dispatchOne` (`src/messaging/dispatch.mjs:373`): quiet hours → compliance gate (`gate.mjs`) → draft and placeholder guards → route (`message_channel_routing`: sms is `twilio`, enabled; email is `resend`, enabled — read-only SQL) → synthetic-client guard (`dispatch.mjs:526`) → the `MESSAGING_DRY_RUN` fence (`:563`) → address → `providers/twilio.mjs` `send` (`:656`). The scheduled caller is `message-dispatch-sweeper` (`src/workflows/message-dispatch-sweeper.mjs`, cron `*/5`, CLAUDE.md section 12). The Twilio provider refuses anything that is not E.164 (`providers/twilio.mjs:135`) and adds a `StatusCallback` of `{APP_BASE_URL or URL}/api/webhooks/twilio-status` (`:70-73`); that callback is the only way a "delivered" ever gets written.

**What can be proven with no real send** (this is the answer to "template renders, opt-out gate, E.164, key accepted"):

| Proof | How | Source |
|---|---|---|
| Twilio accepts the key and the account is open | one GET to the account record, nothing sent | `probeTwilio`, `gap-keys.mjs:375` (reuse; it is exported) |
| The locks are open | `MESSAGING_DRY_RUN`, `ADAPTERS_DRY_RUN`, `messaging_settings.outbound_enabled` | `sendFenceOpen`, `gap-keys.mjs:203` (reuse) |
| The template exists, is approved and clean | one SELECT, same guards as the dispatcher | `dispatch.mjs:421-465` |
| The text renders with no leftover `{{` | `sendTemplated` in the transaction | `messaging.mjs:153` |
| The number is E.164 and the opt-out gate lets it through | `dispatchOne` in the transaction | `twilio.mjs:135`, `gate.mjs` |
| Twilio would be called with the right request | recording `fetchImpl`, canned `201 {sid}` | `dispatch.mjs:656`, `outbound-fetch.mjs:190` |
| The delivery receipt would be asked for | the captured form has `StatusCallback` pointing at the live host | `twilio.mjs:70-73, 156` |

**Steps** (name when it stops):
1. `vendor-key` — `probeTwilio` (FAIL when Twilio answers 401/403 or the account is suspended/closed).
2. `locks-open` — `sendFenceOpen`.
3. `route-sms` — `message_channel_routing` sms = `twilio`, `enabled`.
4. `template-ready` — `SMS-S00-WELCOME` is approved (`compliance_passed`), not `[DRAFT]`, no lorem. It is today (read-only SQL).
5. `queue` — create the pulse client in the transaction (rule 5), `sendTemplated(tx, {channel:"sms", templateKey:"SMS-S00-WELCOME", eventId:"pulse-<run>"})`. Expect a `queued` row, `to_address` in E.164, body with no `{{`, `[DRAFT`, or `lorem`.
6. `gate` — `dispatchOne` does not return `blocked` (opt-out, restricted words, quiet hours).
7. `provider-call` — the recorded request is `POST https://api.twilio.com/2010-04-01/Accounts/<sid>/Messages.json`, form has `To` (E.164), `From` or `MessagingServiceSid`, `Body` equal to the stored body, and `StatusCallback` whose host equals the live site host.
8. `recorded` — `outcome: "sent"`, `messages.status='sent'`, `provider_message_id` equals the canned sid.
9. `rolled-back` — fresh connection finds no pulse client and no pulse message.
10. `queue-moving` — one read: no SMS has been `queued` and due for more than 15 minutes while the fence is open (the stuck-queue rule; tripwire `gap:sms-sending-stuck`). Today the SMS queue is empty (0 queued, read-only SQL).
11. `receipts-moving` — one read: a text marked `sent` more than 30 minutes ago with no receipt, or a `failed`/`undelivered` row with a carrier error code (30007 and 30034 are carrier-filter codes) in the last 24 h. Today 7 SMS in 7 days, all delivered; `webhook_captures` shows `twilio-status` deliveries up to 2026-10-09 08:33. Traffic is thin, so this step has little power. Amber, not red, below 5 texts in the window.

**Duration.** About 1.8 s: connect 0.33 s, about 28 round trips at 44 ms, one Twilio GET at about 0.3 s in parallel.

**Surfaces.** `job:message-dispatch-sweeper` (`tripwires.mjs:58`), `job:s-00-welcome` (`:59`), plus the unsorted baseline `route:messages-outbound`, `route:messages`, `route:read/messages`.

**Fix guide.**
- `vendor-key` red: Twilio refused the key or the account is suspended. Open the Twilio console, check the account status and the Auth Token, set `TWILIO_SEND_ACCOUNT_SID` and `TWILIO_SEND_AUTH_TOKEN` on Netlify production (no `--secret`, per `secrets-env-law`). Never delete the old value first.
- `locks-open` red: set `MESSAGING_DRY_RUN` and `ADAPTERS_DRY_RUN` to an off value, or press Turn sending on at `https://fundhub.ai/app/ops-admin.html` (the wording in `gap-keys.mjs` FENCE_CORE and SWITCH_CORE).
- `route-sms` red: the routing row is missing or disabled; this is a data fix in `message_channel_routing`, not a deploy.
- `template-ready` / `queue` red: the template was edited back to draft, or the merge tag renders empty. Open the template editor and check the body.
- `gate` red: read the block code. `opted_out` is the person's choice. `quiet_hours` should never show (the pulse person skips it); if it does the prove identity rule changed (`gate.mjs:185`). A restricted-word code means the template copy hits the compliance word list.
- `provider-call` red with the wrong `StatusCallback` host: `APP_BASE_URL` or `URL` points at the wrong site, so "delivered" would be written for someone else's rows.
- `queue-moving` red: the dispatcher clock is dead; check `message-dispatch-sweeper` in `job_heartbeats`.
- `receipts-moving` red: Twilio takes the message and the carrier drops it. Look for error 30007 or 30034 on the failed rows: the A2P 10DLC registration or the sending number is the cause, fixed in the Twilio console, not in code.

**Cannot prove.** That a phone really got the text. That needs `text-canary` (beat 12). Be clear with Chris: owner failure 3 can have three causes (never queued, queued but never sent, sent but the carrier dropped it). This beat covers the first two directly and the third only through receipts.

**The alert cannot ride the thing that broke.** `src/pulse/notify.mjs:8-9` sends Chris's pulse text through the same Twilio provider. If `text-path` is red because Twilio is down, the text about it cannot leave. The alert for this beat must go through ntfy (`NTFY_TOPIC` is on Netlify production; `src/messaging/providers/ntfy.mjs`) or email, and must say so. For brief 04's author.

**Safe tonight: yes**, once the sandbox helper (section 1) is built and its own test shows zero fetch, zero Inngest send and zero committed rows. The vendor GET alone (steps 1-3) is safe with no helper at all.

## 6. Beat 5 — `email-path`

Same shape as beat 4 with the email provider. Differences:
1. `vendor-key` — `probeResend` (`gap-keys.mjs:414`; Resend answers HTTP 400 "API key is invalid" to a dead key, not 401, per the note at `gap-keys.mjs:341`).
2. `route-email` — email routes to `resend`, enabled.
3. `template-ready` — `EMAIL-S00-WELCOME` approved and clean (it is).
4. `queue`, `gate`, `provider-call` — the recorded request goes to the Resend host with `from` = `RESEND_FROM`, `to` = the pulse address (not a reserved test domain; Resend's `refusedAddress`, `providers/resend.mjs:51`, blocks `example.com` and friends), a subject with no `{{`, and the unsubscribe link and `List-Unsubscribe` headers present. If `UNSUBSCRIBE_TOKEN_SECRET` is missing the dispatcher sends anyway and only logs (`dispatch.mjs:650`), so the beat checks the footer itself.
5. `receipts-moving` — Resend delivery receipts come back on `/api/webhooks/resend`; `webhook_captures` shows 700 resend deliveries, last 2026-10-08 15:05. Read the same stuck/failed counts as beat 4 for email. Today 14 emails delivered in 7 days, 11 failed or blocked ever (all `Invalid to` or `recipient_unknown`, test addresses).

**Duration** about 1.8 s. **Surfaces** `job:message-dispatch-sweeper`, `job:slo-pack-delivery` (`tripwires.mjs`), the sign-in email (beat 9). **Fix guide** is beat 4 with the Resend console and `RESEND_API_KEY`, `RESEND_FROM`, and domain verification. **Safe tonight: yes**, same condition as beat 4.

## 7. Beats 6 to 9 — the launch path

These four use the same recipe: call the real function with its own injection seams, in the sandbox, with captured events. The seams are real:

| Beat | Real function | Seams (file:line) |
|---|---|---|
| 6 `lead-survey` | `runSurveySubmit(parsed, deps)` | `api/public/survey-submit.mjs:116-123`: `deps.db`, `deps.emit`, `deps.ensureRegistered`, `deps.resolveClient` |
| 7 `lead-cf-hook` | `handleClickFunnelsWebhook({db, rawBody, signatureHeader, secret, headers, env, fetchImpl})` | `src/adapters/clickfunnels.mjs:820-828` |
| 8 `checkout-mint` | `runSloCheckout(parsed, deps)` | `api/public/slo-checkout.mjs:301-312`: `deps.db`, `deps.env`, `deps.emit`, `deps.fetchImpl`, `deps.createCheckoutSession`, `deps.demo` |
| 9 `sign-in-link` | `requestMagicLink(db, {email, ip, userAgent})`, then `verifyMagicLink(db, token)` | `src/auth/magic-link.mjs:147, 393` (takes `db`) |

Traps found while reading (each one is a way to send something real):
- `resolveClient` can call the CRM (`src/handlers/client-lifecycle.mjs:146-190`: `syncCrmContact`). It checks the `ADAPTERS_DRY_RUN` fence first, then `GHL_API_KEY`. `GHL_API_KEY` is not on Netlify production today (names list), so today it only marks the link missing. If the key is ever set, a pulse lead would create a CRM contact. The beat passes `opts.env = {...process.env, ADAPTERS_DRY_RUN: "1"}` where it can (survey-submit's `deps.resolveClient` wrapper) and asserts no fetch was recorded.
- `emit` (`bus.mjs:49`) and `sendTemplated`'s `message.queued` (`messaging.mjs:287`): Inngest stub from rule 3.
- `handleSloPaidWebhook` runs inside the ClickFunnels adapter (`clickfunnels.mjs:875`); the beat sends a form event and an appointment event, never a paid event.
- The apply-survey ingest branch (`clickfunnels.mjs:1010`) POSTs a ClickFunnels contact; the beat uses the signed-event branch only, never the ingest header.
- `runSloCheckout` with `demo` unset reads `isSloDemoPay(env)` (`slo-checkout.mjs:304`). The beat passes `demo:false` and also reports if production is in demo mode, because demo mints nothing and a $297 page would be fake.

### Beat 6 `lead-survey`
Surfaces: `route:public/survey-submit` (check `lead:pipe-cut-with-traffic`, `handoff:lead-first-touches-missing`), `job:s-01-new-lead-intake`. Steps: `parse` (valid body for a pulse person) → `classify` (`classifySurvey` returns a redirect in `SURVEY_REDIRECTS`) → `client` (a client uuid, `e2e+` email, phone E.164) → `events` (captured `entry.captured` then `survey.submitted`, same `clientId`, idempotency keys `website-survey:<email>:<ts>:entry|survey`) → `rolled-back`. About 0.9 s. Fix guide: `parse` red means the form contract changed (`src/survey/cf-question-map.mjs`); `client` red means `resolveClient` failed (it swallows errors and returns null, `survey-submit.mjs:92-96`, which is exactly the T14-11 bug class: events with no client); `events` red means an event name is not canonical.

### Beat 7 `lead-cf-hook` (leads and the booking hook arrive here)
Surfaces: `route:public/survey-submit` is the website form; the ClickFunnels hook is prefix-routed and has no key (same gap as beat 1). Steps: `secret-present` (`CLICKFUNNELS_WEBHOOK_SECRET`) → `handlers-unregistered` → `signature-accepted` (HMAC-SHA256 of `<timestamp>.<body>`, within 600 s, headers `x-webhook-clickfunnels-signature` and `-timestamp`, `clickfunnels.mjs:31-52`) → `canonical` (a `form_submission.created` fixture yields the expected canonical events; fixtures exist in `src/adapters/clickfunnels.test.mjs:311, 378`) → `client` (resolved once for the delivery) → `events-recorded` (event rows exist in the transaction) → `rolled-back`. Then the same with `appointments/scheduled_event.created` (`clickfunnels.test.mjs:353`) expecting `booking.created`. About 1.2 s each, in parallel.
What this does NOT prove for booking: the booking row and confirmation are written by the `booking.created` handler (`src/handlers/comms.mjs` per `api/bookings.mjs:15-19`) and the Inngest job `s-04-call-booked`. Handlers are deliberately not registered, so beat 10 is the hook-to-event half only. Closing it needs handler-level capture (later, per brief 06 section on the Journey Runner precedent `api/journeys/run.mjs`).
Fix guide: signature red → `CLICKFUNNELS_WEBHOOK_SECRET` stale; ClickFunnels signs with timestamp (600 s window) so a runner clock problem also shows here; canonical empty → the ClickFunnels payload shape moved (read `normalizeClickFunnelsEvent`, `clickfunnels.mjs:254`).

### Beat 8 `checkout-mint` (roadmap $297)
Surfaces: `route:public/slo-checkout` (checks `payments:checkout-started-no-link`, `keys:checkout-key-read`, `tripwires.mjs:36`), `page:roadmap/pay.html`. The real mint is a POST to Commas/Fanbasis (`createCheckoutSession`, `commas-api.mjs:296`; base `https://www.fanbasis.com/public-api`, key `CORTANA_COMMAS_API_KEY` first). That POST creates a real vendor session, so it is captured with a recording `fetchImpl` and a canned response in the shape the code reads. Steps: `config` (`checkoutConfig(env).ok`) → `not-demo` → `buyer` (client created in the transaction) → `request-shape` (recorded request: right host, auth header present, amount equals `sloCheckoutTotalCents(1)` = the till price, metadata has `link_ref` and `client_id`; the existing tripwire `funnel:order-price-matches-till` guards the same number) → `link-recorded` (`payment_links` row written in the transaction with `link_ref` starting `slo_`) → `response-parsed` (canned reply yields a `paymentLink` and a session id) → `rolled-back`. Vendor-side proof stays with `keys:checkout-key-read` (a GET with the real key), run in the same beat as step `vendor-key`.
Honest limit: a canned vendor reply proves our code reads the shape we recorded, not that Commas still sends it. If Commas changes its reply, `vendor-key` stays green and the mint breaks. Phase 2 can add one real mint-and-void once Commas gives a void call; the repo has none (U2). About 1.5 s.
Fix guide: `config` → `CORTANA_COMMAS_API_KEY` empty or mask (set it on Netlify; the FANBASIS one is the old dead key, `gap-keys.mjs` LAUNCH_SECRETS note); `request-shape` price mismatch → the till and the page disagree (`src/slo/offer.mjs`); `link-recorded` → migration for `payment_links` not shipped.

### Beat 9 `sign-in-link`
Surfaces: `route:auth/magic-link`, `route:auth/magic-link-verify`, `route:auth/send-portal-link`, `page:portal-login.html` (`tripwires.mjs:63-66`). Steps: `account` (a pulse client and portal account created in the transaction; this is the part that needs care because `requestMagicLink` answers the same sentence whether the address has a portal or not, `api/auth/magic-link.mjs:23-26`) → `request` (`requestMagicLink` returns ok, not rate-limited) → `queued` (a queued `EMAIL-PORTAL-MAGIC-LINK` message exists, template approved: it is) → `dispatch` (as beat 5, captured) → `link-in-email` (the recorded email body holds a link whose host is the live site and which carries a token) → `verify` (`verifyMagicLink(tx, token)` returns a session) → `rolled-back`. About 2 s. Fix guide: `queued` red → template missing or draft; `dispatch` red → beat 5's causes; `link-in-email` wrong host → `APP_BASE_URL`/`URL` (`magic-link.mjs:108`); `verify` red → token table or clock (links last 15 minutes, `LINK_TTL_MINUTES`, `magic-link.mjs:56`).

## 8. Later beats

- **Beat 10 `booking-hook`**: see beat 7; the row and confirmation half is later.
- **Beat 11 `lead-slo-interest`**: `recordInterest(body, deps)` has seams (`api/public/slo-interest.mjs:161-217`: `deps.db`, `deps.emit`, `deps.syncCf`, `deps.onCfWrite`) but also writes a ClickFunnels contact (`syncSloClickfunnelsContact`) and tracking; build after beat 7 proves the helper.
- **Beat 12 `text-canary`**: one real text a day (9:05 a.m. Arizona, outside quiet hours) to Chris's own phone from a real committed message row, so Twilio's receipt comes back through `twilio-status` and the next hourly run checks it says `delivered`. It is the only proof the carrier passes our texts. It breaks the "impossible to send" rule on purpose, so it is Chris's call (D3). Default off.
- **Phase 2 for every beat**: the same signal through the real HTTP door with the `x-fundhub-pulse` header (brief 06). That adds module-load and body-parsing proof. Each in-process beat is written so its step list stays the same and only the "call" step changes from direct call to HTTP.

## 9. Decisions for Chris (only he can make these)

- D1. Bank links: 40 reads an hour (every URL about daily) or 60 (every 16 hours)? Default 40.
- D2. Every pulse client that touches the database burns one client code number (`client_code_seq`). OK to have gaps in `FH-000123`-style codes? Alternative: build the pulse client without the trigger, which needs a code change.
- D3. `text-canary`: yes or no to one real text a day to your own phone?
- D4. Re-read walled bank pages through the Oxylabs exit (a few KB each, once a week)? Default no.

## 10. Facts, with evidence

- `lenders`: 1,106 rows, 1,106 active, 1,058 with `application_url`, 987 distinct, 365 hosts, 4 tracking hosts hold 587 distinct URLs, 1 malformed URL (read-only SQL).
- `proxy_sessions`: 0 rows. `lender_bureau_observations`: 0 rows (read-only SQL).
- `commas_inbox`: 36 rows, 25 simulated (sim key), 11 real; last real succeeded 2026-09-15 22:51 UTC, last real failed 2026-10-01 19:52 UTC (read-only SQL). `webhook_captures` commas: 3 signed live, 25 simulated.
- Commas webhook secret: name on Netlify production, laptop copy is a mask, `SIM_WEBHOOK_SECRET` real on the laptop.
- Messages last 7 days: email 14 delivered, sms 7 delivered; sms queue empty (read-only SQL). Routing: sms to `twilio` enabled, email to `resend` enabled.
- Templates approved and clean: `SMS-S00-WELCOME`, `EMAIL-S00-WELCOME`, `EMAIL-PORTAL-MAGIC-LINK`, `payment_link_notice` (read-only SQL).
- Netlify production names present: `COMMAS_WEBHOOK_SECRET`, `SIM_WEBHOOK_SECRET`, `COMMAS_API_KEY`, `CORTANA_COMMAS_API_KEY`, `FANBASIS_CHECKOUT_API_KEY`, `TWILIO_*` (send and inbound), `OXYLABS_USERNAME`, `OXYLABS_PASSWORD`, `PULSE_SMS_TO`, `NTFY_TOPIC`, `MESSAGING_DRY_RUN`, `ADAPTERS_DRY_RUN`, `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`, `META_CAPI_ENABLED`. Absent: `PULSE_SECRET`, `GHL_API_KEY`, and `GITHUB_TOKEN` (the last one exists in the laptop `.env` only; relevant to the live runner opening GitHub issues, brief 04's area).
- Database speed from this machine to the live pooler: connect 329 ms, query round trip 43 to 45 ms (8 samples), begin plus count plus rollback 158 ms.
- No database triggers on `commas_inbox`, `webhook_captures`, `events`, `messages`, `clients`, `payment_links`, `message_templates` call out of the database; `pg_net`, `http` and `pg_cron` extensions are not installed (read-only SQL). The only side doors are in app code (rules 2 and 3) and the counters (rule 6).

## 11. Unknowns (looked, not found)

- U1. No way to ask Commas "which payments exist since time T" (no list call in `src/payments/commas-api.mjs`). So a payment Commas never delivered stays invisible.
- U2. No void or delete call for a Commas checkout session in the repo. A real mint-and-void beat is not possible today.
- U3. Whether Netlify's AWS address gets more bank 403s than this machine. Only a first live run can say; the baseline pass handles it.
- U4. Whether the live runner's region has the same 44 ms database round trip. Not measurable here.
- U5. Whether any tripwire key scheme can name the prefix-routed webhook door or the Netlify scheduled functions. `route:`/`job:` keys cannot (brief 06 F3).
- U6. I did not read `src/handlers/comms.mjs` (the booking handler). The booking-row claim comes from the `api/bookings.mjs` header.
