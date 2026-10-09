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
//      audit:workflow-coverage, audit:briefs-sent.
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
// (src/pulse/coverage/link.mjs). A broken file there becomes one honest row
// here, not a dead 6 a.m. pulse. Tests inject both.

import { INNGEST_JOBS, JOBS } from "./heartbeats.mjs";
import { MACHINE_CHECKS } from "./machine.mjs";
import { PULSE_REGISTRY } from "./registry.mjs";
import { countChecks, phoenixDate, toContractCheck } from "./scorecard.mjs";
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
   five door checks, the gate-relay, Recon, unrecorded calls, Gmail, and every
   machine row. self-audit.test.mjs runs the real pulse and fails if one of
   these is not in it. */
export const NAMED_PULSE_IDS = Object.freeze([
  "health",
  "login",
  "apply",
  "funnel:roadmap-sales",
  "suggestions",
  "gate-relay",
  "recon",
  "unrecorded",
  "gmail",
  ...MACHINE_CHECKS.map((c) => c.id)
]);

export const AUDIT_BUDGET_MS = 2500;
const BRIEFS_READ_MS = 2000;
const NA_CONCURRENCY = 8;
const MAX_IDS = 10;
const DAY_MS = 24 * 60 * 60 * 1000;

/* A lane or step that died leaves one of these as its row's checkId. */
export const LANE_DIED_CHECK_IDS = Object.freeze(["step", "threw", "not-listed", "bad-row"]);
const DIED_WHY = Object.freeze({
  step: "did not finish",
  threw: "threw, or would not load",
  "not-listed": "is not on the list in modules.mjs",
  "bad-row": "sent back an empty row"
});

const KNOWN_RAW_STATUSES = new Set(["PASS", "FAIL", "skip", "up", "down", "na", "not checked"]);
const CONTRACT_STATUSES = new Set(["green", "red", "na", "not_checked"]);

export const BRIEFS_SENT_SQL = `
SELECT delivery_status, delivery_error
  FROM morning_briefs
 WHERE brief_date = $2::date
   AND kind = 'morning'
   AND org_id = COALESCE($1::uuid, (SELECT id FROM orgs WHERE is_default LIMIT 1))
 LIMIT 1`;

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
    timer = setTimeout(() => reject(new Error("took too long")), ms);
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

/* A function is a cron when it has a cron trigger. Everything else is a
   workflow that starts on an event (or has no trigger at all). */
