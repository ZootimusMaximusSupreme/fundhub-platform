// src/ops/suggestions.mjs — the AI ops suggestions in the morning brief.
//
// WHAT CHRIS ASKED FOR (2026-10-05). "Hey, this thing is breaking" or "we need
// to fix this." He does not have to take them. Nothing changes by itself.
//
// THE LAW. .claude/rules/change-cadence.md (same words in
// .cursor/rules/change-cadence.mdc). Owner-set 2026-10-05 as STARTING DEFAULTS:
// light guardrails, and Chris tunes the numbers later from proven data. Every
// number the law sets lives in CADENCE_DEFAULTS below, in one place, so tuning
// is a one-line change.
//
// HOW A SUGGESTION IS MADE — the src/ops/weekly-brief.mjs pattern:
//   1. Plain database reads. The numbers are right with the model switched off.
//   2. A headline sentence built from those numbers only. No model.
//   3. A short model write-up, grounded only in those numbers. If the model is
//      down or not set up, write_up stays NULL and the headline carries it.
//   4. At most 3 a morning, biggest dollar impact first. Unknown dollar impact
//      (NULL) sorts after every known one — it is never treated as 0.
//   5. A suggestion Chris passed on stays quiet until quiet_until (7 days), unless
//      its numbers get worse.
//
// ONLY RULES WITH A REAL SOURCE ARE BUILT. SKIPPED_RULES says which rules are not
// built yet and why. Never invent a source to fill one in.
//
// READ ONLY ON EVERYTHING BUT ops_suggestions. Nothing here pauses an ad, moves a
// budget, edits a page or sends a message.

import { callModel, liveModelProvider } from "../agents/model.mjs";
import { costPerBooked } from "./meta-marketing.mjs";
import { diesBefore25Percent } from "./watch-curve.mjs";
import { loadCalendar } from "./hire-closer.mjs";
import { asStaff } from "../partners/rls.mjs";

/** The cadence law's numbers. Owner-set 2026-10-05 as starting defaults. */
export const CADENCE_DEFAULTS = Object.freeze({
  maxPerMorning: 3,          // rule 8
  passedQuietDays: 7,        // rule 8
  pageChangeEveryDays: 7,    // rule 6: pages, VSL and copy change weekly, one at a time
  budgetMoveMaxPct: 20,      // rule 5: no more than 20% up or down
  budgetMoveSpacingDays: 3,  // rule 5: one change per ad set every 3 days
  timeZone: "America/Phoenix"
});

/** What each rule says, in the words the suggestion carries. */
export const RULES = Object.freeze({
  fix_broken_same_day: "Rule 2: broken things get fixed the same day.",
  new_ad_verdict: "Rule 3: new ad, no verdict too early.",
  raise_spend_ramp: "Rule 4: raising daily spend follows the ramp — cost per booked call holds for a week, closers are under 90% full, and real sales came in.",
  budget_moves_small: "Rule 5: budget moves are small and slow — one change every 3 days, no more than 20%.",
  page_change_weekly: "Rule 6: pages, VSL and copy change weekly, one change at a time.",
  offer_holds_20_sales: "Rule 7: offers and prices stay put until 20 real sales."
});

/** Rules with no suggestion source in the repo today, and why. */
export const SKIPPED_RULES = Object.freeze([
  {
    rule: "new_ad_verdict",
    why: "No target cost per booked call is stored anywhere. The projection doc says target $30, the ramp says near $33, and Chris said probably around $50. Chris sets one number, then this rule can be built."
  },
  {
    rule: "budget_moves_small",
    why: "Used as a limit inside raise_spend_ramp (at most 20%, and nothing if a budget change was logged in the last 3 days). Not a suggestion of its own. Budget changes made straight in Meta are not logged here."
  },
  {
    rule: "offer_holds_20_sales",
    why: "There is no record of offer or price versions, so sales cannot be counted against the current version."
  },
  {
    rule: "fix_broken_same_day (red pulse checks)",
    why: "Only the dead-letter list (failed_events) feeds this rule today. The daily systems scorecard is being built by MB2; red checks join this rule once it lands."
  }
]);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Today's date in Arizona, YYYY-MM-DD. */
export function phoenixToday(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: CADENCE_DEFAULTS.timeZone, year: "numeric", month: "2-digit", day: "2-digit"
  }).format(now);
}

