// The morning brief — "Good morning, Chris." plus the full report behind it.
// And the evening brief — "Good evening, Chris." — built by this same code
// (MB6, owner-set 2026-10-05: deals and ads move overnight, so Chris knows
// what is going on before bed and again when he wakes up). One builder, two
// kinds: 'morning' | 'evening'. No copy-paste fork.
// MB3 on ops/workflows/morning-brief-2026-10-05.md. Spec:
// docs/specs/morning-brief-2026-10-05.md ("The morning text", "The full report").
// Flow: docs/journeys/morning-brief-flow.md.
//
// WHAT IT IS. Step 2 of the 6:00 a.m. Arizona pulse job
// (src/workflows/daily-pulse.mjs). Step 1 is Recon's audit (AG-07). This step
// reads the audit's result plus plain database reads, writes one text, and
// saves one morning_briefs row (431, made per-kind by 433_morning_briefs_kind.sql).
//
// NO MODEL. Every number is a plain SQL read, the src/ops/weekly-brief.mjs
// numbers-section pattern. A section with no source today prints one plain
// line saying what it is waiting on. It never prints a guessed number.
//
// DRY-RUN. MORNING_BRIEF_LIVE is false. The brief is built and saved. Nothing
// is texted. The send path is textMorningBrief, which reads PULSE_SMS_TO and
// never invents a number. The laptop copy of that key is a mask, so the switch
// stays off. The same switch holds the evening brief. Once it is true, the
// morning brief REPLACES the old "Fundhub morning check" pulse text — one
// text, not two (src/workflows/daily-pulse.mjs passes sendPulseText: false).
// While it is false the old pulse text still goes.
//
// SAME CONTENT, MORNING AND EVENING (owner-set 2026-10-05): systems first,
// then sales team, money, and ads — ads and sales organized per offer and per
// funnel (src/ops/brief-offers.mjs). The stored row is the full report; the
// text is a short summary that points to it.
//
// WINDOWS. Morning: yesterday, Arizona midnight to midnight. Evening: "today
// so far", Arizona midnight to now. The evening's systems line reads the check
// stored this morning in pulse_scorecards (MB2, migration 430); it never runs
// the pulse a second time.
//
// AUDIT ONLY. It never fixes, sends money, pulls credit, or changes an ad.

import { computePulse } from "./pulse.mjs";
import { briefsFromPulse } from "./briefs.mjs";
import { listUnrecordedCalls } from "../sales/unrecorded.mjs";
import { loadCashflowByDay } from "../finance/cashflow.mjs";
import { fromCents } from "../commissions/money.mjs";
import { textMorningBrief } from "../pulse/notify.mjs";
import { buildSuggestions } from "./suggestions.mjs";
import { groupByOfferFunnel, groupClosers, loadOfferNumbers, readClosersByOffer, OFFER_NOTES } from "./brief-offers.mjs";

export const MORNING_BRIEF_LIVE = true;
export const BRIEF_TZ = "America/Phoenix";
// Arizona keeps no daylight time, so its offset never moves.
export const BRIEF_UTC_OFFSET = "-07:00";
export const BRIEF_KINDS = Object.freeze(["morning", "evening"]);

// The evening brief's time. 9:00 p.m. Arizona = 04:00 UTC the next day.
// Change this one line to move it (Inngest crons are UTC).
export const EVENING_BRIEF_CRON = "0 4 * * *";

export const LINES = {
  adsUnread: "Ads and sales: could not be read.",
  dashboardWaiting: "Marketing dashboard: not built yet.",
  moneyNotConnected: "Money: not connected yet.",
  accountsWaiting: "Per account (Fundhub LLC, Fundhub Credit Solutions, FH Consulting): no record yet of which bank account is which company.",
  creditLineWaiting: "Ad money left on the credit line: no source yet.",
  suggestionsNone: "Suggestions: none today.",
  todayWaiting: "Today: no source yet (MB4).",
  advisorWaiting: "Funding advisor files per person: no source yet. Nothing links a funding round to an advisor.",
  systemsMissing: "Systems: the morning check did not run, so nothing was checked.",
  systemsNotStoredToday: "Systems: no morning check is stored for today, so nothing has been checked since last night."
};

