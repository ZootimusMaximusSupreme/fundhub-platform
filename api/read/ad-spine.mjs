// GET /api/read/ad-spine — the label spine, read back.
//
// One place to ask v_ad_label_spine (db/migrations/377_marketing_label_spine.sql)
// the three questions Chris actually asked, and nothing else:
//
//   1. LIST     /api/read/ad-spine
//                 Every ad with the labels it inherited from its creative and
//                 that creative's script. Newest ad first.
//
//   2. GROUP    /api/read/ad-spine?group_by=angle
//                 One row per angle: how many ads carry it, and the friendly
//                 name for it out of ad_labels. Also hook, lane, offer,
//                 script_type.
//
//   3. FILTER   /api/read/ad-spine?angle=denial_angle
//                 Narrow either of the above to one label value. The five filter
//                 names are the same five words as group_by, and they combine.
//
//   4. MONEY    /api/read/ad-spine?group_by=hook&days=30
//                 Grouped mode also carries what each label COST and what it
//                 BROUGHT: spend, impressions, clicks, how many people arrived
//                 from those ads, how many of them booked, and the cost of one
//                 booked person. This is the answer to "which hook books a call
//                 for the least money".
//
//   5. VIDEO     the same call, same window
//                 And how far into the video people got, as the two rates paid
//                 media actually reads: hook_rate (people who kept watching past
//                 the opening ÷ impressions, did the opening stop them) and
//                 hold_rate (p75 views ÷ that same past-the-opening count, did
//                 the middle keep them). Meta publishes no 3-second field, so
//                 neither is the number Ads Manager prints beside the words
//                 "hook rate" — do not label them that way on a screen.
//                 Both come out of watchRate()
//                 in src/ops/meta-marketing.mjs and are defined nowhere else —
//                 see the note on shapeGroup. The numbers behind them are the
//                 columns 378_ad_video_metrics.sql added to ad_metrics_daily.
//
//                 A PHOTO AD HAS NO HOOK RATE. There is no video, so there is no
//                 such number: it comes back null with a note, never 0 and never
//                 "0%". Same rule as spend, one line down.
//
// ─── PAGING ────────────────────────────────────────────────────────────────
//
// ?limit= and ?offset=, through pageParams() and page() in
// src/http/read-api.mjs — the same envelope every other list endpoint returns
// ({ count, limit, offset, hasMore, items }). Default 50, hard cap 200.
//
// NOT AN OPAQUE CURSOR, DELIBERATELY. Nothing in this repository has one — no
// file under api/ or src/http/ contains the word — so inventing a cursor format
// here would be a new pattern with exactly one caller (CLAUDE.md §8: no
// speculative abstraction). The list's ORDER BY carries a tie-break on
// ad_row_id so offset paging is stable, which is the one thing an offset really
// does get wrong.
//
// ─── THE TWO JOINS THAT ATTACH MONEY (grouped mode only) ───────────────────
//
// 377's own header (Part 4d, :608-617) names them, and both are now written:
//
//   ad_metrics_daily      ON m.ad_id = v.ad_row_id            (046:432)
//   client_ad_attribution ON our ad number = their ad id      (286:95)
//
// THEY ARE COUNTED IN TWO SEPARATE PASSES, ON PURPOSE. ad_metrics_daily holds
// one row per ad PER DAY and client_ad_attribution one row per PERSON, so
// joining both to the same rows at once multiplies each by the other and every
// total comes out too big. The `grouped` branch below sums money, the `people`
// branch counts people with count(DISTINCT client_id), and the two meet on the
// label key at the end. count(DISTINCT) is also what makes the people numbers
// immune to a person having booked twice.
//
// THE LIST (no group_by) IS UNCHANGED. No money, no people, no date window —
// exactly the rows it returned before. Only grouped mode grew.
//
// ─── THE LEADING-ZERO TRAP, AND THE ONE PLACE IT IS HANDLED ────────────────
//
// fundhub_ad_id() keeps leading zeros: utm_content=042 is stored as the text
// '042' (286:81-84). If a person typed 42 into ads.fundhub_ad_number, a plain
// text join finds nothing and the answer is silently wrong with no error.
//
// CHOSEN: compare the two as NUMBERS, in exactly one place — AD_NUMBER_MATCH
// below — so '042' and '42' are the same ad. That cast can never fail: both
// columns carry the same CHECK, one to nine digits and nothing else
// (377:569, 286:116-117), and nine digits always fits a bigint.
//
// WHAT THAT COSTS, SAID OUT LOUD: two ads in the same company could hold '042'
// and '42' — the unique index is on the text, so it allows that — and they
// would now be treated as one number. The people count stays right anyway,
// because it counts DISTINCT people and not per-ad rows.
//
// ─── NO INVENTED METRIC, AND NO SECOND RULE ABOUT SMALL NUMBERS ────────────
//
// Cost per booked person comes from costPerBooked() in src/ops/meta-marketing.mjs,
// which refuses to divide under MIN_N_RATE (10, src/ops/discoveries.mjs:9) and
// returns status INSUFFICIENT with a null cost and a plain-words note instead.
// That rule is not restated or re-tuned here — one rule, one place.
//
// HOOK RATE AND HOLD RATE OBEY THE SAME ONE RULE. watchRate() sits in that same
// file, imports that same MIN_N_RATE, and refuses on a denominator under it with
// the same two status words. There is no second threshold in this repository and
// this file does not add one.
//
// ─── NULL MEANS UNKNOWN (CLAUDE.md §12) ────────────────────────────────────
//
// The view LEFT JOINs throughout, so an ad with no creative still comes back —
// with every label null. That is the answer "nobody has said yet", and it
// reaches the caller as null, never as 0 and never as "". Under group_by the
// same rows land in a group whose `key` is null. They are counted, not dropped:
// "how many ads nobody has labelled" is one of the numbers worth seeing.
//
// THE SAME RULE, APPLIED TO MONEY, IS THE WHOLE POINT OF THIS FILE:
//
//   spend_cents = null   nobody reported any spend for these ads in this window
//   spend_cents = 0      spend WAS reported, and it was zero
//
// Those are different facts and they must never look the same on a screen, so
// the sums are LEFT JOINed and never coalesced. `ad_days_reported` says how
// many ad-days the sum was built from — 0 means nothing was reported.
//
// PEOPLE ARE THE OTHER WAY ROUND, AND HERE IS WHY. A client_ad_attribution row
// is written when somebody arrives, so no row means nobody arrived — that is a
// real zero. The one case where it is genuinely unknown is a group in which no
// ad has our number typed in at all: nobody could be matched even in principle.
// `ads_with_number` says how many can be, and when it is 0 the people numbers
// come back null rather than a zero nobody should believe.
//
// THE ZERO THAT IS STILL A JUDGEMENT, AND THE NUMBER THAT LETS YOU CHECK IT.
// "A row is written when somebody arrives" is only true while the writer works,
// and the writer only console.warns when it fails. So the response also carries
// `people_rows_in_window`: how many people arrived company-wide in these days,
// ad or no ad. If that is 0 while the phone was ringing, the capture is broken
// and every people number below it is meaningless. See countPeopleRows.
//
// TWO NUMBERS THAT COVER DIFFERENT PERIODS, SAID OUT LOUD. `ads` is every ad the
// label ever had, for all time; the money is only the ?days= window.
// `ads_reported_in_window` says how many of those ads reported anything inside
// it, so "50 ads, spend 3000" cannot be read as fifty ads' worth of spending.
//
// ─── AUTH ──────────────────────────────────────────────────────────────────
//
// Same shape as api/read/video-stats.mjs and api/read/ad-books.mjs: requireAuth,
// then requireRole(ROLE_SETS.STAFF). requireRole is a SEPARATE call on purpose —
// requireAuth forwards its options to authenticate(), which reads only `db` and
// `env`, so a `roles` key handed to requireAuth is silently dropped (CLAUDE.md
// §12, src/http/auth-gate.test.mjs).
//
// ─── WHY asStaff() AND NOT A BARE db.query ─────────────────────────────────
//
// v_ad_label_spine carries security_invoker=true (377:620), so it applies the
// CALLER's row-level security rather than its owner's. ads, creative_assets and
// ad_scripts all have FORCEd partner policies, and ad_labels has its own
// staff-or-partner read policy (377:683). A bare db.query is anonymous to all of
// them: it returns ZERO ROWS rather than erroring, which reads on screen as "no
// data yet" instead of as a fault. Same reasoning as video-stats.mjs:16-19.
//
// ─── REDACTION ─────────────────────────────────────────────────────────────
//
// The response goes through page() → redact() in src/http/read-api.mjs, which
// strips any key matching its FORBIDDEN_KEY list (:18). Checked field by field:
// none of the columns returned here match it, so every field named in this
// header really does survive to the caller. Nothing below is silently dropped.

