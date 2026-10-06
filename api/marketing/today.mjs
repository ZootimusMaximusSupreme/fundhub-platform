// GET /api/marketing/today — the Today tab of the Marketing Command Center.
//
// One read that answers Chris's first questions about marketing:
//   - where each flywheel step stands (same words as `npm run flywheel:status`)
//   - the latest ad copy the writer made, and its last few jobs
//   - can "Write ad copy" run right now, and if not, what is missing
//   - ad spend for today, the last 7 full days, the 7 days before that, the
//     last 30 full days and the 30 before that
//   - when Meta and ClickFunnels last synced
//   - what the last measured Write offer and Write ad copy runs cost
//   - ADDED BY U32 (spec §8.3 and §11.2), never renaming a key above:
//     numbers (spend, leads, booked, showed, sales, roadmaps, cash, reported
//     cash, ROAS for today / 7 / 30 days), daily (30 days, for the sparklines),
//     spend_by_funnel (7 days, with an Unmapped row), flow (ad -> page -> lead
//     -> call -> sale, 7 days), scripts_waiting, stuck_jobs (each with its job
//     id, so Retry can post marketing/jobs/retry)
// The JSON shape is written down in docs/specs/marketing-today-contract.md.
// The page (public/app/marketing-command-center.*) codes against that file.
//
// READ ONLY. Nothing here writes a row, calls a model or calls Meta.
//
// ROLE GATE — requireAuth, then a SEPARATE requireRole(ROLE_SETS.MARKETING).
// requireAuth ignores a `roles` option (CLAUDE.md §12), so the role check is
// its own line. MARKETING is owner and admin.
//
// RLS — ad_metrics_daily, ad_platform_connections, creative_assets,
// generation_jobs and partner_module_settings all FORCE row-level security. A
// bare query sees zero rows and looks like "no data". Every read runs inside
// asStaff().
//
// A MISSING PART IS NEVER AN ERROR. Each part reads in its own short
// transaction. When a part's table or column is not in the database yet (a
// migration that has not shipped), or its source data is not there (no Meta
// numbers, no flywheel files on this server), that part comes back empty and
// is named in `waiting` with a plain reason. A database that does not answer
// at all is still a 503, and any other fault is still a 500 — hiding a real
// bug behind "waiting" would make it look like a missing feature.
//
// NULL MEANS UNKNOWN. A spend window with no saved ad-days is null, never 0:
// "we have no numbers for those days" is not "we spent nothing". Money is
// integer cents.
//
// "TODAY" IS ARIZONA'S DAY (America/Phoenix, no daylight saving), the same day
// the ad account and the floor use (src/lib/ad-account-day.mjs).
//
// FULL DAYS ONLY in the 7 and 30 day windows. The Meta pull saves through
// yesterday, so a window that ends today always has one empty day in it, and
// "last 7 days" was really 6 days set against a full 7 before it. Every
// multi-day window now ends on the last whole day the numbers cover, so both
// sides of each comparison are whole days, and never on today.
// `spend.through` names that day so the page can say "Numbers through Oct 4".
//
// THE WINDOWS KEEP MOVING WHEN ADS STOP. Meta sends no row for a day no ad ran,
// so the newest saved day (latest_metrics_date) freezes the moment ads stop.
// Ending the windows there would keep calling Sep 28 to Oct 4 "the last 7 days"
// for weeks after the spend went to nothing. So the end day is the LATER of the
// newest saved day and the last whole day the newest Meta pull covered (the day
// before the pull's own Arizona day: the midnight pull on Oct 5 covers Oct 4).
// A window the pull covered but holds no rows stays null, and the page says
// "No ad spend saved for Oct 5 to Oct 11." It is never turned into $0.
//
// COSTS ARE MEASURED, NEVER WRITTEN IN. `costs.offer` is the newest finished
// Write offer run (marketing_jobs, its saved token counts and its own start and
// end times). `costs.copy` is the copy writer's last five model calls
// (partner_ai_usage, purpose 'creative', the house partner). Dollars come from
// src/marketing/model-prices.mjs, which lists only prices with a source. No row,
// or a model with no price on file, is null: the page prints "unknown".

