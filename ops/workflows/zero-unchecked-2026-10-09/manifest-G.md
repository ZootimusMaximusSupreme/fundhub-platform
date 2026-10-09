# Manifest G — lane "nothing to judge" rows (Ship 1, zero not-checked)

Builder G. Branch `build/ZU-G-2026-10-09`, cut from `main` at `fbc54d0e` (the commit that holds the build contract).
Scope: the seven lane rows in `build-contract.md` piece G. Nothing else.

## Files touched (all inside the owned list)

| File | What changed |
|---|---|
| `src/pulse/coverage/gap-ads.mjs` | 2 rows can return `na`. New export `naVerify`. |
| `src/pulse/coverage/gap-leads.mjs` | 3 rows can return `na`. New export `naVerify`. |
| `src/pulse/coverage/gap-pixels.mjs` | 1 row can return `na`. New export `naVerify`. `redactRows` now keeps the `na` key. |
| `src/pulse/coverage/gap-social.mjs` | 1 row can return `na`. New export `naVerify`. |
| `gap-ads.test.mjs`, `gap-leads.test.mjs`, `gap-pixels.test.mjs`, `gap-social.test.mjs` | Updated and extended (below). |

No migration, no new dependency, no new id, no repo-file read at run time, no write, no network call. No SQL text was changed (the 13 "sql meaning" tests in `gap-leads.test.mjs` still skip with no `DATABASE_URL`, as before; they run in CI).

## Exports added (exact names and shapes)

Every lane file exports:

```js
export const naVerify = Object.freeze({
  "<code>": async (args, ctx) => boolean   // true only when the quiet condition is really true now
});
```

`ctx` is `{ db, scope, now }` (also reads `ctx.orgId` if the caller has one). `args` is the `na.args` object from the row.
Rules every verifier keeps:
- Same SQL text and same minimum constant the lane used (`SPEND_DAYS_SQL`, `RUNNING_BARE_SQL`, `FACTS_SQL`, `CONTACTS_SQL`, `AD_CLICK_SQL`, `VIDEO_STATS_SQL`; `MIN_AD_CLICKS`, `MIN_FORM_PAGE_VIEWS`, `MIN_META_CLICKS`). No number copied.
- No read possible (no `scope`, no `db`), a count that is missing or not a number, a row for another check, missing or empty `args`: returns `false`.
- A read that fails **throws** (the message is kept). `verifyNa` already counts a throw as `ok:false`.
- Company: `args.orgId`, else `ctx.orgId`, else all companies. The lane puts `orgId` in `args` only when it read one company, so the re-check reads the same data.

| File | `naVerify` code | `args.check` values it answers | True when |
|---|---|---|---|
| gap-ads | `no-running-ad` | `ads-spend-day-missing` | `SPEND_DAYS_SQL` (days = `closedDays(now)`) returns `running` = 0 |
| gap-ads | `no-running-ad` | `ads-running-no-metrics` | `RUNNING_BARE_SQL` (cutoff = now - 24 h) returns `running` = 0 |
| gap-leads | `low-traffic` | `lead:pipe-cut-with-traffic` | `FACTS_SQL`: `adRows > 0` and `adClicks < MIN_AD_CLICKS` (360) |
| gap-leads | `low-traffic` | `lead:clickfunnels-posts-silent` | `FACTS_SQL`: `formViews < MIN_FORM_PAGE_VIEWS` (20) |
| gap-leads | `no-real-lead` | `lead:slo-contact-not-in-clickfunnels` | `CONTACTS_SQL` (3-day window) returns an array with 0 rows |
| gap-pixels | `low-traffic` | `ad-click-stored` | `AD_CLICK_SQL` (same 3 closed Arizona days): `meta_clicks < MIN_META_CLICKS` (20) |
| gap-social | `not-connected` | `social:video-stats-stale` | `VIDEO_STATS_SQL`: `watched` = 0 |

`low-traffic` is shared by three rows in two files. The audit finds the module by the row's `sliceId` (`gap-leads`, `gap-pixels`), and each module tells the rows apart by `args.check`.
Small helper exports: none new. Constants the verifiers need were already exported.

## The seven rows

Raw row shape from `gapChecks(ctx)`: `{ id, status: "na", detail, suggestedFix: null, na: { code, args } }`.
The id the scorecard sees is the one `run-slices.mjs` builds (`namespaceGapId`), shown in the second column.