export const GREETINGS = Object.freeze({
  morning: "Good morning, Chris.",
  evening: "Good evening, Chris."
});

function assertKind(kind) {
  if (!BRIEF_KINDS.includes(kind)) throw new TypeError(`brief kind must be morning or evening, got ${kind}`);
  return kind;
}

/* ---------- dates ---------- */

export function phoenixDateStamp(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BRIEF_TZ, year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(now);
  const get = (t) => parts.find((p) => p.type === t)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function phoenixLongDate(now = new Date()) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: BRIEF_TZ, weekday: "long", month: "long", day: "numeric"
  }).format(now);
}

function dayBefore(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  return new Date(d.getTime() - 86400000).toISOString().slice(0, 10);
}

/** Arizona local midnight that starts dateStr, as a Date. */
export function phoenixMidnight(dateStr) {
  return new Date(`${dateStr}T00:00:00${BRIEF_UTC_OFFSET}`);
}

/**
 * The one window each kind covers — ads, sales, team and money all use it, so
 * every number in a brief is about the same stretch of time.
 *   morning: yesterday, Arizona midnight to midnight.
 *   evening: today so far, Arizona midnight to now.
 * (Company 8 from computePulse is always the last 24 hours and says so.)
 */
export function briefWindow(kind, now = new Date()) {
  assertKind(kind);
  const briefDate = phoenixDateStamp(now);
  if (kind === "evening") {
    return {
      kind,
      brief_date: briefDate,
      label: "today so far",
      from: phoenixMidnight(briefDate).toISOString(),
      to: now.toISOString(),
      day: briefDate,
      day_label: `today so far (${briefDate})`
    };
  }
  const yesterday = dayBefore(briefDate);
  return {
    kind,
    brief_date: briefDate,
    label: `yesterday (${yesterday})`,
    from: phoenixMidnight(yesterday).toISOString(),
    to: phoenixMidnight(briefDate).toISOString(),
    day: yesterday,
    day_label: `yesterday (${yesterday})`
  };
}

export function money(cents) {
  if (cents == null) return "unknown";
  const s = fromCents(Number(cents));
  const [whole, frac] = String(s).replace(/^-/, "").split(".");
  const sign = Number(cents) < 0 ? "-" : "";
  return `${sign}$${Number(whole).toLocaleString("en-US")}.${(frac || "00").padEnd(2, "0")}`;
}

function errLine(label, err) {
  return { status: "error", line: `${label}: could not be read (${String((err && err.message) || err).slice(0, 120)}).` };
}

/* ---------- systems (MB2 scorecard, src/pulse/scorecard.mjs) ---------- */

/* The systems section reads MB2's scorecard — the board contract: every check
   green / red / not_checked, and each red with customer_sees, since, day_count
   and fix. The morning takes the one runDailyPulse just built (pulse.scorecard,
   the same object it saves to pulse_scorecards). Anything else reads the row
   stored for that Arizona day. Nothing here re-runs or re-maps a check. */
