# Leads gaps (new lane)

Fundhub lead flow only. Read only. This lane reads rows. It sends nothing, posts nothing, and fixes nothing. Chris, or an agent he asks, fixes the reds.

Company: Fundhub.

## Checks

`gapChecks(ctx)` in `src/pulse/coverage/gap-leads.mjs` returns three rows. Shape: `{ id, status, detail, suggestedFix }`. Status is `PASS`, `FAIL`, or `skip`.

| Id | The question | FAIL when | Reads |
|---|---|---|---|
| `lead:pipe-cut-with-traffic` | Did ads send plenty of people, and no real person get saved? | Ads got 360 or more link clicks on the last 2 closed Arizona days, and nobody was saved on the `/roadmap` step 1 since midnight of the first of those days. (If under 20 people opened `/roadmap`, a lead from a ClickFunnels form counts as proof instead.) | `ad_metrics_daily`, `events` |
| `lead:clickfunnels-posts-silent` | Did people open a ClickFunnels form, and ClickFunnels send us nothing? | Zero ClickFunnels posts in the same window, and 20 or more real people opened `/apply`, `/funding-book-call` or `/roadmap-book`, and other senders (Twilio, Resend) did leave receipts. Ad clicks do not count. | `webhook_captures`, `events` |
| `lead:slo-contact-not-in-clickfunnels` | Did a new roadmap lead fail to reach the ClickFunnels list Paul works from? | A real roadmap lead from the last 3 days, saved after the copy went live, whose copy was refused for a real reason, or has no ClickFunnels answer at all after 30 minutes. Not red if ClickFunnels already holds the person (see below). | `events.payload.cf_contact` |

What "real" means: not a demo row, not an agent, not a test. Agents and tests are the ones `src/slo/visitor.mjs` already calls agents: a `fundhub.ai` or `example.*` email, an `e2e`, `sim` or `test` part in the email name, or a robot browser. Also a name that starts a word with `test` or `e2e` (the lane adds this one). People are counted by email, not by row.

Status rules, in plain words:

- PASS means a real row proved the pipe works. A real person saved on `/roadmap` for check 1. A real post for check 2. A real lead that is in ClickFunnels for check 3.
- skip means there is not enough going on to judge. It says why. Ads paused is a skip, not a PASS.
- A read that fails is a skip with the reason. Never a PASS.

## Numbers Chris can change

They are named constants at the top of `gap-leads.mjs`.

| Name | Now | Meaning |
|---|---|---|
| `USUAL_CLICKS_PER_LEAD` | 120 | Ad link clicks it takes to bring one person who types an email on `/roadmap`. Measured 2026-10-09: 3 people in 361 clicks over the 9 ad days. |
| `MIN_EXPECTED_LEADS` | 3 | A healthy funnel should have saved this many. Then zero is a break about 95 times in 100. |
| `MIN_AD_CLICKS` | 360 | The two numbers above, multiplied. Check 1 stays a skip below this. |
| `ROADMAP_DOOR_VIEWS` | 20 | Real people who opened `/roadmap` before it counts as the page the ads feed. |
| `MIN_FORM_PAGE_VIEWS` | 20 | Real people on a ClickFunnels form page before "no post" means anything. |
| `CONTACT_WINDOW_DAYS` | 3 | How far back check 3 looks. |
| `NOTE_GRACE_MINUTES` | 30 | How long a lead may wait for its ClickFunnels answer. |
| `CF_COPY_GO_LIVE` | 2026-10-02 07:30 UTC | When the copy to ClickFunnels went live. Older leads have no note and are not judged. |

## Files

- `src/pulse/coverage/gap-leads.mjs`
- `src/pulse/coverage/gap-leads.test.mjs`

Not yet on the literal list in `src/pulse/coverage/modules.mjs`. Claude adds it.

## Prove

- `node --test src/pulse/coverage/gap-leads.test.mjs` runs the word and logic tests. The "sql meaning" tests skip.
- `node --env-file=.env --test src/pulse/coverage/gap-leads.test.mjs` runs all of them. The "sql meaning" tests run the real SQL on made-up rows, inside a read-only transaction, with no real table read.

## Tier 1 — Claude, 2026-10-09 (first round)

This is the first round, kept as history. Its numbers (15 clicks, a rows-not-people count, "no ClickFunnels answer is a skip") were replaced by the fix round below.

Ran the lane on the real database. Read only. Staff scope, inside `BEGIN READ ONLY`, 0 writes, 0 web calls, 0 query errors.

Where the first round changed the plan, and why:

