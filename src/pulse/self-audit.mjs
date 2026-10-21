// Self-audit — the heartbeat checking itself. (Ship 1, piece D, 2026-10-09)
//
// Chris's law: "if something's not checked ever, you have to check it."
// After this, a live thing on the morning report is green, red, or "nothing to
// judge today" with a reason the computer checks again. Anything else turns
// into the single red row `audit:not-checked`.
//
// auditPulse() runs inside the 6 a.m. pulse after the slice fold and before the
// scorecard is built. It needs every row of the run, so it cannot be a gap
// lane (the lanes run in earlier steps and never see the registry or job rows).
//
// What it does, in order:
//   1. Re-checks every `na` ("nothing to judge") row with verifyNa(). A row
//      whose reason is no longer true is replaced by a `skip` row, so it lands
//      not_checked and cannot hide.
//   2. Reads yesterday's morning report row once (audit:briefs-sent).
//   3. Judges the final list: audit:not-checked, audit:na-verified,
//      audit:totals, audit:expected-present, audit:lanes-ran,
//      audit:workflow-coverage, audit:briefs-sent, audit:run-recorder.
//
// audit:run-recorder (Ship 2): is the recorder that makes every wf: row honest still able to
// write, and is it writing? Red when the app role lost INSERT or UPDATE on workflow_runs (the
// no-deploy switch-off was left on), when the table is missing, when the shared Inngest client
// does not list the "Run evidence" add-on, or when workflow events came in the last day and not
// one run was recorded. Without it a switched-off recorder would make every wf: row read
// "nothing to judge" for the wrong reason.
//
// Rules:
//   - Reads only. Never writes, sends, fixes, or calls an AI or a vendor.
//   - Under 3 seconds. The reads run side by side and each has a timer.
//   - Never throws. A bug inside is one red row, audit:crashed, and the input
//     checks come back untouched.
//   - Nothing here reads a repo file at run time (CLAUDE.md section 12: a
//     folder scan ships empty). Every list is imported.
//   - Never changes the rows it was handed. It returns new arrays.
//
// Two helpers from pieces built in the same batch are loaded lazily, on first
// use: verifyNa (src/pulse/na-conditions.mjs) and NOT_LIVE_ROWS
// (src/pulse/coverage/link.mjs). This lets the file run on its own, and tests
// inject both. It does NOT protect the pulse once the pieces are merged:
// scorecard.mjs imports na-conditions.mjs and run-slices.mjs imports link.mjs
// when they load, and this file imports both of those. A syntax error in
// either file stops this file from loading, so the 6 a.m. pulse does not start.
//
// Who folds the 06-briefs:morning-brief claim: THIS file does, inside
// auditPulse (see AUDIT_COVERS). audit:not-checked and audit:totals are judged
// in here, so a fold that came after auditPulse would leave that claim counted
// as not checked. The pulse must add the returned `folded` to its own count.
// (audit:totals also adds it to the number it prints, so that line is right
// either way.) Piece C's pointAuditClaims second fold is not needed for this
// claim; if it runs anyway it finds nothing left to fold.

import { INNGEST_JOBS, CLOCK_JOBS, JOBS } from "./heartbeats.mjs";
import { MACHINE_CHECKS } from "./machine.mjs";
import { PULSE_REGISTRY } from "./registry.mjs";
import { countChecks, phoenixDate, toContractCheck } from "./scorecard.mjs";
import { RUN_EVIDENCE_NAME } from "./run-evidence.mjs";
import { RECEIPTS_GRACE_MS, RECORDER_FUNCTION_ID, START_GRACE_MS } from "./workflow-runs.mjs";
import { GAP_FILES } from "./coverage/modules.mjs";
import { loadGapModules, loadSliceModules, namespaceGapId } from "./coverage/run-slices.mjs";

export const AUDIT_ROW_IDS = Object.freeze({
  notChecked: "audit:not-checked",
  naVerified: "audit:na-verified",
  totals: "audit:totals",
  expectedPresent: "audit:expected-present",
  lanesRan: "audit:lanes-ran",
  workflowCoverage: "audit:workflow-coverage",
  briefsSent: "audit:briefs-sent",
  runRecorder: "audit:run-recorder",
  crashed: "audit:crashed"
});

/* Slice claims an audit row now answers. auditPulse folds each one into the
   audit row (same meaning as foldCoverage: the claim leaves the list and its id
   goes on the audit row's `also`). Only a claim that is still "not checked" is
   folded; a claim that already has a real answer keeps it. */
export const AUDIT_COVERS = Object.freeze({
  [AUDIT_ROW_IDS.briefsSent]: Object.freeze(["06-briefs:morning-brief"])
});

/* The named ids the 6 a.m. pulse always emits (src/pulse/daily-pulse.mjs): the
   five door checks, Recon, unrecorded calls, Gmail, and every machine row. The
   gate messenger is not here: it is a Mac process, so only the Mac's own run has
   its row (owner-set 2026-10-09; the server cannot check what it cannot see). self-audit.test.mjs runs the real pulse and fails if one of
   these is not in it. */
export const NAMED_PULSE_IDS = Object.freeze([
  "health",
  "login",
  "apply",
  "funnel:roadmap-sales",
  "suggestions",
  "recon",
  "unrecorded",
  "gmail",
  ...MACHINE_CHECKS.map((c) => c.id)
]);

// Each started condition gets this long to answer. Waiting for a worker slot does not spend it.
export const AUDIT_BUDGET_MS = 2500;
// The whole self-audit still stops below the 20 second lane limit.
export const AUDIT_HARD_STOP_MS = 15000;
const BRIEFS_READ_MS = 2000;
const NA_CONCURRENCY = 8;
const MAX_IDS = 10;
const DAY_MS = 24 * 60 * 60 * 1000;

/* A lane or step that died leaves one of these as its row's checkId. */
export const LANE_DIED_CHECK_IDS = Object.freeze(["step", "threw", "not-listed", "bad-row"]);
const DIED_WHY = Object.freeze({
  step: "did not finish",
  threw: "stopped with an error, or would not load",
  "not-listed": "is not on the list in modules.mjs",
  "bad-row": "sent back an empty row"
});

const KNOWN_RAW_STATUSES = new Set(["PASS", "FAIL", "NOT_PROVED", "skip", "up", "down", "na", "not checked"]);
const CONTRACT_STATUSES = new Set(["green", "red", "na", "not_checked"]);

export const BRIEFS_SENT_SQL = `
SELECT delivery_status, delivery_error
  FROM morning_briefs
 WHERE brief_date = $2::date
   AND kind = 'morning'
   AND org_id = COALESCE($1::uuid, (SELECT id FROM orgs WHERE is_default LIMIT 1))
 LIMIT 1`;

