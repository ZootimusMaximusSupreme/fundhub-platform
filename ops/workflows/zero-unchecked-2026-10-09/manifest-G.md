# Manifest G — lane "nothing to judge" rows (Ship 1, zero not-checked)

Builder G. Round 1 branch `build/ZU-G-2026-10-09` (commit `a3fda4f2`), cut from `main` at `fbc54d0e` (the commit that holds the build contract).
Round 2 (repair after the independent checker) branch `build/ZU-G-r2-2026-10-09`, cut from `a3fda4f2`. Everything below describes the state **after round 2**; the round 2 changes are listed in the next section.
Scope: the seven lane rows in `build-contract.md` piece G. Nothing else.

## Round 2: what the checker found and what changed

The checker raised six findings. All six are fixed. None was disputed.

| # | Severity | Finding | Fix | Proof |
|---|---|---|---|---|
| 1 | high | The DB-gated test `sql meaning, whole lane: 400 clicks, 25 people on /roadmap, nobody saved` still expected `skip` for `lead:clickfunnels-posts-silent` and `lead:slo-contact-not-in-clickfunnels`. It skips here (no `DATABASE_URL`), so round 1 looked green; CI runs it and would fail. My round 1 note "the 13 SQL-meaning tests are fine in CI" was wrong. | The test now expects `na` with code `low-traffic` (and `args.views` 0) and `na` with code `no-real-lead`. The SQL is unchanged. I also added a no-database twin of the same scenario (same numbers the shadowed `FACTS_SQL` gives) so the expectation runs on every machine: `lane: 400 clicks, 25 people on /roadmap, nobody saved -> pipe FAIL; posts and contact are na`. | The checker's probe `zug/probe3.mjs` re-run on this branch: pipe `FAIL`, posts `na`, contact `na`. A search of the DB-gated tests for `skip`, `na` and `status` finds no other stale expectation (the other 12 test what the SQL computes, or assert PASS or FAIL). I still cannot run the 13 DB-gated tests here (no `DATABASE_URL`, no local Postgres). |
| 2 | medium | `ads-spend-day-missing` said `na no-running-ad` from `SPEND_DAYS_SQL.running`, which counts only ads created before the older closed day began. A brand-new ad that is ACTIVE and spending was not counted, so a real dropped spend day became a verified "no ad is running". | `SPEND_DAYS_SQL` now also returns `running_now` (same `RUNNING_WHERE`, **no** `created_at` bound). The lane says `na` only when `count(running) === 0` **and** `count(running_now) === 0`. `naVerify["no-running-ad"]` for `ads-spend-day-missing` requires the same two zeros. With `running` 0 and `running_now` above 0 the row falls through to the spent-before / spent-after logic: `FAIL` for a real gap, `skip` for "looks like ads switched off or on". The "N ads are running" wording uses `max(running, running_now)`. A missing or non-number `running_now` stays a `skip`. The `na.args` shape is unchanged (`{ check, running: 0 }`). | New tests: `an ad switched on after the older closed day began is running: never na`, `a new ad is running but nothing spent on one side of the empty day: skip, never na`, `running = 0 and the running_now count did not come back: stays a skip, never na`, SQL shape test for `running_now`, two new `naVerify` false cases, round trip with a fresh ad. Probe `zug/probe1.mjs` re-run (with `running_now: 1`): `FAIL "Spend rows are missing for 2026-10-08. 1 ad is running..."`, `naVerify` false. Live read-only check of the new SQL: `running` 0, `running_now` 0, so today it is still `na`. |
| 3 | medium | `ad-click-stored` went `na low-traffic` on `meta_clicks < 20` even when the read could not see any ad data (empty table sums to 0; a dead sync; the plain app role under row security). | `AD_CLICK_SQL` now also returns `last_synced_at`: the newest `last_synced_at` of the Meta connections (same filters as `RUNNING_BARE_SQL` in gap-ads, plus the company filter that query already takes). The lane says `na` only when the count is a number under `MIN_META_CLICKS` **and** that stamp is present and within `FRESH_HOURS` (36 h, imported from `../machine.mjs` like gap-ads does). Otherwise it is a `skip` that says "the Meta sync shows no save in the last 36 hours, so we cannot tell if ads are paused". `naVerify` applies the same rule with the same `now`. PASS and FAIL need no stamp (enough clicks are their own proof). | New tests: low count with `undefined`, `null`, `""`, `"not a date"`, 36 h + 36 s, 200 h old stamps is a `skip`; 0 h, 2 h and exactly 36 h (Date and ISO string) is `na`; enough clicks with no stamp still `FAIL`; `naVerify` false for every blind stamp, true for fresh ones; round trip with a blind scope; SQL shape test (`max(k.last_synced_at)`, the token column is only tested for `IS NOT NULL`, never selected). Live read-only check: staff scope `meta_clicks` 0, `last_synced_at` 2026-10-09 18:30 UTC (fresh, so today it is still `na`). The same SQL as the plain role returns `meta_clicks` 0, `last_synced_at` null, which is now a `skip` (it was a silent `na` before). |
| 4 | low | Same blind-read class in gap-social: the plain role reads `analytics_connections` as empty, so `watched` 0 became `na not-connected` and `naVerify` confirmed it. | The lane says `na` only when the read ran on `ctx.scope` (staff). With only `ctx.db` a zero is a `skip`: "no active YouTube connection was seen, but this read ran without the staff scope...". `naVerify["not-connected"]` returns `false` without reading when `ctx.scope` is not a function. | New tests: plain-handle zero is a `skip` and carries no `na`; the same zero on the staff scope is `na`; an active connection read through the plain handle is still `PASS`; `naVerify` with `db` alone is `false` and makes **zero** queries. |
| 5 | low | `readContacts` turned a missing rows list into `[]`, so `contactCheck` said `na no-real-lead`, while `naVerify` said `false` for the same answer. | `readContacts` throws `the read came back with no list of leads` when `out.rows` is not an array. `gapChecks` already catches that and writes the `skip` row `could not read roadmap leads: ...`. | New test feeds the contacts read `undefined`, `null`, `{}`, `{ rows: null }`, `{ rows: "none" }`: all `skip`, never `na`. An empty list is still a real answer (`na`). |
| 6 | low | Wording and stale comments. | `Judged the day one is.` -> `Judged the day an ad has run for 24 hours.` (gap-ads). `Judged the day Meta counts 20.` -> `Judged the day Meta counts 20 clicks.` (gap-pixels). The pipe `na` detail lost its "Zero real people saved on /roadmap..." sentence (a `na` pipe row already means no lead; the ClickFunnels note stays when it applies). The posts `na` detail is three short sentences. Stale comments now say `na`: gap-leads header, the gap-ads header, and the `gapChecks` JSDoc in gap-pixels and gap-social. | The existing assertions on the kept phrases still pass (`Zero leads only means something at 360 clicks or more`, `Judged the day ads send 360 clicks.`, `Too quiet`, `Ad clicks do not count`, `19 people opened a ClickFunnels form page`, `Judged the day 20 people open a form page.`). New assertion for the ads wording. |

