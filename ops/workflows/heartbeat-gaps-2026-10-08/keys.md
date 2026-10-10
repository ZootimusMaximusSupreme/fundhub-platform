# Keys and switches — heartbeat gaps

Lane: `keys`. A new lane. Morning pulse. Report only.

These six checks read the settings on the live site and one setting row in the database. They also ask the text, email and checkout vendors one question each. They send nothing. They write nothing. They never print a key. Names only.

Files:

- `src/pulse/coverage/gap-keys.mjs`
- `src/pulse/coverage/gap-keys.test.mjs`

## Tier 1 — Claude, 2026-10-09

Built from `ops/workflows/heartbeat-complete-2026-10-09-worklist.md`, lane 1. Then fixed after an independent checker found five problems (see "Checker round" below). Six checks. Each asks one yes-or-no question a customer would feel.

| Check id | The question | Red when |
|---|---|---|
| `keys:send-fence-open` | Are all three locks on customer messages open? | `MESSAGING_DRY_RUN` is not set, is on, or is a wrong value. Or `ADAPTERS_DRY_RUN` is. Or the company send switch in the CRM (`messaging_settings.outbound_enabled`) is off. The text says which lock. |
| `keys:inngest-event-key` | Can the app hand work to the workflow engine? | `INNGEST_EVENT_KEY` is empty or a row of asterisks. Or `INNGEST_SIGNING_KEY` is. |
| `keys:launch-secrets-present` | Is every key the launch needs set on the live site? | Any of 13 keys is empty or a row of asterisks (one of them, `FANBASIS_CHECKOUT_API_KEY`, is red only when empty). The text names the key and what it breaks. |
| `keys:credit-pull-live-allowed` | Will a paying customer get a real credit pull? | `CRS_ALLOW_LIVE` is not an on value. Or `CRS_API_HOST` is the test host, an unknown host, or empty. Or the CRS login is empty or a mask. |
| `keys:vendor-key-read` | Do our text and email keys really work? | Twilio or Resend refuses the key we hold. Or Twilio says the account is suspended or closed. |
| `keys:checkout-key-read` | Does Commas still take the checkout key? | Commas answers 401 or 403 to the key the $297 card page uses. |

The 13 launch keys: `CORTANA_COMMAS_API_KEY`, `FANBASIS_CHECKOUT_API_KEY` (empty only), `COMMAS_WEBHOOK_SECRET`, `CLICKFUNNELS_WEBHOOK_SECRET`, `BLAND_WEBHOOK_SECRET`, `INQUIRY_REMOVAL_WEBHOOK_SECRET`, `POSTGRID_API_KEY`, `POSTGRID_WEBHOOK_SECRET`, `RESEND_API_KEY`, `RESEND_FROM`, `TWILIO_SEND_ACCOUNT_SID`, `TWILIO_SEND_AUTH_TOKEN`, `TWILIO_SEND_FROM`.

### Where I changed the plan, and why

I looked at the real code and the real settings. Five parts of the plan were wrong or would have raised a false alarm.

1. **Resend does not answer 401 or 403 to a bad key. It answers 400.** I asked Resend with a throwaway key on 2026-10-09: `HTTP 400`, "API key is invalid". A check that watched only 401 and 403 would have stayed green on a dead key. This check watches the 400 too. A send-only Resend key gets a 401 `restricted_api_key` on the domain list. That means Resend knew the key. That is a PASS.
2. **There is no `CRS_PROVIDER` setting.** The provider is a fixed name in the code. "Simulated" is something a caller says on each pull. It is never a setting. What makes a pull real or fake is the host (`CRS_API_HOST`), the switch (`CRS_ALLOW_LIVE`) and the login. The check reads those.
3. **`LENDFLOW_WEBHOOK_SECRET` is not a launch key.** Nothing calls the Lendflow submit. The screens dropped the Lendflow rail on 2026-08-25. 0 cards sit on it. Both Lendflow keys are missing on Netlify today. A launch check that is red on day one for a feature nobody uses would teach Chris to ignore the row. Left off the list, with the reason in the code. A test fails if the router grows a new secret that is not on the list.
4. **`UNSUBSCRIBE_TOKEN_SECRET`, `META_CAPI_ACCESS_TOKEN`, `META_PIXEL_ID` are left off.**
   - The unsubscribe link: `opt-out:unsubscribe-link` already signs a real link and checks it. The secret also falls back to `DOCUMENT_URL_SECRET`.
   - The Meta token: the code falls back to the token stored in `ad_platform_connections`. I read it: 1 Meta row, with a token. `meta-server-events` watches the result.
   - The pixel id: the code has a built-in pixel id to fall back on.
