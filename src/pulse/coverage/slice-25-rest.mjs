// Leftover cron jobs for the 7:00 a.m. pulse. Report only. Never auto-fix. Never text.
//
// Slices 02–20 own the named lanes: daily pulse, marketing clock/worker, meta,
// ClickFunnels, Clarity, finance-os*, Plaid, merchant, doc-check*, document vault,
// contract chaser, hiring*, message dispatch, waypoint, Commas, Meet, Blake,
// inquiry call, affiliate payout, subscription, paid checkout, and SLO infinite.
//
// This slice is what src/workflows/index.mjs still has: blueprint sweepers,
// UnderwriteIQ data health (u-05), and any other cron those lanes do not name.
//
// A cron is red when its id is missing from the pulse job list
// (src/pulse/heartbeats.mjs), or when the last heartbeat is older than 3 times
// its schedule. u-05 is an event job. It is red when its id is missing from
// PULSE_REGISTRY. This file does not edit the registry, the index, or the pulse.

import { functions } from "../../workflows/index.mjs";
import { coverageKey, PULSE_REGISTRY } from "../registry.mjs";
import {
  INNGEST_JOBS,
  NETLIFY_JOBS,
  STALE_MULTIPLE,
  cronIntervalMs
} from "../heartbeats.mjs";

export const SLICE_ID = "25-rest";

export const U05_ID = "u-05-data-health-monitor";

/** One nominal month — 3× stale window when the cron is day-of-month. */
export const MONTHLY_MS = 31 * 24 * 60 * 60 * 1000;

const heartbeatCron = new Map([
  ...INNGEST_JOBS,
  ...NETLIFY_JOBS
]);

const listed = new Set(PULSE_REGISTRY.map((row) => coverageKey(row)));

/** Cron string for a leftover id. Used by isRed. Not a CHECKS field. */
const cronById = new Map();

/**
 * True when slices 02–20 own this workflow id.
 * finance-os* is a prefix. Affiliate payout is the payout run, not the drip.
 * @param {string} id
 */
export function ownedByNamedSlice(id) {
  const s = String(id || "");
  if (s === "daily-pulse") return true;
  if (s === "marketing-clock" || s === "marketing-worker" || s.includes("marketing-worker")) return true;
  if (s.startsWith("meta-")) return true;
  if (s.includes("clickfunnels")) return true;
  if (s.includes("clarity")) return true;
  if (s.startsWith("finance-os-")) return true;
  if (s.includes("plaid")) return true;
  if (s.includes("merchant")) return true;
  if (s.startsWith("doc-check")) return true;
  if (s.includes("document-vault")) return true;
  if (s.includes("contract-chaser")) return true;
  if (s.startsWith("hiring-")) return true;
  if (s.includes("message-dispatch")) return true;
  if (s.includes("waypoint")) return true;
  if (s.includes("commas")) return true;
  if (s.startsWith("meet-")) return true;
  if (s.includes("blake")) return true;
  if (s.includes("inquiry-call")) return true;
  if (s.includes("affiliate-payout")) return true;
  if (s.includes("subscription")) return true;
  if (s.includes("paid-checkout")) return true;
  if (s.includes("slo-infinite")) return true;
  return false;
}

/** One token for redAfter (`3x ${label}`). */
export function scheduleLabel(cron) {
  let raw = String(cron || "").trim();
  if (raw.startsWith("TZ=")) raw = raw.split(/\s+/).slice(1).join(" ");
  const parts = raw.split(/\s+/);
  if (parts.length !== 5) return "custom";
  const [min, hour, dom, mon, dow] = parts;
  if (mon !== "*" || dow !== "*") return "custom";
  if (dom !== "*") return "monthly";
  if (hour === "*" && min === "*") return "1m";
  const every = /^\*\/(\d+)$/.exec(min);
  if (hour === "*" && every) return `${every[1]}m`;
  if (hour === "*" && /^\d+$/.test(min)) return "hourly";
  if (/^\d+$/.test(min) && /^\d+$/.test(hour)) return "daily";
  return "custom";
}