Mutation checks (change one line, expect a named test to fail, restore byte for byte): contacts read returns `[]` on a missing list (1 test fails); lane ignores `running_now` (2 fail); lane `na` without the `running_now` proof (1); `naVerify` ignores `running_now` (2); lane `na` without a fresh sync (1); `naVerify` without a fresh sync (2); freshness boundary `<` instead of `<=` (2); lane `na` without staff scope (1); `naVerify` accepts `db` alone (1). Script: scratchpad `zug-r2/mutate.py`. All restored; `git status` shows only the intended files.

### Existing tests whose expectation or fixture changed in round 2

Nothing was deleted, skipped or loosened. These are the only edits to existing tests or fixtures:

| File | Test | Change | Why |
|---|---|---|---|
| gap-leads | `sql meaning, whole lane: 400 clicks, 25 people on /roadmap, nobody saved` (DB-gated) | posts: `skip` -> `na` + code + `args.views`; contact: `skip` -> `na` + code | Finding 1: those two rows are `na` by the contract. |
| gap-ads | `empty closed days with every ad paused is nothing to judge` | fixture row gets `running_now: 0` | The SQL now returns `running_now`; the lane needs it to prove "nothing runs". The assertions are unchanged. |
| gap-ads | `naVerify ... ads-spend-day-missing: true at zero running ads` and the `round trip` test | fixture rows get `running_now: 0` (and `running_now: 1` for the "an ad runs" half) | Same. |
| gap-pixels | `ad click: ads paused`, `Meta counted zero clicks`, `naVerify low-traffic: true under the minimum`, `naVerify low-traffic: db alone works`, `round trip`, `the na row carries no secret` | fixture rows get `last_synced_at: SYNCED` (2 h old) | Finding 3: the stamp is the proof the read could see Meta's side. Assertions unchanged except the next line. |
| gap-pixels | `ad click: ads paused` | `/Judged the day Meta counts 20\./` -> `/Judged the day Meta counts 20 clicks\./` | Finding 6 (wording the checker asked for). |
| gap-social | `naVerify not-connected: no read, no row, another check or no args is false; a failed read throws` | the failed-read half now uses `scope: (fn) => fn(broken)` instead of `db: broken` | Finding 4: `naVerify` no longer reads on `db` alone. A failed read on the staff scope still throws. |
| gap-social | `naVerify not-connected: db alone works` (asserted `true`) | renamed `db alone is false and reads nothing...`; asserts `false`, zero queries, and `true` with a scope | Finding 4. This is a meaning change the checker's fix requires. |