import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import {
  ROLE_SETS, requireRole, isUuid, pageParams, page, readDays
} from "../../src/http/read-api.mjs";
import { dbDown } from "../../src/http/db-down.mjs";
import { asStaff } from "../../src/partners/rls.mjs";
import { costPerBooked, watchRate } from "../../src/ops/meta-marketing.mjs";
import { AD_ACCOUNT_TZ, adAccountDay } from "../../src/lib/ad-account-day.mjs";

/* ── THE DATE WINDOW ───────────────────────────────────────────────────────

   ad_metrics_daily is one row per ad PER DAY, so summing all of history and
   calling it "spend" answers the wrong question the moment anybody asks about
   last week. ?days= takes the window: default 30, ceiling 365, and a value that
   is not a whole number in range is the caller's mistake — a 400, never quietly
   swapped for 30.

   readDays IS NOT DEFINED HERE. It used to be, as a copy of the one in
   api/read/finance-command.mjs, which is the "two functions doing the same
   thing" bug CLAUDE.md §8 names. The single copy now lives in
   src/http/read-api.mjs beside pageParams and boundedLimit, and both endpoints
   import it. */

/* windowFor — the window as two plain YYYY-MM-DD days, inclusive at both ends.
   days=1 is today only, which is why the subtraction is days - 1. The days are
   the AD ACCOUNT's days (America/Phoenix, src/lib/ad-account-day.mjs), because
   that is how Meta dates every ad_metrics_daily row the money comes from. It
   was UTC, which from 5pm to midnight Arizona time made "today" tomorrow and
   dropped the oldest real day from the window (measured 2026-10-05, 7 days:
   523.79 shown, 606.53 true). A fixed zone still gives two machines the same
   answer. It is returned in the response so a screen never has to guess what
   the numbers cover. */
