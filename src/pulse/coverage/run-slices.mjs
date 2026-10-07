// One runner for every coverage slice. Audit only. Never fixes. Never texts.
//
// Each slice-*.mjs file exports CHECKS. This file loads all of them and turns
// each row into a morning-pulse check.
//
// A cron is red only when we can read a real last-success time and that time
// is older than 3 times its schedule. The last-success read is one SELECT on
// job_heartbeats, plus the few stamp queries a slice already exports
// (agent_runs, payout rows, production-floor reviews, marketing heartbeats).
// There is not a copied query per slice.
//
// An event workflow (booking.created, round.funded, and the rest) is not a
// cron. It is "not checked" unless a last-success time is actually in the
// database. A catalog note that says PASS is not a pass.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { JOBS, STALE_MULTIPLE, cronIntervalMs, lastMonthlyFire } from "../heartbeats.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

export const NOT_CHECKED = "not checked";

const JOB_CRON = new Map(JOBS.map((row) => [row.job, row.cron]));
const MONTH_MS = 31 * 24 * 60 * 60 * 1000;
const MIN_MS = 60 * 1000;

const HEARTBEAT_SQL = `
SELECT job,
       max(finished_at) AS last_at,
       (array_agg(outcome ORDER BY finished_at DESC))[1] AS last_outcome,
       (array_agg(error ORDER BY finished_at DESC))[1] AS last_error
  FROM job_heartbeats
 WHERE job = ANY($1::text[])
 GROUP BY job`;

function clip(s, n = 400) {
  return String(s == null ? "" : s).replace(/\s+/g, " ").trim().slice(0, n);
}

function toDate(v) {
  if (v == null || v === "") return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isFinite(d.getTime()) ? d : null;
}

function ago(ms) {
  if (ms < 60 * MIN_MS) return `${Math.max(1, Math.round(ms / MIN_MS))} min`;
  if (ms < 2 * 24 * 60 * MIN_MS) return `${Math.round(ms / (60 * MIN_MS))} h`;
  return `${Math.round(ms / (24 * 60 * MIN_MS))} days`;
}

function unique(list) {
  return [...new Set(list.filter((v) => v != null && v !== "").map((v) => String(v)))];
}

/** Five-field cron, or TZ=Name plus five fields. Event names are not crons. */
export function isCronExpression(cron) {
  let raw = String(cron || "").trim();
  if (!raw || raw.includes(".")) return false;
  if (raw.startsWith("TZ=")) {
    const parts = raw.split(/\s+/);
    if (parts.length !== 6) return false;
    raw = parts.slice(1).join(" ");
  }
  return raw.split(/\s+/).length === 5;
}

/** The cron string we can time, from the row or from the job list. */
export function cronExpression(row) {
  if (row && isCronExpression(row.cron)) return String(row.cron).trim();
  if (row && JOB_CRON.has(row.id)) return JOB_CRON.get(row.id);
  return null;
}

/** Milliseconds in 3 times the schedule. Null when the shape is unknown. */
export function redAfterMs(cron, now = new Date()) {
  const interval = cronIntervalMs(cron);
  if (interval != null) return STALE_MULTIPLE * interval;
  if (lastMonthlyFire(cron, now)) return STALE_MULTIPLE * MONTH_MS;
  return null;
}

function isEventSchedule(schedule) {
  const s = String(schedule || "").trim();
  if (!s || s.includes("/") || /\.html?$/i.test(s)) return false;
  const parts = s.split(/\s+\+\s+/);
  return parts.length > 0 && parts.every((p) => /^[a-z0-9_-]+\.[a-z0-9_.-]+$/i.test(p));
}

function looksLikeEvent(row) {
  if (cronExpression(row)) return false;
  if (isEventSchedule(row && row.schedule)) return true;
  return /^Event\b/.test(String((row && row.proof) || ""));
}

function withNote(lead, proof) {
  const p = clip(proof, 500);
  return p ? `${lead} Slice note: ${p}` : lead;
}

function fixFor(checkId) {
  return `Read the last run of ${checkId}. Do not re-run it from this pulse. Chris fixes reds.`;
}

function result(row, sliceId, status, detail, extra = {}) {
  const checkId = String((row && row.id) || "unnamed");
  const cron = extra.cron || null;
  return {
    id: `${sliceId}:${checkId}`,
    checkId,
    sliceId,
    kind: "coverage",
    group: extra.group || (cron ? "jobs" : "backend"),
    status,
    detail,
    suggestedFix: extra.suggestedFix || null,
    customerSees: extra.customerSees || null,
    schedule: row && row.schedule != null ? row.schedule : null
  };
}