## Files touched (all inside the owned list)

| File | What changed |
|---|---|
| `src/pulse/coverage/gap-ads.mjs` | 2 rows can return `na`. New export `naVerify`. `SPEND_DAYS_SQL` also returns `running_now` (round 2). |
| `src/pulse/coverage/gap-leads.mjs` | 3 rows can return `na`. New export `naVerify`. `readContacts` throws on a missing list (round 2). |
| `src/pulse/coverage/gap-pixels.mjs` | 1 row can return `na`. New export `naVerify`. `redactRows` now keeps the `na` key. `AD_CLICK_SQL` also returns `last_synced_at`; imports `FRESH_HOURS` from `../machine.mjs` (round 2). |
| `src/pulse/coverage/gap-social.mjs` | 1 row can return `na`, only on the staff scope (round 2). New export `naVerify`. |
| `gap-ads.test.mjs`, `gap-leads.test.mjs`, `gap-pixels.test.mjs`, `gap-social.test.mjs` | Updated and extended (below). |

No migration, no new dependency, no new id, no repo-file read at run time, no write, no network call. The SQL text changed in exactly two lane queries in round 2 (`SPEND_DAYS_SQL` gained a column, `AD_CLICK_SQL` gained a column); both were run once read-only against the live database (below). The SQL of the 13 "sql meaning" tests in `gap-leads.test.mjs` is untouched; those tests still skip with no `DATABASE_URL`.

## Exports added (exact names and shapes)

Every lane file exports:

```js
export const naVerify = Object.freeze({
  "<code>": async (args, ctx) => boolean   // true only when the quiet condition is really true now
});
```

`ctx` is `{ db, scope, now }` (also reads `ctx.orgId` if the caller has one). `args` is the `na.args` object from the row.
Rules every verifier keeps:
- Same SQL text and same minimum constant the lane used (`SPEND_DAYS_SQL`, `RUNNING_BARE_SQL`, `FACTS_SQL`, `CONTACTS_SQL`, `AD_CLICK_SQL`, `VIDEO_STATS_SQL`; `MIN_AD_CLICKS`, `MIN_FORM_PAGE_VIEWS`, `MIN_META_CLICKS`, `FRESH_HOURS`). No number copied.
- No read possible (no `scope`, no `db`), a count that is missing or not a number, a row for another check, missing or empty `args`: returns `false`.
- A read that fails **throws** (the message is kept). `verifyNa` already counts a throw as `ok:false`.
- Company: `args.orgId`, else `ctx.orgId`, else all companies. The lane puts `orgId` in `args` only when it read one company, so the re-check reads the same data.