export function windowFor(days, now = new Date()) {
  const to = adAccountDay(now);
  const from = new Date(new Date(to + "T00:00:00Z").getTime() - (days - 1) * 86400000)
    .toISOString().slice(0, 10);
  return { from, to, days };
}

/* AD_NUMBER_MATCH — THE ONLY PLACE the two sides of the ad-number join are
   compared. See the leading-zero note in the header: numbers, not text, so
   '042' and '42' are one ad. Both columns are CHECKed to one-to-nine digits
   (377:569, 286:116-117), so neither cast can raise.

   KNOWN COST, WRITTEN DOWN RATHER THAN DISCOVERED LATER: casting both sides
   means neither supporting index can be used — idx_caa_org_ad (286:123) and
   ads_fundhub_number_uq (377:575) are both on the TEXT — so the people pass
   scans client_ad_attribution. That is fine at today's row counts and it is not
   worth an expression index now. The durable fix is to normalise the number
   where it is WRITTEN (campaigns/link-asset), not to cast where it is read, and
   that belongs to whoever puts this on a screen people refresh. */
export const AD_NUMBER_MATCH = "a.ad_id::bigint = v.fundhub_ad_number::bigint";

/* The five labels, and the one place their names are written down.

   `column` is interpolated into SQL, so it is a value from THIS frozen map and
   never a value from the query string — the query string only ever picks a key
   out of it.

   `kind` is the matching ad_labels.kind, whose CHECK list is exactly
   script_type / angle / hook / offer (377:318-319). `lane` has no kind and no
   dictionary row, because lane is a database enum (ad_lane, 286:62) and not a
   free-text label. So a lane group's `name` is always null. Stated here rather
   than left to be discovered: it is not a missing row, there is nowhere to put
   one. */