5. **The CRS login keys are in the credit-pull check, not the launch list.** One break should be one red.

Two small adds, same question: `INNGEST_SIGNING_KEY` joins the event key (the engine cannot call the app without it, and `src/workflows/index.mjs` says both are needed). Twilio's answer also tells us if the account is suspended or closed.

`RESEND_API_KEY` and `RESEND_FROM` are also read by `gap:auth-reset-mail`. If they break, two rows go red for one break. That is on purpose: one row names every bad key in one place.

### Checker round — Claude, 2026-10-09

An independent checker found one high and four medium problems. All five are fixed. One is a plain disagreement on where the code should live, and I say so.

| # | Problem the checker found | What I did |
|---|---|---|
| 1 (high) | The checkout key row watched the wrong name. It watched `FANBASIS_CHECKOUT_API_KEY`. The card page uses `CORTANA_COMMAS_API_KEY` first (`checkoutConfig()` in `src/payments/commas-api.mjs`). So the row could stay green with no working key. And it could go red every morning on the old dead value, which is a row of asterisks in the laptop `.env`. | `CORTANA_COMMAS_API_KEY` is on the list and is watched strictly (empty or a mask is red). `FANBASIS_CHECKOUT_API_KEY` stays on the list as "empty only". The closer deck, payment links and partner add-ons refuse to build a link when it is empty (`src/sales/closer-deck.mjs`, `api/payment-links.mjs`, `api/partner-addons.mjs`), so empty is a real break. A mask there is not, because the card page does not use it first. A test fails if the mint adds a key name that is not on the list, and a test fails if the first name the mint tries is ever made "empty only". |
| 2 (medium) | Nothing asked Commas if the checkout key works. The last real break on this path was a key that was set and dead (401 on every route, 2026-09-29). A presence check cannot see that. | New check `keys:checkout-key-read`. One GET to `/public-api/checkout-sessions/transactions?page=1&per_page=1` with the same key the card page would use (the lane calls `checkoutConfig()` itself, so it cannot drift). 200 with `status: "success"` is PASS. 401 or 403 is red. A busy, down, redirecting or odd answer is skip. See the live numbers below. |
| 3 (medium) | The fix line said the full values live in `credentials/env.full.snapshot`. Most of them are rows of asterisks there. | The fix line now sends Chris to the vendor's own dashboard, says not to copy from the snapshot file, and keeps "never delete the old value first". The Inngest and credit-pull fix lines also name where the full value comes from. A test fails if any fix line says a full value lives in the snapshot. |
| 4 (medium) | The PASS text said texts and emails "can leave", but only two env flags were read. The company send switch is a third lock. | The check now also reads the company send switch with one `SELECT` (the same row the sender reads). Off is red, and the fix is the **Turn sending on** button on https://fundhub.ai/app/ops-admin.html. A missing row means on, the same as the sender. A read that fails is skip, never PASS. The PASS text no longer promises delivery. It says all three locks are open and that quiet hours and the compliance gate still judge each message. It reads the real database even from a laptop, so a switch that is off is red on a laptop too. |
| 5 (medium) | This is the first pulse lane that sends vendor keys out. The shared allow-list reason ("our own pages... no vendor record") is false for it. | I did not move the code. Moving it into the Twilio and Resend provider modules is a change to product code, which the owner lock forbids for this pass. What I did instead: every probe now sends `redirect: "manual"`, so a vendor that answers with a redirect cannot carry our key to another address (fetch strips the `Authorization` header across hosts, but not a custom header like `x-api-key`). A redirect answer is skip. A test pins that each key goes to its own host only, and that only GET leaves. The honest allow-list reason is written below for Claude to put in. |

