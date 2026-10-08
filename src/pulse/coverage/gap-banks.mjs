// Banks missing on the money screen. Report only. Read-only SQL.
//
// Slice 07 lists Finance OS jobs. Slice 08 lists whether the bank sync is on
// the machine list and whether the sync doors are in the registry. This file
// does not repeat either list. It reads rows that mean a bank is saved but
// the money screen would not show it.
//
// The money screen is GET /api/money/overview (src/finance/money-overview.mjs
// ACCOUNT_SQL). It keeps an account only when client and company match, then
// drops closed accounts on purpose. A closed account is not a gap.
//
// No Plaid call. No token exchange. The access token column is never selected.
// Recon (AG-07) is the one tripwire. Do not add another watcher.

import { cronIntervalMs, STALE_MULTIPLE } from "../heartbeats.mjs";
import {
  SOURCE_WORKFLOW as PLAID_SYNC_JOB,
  SWEEP_CRON as PLAID_SYNC_CRON
} from "../../workflows/plaid-transactions-sweeper.mjs";

export const PLAID_SYNC_JOB_ID = PLAID_SYNC_JOB;

const INTERVAL_MS = cronIntervalMs(PLAID_SYNC_CRON);
/** Daily bank sync is red after 3 times its schedule (3 days). */
export const RED_AFTER_MS = INTERVAL_MS == null ? null : INTERVAL_MS * STALE_MULTIPLE;

const HOUR_MS = 60 * 60 * 1000;

export const ERROR_SQL = `
  SELECT count(*)::int AS n,
         (array_agg(last_error_code ORDER BY last_error_at DESC NULLS LAST))[1] AS last_code
    FROM plaid_items
   WHERE link_state = 'error'
     AND ($1::uuid IS NULL OR org_id = $1::uuid)`;

/* Open linked account the overview WHERE would miss for the login's client.
   Closed rows are left out of this count on purpose. */
export const HIDDEN_SQL = `
  SELECT count(*)::int AS n
    FROM bank_accounts a
    JOIN plaid_items p ON p.id = a.plaid_item_id
    LEFT JOIN clients c ON c.id = a.client_id
   WHERE a.plaid_item_id IS NOT NULL
     AND a.closed_at IS NULL
     AND ($1::uuid IS NULL OR a.org_id = $1::uuid OR p.org_id = $1::uuid)
     AND (
       c.id IS NULL
       OR a.org_id IS DISTINCT FROM c.org_id
       OR a.client_id IS DISTINCT FROM p.client_id
       OR a.org_id IS DISTINCT FROM p.org_id
     )`;

export const STALE_SQL = `
  SELECT
    (SELECT count(*)::int
       FROM plaid_items p
      WHERE p.link_state = 'active'
        AND p.consent_granted_at IS NOT NULL
        AND p.encrypted_access_token IS NOT NULL
        AND p.plaid_item_id IS NOT NULL
        AND ($1::uuid IS NULL OR p.org_id = $1::uuid)) AS active_links,
    (SELECT max(finished_at) FROM job_heartbeats WHERE job = $2) AS last_at,
    (SELECT (array_agg(outcome ORDER BY finished_at DESC))[1]
       FROM job_heartbeats WHERE job = $2) AS last_outcome,
    (SELECT min(finished_at) FROM job_heartbeats) AS first_ever`;

/* A live login with no account row under it. The money screen reads
   bank_accounts, so that client sees no bank for the login. */
export const EMPTY_SQL = `
  SELECT count(*)::int AS items,
         count(DISTINCT p.client_id)::int AS clients
    FROM plaid_items p
   WHERE p.link_state = 'active'
     AND p.consent_granted_at IS NOT NULL
     AND p.encrypted_access_token IS NOT NULL
     AND p.plaid_item_id IS NOT NULL
     AND ($1::uuid IS NULL OR p.org_id = $1::uuid)
     AND NOT EXISTS (
       SELECT 1 FROM bank_accounts a
        WHERE a.plaid_item_id = p.id
          AND a.org_id = p.org_id
          AND a.client_id = p.client_id
     )`;

export const SQL = Object.freeze([ERROR_SQL, HIDDEN_SQL, STALE_SQL, EMPTY_SQL]);

function check(id, status, detail, suggestedFix = null) {
  return { id, status, detail, suggestedFix };
}

function fix(what) {
  return (
    `${what} Recon (AG-07) reports this on the morning pulse. ` +
    "Do not call Plaid. Do not exchange tokens. Do not add another watcher. Do not auto-fix."
  );
}

