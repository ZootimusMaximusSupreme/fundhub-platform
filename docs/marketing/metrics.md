# Marketing numbers — what each one means

One definition per number. The code is `src/marketing/metrics.mjs`. The spec is
`docs/specs/marketing-machine-2026-10-04.md` §11.1. If a rule changes, change the
code and this page in the same commit.

Tests: `src/marketing/metrics.test.mjs` (every ratio, unknown stays unknown, the
14-day line), `src/marketing/metrics-drift.test.mjs` (the $147 roadmap rule matches
the client portal's), `src/http/marketing-metrics.pg.test.mjs` (three ads of fixture
rows, exact numbers, on a real Postgres in CI).

## The table (spec §11.1)

| Number | How it's counted | Code |
|---|---|---|
| Spend, impressions | `ad_metrics_daily`, by spend date (Meta's own day, Arizona) | `readAdNumbers` `spend_cents`, `impressions` |
| CTR | `link_clicks ÷ impressions` (not `clicks`, which is every click) | `ctr` |
| Hook rate | `video_continuous_2s_watched ÷ impressions` | `hookRate` |
| 25% hold | `video_p25_watched ÷ video_plays` | `hold25` |
| Thruplay rate | `video_thruplay_watched ÷ video_plays` | `thruplayRate` |
| Leads | `client_ad_attribution` rows for the number | `leads` |
| Booked calls | those leads with a `bookings` row (booked, rescheduled, noshow, completed), matched by `client_id`, or else (booking with no client) by attendee email to the client's email, trimmed, any case | `booked` |
| Showed | a `call_outcomes` row whose outcome isn't `no_show`. Switch to W7's ShowedCall when it lands. | `showed` |
| Sales, close rate | `sales.status = 'active'`; sales ÷ showed | `sales`, `closeRate` |
| $147 roadmaps | `readSloPaid`'s rule, leaving out demo rows | `roadmaps`, `roadmapPaidPredicates` |
| Cash | `transactions` with status `succeeded` for those clients, leaving out demo rows | `cash_cents` |
| Reported cash | closers' typed cash, `SUM(call_outcomes.cash_collected_cents)` — what My Numbers shows | `reported_cash_cents` |
| Cost per lead, cost per booked call, ROAS | spend ÷ leads, spend ÷ booked calls, cash ÷ spend | `cpl`, `costPerBooked`, `roas` |
| Page views, click → page, page → lead | `events` rows named `funnel.page`, `funnel.click` and `funnel.<event>`, where `payload->>'actor' = 'person'` | `readFunnelEvents`, `clickToPage`, `pageToLead` |

## The rules under the table

- **Arizona days.** The ad account's day is America/Phoenix (UTC−7 all year,
  `src/lib/ad-account-day.mjs`). `from` and `to` are Arizona days and both are
  included. Nothing reads `CURRENT_DATE`.
- **Spend by spend date. Everything else by lead date.** A lead's date is the
  Arizona day of `client_ad_attribution.captured_at`.
- **14 days.** A lead's results (booked, showed, sales, roadmaps, cash, reported
  cash) count only if they happen before the lead is 14 days old. A lead younger
  than 14 days is **still maturing**: `maturing` is true on its ad and
  `maturing_leads` says how many. At exactly 14 days a lead has settled.
- **No lower bound.** A booking or payment saved a moment before the tag row (same
  request) still belongs to that lead.
- **First touch wins.** One `client_ad_attribution` row per client, and the writer
  never overwrites a tag (286). Every result belongs to one ad number.
- **Two kinds of `ad_id`** (spec §4 trap 10). `ad_metrics_daily.ad_id` is `ads.id`
  (a uuid). `client_ad_attribution.ad_id` is our ad number, as text. The bridge is
  `ads.fundhub_ad_number`.
- **Counted per ad NUMBER.** One number can sit on several Meta ads (U14, 416).
  Spend is summed per number and leads are counted per number in separate steps,
  then joined. Two ads with the same number add their spend; they never double a
  lead.
- **People, not rows.** booked, showed, sales and roadmaps count leads (people).
  Two bookings for one person is one booked lead. Close rate is people who bought ÷
  people who showed.
- **Demo rows never count.** `clients`, `call_outcomes`, `sales`, `transactions`,
  `payment_links` and `events` all carry `is_demo`. The spec names demo rows for
  roadmaps and cash; the same rule is applied to leads, showed and sales so a demo
  person can never be a marketing result (default picked, U20).
- **Unknown is `null`, never 0.**
  - A ratio with an unknown side, or a bottom of 0, is `null`.
  - A Meta number that was never reported in the window (for example
    `video_continuous_2s_watched`) is `null`. `reported_days` says on how many
    ad-days Meta did report link clicks, plays and 2-second plays.
  - A number with leads and no spend in the window reads spend `null`, not $0.
  - Cash is the sum of reported amounts. It is `null` only when there were
    succeeded payments and none reported an amount; `cash_unknown` counts payments
    with no amount. No payments at all is a real $0.
  - A day with no saved ad-days reads spend `null` in `readDaily`.