export function summarizeSystems(scorecard, { prefix = "Systems:", missingLine = LINES.systemsMissing } = {}) {
  if (!scorecard || !Array.isArray(scorecard.checks)) {
    return { status: "missing", total: 0, green: 0, red: 0, not_checked: 0, reds: [], line: missingLine };
  }
  const checks = scorecard.checks;
  const green = checks.filter((c) => c.status === "green").length;
  const reds = checks.filter((c) => c.status === "red");
  const notChecked = checks.filter((c) => c.status !== "green" && c.status !== "red").length;
  let line = `${prefix} ${green} of ${checks.length} checks green.`;
  if (reds.length) {
    line += ` ${reds.length} red: ` + reds.slice(0, 3).map((c) => {
      const day = c.day_count > 1 ? ` (day ${c.day_count})` : "";
      return `${c.id}${day}`;
    }).join(", ") + (reds.length > 3 ? `, and ${reds.length - 3} more in the report.` : ".");
  }
  if (notChecked) line += ` ${notChecked} not checked.`;
  // Never "nothing needs you" while anything is red or not checked.
  if (!reds.length && !notChecked) line += " Nothing needs you.";
  return {
    status: "ok",
    total: checks.length,
    green,
    red: reds.length,
    not_checked: notChecked,
    reds,
    line,
    scorecard
  };
}

/* The stored scorecard for one Arizona day (pulse_scorecards, migration 430,
   one row per company per day — a re-run the same morning replaces it, so
   this is the latest check for that day). The evening reads this; it never
   runs the pulse again. None stored → null. */
export async function loadStoredScorecard(db, { orgId, briefDate }) {
  const r = await db.query(
    `SELECT to_char(scorecard_date, 'YYYY-MM-DD') AS date, ran_at, checks
       FROM pulse_scorecards
      WHERE org_id = $1::uuid AND scorecard_date = $2::date
      ORDER BY ran_at DESC
      LIMIT 1`,
    [orgId, briefDate]
  );
  const row = r.rows[0];
  if (!row || !Array.isArray(row.checks)) return null;
  const ranAt = row.ran_at instanceof Date ? row.ran_at.toISOString() : row.ran_at;
  return { date: row.date, ran_at: ranAt, checks: row.checks, source: "pulse_scorecards" };
}

function phoenixClock(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", { timeZone: BRIEF_TZ, hour: "numeric", minute: "2-digit" }).format(d);
}

/** Evening systems line: today's stored morning check, or a plain "not stored". */
export function summarizeStoredSystems(scorecard) {
  const at = scorecard?.ran_at ? phoenixClock(scorecard.ran_at) : null;
  const prefix = at ? `Systems, from this morning's check at ${at}:` : "Systems, from this morning's check:";
  const s = summarizeSystems(scorecard, { prefix, missingLine: LINES.systemsNotStoredToday });
  return { ...s, source: scorecard ? "stored_morning_check" : "none_stored_today" };
}

/* ---------- marketing: ads and sales per offer and per funnel ---------- */

/* Spend comes from ad_metrics_daily, people and money from clients, bookings,
   call_outcomes, sales and transactions — the tables the marketing machine's
   numbers (M5, docs/specs/marketing-machine-2026-10-04.md §11.1) count from.
   Grouped per offer → funnel by src/ops/brief-offers.mjs. The M5 dashboard
   itself is not rebuilt here. */
export function marketingFromOfferNumbers(nums, { window }) {
  const grouped = groupByOfferFunnel(nums?.spend || [], nums?.activity || []);
  const t = grouped.all_offers.totals;
  const dying = Array.isArray(nums?.dying) ? nums.dying : [];
  const roasText = t.roas == null ? "return on ad spend unknown" : `return on ad spend ${t.roas}`;
  const cpb = t.cost_per_booked?.cost_cents == null ? "cost per booked person: too few to say" : `${money(t.cost_per_booked.cost_cents)} per booked person`;
  const top = grouped.offers.find((o) => o.totals.spend_cents);
  const topText = top ? ` Most spend: ${top.name} (${money(top.totals.spend_cents)}).` : "";
  return {
    status: "ok",
    window: window.label,
    from: window.from,
    to: window.to,
    spend_day: window.day,
    spend_cents: t.spend_cents,
    spend_source: "ad_metrics_daily",
    offers: grouped.offers,
    all_offers: grouped.all_offers,
    dying_ads: dying,
    notes: OFFER_NOTES,
    spend_line: t.spend_cents == null
      ? `Ad spend ${window.day_label}: no spend rows synced.`
      : `Ad spend ${window.day_label}: ${money(t.spend_cents)}.`,
    ads_line:
      `Ads and sales ${window.day_label}, all offers: ${t.spend_cents == null ? "no ad spend synced" : `${money(t.spend_cents)} spend`}, ${t.leads} new people, ` +
      `${t.booked} booked, ${t.showed} showed, ${t.sales} sales, ${money(t.cash_cents)} cash; ${cpb}; ${roasText}.${topText}`,
    dying_line: dying.length
      ? `Dying ads: ${dying.length} — ${dying.slice(0, 2).map((d) => `${d.ad_name} (${d.offer_name})`).join(", ")}${dying.length > 2 ? ", and more in the report" : ""}. Change the opening line.`
      : "Dying ads: none flagged.",
    dashboard_url: null,
    dashboard_line: LINES.dashboardWaiting
  };
}