import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { ROLE_SETS, requireRole, isUuid } from "../../src/http/read-api.mjs";
import { dbDown } from "../../src/http/db-down.mjs";
import { asStaff } from "../../src/partners/rls.mjs";
import { phoenixDay } from "../../src/slo/visitor.mjs";
import { flywheelStatus } from "../../src/marketing/flywheel-status.mjs";
import { resolve as resolveProvider } from "../../src/creative/providers/index.mjs";
import { remainingTokens } from "../../src/brand/meter.mjs";
import { readTotals, readDaily } from "../../src/marketing/metrics.mjs";
import {
  spendByFunnel, spendByFunnelView, funnelSteps, flowPageViews,
  readScriptsWaiting, readStuckJobs, numbersFor
} from "../../src/marketing/metrics-rollups.mjs";
import { costOfCalls } from "../../src/marketing/model-prices.mjs";

export const TIMEZONE = "America/Phoenix";
/** daily: the last 30 Arizona days, oldest first (the sparklines). */
export const DAILY_DAYS = 30;
export const HOUSE_SLUG = "fundhub-house";
export const COPY_PIECES = 10;
export const COPY_JOBS = 5;
/* How many of the copy writer's model calls the "about $X a run" line averages. */
export const COPY_COST_RUNS = 5;

/* The spend windows. `today` is Arizona's today and nothing else. Every other
   window ends `back` days before the END DAY (see spendEnd) and covers `len`
   days. Both ends are inclusive Arizona days. */
export const SPEND_WINDOWS = Object.freeze([
  { key: "today", today: true, len: 1 },
  { key: "last_7_days", back: 0, len: 7 },
  { key: "prior_7_days", back: 7, len: 7 },
  { key: "last_30_days", back: 0, len: 30 },
  { key: "prior_30_days", back: 30, len: 30 }
]);

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/* Postgres says "this does not exist (yet)": table, column, function. */
const MISSING_CODES = new Set(["42P01", "42703", "42883"]);
export function isMissingThing(err) {
  return Boolean(err) && MISSING_CODES.has(String(err.code));
}

/* The plain sentence for a part whose table or column is not there yet. */
function missingReason(err) {
  const what = /relation "([^"]+)"/.exec(String(err?.message || ""));
  return what
    ? `The ${what[1]} table is not in the database yet.`
    : "A table or column this part reads is not in the database yet.";
}

/* addDays("2026-10-05", -6) → "2026-09-29". Plain calendar arithmetic on the
   day string, done in UTC so no clock change can move it. */
export function addDays(day, n) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/* spendEnd(today, latest, pulledOn) — the last day the 7 and 30 day windows
   include.

   `latest` is the newest day with saved numbers. `pulledOn` is the Arizona day
   the newest Meta pull ran; that pull covered every whole day before it. The
   end day is the later of `latest` and the day before `pulledOn`, so the
   windows keep moving after ads stop (see the header). Never today or later:
   today is not over, and `today` is its own window. With neither day known it
   is yesterday, the newest day the nightly pull could have saved (the windows
   are all null then anyway, but their dates still read as whole days). */
export function spendEnd(today, latest, pulledOn = null) {
  const yesterday = addDays(today, -1);
  const known = [
    latest,
    typeof pulledOn === "string" && DAY_RE.test(pulledOn) ? addDays(pulledOn, -1) : null
  ].filter((d) => typeof d === "string" && DAY_RE.test(d)).sort();
  if (!known.length) return yesterday;
  const end = known[known.length - 1];
  return end < yesterday ? end : yesterday;
}

/* spendWindows(today, latest, pulledOn) → [{ key, from, to, days }] */
export function spendWindows(today, latest = null, pulledOn = null) {
  const end = spendEnd(today, latest, pulledOn);
  return SPEND_WINDOWS.map((w) => w.today
    ? { key: w.key, from: today, to: today, days: 1 }
    : {
      key: w.key,
      from: addDays(end, -(w.back + w.len - 1)),
      to: addDays(end, -w.back),
      days: w.len
    });
}

/* A bigint arrives from node-postgres as a string. Integer cents, or null. */
function centsOrNull(v) {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}

// ── the reads (exported so the .pg test can run the SQL directly) ──────────

/* readSpend(tx, { orgId, windows }) → { [key]: { from, to, days, spend_cents, ad_days, days_with_data } }

   One pass over ad_metrics_daily. A window with no saved rows sums to NULL in
   SQL, and that NULL is kept. Every partner in the company counts: Chris's
   Meta account is synced under the fundhub-direct partner, not the house one. */