export function tally(rows = []) {
  const n = { total: rows.length, pass: 0, red: 0, notChecked: 0, other: 0 };
  for (const row of rows) {
    if (row.status === "PASS") n.pass += 1;
    else if (row.status === "FAIL") n.red += 1;
    else if (row.status === NOT_CHECKED) n.notChecked += 1;
    else n.other += 1;
  }
  return n;
}

export async function loadSliceModules(dir = HERE) {
  const names = fs.readdirSync(dir)
    .filter((name) => /^slice-.+\.mjs$/.test(name) && !name.endsWith(".test.mjs"))
    .sort();
  const out = [];
  for (const name of names) {
    try {
      const mod = await import(pathToFileURL(path.join(dir, name)).href);
      out.push({
        sliceId: mod.SLICE_ID || name.replace(/\.mjs$/, ""),
        file: name,
        CHECKS: Array.isArray(mod.CHECKS) ? mod.CHECKS : [],
        mod
      });
    } catch (err) {
      out.push({
        sliceId: name.replace(/\.mjs$/, ""),
        file: name,
        CHECKS: [{
          id: "load-error",
          schedule: "unknown",
          proof: `Could not load ${name}: ${clip(err && err.message, 160)}. Not checked.`
        }],
        mod: {}
      });
    }
  }
  return out;
}

function collectSignals(loaded) {
  let agent = null;
  let marketing = null;
  const stamps = [];
  const seenSql = new Set();
  for (const item of loaded) {
    const mod = item.mod || {};
    if (!agent && mod.LATEST_RUN_SQL && mod.AGENT_CODE && mod.TRIGGER_EVENT && typeof mod.missedMornings === "function") {
      const checkId = (item.CHECKS || []).some((row) => row && row.id === "ag-07-cron-daily-pulse")
        ? "ag-07-cron-daily-pulse"
        : null;
      if (checkId) {
        agent = {
          checkId,
          sql: mod.LATEST_RUN_SQL,
          agentCode: mod.AGENT_CODE,
          triggerEvent: mod.TRIGGER_EVENT,
          missedMornings: mod.missedMornings,
          redAfter: mod.RED_AFTER_MORNINGS || 3
        };
      }
    }
    if (!marketing && typeof mod.checkMarketing === "function") marketing = mod.checkMarketing;
    for (const [idKey, sqlKey] of [
      ["PAYOUT_ID", "AFFILIATE_PAYOUT_LAST_RUN_SQL"],
      ["FLOOR_JOB_ID", "FLOOR_LAST_RUN_SQL"]
    ]) {
      const id = mod[idKey];
      const sql = mod[sqlKey];
      if (id && sql && !seenSql.has(String(sql))) {
        seenSql.add(String(sql));
        stamps.push({ id: String(id), sql: String(sql) });
      }
    }
  }
  return { agent, marketing, stamps };
}

async function readHeartbeats(db, jobIds) {
  if (!db || typeof db.query !== "function") return { ok: false, reason: "no_db", byJob: new Map() };
  if (!jobIds.length) return { ok: true, reason: null, byJob: new Map() };
  try {
    const { rows } = await db.query(HEARTBEAT_SQL, [jobIds]);
    const byJob = new Map();
    for (const row of rows || []) {
      if (row && row.job) byJob.set(String(row.job), row);
    }
    return { ok: true, reason: null, byJob };
  } catch (err) {
    return { ok: false, reason: clip(err && err.message, 160), byJob: new Map() };
  }
}

async function readAgentRun(db, agent) {
  if (!agent) return { ok: false, reason: "no_signal", row: null };
  if (!db || typeof db.query !== "function") return { ok: false, reason: "no_db", row: null };
  try {
    const { rows } = await db.query(agent.sql, [agent.agentCode, agent.triggerEvent]);
    return { ok: true, reason: null, row: (rows && rows[0]) || null };
  } catch (err) {
    return { ok: false, reason: clip(err && err.message, 160), row: null };
  }
}

async function readStamps(db, stamps, checkIds) {
  const byId = new Map();
  if (!db || typeof db.query !== "function") return byId;
  for (const stamp of stamps) {
    if (!checkIds.has(stamp.id)) continue;
    try {
      const { rows } = await db.query(stamp.sql);
      const at = toDate(rows && rows[0] && rows[0].last_run);
      if (at) byId.set(stamp.id, at);
    } catch {
      // A stamp we cannot read is missing proof, not a red.
    }
  }
  return byId;
}