| Raw id | Scorecard id | code | `args` (keys) | `na` is returned when | Otherwise |
|---|---|---|---|---|---|
| `ads-spend-day-missing` | `gap-ads:ads-spend-day-missing` | `no-running-ad` | `check`, `running: 0` | a closed day has no spend row, and the read says `running` is the number 0 | `skip` (running missing) |
| `ads-running-no-metrics` | `gap-ads:ads-running-no-metrics` | `no-running-ad` | `check`, `running: 0` | sync is fresh and `running` is the number 0 | `skip` (running missing; sync never stamped; sync past 36 h) |
| `lead:pipe-cut-with-traffic` | `gap-leads:lead:pipe-cut-with-traffic` | `low-traffic` | `check`, `clicks`, `min`, `first`, `last`, `orgId?` | no lead proof, an ad row exists, and clicks < 360 | PASS / FAIL as before; `skip` when there is no ad row at all |
| `lead:clickfunnels-posts-silent` | `gap-leads:lead:clickfunnels-posts-silent` | `low-traffic` | `check`, `views`, `min`, `first`, `orgId?` | zero ClickFunnels posts and fewer than 20 form-page people | PASS / FAIL as before; `skip` when no other sender left a receipt |
| `lead:slo-contact-not-in-clickfunnels` | `gap-leads:lead:slo-contact-not-in-clickfunnels` | `no-real-lead` | `check`, `days: 3`, `orgId?` | the contacts read returned 0 rows | PASS / FAIL as before; `skip` for "all before copy went live" and "still waiting" |
| `ad-click-stored` | `gap-pixels:ad-click-stored` | `low-traffic` | `check`, `clicks`, `min`, `from`, `to`, `orgId?` | `meta_clicks` is a number under 20 | PASS / FAIL as before; `skip` when the count is missing |
| `social:video-stats-stale` | `social:video-stats-stale` | `not-connected` | `check`, `orgId?` | `watched` is the number 0 | PASS / FAIL as before; `skip` when `watched` is null |

All `detail` texts are the old skip sentence (so the old assertions still match) plus one short closing sentence that says when it gets judged, for example `... so Meta had nothing to send. Judged the day an ad runs.` and `Judged the day Meta counts 20.` The pipe sentence lost its long bracket (`about 1 lead per 120 clicks, so 3 expected`); the numbers still show in the FAIL text.

## Measured live facts (read-only helper, 2026-10-09, staff scope, the lanes' own SQL with params inlined)

Each of the seven rows is a `skip` today for exactly the reason the contract names:

| Row | Measured | So today it is |
|---|---|---|
| `ads-spend-day-missing` | `SPEND_DAYS_SQL`: `last_saved` 17:30 UTC today, `first_day` 2026-08-04, `rows_0` 1, `rows_1` 0, `running` **0** | skip "no ad is running" -> now `na no-running-ad` |
| `ads-running-no-metrics` | `RUNNING_BARE_SQL`: `last_synced_at` 17:30 UTC today, `running` **0**, `bare` 0 | skip "no running ad older than 24 h" -> now `na no-running-ad` |
| `lead:pipe-cut-with-traffic` | `FACTS_SQL`: `ad_rows` 1, `ad_clicks` **0**, `road_leads` 0, `cf_leads` 0 | skip "Zero leads only means something at 360" -> now `na low-traffic` |
| `lead:clickfunnels-posts-silent` | `FACTS_SQL`: `form_views` **0**, `cf_posts` 0, `other_posts` 39 | skip "Too quiet" -> now `na low-traffic` |
| `lead:slo-contact-not-in-clickfunnels` | `CONTACTS_SQL`: **0 rows** | skip "No real roadmap lead" -> now `na no-real-lead` |
| `ad-click-stored` | `AD_CLICK_SQL`: `meta_clicks` **0**, `stored` 0 | skip "too little ad traffic" -> now `na low-traffic` |
| `social:video-stats-stale` | `VIDEO_STATS_SQL`: `watched` **0**, no sync time, no connect time | skip "no active YouTube connection" -> now `na not-connected` |

Proof run: the four real lane files against a fake scope seeded with those exact numbers give seven `na` rows and seven `naVerify = true` (script: scratchpad `zu-g/live-values-demo.mjs`, no database touched).

## Tests

Command: `node --test src/pulse/coverage/gap-ads.test.mjs src/pulse/coverage/gap-leads.test.mjs src/pulse/coverage/gap-pixels.test.mjs src/pulse/coverage/gap-social.test.mjs`
Result: **184 tests, 171 pass, 0 fail, 13 skipped** (before: 146 tests, 133 pass, 0 fail, 13 skipped; the same 13 SQL-meaning tests, which need `DATABASE_URL`).
Also green: `src/pulse/coverage/modules.test.mjs`, `run-slices.test.mjs` (16/16), `npm run lint` (3191 files parse clean).
Full `src/pulse/**` run: 2312 tests, 2246 pass, 65 skipped, **1 fail**, not from this change: `registry: every registry row names a real handler or desk file` says `leads/c01cb...e1/index.html` is gone. That folder is `public/leads/`, listed in `.git/info/exclude` of the main checkout, so the file exists there and not in a fresh worktree. It does not import any file I touched.

### Existing tests whose expectation changed (skip became na) — the only edits to existing assertions

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