export async function readSpend(tx, { orgId, windows }) {
  const { rows } = await tx.query(
    `SELECT w.key,
            SUM(m.spend_cents)::bigint      AS spend_cents,
            COUNT(m.id)::int                AS ad_days,
            COUNT(DISTINCT m.date)::int     AS days_with_data
       FROM unnest($2::text[], $3::date[], $4::date[]) AS w(key, from_date, to_date)
       LEFT JOIN ad_metrics_daily m
              ON m.org_id = $1
             AND m.date BETWEEN w.from_date AND w.to_date
      GROUP BY w.key`,
    [orgId, windows.map((w) => w.key), windows.map((w) => w.from), windows.map((w) => w.to)]
  );
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const out = {};
  for (const w of windows) {
    const r = byKey.get(w.key) || {};
    const adDays = Number(r.ad_days) || 0;
    out[w.key] = {
      from: w.from,
      to: w.to,
      days: w.days,
      // No rows → unknown. Never 0.
      spend_cents: adDays === 0 ? null : centsOrNull(r.spend_cents),
      ad_days: adDays,
      days_with_data: Number(r.days_with_data) || 0
    };
  }
  return out;
}

/* readSpendEnd(tx, { orgId }) → { latest, metaSyncedAt }

   The newest saved ad-day and the newest Meta pull, read in the same
   transaction as the sums so the windows and the rows agree. */
export async function readSpendEnd(tx, { orgId }) {
  const { rows } = await tx.query(
    `SELECT (SELECT max(date)::text
               FROM ad_metrics_daily
              WHERE org_id = $1) AS spend_end_day,
            (SELECT max(last_synced_at)
               FROM ad_platform_connections
              WHERE org_id = $1 AND platform = 'meta') AS meta_synced_at`,
    [orgId]
  );
  return {
    latest: rows[0]?.spend_end_day ?? null,
    metaSyncedAt: rows[0]?.meta_synced_at ?? null
  };
}

/* The Arizona day a pull ran on, or null. */
function pulledOnDay(at) {
  if (!at) return null;
  const d = at instanceof Date ? at : new Date(at);
  return Number.isNaN(d.getTime()) ? null : phoenixDay(d);
}

/* readSpendAll(tx, { orgId, today }) → { through, windows } */
export async function readSpendAll(tx, { orgId, today }) {
  const { latest, metaSyncedAt } = await readSpendEnd(tx, { orgId });
  const pulledOn = pulledOnDay(metaSyncedAt);
  const windows = spendWindows(today, latest, pulledOn);
  return {
    // Nothing saved ever → null (and "spend" is named in waiting).
    through: latest ? spendEnd(today, latest, pulledOn) : null,
    windows: await readSpend(tx, { orgId, windows })
  };
}

/* readLastSync(tx, { orgId }) → { meta_synced_at, metrics_synced_at, latest_metrics_date } */
export async function readLastSync(tx, { orgId }) {
  const conn = await tx.query(
    `SELECT max(last_synced_at) AS meta_synced_at
       FROM ad_platform_connections
      WHERE org_id = $1 AND platform = 'meta'`,
    [orgId]
  );
  const metrics = await tx.query(
    `SELECT max(synced_at) AS metrics_synced_at, max(date)::text AS latest_metrics_date
       FROM ad_metrics_daily
      WHERE org_id = $1`,
    [orgId]
  );
  return {
    meta_synced_at: conn.rows[0]?.meta_synced_at ?? null,
    metrics_synced_at: metrics.rows[0]?.metrics_synced_at ?? null,
    latest_metrics_date: metrics.rows[0]?.latest_metrics_date ?? null
  };
}

/* readClickfunnelsSync(tx, { orgId }) → the ClickFunnels account's last pull, or null.

   analytics_connections.last_synced_at, which the night pull and a hand pull
   both stamp on success (src/analytics/clickfunnels-org-sync.mjs). Staff-only
   row security (302), so it is read inside asStaff() like every other part. */
export async function readClickfunnelsSync(tx, { orgId }) {
  const { rows } = await tx.query(
    `SELECT max(last_synced_at) AS clickfunnels_synced_at
       FROM analytics_connections
      WHERE org_id = $1 AND platform = 'clickfunnels'`,
    [orgId]
  );
  return rows[0]?.clickfunnels_synced_at ?? null;
}

