// Fold a slice claim into the real check that ran. Report only. Pure.
//
// A slice row (slice-*.mjs CHECKS) often says "covered": a door is pinged by the
// registry, a cron is on the job list, a workflow has a row of its own. Before
// this file the morning report never matched the claim to that real row, so 299
// claims read "not checked" although the check behind most of them ran and passed.
//
// evaluateRow (run-slices.mjs) sets `foldInto` on a claim, using foldTargetFor.
// foldCoverage runs once, in the morning pulse, after every row of the run exists.
// It removes each claim whose target is in the run and lists the claim on that
// target's `also` list. A fold never adds depth: a ping stays a ping.
//
// This file reads no repo files at run time. Everything comes from imports.

import { ALLOWED_UNMONITORED, PULSE_REGISTRY, coverageKey } from "../registry.mjs";
import { TRIPWIRES, isPingId } from "../tripwires.mjs";
import { JOBS } from "../heartbeats.mjs";

/**
 * A claim id that maps to a check with a different name. First stop in the fold
 * order. Nothing else today. `morning-brief` is NOT here on purpose: the
 * job:daily-pulse row is judged by the same run it is about, so it cannot vouch
 * for the brief. The self-audit (audit:briefs-sent) owns that claim.
 */
export const ALIASES = Object.freeze({
  "contracts/sign": "contracts:sign-route"
});

/**
 * Claims that must not fold by name even when a registry row happens to share the
 * id. Key is `<sliceId>:<checkId>`. `target` is the self-audit row that owns the
 * claim instead. The audit rows do not exist when the first fold runs, so the claim
 * stays as it is; pointAuditClaims (below) points it at its audit row for a second fold.
 */
export const LEFT_TO_AUDIT = Object.freeze({
  "06-briefs:morning-brief": Object.freeze({
    target: "audit:briefs-sent",
    reason: "The brief page answering does not prove the brief was sent. audit:briefs-sent reads the saved briefs."
  })
});

/**
 * Slice rows that are not live surfaces. They leave the scorecard. Key is
 * `<sliceId>:<checkId>`. The value is the reason, 40 characters or more.
 * No slice file is edited for these. link.test.mjs fails if one goes stale.
 */
export const NOT_LIVE_ROWS = Object.freeze({
  "02-daily-pulse:script-dry-run-default":
    "This is a rule about the script, not a thing that runs. It is a dry run unless a flag is passed. Tests in slice-02-daily-pulse.test.mjs and daily-pulse.test.mjs prove it.",
  "02-daily-pulse:pulse-never-fixes":
    "This is a rule about the code, not a thing that runs. The pulse never fixes anything. A test in daily-pulse.test.mjs proves it.",
  "02-daily-pulse:proof-does-not-text":
    "This is a rule about the proof script, not a thing that runs. It never sends a text. A test in slice-02-daily-pulse.test.mjs proves it.",
  "16-nurture:n-05-repair-complete-nurture":
    "This workflow does not exist. There is no file for it and it is not in the workflow list. There is nothing to judge until someone builds it.",
  "03-marketing:page_seen":
    "This only happens when staff open a page. It is not a clock. The page itself is watched by reg:marketing/health."
});

/**
 * Slice rows for a workflow that is built and deliberately not switched on. The
 * fold turns each into a "nothing to judge" row with the `not-registered` code, and
 * the audit re-checks that the id is still missing from the workflow list. The day
 * someone registers it, the row turns into a not-checked red and forces a real
 * check. Key is `<sliceId>:<checkId>`.
 */
export const NOT_REGISTERED_ROWS = Object.freeze({
  "05-funnels:clarity-insights-sweeper": {
    id: "clarity-insights-sweeper",
    reason: "Built but not switched on (not in the workflow list). Clarity pulls run only when Chris asks."
  }
});

/** The "nothing to judge" row for a NOT_REGISTERED_ROWS entry, or null. */
export function notRegisteredFor(sliceId, checkId) {
  const hit = NOT_REGISTERED_ROWS[`${sliceId}:${checkId}`];
  if (!hit) return null;
  return {
    detail: hit.reason,
    na: { code: "not-registered", args: { id: hit.id } }
  };
}

