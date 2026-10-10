# Payments gaps — lane 8

Fundhub money movement only. Read only. Recon (AG-07) is the one tripwire. No second watchdog. No card charge. No new Commas product.

This lane does not repeat slice 18 (billing sweeper and checkout-expiry sweeper) or slice 10 (contract chaser and the sign door).

## Checks

| id | Break | FAIL when |
|---|---|---|
| payments:invoice-stuck | Invoice stuck | Dunning state does not match the money (`status_reconciled` is false), or a paid pay link still sits on an open invoice. Demo rows are left out. |
| payments:pay-link-webhook | Pay link paid, link never settled | A non-demo link is still `created` or `sent` and money has reached it in one of two ways. (1) A `payment.succeeded` row in `commas_inbox`, processed more than 3 minutes ago, carries the link ref (the webhook was recorded, the link was not settled). (2) A succeeded non-demo payment from the same client, after the link was minted, for the same amount in cents as the link, that did not come through any other link of ours. Simulated receipts (`sim-pay-`) are counted and named in the line, not a FAIL. A webhook that never arrived leaves no row anywhere, so this check cannot see it (see the second pass below). |
| payments:paid-no-entitlement | Payment succeeded, entitlement missing | A succeeded non-demo transaction (older than 3 minutes) resolves to a product that has a `product_entitlements` row, and no `entitlements` row exists for that payment and that code. A revoked grant still counts as recorded. Unmapped products are not this break. Simulated receipts (`provider_ref` starts `sim-pay-`) are counted and named in the line, but are not a FAIL. |
| payments:commas-webhook-route | Commas webhook route dead | The real webhook router (called in process, unsigned empty post, closed database) does not answer 401 for `commas`; or the source files are readable and say the route is gone; or the site answers a GET on `/api/webhooks/commas` with anything but 405. Files that cannot be opened (the Netlify bundle has none) are not a FAIL. A site that cannot be reached, or does not answer in 8 seconds, is a skip. The 405 only proves the `webhooks/` prefix is mounted; the 401 from the router is what proves Commas. |

No database or no org id in the run: the three money checks are `skip`, and the line says which. The route check still runs.

Each row is `{ id, status, detail, suggestedFix }`. Status is `PASS`, `FAIL`, or `skip`. A FAIL names Recon (AG-07) and does not add another watcher.

## Files

- `src/pulse/coverage/gap-payments.mjs`
- `src/pulse/coverage/gap-payments.test.mjs`

## Prove

`node --test src/pulse/coverage/gap-payments.test.mjs`

## Review — Claude, 2026-10-08