| File | `naVerify` code | `args.check` values it answers | True when |
|---|---|---|---|
| gap-ads | `no-running-ad` | `ads-spend-day-missing` | `SPEND_DAYS_SQL` (days = `closedDays(now)`) returns `running` = 0 **and** `running_now` = 0 (both real numbers) |
| gap-ads | `no-running-ad` | `ads-running-no-metrics` | `RUNNING_BARE_SQL` (cutoff = now - 24 h) returns `running` = 0 |
| gap-leads | `low-traffic` | `lead:pipe-cut-with-traffic` | `FACTS_SQL`: `adRows > 0` and `adClicks < MIN_AD_CLICKS` (360) |
| gap-leads | `low-traffic` | `lead:clickfunnels-posts-silent` | `FACTS_SQL`: `formViews < MIN_FORM_PAGE_VIEWS` (20) |
| gap-leads | `no-real-lead` | `lead:slo-contact-not-in-clickfunnels` | `CONTACTS_SQL` (3-day window) returns an array with 0 rows |
| gap-pixels | `low-traffic` | `ad-click-stored` | `AD_CLICK_SQL` (same 3 closed Arizona days): `meta_clicks < MIN_META_CLICKS` (20) **and** `last_synced_at` is within `FRESH_HOURS` (36 h) of `now` |
| gap-social | `not-connected` | `social:video-stats-stale` | `ctx.scope` is a function (staff) and `VIDEO_STATS_SQL`: `watched` = 0 |

`low-traffic` is shared by three rows in two files. The audit finds the module by the row's `sliceId` (`gap-leads`, `gap-pixels`), and each module tells the rows apart by `args.check`.
Small helper exports: none new. Constants the verifiers need were already exported.

Changed SQL result columns (round 2): `SPEND_DAYS_SQL` now returns `last_saved, first_day, rows_0, rows_1, spent_days, running, running_now`; `AD_CLICK_SQL` now returns `meta_clicks, last_synced_at, stored`. Params are unchanged.

## The seven rows

Raw row shape from `gapChecks(ctx)`: `{ id, status: "na", detail, suggestedFix: null, na: { code, args } }`.
The id the scorecard sees is the one `run-slices.mjs` builds (`namespaceGapId`), shown in the second column.

| Raw id | Scorecard id | code | `args` (keys) | `na` is returned when | Otherwise |
|---|---|---|---|---|---|
| `ads-spend-day-missing` | `gap-ads:ads-spend-day-missing` | `no-running-ad` | `check`, `running: 0` | a closed day has no spend row, and `running` and `running_now` are both the number 0 | a running ad, even a new one: spent-before/after logic (FAIL or skip); counts missing: `skip` |
| `ads-running-no-metrics` | `gap-ads:ads-running-no-metrics` | `no-running-ad` | `check`, `running: 0` | sync is fresh and `running` (running ads older than 24 h) is the number 0 | `skip` (running missing; sync never stamped; sync past 36 h) |
| `lead:pipe-cut-with-traffic` | `gap-leads:lead:pipe-cut-with-traffic` | `low-traffic` | `check`, `clicks`, `min`, `first`, `last`, `orgId?` | no lead proof, an ad row exists, and clicks < 360 | PASS / FAIL as before; `skip` when there is no ad row at all |
| `lead:clickfunnels-posts-silent` | `gap-leads:lead:clickfunnels-posts-silent` | `low-traffic` | `check`, `views`, `min`, `first`, `orgId?` | zero ClickFunnels posts and fewer than 20 form-page people | PASS / FAIL as before; `skip` when no other sender left a receipt |
| `lead:slo-contact-not-in-clickfunnels` | `gap-leads:lead:slo-contact-not-in-clickfunnels` | `no-real-lead` | `check`, `days: 3`, `orgId?` | the contacts read returned an empty list | PASS / FAIL as before; `skip` for "all before copy went live", "still waiting", and a read with no list |
| `ad-click-stored` | `gap-pixels:ad-click-stored` | `low-traffic` | `check`, `clicks`, `min`, `from`, `to`, `orgId?` | `meta_clicks` is a number under 20 and the Meta connection saved within 36 h | PASS / FAIL as before; `skip` when the count is missing or no fresh sync stands behind a low count |
| `social:video-stats-stale` | `social:video-stats-stale` | `not-connected` | `check`, `orgId?` | `watched` is the number 0 and the read ran on the staff scope | PASS / FAIL as before; `skip` when `watched` is null, or the zero came from the plain handle |