/* The run recorder, in one read. $1 = the start of the last day, $2 = the event names that start a
   workflow, $3 = events older than this count (the engine has had time), $4 = minutes of grace after the
   receipts marker. Events before the marker never count: nothing was recording yet.
   Fails with 42P01 when the table is missing; checkRunRecorder turns that into a red row. */
export const RUN_RECORDER_SQL = `
WITH began AS (
  SELECT min(started_at) AS at FROM workflow_runs WHERE function_id = '${RECORDER_FUNCTION_ID}'
),
win AS (
  SELECT greatest($1::timestamptz, (SELECT at FROM began) + make_interval(mins => $4::int)) AS from_at
)
SELECT
  has_table_privilege(current_user, 'public.workflow_runs', 'INSERT') AS can_insert,
  has_table_privilege(current_user, 'public.workflow_runs', 'UPDATE') AS can_update,
  (SELECT at FROM began) AS began_at,
  (SELECT count(*)::int FROM workflow_runs r, win
    WHERE r.function_id <> '${RECORDER_FUNCTION_ID}' AND r.started_at > win.from_at) AS runs_n,
  (SELECT count(*)::int FROM events e, win
    WHERE e.name = ANY($2::text[]) AND e.created_at > win.from_at AND e.created_at <= $3::timestamptz) AS events_n`;

const RUN_RECORDER_READ_MS = 2000;

// ── small helpers ────────────────────────────────────────────────────────────

function clip(s, n = 1200) {
  return String(s == null ? "" : s).replace(/\s+/g, " ").trim().slice(0, n);
}

function plural(n, one, many) {
  return n === 1 ? one : many;
}

/* "a, b, c" for the first ten, then "and 4 more". */
function listIds(ids, max = MAX_IDS) {
  const shown = ids.slice(0, max).join(", ");
  const more = ids.length - max;
  return more > 0 ? `${shown}, and ${more} more` : shown;
}

function auditRow(id, status, detail, { fix = null, sees = null } = {}) {
  return {
    id,
    kind: "audit",
    group: "backend",
    status,
    detail: clip(detail),
    suggestedFix: fix,
    customerSees: sees,
    schedule: null
  };
}

const UNWATCHED = "Part of Fundhub is not being watched, so a break there would go unseen.";

function withTimeout(promise, ms) {
  let timer;
  const cut = new Promise((_, reject) => {
    const error = new Error("took too long");
    error.code = "PULSE_NA_TIMEOUT";
    timer = setTimeout(() => reject(error), Math.max(0, ms));
  });
  return Promise.race([Promise.resolve(promise), cut]).finally(() => clearTimeout(timer));
}

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stable(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value === undefined ? null : value);
}

/* A function is a cron when it has a cron trigger and no event trigger. This is
   the same rule as piece B's checkWorkflowRuns (src/pulse/workflow-runs.mjs):
   a pure cron is a `job:` row, everything else is a `wf:` row. A function with
   both kinds of trigger is a `wf:` row. */
function triggersOf(fn) {
  return (fn && fn.opts && Array.isArray(fn.opts.triggers)) ? fn.opts.triggers : [];
}
function fnId(fn) {
  return fn && fn.opts && fn.opts.id ? String(fn.opts.id) : null;
}
function isCronFn(fn) {
  const triggers = triggersOf(fn);
  const hasCron = triggers.some((t) => t && typeof t.cron === "string" && t.cron);
  const hasEvent = triggers.some((t) => t && typeof t.event === "string" && t.event);
  return hasCron && !hasEvent;
}

/** NOT_LIVE_ROWS can be a list of ids, a list of {id, reason}, a map, or a set. */
export function notLiveIds(notLive) {
  if (!notLive) return new Set();
  if (notLive instanceof Set) return new Set([...notLive].map(String));
  if (notLive instanceof Map) return new Set([...notLive.keys()].map(String));
  if (Array.isArray(notLive)) {
    return new Set(
      notLive
        .map((r) => (typeof r === "string" ? r : r && (r.id ?? r.claim)))
        .filter((v) => v != null && v !== "")
        .map(String)
    );
  }
  if (typeof notLive === "object") return new Set(Object.keys(notLive));
  return new Set();
}

function yesterdayPhoenix(now) {
  // Arizona keeps no daylight saving, so 24 hours back is always yesterday.
  return phoenixDate(new Date(now.getTime() - DAY_MS));
}

// ── the manifest: every id the run must contain ──────────────────────────────

/**
 * laneCheckIds — the check ids one gap lane file says it emits. Most lanes export
 * CHECK_IDS. Two lanes name theirs differently, and both are read here:
 *   gap-sms     MSG_CHECK_IDS (5 ids; its journey rows have no list)
 *   gap-funnels GAP_DOORS and GAP_WIDGET_CHECKS (every door and widget check)
 * The other lanes list nothing (a leftover card on the board); audit:lanes-ran
 * still catches one that dies or gives no rows.
 */
export function laneCheckIds(mod) {
  if (!mod || typeof mod !== "object") return [];
  const out = [];
  const take = (list, pick = (x) => x) => {
    if (!Array.isArray(list)) return;
    for (const item of list) {
      const id = pick(item);
      if (typeof id === "string" && id) out.push(id);
    }
  };
  take(mod.CHECK_IDS);
  take(mod.MSG_CHECK_IDS);
  take(mod.GAP_DOORS, (d) => d && d.id);
  take(mod.GAP_WIDGET_CHECKS, (c) => c && c.id);
  return [...new Set(out)];
}

/**
 * buildManifest — pure. Every id the morning run must contain, built only from
 * lists handed in (the live defaults are imported constants).
 *
 * `sliceModules` is the output of loadSliceModules(): [{ sliceId, CHECKS }].
 * `gapModules` is the output of loadGapModules(): [{ sliceId, mod }]. A gap
 * lane that lists its ids (see laneCheckIds) adds those ids; a lane that lists
 * none adds nothing (a leftover, see the manifest note).
 * `notLive` is NOT_LIVE_ROWS: claims that left the scorecard on purpose.
 *
 * Returns { ids: Set<string>, byGroup: { reg, job, wf, slice, gap, named } }.
 */