export const LABELS = Object.freeze({
  angle:       Object.freeze({ column: "v.angle_key",   kind: "angle" }),
  hook:        Object.freeze({ column: "v.hook_key",    kind: "hook" }),
  lane:        Object.freeze({ column: "v.lane::text",  kind: null }),
  offer:       Object.freeze({ column: "v.offer_key",   kind: "offer" }),
  script_type: Object.freeze({ column: "v.script_type", kind: "script_type" })
});

export const GROUPS = Object.freeze(Object.keys(LABELS));

/* buildFilters — turn ?angle=&hook=&lane=&offer=&script_type= into WHERE
   fragments. Exported so a test can read the shape without a database.

   Every comparison is against text: v.lane is the ad_lane enum, and casting the
   COLUMN to text (rather than the parameter to ad_lane) means a nonsense lane
   matches nothing instead of raising a cast error the caller would see as a 500. */
export function buildFilters(query = {}, params = []) {
  const where = [];
  const applied = {};
  for (const name of GROUPS) {
    const raw = query[name];
    if (raw == null || String(raw).trim() === "") continue;
    const value = String(raw).trim();
    params.push(value);
    where.push(`${LABELS[name].column} = $${params.length}`);
    applied[name] = value;
  }
  return { where, applied };
}

/* buildQuery — the whole SQL for one request, as a value.

   Exported and pure for the same reason ad-books.mjs exports foldGroups: the
   part most likely to be wrong is the part hardest to see, and this way it can
   be read and asserted on without a database in front of it.

   Returns { sql, params, filters }. Nothing from the query string is ever
   interpolated — the only interpolated fragments are `column` values out of the
   frozen LABELS map above, chosen by a key the caller may pick but not spell. */