All `detail` texts keep the old skip sentence (so the old assertions still match) plus one short closing sentence that says when it gets judged, for example `... so Meta had nothing to send. Judged the day an ad runs.` and `Judged the day Meta counts 20 clicks.`

Design note on `ads-running-no-metrics` (kept on purpose): its question is "is any running ad old enough (24 h) to need a metrics row?". `running` there counts only ads older than 24 h, and a brand-new running ad correctly has nothing to judge until it ages, so the `na` is true as the detail words it ("No running ad is older than 24 h"). Making it `skip` whenever a new ad runs would put a red `audit:not-checked` on the first day of every new ad. Piece A's reason sentence for `no-running-ad` should not say "No ad is running" for this row (see requests).

## Measured live facts (read-only helper, 2026-10-09, staff scope, the lanes' own SQL with params inlined)

Each of the seven rows is a `skip` today for exactly the reason the contract names (round 1). Round 2 re-ran the two changed queries (`SPEND_DAYS_SQL`, `AD_CLICK_SQL`) the same way:

| Row | Measured | So today it is |
|---|---|---|
| `ads-spend-day-missing` | `SPEND_DAYS_SQL`: `last_saved` 18:30 UTC today, `first_day` 2026-08-04, `rows_0` 1, `rows_1` 0, `running` **0**, `running_now` **0** | skip "no ad is running" -> now `na no-running-ad` |
| `ads-running-no-metrics` | `RUNNING_BARE_SQL`: `last_synced_at` 17:30 UTC today, `running` **0**, `bare` 0 | skip "no running ad older than 24 h" -> now `na no-running-ad` |
| `lead:pipe-cut-with-traffic` | `FACTS_SQL`: `ad_rows` 1, `ad_clicks` **0**, `road_leads` 0, `cf_leads` 0 | skip "Zero leads only means something at 360" -> now `na low-traffic` |
| `lead:clickfunnels-posts-silent` | `FACTS_SQL`: `form_views` **0**, `cf_posts` 0, `other_posts` 39 | skip "Too quiet" -> now `na low-traffic` |
| `lead:slo-contact-not-in-clickfunnels` | `CONTACTS_SQL`: **0 rows** | skip "No real roadmap lead" -> now `na no-real-lead` |
| `ad-click-stored` | `AD_CLICK_SQL` (staff): `meta_clicks` **0**, `last_synced_at` 2026-10-09 18:30 UTC, `stored` 0. The same SQL as the plain role: `meta_clicks` 0, `last_synced_at` **null** | staff: skip "too little ad traffic" -> now `na low-traffic`. Plain role: now a `skip` (it would have been a silent `na`) |
| `social:video-stats-stale` | `VIDEO_STATS_SQL`: `watched` **0**, no sync time, no connect time | skip "no active YouTube connection" -> now `na not-connected` (staff scope only) |

## Tests

Command: `node --test src/pulse/coverage/gap-ads.test.mjs src/pulse/coverage/gap-leads.test.mjs src/pulse/coverage/gap-pixels.test.mjs src/pulse/coverage/gap-social.test.mjs`
Result after round 2: **195 tests, 182 pass, 0 fail, 13 skipped** (round 1: 184 tests, 171 pass, 13 skipped; before piece G: 146 tests, 133 pass, 13 skipped). The 13 skipped are the "sql meaning" tests of `gap-leads.test.mjs`, which need `DATABASE_URL` and a real Postgres (CI has both). Their SQL is unchanged; the one with a stale expectation is fixed (finding 1).
Also green: `src/pulse/coverage/modules.test.mjs`, `run-slices.test.mjs` (16/16), `npm run lint` (3191 files parse clean), the whole `src/pulse/**` run (2323 tests, 2257 pass, 65 skipped, 1 fail).