### How each check behaves

- **On a laptop** the three pure setting checks (`inngest-event-key`, `launch-secrets-present`, `credit-pull-live-allowed`) say `skip`. A laptop copy is not the live site. A row of asterisks on a laptop is not a break. On the live server (Netlify or Lambda marker) it is.
- **The send-lock row** says `skip` for the two server settings on a laptop, but it still reads the company switch from the database. Off is red anywhere.
- **The two vendor rows** ask even from a laptop, because they ask the vendor about the key they hold. A masked key or no key is `skip` and the vendor is not called.
- A vendor that is down, slow (8 seconds, then give up), redirecting or unreachable is `skip`. Never PASS. Never a break.
- One vendor good and the other not asked is `skip`. A refusal beats a skip.
- The Twilio account answer carries the account's own token. The check reads one word from it (`status`) and copies nothing. The Commas answer holds buyer rows. One row is asked for. Only the word `status` is read. Nothing is copied.
- Only GET leaves. Twilio: fetch the account. Resend: list domains. Commas: list one transaction. No message, no email, no POST.
- The only database read is one `SELECT outbound_enabled FROM messaging_settings WHERE org_id = $1::uuid LIMIT 1`. No `BEGIN`, no `SET`, no write. It gives up after 5 seconds.
- Worst case for the whole lane: 5 seconds for the switch, then 8.5 seconds for the three vendor reads side by side. 13.5 seconds. Under the 20 second limit. A test pins this.
- No repo file is read at run time.

### Results (after the checker round)

**Tests:** `node --test src/pulse/coverage/gap-keys.test.mjs` → 77 tests, 77 pass, 0 fail, 0 skipped.

**Break-it-on-purpose test:** I broke a copy of the lane 36 ways to see if the tests noticed. Examples: a lock check that ignores one lock, a mask counted as real, the signing key ignored, allow-live ignored, the test host accepted, the Resend 400 ignored, the Twilio and Commas 401 ignored, a suspended account ignored, a skip turned into PASS, the laptop gate removed, a launch key dropped, the card-page key dropped, the empty-only key made strict, the working key made empty-only, the company switch read as on, a failed switch read counted as on, a missing switch row counted as off, the redirect setting removed, the Commas shape check removed, the card-page key choice bypassed, the old snapshot fix line put back, the delivery promise put back, a key leaked into the output. 36 of 36 turned a test red. (The first run said 35. One mutation had hit a comment, not code. I fixed the mutation, not the test, and it was caught.)

**Lint:** `node scripts/lint.mjs` → 3138 files parse clean.

**Live tool** (`gap-live.mjs keys`, read-only on the real database, GET only): 6 rows. 1 PASS, 0 FAIL, 5 skip. The PASS is `keys:checkout-key-read`: the real checkout key from the laptop `.env` was sent to Commas (one GET, per_page 1) and Commas answered HTTP 200. The 5 skips say why: the four setting rows say this is a laptop, and the vendor row says the Twilio and Resend keys here are rows of asterisks. The send-lock row says the company send switch is on (read from the real database, one row). 0 write attempts. 0 query errors. 0 row-shape problems. One diff the tool flags: in its "bare" mode (only `db`, `scope`, `now`) every row is skip. The real 6 a.m. job passes `env`, `orgId` and `fetchImpl` too (`src/workflows/daily-pulse.mjs`), so "bare" is not what runs.