function count(v) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : 0;
}

function seconds(from, to) {
  if (!from || !to) return null;
  const ms = new Date(to).getTime() - new Date(from).getTime();
  return Number.isFinite(ms) && ms >= 0 ? Math.round(ms / 1000) : null;
}

/* shapeOfferCost(row) — one finished offer run as the cost line needs it. */
export function shapeOfferCost(row) {
  if (!row) {
    return {
      measured: false, job_id: null, finished_at: null, seconds: null,
      input_tokens: null, output_tokens: null, models: [],
      cost_cents: null, under_one_cent: false, unpriced_models: []
    };
  }
  const usage = row.usage && typeof row.usage === "object" ? row.usage : {};
  const calls = Array.isArray(usage.calls) && usage.calls.length
    ? usage.calls
    : [{ model: null, input_tokens: usage.input_tokens, output_tokens: usage.output_tokens }];
  const cost = costOfCalls(calls);
  const sum = (k) => calls.reduce((a, c) => a + count(c && c[k]), 0);
  return {
    measured: true,
    job_id: row.id,
    finished_at: row.finished_at ?? null,
    // From the moment the writer picked the run up to the moment it finished.
    seconds: seconds(row.claimed_at, row.finished_at),
    input_tokens: usage.input_tokens != null ? count(usage.input_tokens) : sum("input_tokens"),
    output_tokens: usage.output_tokens != null ? count(usage.output_tokens) : sum("output_tokens"),
    models: [...new Set(calls.map((c) => c && c.model).filter(Boolean))],
    cost_cents: cost.cents,
    under_one_cent: cost.exact_cents !== null && cost.exact_cents > 0 && cost.cents === 0,
    unpriced_models: cost.unpriced
  };
}

/* readOfferCost(tx, { orgId }) — the newest finished Write offer run that saved
   its token counts (marketing_jobs.result.usage, src/marketing/offer-generator.mjs). */
export async function readOfferCost(tx, { orgId }) {
  const { rows } = await tx.query(
    `SELECT id, claimed_at, finished_at, result->'usage' AS usage
       FROM marketing_jobs
      WHERE org_id = $1 AND kind = 'offer' AND status = 'done'
        AND jsonb_typeof(result->'usage') = 'object'
      ORDER BY finished_at DESC NULLS LAST, created_at DESC
      LIMIT 1`,
    [orgId]
  );
  return shapeOfferCost(rows[0] || null);
}

/* shapeCopyCost(rows) — the copy writer's newest model calls, averaged. */
export function shapeCopyCost(rows) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) {
    return {
      runs: 0, last_at: null, models: [], avg_input_tokens: null, avg_output_tokens: null,
      avg_cost_cents: null, under_one_cent: false, unpriced_models: []
    };
  }
  const costs = list.map((r) => costOfCalls([{ model: r.model, input_tokens: r.input_tokens, output_tokens: r.output_tokens }]));
  const unpriced = [...new Set(costs.flatMap((c) => c.unpriced))];
  const exact = unpriced.length ? null : costs.reduce((a, c) => a + c.exact_cents, 0) / list.length;
  const avg = (k) => Math.round(list.reduce((a, r) => a + count(r[k]), 0) / list.length);
  return {
    runs: list.length,
    last_at: list[0].created_at ?? null,
    models: [...new Set(list.map((r) => r.model).filter(Boolean))],
    avg_input_tokens: avg("input_tokens"),
    avg_output_tokens: avg("output_tokens"),
    avg_cost_cents: exact === null ? null : Math.round(exact),
    under_one_cent: exact !== null && exact > 0 && Math.round(exact) === 0,
    unpriced_models: unpriced
  };
}

/* readCopyCost(tx, { partnerId }) — what the copy writer (src/creative/providers/
   copy.mjs) recorded for its last few calls. purpose 'creative' is written by
   that provider and nothing else. */
export async function readCopyCost(tx, { partnerId }) {
  const { rows } = await tx.query(
    `SELECT created_at, input_tokens, output_tokens, model
       FROM partner_ai_usage
      WHERE partner_id = $1 AND purpose = 'creative'
      ORDER BY created_at DESC, id DESC
      LIMIT $2`,
    [partnerId, COPY_COST_RUNS]
  );
  return shapeCopyCost(rows);
}