/** True when this slice row leaves the scorecard. */
export function isNotLive(sliceId, checkId) {
  return Object.prototype.hasOwnProperty.call(NOT_LIVE_ROWS, `${sliceId}:${checkId}`);
}

/** First check id of a tripwire entry that is not a ping. Null when there is none. */
function firstDeepCheck(entry) {
  const list = entry && Array.isArray(entry.checks) ? entry.checks : [];
  for (const id of list) {
    if (typeof id === "string" && id && !isPingId(id)) return id;
  }
  return null;
}

function hasCronTrigger(fn) {
  const triggers = (fn && fn.opts && Array.isArray(fn.opts.triggers) && fn.opts.triggers) || [];
  return triggers.some((t) => t && t.cron);
}

function functionId(fn) {
  if (fn && fn.opts && fn.opts.id) return String(fn.opts.id);
  if (fn && typeof fn.id === "function") {
    try { return String(fn.id()); } catch { return null; }
  }
  return null;
}

/**
 * Everything the fold order needs, built once. Pass `functions` (the bundled
 * Inngest functions, from src/workflows/index.mjs) to turn on the last step. With
 * no list, a workflow claim finds no target and stays not checked.
 */
export function buildFoldIndex({
  registry = PULSE_REGISTRY,
  allowed = ALLOWED_UNMONITORED,
  tripwires = TRIPWIRES,
  jobs = JOBS,
  functions = null,
  aliases = ALIASES
} = {}) {
  const regByKey = new Map();
  const regById = new Map();
  for (const row of registry) {
    const key = coverageKey(row);
    if (key && !regByKey.has(key)) regByKey.set(key, row.id);
    if (row.id != null && !regById.has(String(row.id))) regById.set(String(row.id), row.id);
  }
  const allowedTripwire = new Map();
  for (const key of Object.keys(allowed || {})) {
    const target = firstDeepCheck((tripwires || {})[`route:${key}`]);
    if (target) allowedTripwire.set(key, target);
  }
  const jobIds = new Set((jobs || []).map((row) => String(row.job)));
  const eventWorkflows = new Set();
  const listed = Array.isArray(functions);
  if (listed) {
    for (const fn of functions) {
      const id = functionId(fn);
      if (id && !hasCronTrigger(fn)) eventWorkflows.add(id);
    }
  }
  return { regByKey, regById, allowedTripwire, jobIds, eventWorkflows, aliases: aliases || {}, hasFunctions: listed };
}

/**
 * Where a claim folds. First hit wins:
 *   1. ALIASES
 *   2. a registry row: coverageKey(row) or row id equals the claim -> reg:<id>
 *   3. an ALLOWED_UNMONITORED key whose route is in TRIPWIRES -> its first deep check
 *   4. an id on the job list -> job:<id>
 *   5. a bundled Inngest function with no cron -> wf:<id>
 * Returns the target id, or null. `sliceId` is for the LEFT_TO_AUDIT list only.
 */
export function foldTargetFor(row, index, sliceId = "") {
  if (!row || row.id == null || row.id === "") return null;
  const id = String(row.id);
  if (Object.prototype.hasOwnProperty.call(LEFT_TO_AUDIT, `${sliceId}:${id}`)) return null;
  if (Object.prototype.hasOwnProperty.call(index.aliases, id)) return String(index.aliases[id]);
  if (index.regByKey.has(id)) return `reg:${index.regByKey.get(id)}`;
  if (index.regById.has(id)) return `reg:${index.regById.get(id)}`;
  if (index.allowedTripwire.has(id)) return index.allowedTripwire.get(id);
  if (index.jobIds.has(id)) return `job:${id}`;
  if (index.eventWorkflows.has(id)) return `wf:${id}`;
  return null;
}

/**
 * Point each audit-owned claim (LEFT_TO_AUDIT) at its audit row. Pure. Call it on the
 * list that already holds the audit rows, then fold a second time: a claim whose audit
 * row ran folds in; one whose audit row did not run stays, as a skip with the reason.
 */