function triggersOf(fn) {
  return (fn && fn.opts && fn.opts.triggers) || [];
}

function cronRow(id, cron) {
  cronById.set(id, cron);
  const schedule = scheduleLabel(cron);
  const redAfter = `3x ${schedule}`;
  const listedCron = heartbeatCron.has(id) ? heartbeatCron.get(id) : null;
  const alreadyInRegistry = listedCron === cron;
  let proof;
  if (listedCron == null) {
    proof =
      `Add ${id} to INNGEST_JOBS in src/pulse/heartbeats.mjs (cron ${cron}). ` +
      `Red after ${redAfter} with no heartbeat. Do not auto-fix from this pulse.`;
  } else if (listedCron !== cron) {
    proof =
      `Pulse job list has ${id} on ${listedCron}; the workflow cron is ${cron}. ` +
      `Red after ${redAfter} with no heartbeat. Do not auto-fix from this pulse.`;
  } else {
    proof =
      `PASS — ${id} is on the pulse job list (cron ${cron}). ` +
      `Red after ${redAfter} with no heartbeat.`;
  }
  return { id, schedule, redAfter, alreadyInRegistry, proof };
}

function eventRow(id, eventName) {
  const schedule = eventName;
  const redAfter = `3x ${schedule}`;
  const alreadyInRegistry = listed.has(id);
  return {
    id,
    schedule,
    redAfter,
    alreadyInRegistry,
    proof: alreadyInRegistry
      ? "PASS"
      : `Add a pulse registry row for workflow ${id} (event ${eventName}). Do not auto-fix from this pulse.`
  };
}

function buildChecks() {
  const rows = [];
  let sawU05 = false;
  for (const fn of functions) {
    const id = fn && fn.opts && fn.opts.id;
    if (!id || ownedByNamedSlice(id)) continue;
    const triggers = triggersOf(fn);
    const crons = triggers.map((t) => t.cron).filter(Boolean);
    if (crons.length) {
      rows.push(cronRow(id, crons[0]));
      continue;
    }
    if (id === U05_ID) {
      sawU05 = true;
      const events = triggers.map((t) => t.event).filter(Boolean);
      rows.push(eventRow(id, events[0] || "analysis.completed"));
    }
  }
  if (!sawU05) rows.push(eventRow(U05_ID, "analysis.completed"));
  rows.sort((a, b) => a.id.localeCompare(b.id));
  return rows;
}

export const CHECKS = buildChecks();

/**
 * True when a row is red: missing from the pulse list, or the last heartbeat
 * is older than 3 times the schedule. No timestamp means silence is unknown.
 * @param {{ id?: string, alreadyInRegistry?: boolean }} row
 * @param {{ lastHeartbeatAt?: Date|string|null, now?: Date }} [opts]
 */
export function isRed(row, { lastHeartbeatAt = null, now = new Date() } = {}) {
  if (!row || !row.alreadyInRegistry) return true;
  if (lastHeartbeatAt == null || lastHeartbeatAt === "") return false;
  const at = lastHeartbeatAt instanceof Date ? lastHeartbeatAt : new Date(lastHeartbeatAt);
  if (!Number.isFinite(at.getTime())) return false;
  const cron = cronById.get(row.id);
  if (!cron) return false;
  const interval = cronIntervalMs(cron);
  const age = now.getTime() - at.getTime();
  if (interval) return age > STALE_MULTIPLE * interval;
  if (scheduleLabel(cron) === "monthly") return age > STALE_MULTIPLE * MONTHLY_MS;
  return false;
}

/** Rows the morning pulse does not list yet. Does not edit anything. */
export function gaps(checks = CHECKS) {
  return checks.filter((row) => !row.alreadyInRegistry);
}