async function readMarketing(marketing, scope, db, now) {
  if (typeof marketing !== "function") return { byId: new Map(), error: null };
  const runScope = scope || (db && typeof db.query === "function" ? (fn) => fn(db) : null);
  if (!runScope) return { byId: new Map(), error: null };
  try {
    const rows = await marketing({ scope: runScope, now });
    const byId = new Map();
    for (const row of rows || []) {
      if (row && row.id) byId.set(String(row.id), row);
    }
    return { byId, error: null };
  } catch (err) {
    return { byId: new Map(), error: clip(err && err.message, 160) };
  }
}

function pickLast(hit, stampAt) {
  const heart = hit ? toDate(hit.last_at) : null;
  const stamp = toDate(stampAt);
  if (heart && stamp) {
    if (stamp.getTime() > heart.getTime()) return { at: stamp, outcome: "ok", error: null };
    return { at: heart, outcome: hit.last_outcome, error: hit.last_error };
  }
  if (heart) return { at: heart, outcome: hit.last_outcome, error: hit.last_error };
  if (stamp) return { at: stamp, outcome: "ok", error: null };
  return null;
}

function fromEvent(row, sliceId) {
  const name = row.schedule || "an event";
  return result(
    row,
    sliceId,
    NOT_CHECKED,
    withNote(
      `This is an event workflow (${name}), not a cron. It is not red just because it is not a page ping. Not checked. No last-success time in the database.`,
      row.proof
    )
  );
}

function fromUnchecked(row, sliceId, lead) {
  return result(row, sliceId, NOT_CHECKED, withNote(lead, row.proof));
}

function fromMarketing(row, sliceId, m) {
  const detail = clip(m && m.detail, 500);
  if (m && m.status === "PASS") {
    return result(row, sliceId, "PASS", detail, { group: "jobs" });
  }
  if (m && m.status === "FAIL" && /never/i.test(detail)) {
    return fromUnchecked(row, sliceId, `Not checked. No last-success time in the database. ${detail}`);
  }
  if (m && m.status === "FAIL") {
    return result(row, sliceId, "FAIL", detail, {
      group: "jobs",
      suggestedFix: m.suggestedFix || fixFor(row.id),
      customerSees: `${row.id} is late or its last pass failed.`
    });
  }
  const lead = detail
    ? `Not checked. ${detail}`
    : "Not checked. No last-success time in the database.";
  return fromUnchecked(row, sliceId, lead);
}

function fromAgent(row, sliceId, ctx) {
  const read = ctx.agentRead;
  if (!read || read.reason === "no_db") {
    return fromUnchecked(row, sliceId, "Not checked. No database in this run, so there is no last-success time to read.");
  }
  if (!read.ok) {
    return fromUnchecked(row, sliceId, `Not checked. Could not read agent_runs (${read.reason}).`);
  }
  const at = toDate(read.row && read.row.created_at);
  if (!at) {
    return fromUnchecked(row, sliceId, "Not checked. No last-success time in agent_runs for this cron.");
  }
  const missed = ctx.agent.missedMornings(at, ctx.now);
  if (missed == null) {
    return fromUnchecked(row, sliceId, "Not checked. The last agent run time could not be read.");
  }
  const limit = ctx.agent.redAfter;
  if (missed >= limit) {
    return result(
      row,
      sliceId,
      "FAIL",
      `Last success ${at.toISOString()} missed ${missed} mornings. Red after ${limit} mornings.`,
      {
        group: "jobs",
        cron: true,
        suggestedFix: fixFor(row.id),
        customerSees: "The morning check has not finished for 3 mornings."
      }
    );
  }
  const outcome = read.row && read.row.outcome ? ` Outcome ${read.row.outcome}.` : "";
  return result(
    row,
    sliceId,
    "PASS",
    `Last success ${at.toISOString()} missed ${missed} mornings, inside ${limit}.${outcome}`,
    { group: "jobs", cron: true }
  );
}