Shape helpers (`assertShape` / `shape`) now allow exactly one extra key, `na`, and only when the status is `na`. Every other status still has to match the old 4-key shape.

### New tests (each rule has a pass case and a fail case)

- Condition true -> `na` with the right code and args; condition false -> PASS/FAIL, never `na` (all seven rows, including the boundaries 359/360 clicks, 19/20 form views, 19/20 Meta clicks).
- A count that did not come back (missing, null, empty, "x") -> stays `skip`, never `na` (ads x2, pixels, social).
- Rows that are `skip` for another reason stay `skip` (stale or never-stamped sync with no ad running; no ad row for the pipe check).
- `naVerify` for every code: true when the quiet condition holds, false above the minimum / at the minimum / with an ad running / with a lead / with an active connection; false with no read, no row, another check, no args, a bad `now`; throws on a failed read; works with `db` alone; company from `args.orgId`, then `ctx.orgId`, then all; uses the lane's own SQL text and the same days.
- Round trip per lane: the row's own `na.args` pass `naVerify` on the quiet fixture and fail it on a busy fixture.
- gap-pixels: the redact pass keeps `na`, and no secret reaches any row.

Mutation checks (change one line, expect a named test to fail, restore): verifier accepts any count (3 ads tests fail), lane says na with a missing count (1), pipe boundary `<=` (1), verifier drops the ad-row requirement (1), verifier treats a missing rows list as zero leads (1), posts boundary `<=` (1), pixels verifier boundary `<=` (1), redact drops `na` (4), social verifier accepts any count (2). All restored byte for byte (`cmp`).

## Not built, on purpose (left as `skip`, so they still land `not_checked`)

Spec rule 1.2: "we cannot see it from here" is never a condition. So these quiet skips in the same files stay skips. They are not on the contract's list of seven:

1. `lead:pipe-cut-with-traffic` with **no ad row at all** (ads paused, Meta sends no row, or the sync is late). The lane itself says "we cannot tell if ads sent people". Today's live state has one ad row, so it is `na`; on a morning with no ad row it will be `skip`. This is the most likely place for a surprise red `audit:not-checked`. Owner/integrator decision.
2. `ads-spend-day-missing` when the day is empty and no ad spent before or after it ("looks like ads switched off or on").
3. `lead:clickfunnels-posts-silent` when 20+ people opened a form page and no sender left a receipt ("receipts may be switched off").
4. `lead:slo-contact-not-in-clickfunnels` when every lead is older than the ClickFunnels copy, or all are under 30 minutes old.
5. `ads-running-no-metrics` with a never-stamped or 36 h-old sync; `ad-click-stored` / `social:video-stats-stale` with no database.
6. `funnel-click-stored` (gap-pixels) has a "too few page views" skip. It is not one of the seven, so it is untouched.

## Requests for others

- **Piece C (`run-slices.mjs`)**: `GAP_STATUSES` must gain `na`, and `gapResult` must carry `row.na` through unchanged (`{ code, args }`). Until it does, an `na` row is mapped to `skip` by the existing code, which is exactly today's behaviour, so nothing breaks in between.
- **Piece A (`na-conditions.mjs`)**: four lane codes with `verify: "lane"`: `no-running-ad`, `low-traffic`, `no-real-lead`, `not-connected`. Reason sentences should not copy numbers: they live in `args` (`clicks`, `min`, `views`, `from`, `to`, `first`, `last`).
- **Piece D (audit)**: build `ctx.laneNaVerify(sliceId, code, args)` as: find the lane in `GAP_FILES` by `sliceId` (`gap-ads`, `gap-leads`, `gap-pixels`, `gap-social`), call `mod.naVerify[code](args, { db, scope, now })`, return `undefined` when the module has no such code. The row's `sliceId` for `social:video-stats-stale` is `gap-social` (its scorecard id has no `gap-` prefix, so use `sliceId`, not the id). Do not pass `orgId` in `ctx`: the company already rides in `args.orgId`.
- **Integrator**: `lead:pipe-cut-with-traffic` is listed as a money check in `src/pulse/tripwires.mjs` (`page:roadmap/index.html`, `route:public/slo-interest`, `route:public/survey-submit`). When it is `na` it is not red. That is the intent of the contract, but the later "tripwire holes" audit (out of Ship 1) should treat a verified `na` as covered. `src/pulse/coverage/INDEX.md` is not mine and was not updated.
- **CI**: run the 13 "sql meaning" tests of `gap-leads.test.mjs` with a real `DATABASE_URL` as usual. The SQL text is unchanged.

## Could not do

Nothing in the contract was left out. Not verified here: the 13 SQL-meaning tests (no `DATABASE_URL` in this session; their SQL is unchanged), and the lanes inside the real bundle (`npm run pulse:prove` is the integrator's job and needs piece C first).