Failures that are not from this change (both reproduce with none of my files involved):
- `src/pulse/**`: `registry: every registry row names a real handler or desk file` says `leads/c01cb...e1/index.html` is gone. That folder is `public/leads/`, listed in `.git/info/exclude` of the main checkout, so the file exists there and not in a fresh worktree.
- `src/lib/no-unfenced-transmit.test.mjs`: `fence: nothing reaches the network except through src/lib/outbound-fetch.mjs` names `src/pulse/funnel-doors.mjs` and `src/pulse/instant-watch.mjs`. Neither file is touched here (`git diff` against the contract commit is empty for both). Not mine; not fixed.
- `npx tsc --noEmit`: one error, `src/marketing/filmed-receive.mjs(159,75)`. Not mine; no error in `src/pulse/coverage`.

### Existing tests whose expectation changed in round 1 (skip became na)

These 11 tests walked straight into one of the seven skips the contract turns into `na`, so the status they expect had to change. Every other assertion in each test is kept (detail regexes, ids, shapes). Nothing was deleted, skipped or loosened.

| File | Test | Change |
|---|---|---|
| gap-ads | empty closed days with every ad paused | `skip` -> `na` + code/args + "Judged the day an ad runs." |
| gap-ads | no running ad old enough: metrics check | `skip` -> `na` + code/args |
| gap-leads | pipe: first draft cried wolf (15..359 clicks) | `skip` -> `na`, args checked, 360 is still FAIL; added 0 clicks |
| gap-leads | pipe: live /apply form cannot hide a dead /roadmap save | the "too few clicks" half: `skip` -> `na` |
| gap-leads | posts: 20 people is enough, 19 is not | 19: `skip` -> `na` (args checked); 20 is still FAIL |
| gap-leads | posts: ad clicks never turn this red | `skip` -> `na` |
| gap-leads | posts: too quiet to expect a post | `skip` -> `na` |
| gap-leads | contact: no real roadmap lead in three days | `skip` -> `na` |
| gap-leads | lane: quiet day (ads paused) | `["skip","skip","skip"]` -> `["skip","na","na"]` (pipe has no ad row, so it stays skip) |
| gap-pixels | ad click: ads paused | `skip` -> `na` |
| gap-social | no active YouTube connection | `skip` -> `na` |

Round 1 missed a twelfth: the DB-gated whole-lane test fixed in round 2 (finding 1).

Shape helpers (`assertShape` / `shape`) allow exactly one extra key, `na`, and only when the status is `na`. Every other status still has to match the old 4-key shape.

### New tests (each rule has a pass case and a fail case)

- Condition true -> `na` with the right code and args; condition false -> PASS/FAIL, never `na` (all seven rows, including the boundaries 359/360 clicks, 19/20 form views, 19/20 Meta clicks).
- A count that did not come back (missing, null, empty, "x") -> stays `skip`, never `na` (ads x2, pixels, social).
- Rows that are `skip` for another reason stay `skip` (stale or never-stamped sync with no ad running; no ad row for the pipe check).
- `naVerify` for every code: true when the quiet condition holds, false above the minimum / at the minimum / with an ad running / with a lead / with an active connection; false with no read, no row, another check, no args, a bad `now`; throws on a failed read; company from `args.orgId`, then `ctx.orgId`, then all; uses the lane's own SQL text and the same days.
- Round trip per lane: the row's own `na.args` pass `naVerify` on the quiet fixture and fail it on a busy fixture.
- gap-pixels: the redact pass keeps `na`, and no secret reaches any row.
- Round 2: a new ad is running (`running_now`) never hides; a low Meta click count with no fresh sync (undefined, null, empty, unparseable, 36 h + 36 s, 200 h) is a skip, and a stamp at exactly 36 h still counts; the plain handle's zero in gap-social is a skip and `naVerify` with `db` alone reads nothing; a contacts read with no list is a skip; the no-database twin of the 400-clicks whole-lane test.