export function buildManifest({
  registry = PULSE_REGISTRY,
  jobs = JOBS,
  functions = [],
  sliceModules = [],
  gapModules = [],
  namedIds = NAMED_PULSE_IDS,
  notLive = []
} = {}) {
  const skip = notLiveIds(notLive);
  const byGroup = { reg: [], job: [], wf: [], slice: [], gap: [], named: [] };

  for (const r of registry || []) if (r && r.id != null) byGroup.reg.push(`reg:${r.id}`);
  for (const j of jobs || []) if (j && j.job) byGroup.job.push(`job:${j.job}`);
  for (const fn of Array.isArray(functions) ? functions : []) {
    const id = fnId(fn);
    if (id && !isCronFn(fn)) byGroup.wf.push(`wf:${id}`);
  }
  for (const item of sliceModules || []) {
    const sliceId = item && item.sliceId;
    if (!sliceId) continue;
    for (const row of item.CHECKS || []) {
      if (!row || row.id == null || row.id === "load-error") continue;
      const claim = `${sliceId}:${row.id}`;
      if (!skip.has(claim)) byGroup.slice.push(claim);
    }
  }
  for (const item of gapModules || []) {
    const sliceId = item && item.sliceId;
    for (const id of laneCheckIds(item && item.mod)) byGroup.gap.push(namespaceGapId(id, sliceId));
  }
  for (const id of namedIds || []) byGroup.named.push(String(id));

  // One id once. (PULSE_REGISTRY gives four ids to two rows each: audit:totals
  // reports that; the manifest only needs to know the id is expected.)
  for (const group of Object.keys(byGroup)) byGroup[group] = [...new Set(byGroup[group])];
  const ids = new Set(Object.values(byGroup).flat());
  return { ids, byGroup };
}

async function defaultNotLiveRows() {
  const mod = await import("./coverage/link.mjs");
  return mod.NOT_LIVE_ROWS;
}

/**
 * loadManifest — the live manifest. Loads the slice and gap modules the same way
 * the pulse does (named list, no folder scan), then calls buildManifest().
 */
export async function loadManifest({ functions = [], notLiveRows = null, ...rest } = {}) {
  const [sliceModules, gapModules] = await Promise.all([loadSliceModules(), loadGapModules()]);
  const notLive = notLiveRows != null ? notLiveRows : await defaultNotLiveRows();
  return buildManifest({ functions, sliceModules, gapModules, notLive, ...rest });
}

/**
 * makeLaneNaVerify — builds the `laneNaVerify` the audit hands to verifyNa. It
 * finds the lane file by its slice id and calls its exported naVerify[code].
 * Returns undefined when the lane has no verifier (that counts as not true).
 */
export function makeLaneNaVerify({ db = null, scope = null, now = new Date(), gapFiles = GAP_FILES } = {}) {
  const entries = new Map(gapFiles.map(([name, load]) => [name.replace(/\.mjs$/, ""), load]));
  const loaded = new Map();
  const laneName = (sliceId) => {
    const asked = String(sliceId || "").replace(/\.mjs$/, "");
    if (entries.has(asked)) return asked;
    const prefixed = `gap-${asked}`;
    return entries.has(prefixed) ? prefixed : asked;
  };
  const loadLane = (sliceId) => {
    const lane = laneName(sliceId);
    const load = entries.get(lane);
    if (!load) return Promise.resolve(undefined);
    let pending = loaded.get(lane);
    if (!pending) {
      pending = Promise.resolve().then(load);
      loaded.set(lane, pending);
    }
    return pending;
  };
  const laneNaVerify = async (sliceId, code, args) => {
    const mod = await loadLane(sliceId);
    const fn = mod && mod.naVerify && mod.naVerify[code];
    if (typeof fn !== "function") return undefined;
    return fn(args, { db, scope, now });
  };
  laneNaVerify.warm = async (rows = []) => {
    const lanes = new Set(rows.map((row) => row?.sliceId || (typeof row?.id === "string" ? row.id.split(":")[0] : null)).filter(Boolean));
    await Promise.all([...lanes].map(loadLane));
  };
  laneNaVerify.hasLane = (sliceId) => entries.has(laneName(sliceId));
  return laneNaVerify;
}

// ── step 1: "nothing to judge" is checked again ──────────────────────────────

async function defaultVerifyNa() {
  try {
    const mod = await import("./na-conditions.mjs");
    if (typeof mod.verifyNa === "function") return mod.verifyNa;
    return async () => ({ ok: false, reason: "The nothing-to-judge checker has no verifyNa function." });
  } catch (err) {
    const why = clip(err && err.message, 120);
    return async () => ({ ok: false, reason: `The nothing-to-judge checker would not load (${why}).` });
  }
}

/* The `reason` that comes back is the CONDITION in a few words, written so it
   fits "Said nothing to judge, but <reason> is not true." Piece A's verifyNa
   writes it that way ("no ad running", "the reason code "x" being one the
   computer knows"). The three reasons written here use the same shape. */
async function verifyOne(row, ctx, verify, timeoutMs, hardStopAt, hardStopMs) {
  const perCheckMs = Math.max(0, Number(timeoutMs) || 0);
  const hardLeft = hardStopAt - Date.now();
  if (hardLeft <= 0) {
    return {
      ok: false,
      problem: "hard-stop",
      reason: `the audit reached its ${hardStopMs} ms safety stop before this check started`
    };
  }
  const waitMs = Math.min(perCheckMs, hardLeft);
  if (waitMs <= 0) {
    return { ok: false, problem: "timeout", reason: "the check was given no time to answer" };
  }
  const limitedByHardStop = hardLeft < perCheckMs;
  let settled = false;
  const pending = Promise.resolve().then(() => verify(row, ctx));
  pending.then(
    () => { settled = true; },
    () => { settled = true; }
  );
  try {
    const res = await withTimeout(pending, waitMs);
    if (res && typeof res === "object") {
      const ok = res.ok === true;
      return { ok, problem: ok ? null : "stale", reason: clip(res.reason, 200) };
    }
    return { ok: false, problem: "unreadable", reason: "the checker did not give an answer" };
  } catch (err) {
    if (err && err.code === "PULSE_NA_TIMEOUT") {
      const drainMs = Math.min(perCheckMs, Math.max(0, hardStopAt - Date.now()));
      if (!settled && drainMs > 0) {
        try { await withTimeout(pending, drainMs); } catch { /* result stays technical and visible below */ }
      }
      const answer = limitedByHardStop
        ? {
          ok: false,
          problem: "hard-stop",
          reason: `the audit reached its ${hardStopMs} ms safety stop while this check was running`
        }
        : {
          ok: false,
          problem: "timeout",
          reason: `the check did not answer within ${perCheckMs} ms`
        };
      if (!settled) answer.openWork = true;
      return answer;
    }
    return {
      ok: false,
      problem: "unreadable",
      reason: `the read failed: ${clip((err && err.message) || err, 120)}`
    };
  }
}

export function naAuditHasOpenWork(outcome) {
  return outcome instanceof Map && [...outcome.values()].some((result) => result?.openWork === true);
}

/* The memo key for one nothing-to-judge row. A lane code is answered by the lane
   file, and piece A's verifyNa finds the lane from row.sliceId, or else from the
   id before the first ":". The key does the same, so two lanes never share one
   answer. The args go through JSON first, as they do when saved, so a Date and
   its ISO text are one key. A key that cannot be built (args that will not turn
   into JSON) is null, and that row is asked on its own. */