function reader(ctx) {
  if (ctx && typeof ctx.scope === "function") return ctx.scope;
  const db = ctx && ctx.db;
  if (db && typeof db.query === "function") return (fn) => fn(db);
  return null;
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function toDate(v) {
  if (v == null || v === "") return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isFinite(d.getTime()) ? d : null;
}

function clip(s, n = 160) {
  return String(s == null ? "" : s).replace(/\s+/g, " ").trim().slice(0, n);
}

function noun(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

function ageWords(ms) {
  const h = ms / HOUR_MS;
  if (h < 36) return `${Math.max(1, Math.round(h))} hours`;
  return `${Math.round(h / 24)} days`;
}

function judgeError(row) {
  const id = "banks-plaid-item-error";
  const n = num(row && row.n);
  if (n === 0) return check(id, "PASS", "No bank login is in error.");
  const code = row && row.last_code ? ` Last code: ${clip(row.last_code, 80)}.` : "";
  return check(
    id,
    "FAIL",
    `${noun(n, "bank login is", "bank logins are")} in error, so the money screen cannot refresh ${n === 1 ? "that bank" : "those banks"}.${code}`,
    fix("The client has to sign in at the bank again.")
  );
}

function judgeHidden(row) {
  const id = "banks-linked-not-on-screen";
  const n = num(row && row.n);
  if (n === 0) {
    return check(id, "PASS", "Every open linked bank account matches the client and company the money screen reads.");
  }
  return check(
    id,
    "FAIL",
    `${noun(n, "open bank account is", "open bank accounts are")} saved and linked, but the money screen read would not return ${n === 1 ? "it" : "them"}. The client or company on the account does not match the bank login.`,
    fix("Read bank_accounts against plaid_items and clients. Do not change rows from this check.")
  );
}

function judgeStale(row, now) {
  const id = "banks-sync-stale";
  const active = num(row && row.active_links);
  if (active === 0) {
    return check(id, "skip", "No live bank login, so a quiet sync is not a missing bank on the screen.");
  }
  if (RED_AFTER_MS == null) {
    return check(id, "skip", `Schedule "${PLAID_SYNC_CRON}" is a shape this check does not read.`);
  }
  const last = toDate(row && row.last_at);
  const first = toDate(row && row.first_ever);
  const nowMs = now.getTime();
  const dueBy = nowMs - RED_AFTER_MS;
  const lateFix = fix(
    `Read the ${PLAID_SYNC_JOB_ID} receipt. It runs daily (${PLAID_SYNC_CRON}) and is late after 3 days.`
  );
  if (!last) {
    if (!first) {
      return check(id, "skip", "No job receipt yet, so the bank sync has not been timed.");
    }
    if (first.getTime() > dueBy) {
      return check(id, "skip", "Job receipts just started. Too soon to call the bank sync late.");
    }
    return check(
      id,
      "FAIL",
      `A live bank login is on file, and the bank sync has no receipt since receipts started ${ageWords(nowMs - first.getTime())} ago.`,
      lateFix
    );
  }
  const age = nowMs - last.getTime();
  if (age > RED_AFTER_MS) {
    return check(
      id,
      "FAIL",
      `The bank sync last finished ${ageWords(age)} ago. It runs every day and is late after 3 days, so banks on the money screen can be missing or old.`,
      lateFix
    );
  }
  if (row && row.last_outcome === "error") {
    return check(
      id,
      "FAIL",
      `The bank sync ran ${ageWords(age)} ago and the last pass failed, so banks on the money screen can be missing.`,
      lateFix
    );
  }
  return check(id, "PASS", `The bank sync last finished ${ageWords(age)} ago. That is inside 3 days.`);
}

function judgeEmpty(row) {
  const id = "banks-active-link-no-accounts";
  const clients = num(row && row.clients);
  const items = num(row && row.items);
  if (clients === 0 && items === 0) {
    return check(id, "PASS", "Every live bank login has at least one account saved.");
  }
  const who = clients > 0
    ? noun(clients, "client has", "clients have")
    : noun(items, "bank login has", "bank logins have");
  const extra = clients > 0 && items > clients
    ? ` That is ${noun(items, "login", "logins")} with no account under them.`
    : "";
  return check(
    id,
    "FAIL",
    `${who} a live bank login and no account saved, so the money screen shows no bank for that login.${extra}`,
    fix("The login is active and no account row was saved under it.")
  );
}

async function one(run, id, sql, params, judge) {
  try {
    const res = await run((db) => db.query(sql, params));
    const row = res && Array.isArray(res.rows) ? res.rows[0] : null;
    return judge(row || {});
  } catch (err) {
    return check(
      id,
      "FAIL",
      `Could not read ${id}: ${clip((err && err.message) || err)}`,
      fix("Fix the read. Do not change bank rows from this check.")
    );
  }
}

/**
 * gapChecks(ctx) → [{ id, status, detail, suggestedFix }]
 * status is PASS, FAIL, or skip.
 * ctx: { db } or { scope }, optional { now, orgId }.
 * SELECT only. Never calls Plaid.
 */
export async function gapChecks(ctx = {}) {
  const run = reader(ctx);
  if (!run) {
    return [
      check("banks-plaid-item-error", "skip", "No database in this run. Bank logins were not read."),
      check("banks-linked-not-on-screen", "skip", "No database in this run. Bank accounts were not read."),
      check("banks-sync-stale", "skip", "No database in this run. The bank sync receipt was not read."),
      check("banks-active-link-no-accounts", "skip", "No database in this run. Bank logins were not read.")
    ];
  }
  const now = toDate(ctx.now) || new Date();
  const orgId = ctx.orgId || null;
  const [errorRow, hiddenRow, staleRow, emptyRow] = await Promise.all([
    one(run, "banks-plaid-item-error", ERROR_SQL, [orgId], judgeError),
    one(run, "banks-linked-not-on-screen", HIDDEN_SQL, [orgId], judgeHidden),
    one(run, "banks-sync-stale", STALE_SQL, [orgId, PLAID_SYNC_JOB_ID], (row) => judgeStale(row, now)),
    one(run, "banks-active-link-no-accounts", EMPTY_SQL, [orgId], judgeEmpty)
  ]);
  return [errorRow, hiddenRow, staleRow, emptyRow];
}