## Not built, on purpose (left as `skip`, so they still land `not_checked`)

Spec rule 1.2: "we cannot see it from here" is never a condition. So these quiet skips in the same files stay skips. They are not on the contract's list of seven:

1. `lead:pipe-cut-with-traffic` with **no ad row at all** (ads paused, Meta sends no row, or the sync is late). The lane itself says "we cannot tell if ads sent people". Today's live state has one ad row, so it is `na`; on a morning with no ad row it will be `skip`. This is the most likely place for a surprise red `audit:not-checked`. Owner/integrator decision.
2. `ads-spend-day-missing` when the day is empty and no ad spent before or after it ("looks like ads switched off or on"), and (round 2) when a running ad is too new to be in `running` and no ad spent on one side of the gap.
3. `lead:clickfunnels-posts-silent` when 20+ people opened a form page and no sender left a receipt ("receipts may be switched off").
4. `lead:slo-contact-not-in-clickfunnels` when every lead is older than the ClickFunnels copy, all are under 30 minutes old, or the read gave no list.
5. `ads-running-no-metrics` with a never-stamped or 36 h-old sync; `ad-click-stored` with a low count and no fresh Meta sync (round 2), or with no database; `social:video-stats-stale` with no database or only the plain handle (round 2).
6. `funnel-click-stored` (gap-pixels) has a "too few page views" skip. It is not one of the seven, so it is untouched.

## Requests for others

- **Piece C (`run-slices.mjs`)**: `GAP_STATUSES` must gain `na`, and `gapResult` must carry `row.na` through unchanged (`{ code, args }`). Until it does, an `na` row is mapped to `skip` by the existing code, which is exactly today's behaviour, so nothing breaks in between.
- **Piece A (`na-conditions.mjs`)**: four lane codes with `verify: "lane"`: `no-running-ad`, `low-traffic`, `no-real-lead`, `not-connected`. Reason sentences should not copy numbers: they live in `args` (`clicks`, `min`, `views`, `from`, `to`, `first`, `last`). The `no-running-ad` reason serves two rows with different questions: for `ads-spend-day-missing` it is "no ad is running"; for `ads-running-no-metrics` it is "no running ad is old enough yet". Use `args.check` to pick the sentence, or keep it neutral ("no ad is old enough to judge").
- **Piece D (audit)**: build `ctx.laneNaVerify(sliceId, code, args)` as: find the lane in `GAP_FILES` by `sliceId` (`gap-ads`, `gap-leads`, `gap-pixels`, `gap-social`), call `mod.naVerify[code](args, { db, scope, now })`, return `undefined` when the module has no such code. The row's `sliceId` for `social:video-stats-stale` is `gap-social` (its scorecard id has no `gap-` prefix, so use `sliceId`, not the id). Do not pass `orgId` in `ctx`: the company already rides in `args.orgId`. **Round 2: always pass the staff `scope`** (not only `db`) to the lane verifiers. gap-social's verifier now returns `false` without a staff scope, and gap-pixels' verifier returns `false` when its read shows no fresh Meta sync (which is all the plain role can see).
- **Integrator**: `lead:pipe-cut-with-traffic` is listed as a money check in `src/pulse/tripwires.mjs` (`page:roadmap/index.html`, `route:public/slo-interest`, `route:public/survey-submit`). When it is `na` it is not red. That is the intent of the contract, but the later "tripwire holes" audit (out of Ship 1) should treat a verified `na` as covered. `src/pulse/coverage/INDEX.md` is not mine and was not updated.
- **CI**: run the 13 "sql meaning" tests of `gap-leads.test.mjs` with a real `DATABASE_URL` as usual. Their SQL is unchanged; the one stale expectation is fixed, and a no-database twin of it now runs everywhere. I could not run them here.

## Could not do

Nothing in the contract was left out. Not verified here: the 13 SQL-meaning tests (no `DATABASE_URL` in this session; their SQL is unchanged), and the lanes inside the real bundle (`npm run pulse:prove` is the integrator's job and needs piece C first).