export function pointAuditClaims(checks) {
  const list = Array.isArray(checks) ? checks : [];
  return list.map((row) => {
    if (!row || row.foldInto || row.sliceId == null || row.checkId == null) return row;
    const owner = LEFT_TO_AUDIT[`${row.sliceId}:${row.checkId}`];
    return owner ? { ...row, foldInto: owner.target } : row;
  });
}

function kindOf(target) {
  const t = String(target || "");
  if (t.startsWith("reg:")) return "reg";
  if (t.startsWith("job:")) return "job";
  if (t.startsWith("wf:")) return "wf";
  return "check";
}

/** Count claims by target kind: { reg, job, wf, check }. For the manifest and the proof. */
export function countByTargetKind(rows = []) {
  const n = { reg: 0, job: 0, wf: 0, check: 0 };
  for (const row of rows) {
    if (row && row.foldInto) n[kindOf(row.foldInto)] += 1;
  }
  return n;
}

function uniq(list) {
  return [...new Set(list)];
}

/**
 * Fold every claim into its target. Pure: the input list and its rows are not changed.
 *
 *  - a row in NOT_LIVE_ROWS is dropped and its id goes in `notLive`
 *  - a row in NOT_REGISTERED_ROWS becomes a "nothing to judge" row (status `na`, code
 *    `not-registered`) and its id goes in `notRegistered`
 *  - a row with `foldInto` whose target is in `checks` (and is not itself a claim) is
 *    removed, and its id is pushed on the target's `also` list; counted in `folded`
 *  - a claim whose target is missing stays, as a `skip` row (it lands not checked),
 *    with the reason "Claims covered by <target>, but <target> did not run today";
 *    its id goes in `dangling`
 *
 * A target is found by its row id, then by the `checkId` of a gap-lane row (a lane may
 * prefix its name on the scorecard id).
 */
export function foldCoverage(checks) {
  const list = Array.isArray(checks) ? checks : [];
  const notLive = [];
  const notRegistered = [];
  const live = [];
  for (const row of list) {
    if (row && row.sliceId != null && row.checkId != null) {
      if (isNotLive(row.sliceId, row.checkId)) {
        notLive.push(String(row.id));
        continue;
      }
      const off = notRegisteredFor(row.sliceId, row.checkId);
      if (off) {
        const { foldInto: _drop, ...rest } = row;
        notRegistered.push(String(row.id));
        live.push({ ...rest, status: "na", detail: off.detail, suggestedFix: null, customerSees: null, na: off.na });
        continue;
      }
    }
    live.push(row);
  }

  const byId = new Map();
  const byCheckId = new Map();
  for (const row of live) {
    if (!row || row.id == null || row.foldInto) continue;
    const id = String(row.id);
    if (!byId.has(id)) byId.set(id, row);
    // Only a gap lane prefixes its name on the scorecard id, so only lane rows are found by check id.
    if (row.checkId != null && String(row.sliceId || "").startsWith("gap-")) {
      const cid = String(row.checkId);
      if (!byCheckId.has(cid)) byCheckId.set(cid, row);
    }
  }

  const alsoFor = new Map();
  const dangling = [];
  const out = [];
  let folded = 0;
  for (const row of live) {
    if (!row || !row.foldInto) {
      out.push(row);
      continue;
    }
    const target = String(row.foldInto);
    const hit = byId.get(target) || byCheckId.get(target) || null;
    if (hit && hit !== row) {
      folded += 1;
      if (!alsoFor.has(hit)) alsoFor.set(hit, []);
      alsoFor.get(hit).push(String(row.id));
      continue;
    }
    dangling.push(String(row.id));
    const { foldInto: _drop, ...rest } = row;
    out.push({
      ...rest,
      status: "skip",
      detail: `Claims covered by ${target}, but ${target} did not run today.`
    });
  }

  const checksOut = out.map((row) => {
    const ids = row && alsoFor.get(row);
    if (!ids) return row;
    return { ...row, also: uniq([...(Array.isArray(row.also) ? row.also : []), ...ids]) };
  });
  return { checks: checksOut, folded, dangling, notLive, notRegistered };
}