function naKeyOf(row) {
  const na = row.na;
  if (!na || typeof na.code !== "string") return null;
  try {
    const lane = row.sliceId || (typeof row.id === "string" && row.id.includes(":") ? row.id.split(":")[0] : null);
    const args = na.args === undefined ? null : JSON.parse(JSON.stringify(na.args));
    return stable([lane, na.code, args]);
  } catch {
    return null;
  }
}

/* Runs verifyNa for every `na` row. Same code + args + lane = one call. When
   the pulse provides a database or staff scope, every check can reach its one
   client, including checks not owned by a gap lane, so all run one at a time.
   Without a database, only lane checks are serial and pure checks stay bounded
   at eight workers. Each clock starts after its worker slot is acquired. */
async function verifyAllNa(list, { verifyNa, ctx, budgetMs, totalBudgetMs, seededOutcome = null }) {
  const naRows = list.filter((r) => r && r.status === "na");
  const outcome = new Map();
  if (!naRows.length) return outcome;
  const seededHasOpenWork = naAuditHasOpenWork(seededOutcome);
  const seededByKey = new Map();
  if (seededOutcome instanceof Map) {
    for (const [row, result] of seededOutcome) {
      const key = naKeyOf(row);
      if (row && key) seededByKey.set(`${String(row.id)}\n${key}`, result);
    }
  }
  const pendingRows = [];
  for (const row of naRows) {
    const direct = seededOutcome instanceof Map ? seededOutcome.get(row) : null;
    const key = naKeyOf(row);
    const seeded = direct || (key ? seededByKey.get(`${String(row.id)}\n${key}`) : null);
    if (seeded && (seededHasOpenWork || seeded.ok === true || seeded.problem === "stale")) {
      outcome.set(row, seeded);
    } else if (seededHasOpenWork) {
      outcome.set(row, {
        ok: false,
        problem: "blocked",
        reason: "an earlier database check is still running, so this check did not start"
      });
    } else {
      pendingRows.push(row);
    }
  }
  if (!pendingRows.length) return outcome;
  const verify = verifyNa || await defaultVerifyNa();
  const hardStopMs = Math.min(AUDIT_HARD_STOP_MS, Math.max(0, Number(totalBudgetMs) || 0));
  const hardStopAt = Date.now() + hardStopMs;
  if (typeof ctx?.laneNaVerify?.warm === "function") {
    try {
      await withTimeout(ctx.laneNaVerify.warm(pendingRows), Math.max(0, hardStopAt - Date.now()));
    } catch {
      // The real checks below keep the failure visible with the row's exact reason.
    }
  }
  const memo = new Map();
  async function runRows(rows, concurrency, stopAfterTimeout = false) {
    let next = 0;
    async function worker() {
      while (next < rows.length) {
        const row = rows[next++];
        const key = naKeyOf(row);
        let pending = key ? memo.get(key) : null;
        if (!pending) {
          pending = verifyOne(row, ctx, verify, budgetMs, hardStopAt, hardStopMs);
          if (key) memo.set(key, pending);
        }
        const result = await pending;
        outcome.set(row, result);
        if (stopAfterTimeout && ["timeout", "hard-stop"].includes(result?.problem)) {
          while (next < rows.length) {
            outcome.set(rows[next++], {
              ok: false,
              problem: "blocked",
              reason: "an earlier database check timed out, so this check did not start"
            });
          }
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, rows.length) }, worker));
  }
  const serialRows = [];
  const parallelRows = [];
  const hasSharedDatabase = typeof ctx?.scope === "function" || (ctx?.db && typeof ctx.db.query === "function");
  for (const row of pendingRows) {
    const lane = row.sliceId || (typeof row.id === "string" ? row.id.split(":")[0] : "");
    const isLane = typeof ctx?.laneNaVerify?.hasLane === "function"
      ? ctx.laneNaVerify.hasLane(lane)
      : String(lane).startsWith("gap-");
    (hasSharedDatabase || isLane ? serialRows : parallelRows).push(row);
  }
  await Promise.all([
    runRows(serialRows, 1, true),
    runRows(parallelRows, NA_CONCURRENCY)
  ]);
  return outcome;
}

export async function prepareNaAudit(checks, {
  verifyNa = null,
  laneNaVerify = null,
  db = null,
  scope = null,
  now = new Date(),
  functions = null,
  budgetMs = AUDIT_BUDGET_MS,
  totalBudgetMs = AUDIT_HARD_STOP_MS
} = {}) {
  return verifyAllNa(Array.isArray(checks) ? checks : [], {
    verifyNa,
    ctx: { db, scope, now, functions, laneNaVerify },
    budgetMs,
    totalBudgetMs
  });
}

/* "Said nothing to judge, but <why> is not true." <why> is the reason verifyNa
   gave, a short condition. Only when no reason came back does the row's own
   sentence stand in for it. */
function failedNaRow(row, result) {
  const rest = { ...row };
  delete rest.na;
  const reason = result && result.reason;
  const why = clip(reason, 200) || `"${clip(row.detail, 160) || "its reason"}"`;
  const stale = result && result.problem === "stale";
  const detail = stale
    ? (/[.!?]$/.test(why)
      ? `Said nothing to judge, but that is not true. ${why}`
      : `Said nothing to judge, but ${why} is not true.`)
    : `Said nothing to judge, but it could not be checked again: ${why}${/[.!?]$/.test(why) ? "" : "."}`;
  return {
    ...rest,
    status: "skip",
    detail: clip(detail),
    suggestedFix: stale
      ? "Make this a real check, or fix its nothing-to-judge condition in src/pulse/na-conditions.mjs."
      : "Read this exact check reason. Fix the read or its time use, then run the pulse again.",
    customerSees: row.customerSees || null
  };
}

// ── step 2: yesterday's morning report ───────────────────────────────────────

/* The statuses the table allows besides "sent" (db/migrations/431_morning_briefs.sql,
   morning_briefs_delivery_status_ck). Any other value gets the generic line. */
const BRIEF_WHY = Object.freeze({
  failed: "Sending it failed.",
  dry_run: "It was only a dry run. Nothing was sent.",
  no_number: "There was no phone number to send it to."
});