function fromCron(row, sliceId, cron, ctx) {
  const limit = redAfterMs(cron, ctx.now);
  const last = pickLast(
    ctx.heartbeats.ok ? ctx.heartbeats.byJob.get(String(row.id)) : null,
    ctx.stamps.get(String(row.id))
  );
  if (!last) {
    if (!ctx.heartbeats.ok && ctx.heartbeats.reason && ctx.heartbeats.reason !== "no_db") {
      return fromUnchecked(row, sliceId, `Not checked. Could not read the last run (${ctx.heartbeats.reason}).`);
    }
    if (ctx.heartbeats.reason === "no_db") {
      return fromUnchecked(row, sliceId, "Not checked. No database in this run, so there is no last-success time to read.");
    }
    if (limit == null) {
      return fromUnchecked(row, sliceId, `Not checked. Schedule "${cron}" is a shape this check does not time.`);
    }
    return fromUnchecked(row, sliceId, `Not checked. No last-success time in the database for this cron (${cron}).`);
  }
  if (limit == null) {
    return fromUnchecked(
      row,
      sliceId,
      `Not checked. A last run is on file (${last.at.toISOString()}) but schedule "${cron}" is a shape this check does not time.`
    );
  }
  const age = ctx.now.getTime() - last.at.getTime();
  const when = `${last.at.toISOString()} (${ago(age)} ago)`;
  const errBit = last.error ? ` Last pass error: ${clip(last.error, 120)}.` : "";
  if (age > limit) {
    return result(
      row,
      sliceId,
      "FAIL",
      `Last success ${when} is more than 3 times its schedule (${cron}).${errBit}`,
      {
        group: "jobs",
        cron: true,
        suggestedFix: fixFor(row.id),
        customerSees: `${row.id} has not run in 3 times its schedule.`
      }
    );
  }
  if (last.outcome === "error") {
    return result(
      row,
      sliceId,
      "FAIL",
      `Last run ${when} ended in an error: ${clip(last.error || "no message", 120)}. Schedule ${cron}.`,
      {
        group: "jobs",
        cron: true,
        suggestedFix: fixFor(row.id),
        customerSees: `${row.id} ran, and the last pass failed.`
      }
    );
  }
  return result(
    row,
    sliceId,
    "PASS",
    `Last success ${when}, inside 3 times its schedule (${cron}).`,
    { group: "jobs", cron: true }
  );
}

function evaluateRow(row, sliceId, ctx) {
  if (!row || typeof row !== "object") {
    return result(
      { id: "bad-row", proof: "This slice row was empty." },
      sliceId,
      NOT_CHECKED,
      "Not checked. This slice row was empty."
    );
  }
  if (ctx.marketingError && ctx.marketingIds.has(String(row.id)) && !ctx.marketingById.has(String(row.id))) {
    return fromUnchecked(row, sliceId, `Not checked. Could not read marketing heartbeats (${ctx.marketingError}).`);
  }
  if (ctx.marketingById.has(String(row.id))) {
    return fromMarketing(row, sliceId, ctx.marketingById.get(String(row.id)));
  }
  if (ctx.agent && ctx.agent.checkId === row.id) return fromAgent(row, sliceId, ctx);
  const cron = cronExpression(row);
  if (cron) return fromCron(row, sliceId, cron, ctx);
  if (looksLikeEvent(row)) return fromEvent(row, sliceId);
  return fromUnchecked(row, sliceId, "Not checked. No last-success time in the database.");
}

/**
 * Evaluate every slice CHECKS row.
 * `modules` is for tests. Live calls load every slice-*.mjs file.
 * Does not send. Does not fix.
 */
export async function runCoverageSlices({
  db = null,
  scope = null,
  now = new Date(),
  modules = null
} = {}) {
  const loaded = modules || await loadSliceModules();
  const signals = collectSignals(loaded);
  const checkIds = new Set();
  const cronIds = [];
  for (const item of loaded) {
    for (const row of item.CHECKS || []) {
      if (!row || row.id == null) continue;
      checkIds.add(String(row.id));
      const cron = cronExpression(row);
      if (cron) cronIds.push(String(row.id));
    }
  }
  const heartbeats = await readHeartbeats(db, unique(cronIds));
  const agentRead = await readAgentRun(db, signals.agent);
  const stamps = await readStamps(db, signals.stamps, checkIds);
  const marketing = await readMarketing(signals.marketing, scope, db, now);
  const ctx = {
    now,
    heartbeats,
    agent: signals.agent,
    agentRead,
    stamps,
    marketingById: marketing.byId,
    marketingError: marketing.error,
    marketingIds: new Set(
      loaded.flatMap((item) => (
        typeof (item.mod || {}).checkMarketing === "function"
          ? (item.CHECKS || []).map((row) => row && String(row.id))
          : []
      )).filter(Boolean)
    )
  };
  const out = [];
  for (const item of loaded) {
    const sliceId = item.sliceId || "slice";
    const checks = Array.isArray(item.CHECKS) ? item.CHECKS : [];
    for (const row of checks) out.push(evaluateRow(row, sliceId, ctx));
  }
  return out;
}