1. **"Real lead" is stricter than "not a demo".** 15 of the 18 `slo.contact_started` rows ever saved were agents. 45 of the 126 `entry.captured` rows since 09-30 were `example.com`. I checked the rule against the repo's own agent test (`classifyVisitor`) on all 1236 non-demo lead rows. They agree on every one: 0 differ.
2. **Page views for check 2 count only ClickFunnels form pages.** Real people on `/roadmap` were 22 on 10-03 and 24 on 10-04, and no post is due from that page. Its checkout posts to our own API.
3. **Check 2 skips when no other sender left a receipt.** If the receipts table is off, a quiet ClickFunnels looks the same as a dead one.
4. **`webhook_captures` is not filtered by org.** All 4451 rows have an empty org. An org filter would read zero rows and go red every morning.
5. **Ad rows need the staff scope.** The plain app role reads `ad_metrics_daily` as empty (0 rows plain, 12 rows as staff, measured 2026-10-09). The lane uses `ctx.scope`.
6. **Too little traffic is a skip, not a PASS.** Same call `gap-pixels.mjs` makes for paused ads.
7. **Check 3 forgives a refusal that a later copy of the same person fixed.**

## Tier 1 — Claude, 2026-10-09 (fix round: the checker's issues)

An independent checker read the lane and found 1 high and 6 medium problems. All 7 are fixed. Here is each one, in plain words.

### What was wrong, and what I did

| # | Problem | Fix |
|---|---|---|
| High | Check 2 went red whenever ads got clicks and nobody typed an email. That is not a break. The ads land on `/roadmap`, and `/roadmap` posts to our own door, not to ClickFunnels. On 10-05 it said ClickFunnels was silent with 43 ad clicks, 48 people on `/roadmap`, and nothing broken. | Ad clicks are gone from check 2. Only real people on a ClickFunnels form page (20 or more) can turn it red. The page-view read is by browser visit, not by row. |
| Medium | Check 1 went red about half the mornings ads ran, with nothing broken. 15 clicks is far too few. Only 3 people typed an email in 361 clicks (1 in 120). | Now it needs 360 clicks, because then a healthy funnel should have saved 3 people. A red now says how many it expected. I kept the id `lead:pipe-cut-with-traffic` so the plan and the tripwire map still match; the text no longer says the pipe is cut, it says what the numbers are. |
| Medium | The SQL tests were hollow. They matched text, so 19 of 20 deliberate SQL breaks left every test green. | New "sql meaning" tests run the real SQL text on a real Postgres, on made-up rows (windows, filters, org, Arizona midnight, who counts as a person, the later-copy join). Now 70 of 71 deliberate breaks are caught. The one left is a clause that does nothing (see below). |
| Medium | "N real leads" counted rows, not people. A test account made check 1 PASS. 142 gmail rows were 2 emails. | Counts people by email. A name that starts with `test` or `e2e` is a test. PASS in check 1 now needs a person saved on the `/roadmap` step 1, so ClickFunnels test bursts cannot earn it. |
| Medium | A lead with no ClickFunnels answer was a skip, and was hidden whenever any other lead reached ClickFunnels. | A real lead saved after the copy went live, with no answer after 30 minutes, is a FAIL: the function host may have frozen before ClickFunnels answered. Good leads cannot hide it. Leads from before 2026-10-02 07:30 UTC are not judged. |
| Medium | The one refusal on record said "did not get into ClickFunnels". It did get in. ClickFunnels' own message was "Email address has already been taken", and ClickFunnels posted that person back 2 minutes later. | A refusal is not a lost lead when the person is in ClickFunnels some other way: ClickFunnels posted the email back (new read), a later copy worked, or ClickFunnels said it already holds the email. The line then says Paul has the contact but the phone, name or prequal amount may be missing. Red stays for real refusals: key refused, 5xx, dry run on, key not set, any other 422. |
| Medium | A ClickFunnels `/apply` lead could earn PASS in check 1 while the `/roadmap` save, where the ads land, was dead. | If 20 or more real people opened `/roadmap`, only a person saved on `/roadmap` is proof. A ClickFunnels lead is proof only when `/roadmap` is not where the traffic is. |

Small extra: if ClickFunnels' own message has an email address in it, the detail line shows `[email]`, so no address reaches the text.

### What each check asks now, and what live says today

Ran the lane on the real database. Read only. Staff scope, inside `BEGIN READ ONLY`. `node gap-live.mjs leads`: prod 0 PASS / 0 FAIL / 3 skip, staffdb 0/0/3, bare 0/0/3. 0 query errors, 0 write attempts, 0 differences between modes. The two reads take about 100 to 240 ms.

| Check | Live today (run for 2026-10-09) |
|---|---|
| `lead:pipe-cut-with-traffic` | skip. Ads sent 0 link clicks on 2026-10-07 and 2026-10-08. Zero leads only means something at 360 clicks or more. |
| `lead:clickfunnels-posts-silent` | skip. Too quiet to expect a post: 0 people opened a ClickFunnels form page (needs 20). |
| `lead:slo-contact-not-in-clickfunnels` | skip. No real roadmap lead in the last 3 days. |

Three skips is the true answer today. Ads are not running. The newest real roadmap lead is from 10-02.

### The same code, run as if it were 6 a.m. Arizona on earlier days