async function checkBriefsSent({ db, now, orgId }) {
  const id = AUDIT_ROW_IDS.briefsSent;
  const day = yesterdayPhoenix(now);
  const fix = "Read yesterday's row in morning_briefs and its delivery error. The text goes out right after the 6 a.m. pulse.";
  const sees = "Chris did not get the morning report.";
  if (!db || typeof db.query !== "function") {
    return auditRow(id, "skip", "No database in this run, so yesterday's morning report was not looked up.", { fix });
  }
  let found;
  try {
    const res = await withTimeout(db.query(BRIEFS_SENT_SQL, [orgId || null, day]), BRIEFS_READ_MS);
    found = res && res.rows ? res.rows[0] : null;
  } catch (err) {
    return auditRow(id, "skip", `Yesterday's morning report could not be looked up (${clip((err && err.message) || err, 120)}).`, { fix });
  }
  if (found && found.delivery_status === "sent") {
    return auditRow(id, "PASS", `The morning report for ${day} was sent.`);
  }
  if (!found) {
    return auditRow(id, "FAIL", `No morning report was sent for ${day}. There is no row for that day.`, { fix, sees });
  }
  const status = String(found.delivery_status || "unknown");
  const err = found.delivery_error ? ` Error: ${clip(found.delivery_error, 120)}.` : "";
  const why = BRIEF_WHY[status] || `Its status was "${status}", not sent.`;
  return auditRow(id, "FAIL", `No morning report was sent for ${day}. ${why}${err}`, { fix, sees });
}

// ── step 2b: the run recorder ────────────────────────────────────────────────

/* The names of the add-ons on the shared Inngest client, or null when the client does not show them.
   A real client keeps them at client.options.middleware (each has a `name`). */
export function middlewareNames(client) {
  const list = client && client.options && client.options.middleware;
  if (!Array.isArray(list)) return null;
  return list.map((m) => (m && typeof m.name === "string" ? m.name : "")).filter(Boolean);
}

/* The event names that start a bundled workflow. */
function eventNamesOf(functions) {
  const names = new Set();
  for (const fn of Array.isArray(functions) ? functions : []) {
    for (const t of triggersOf(fn)) if (t && typeof t.event === "string" && t.event) names.add(t.event);
  }
  return [...names];
}

async function resolveClient(sharedClient) {
  if (sharedClient) return { client: sharedClient, injected: true, error: null };
  try {
    return { client: await defaultSharedClient(), injected: false, error: null };
  } catch (err) {
    return { client: null, injected: false, error: clip((err && err.message) || err, 120) };
  }
}

/* Why the shared client does not record runs, or null when it does. An injected client that shows no
   add-on list (a test stand-in) is not judged; the real client always shows it. */
function clientProblem({ client, injected }) {
  const names = middlewareNames(client);
  if (names) {
    return names.includes(RUN_EVIDENCE_NAME)
      ? null
      : `the shared workflow client does not list the "${RUN_EVIDENCE_NAME}" add-on, so no run of a workflow is recorded`;
  }
  return injected ? null : "the shared workflow client's add-on list could not be read";
}

async function checkRunRecorder({ db, scope, now, functions, sharedClient }) {
  const id = AUDIT_ROW_IDS.runRecorder;
  const sees = "A break in a workflow that handles leads or clients would not show on the morning report.";
  const resolved = await resolveClient(sharedClient);
  if (resolved.error) {
    return auditRow(id, "skip", `The shared workflow client would not load (${resolved.error}), so the run recorder was not checked.`);
  }
  const wrongClient = clientProblem(resolved);
  const canScope = typeof scope === "function";
  if (!canScope && (!db || typeof db.query !== "function")) {
    return wrongClient
      ? auditRow(id, "FAIL", `The run recorder is off: ${wrongClient}.`, {
        fix: `Put the "${RUN_EVIDENCE_NAME}" add-on back in src/workflows/client.mjs.`,
        sees
      })
      : auditRow(id, "skip", "No database in this run, so the run recorder was not checked.");
  }
  const dayAgo = new Date(now.getTime() - DAY_MS);
  const until = new Date(now.getTime() - START_GRACE_MS);
  const params = [dayAgo.toISOString(), eventNamesOf(functions), until.toISOString(), Math.round(RECEIPTS_GRACE_MS / 60000)];
  let found;
  try {
    const run = (async () => (canScope
      ? scope((tx) => tx.query(RUN_RECORDER_SQL, params))
      : db.query(RUN_RECORDER_SQL, params)))();
    run.catch(() => {});
    const res = await withTimeout(run, RUN_RECORDER_READ_MS);
    found = res && res.rows ? res.rows[0] : null;
  } catch (err) {
    if (err && err.code === "42P01") {
      return auditRow(id, "FAIL", "The workflow_runs table does not exist, so nothing can record that a workflow ran.", {
        fix: "Apply migration db/migrations/478_workflow_runs.sql. npm run ship applies it.",
        sees
      });
    }
    return wrongClient
      ? auditRow(id, "FAIL", `The run recorder is off: ${wrongClient}.`, {
        fix: `Put the "${RUN_EVIDENCE_NAME}" add-on back in src/workflows/client.mjs.`,
        sees
      })
      : auditRow(id, "skip", `The run recorder could not be looked up (${clip((err && err.message) || err, 120)}).`);
  }
  if (!found) {
    return auditRow(id, "skip", "The run recorder read came back empty, so it was not checked.");
  }

  const problems = [];
  const fixes = [];
  if (wrongClient) {
    problems.push(wrongClient);
    fixes.push(`Put the "${RUN_EVIDENCE_NAME}" add-on back in src/workflows/client.mjs.`);
  }
  if (found.can_insert !== true || found.can_update !== true) {
    const lacks = [found.can_insert !== true ? "INSERT" : null, found.can_update !== true ? "UPDATE" : null].filter(Boolean).join(" and ");
    problems.push("the app is not allowed to save run receipts, so the workflow rows cannot tell if work ran");
    fixes.push(`The app lacks ${lacks} on workflow_runs. If the switch-off was left on, put the permission back: GRANT INSERT, UPDATE ON public.workflow_runs TO fundhub_app.`);
  }
  if (!found.began_at) {
    problems.push("the receipts table has no start marker, so no workflow can be judged from it");
    fixes.push("Read db/migrations/478_workflow_runs.sql. The marker row (function _recorder) is inserted there.");
  }
  const events = Number(found.events_n) || 0;
  const runs = Number(found.runs_n) || 0;
  if (found.began_at && events > 0 && runs === 0) {
    problems.push(`${events} workflow ${plural(events, "event", "events")} came in the last day and not one run was recorded, so the recorder is not writing`);
    fixes.push("Look for [run-evidence] lines in the Netlify function logs (a line that says paused means the database did not answer). Then check that Inngest is still calling the app.");
  }
  if (problems.length) {
    return auditRow(id, "FAIL", `The run recorder has ${problems.length} ${plural(problems.length, "problem", "problems")}: ${problems.join("; ")}.`, {
      fix: fixes.join(" "),
      sees
    });
  }
  return auditRow(
    id,
    "PASS",
    `The run recorder can write, is on the shared workflow client, and recorded ${runs} ${plural(runs, "run", "runs")} in the last day` +
      `${events === 0 ? " (no workflow event came to record)" : ""}.`
  );
}