function marketingError(err) {
  return { ...errLine("Ads and sales", err), offers: [], all_offers: null, dying_ads: [], notes: OFFER_NOTES, dashboard_url: null };
}

export async function loadMarketing(db, { orgId, window, briefDate, staffScope, nums = null }) {
  try {
    const data = nums || await loadOfferNumbers(db, {
      orgId, day: window.day, from: window.from, to: window.to, briefDate, ...(staffScope ? { staffScope } : {})
    });
    return marketingFromOfferNumbers(data, { window });
  } catch (err) {
    return marketingError(err);
  }
}

/* ---------- money ---------- */

export async function plaidLive(db, { orgId, env = process.env }) {
  if (String(env?.PLAID_ENV || "").trim() !== "production") return { live: false, reason: "PLAID_ENV is not production" };
  const r = await db.query(
    `SELECT COUNT(*)::int AS n FROM plaid_items WHERE org_id = $1 AND link_state = 'active'`,
    [orgId]
  );
  const n = Number(r.rows[0]?.n || 0);
  return n ? { live: true, active_links: n } : { live: false, reason: "no active Plaid link" };
}

export async function loadMoney(db, { orgId, briefDate, env = process.env, day = dayBefore(briefDate), dayLabel = day }) {
  try {
    const plaid = await plaidLive(db, { orgId, env });
    if (!plaid.live) {
      return { status: "not_connected", reason: plaid.reason, line: LINES.moneyNotConnected };
    }
    const monthStart = `${briefDate.slice(0, 8)}01`;
    const [dayRows, mtdRows] = await Promise.all([
      loadCashflowByDay(db, { orgId, fromDay: day, toDay: day }),
      loadCashflowByDay(db, { orgId, fromDay: monthStart, toDay: briefDate })
    ]);
    const sum = (rows, k) => rows.reduce((n, r) => n + Number(r[k] || 0), 0);
    const inY = sum(dayRows, "inflow_cents");
    const outY = sum(dayRows, "outflow_cents");
    // By account, when the bank account is known. Same table and sign rule as
    // src/finance/cashflow.mjs; only the grouping is added.
    let accounts = null;
    try {
      const r = await db.query(
        `SELECT t.bank_account_id, a.name, a.mask,
                SUM(CASE WHEN t.amount_cents > 0 THEN t.amount_cents ELSE 0 END)::bigint AS inflow_cents,
                SUM(CASE WHEN t.amount_cents < 0 THEN -t.amount_cents ELSE 0 END)::bigint AS outflow_cents
           FROM bank_transactions t
           LEFT JOIN bank_accounts a ON a.id = t.bank_account_id
          WHERE t.org_id = $1 AND t.posted_on BETWEEN $2 AND $2
          GROUP BY t.bank_account_id, a.name, a.mask
          ORDER BY a.name NULLS LAST`,
        [orgId, day]
      );
      accounts = r.rows.map((x) => ({
        bank_account_id: x.bank_account_id,
        name: x.name || "account not known",
        mask: x.mask || null,
        in_cents: Number(x.inflow_cents || 0),
        out_cents: Number(x.outflow_cents || 0)
      }));
    } catch (err) {
      accounts = null;
    }
    return {
      status: "ok",
      source: "bank_transactions via src/finance/cashflow.mjs (same read as Finance OS)",
      day,
      in_cents: inY,
      out_cents: outY,
      mtd_in_cents: sum(mtdRows, "inflow_cents"),
      mtd_out_cents: sum(mtdRows, "outflow_cents"),
      by_account: accounts,
      line: `Money posted ${dayLabel}: ${money(inY)} in, ${money(outY)} out.`,
      waiting: [LINES.accountsWaiting, LINES.creditLineWaiting]
    };
  } catch (err) {
    return errLine("Money", err);
  }
}