/* readHousePartner(tx, { orgId }) → { id, org_id } | null */
export async function readHousePartner(tx, { orgId }) {
  const { rows } = await tx.query(
    `SELECT id, org_id FROM partners WHERE org_id = $1 AND slug = $2 LIMIT 1`,
    [orgId, HOUSE_SLUG]
  );
  return rows[0] || null;
}

/* readCopy(tx, { partnerId }) → { pieces, jobs }

   pieces: the newest copy the writer saved, with its screen result. Archived
   pieces are left out. jobs: the newest copy jobs, with status and error, so a
   failed press shows its reason. */
export async function readCopy(tx, { partnerId }) {
  const pieces = await tx.query(
    `SELECT a.id, a.created_at, a.compliance_state, a.blocked_reasons, a.copy_text,
            a.provider, a.script_id, j.job_id
       FROM creative_assets a
       LEFT JOIN LATERAL (
         SELECT ga.job_id FROM generation_job_assets ga
          WHERE ga.asset_id = a.id
          ORDER BY ga.job_id LIMIT 1
       ) j ON true
      WHERE a.partner_id = $1 AND a.kind = 'copy' AND a.archived_at IS NULL
      ORDER BY a.created_at DESC, a.id DESC
      LIMIT $2`,
    [partnerId, COPY_PIECES]
  );
  const jobs = await tx.query(
    `SELECT id, status, provider, error, attempt, cost_cents,
            spec->>'prompt' AS prompt, spec->>'offerType' AS offer_type,
            created_at, started_at, finished_at
       FROM generation_jobs
      WHERE partner_id = $1 AND spec->>'assetKind' = 'copy'
      ORDER BY created_at DESC, id DESC
      LIMIT $2`,
    [partnerId, COPY_JOBS]
  );
  return { pieces: pieces.rows, jobs: jobs.rows };
}

/* An env value with an asterisk in it is the hidden copy Netlify prints, not a
   key (src/agents/model.mjs isMasked). Names only, never values. */
function keyState(value) {
  if (!value) return { ok: false, why: "not set" };
  if (String(value).includes("*")) return { ok: false, why: "a hidden copy (asterisks), not the key" };
  return { ok: true, why: null };
}

/* readCopyReady(tx, { orgId, partnerId, env }) → { ready, checks, missing }

   The same three things api/creative/generate.mjs and the runner need, asked
   the same way: the house partner's marketing switch and writing budget
   (src/brand/meter.mjs), a copy writer row (the runner's own resolve()), and
   the Anthropic key copy.mjs refuses to run without. */
export async function readCopyReady(tx, { orgId, partnerId, env = process.env }) {
  const checks = [];

  const budget = await remainingTokens(tx, partnerId);
  checks.push({
    key: "marketing_switch",
    ok: budget.enabled === true,
    label: "The marketing switch is on for the house partner.",
    missing: "The marketing switch is off for the house partner."
  });

  let provider = { ok: true, missing: null };
  try {
    await resolveProvider(tx, { orgId, assetKind: "copy" });
  } catch (err) {
    const text = String(err?.message || err || "");
    if (/no active provider configured/i.test(text)) {
      provider = { ok: false, missing: "No copy writer is set up for this company." };
    } else if (/has no module/i.test(text)) {
      provider = { ok: false, missing: "The copy writer on file is one this system does not know how to use." };
    } else {
      throw err;
    }
  }
  checks.push({
    key: "copy_provider",
    ok: provider.ok,
    label: "A copy writer is set up for this company.",
    missing: provider.missing
  });

  const key = keyState(env.ANTHROPIC_API_KEY);
  checks.push({
    key: "anthropic_key",
    ok: key.ok,
    label: "The Anthropic key (ANTHROPIC_API_KEY) is set.",
    missing: key.ok ? null : `The Anthropic key (ANTHROPIC_API_KEY) is ${key.why}.`
  });

  checks.push({
    key: "writing_budget",
    ok: budget.remaining > 0,
    label: "This month's writing budget has room.",
    missing: `This month's writing budget is used up (${budget.used} of ${budget.cap} tokens).`,
    used: budget.used,
    cap: budget.cap
  });

  return shapeReady(checks);
}

/* Every check passed → ready true. One failed → false, with its sentence. */
function shapeReady(checks) {
  const out = checks.map((c) => ({ ...c, missing: c.ok ? null : c.missing }));
  return {
    ready: out.every((c) => c.ok),
    checks: out,
    missing: out.filter((c) => !c.ok).map((c) => c.missing)
  };
}