- **Unmapped spend.** Spend from an ads row with no `fundhub_ad_number` is not in
  any number's row. `readTotals().unmapped` reports it (and leads whose tags match
  no ad) so the screen can show it with a Link button.
- **Page events per ad.** The ad number of a visit is worked out from its own tags
  the way 407 does it for a lead: leading digits of `utm_content`, else the Meta
  match (ad set id in `utm_term` + exact ad name in `utm_content`). Funnel and step
  come from the page through `src/funnel/pages.mjs`, so rows saved before
  2026-10-02 (page, no funnel) still map.
- **Ratios** are plain fractions rounded to 4 places (0.0345 = 3.45%), or whole
  cents. They are never clamped: Meta restates counts, so a rate can be above 1.
  `src/ops/meta-marketing.mjs costPerBooked` adds the small-sample rule
  (`MIN_N_RATE`) for insight cards; the one here is the plain division.

## The readers

All take the `tx` from `asStaff()` (`src/partners/rls.mjs`). `ads` and
`ad_metrics_daily` force partner row-level security: a bare query sees no rows.

| Reader | Gives back |
|---|---|
| `readAdNumbers(tx, {orgId, from, to, adNumbers?, now?})` | one row per ad number: `ads`, `spend_cents`, `impressions`, `link_clicks`, `plays`, `p25`, `thruplay`, `two_sec`, `ad_days`, `reported_days`, `leads`, `booked`, `showed`, `sales`, `roadmaps`, `cash_cents`, `cash_unknown`, `reported_cash_cents`, `maturing`, `maturing_leads` |
| `readTotals(tx, {orgId, from, to, now?})` | the same fields for the whole company, plus `unmapped: {spend_cents, ad_days, ads, leads}` |
| `readDaily(tx, {orgId, days, now?})` | one row per Arizona day ending today: spend, impressions, link clicks, leads and their results |
| `readFunnelEvents(tx, {orgId, from, to})` | one row per event name, page and ad number: `funnel`, `step`, `events`, `sessions` |
| `roadmapPaidPredicates(tx, {orgId, clientId})` | `{by_order, by_funnel, paid}` — readSloPaid's question on any transaction |

Per-funnel and per-angle roll-ups are U32's (`src/marketing/metrics-rollups.mjs`).
The endpoints are U31's and U32's.

## Why the roadmap rule is copied, and how it stays the same

`api/read/portal-summary.mjs` `readSloPaid` (:409-428) is the client portal's rule.
It is bound to the live database connection and wrapped in `safeRead`, which turns
any error into "not paid". It cannot run on a test database, and a broken table
would read as "nobody bought". So its two conditions are lifted into
`ROADMAP_BY_ORDER` and `ROADMAP_BY_FUNNEL`, and `metrics-drift.test.mjs` reads the
portal file's text and fails when either copy changes alone.

## Measured gaps (production, read only, 2026-10-06)

These are facts about the live data, not fixes. Nothing below was changed by U20.

1. **Booked calls read 0.** `bookings` has **0 rows** in production, while `events`
   holds **74** `booking.created` rows, every one with `client_id` NULL. Booked
   calls count `bookings` only, so they read 0 until bookings are written. Leftover
   card; not fixed here.
2. **Showed and reported cash read 0.** `call_outcomes` has **0 rows** in
   production.
3. **Two answers to "money from this ad".** Cash here is `transactions` with status
   `succeeded` (the spec). `adAttributionRollup` (`src/ads/store.mjs:79-125`)
   counts paid `payment_links` instead, on purpose, to avoid counting one payment
   twice. The same payment usually lands in both tables (119: `commas_session_id`
   is `transactions.provider_ref`), but a payment written to only one of them shows
   in only one number. Today: 2 succeeded transactions, 2 paid payment links.
4. **"25% hold" is not ad-spine's hold rate.** Here 25% hold is
   `p25 ÷ plays`. `api/read/ad-spine.mjs:551-552` `hold_rate` is
   `p75 ÷ 2-second plays`. Different numbers with similar names.
5. **Hook rate is unknown everywhere today.** `video_continuous_2s_watched` is
   stored on **0 of 69** ad-days (2026-08-04..2026-10-04). Hook rate reads `null`
   until the Meta sync saves that field.
6. **Link clicks are partial.** `link_clicks` is stored on 49 of 69 ad-days and
   `landing_page_views` on 42 (408 saves NULL when Meta sends no line). CTR sums
   the days that have it; `reported_days.link_clicks` shows how many.
7. **Some spend has no number.** 4 of 7 `ads` rows carry a `fundhub_ad_number`
   (407 gave the four SLO ads 84, 86, 89 and 90). The three August ads have none
   (407 leaves them NULL on purpose), so their spend is unmapped.
8. **Most leads have no number.** 2 of 18 `client_ad_attribution` rows carry an
   ad number.
9. **Showed is a stand-in.** It is `call_outcomes.outcome <> 'no_show'` until W7's
   ShowedCall lands (spec §4 trap 25), so a `callback` or `not_a_fit` counts as
   showed.
10. **Sales.** `sales` holds 1 row in production.