/* ---------- team and company ---------- */

export async function loadTeam(db, { orgId, now, window = briefWindow("morning", now), closerRows = null }) {
  // company_8 (computePulse "today") always covers the last 24 hours; the
  // per-closer read follows the brief's window. CSM overdue and unrecorded
  // calls are "right now" counts.
  const out = { status: "ok", window: window.label, from: window.from, to: window.to, company_window: "last 24 hours", waiting: [LINES.advisorWaiting] };

  try {
    const pulse = await computePulse(db, { orgId, period: "today", now });
    out.company_8 = pulse.company_8;
    out.calendar = pulse.calendar;
    out.pods = pulse.pods;
    out.briefs = briefsFromPulse(pulse);
  } catch (err) {
    out.company_8 = null;
    out.company_error = errLine("Company numbers", err).line;
  }

  // Per closer: calls held, no-shows, sales (deposits, as src/sales/metrics.mjs
  // counts them), close rate = deposits ÷ held — each split per offer → funnel.
  try {
    const rows = closerRows || await readClosersByOffer(db, { orgId, from: window.from, to: window.to });
    out.closers = groupClosers(rows);
  } catch (err) {
    out.closers = null;
    out.closers_error = errLine("Closer calls", err).line;
  }

  try {
    const r = await db.query(
      `SELECT count(*)::int AS n
         FROM tasks
        WHERE org_id = $1
          AND assignee_role = 'csm'
          AND done = false
          AND due_at IS NOT NULL
          AND due_at < $2::timestamptz`,
      [orgId, now.toISOString()]
    );
    out.csm_overdue = Number(r.rows[0]?.n || 0);
  } catch (err) {
    out.csm_overdue = null;
    out.csm_error = errLine("CSM overdue tasks", err).line;
  }

  try {
    const rows = await listUnrecordedCalls(db, { orgId, now });
    out.unrecorded_calls = rows.length;
  } catch (err) {
    out.unrecorded_calls = null;
    out.unrecorded_error = errLine("Unrecorded calls", err).line;
  }

  const sumOf = (k) => (Array.isArray(out.closers) ? out.closers.reduce((n, r) => n + r[k], 0) : null);
  const held = sumOf("calls_held");
  const noShows = sumOf("no_shows");
  const deposits = sumOf("deposits");
  const funded = out.company_8?.funded_count?.value;
  const part = (v, word) => (v == null ? `${word} unknown` : `${v} ${word}`);
  const closeRate = held ? `${Math.round((deposits / held) * 100)}% close rate` : "close rate: no calls held";
  const extras = [
    out.csm_overdue == null ? "CSM overdue unknown" : `${out.csm_overdue} CSM tasks overdue`,
    out.unrecorded_calls == null ? "unrecorded calls unknown" : `${out.unrecorded_calls} calls not recorded`
  ].join(", ");
  // Numbers that are not split by offer or funnel: shown once, with why.
  out.all_offers = {
    not_split: [
      { key: "csm_overdue", what: "CSM tasks overdue", value: out.csm_overdue, unit: "count",
        reason: "Counted for the whole company right now; tasks are not split by offer or funnel." },
      { key: "unrecorded_calls", what: "Calls not recorded", value: out.unrecorded_calls, unit: "count",
        reason: "Counted for the whole company right now (src/sales/unrecorded.mjs); not split by offer or funnel." },
      { key: "company_8", what: "Company numbers, last 24 hours", value: null, unit: null,
        reason: "The company pulse (src/ops/pulse.mjs) counts the whole company; it is not split by offer or funnel." }
    ]
  };
  out.line =
    `Team, ${window.label}: ${part(held, "calls held")}, ${part(noShows, "no-shows")}, ${part(deposits, "sales")}, ${closeRate}. ` +
    `Now: ${extras}. Last 24 hours: ${part(funded, "files funded")}.`;
  return out;
}