export function buildQuery({ orgId, groupBy = null, limit, offset, query = {}, window = null }) {
  const params = [orgId];
  const { where, applied } = buildFilters(query, params);
  const whereSql = ["v.org_id = $1", ...where].join(" AND ");

  // The dictionary's kind is a value from LABELS, never from the caller, but it
  // is still bound as a parameter rather than pasted in — this file should read
  // the same as every other query here, so nobody has to check twice.
  const kind = groupBy ? LABELS[groupBy].kind : null;
  let kindSql = null;
  if (kind) {
    params.push(kind);
    kindSql = `$${params.length}`;
  }

  // The window is bound only for the grouped query, which is the only one that
  // reads a dated table. The list has no date window and must not grow one.
  let fromSql = null;
  let toSql = null;
  if (groupBy && window) {
    params.push(window.from, window.to);
    fromSql = `$${params.length - 1}`;
    toSql = `$${params.length}`;
  }

  // page() decides hasMore by asking for one row more than requested, so both
  // queries below select limit + 1.
  params.push(limit + 1, offset);
  const limitSql = `LIMIT $${params.length - 1} OFFSET $${params.length}`;

  if (!groupBy) {
    /* THE JOIN BACK TO ads IS FOR ONE COLUMN: created_at. The view does not
       carry it, and "newest first" needs a clock. It is an inner join on the
       view's own base-table primary key (ads.id = v.ad_row_id), so it cannot add
       a row and cannot drop one — the row count is identical with or without it.
       ad_row_id is the tie-break because two ads written in the same transaction
       share created_at exactly (DEFAULT now() is transaction time), and without
       a tie-break a row could appear on two pages or on neither. */
    return {
      filters: applied,
      params,
      sql: `SELECT v.*, a.created_at
              FROM v_ad_label_spine v
              JOIN ads a ON a.id = v.ad_row_id
             WHERE ${whereSql}
             ORDER BY a.created_at DESC, v.ad_row_id DESC
             ${limitSql}`
    };
  }

  const { column } = LABELS[groupBy];
  /* The friendly name comes from ad_labels, matched on (org, kind, key) — which
     is that table's unique constraint (377:322), so the LEFT JOIN can match at
     most one row and cannot multiply the group. max() is used only so the name
     does not have to be repeated in GROUP BY.

     RETIRED LABELS STILL SUPPLY THEIR NAME. There is deliberately no retired_at
     filter: retiring a label means "stop offering it to a writer", not "forget
     what it was called". An old ad carrying a retired angle should still read as
     a name and not as a bare key.

     lane joins nothing at all, because lane is the ad_lane enum and has no
     ad_labels row to find — see the LABELS comment above. */
  const nameSelect = kind ? `max(l.name) AS label_name` : `NULL::text AS label_name`;
  const nameJoin = kind
    ? `LEFT JOIN ad_labels l
         ON l.org_id = v.org_id AND l.kind = ${kindSql} AND l.key = ${column}`
    : "";

  /* No window means no money: the grouped query still answers the three
     original questions and simply carries nulls where the numbers would be.
     That branch exists so this function stays callable with the same arguments
     it always took. */
  /* ads_reported_in_window PAIRS THE TWO NUMBERS THAT COVER DIFFERENT PERIODS.
     `ads` counts every ad the label ever had, for all time. `spend_cents` covers
     only the ?days= window. Sitting in one row they read as one fact and they
     are not, so this says how many of those ads actually reported a day inside
     the window. "50 ads, 3 of them reported, spend 3000" cannot be misread the
     way "50 ads, spend 3000" can.

     Named "reported", not "with spend": a day that reported zero spend still
     counts here, because it is still a day somebody told us about. */
  /* THE TWO VIDEO SUMS ARE HERE FOR ONE REASON: hook rate and hold rate.
     They come from the eight columns 378_ad_video_metrics.sql added to
     ad_metrics_daily, and only two of the eight are summed — the two that are
     the tops and bottoms of the two rates anybody actually reads.

     video_continuous_2s_watched is "kept watching past the opening". It is NOT
     a 3-second count; Meta publishes no 3-second field (378's header). Do not
     rename it back on the way out.

     sum() SKIPS NULLS, AND THAT IS THE BEHAVIOUR WE WANT. A group holding one
     video ad and nine photo ads sums to the video ad's number, which is the
     honest "of what was reported". A group holding only photo ads sums to NULL,
     which reaches the caller as a rate of null — not as 0, and not as "0%". */
  const moneySelect = fromSql
    ? `sum(m.spend_cents)         AS spend_cents,
       sum(m.impressions)         AS impressions,
       sum(m.clicks)              AS clicks,
       sum(m.video_continuous_2s_watched) AS video_continuous_2s_watched,
       sum(m.video_p75_watched)   AS video_p75_watched,
       count(m.id)::int           AS ad_days_reported,
       count(DISTINCT m.ad_id)::int AS ads_reported_in_window,
       true                       AS has_window`
    : `NULL::bigint AS spend_cents,
       NULL::bigint AS impressions,
       NULL::bigint AS clicks,
       NULL::bigint AS video_continuous_2s_watched,
       NULL::bigint AS video_p75_watched,
       0::int       AS ad_days_reported,
       0::int       AS ads_reported_in_window,
       false        AS has_window`;

  /* THE MONEY JOIN. LEFT, and never coalesced — an ad with no reported day
     contributes NULL to the sum and a group with no reported day at all sums to
     NULL, which is the honest answer "nobody told us", not "we spent nothing".
     org_id is on the join as well as the ad id: ad_metrics_daily carries its own
     org_id (046:434) and joining without it would trust one column to imply
     another. The date bounds are on the JOIN and not in WHERE, because in WHERE
     they would turn the LEFT JOIN back into an inner one and quietly drop every
     ad that spent nothing in the window. */
  const moneyJoin = fromSql
    ? `LEFT JOIN ad_metrics_daily m
         ON m.ad_id = v.ad_row_id
        AND m.org_id = v.org_id
        AND m.date >= ${fromSql}::date
        AND m.date <= ${toSql}::date`
    : "";

  /* THE PEOPLE PASS. Its own scan, its own GROUP BY, joined back on the label
     key at the very end — see the header for why it cannot share the money
     scan. An INNER join to client_ad_attribution, because a label with nobody
     attributed to it should produce no row here and pick up its zero (or its
     null) in JavaScript, where the "could anyone have been matched at all"
     question is decided in one place.

     A BOOKED PERSON IS NOT A BOOKED CALL. The booking test is exactly the one
     src/ads/store.mjs:68-70 already uses — a bookings row for the same client
     and org whose status is not 'cancelled' — but that function counts
     count(b.id), which is CALLS, and a person who rebooks then counts twice.
     This counts DISTINCT people, and the field is named people_booked so the
     screen cannot mistake one for the other.

     THE WINDOW IS ON THE LEAD'S ARRIVAL, NOT THE BOOKING'S — the same choice
     src/ads/store.mjs:72-73 already made, so the two never disagree. The
     question it answers is "of the people who arrived in these days, how many
     booked", which is the one that pairs with the spend of those same days.

     SPELLED AT TIME ZONE <the ad account's zone> because captured_at is a
     timestamptz and the window is built from the ad account's days (windowFor
     above), so the people and the money cover the same hours. Comparing it to
     a bare date would silently use whatever timezone the database server is
     set to, and the same call would then answer differently on two machines. */
  const peopleCte = fromSql
    ? `WITH people AS (
         SELECT ${column} AS label_key,
                count(DISTINCT a.client_id)::int AS people,
                (count(DISTINCT a.client_id) FILTER (WHERE b.id IS NOT NULL))::int AS people_booked
           FROM v_ad_label_spine v
           JOIN client_ad_attribution a
             ON a.org_id = v.org_id
            AND a.ad_id IS NOT NULL
            AND v.fundhub_ad_number IS NOT NULL
            AND ${AD_NUMBER_MATCH}
           LEFT JOIN bookings b
             ON b.org_id = a.org_id
            AND b.client_id = a.client_id
            AND b.status IS DISTINCT FROM 'cancelled'
          WHERE ${whereSql}
            AND a.captured_at >= (${fromSql}::date)::timestamp AT TIME ZONE '${AD_ACCOUNT_TZ}'
            AND a.captured_at <  (${toSql}::date + 1)::timestamp AT TIME ZONE '${AD_ACCOUNT_TZ}'
          GROUP BY ${column}
       )`
    : "";

  const peopleSelect = fromSql ? `p.people, p.people_booked` : `NULL::int AS people, NULL::int AS people_booked`;
  // IS NOT DISTINCT FROM, not "=", so the unlabelled group (key null) finds its
  // own people row instead of silently losing it to NULL = NULL being unknown.
  const peopleJoin = fromSql
    ? `LEFT JOIN people p ON p.label_key IS NOT DISTINCT FROM g.label_key`
    : "";

  return {
    filters: applied,
    params,
    /* count(DISTINCT v.ad_row_id), NOT count(*). The view holds exactly one row
       per ad, so before the money join the two were the same number — with it,
       count(*) would count ad-days and report an ad that ran for thirty days as
       thirty ads. The ordering is unchanged from before: most ads first, then
       the key. */
    sql: `${peopleCte}
          SELECT g.*, ${peopleSelect}
            FROM (
              SELECT ${column} AS label_key,
                     count(DISTINCT v.ad_row_id)::int AS ads,
                     (count(DISTINCT v.ad_row_id) FILTER (WHERE v.fundhub_ad_number IS NOT NULL))::int
                       AS ads_with_number,
                     ${nameSelect},
                     ${moneySelect}
                FROM v_ad_label_spine v
                ${nameJoin}
                ${moneyJoin}
               WHERE ${whereSql}
               GROUP BY ${column}
            ) g
            ${peopleJoin}
           ORDER BY g.ads DESC, g.label_key ASC NULLS LAST
           ${limitSql}`
  };
}