Same database, same read only rules. Columns: pipe, posts, contact.

| Run day | pipe | posts | contact |
|---|---|---|---|
| 09-26 | skip | PASS | skip |
| 09-27 | skip | PASS | skip |
| 09-28 | skip | PASS | skip |
| 09-29 | skip | skip | skip |
| 09-30 | skip | skip | skip |
| 10-01 | skip | PASS | skip |
| 10-02 | PASS | PASS | skip |
| 10-03 | PASS | PASS | PASS |
| 10-04 | PASS | PASS | PASS |
| 10-05 | skip | skip | PASS |
| 10-06 | skip | skip | skip |
| 10-07 | skip | skip | skip |
| 10-08 | skip | skip | skip |
| 10-09 | skip | skip | skip |

No FAIL, and that is honest. The most ads ever sent in 2 days was 202 clicks. ClickFunnels form pages had at most 15 opens in all the days tracked (page tracking began 10-01). Nothing real crossed a red line. The first draft was red on 5 of those mornings with nothing broken.

### Proof each one can go red on real rows

I could not find a real day that crosses the new lines, so I moved the line, or changed one fact, and kept the real rows. Read only, nothing written.

- **Check 1.** Real facts for the 09-28 morning: 202 link clicks, nobody saved on `/roadmap`. With the line moved from 360 to 150 clicks (a scratch copy), it goes FAIL: "Ads sent 202 link clicks ... Zero real people were saved ... That many clicks should have brought about 4."
- **Check 2.** Real facts for the 10-06 morning: 2 people on a ClickFunnels form page, 0 ClickFunnels posts, 16 other receipts. With the line moved from 20 to 2 people (a scratch copy), it goes FAIL.
- **Check 3.** The one real refused lead (10-02), read through a shadow of the real `events` table with one fact changed:
  - As it is: PASS. ClickFunnels posted that person back, so Paul has the contact.
  - If the refusal had been a key error (401) and ClickFunnels had not posted back: FAIL, "ClickFunnels refused it (401: Unauthorized)".
  - If the lead had no ClickFunnels answer at all and ClickFunnels had not posted back: FAIL, "no ClickFunnels answer was ever recorded, so the copy may not have run".
  - If the refusal were "already taken" and ClickFunnels had not posted back: PASS, with the note that the phone, name or prequal amount may be missing.

### Tests

- `node --test src/pulse/coverage/gap-leads.test.mjs`: 61 tests, 48 pass, 13 skip (the "sql meaning" tests need a database), 0 fail.
- `node --env-file=.env --test src/pulse/coverage/gap-leads.test.mjs`: 61 tests, 61 pass, 0 skip, 0 fail. Those 13 run the real SQL text on made-up rows in a read-only transaction.
- `npm run lint`: 3140 files parse clean.
- Each check has a PASS test and a FAIL test, with the edges: 359 vs 360 clicks, 19 vs 20 form people, 19 vs 20 `/roadmap` people, exactly 30 vs 31 minutes, the second before and after the go-live time.
- Deliberate breaks, on a scratch copy only: 71 breaks (the checker's 20, plus mine on the new logic). 70 make a test fail. 1 does not: dropping `s.id <> e.id` from the later-copy join. That clause does nothing, because `s.created_at > e.created_at` already leaves out the row itself. It is left in.
- The two tests that fail in `src/pulse/` are the list tests in `modules.test.mjs`: they want `gap-leads.mjs` (and the other new lanes) on the list in `modules.mjs`. Claude adds that.

### Not changed, and why

- **No "ClickFunnels posts after a typed email" trigger for check 2.** The checker offered it. I have one example: the copy on 10-02 22:43 UTC, then `contact.created` and `contact.identified` posts at 22:45 UTC. I do not know what made ClickFunnels post, and a contact it already holds may post nothing. A red built on one example would cry wolf. If Chris wants it later, it needs a second example.
- **Test leads still look real when they use a normal email and a normal name.** Two test emails left 142 gmail rows on 10-01 and 10-02. No rule can tell them from customers. They can no longer earn PASS in check 1, because only `/roadmap` step 1 saves count there.
- **Check 1 stays a skip until ads send 360 clicks in 2 days.** At about 25 clicks a day that is not soon. A cut `/roadmap` save is not seen at today's volume. The money lost is small at that volume. Raise confidence by lowering `USUAL_CLICKS_PER_LEAD` only if Chris measures a better rate.
- **Check 3's `CF_COPY_GO_LIVE` is a date I worked out**, from the commit time (10-01 23:20 Arizona) and the next ship in `ops/ship-log.md` (10-02 00:26 Arizona). The first note on any row is 10-02 22:43 UTC.

### Left over, one line

The 10-02 refused copy: ClickFunnels said "Email address has already been taken" to an upsert call, and created the contact 2 minutes later. That is odd. It may be a race inside ClickFunnels. Nothing here can fix or explain it.

### Not built

Nothing from the plan was dropped.