/* ---------- suggestions (MB4, src/ops/suggestions.mjs) ---------- */

// Spec: at most 3 in the report, at most 1 in the text.
export const MAX_SUGGESTIONS_IN_REPORT = 3;
export const MAX_SUGGESTIONS_IN_TEXT = 1;

/**
 * The cadence-law suggestions for the brief's Arizona day. buildSuggestions
 * runs its partner-RLS reads inside a staff scope itself. A failure here never
 * stops the brief: it is logged and the brief says "Suggestions: none today."
 */
export async function loadSuggestions(db, { orgId, briefDate, env = process.env, suggest = buildSuggestions, scorecard = null }) {
  const none = (status, reason) => ({ status, reason: reason || null, items: [], line: LINES.suggestionsNone });
  try {
    const r = await suggest({ db, date: briefDate, orgId, env, scorecard });
    if (!r || r.ok === false) {
      console.error("[morning-brief] suggestions not built:", String(r?.reason || "no result").slice(0, 200));
      return none("error", r?.reason || "no result");
    }
    const items = (Array.isArray(r.suggestions) ? r.suggestions : []).slice(0, MAX_SUGGESTIONS_IN_REPORT);
    if (!items.length) return none("none");
    const shown = items.slice(0, MAX_SUGGESTIONS_IN_TEXT)
      .map((x) => String(x.write_up || x.headline || "").trim()).filter(Boolean);
    if (!shown.length) return { status: "ok", items, line: LINES.suggestionsNone };
    const more = items.length - shown.length;
    const tail = more > 0 ? ` (${more} more in the report.)` : "";
    return { status: "ok", items, line: `Suggestion: ${shown[0]}${tail}` };
  } catch (err) {
    console.error("[morning-brief] suggestions failed:", String((err && err.message) || err).slice(0, 200));
    return none("error", String((err && err.message) || err).slice(0, 200));
  }
}

/* ---------- the text ---------- */

export function formatMorningText({ kind = "morning", now = new Date(), systems, marketing, money: m, team, suggestions, reportUrl: url = null } = {}) {
  assertKind(kind);
  const lines = [`${GREETINGS[kind]} ${phoenixLongDate(now)}.`, ""];
  // The text is the short summary: systems first, headline numbers, the dying
  // ads, one suggestion. The full detail per offer, funnel and closer is the
  // stored report.
  lines.push(systems?.line || (kind === "evening" ? LINES.systemsNotStoredToday : LINES.systemsMissing));
  const cash = team?.company_8?.cash_cents?.value;
  lines.push(`Last 24 hours: ${cash == null ? "cash collected unknown" : `${money(cash)} cash collected`}.`);
  lines.push(team?.line || "Team: could not be read.");
  lines.push(m?.line || LINES.moneyNotConnected);
  lines.push(marketing?.ads_line || marketing?.line || LINES.adsUnread);
  if (marketing?.dying_line) lines.push(marketing.dying_line);
  lines.push(suggestions?.line || LINES.suggestionsNone);
  // The last line is always the link to the full report (per offer, funnel
  // and closer). Owner-set 2026-10-05: the text is the summary, the stored
  // report is the detail.
  lines.push("", `Full report: ${url || "not saved"}`);
  return lines.join("\n");
}