// ── step 3: the judgments ────────────────────────────────────────────────────

function judgeNaVerified(naRows, outcome) {
  const failed = naRows.filter((r) => !(outcome.get(r) || {}).ok);
  const stale = failed.filter((r) => (outcome.get(r) || {}).problem === "stale");
  const unread = failed.filter((r) => (outcome.get(r) || {}).problem !== "stale");

  if (stale.length) {
    const staleIds = stale.map((r) => String(r.id));
    const unreadIds = unread.map((r) => String(r.id));
    const unreadDetail = unread.length
      ? ` ${unread.length} more could not be checked again (${listIds(unreadIds)}); those are not called stale.`
      : "";
    return auditRow(
      AUDIT_ROW_IDS.naVerified,
      "FAIL",
      `${stale.length} of ${naRows.length} "nothing to judge" ${plural(naRows.length, "row", "rows")} ${plural(stale.length, "was", "were")} not true any more: ${listIds(staleIds)}.${unreadDetail} They now count as not checked.`,
      {
        fix: "Open each stale row. If its reason is no longer true, the check has to run now. For a row that could not be read, fix that read and run the pulse again.",
        sees: UNWATCHED
      }
    );
  }

  if (unread.length) {
    const timedOut = unread.filter((r) => (outcome.get(r) || {}).problem === "timeout");
    const hardStopped = unread.filter((r) => (outcome.get(r) || {}).problem === "hard-stop");
    const unreadable = unread.filter((r) => !["timeout", "hard-stop"].includes((outcome.get(r) || {}).problem));
    const facts = [];
    if (timedOut.length) facts.push(`${timedOut.length} timed out (${listIds(timedOut.map((r) => String(r.id)))})`);
    if (hardStopped.length) facts.push(`${hardStopped.length} reached the lane safety stop (${listIds(hardStopped.map((r) => String(r.id)))})`);
    if (unreadable.length) facts.push(`${unreadable.length} could not be read (${listIds(unreadable.map((r) => String(r.id)))})`);
    return auditRow(
      AUDIT_ROW_IDS.naVerified,
      "skip",
      `${unread.length} of ${naRows.length} "nothing to judge" ${plural(naRows.length, "row", "rows")} could not be checked again: ${facts.join("; ")}. None was called stale. They now count as not checked.`,
      {
        fix: "Read the named rows and their exact skip reasons. Fix the read or its time use, then run the pulse again.",
        sees: UNWATCHED
      }
    );
  }

  const detail = naRows.length
    ? `All ${naRows.length} "nothing to judge" ${plural(naRows.length, "row was", "rows were")} checked again and ${plural(naRows.length, "is", "are")} still true.`
    : "No row said nothing to judge today.";
  return auditRow(AUDIT_ROW_IDS.naVerified, "PASS", detail);
}

function presentIds(rows) {
  const out = new Set();
  for (const r of rows) {
    if (!r) continue;
    if (r.id != null) out.add(String(r.id));
    if (Array.isArray(r.also)) for (const a of r.also) out.add(String(a));
    // A lane's own check id, before any "#2" duplicate suffix.
    if (r.sliceId && r.checkId) out.add(namespaceGapId(r.checkId, String(r.sliceId)));
  }
  return out;
}

function judgeExpectedPresent(rows, manifest) {
  const id = AUDIT_ROW_IDS.expectedPresent;
  const want = manifest && manifest.ids ? [...new Set(manifest.ids)] : null;
  if (!want) {
    return auditRow(id, "skip", "The list of checks that should run was not given to the audit.", {
      fix: "Build it with loadManifest() in src/pulse/self-audit.mjs and pass it in."
    });
  }
  if (want.length === 0) {
    return auditRow(id, "FAIL", "The list of checks that should run is empty, so nothing could be judged.", {
      fix: "Read src/pulse/self-audit.mjs buildManifest(). The registry, jobs, and slices did not load.",
      sees: UNWATCHED
    });
  }
  const have = presentIds(rows);
  const missing = want.filter((w) => !have.has(w));
  if (missing.length) {
    return auditRow(
      id,
      "FAIL",
      `${missing.length} ${plural(missing.length, "check", "checks")} that should have run did not show up: ${listIds(missing)}.`,
      {
        fix: "A check went missing. Find why it did not run. The start of each id says where it lives (reg, job, wf, a slice, or a gap lane). Do not take it off the list to quiet this.",
        sees: UNWATCHED
      }
    );
  }
  return auditRow(id, "PASS", want.length === 1 ? "The 1 check that should run showed up." : `All ${want.length} checks that should run showed up.`);
}

function laneOfRow(r) {
  return String(r.sliceId || r.id || "").replace(/:step$/, "").replace(/\.mjs$/, "");
}

function fileLabel(lane, row) {
  if (row.checkId === "load-error") {
    const m = /Could not load (\S+?):/.exec(String(row.detail || ""));
    return m ? m[1] : `${lane}.mjs`;
  }
  return /^gap-/.test(lane) ? `${lane}.mjs` : lane;
}

function judgeLanesRan(rows, gapLanes) {
  const id = AUDIT_ROW_IDS.lanesRan;
  if (!Array.isArray(gapLanes)) {
    return auditRow(id, "skip", "The list of gap lanes was not given to the audit.", {
      fix: "Pass GAP_LANES from src/pulse/coverage/run-slices.mjs."
    });
  }
  // A list with nothing in it would pass without judging a single lane.
  if (gapLanes.length === 0) {
    return auditRow(id, "FAIL", "The list of gap lanes is empty, so nothing could be judged.", {
      fix: "Read GAP_LANES in src/pulse/coverage/run-slices.mjs and how the pulse hands it in. The real list has dozens of lanes.",
      sees: UNWATCHED
    });
  }
  const lanes = gapLanes.map((l) => String(l).replace(/\.mjs$/, ""));
  const byLane = new Map(lanes.map((l) => [l, 0]));
  const problems = [];
  const seen = new Set();
  const add = (label, why) => {
    const k = `${label}|${why}`;
    if (seen.has(k)) return;
    seen.add(k);
    problems.push(`${label} (${why})`);
  };
  for (const r of rows) {
    if (!r) continue;
    const lane = laneOfRow(r);
    if (byLane.has(lane)) byLane.set(lane, byLane.get(lane) + 1);
    if (LANE_DIED_CHECK_IDS.includes(r.checkId)) add(fileLabel(lane, r), DIED_WHY[r.checkId]);
    else if (r.checkId === "load-error") add(fileLabel(lane, r), "could not load");
  }
  for (const [lane, n] of byLane) if (n === 0) add(`${lane}.mjs`, "gave no rows");
  if (problems.length) {
    return auditRow(
      id,
      "FAIL",
      `${problems.length} ${plural(problems.length, "group of checks", "groups of checks")} did not finish: ${listIds(problems)}.`,
      {
        fix: "Open the named file and read why it stopped. A group that dies hides every check inside it.",
        sees: UNWATCHED
      }
    );
  }
  return auditRow(id, "PASS", `${lanes.length === 1 ? "The 1 gap lane answered" : `All ${lanes.length} gap lanes answered`} and no slice file failed to load.`);
}