/* countOrNull — a bigint sum arrives from node-postgres as a STRING, because
   an int8 does not always fit a JavaScript number. NULL must stay NULL: this is
   the money path and CLAUDE.md §12 is explicit that an unknown may never become
   a zero. Cents stay cents — nothing here converts to dollars, and
   src/commissions/money.mjs's fromCents (which returns a string) is deliberately
   not called: whoever draws the screen decides how to show it. */
function countOrNull(v) {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/* shapeGroup — one grouped row, assembled in the one place where "unknown" is
   decided, so no caller has to reason about it twice. */
export function shapeGroup(r) {
  const spendCents = countOrNull(r.spend_cents);

  /* THE VIDEO DROP-OFF, AND THE TWO RATES BUILT ON IT.

     impressions   how many times the ad was shown
     past-opening  how many people kept watching past the opening — Meta's
                   two-continuous-seconds count
     p75 views     how many got three quarters of the way in

     hook rate = past-opening ÷ impressions   did the opening stop them
     hold rate = p75 ÷ past-opening           did the middle keep them

     THESE ARE NOT ADS MANAGER'S NUMBERS AND MUST NOT BE LABELLED AS IF THEY
     WERE. Meta publishes no 3-second field at all, so "hook rate" here is built
     on the two-second count, which is the nearest real one. Same words,
     different arithmetic. 378's header has the whole story.

     BOTH ARE COMPUTED BY watchRate() IN src/ops/meta-marketing.mjs AND NOWHERE
     ELSE. That is the same file costPerBooked lives in and it refuses under the
     same MIN_N_RATE (src/ops/discoveries.mjs:9). There is no second threshold
     and no second definition anywhere — 378's header asked for exactly that,
     because a rate written twice is how two screens end up disagreeing.

     A PHOTO AD HAS NO HOOK RATE. It has no video, so the past-opening count is
     NULL, so the rate is null with a note saying why. Never 0, never "0%". */
  const impressions = countOrNull(r.impressions);
  const videoPastOpening = countOrNull(r.video_continuous_2s_watched);
  const videoP75 = countOrNull(r.video_p75_watched);

  /* TWO things must BOTH be true before a missing people row may be read as a
     real zero, and only one of them used to be checked.

     1. THE PEOPLE PASS RAN AT ALL. buildQuery has a branch with no date window
        (used by nobody through this endpoint today — the handler always builds
        one for grouped mode) where the people CTE is not written and every
        people column comes back NULL. Reading that as 0 would be inventing an
        answer out of a query that never asked the question. has_window is
        selected by buildQuery itself so the row carries the fact, rather than
        the next caller of this exported function having to know it.

     2. SOMEBODY IN THIS GROUP COULD HAVE BEEN MATCHED. If no ad here has our
        number typed in, nobody could be tied to it even in principle, so the
        honest answer is "we cannot tell" and not zero. */
  const windowed = r.has_window === true;
  const matchable = windowed && Number(r.ads_with_number) > 0;
  const people = matchable ? Number(r.people ?? 0) : null;
  const peopleBooked = matchable ? Number(r.people_booked ?? 0) : null;

  return {
    key: r.label_key,
    name: r.label_name,
    ads: r.ads,
    ads_with_number: r.ads_with_number,
    spend_cents: spendCents,
    impressions,
    clicks: countOrNull(r.clicks),
    video_continuous_2s_watched: videoPastOpening,
    video_p75_watched: videoP75,
    hook_rate: watchRate({ numerator: videoPastOpening, denominator: impressions }),
    hold_rate: watchRate({ numerator: videoP75, denominator: videoPastOpening }),
    ad_days_reported: r.ad_days_reported,
    ads_reported_in_window: r.ads_reported_in_window,
    people,
    people_booked: peopleBooked,
    /* One rule about small samples, and it lives in src/ops/meta-marketing.mjs.
       Under MIN_N_RATE booked people it returns a null cost and says why.

       THE ONE CASE THAT IS HANDLED HERE INSTEAD, AND IT IS NOT A SECOND RULE.
       costPerBooked() reads an unknown count as 0 and would answer "Have 0",
       which is a claim. When the booked count is unknown, nobody could be
       counted even in principle, and that is a different sentence — not a
       different threshold. The cost is null either way. The note says WHICH of
       the two reasons it was, because "we never asked" and "no ad here carries
       our number" are different things to go and fix. */
    cost_per_booked_person: peopleBooked == null
      ? {
          status: "INSUFFICIENT",
          cost_cents: null,
          n: null,
          note: windowed
            ? "No ad in this group has our number on it, so nobody can be matched to it. Do not invent a cost."
            : "No date window was asked for, so people were never counted. Do not invent a cost."
        }
      : costPerBooked({ spendCents, bookedN: peopleBooked })
  };
}

/* countPeopleRows — HOW MANY PEOPLE ARRIVED AT ALL IN THIS WINDOW, company-wide,
   ad or no ad.

   THE ZERO THIS EXISTS TO MAKE READABLE. Spend has `ad_days_reported` beside it,
   so "nobody told us" and "we spent nothing" look different. People had nothing
   equivalent: a group could read "0 people booked" whether nobody booked or
   whether we quietly stopped recording where people came from. The row is
   written by src/handlers/client-lifecycle.mjs:273, inside a try/catch that only
   console.warns, so a lead really can land with no attribution row and nothing
   on screen would ever say so.

   ONE NUMBER, FOR THE WHOLE RESPONSE, NOT PER GROUP. A per-group count was
   considered and rejected: client_ad_attribution's primary key is client_id
   (286:95), one row per person, so a per-group "rows seen" would be the very
   same number as `people` and would say nothing new. What a reader actually
   needs is the sanity check — if this is 0 while the business took calls, the
   capture is broken and every zero in the list below is meaningless.

   DELIBERATELY UNFILTERED by label, by ad, and by whether the row carries an ad
   id at all. It is not part of the answer; it is the reason to trust it. */
async function countPeopleRows(tx, orgId, window) {
  const { rows } = await tx.query(
    `SELECT count(*)::int AS n
       FROM client_ad_attribution
      WHERE org_id = $1
        AND captured_at >= ($2::date)::timestamp AT TIME ZONE '${AD_ACCOUNT_TZ}'
        AND captured_at <  ($3::date + 1)::timestamp AT TIME ZONE '${AD_ACCOUNT_TZ}'`,
    [orgId, window.from, window.to]
  );
  return rows[0]?.n ?? null;
}

export default async function handler(req, res, deps = {}) {
  const database = deps.db ?? db;
  // Injectable clock, same as api/read/finance-command.mjs:41, so a test can
  // pin the window instead of racing midnight.
  const clock = deps.now || (() => new Date());

  if (req.method && req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const staff = await requireAuth(req, res, { db: database });
  if (!staff) return;
  if (!requireRole(res, staff, ROLE_SETS.STAFF)) return;

  const orgId = staff.org_id;
  if (!isUuid(orgId)) return res.status(403).json({ ok: false, error: "forbidden" });

  const rawGroupBy = req.query?.group_by;
  const groupBy = rawGroupBy == null || String(rawGroupBy).trim() === ""
    ? null
    : String(rawGroupBy).trim();
  if (groupBy && !GROUPS.includes(groupBy)) {
    return res.status(400).json({
      ok: false,
      error: "invalid_group_by",
      message: `group_by must be one of ${GROUPS.join("|")}`
    });
  }

  // The window is read even for the list, so a bad ?days= is the same 400
  // whichever mode was asked for rather than a value that is wrong in one and
  // ignored in the other.
  const d = readDays(req.query?.days);
  if (d.error) return res.status(400).json({ ok: false, error: "invalid_days", message: d.error });

  // null for the list: it has no date window, and saying so is clearer than
  // returning a window the rows were never filtered by.
  const window = groupBy ? windowFor(d.days, clock()) : null;

  const { limit, offset } = pageParams(req.query || {});
  const { sql, params, filters } = buildQuery({
    orgId, groupBy, limit, offset, query: req.query || {}, window
  });

  try {
    const { rows, peopleRowsInWindow } = await asStaff(async (tx) => ({
      rows: (await tx.query(sql, params)).rows,
      peopleRowsInWindow: window ? await countPeopleRows(tx, orgId, window) : null
    }));

    // Groups are reshaped so the caller reads { key, name, ads, ... } and never
    // has to know that label_key/label_name were aliases dodging a SQL keyword.
    const items = groupBy ? rows.map(shapeGroup) : rows;

    return res.status(200).json({
      ok: true,
      group_by: groupBy,
      filters,
      // What the money numbers cover. Never left for a screen to assume.
      window,
      // The one number that tells a reader whether to believe a zero. See
      // countPeopleRows above.
      people_rows_in_window: peopleRowsInWindow,
      ...page(items, { limit, offset })
    });
  } catch (e) {
    if (dbDown(res, e)) return;
    throw e;
  }
}
