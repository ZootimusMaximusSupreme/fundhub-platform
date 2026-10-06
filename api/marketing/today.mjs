// GET /api/marketing/today — the Today tab of the Marketing Command Center.
//
// One read that answers Chris's first questions about marketing:
//   - where each flywheel step stands (same words as `npm run flywheel:status`)
//   - the latest ad copy the writer made, and its last few jobs
//   - can "Write ad copy" run right now, and if not, what is missing
//   - ad spend for today, the last 7 days, the 7 days before that, 30 days
//   - when Meta last synced
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
// the ad account and the floor use.

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

export const TIMEZONE = "America/Phoenix";
/** daily: the last 30 Arizona days, oldest first (the sparklines). */
export const DAILY_DAYS = 30;
export const HOUSE_SLUG = "fundhub-house";
export const COPY_PIECES = 10;
export const COPY_JOBS = 5;

/* The spend windows. `back` is how many days before today the window ends;
   `len` is how many days it covers. Both ends are inclusive Arizona days. */
export const SPEND_WINDOWS = Object.freeze([
  { key: "today", back: 0, len: 1 },
  { key: "last_7_days", back: 0, len: 7 },
  { key: "prior_7_days", back: 7, len: 7 },
  { key: "last_30_days", back: 0, len: 30 }
]);

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

/* spendWindows(today) → [{ key, from, to, days }] */
export function spendWindows(today) {
  return SPEND_WINDOWS.map((w) => ({
    key: w.key,
    from: addDays(today, -(w.back + w.len - 1)),
    to: addDays(today, -w.back),
    days: w.len
  }));
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

    // 3. Spend.
    const windows = spendWindows(today);
    const spendRead = await part("spend", (tx) => readSpend(tx, { orgId, windows }));
    let spend = null;
    if (spendRead.ok) {
      spend = { currency: "USD", windows: spendRead.value };
      if (spendRead.value.last_30_days.ad_days === 0) {
        wait("spend", "No ad numbers are saved for the last 30 days.");
      }
    }

    // 4. Last sync.
    const syncRead = await part("last_sync", (tx) => readLastSync(tx, { orgId }));
    const lastSync = syncRead.ok ? syncRead.value : null;
    if (syncRead.ok && !lastSync.meta_synced_at && !lastSync.metrics_synced_at) {
      wait("last_sync", "Meta has never synced for this company.");
    }

    // 5. The M5 numbers (U32). Four parts read side by side, each in its own
    //    short transaction. The counting rules are U20's (src/marketing/metrics.mjs);
    //    which funnel a number belongs to is src/marketing/metrics-rollups.mjs.
    //    Same windows as spend above: whole Arizona days ending today.
    const win = Object.fromEntries(windows.map((x) => [x.key, x]));
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
