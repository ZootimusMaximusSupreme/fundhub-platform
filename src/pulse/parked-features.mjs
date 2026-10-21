// Parked features — owner answers B6 and B8 (Set B, 2026-10-20, final).
//
// Chris: Meta ad sync, Company Brain, Lendflow webhooks, iPhone push and AI bureau
// calling are FUTURE features. He knows. Stop the reminders. They are NOT turned
// off (owner rule: features stay on); they are simply not set up yet. Lendflow is
// paused by the owner and not in use.
//
// Measured on the live 6 a.m. scorecard of 2026-10-20: Company Brain
// (brain:embed-key) and iPhone push (native-push:configured, the native-push beat)
// are GREEN on the server, so nothing of theirs is parked here. The rows that were
// red or not checked for the other three are on the list below.
//
// How a parked row works. The real check still runs every morning, unchanged.
// When it comes back red or skip, parkRow() asks ONE read-only question: is this
// feature still not in use? If yes, the row becomes "nothing to judge" with a code
// (feature-not-set-up or owner-paused, src/pulse/na-conditions.mjs) and the audit
// asks the same question again on every run (verifyNa -> parkedState). The day the
// feature is in use the answer is no: the producer keeps its real red, and an old
// claim lands as "not checked", which is red. A read that fails never parks.
//
// "Not in use", per feature, from what the database and the server settings show:
//   meta-ads      no Meta ad is running (ad, ad set and campaign all ACTIVE) and no
//                 ad delivered (impressions or spend) in the last 7 days.
//   bureau-calls  no real (non-demo, non-synthetic) inquiry case has a bureau call
//                 due or placed, and no inquiry_bureau call was ever recorded.
//   lendflow      LENDFLOW_WEBHOOK_SECRET and LENDFLOW_API_KEY are both unset (or a
//                 row of asterisks) on the server, and no Lendflow webhook was ever
//                 received.
// Every read needs the staff view (ctx.scope, asStaff on the server): these tables
// are row-security and can read empty on the plain app role.
//
// READ ONLY. One SELECT per question. Nothing here writes, sends or calls out.

export const PARKED_ON = "2026-10-20";
export const PARK_DELIVERY_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

export const PARKED_FEATURES = Object.freeze({
  "meta-ads": Object.freeze({
    code: "feature-not-set-up",
    what: "Meta ad sync",
    // The machine rows (src/pulse/machine.mjs). No lane prefix.
    rows: Object.freeze([/^meta-sync$/, /^meta-server-events$/]),
    sql: `
      /* parked:meta-ads */
      SELECT (SELECT count(*)::int
                FROM ads a
                JOIN ad_sets s ON s.id = a.ad_set_id
                JOIN campaigns c ON c.id = a.campaign_id
               WHERE upper(coalesce(a.status, '')) = 'ACTIVE'
                 AND upper(coalesce(s.status, '')) = 'ACTIVE'
                 AND upper(coalesce(c.status, '')) = 'ACTIVE') AS running,
             (SELECT count(*)::int
                FROM ad_metrics_daily
               WHERE date >= $1::date
                 AND (impressions > 0 OR spend_cents > 0)) AS delivered`,
    params: (now) => [new Date(now.getTime() - PARK_DELIVERY_DAYS * DAY_MS).toISOString().slice(0, 10)],
    judge(r) {
      const running = count(r.running);
      const delivered = count(r.delivered);
      if (running === null || delivered === null) return { parked: false, why: "the Meta ad counts did not come back" };
      if (running > 0) return { parked: false, why: `${running} Meta ${running === 1 ? "ad is" : "ads are"} running` };
      if (delivered > 0) return { parked: false, why: `Meta ads delivered on ${delivered} ${delivered === 1 ? "row" : "rows"} in ${PARK_DELIVERY_DAYS} days` };
      return { parked: true, why: `no Meta ad is running and none delivered in ${PARK_DELIVERY_DAYS} days` };
    }
  }),

  "bureau-calls": Object.freeze({
    code: "feature-not-set-up",
    what: "AI bureau calling",
    rows: Object.freeze([/^(?:gap-door-batch-jobs:)?catalog-job:jobs\.json:workflow:inquiry-call-sweeper:/]),
    sql: `
      /* parked:bureau-calls */
      SELECT (SELECT count(*)::int
                FROM inquiry_removal_cases irc
               WHERE (irc.call_due_at IS NOT NULL OR irc.call_fired_at IS NOT NULL)
                 AND irc.is_demo IS NOT TRUE
                 AND NOT EXISTS (
                   SELECT 1 FROM clients c
                    WHERE c.id = irc.client_id
                      AND (c.is_demo IS TRUE OR c.custom_fields->>'synthetic' = 'true'))) AS real_calls,
             (SELECT count(*)::int FROM outbound_calls WHERE kind = 'inquiry_bureau') AS placed`,
    params: () => [],
    judge(r) {
      const due = count(r.real_calls);
      const placed = count(r.placed);
      if (due === null || placed === null) return { parked: false, why: "the bureau call counts did not come back" };
      if (due > 0) return { parked: false, why: `${due} real inquiry ${due === 1 ? "case has" : "cases have"} a bureau call due or placed` };
      if (placed > 0) return { parked: false, why: `${placed} AI bureau ${placed === 1 ? "call was" : "calls were"} placed` };
      return { parked: true, why: "no real inquiry case has a bureau call due or placed" };
    }
  }),

  lendflow: Object.freeze({
    code: "owner-paused",
    what: "Lendflow",
    rows: Object.freeze([/^(?:gap-door-batch-webhooks:)?door-batch:webhook-lendflow-contract$/]),
    env: Object.freeze(["LENDFLOW_WEBHOOK_SECRET", "LENDFLOW_API_KEY"]),
    sql: `
      /* parked:lendflow */
      SELECT count(*)::int AS captures FROM webhook_captures WHERE provider = 'lendflow'`,
    params: () => [],
    judge(r) {
      const captures = count(r.captures);
      if (captures === null) return { parked: false, why: "the Lendflow webhook count did not come back" };
      if (captures > 0) return { parked: false, why: `${captures} Lendflow ${captures === 1 ? "webhook was" : "webhooks were"} received` };
      return { parked: true, why: "no Lendflow key is set and no Lendflow webhook was ever received" };
    }
  })
});