async function defaultSharedClient() {
  const mod = await import("../workflows/client.mjs");
  return mod.inngest;
}

async function judgeWorkflowCoverage(rows, functions, sharedClient) {
  const id = AUDIT_ROW_IDS.workflowCoverage;
  if (!Array.isArray(functions)) {
    return auditRow(id, "skip", "The list of bundled workflows was not given to the audit.", {
      fix: "Pass `functions` from src/workflows/index.mjs."
    });
  }
  // A list with nothing in it would pass without judging a single workflow.
  if (functions.length === 0) {
    return auditRow(id, "FAIL", "The list of bundled workflows is empty, so nothing could be judged.", {
      fix: "Read how the pulse loads `functions` from src/workflows/index.mjs. The real list has dozens of workflows.",
      sees: UNWATCHED
    });
  }
  let client = sharedClient;
  if (!client) {
    try {
      client = await defaultSharedClient();
    } catch (err) {
      return auditRow(id, "skip", `The shared workflow client would not load (${clip((err && err.message) || err, 120)}).`);
    }
  }
  // A cron has a job: row when it is on either heartbeat list: Inngest (none since 2026-10-20) or the
  // Netlify clock (CLOCK_JOBS), which runs every scheduled job since the Inngest free plan ran out.
  const cronJobs = new Set([...INNGEST_JOBS, ...CLOCK_JOBS].map(([job]) => job));
  const have = new Set(rows.filter(Boolean).map((r) => String(r.id)));
  const problems = [];
  // The shared client must carry the run recorder, or no event workflow leaves a receipt.
  const recorderProblem = clientProblem({ client, injected: !!sharedClient });
  if (recorderProblem) problems.push(recorderProblem);
  for (const fn of functions) {
    const fid = fnId(fn);
    if (!fid) {
      problems.push("a workflow with no id (it cannot be watched)");
      continue;
    }
    if (fn.client !== client) problems.push(`${fid} (not built on the shared Inngest client in src/workflows/client.mjs)`);
    if (isCronFn(fn)) {
      if (!cronJobs.has(fid)) problems.push(`${fid} (a cron that is not on INNGEST_JOBS or CLOCK_JOBS)`);
    } else if (!have.has(`wf:${fid}`)) {
      problems.push(`${fid} (no wf: row)`);
    }
  }
  if (problems.length) {
    return auditRow(
      id,
      "FAIL",
      `${problems.length} workflow ${plural(problems.length, "problem", "problems")}: ${listIds(problems)}.`,
      {
        fix: `Build each workflow on the shared client in src/workflows/client.mjs, keep the "${RUN_EVIDENCE_NAME}" add-on on that client, list each cron in CLOCK_JOBS in src/pulse/heartbeats.mjs (and in src/workflows/scheduled.mjs), and give each other workflow a wf: row.`,
        sees: UNWATCHED
      }
    );
  }
  return auditRow(
    id,
    "PASS",
    `${functions.length === 1 ? "The 1 bundled workflow is" : `All ${functions.length} bundled workflows are`} on the shared client, the client carries the ${RUN_EVIDENCE_NAME} add-on, every cron is on a heartbeat list (INNGEST_JOBS or CLOCK_JOBS), and every other workflow has a wf: row.`
  );
}

function judgeNotChecked(rows, contract) {
  const id = AUDIT_ROW_IDS.notChecked;
  const bad = rows.filter((r) => {
    const mapped = contract.toContractCheck(r);
    return mapped.status === "not_checked" && mapped.not_proved !== true;
  }).map((r) => String(r.id));
  if (bad.length) {
    return auditRow(
      id,
      "FAIL",
      `${bad.length} ${plural(bad.length, "check was", "checks were")} not checked: ${listIds(bad)}. A live thing that is not checked is a break in the heartbeat.`,
      {
        fix: "Turn each one into a real check, or into a nothing-to-judge row with a reason the computer can check again. The rules are in src/pulse/na-conditions.mjs.",
        sees: UNWATCHED
      }
    );
  }
  const notProved = rows.filter((r) => contract.toContractCheck(r).not_proved === true).length;
  const note = notProved ? ` ${notProved} ${plural(notProved, "check is", "checks are")} counted as not proved.` : "";
  return auditRow(id, "PASS", `${rows.length === 1 ? "The 1 check was" : `All ${rows.length} checks were`} green, red, not proved, or had a reason to say nothing to judge today. None were left not checked.${note}`);
}

/* `folded` is the count the pulse already folded (it is checked below).
   `foldedHere` is what this audit folded itself. The line prints both together,
   so it is right whether or not the pulse adds the returned count to its own. */
function judgeTotals(rows, folded, contract, foldedHere = 0) {
  const id = AUDIT_ROW_IDS.totals;
  const problems = [];
  const mapped = [];
  const seen = new Map();
  for (const r of rows) {
    const rid = r && r.id != null && String(r.id) !== "" ? String(r.id) : null;
    if (!rid) problems.push("a row with no id");
    else seen.set(rid, (seen.get(rid) || 0) + 1);
    if (r && !KNOWN_RAW_STATUSES.has(String(r.status))) problems.push(`${rid || "a row"} has an unknown status "${clip(r.status, 30)}"`);
    const m = contract.toContractCheck(r);
    mapped.push(m);
    if (!CONTRACT_STATUSES.has(m.status)) problems.push(`${rid || "a row"} landed on a status outside the four ("${clip(m.status, 30)}")`);
  }
  for (const [rid, n] of seen) if (n > 1) problems.push(`${rid} appears ${n} times`);
  const counts = contract.countChecks(mapped);
  const green = counts.green || 0;
  const red = counts.red || 0;
  const na = counts.na || 0;
  const notChecked = counts.not_checked || 0;
  const notProved = counts.not_proved || 0;
  const unread = Math.max(0, notChecked - notProved);
  const sum = green + red + na + notChecked;
  if (sum !== rows.length) problems.push(`the four counts add to ${sum}, but there are ${rows.length} rows`);
  if (folded != null && !(Number.isInteger(folded) && folded >= 0)) problems.push("the folded count is not a whole number");
  if (problems.length) {
    return auditRow(
      id,
      "FAIL",
      `The report's own numbers do not add up (${problems.length} ${plural(problems.length, "problem", "problems")}): ${listIds(problems)}.`,
      {
        fix: "Read countChecks and toContractCheck in src/pulse/scorecard.mjs, and find the check that gives two rows one id.",
        sees: UNWATCHED
      }
    );
  }
  const foldedAll = (Number.isInteger(folded) && folded > 0 ? folded : 0) + foldedHere;
  const foldedNote = foldedAll ? ` ${foldedAll} ${plural(foldedAll, "claim was", "claims were")} folded into the check that ran.` : "";
  return auditRow(
    id,
    "PASS",
    `The report's numbers add up: ${rows.length} rows = ${green} green + ${red} broken + ${notProved} not proved + ${na} with nothing to judge + ${unread} not checked.${foldedNote}`
  );
}