What was wrong:
- The pay link check asked for `commas_session_id` to be empty. Every link we mint through Commas gets that id on day one. All 23 links in production have it. So the check could never fail. That filter is gone.
- The route check read source files. The morning check runs inside the bundled Netlify function, which has no source tree. It would have read "dead" every morning when it was not. It now calls the real webhook router in process (unsigned, empty body, a database that refuses every read, a throwaway key). A good door answers 401. A missing one answers 404. It also does one GET on the site: 405 means the `webhooks/` prefix is mounted, 404 means it is not.
- The entitlement check failed on 8 payments. All 8 are simulated receipts (`sim-pay-` ids, Chris's `walk-` and `sim-` test clients, no card charged). That is test money, not a customer. They are now counted in the line and left out of the FAIL.
- The skip line said "no database" even when the org id was the missing piece. It now says which.
- Payments got a 3 minute grace, so a receipt still being processed at 6 a.m. is not a break.

What changed: `gap-payments.mjs` (pay link query, entitlement query, route check, skip lines), 7 new tests in `gap-payments.test.mjs`. No old test was touched. The board table above was updated to match.

Live result after the first pass (read only, production): prod 3 PASS / 1 FAIL / 0 skip. Cursor's version in a bundle with no source tree: 2 PASS / 2 FAIL (the route check read "dead" because the source files are not there, plus the 8 test receipts). The one FAIL that first pass kept was a FALSE ALARM. It is withdrawn in the second pass below.

First pass left this uncovered: two Finance OS e2e links (`pl_588...`, `pl_21f1...`, created 2026-10-07 07:05) have a processed `payment.succeeded` inbox row but still sit at `created`. The second pass below now reads that shape. These two are simulated receipts, so they are named in the line and are not a FAIL.

Invoices: there are 0 rows in `invoices` in production today, so the invoice check passes with nothing to look at. Its SQL runs clean against the real view. It will start to mean something when invoices exist.

### Second pass — Claude, 2026-10-08 (after the checker)

What was wrong:
- The one FAIL left in the first pass was a false alarm. Pay link `0d3adf9b` is a $297 link. The payment it matched was Chris's own $1.00 prove payment (`pl_prove_chris_1`). The check matched any money from the same client, so $1 on a $297 link lit it red. The first pass called that a real break. It was not. No customer money is stuck. That claim is withdrawn.
- The check also could not fire for the break it was built for. It only fired when a client paid some other way. A webhook that was recorded but never settled the link (`payment.succeeded` in the inbox, link still open) gave a clean PASS.
- The site GET had no timeout. A hung site could have cost the whole lane its step.
- Board mistakes: the link is $297, not $32. The overlap note below was lost.

What changed:
- Money must now match the link amount in cents. Run on production with the match removed, the old shape finds 1. With it, 0.
- New first read: a processed `payment.succeeded` inbox row that carries the link ref while the link is still `created` or `sent`. Simulated receipts (`sim-pay-`) are named and left out of the FAIL. Two Finance OS e2e links (`pl_58889...`, `pl_21f12...`) sit in exactly that state today and show up in the line as "2 open links with a simulated receipt left out".
- A payment through this link's own ref now counts. Only a DIFFERENT link of ours clears a payment.
- The site GET stops after 8 seconds and then skips with the reason. The PASS line now says the 405 proves the `webhooks/` prefix, not Commas.

What this lane cannot see, on purpose: "pay link minted, the webhook never arrived". Commas sends each webhook once and never retries. If it is lost, nothing is written anywhere in our database, so there is nothing to read. `src/payments/commas-api.mjs` says this at the top and has no list endpoint to go look. The check watches the two shapes that do leave a trace. It does not claim the third.

Overlaps for the final pass to keep one of each (not deleted here, other lanes are not mine):
- `payments:paid-no-entitlement` reads the same break as `portal-paid-entitlement` in `gap-portal.mjs` (paid, mapped product, no entitlement). Different test-money rules: `sim-pay-` receipts here, `+walk` and `+sim` email tags there. Both PASS today.
- `payments:commas-webhook-route` repeats what `webhooks:commas` in `gap-webhooks.mjs` does (router probe plus a GET). The lane prompt named it, so it stays until the final pass picks one.

Live result after (read only, production): prod 4 PASS / 0 FAIL / 0 skip. staffdb 4/0/0. Plain and staff roles read the same rows. 0 SQL errors, 0 write attempts. A bare run (no org id, what the slice runner passes today) is 1 PASS / 3 skip, as designed.

Tests: `node --test src/pulse/coverage/gap-payments.test.mjs` is 18 tests, 18 pass with no database. With `DATABASE_URL` set it is 70 tests, 70 pass: the extra 52 run the three money SQL statements for real on made-up tables (a `WITH` that swaps in small fake tables, so no real table is touched). I broke the SQL on purpose 16 ways (amount match, other-link test, grace both ways, sim split, status, event type, client match and more). Every one failed at least one test. The one thing swapped out is the product resolver function, which a `WITH` cannot replace. It is named in the test.

## Tier 1 — Claude, 2026-10-09

Four new checks. They are the last four rows of the lane. The first four did not change. The lane now has 8 rows. Same file: `src/pulse/coverage/gap-payments.mjs`.

Each one asks a yes-or-no question a paying customer would feel. A failed read is a `skip` with the reason. It is never a PASS. Test money (demo rows, `sim-pay-` receipts, test clients) is kept out of every FAIL and named in the line.

| id | The question | Goes red when |
|---|---|---|
| `payments:paid-product-unmapped` | Did a customer pay and we cannot tell who or what? | In the last 30 days a real paid order has no person attached, or has a product name we do not know and the client got no access for it. A payment that is 3 minutes old is left alone. |
| `payments:commas-inbox-waiting` | Is a paid receipt sitting in the inbox and nobody picked it up? | A receipt is over 10 minutes old and is still pending, or failed with tries left and not tried for 10 minutes, or stuck mid-pass for 20 minutes. |
| `payments:checkout-started-no-link` | Did someone press Pay and we never made their checkout link? | A real Pay press is over 10 minutes old (and under 3 days) and neither its own order ref nor a later `slo_` link for that client exists. |
| `payments:card-declined-no-followup` | Did a card fail and nobody reached out? | A real card decline is over 1 hour old (and under 3 days) and that client has no later message from staff or an agent, no later task and no later paid payment. A drip text or email sent by the system does not count (changed after the checker, see below). |

### What I changed from the plan, and why

- **`paid-product-unmapped` counts the outcome, not just the name.** A normal Commas payment carries a product id in its payload and gets its access that way, even when the name on the order matches nothing. Chris's own $1 payment is the proof: unknown name, and the access row is tied to that payment. If the check only asked "is the name unknown", every real roadmap sale would go red for the wrong reason. So an unknown name is a break only when the client holds no access made for that payment or after it.
- Because of that, the $1,000 "Consulting Services Standard" order is **not** red. That client got access by hand on 10-05. It is named in the line ("2 orders with an unknown product name already have access"). The plan said it was red today. The customer is not locked out, so I did not make it red.
- A payment with no client that came through a **partner link** is a partner, not a lost buyer. It is counted apart. Without this, the first partner purchase would be a false alarm.
- Test clients: the shared pattern from `gap-consent.mjs` and `gap-portal.mjs`, plus `e2e+` and `demo+` addresses (the test runners use them and they sit on `fundhub.ai`). A test makes sure the first part stays equal to the shared pattern.
- `commas-inbox-waiting` uses the real limits from `src/payments/commas-inbox.mjs` (10 tries, 15 minute stale claim). Rows at 10 tries stay with `webhooks:stuck-failed`. A **pending** row is only seen here, because that check cannot see it.
- `checkout-started-no-link` joins on the order ref in the event, then also accepts a later `slo_` link for the same client (the buyer pressed again and it worked). That keeps a retried press from being a false alarm.
- `card-declined-no-followup` also accepts a later paid payment (they paid on a second try). A decline with no client attached has nobody to reach. It is counted apart, not a FAIL.

### Live result (read only, production, fundhub_app inside BEGIN READ ONLY)

| Mode | PASS | FAIL | skip | Time |
|---|---|---|---|---|
| as the 6 a.m. job runs it (`prod`) | 7 | 1 | 0 | 1.8 s |
| same, staff-scoped database | 7 | 1 | 0 | 1.0 s |
| bare (no org id, what `runCoverageSlices` passes today) | 1 | 0 | 7 | 1 ms |

0 SQL errors. 0 write attempts. Only one web call was made: GET `/api/webhooks/commas`, answered 405. The bare run skips the same way the three older money checks always did: it has no org id. The 6 a.m. job passes one.

- `payments:paid-product-unmapped` is **FAIL**: "UnderwriteIQ soft-pull assessment $32.00 (order ORD-N40H-ZZ26-HKNW, client FH-000530)". Left out: 2 orders with an unknown name that already have access, 22 test-client payments. This is a real customer. They paid $32 on 10-07, the order has no product, no access row and no payment event.
- The other three are PASS, and honest about it: "no Commas receipt is waiting" (36 rows, all done), "no real Pay press in the last 3 days is old enough to check" (the newest real press was 10-03), "no real card decline in the last 3 days is old enough to check" (the newest was 10-01). A PASS with nothing to look at is not proof. The red proofs below are.

### Proof each one can go red (made-up bad cases, read only)

Each case runs the lane's own SQL with one real table swapped for a copy that has the bad case in it. Nothing is written.

| Case | Result |
|---|---|
| paid-product-unmapped, real data | 1 unmatched ($32), 2 fixed by hand, 22 test |
| same, no access rows exist | 3 unmatched ($32, $1, $1,000) |
| same, every payment loses its client | 27 with no person |
| commas-inbox-waiting, real data | 0 waiting |
| same, every real row still pending | 11 waiting (7 paid), 25 simulated left out |
| same, every real row failed with 3 tries and an old last try | 11 waiting |
| same, every real row stuck processing | 11 waiting |
| checkout-started-no-link, real data, 1 year window | 3 real presses, 0 without a link |
| same, every pay link gone | 3 without a link |
| card-declined-no-followup, real data, 1 year window | 1 real decline (10-01, FH-000531), reached, 3 with no client |
| same, no messages, tasks or later payments exist | 1 not reached (FH-000531) |

### Tests

- `node --test src/pulse/coverage/gap-payments.test.mjs`
  - No database: 29 tests, 29 pass. (Was 18.)
  - With `DATABASE_URL`: 185 tests, 185 pass. (Was 70.) The extra SQL tests run every statement for real on made-up tables, so no real table is touched.
- 84 deliberate breaks of the new SQL and code, run one at a time. Two survived the first pass (a partner link matched by ref, and a link matched by ref) because the test data matched two ways at once. I split those into separate cases and both are now caught. All 84 are killed.
- Old tests: every old assertion about the first four checks is unchanged. Only whole-lane totals moved because the lane has 8 rows now: the id list, the row count (4 to 8), the status list, the read count (3 to 7), one title ("four PASS rows" to "eight PASS rows"), and the test database answers clean for the four new reads.
- `npm run lint`: 3136 files parse clean.
- `npm run pulse:prove` was not run for this lane. It builds the whole Netlify bundle. This lane only added one import (`src/payments/commas-inbox.mjs`), and `gap-webhooks.mjs` already imports it.

### Not watched, and why

- **The repair-plan Pay press** (`slo-repair-checkout`): it writes its event after the link is made, so a press whose card session fails leaves nothing to read. Only a code change can fix that.
- **A Commas notice that never arrives, or is refused**: leaves no row anywhere (already said above).
- **Card decline reach-out is a floor, but drips no longer count.** A message from staff or an agent counts as a reach-out, even if it was not about the card: the check cannot tell. A drip from the system does not count (fixed after the checker, see below). A task counts too, and some tasks come from automated workflows (see the leftover card below).
- **If a card-decline notice template is ever built**, this check has to be told its key. Today none exists. Without that, the system could text the client about the card and the check would stay red.

### Breaks found (not fixed, owner hard lock)

1. The $32 UnderwriteIQ order above. Paid, no product, no access.
2. The `payment.failed` handler (`onPaymentFailed`) only saves a failed row. It makes no text and no task. Today no real decline is in the 3 day window, so the check is green. The first real decline after launch goes red here. It stays red until a person on staff or an agent messages that client, a task is made for them, or they pay on a second try. Drips from the system do not clear it. It stays in the window for 3 days. After that it ages out and the check goes quiet again, so a decline nobody reached is only caught on the 3 mornings after it.
3. The roadmap vendor title "Consulting Services Assessment" is not in `product_aliases`. The new check does not go red for it when access is granted another way. It does go red if a sale under that name gets no access.

### After the checker, 2026-10-09 (drips do not count)

The checker found a hole in `payments:card-declined-no-followup`. It counted any outbound message as "someone reached out", including the automated drip. The board said it "stays red until someone reaches out". That was not true.

Real proof, read only on production, one year window: the one real decline (FH-000531, 10-01) got 6 messages after it. All 6 are `sender_kind = system`: `SMS-SLO-197`, `EMAIL-SLO-197`, `EMAIL-SLO-DRIP-HOT-1` to `-4`. Under the old rule that decline read as reached (0 unreached). Under the new rule it reads as 1 unreached, and the line says the client only had drip messages.

What changed (same file, same check id, no new check):
- A message is a reach-out only if `messages.sender_kind` is `staff` or `agent`. `system` does not count. A message with no `sender_kind` is treated as `system`.
- The read also returns `auto_only_n`: how many unreached declines got only drips. The red line says so: "That client has only had automated drip messages since, and those do not count."
- The other rules did not change: a task still counts, a later paid payment still counts, a failed or blocked message still does not, and a queued message still counts (that was a choice in the first pass and its test is untouched).
- The words changed: "no message" is now "no staff or agent message" in the red line, and "a later message" is now "a later staff or agent message" in the green line. The fix text now says drips do not count.

Live result after the fix (read only, `gap-live.mjs payments`): prod 7 PASS / 1 FAIL / 0 skip in 2.0 s. staffdb 7/1/0 in 1.0 s. bare 1/0/7. 0 SQL errors, 0 write attempts. The FAIL is still `payments:paid-product-unmapped` (the $32 order). `payments:card-declined-no-followup` is PASS, because the one real decline is 8 days old and the window is 3 days.

| Case (real tables, one made-up row where it says so) | declines | unreached | drip only |
|---|---|---|---|
| Real data, 3 day window, as the job runs it | 0 | 0 | 0 |
| Real data, 1 year, OLD rule (drips counted) | 1 | 0 | n/a |
| Real data, 1 year, NEW rule | 1 | 1 | 1 |
| Add one staff message after the decline | 1 | 0 | 0 |
| Add one agent message after the decline | 1 | 0 | 0 |
| Add one more drip after the decline | 1 | 1 | 1 |
| Relabel every message as staff | 1 | 0 | 0 |
| No messages exist at all | 1 | 1 | 0 |
| A staff message that failed to send | 1 | 1 | 0 |
| A staff message from before the decline | 1 | 1 | 1 |

Tests: `node --test src/pulse/coverage/gap-payments.test.mjs` is 31 of 31 with no database (was 29). With `DATABASE_URL` it is 207 of 207 (was 185): 22 new, 0 failed, 0 skipped. The new SQL cases cover staff, agent, system, no sender, a client-kind row, failed and blocked drips, drips from before, drips to another client or org, a drip plus a staff message, a drip plus a task, a drip plus a later payment, and two declines at once. Every old test is still there. Two old sentences in them were updated to the new words.

Deliberate breaks: 31 one-at-a-time breaks of the new SQL and sentences (sender list, drip read, wait rules, wording). 30 were caught. 1 cannot be caught because it changes nothing: taking `NOT p.no_client` out of the drip-only count. A decline with no client never matches a message (`client_id = NULL` is never true), so the drip read is already false for it, and the test for that case passes with or without the guard. It stays as a guard.

Leftover card (not touched, owner hard lock): a task counts as a reach-out for any client, and some tasks come from automated workflows. Real data today: 36 client tasks come from `customer-insights-mid`, 2 from `doc-check`, 1 each from `blueprint-welcome-kit` and `u-05-data-health-monitor` (`tasks.source_workflow`). A task like that could clear a card decline the same way a drip did. The real decline has no task since, so nothing is wrong today. The checker did not raise this and it was not changed.

Files: `src/pulse/coverage/gap-payments.mjs`, `src/pulse/coverage/gap-payments.test.mjs`, this board. Copy of each: `scratchpad/c-backup/payments/`.