function triggersOf(fn) {
  return (fn && fn.opts && Array.isArray(fn.opts.triggers)) ? fn.opts.triggers : [];
}
function fnId(fn) {
  return fn && fn.opts && fn.opts.id ? String(fn.opts.id) : null;
}
function isCronFn(fn) {
  return triggersOf(fn).some((t) => t && t.cron);
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
 * buildManifest — pure. Every id the morning run must contain, built only from
 * lists handed in (the live defaults are imported constants).
 *
 * `sliceModules` is the output of loadSliceModules(): [{ sliceId, CHECKS }].
 * `gapModules` is the output of loadGapModules(): [{ sliceId, mod }]. A gap
 * lane that exports CHECK_IDS adds those ids; the 12 lanes that export no list
 * add nothing (a leftover, see the manifest note).
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
    const list = item && item.mod && Array.isArray(item.mod.CHECK_IDS) ? item.mod.CHECK_IDS : [];
    for (const id of list) {
      if (typeof id === "string" && id) byGroup.gap.push(namespaceGapId(id, sliceId));
    }
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
  return async function laneNaVerify(sliceId, code, args) {
    const lane = String(sliceId || "").replace(/\.mjs$/, "");
    const entry = gapFiles.find(([name]) => name.replace(/\.mjs$/, "") === lane);
    if (!entry) return undefined;
    const mod = await entry[1]();
    const fn = mod && mod.naVerify && mod.naVerify[code];
    if (typeof fn !== "function") return undefined;
    return fn(args, { db, scope, now });
  };
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

async function verifyOne(row, ctx, verify, deadline) {
  const left = deadline - Date.now();
  if (left <= 0) return { ok: false, reason: "The audit ran out of time before it could check this again." };
  try {
    const res = await withTimeout(verify(row, ctx), left);
    if (res && typeof res === "object") return { ok: res.ok === true, reason: clip(res.reason, 200) };
    return { ok: false, reason: "The check gave no answer." };
  } catch (err) {
    return { ok: false, reason: `It could not be checked again (${clip((err && err.message) || err, 120)}).` };
  }
}

/* Runs verifyNa for every `na` row. Same code + args + lane = one call. Eight
   at a time. Returns a Map from the row object to { ok, reason }. */
async function verifyAllNa(list, { verifyNa, ctx, budgetMs }) {
  const naRows = list.filter((r) => r && r.status === "na");
  const outcome = new Map();
  if (!naRows.length) return outcome;
  const verify = verifyNa || await defaultVerifyNa();
  const deadline = Date.now() + budgetMs;
  const memo = new Map();
  let next = 0;
  async function worker() {
    while (next < naRows.length) {
      const row = naRows[next++];
      const hasCode = row.na && typeof row.na.code === "string";
      const key = hasCode ? stable([row.sliceId || null, row.na.code, row.na.args]) : null;
      let pending = key ? memo.get(key) : null;
      if (!pending) {
        pending = verifyOne(row, ctx, verify, deadline);
        if (key) memo.set(key, pending);
      }
      outcome.set(row, await pending);
    }
  }
  await Promise.all(Array.from({ length: Math.min(NA_CONCURRENCY, naRows.length) }, worker));
  return outcome;
}

function failedNaRow(row, reason) {
  const rest = { ...row };
  delete rest.na;
  const claim = clip(row.detail, 160) || "its reason";
  const why = reason ? ` ${reason}` : "";
  return {
    ...rest,
    status: "skip",
    detail: clip(`Said nothing to judge, but "${claim}" is not true.${why}`),
    suggestedFix: "Make this a real check, or fix its nothing-to-judge condition in src/pulse/na-conditions.mjs.",
    customerSees: row.customerSees || null
  };
}

// ── step 2: yesterday's morning report ───────────────────────────────────────

const BRIEF_WHY = Object.freeze({
  held_quiet_hours: "It was held back for the quiet hours and never sent.",
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

// ── step 3: the judgments ────────────────────────────────────────────────────

function judgeNaVerified(naRows, outcome) {
  const failed = naRows.filter((r) => !(outcome.get(r) || {}).ok);
  if (failed.length) {
    const ids = failed.map((r) => String(r.id));
    return auditRow(
      AUDIT_ROW_IDS.naVerified,
      "FAIL",
      `${failed.length} of ${naRows.length} "nothing to judge" ${plural(naRows.length, "row", "rows")} ${plural(failed.length, "was", "were")} not true any more: ${listIds(ids)}. They now count as not checked.`,
      {
        fix: "Open each named row. If its reason is no longer true, the check has to run now. If the reason is wrong, fix its condition in src/pulse/na-conditions.mjs.",
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
  let client = sharedClient;
  if (!client) {
    try {
      client = await defaultSharedClient();
    } catch (err) {
      return auditRow(id, "skip", `The shared workflow client would not load (${clip((err && err.message) || err, 120)}).`);
    }
  }
  const cronJobs = new Set(INNGEST_JOBS.map(([job]) => job));
  const have = new Set(rows.filter(Boolean).map((r) => String(r.id)));
  const problems = [];
  for (const fn of functions) {
    const fid = fnId(fn);
    if (!fid) {
      problems.push("a workflow with no id (it cannot be watched)");
      continue;
    }
    if (fn.client !== client) problems.push(`${fid} (not on the shared client, so it skips the run receipts)`);
    if (isCronFn(fn)) {
      if (!cronJobs.has(fid)) problems.push(`${fid} (a cron that is not on INNGEST_JOBS)`);
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
        fix: "Build each workflow on the shared client in src/workflows/client.mjs, list each cron in INNGEST_JOBS in src/pulse/heartbeats.mjs, and give each other workflow a wf: row.",
        sees: UNWATCHED
      }
    );
  }
  return auditRow(
    id,
    "PASS",
    `${functions.length === 1 ? "The 1 bundled workflow is" : `All ${functions.length} bundled workflows are`} on the shared client, every cron is on INNGEST_JOBS, and every other workflow has a wf: row.`
  );
}

function judgeNotChecked(rows, contract) {
  const id = AUDIT_ROW_IDS.notChecked;
  const bad = rows.filter((r) => contract.toContractCheck(r).status === "not_checked").map((r) => String(r.id));
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
  return auditRow(id, "PASS", `${rows.length === 1 ? "The 1 check was" : `All ${rows.length} checks were`} green, red, or had a reason to say nothing to judge today. None were left not checked.`);
}

function judgeTotals(rows, folded, contract) {
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
  const foldedNote = folded ? ` ${folded} ${plural(folded, "claim was", "claims were")} folded into the check that ran.` : "";
  return auditRow(
    id,
    "PASS",
    `The report's numbers add up: ${rows.length} rows = ${green} green + ${red} red + ${na} with nothing to judge + ${notChecked} not checked.${foldedNote}`
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
 *   verifyNa, sharedClient, notLiveRows, contract { toContractCheck, countChecks }, budgetMs
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
  budgetMs = AUDIT_BUDGET_MS
} = {}) {
  try {
    if (!Array.isArray(checks)) throw new TypeError("auditPulse needs the list of checks");
    const api = contract || { toContractCheck, countChecks };
    const ctx = { db, scope, now, functions, laneNaVerify };

    // The reads run side by side. The list of expected checks is only built
    // here when the pulse did not hand one in.
    const manifestJob = manifest
      ? Promise.resolve({ want: manifest, error: null })
      : loadManifest({ functions: Array.isArray(functions) ? functions : [], notLiveRows }).then(
        (want) => ({ want, error: null }),
        (err) => ({ want: null, error: clip((err && err.message) || err, 120) })
      );
    const [outcome, briefs, built] = await Promise.all([
      verifyAllNa(checks, { verifyNa, ctx, budgetMs }),
      checkBriefsSent({ db, now, orgId }),
      manifestJob
    ]);

    // 1. every failed "nothing to judge" row becomes a skip row.
    const naRows = checks.filter((r) => r && r.status === "na");
    const afterNa = checks.map((r) => {
      if (!r || r.status !== "na") return r;
      const res = outcome.get(r);
      return res && res.ok ? r : failedNaRow(r, res && res.reason);
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

    const partial = [naVerified, expectedPresent, lanesRan, workflowCoverage, briefsRow];
    const notChecked = judgeNotChecked([...afterFold, ...partial], api);
    const totalsStandIn = { id: AUDIT_ROW_IDS.totals, status: "PASS", detail: "stand-in" };
    const totals = judgeTotals([...afterFold, ...partial, notChecked, totalsStandIn], folded, api);

    return {
      checks: afterFold,
      rows: [notChecked, naVerified, totals, expectedPresent, lanesRan, workflowCoverage, briefsRow],
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