// ── the handler ─────────────────────────────────────────────────────────────

export default async function handler(req, res, deps = {}) {
  const database = deps.db ?? db;
  const auth = deps.requireAuth ?? requireAuth;
  const staffScope = deps.asStaff ?? asStaff;
  const env = deps.env ?? process.env;
  const readFlywheel = deps.flywheel ?? flywheelStatus;
  const now = deps.now ? deps.now() : new Date();

  if (req.method && req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const staff = await auth(req, res, { db: database });
  if (!staff) return;
  if (!requireRole(res, staff, ROLE_SETS.MARKETING)) return;

  // The session's company, never one from the query string.
  const orgId = staff.org_id;
  if (!isUuid(orgId)) return res.status(403).json({ ok: false, error: "forbidden" });

  const today = phoenixDay(now);
  const waiting = [];
  const wait = (part, reason) => waiting.push({ part, reason });

  /* part — one read in its own transaction. A missing table or column becomes
     `waiting`; anything else is thrown to the catch below. */
  const part = async (name, fn) => {
    try {
      return { ok: true, value: await staffScope(fn) };
    } catch (err) {
      if (!isMissingThing(err)) throw err;
      wait(name, missingReason(err));
      return { ok: false, value: null };
    }
  };

  /* quietPart — the same, for parts that read side by side: the "waiting"
     line is handed back instead of pushed, so the order stays fixed. */
  const quietPart = async (name, fn) => {
    try {
      return { name, ok: true, value: await staffScope(fn), reason: null };
    } catch (err) {
      if (!isMissingThing(err)) throw err;
      return { name, ok: false, value: null, reason: missingReason(err) };
    }
  };

  try {
    // 1. Flywheel — files, not the database.
    let flywheel = null;
    try {
      flywheel = readFlywheel();
      if (!flywheel) wait("flywheel", "The flywheel files (marketing/flywheel/) are not on this server.");
    } catch (err) {
      flywheel = null;
      wait("flywheel", `The flywheel files could not be read: ${String(err?.message || err).slice(0, 160)}`);
    }

    // 2. The house partner, then its copy and whether copy can be written.
    const house = await part("copy", (tx) => readHousePartner(tx, { orgId }));
    const partnerId = house.value ? house.value.id : null;

    let copy = null;
    let copyReady = { ready: null, partner_id: partnerId, checks: [], missing: [] };
    if (house.ok && !partnerId) {
      wait("copy", `There is no house partner (slug ${HOUSE_SLUG}) in this company, so there is nobody to write copy for.`);
      copy = { partner_id: null, pieces: [], jobs: [] };
      copyReady = {
        ready: false,
        partner_id: null,
        checks: [{
          key: "house_partner", ok: false,
          label: `The house partner (${HOUSE_SLUG}) exists.`,
          missing: `The house partner (${HOUSE_SLUG}) is missing.`
        }],
        missing: [`The house partner (${HOUSE_SLUG}) is missing.`]
      };
    } else if (partnerId) {
      const read = await part("copy", (tx) => readCopy(tx, { partnerId }));
      copy = read.ok
        ? { partner_id: partnerId, ...read.value }
        : { partner_id: partnerId, pieces: [], jobs: [] };
      const ready = await part("copy_ready", (tx) => readCopyReady(tx, { orgId, partnerId, env }));
      if (ready.ok) copyReady = { partner_id: partnerId, ...ready.value };
    }

    // 3. Spend, in whole days ending on the last whole day the numbers cover.
    const spendRead = await part("spend", (tx) => readSpendAll(tx, { orgId, today }));
    let spend = null;
    if (spendRead.ok) {
      spend = { currency: "USD", through: spendRead.value.through, windows: spendRead.value.windows };
      if (!spendRead.value.through) wait("spend", "No ad numbers are saved yet.");
    }

    // 4. Last sync: Meta, then ClickFunnels in its own transaction so a missing
    //    analytics table cannot blank the Meta times.
    const syncRead = await part("last_sync", (tx) => readLastSync(tx, { orgId }));
    const cfRead = await part("clickfunnels", (tx) => readClickfunnelsSync(tx, { orgId }));
    const lastSync = syncRead.ok
      ? { ...syncRead.value, clickfunnels_synced_at: cfRead.ok ? cfRead.value : null }
      : null;
    if (syncRead.ok && !lastSync.meta_synced_at && !lastSync.metrics_synced_at) {
      wait("last_sync", "Meta has never synced for this company.");
    }

    // 5. What the last measured runs cost. Each in its own transaction: the
    //    marketing_jobs table ships with the offer writer and may be missing.
    const offerCost = await part("costs", (tx) => readOfferCost(tx, { orgId }));
    // No house partner: nobody has written copy, so nothing is measured (runs 0).
    // The house partner could not be looked up at all: unknown (null).
    const copyCost = partnerId
      ? await part("costs", (tx) => readCopyCost(tx, { partnerId }))
      : { ok: house.ok, value: house.ok ? shapeCopyCost([]) : null };
    const costs = {
      offer: offerCost.ok ? offerCost.value : null,
      copy: copyCost.ok ? copyCost.value : null
    };

    // 6. The M5 numbers (U32). Four parts read side by side, each in its own
    //    short transaction. The counting rules are U20's (src/marketing/metrics.mjs);
    //    which funnel a number belongs to is src/marketing/metrics-rollups.mjs.
    //    Same windows as spend above (slice 0): today is Arizona's today, and the
    //    7 and 30 day windows are spend's whole-day windows, ending on
    //    spend.through. When spend could not be read, the same rule with nothing
    //    saved: they end yesterday.
    const win = spendRead.ok
      ? spendRead.value.windows
      : Object.fromEntries(spendWindows(today).map((x) => [x.key, x]));
    const d7 = { from: win.last_7_days.from, to: win.last_7_days.to };
    const m5 = await Promise.all([
      quietPart("numbers", async (tx) => ({
        today: await readTotals(tx, { orgId, from: win.today.from, to: win.today.to, now }),
        d7: await readTotals(tx, { orgId, ...d7, now }),
        d30: await readTotals(tx, { orgId, from: win.last_30_days.from, to: win.last_30_days.to, now }),
        daily: await readDaily(tx, { orgId, days: DAILY_DAYS, now })
      })),
      quietPart("spend_by_funnel", async (tx) => {
        const rollup = await spendByFunnel(tx, { orgId, ...d7 });
        const steps = await funnelSteps(tx, { orgId, ...d7 });
        return { rollup, page_views: flowPageViews(rollup.funnels, steps) };
      }),
      quietPart("scripts_waiting", (tx) => readScriptsWaiting(tx, { orgId, now })),
      quietPart("stuck_jobs", (tx) => readStuckJobs(tx, { orgId }))
    ]);
    for (const p of m5) if (!p.ok) wait(p.name, p.reason);
    const [numbersRead, funnelRead, scriptsRead, jobsRead] = m5;

    const totals = numbersRead.ok ? numbersRead.value : null;
    const numbers = totals
      ? { today: numbersFor(totals.today), d7: numbersFor(totals.d7), d30: numbersFor(totals.d30) }
      : null;
    const daily = totals
      ? totals.daily.map((d) => ({ date: d.day, spend_cents: d.spend_cents, leads: d.leads }))
      : [];
    const flow = totals
      ? {
          // People who opened a funnel's landing page; null when it could not be read.
          page_views: funnelRead.ok ? funnelRead.value.page_views : null,
          // Link clicks on the ads (Meta). null when Meta reported none in the window.
          clicks: totals.d7.link_clicks ?? null,
          leads: numbers.d7.leads,
          booked: numbers.d7.booked,
          showed: numbers.d7.showed,
          sales: numbers.d7.sales
        }
      : null;

    return res.status(200).json({
      ok: true,
      as_of: now.toISOString(),
      today,
      timezone: TIMEZONE,
      waiting,
      flywheel,
      copy,
      copy_ready: copyReady,
      spend,
      last_sync: lastSync,
      costs,
      // ── added by U32 (docs/specs/marketing-machine-api.md shape 7) ──
      numbers,
      daily,
      spend_by_funnel: funnelRead.ok ? spendByFunnelView(funnelRead.value.rollup) : [],
      flow,
      scripts_waiting: scriptsRead.ok ? scriptsRead.value : null,
      stuck_jobs: jobsRead.ok ? jobsRead.value : []
    });
  } catch (err) {
    if (dbDown(res, err)) return;
    throw err;
  }
}