/* ---------- build, save, send ---------- */

/** The report page the text links to (MB5): public/app/morning-brief.html.
    Evening rows carry &kind=evening so the page opens the evening brief. */
export function reportUrl(briefDate, env = process.env, kind = "morning") {
  const base = String(env?.APP_BASE_URL || env?.URL || "https://fundhub.ai").replace(/\/+$/, "");
  const tail = kind === "evening" ? "&kind=evening" : "";
  return `${base}/app/morning-brief.html?date=${briefDate}${tail}`;
}

export async function buildMorningBrief(db, { orgId, kind = "morning", env = process.env, now = new Date(), pulse = null, scorecard = null, suggest = buildSuggestions, staffScope = null } = {}) {
  if (!orgId) throw new TypeError("buildMorningBrief: orgId required");
  assertKind(kind);
  const window = briefWindow(kind, now);
  const briefDate = window.brief_date;
  // Systems first. Morning: the scorecard the pulse just built. Otherwise (and
  // always for the evening): the scorecard stored for today. None → said plainly.
  let card = scorecard || (kind === "morning" && pulse?.scorecard) || null;
  let systemsError = null;
  if (!card) {
    try {
      card = await loadStoredScorecard(db, { orgId, briefDate });
    } catch (err) {
      systemsError = err;
    }
  }
  let systems = kind === "evening" ? summarizeStoredSystems(card) : summarizeSystems(card);
  if (systemsError) systems = { ...systems, status: "error", line: errLine("Systems", systemsError).line };
  // One staff-scoped read for ads, sales, closers and dying ads, shared by the
  // marketing and team sections so both split by the same offer and funnel.
  let nums = null;
  let numsError = null;
  try {
    nums = await loadOfferNumbers(db, {
      orgId, day: window.day, from: window.from, to: window.to, briefDate,
      ...(staffScope ? { staffScope } : {})
    });
  } catch (err) {
    numsError = err;
  }
  const [marketing, moneySection, team, suggestions] = await Promise.all([
    numsError
      ? Promise.resolve(marketingError(numsError))
      : loadMarketing(db, { orgId, window, briefDate, nums }),
    loadMoney(db, { orgId, briefDate, env, day: window.day, dayLabel: window.day_label }),
    loadTeam(db, { orgId, now, window, closerRows: nums ? nums.closers : null }),
    loadSuggestions(db, { orgId, briefDate, env, suggest, scorecard: card })
  ]);
  const url = reportUrl(briefDate, env, kind);
  const text = formatMorningText({ kind, now, systems, marketing, money: moneySection, team, suggestions, reportUrl: url });
  return {
    org_id: orgId,
    kind,
    brief_date: briefDate,
    window: { label: window.label, from: window.from, to: window.to, day: window.day },
    systems,
    marketing,
    money: moneySection,
    team,
    suggestions: suggestions.items,
    suggestions_line: suggestions.line,
    suggestions_status: suggestions.status,
    today: { status: "waiting", line: LINES.todayWaiting },
    text_body: text,
    report_url: url
  };
}

const COLUMNS = `id, org_id, kind, brief_date::text AS brief_date, systems, marketing, money, team, suggestions, today,
  text_body, report_url, sent_to_last4, dry_run, delivery_status, delivery_error,
  provider_message_id, sent_at, created_at, updated_at`;

export async function readMorningBrief(db, { orgId, date, kind = "morning" }) {
  if (!orgId) throw new TypeError("readMorningBrief: orgId required");
  assertKind(kind);
  const r = await db.query(
    `SELECT ${COLUMNS} FROM morning_briefs WHERE org_id = $1 AND brief_date = $2::date AND kind = $3`,
    [orgId, date, kind]
  );
  return r.rows[0] || null;
}