export const PARKED_KEYS = Object.freeze(Object.keys(PARKED_FEATURES));

/** The parked feature for a key, or null. An inherited name such as "toString" is not a key. */
export function parkedFeature(key) {
  return typeof key === "string" && Object.hasOwn(PARKED_FEATURES, key) ? PARKED_FEATURES[key] : null;
}

/** A count the read really sent: a finite number, or null. A missing answer is not zero. */
function count(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Unset, empty, or a row of asterisks (the Netlify list placeholder). */
export function unusable(value) {
  if (value === undefined || value === null) return true;
  const s = String(value).trim();
  return s === "" || s.startsWith("*") || /\*{4,}/.test(s);
}

/** The server settings that would mean the feature is set up and are set. [] when none is. */
export function setUpSettings(key, env = process.env) {
  const f = parkedFeature(key);
  if (!f || !Array.isArray(f.env)) return [];
  return f.env.filter((name) => !unusable(env && env[name]));
}

/** Is `rowId` (bare, or with its lane prefix) one this feature parks? */
export function parksRow(key, rowId) {
  const f = parkedFeature(key);
  const id = String(rowId || "");
  return !!f && f.rows.some((re) => re.test(id));
}

/**
 * Is the feature still not in use? READ ONLY. Never throws.
 * ctx: { scope: (fn) => Promise (the staff view), env?, now? }
 * Returns { parked: boolean, why: string }.
 */
export async function parkedState(key, ctx = {}) {
  const f = parkedFeature(key);
  if (!f) return { parked: false, why: `${key} is not a parked feature` };
  try {
    const env = ctx.env && typeof ctx.env === "object" ? ctx.env : process.env;
    const set = setUpSettings(key, env);
    if (set.length) return { parked: false, why: `${set.join(" and ")} ${set.length === 1 ? "is" : "are"} set on the server` };
    // Every table read here is row-security. The plain app role can read it as empty,
    // and empty would look like "not in use". So only the staff view may park a row.
    if (typeof ctx.scope !== "function") {
      return { parked: false, why: "this read needs the staff view, and the run has none" };
    }
    const now = ctx.now instanceof Date && !Number.isNaN(ctx.now.getTime()) ? ctx.now : new Date();
    const res = await ctx.scope((tx) => tx.query(f.sql, f.params(now)));
    return f.judge((res && res.rows && res.rows[0]) || {});
  } catch (err) {
    return { parked: false, why: `the read failed: ${String((err && err.message) || err).slice(0, 80)}` };
  }
}

/**
 * Turn a red or quiet row of a parked feature into "nothing to judge", only while
 * parkedState() says the feature is still not in use. A PASS row, a row of another
 * feature, or a failed read comes back unchanged.
 */
export async function parkRow(row, key, ctx = {}) {
  if (!row || (row.status !== "FAIL" && row.status !== "skip")) return row;
  if (!parksRow(key, row.id)) return row;
  const state = await parkedState(key, ctx);
  if (!state.parked) return row;
  const f = parkedFeature(key);
  const lead = f.code === "owner-paused"
    ? `${f.what} is paused by the owner (${PARKED_ON}) and not in use`
    : `${f.what} is a future feature the owner has not set up yet (${PARKED_ON})`;
  return {
    ...row,
    status: "na",
    detail: `${lead}: ${state.why}. Judged again the day it is in use.`,
    suggestedFix: null,
    na: { code: f.code, args: { feature: key } }
  };
}