/** A real calendar date in YYYY-MM-DD, or null. */
export function validDate(value) {
  if (typeof value !== "string" || !DATE_RE.test(value)) return null;
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) return null;
  return value;
}

export function addDays(date, n) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function money(cents) {
  if (cents == null) return "unknown";
  return "$" + (Number(cents) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const num = (v) => (v == null ? null : Number(v));

// Phoenix-day window: [start, end) as timestamptz, both from the brief date.
const PHX = `'${CADENCE_DEFAULTS.timeZone}'`;

/* ── Rule 2: broken things get fixed the same day ─────────────────────────── */

export async function readFailedEvents(db, { orgId, date }) {
  const [counts, top] = await Promise.all([
    db.query(
      `SELECT count(*) FILTER (WHERE status IN ('pending','exhausted'))::int AS open_count,
              count(*) FILTER (WHERE status = 'exhausted')::int AS gave_up_count,
              count(*) FILTER (WHERE status IN ('pending','exhausted')
                                 AND first_seen_at >= ($2::date - 1)::timestamp AT TIME ZONE ${PHX}
                                 AND first_seen_at <  ($2::date)::timestamp AT TIME ZONE ${PHX})::int AS new_yesterday
         FROM failed_events
        WHERE org_id = $1`,
      [orgId, date]
    ),
    db.query(
      `SELECT handler_name, count(*)::int AS n
         FROM failed_events
        WHERE org_id = $1 AND status IN ('pending','exhausted')
        GROUP BY handler_name
        ORDER BY count(*) DESC, handler_name
        LIMIT 1`,
      [orgId]
    )
  ]);
  const c = counts.rows[0] || {};
  const t = top.rows[0] || null;
  return {
    open_count: Number(c.open_count || 0),
    gave_up_count: Number(c.gave_up_count || 0),
    new_yesterday: Number(c.new_yesterday || 0),
    top_handler: t ? t.handler_name : null,
    top_handler_count: t ? Number(t.n) : null
  };
}

export function fixBrokenCandidate(n) {
  if (!n || !(n.open_count > 0)) return null;
  const where = n.top_handler ? ` Most are in ${n.top_handler} (${n.top_handler_count}).` : "";
  return {
    rule: "fix_broken_same_day",
    subject_key: "failed_events",
    headline:
      `${n.open_count} broken step${n.open_count === 1 ? " is" : "s are"} still open on the dead-letter list ` +
      `(${n.new_yesterday} new yesterday, ${n.gave_up_count} out of retries).${where} ` +
      "A repair is fixed today; the cadence wait does not apply.",
    numbers: { ...n, score: n.open_count, source: "failed_events" },
    // What a broken step costs is not measured anywhere. Unknown, not 0.
    dollar_impact_cents: null
  };
}

/* ── Rule 6: pages, VSL and copy change weekly — the dying-ad opening ─────── */

export async function readDyingAds(db, { orgId, date }) {
  const rows = (await db.query(
    `SELECT a.id AS ad_id,
            a.name AS ad_name,
            m.date AS metric_date,
            m.video_plays,
            m.video_p25_watched,
            m.clicks,
            (SELECT COALESCE(sum(d.spend_cents), 0)::bigint
               FROM ad_metrics_daily d
              WHERE d.ad_id = a.id
                AND d.date >= $2::date - 7
                AND d.date <  $2::date) AS spend_7d_cents
       FROM ads a
       JOIN LATERAL (
         SELECT date, video_plays, video_p25_watched, clicks
           FROM ad_metrics_daily
          WHERE ad_id = a.id
            AND video_plays IS NOT NULL
            AND video_p25_watched IS NOT NULL
            AND date < $2::date
          ORDER BY date DESC
          LIMIT 1
       ) m ON true
      WHERE a.org_id = $1
        AND upper(coalesce(a.status, '')) = 'ACTIVE'`,
    [orgId, date]
  )).rows;
  return rows;
}

export function pageChangeCandidates(rows) {
  const out = [];
  for (const r of rows || []) {
    const score = diesBefore25Percent({ plays: r.video_plays, p25: r.video_p25_watched, clicks: r.clicks });
    if (!score.dying) continue;
    const spend = num(r.spend_7d_cents);
    const pct = Math.round(score.rate * 1000) / 10;
    out.push({
      rule: "page_change_weekly",
      subject_key: `ad:${r.ad_id}`,
      headline:
        `${r.ad_name}: ${pct}% of ${score.plays} plays reached the quarter mark, and people are not tapping through. ` +
        `${money(spend)} went into it in the last 7 days. Change the opening line, same body. One change this week.`,
      numbers: {
        ad_id: r.ad_id,
        ad_name: r.ad_name,
        metric_date: r.metric_date instanceof Date ? r.metric_date.toISOString().slice(0, 10) : r.metric_date,
        plays: score.plays,
        reached_25: score.p25,
        reached_25_rate: score.rate,
        clicks: num(r.clicks),
        spend_7d_cents: spend,
        score: spend ?? 0,
        source: "ad_metrics_daily"
      },
      // Money that went into an ad whose opening is failing.
      dollar_impact_cents: spend
    });
  }
  return out;
}

/* ── Rule 4 (with rule 5 as its limit): raise daily spend ─────────────────── */

export async function readSpendRamp(db, { orgId, date }) {
  const row = (await db.query(
    `SELECT
       (SELECT COALESCE(sum(spend_cents), 0)::bigint FROM ad_metrics_daily
         WHERE org_id = $1 AND date >= $2::date - 7  AND date < $2::date)     AS spend_this_week_cents,
       (SELECT COALESCE(sum(spend_cents), 0)::bigint FROM ad_metrics_daily
         WHERE org_id = $1 AND date >= $2::date - 14 AND date < $2::date - 7) AS spend_last_week_cents,
       (SELECT count(DISTINCT client_id)::int FROM events
         WHERE org_id = $1 AND name = 'booking.created' AND client_id IS NOT NULL
           AND created_at >= ($2::date - 7)::timestamp AT TIME ZONE ${PHX}
           AND created_at <  ($2::date)::timestamp     AT TIME ZONE ${PHX})   AS booked_this_week,
       (SELECT count(DISTINCT client_id)::int FROM events
         WHERE org_id = $1 AND name = 'booking.created' AND client_id IS NOT NULL
           AND created_at >= ($2::date - 14)::timestamp AT TIME ZONE ${PHX}
           AND created_at <  ($2::date - 7)::timestamp  AT TIME ZONE ${PHX})  AS booked_last_week,
       (SELECT count(*)::int FROM transactions
         WHERE org_id = $1 AND status IN ('paid','succeeded','complete','completed')
           AND created_at >= ($2::date - 7)::timestamp AT TIME ZONE ${PHX}
           AND created_at <  ($2::date)::timestamp     AT TIME ZONE ${PHX})   AS sales_this_week,
       (SELECT max(created_at) FROM action_log
         WHERE org_id = $1 AND target_type IN ('campaign','ad_set')
           AND (before ? 'budget_cents' OR after ? 'budget_cents')
           AND created_at >= ($2::date - $3::int)::timestamp AT TIME ZONE ${PHX}) AS last_budget_change_at`,
    [orgId, date, CADENCE_DEFAULTS.budgetMoveSpacingDays]
  )).rows[0] || {};
  const calendar = await loadCalendar(db, { orgId, now: new Date(`${date}T12:00:00Z`) });
  return {
    spend_this_week_cents: num(row.spend_this_week_cents),
    spend_last_week_cents: num(row.spend_last_week_cents),
    booked_this_week: Number(row.booked_this_week || 0),
    booked_last_week: Number(row.booked_last_week || 0),
    sales_this_week: Number(row.sales_this_week || 0),
    last_budget_change_at: row.last_budget_change_at || null,
    calendar
  };
}

export function spendRampCandidate(n) {
  if (!n) return null;
  const thisWeek = costPerBooked({ spendCents: n.spend_this_week_cents, bookedN: n.booked_this_week });
  const lastWeek = costPerBooked({ spendCents: n.spend_last_week_cents, bookedN: n.booked_last_week });
  if (thisWeek.status !== "MEASURED" || lastWeek.status !== "MEASURED") return null;
  if (!(n.spend_this_week_cents > 0)) return null;
  // Rule 4, step 1: cost per booked call holds for a week (not higher than last week).
  if (thisWeek.cost_cents > lastWeek.cost_cents) return null;
  // Rule 4, step 2: closers under 90% full (src/ops/hire-closer.mjs, the same 90% line).
  if (!n.calendar || n.calendar.packed !== false) return null;
  // Rule 4, step 3: real sales came in that week.
  if (!(n.sales_this_week > 0)) return null;
  // Rule 5: one budget change every 3 days.
  if (n.last_budget_change_at) return null;

  const avgDaily = Math.round(n.spend_this_week_cents / 7);
  // Rule 5: no more than 20% up.
  const raise = Math.floor((avgDaily * CADENCE_DEFAULTS.budgetMoveMaxPct) / 100);
  if (!(raise > 0)) return null;
  const weekly = raise * 7;
  return {
    rule: "raise_spend_ramp",
    subject_key: "daily_spend",
    headline:
      `Cost per booked person held (${money(thisWeek.cost_cents)} this week, ${money(lastWeek.cost_cents)} last week), ` +
      `${n.sales_this_week} sale${n.sales_this_week === 1 ? "" : "s"} came in, and the closers are under 90% full. ` +
      `Daily spend could go up to 20% (about ${money(raise)} a day on ${money(avgDaily)}).`,
    numbers: {
      spend_this_week_cents: n.spend_this_week_cents,
      spend_last_week_cents: n.spend_last_week_cents,
      booked_this_week: n.booked_this_week,
      booked_last_week: n.booked_last_week,
      cost_per_booked_this_week_cents: thisWeek.cost_cents,
      cost_per_booked_last_week_cents: lastWeek.cost_cents,
      sales_this_week: n.sales_this_week,
      closer_count: n.calendar.closer_count,
      closer_slots_booked_next_5_weekdays: n.calendar.due_at_count,
      closer_90pct_line: n.calendar.threshold,
      avg_daily_spend_cents: avgDaily,
      max_raise_per_day_cents: raise,
      max_raise_pct: CADENCE_DEFAULTS.budgetMoveMaxPct,
      score: weekly,
      source: "ad_metrics_daily, events booking.created, transactions, tasks, action_log"
    },
    // The extra money this move would put in play over one week.
    dollar_impact_cents: weekly
  };
}

/* ── Quiet, cadence and ranking — pure, so they are tested without a db ───── */

/** Biggest dollar impact first; unknown (NULL) after every known one. */
export function rank(candidates, max = CADENCE_DEFAULTS.maxPerMorning) {
  const sorted = [...candidates].sort((a, b) => {
    const da = a.dollar_impact_cents;
    const dbb = b.dollar_impact_cents;
    if (da == null && dbb != null) return 1;
    if (da != null && dbb == null) return -1;
    if (da != null && dbb != null && da !== dbb) return dbb - da;
    return Number(b.numbers?.score ?? 0) - Number(a.numbers?.score ?? 0);
  });
  return sorted.slice(0, max);
}

/**
 * applyQuiet(candidates, latestRows, date)
 * latestRows: the newest earlier row per rule + subject. A passed one keeps that
 * rule + subject quiet until quiet_until, unless its score got worse (higher).
 */
export function applyQuiet(candidates, latestRows, date) {
  const latest = new Map((latestRows || []).map((r) => [`${r.rule}|${r.subject_key}`, r]));
  const shown = [];
  const held = [];
  for (const c of candidates) {
    const prev = latest.get(`${c.rule}|${c.subject_key}`);
    const quietUntil = prev && prev.quiet_until
      ? (prev.quiet_until instanceof Date ? prev.quiet_until.toISOString().slice(0, 10) : String(prev.quiet_until).slice(0, 10))
      : null;
    if (prev && prev.status === "passed" && quietUntil && quietUntil > date) {
      const before = Number(prev.numbers?.score ?? 0);
      const now = Number(c.numbers?.score ?? 0);
      if (!(now > before)) {
        held.push({ rule: c.rule, subject_key: c.subject_key, why: `Chris passed on this. Quiet until ${quietUntil}, and the numbers are not worse.` });
        continue;
      }
    }
    shown.push(c);
  }
  return { shown, held };
}

/** Rule 6: one page or copy change at a time, once a week. */
export function applyPageChangeWindow(candidates, { takenWithinWindow }) {
  const shown = [];
  const held = [];
  let pageChangeKept = false;
  const byDollar = rank(candidates, candidates.length);
  for (const c of byDollar) {
    if (c.rule !== "page_change_weekly") { shown.push(c); continue; }
    if (takenWithinWindow) {
      held.push({ rule: c.rule, subject_key: c.subject_key, why: "A page or copy change was taken in the last 7 days. One change a week." });
      continue;
    }
    if (pageChangeKept) {
      held.push({ rule: c.rule, subject_key: c.subject_key, why: "One page or copy change at a time. A bigger one is ahead of it." });
      continue;
    }
    pageChangeKept = true;
    shown.push(c);
  }
  return { shown, held };
}

/* ── The model write-up ───────────────────────────────────────────────────── */

const WRITE_UP_SYSTEM =
  "You are the Ops / AI COO for Fundhub, a small business-funding company. " +
  "Write 2 or 3 short sentences to Chris, the owner, about ONE suggestion. " +
  "Use ONLY the numbers given. Never invent a number, a name, a cause or a trend. " +
  "Name the rule it comes from. He does not have to take it, and nothing changes by itself. " +
  "5th grade reading level. Under 70 words.";

export async function writeUp(s, { env = process.env, fetchImpl } = {}) {
  if (!liveModelProvider(env)) return null;
  const res = await callModel({
    system: WRITE_UP_SYSTEM,
    user: JSON.stringify({ rule: RULES[s.rule], headline: s.headline, numbers: s.numbers }),
    env,
    fetchImpl,
    maxTokens: 300
  });
  if (res && res.mode === "live" && !res.error && res.text) return String(res.text).trim();
  return null;
}

/* ── Status moves (a person makes them; nothing here calls this by itself) ── */

export async function setSuggestionStatus({ db, orgId, id, status, date }) {
  if (!["open", "taken", "passed"].includes(status)) throw new TypeError("status must be open, taken or passed");
  const day = validDate(date) || phoenixToday();
  const quietUntil = status === "passed" ? addDays(day, CADENCE_DEFAULTS.passedQuietDays) : null;
  const { rows } = await db.query(
    `UPDATE ops_suggestions SET status = $3, quiet_until = $4::date
      WHERE org_id = $1 AND id = $2
      RETURNING id, org_id, brief_date::text AS brief_date, rule, subject_key, headline, numbers,
       dollar_impact_cents, write_up, model_used, status, quiet_until::text AS quiet_until,
       created_at, updated_at`,
    [orgId, id, status, quietUntil]
  );
  return rows[0] || null;
}

/* ── The builder MB3's morning brief calls ────────────────────────────────── */

/**
 * buildSuggestions({ db, date, orgId, env?, fetchImpl?, staffScope? })
 * → { ok, date, suggestions: rows (at most 3), held: [...], skipped_rules: [...] }
 *
 * Reads the numbers, applies the cadence law, keeps at most 3, writes them to
 * ops_suggestions (one row per rule + subject per morning; re-running the same
 * morning updates, it never adds a second row and never changes status).
 */
export async function buildSuggestions({
  db, date, orgId, env = process.env, fetchImpl, staffScope = asStaff
} = {}) {
  if (!db) throw new TypeError("buildSuggestions: db required");
  if (!orgId) return { ok: false, reason: "org_id_required" };
  const day = date == null ? phoenixToday() : validDate(date);
  if (!day) return { ok: false, reason: "date_must_be_yyyy_mm_dd" };

  // ads, ad_metrics_daily and action_log carry partner row-level security
  // (046). As the app role with no actor stamped they read as EMPTY, not as an
  // error — so those reads run inside a staff scope (src/partners/rls.mjs).
  const [failed, [dying, ramp], latest, taken] = await Promise.all([
    readFailedEvents(db, { orgId, date: day }),
    staffScope(async (tx) => [
      await readDyingAds(tx, { orgId, date: day }),
      await readSpendRamp(tx, { orgId, date: day })
    ]),
    db.query(
      `SELECT DISTINCT ON (rule, subject_key) rule, subject_key, status, quiet_until::text AS quiet_until, numbers
         FROM ops_suggestions
        WHERE org_id = $1 AND brief_date < $2::date
        ORDER BY rule, subject_key, brief_date DESC`,
      [orgId, day]
    ).then((r) => r.rows),
    db.query(
      `SELECT count(*)::int AS n
         FROM ops_suggestions
        WHERE org_id = $1 AND rule = 'page_change_weekly' AND status = 'taken'
          AND brief_date > $2::date - $3::int AND brief_date < $2::date`,
      [orgId, day, CADENCE_DEFAULTS.pageChangeEveryDays]
    ).then((r) => Number(r.rows[0]?.n || 0))
  ]);

  const candidates = [
    fixBrokenCandidate(failed),
    ...pageChangeCandidates(dying),
    spendRampCandidate(ramp)
  ].filter(Boolean);

  const quiet = applyQuiet(candidates, latest, day);
  const windowed = applyPageChangeWindow(quiet.shown, { takenWithinWindow: taken > 0 });
  const chosen = rank(windowed.shown);
  const overflow = windowed.shown.filter((c) => !chosen.includes(c)).map((c) => ({
    rule: c.rule, subject_key: c.subject_key, why: "At most 3 a morning. Smaller dollar impact."
  }));

  const rows = [];
  for (const s of chosen) {
    const text = await writeUp(s, { env, fetchImpl });
    const { rows: saved } = await db.query(
      `INSERT INTO ops_suggestions
         (org_id, brief_date, rule, subject_key, headline, numbers, dollar_impact_cents, write_up, model_used)
       VALUES ($1, $2::date, $3, $4, $5, $6::jsonb, $7, $8, $9)
       ON CONFLICT (org_id, brief_date, rule, subject_key) DO UPDATE SET
         headline = EXCLUDED.headline,
         numbers = EXCLUDED.numbers,
         dollar_impact_cents = EXCLUDED.dollar_impact_cents,
         write_up = EXCLUDED.write_up,
         model_used = EXCLUDED.model_used
       RETURNING id, org_id, brief_date::text AS brief_date, rule, subject_key, headline, numbers,
                 dollar_impact_cents, write_up, model_used, status, quiet_until::text AS quiet_until,
                 created_at, updated_at`,
      [orgId, day, s.rule, s.subject_key, s.headline, JSON.stringify(s.numbers),
        s.dollar_impact_cents, text, text != null]
    );
    const row = saved[0];
    rows.push({
      ...row,
      dollar_impact_cents: row.dollar_impact_cents == null ? null : Number(row.dollar_impact_cents),
      rule_text: RULES[s.rule]
    });
  }

  return {
    ok: true,
    date: day,
    suggestions: rows,
    held: [...quiet.held, ...windowed.held, ...overflow],
    skipped_rules: SKIPPED_RULES
  };
}

export default { buildSuggestions, setSuggestionStatus, CADENCE_DEFAULTS, RULES, SKIPPED_RULES };