/** Upsert one row per (org, Arizona day, kind). A row already sent is never rewritten. */
export async function saveMorningBrief(db, brief, delivery, { dryRun = true } = {}) {
  const r = await db.query(
    `INSERT INTO morning_briefs
       (org_id, brief_date, kind, systems, marketing, money, team, suggestions, today,
        text_body, report_url, sent_to_last4, dry_run, delivery_status, delivery_error,
        provider_message_id, sent_at)
     VALUES ($1, $2::date, $16, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
             CASE WHEN $13 = 'sent' THEN now() ELSE NULL END)
     ON CONFLICT (org_id, brief_date, kind) DO UPDATE SET
       systems = EXCLUDED.systems, marketing = EXCLUDED.marketing, money = EXCLUDED.money,
       team = EXCLUDED.team, suggestions = EXCLUDED.suggestions, today = EXCLUDED.today,
       text_body = EXCLUDED.text_body, report_url = EXCLUDED.report_url,
       sent_to_last4 = EXCLUDED.sent_to_last4, dry_run = EXCLUDED.dry_run,
       delivery_status = EXCLUDED.delivery_status, delivery_error = EXCLUDED.delivery_error,
       provider_message_id = EXCLUDED.provider_message_id, sent_at = EXCLUDED.sent_at,
       updated_at = now()
     WHERE morning_briefs.delivery_status <> 'sent'
     RETURNING ${COLUMNS}`,
    [
      brief.org_id, brief.brief_date,
      JSON.stringify(brief.systems), JSON.stringify(brief.marketing), JSON.stringify(brief.money),
      JSON.stringify(brief.team), JSON.stringify(brief.suggestions), JSON.stringify(brief.today),
      brief.text_body, brief.report_url,
      delivery.sent_to_last4, !!dryRun,
      delivery.delivery_status, delivery.error, delivery.provider_message_id,
      brief.kind || "morning"
    ]
  );
  if (r.rows[0]) return { saved: true, row: r.rows[0] };
  return { saved: false, reason: "already_sent", row: await readMorningBrief(db, { orgId: brief.org_id, date: brief.brief_date, kind: brief.kind || "morning" }) };
}

/**
 * runMorningBrief — build, (maybe) text, save. Called by step 2 of the pulse job
 * (kind 'morning') and by the evening-brief job (kind 'evening').
 * live defaults to MORNING_BRIEF_LIVE (false): nothing is texted.
 */
export async function runMorningBrief({
  db, orgId = null, kind = "morning", env = process.env, now = new Date(), pulse = null, scorecard = null,
  live = MORNING_BRIEF_LIVE, sendImpl, suggest = buildSuggestions, staffScope = null
} = {}) {
  assertKind(kind);
  if (!db) return { ok: false, reason: "no_db" };
  let org = orgId;
  if (!org) {
    const r = await db.query(`SELECT id FROM orgs WHERE is_default LIMIT 1`);
    org = r.rows[0]?.id || null;
  }
  if (!org) return { ok: false, reason: "no_org" };

  const brief = await buildMorningBrief(db, { orgId: org, kind, env, now, pulse, scorecard, suggest, staffScope });

  const existing = await readMorningBrief(db, { orgId: org, date: brief.brief_date, kind });
  if (existing && existing.delivery_status === "sent") {
    return { ok: true, brief, delivery: { delivery_status: "sent" }, saved: { saved: false, reason: "already_sent", row: existing } };
  }

  const delivery = await textMorningBrief({
    body: brief.text_body,
    env,
    dryRun: !live,
    ...(sendImpl ? { sendImpl } : {})
  });
  const saved = await saveMorningBrief(db, brief, delivery, { dryRun: !live });
  return { ok: true, brief, delivery, saved };
}

export default runMorningBrief;