**Real production settings** (the Netlify production list, read with the CLI; a secret shows as a 20-character mask there, so it stands in as "set"; 121 names read). One thing changed at a time, six rows left to right: send lock, Inngest, launch keys, credit pull, text and email, card page.

| I changed | Rows (P = PASS, F = FAIL, s = skip) |
|---|---|
| nothing (baseline) | PPPPPP |
| `FANBASIS_CHECKOUT_API_KEY` to a mask (the checker's false alarm) | PPPPPP (was a false red) |
| `CORTANA_COMMAS_API_KEY` removed (the checker's silent break) | PPFPPP (was green) |
| `CORTANA_COMMAS_API_KEY` to a mask | PPFPPs |
| `FANBASIS_CHECKOUT_API_KEY` removed | PPFPPP |
| `MESSAGING_DRY_RUN` to 1 | FPPPPP |
| `ADAPTERS_DRY_RUN` removed | FPPPPP |
| company send switch off | FPPPPP |
| `INNGEST_EVENT_KEY` to a mask | PFPPPP |
| `COMMAS_WEBHOOK_SECRET` emptied | PPFPPP |
| `CRS_ALLOW_LIVE` to 0 | PPPFPP |
| Twilio answers 401 | PPPPFP |
| Resend answers 400 | PPPPFP |
| Commas answers 401 | PPPPPF |

Netlify hides every secret value, so I know the keys are set. I do not know the secret values are real. The 6 a.m. run reads the real values. That is the first real test of them.

**Company send switch, on the real database engine** (the lane's own SQL, inside a read-only transaction; a made-up row shadows the table for the bad cases): the real table gives PASS (switch on). A made-up row with `outbound_enabled = false` gives FAIL. A made-up row with true gives PASS. No row for the company gives PASS (the sender treats it as on). A write attempt in the same transaction was refused.

**Real vendors, throwaway keys** (3 GET calls, 0 other calls, each with `redirect: manual`): Twilio answered 401, Resend answered 400, Commas answered 401. `keys:vendor-key-read` went red and named both. `keys:checkout-key-read` went red and named the key. Those are the real answers a dead key gets. The real Commas key answered 200.

### Not built, and why

- **"Inngest took the event."** The app sends the event and throws away any error (`.catch(() => {})`). The only way to know is to send a test event. That is a POST. Not read-only.
- **"The credit vendor accepts our login."** That is a POST to the vendor's login. Not read-only.
- **"Resend's from-domain is verified."** Needs the real Resend key and the real shape of the domain list. The real key is a mask on the laptop and on Netlify, so I could not see the answer. Not built, to avoid a guessed false alarm.

### Things Claude must add (not in this lane's files)

1. `src/pulse/coverage/modules.mjs`: one line `["gap-keys.mjs", () => import("./gap-keys.mjs")]`. Until then two pulse tests fail ("every gap file on disk is on the named list" and "the morning pass runs every gap file").
2. `src/lib/no-unfenced-transmit.test.mjs`: a line in `ALLOWED_RAW_FETCH` for `"src/pulse/coverage/gap-keys.mjs"`. Do **not** use `PULSE_GAP_READS`. Its words ("our own pages... no vendor record") are false for this lane. Give it its own reason, for example:

   > Read-only GET probes, 6 a.m. pulse. Three vendor hosts only: api.twilio.com, api.resend.com, www.fanbasis.com. Each carries our own account key for that vendor, to see if the vendor still takes it. Every call is GET and sends redirect: manual. Twilio is asked for our own account record, Resend for our domain list, Commas for one transaction row. Never a POST. Sends no message to any client and changes no vendor record. The key is never printed.

   The lane's tests pin each of those facts (hosts, GET only, redirect manual, key to its own host only). Until the line is added that guard test fails and names this file.
3. `src/pulse/coverage/INDEX.md`: a line for the lane.
4. The tripwire map (`src/pulse/tripwires.mjs`), if a surface should name these ids. The new id is `keys:checkout-key-read`.

I did not edit the shared guard test or the module list. They are outside this lane's files.