// ── the door ─────────────────────────────────────────────────────────────────

/**
 * auditPulse — the heartbeat checks itself.
 *
 * Args (all but `checks` are optional):
 *   checks         the run's pulse rows, after the slice fold
 *   folded         how many slice claims were folded into the check that ran
 *   manifest       from buildManifest()/loadManifest(); built here when left out
 *   functions      the bundled Inngest functions (src/workflows/index.mjs)
 *   gapLanes       the lane ids the pulse ran (GAP_LANES)
 *   db, scope, now the pulse's own handles and clock
 *   laneNaVerify   (sliceId, code, args) => Promise<boolean|undefined>; see makeLaneNaVerify()
 *   orgId          the company for the morning-report read; the default company when left out
 * Wiring that tests inject, and the pulse leaves alone:
 *   verifyNa, sharedClient, notLiveRows, contract { toContractCheck, countChecks },
 *   budgetMs (per check), totalBudgetMs (whole audit safety stop),
 *   naOutcome (an optional early prepareNaAudit result)
 *
 * Returns { checks, rows, folded }:
 *   checks  the input rows; every failed `na` row replaced by a `skip` row, and
 *           the claims in AUDIT_COVERS folded into their audit row
 *   rows    the audit:* pulse rows
 *   folded  how many claims this call folded (add it to the pulse's folded count)
 * Never throws. If it breaks: { checks: <input untouched>, rows: [audit:crashed] }.
 */
export async function auditPulse({
  checks,
  folded = 0,
  manifest = null,
  functions = null,
  gapLanes = null,
  db = null,
  scope = null,
  now = new Date(),
  laneNaVerify = null,
  orgId = null,
  verifyNa = null,
  sharedClient = null,
  notLiveRows = null,
  contract = null,
  budgetMs = AUDIT_BUDGET_MS,
  totalBudgetMs = AUDIT_HARD_STOP_MS,
  naOutcome = null
} = {}) {
  try {
    if (!Array.isArray(checks)) throw new TypeError("auditPulse needs the list of checks");
    const api = contract || { toContractCheck, countChecks };
    const ctx = { db, scope, now, functions, laneNaVerify };

    // The list of expected checks is only built here when the pulse did not
    // hand one in.
    const manifestJob = manifest
      ? Promise.resolve({ want: manifest, error: null })
      : loadManifest({ functions: Array.isArray(functions) ? functions : [], notLiveRows }).then(
        (want) => ({ want, error: null }),
        (err) => ({ want: null, error: clip((err && err.message) || err, 120) })
      );
    // N/A checks may share one transaction client. Finish them before the
    // other audit database reads so no outside query can occupy that client's
    // queue while an N/A check's own clock is running.
    const outcome = await verifyAllNa(checks, { verifyNa, ctx, budgetMs, totalBudgetMs, seededOutcome: naOutcome });
    const openNaWork = naAuditHasOpenWork(outcome);
    const blocked = "An earlier nothing-to-judge database read is still running, so this read did not start.";
    const [briefs, built, recorder] = openNaWork
      ? [
        auditRow(AUDIT_ROW_IDS.briefsSent, "skip", blocked),
        await manifestJob,
        auditRow(AUDIT_ROW_IDS.runRecorder, "skip", blocked)
      ]
      : await Promise.all([
        checkBriefsSent({ db, now, orgId }),
        manifestJob,
        checkRunRecorder({ db, scope, now, functions, sharedClient })
      ]);

    // 1. every failed "nothing to judge" row becomes a skip row.
    const naRows = checks.filter((r) => r && r.status === "na");
    const afterNa = checks.map((r) => {
      if (!r || r.status !== "na") return r;
      const res = outcome.get(r);
      return res && res.ok ? r : failedNaRow(r, res);
    });

    // 2. the claims an audit row answers fold into it.
    const covers = AUDIT_COVERS[AUDIT_ROW_IDS.briefsSent] || [];
    const foldedIds = [];
    const afterFold = afterNa.filter((r) => {
      if (!r || !covers.includes(r.id)) return true;
      const open = r.status === "not checked" || r.status === "skip";
      if (open) foldedIds.push(String(r.id));
      return !open;
    });
    const briefsRow = foldedIds.length ? { ...briefs, also: foldedIds } : briefs;

    // 3. the judgments.
    const naVerified = judgeNaVerified(naRows, outcome);
    const expectedPresent = built.error
      ? auditRow(AUDIT_ROW_IDS.expectedPresent, "skip", `The list of checks that should run could not be built (${built.error}).`, {
        fix: "Read src/pulse/self-audit.mjs loadManifest()."
      })
      : judgeExpectedPresent([...afterFold, briefsRow], built.want);
    const lanesRan = judgeLanesRan(afterFold, gapLanes);
    const workflowCoverage = await judgeWorkflowCoverage(afterFold, functions, sharedClient);

    const partial = [naVerified, expectedPresent, lanesRan, workflowCoverage, briefsRow, recorder];
    const notChecked = judgeNotChecked([...afterFold, ...partial], api);
    const totalsStandIn = { id: AUDIT_ROW_IDS.totals, status: "PASS", detail: "stand-in" };
    const totals = judgeTotals([...afterFold, ...partial, notChecked, totalsStandIn], folded, api, foldedIds.length);

    return {
      checks: afterFold,
      rows: [notChecked, naVerified, totals, expectedPresent, lanesRan, workflowCoverage, briefsRow, recorder],
      folded: foldedIds.length
    };
  } catch (err) {
    return {
      checks: Array.isArray(checks) ? checks : [],
      rows: [
        auditRow(
          AUDIT_ROW_IDS.crashed,
          "FAIL",
          `The self-audit itself failed: ${clip((err && err.message) || err, 200)}. The checks were not audited.`,
          {
            fix: "Read the error. Fix src/pulse/self-audit.mjs. The morning report still went out.",
            sees: UNWATCHED
          }
        )
      ],
      folded: 0
    };
  }
}
