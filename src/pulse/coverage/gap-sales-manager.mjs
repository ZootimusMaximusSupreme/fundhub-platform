// Sales manager view: team numbers, show rate, close rate, and the floor.
// Read only. Report only. Do not edit a page.
//
// slice-20-sales.mjs already names the sales jobs (s-00 through s-08).
// This file does not repeat those jobs. It does not list the morning doors.
// Another lane owns the closer desk and call recordings. This file does not
// open that desk and does not read tapes.
//
// Recon (AG-07) is the one tripwire. No second watchdog.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { orgDemoModeEnabled } from "../../demo/exclude-demo.mjs";
import { belongsOnCloserBoard, closerRoster, monthWindow } from "../../sales/metrics.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

export const CHECK_IDS = Object.freeze([
  "sales-manager:read-api",
  "sales-manager:totals",
  "sales-manager:dropped-closer"
]);

export const SALES_FLOOR_PATH = "/api/read/sales-floor";
export const MY_NUMBERS_PATH = "/api/read/my-numbers";

/** Team cash, show rate, and close rate — the same counts the floor paints. */
export const TOTALS_SQL = `
  /* gap:sales-manager-totals */
  SELECT
    (SELECT count(DISTINCT e.client_id)::int
       FROM events e
      WHERE e.org_id = $1::uuid
        AND e.name = 'booking.created'
        AND e.created_at >= $2::timestamptz
        AND e.created_at < $3::timestamptz
        AND e.client_id IS NOT NULL) AS booked,
    (SELECT count(*) FILTER (WHERE o.outcome <> 'no_show')::int
       FROM call_outcomes o
      WHERE o.org_id = $1::uuid
        AND o.logged_at >= $2::timestamptz
        AND o.logged_at < $3::timestamptz) AS held,
    (SELECT count(*) FILTER (WHERE o.outcome = 'deposit')::int
       FROM call_outcomes o
      WHERE o.org_id = $1::uuid
        AND o.logged_at >= $2::timestamptz
        AND o.logged_at < $3::timestamptz) AS deposits,
    (SELECT COALESCE(SUM(o.cash_collected_cents), 0)::bigint
       FROM call_outcomes o
      WHERE o.org_id = $1::uuid
        AND o.logged_at >= $2::timestamptz
        AND o.logged_at < $3::timestamptz) AS cash_cents
`;

/** Closers (and the owner-set closer) who took a deposit or cash this month. */
export const SELLERS_SQL = `
  /* gap:sales-manager-sellers */
  SELECT s.id::text AS staff_id,
         s.name,
         s.email,
         s.role,
         s.status,
         COALESCE(s.is_demo, false) AS is_demo,
         count(*) FILTER (WHERE o.outcome = 'deposit')::int AS deposits,
         COALESCE(SUM(o.cash_collected_cents), 0)::bigint AS cash_cents
    FROM staff s
    JOIN call_outcomes o ON o.staff_id = s.id AND o.org_id = s.org_id
   WHERE s.org_id = $1::uuid
     AND o.logged_at >= $2::timestamptz
     AND o.logged_at < $3::timestamptz
     AND COALESCE(o.is_demo, false) = false
   GROUP BY s.id, s.name, s.email, s.role, s.status, s.is_demo
  HAVING count(*) FILTER (WHERE o.outcome = 'deposit') > 0
      OR COALESCE(SUM(o.cash_collected_cents), 0) > 0
`;

const RECON =
  "Recon (AG-07) is the one tripwire. Leave that agent on the morning pulse. " +
  "Do not auto-fix. Do not add another watcher. Do not open the closer desk.";

function row(id, status, detail, suggestedFix = null) {
  return { id, status, detail, suggestedFix };
}

function clip(err) {
  return String(err?.message || err).replace(/\s+/g, " ").trim().slice(0, 180);
}

function defaultReadText(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function finiteField(record, key) {
  if (!record || record[key] == null || record[key] === "") return false;
  return Number.isFinite(Number(record[key]));
}

function hasSales(seller) {
  return Number(seller?.deposits || 0) > 0 || Number(seller?.cash_cents || 0) > 0;
}

function apiAlive(status) {
  return (
    (status >= 200 && status < 400) ||
    status === 400 ||
    status === 401 ||
    status === 403 ||
    status === 405
  );
}

function routeWired(api, handler, { importRe, routeRe, callRe }) {
  return importRe.test(api)
    && routeRe.test(api)
    && /req\.method !== ["']GET["']/.test(handler)
    && /export default async function handler/.test(handler)
    && callRe.test(handler);
}

/** True when GET sales floor and GET my numbers are still wired. No HTTP call. */
export function salesManagerRoutesWired(readText = defaultReadText) {
  const api = String(readText("netlify/functions/api.mjs") ?? "");
  const floor = String(readText("api/read/sales-floor.mjs") ?? "");
  const mine = String(readText("api/read/my-numbers.mjs") ?? "");
  return {
    floor: routeWired(api, floor, {
      importRe: /import readSalesFloor from ["'][^"']*sales-floor\.mjs["']/,
      routeRe: /["']read\/sales-floor["']\s*:\s*readSalesFloor/,
      callRe: /salesFloor\(/
    }),
    mine: routeWired(api, mine, {
      importRe: /import readMyNumbers from ["'][^"']*my-numbers\.mjs["']/,
      routeRe: /["']read\/my-numbers["']\s*:\s*readMyNumbers/,
      callRe: /closerMyNumbers\(/
    })
  };
}

function originOf(baseUrl) {
  return String(baseUrl || "https://fundhub.ai").trim().replace(/\/+$/, "") || "https://fundhub.ai";
}

async function readGet(fetchImpl, url) {
  const res = await fetchImpl(url, {
    method: "GET",
    headers: { accept: "application/json" }
  });
  return Number(res && res.status);
}

async function checkReadApi({ fetchImpl, baseUrl, readText }) {
  const id = "sales-manager:read-api";
  const parts = [];
  let wired = null;
  try {
    wired = salesManagerRoutesWired(readText);
  } catch (err) {
    parts.push(`route file could not be read (${clip(err)})`);
  }
  if (wired && !wired.floor) parts.push("sales floor read is not wired");
  if (wired && !wired.mine) parts.push("my numbers read is not wired");

  if (fetchImpl) {
    const origin = originOf(baseUrl);
    const doors = [
      ["sales floor", SALES_FLOOR_PATH],
      ["my numbers", MY_NUMBERS_PATH]
    ];
    for (const [label, door] of doors) {
      try {
        const status = await readGet(fetchImpl, `${origin}${door}`);
        if (!apiAlive(status)) parts.push(`${label} read API answered ${status || "no status"}`);
      } catch (err) {
        parts.push(`${label} read unreachable (${clip(err)})`);
      }
    }
  }

  if (parts.length > 0) {
    return row(
      id,
      "FAIL",
      `sales floor or my numbers read API failed: ${parts.join("; ")}.`,
      `${RECON} Restore GET ${SALES_FLOOR_PATH} and GET ${MY_NUMBERS_PATH}.`
    );
  }
  if (!fetchImpl) {
    return row(id, "skip", "sales floor and my numbers reads not called this run");
  }
  return row(id, "PASS", "sales floor and my numbers reads answered");
}

async function checkTotals({ db, orgId, period }) {
  const id = "sales-manager:totals";
  if (!db || !orgId) {
    return row(id, "skip", "no database in this run — manager totals not read");
  }
  try {
    const result = await db.query(TOTALS_SQL, [
      orgId,
      period.start.toISOString(),
      period.end.toISOString()
    ]);
    const record = result?.rows?.[0];
    const keys = ["booked", "held", "deposits", "cash_cents"];
    if (!keys.every((key) => finiteField(record, key))) {
      return row(
        id,
        "FAIL",
        "manager totals cannot be read (team cash, show rate, or close rate was not a number).",
        `${RECON} Read team cash, show rate, and close rate on the sales floor.`
      );
    }
    return row(id, "PASS", "manager totals can be read (team cash, show rate, and close rate).");
  } catch (err) {
    return row(
      id,
      "FAIL",
      `manager totals cannot be read: ${clip(err)}`,
      `${RECON} Read team cash, show rate, and close rate on the sales floor.`
    );
  }
}

function droppedDetail(people) {
  const names = people.slice(0, 5).map((p) => String(p.name || "A closer").trim() || "A closer");
  const listed = names.join(", ");
  if (people.length === 1) {
    return `1 closer has sales and the manager rollup drops them (${listed}).`;
  }
  return `${people.length} closers have sales and the manager rollup drops them (${listed}).`;
}

/**
 * People who belong on the floor and have sales, but closerRoster left them off.
 * Blocked practice names and demo rows (when demo mode is off) are not a fail.
 */
export function closersMissingFromRollup(sellers, roster, demoMode = false) {
  const ids = new Set((roster || []).map((c) => String(c.staff_id)));
  const dropped = [];
  for (const seller of sellers || []) {
    if (!hasSales(seller)) continue;
    if (!belongsOnCloserBoard(seller, { demoMode })) continue;
    if (ids.has(String(seller.staff_id))) continue;
    dropped.push(seller);
  }
  return dropped;
}

async function checkDropped({ db, orgId, period, now }) {
  const id = "sales-manager:dropped-closer";
  if (!db || !orgId) {
    return row(id, "skip", "no database in this run — manager rollup not read");
  }
  try {
    const demoMode = await orgDemoModeEnabled(db, orgId);
    const [sellersResult, roster] = await Promise.all([
      db.query(SELLERS_SQL, [orgId, period.start.toISOString(), period.end.toISOString()]),
      closerRoster(db, { orgId, start: period.start, end: period.end, now })
    ]);
    const dropped = closersMissingFromRollup(sellersResult?.rows, roster, demoMode);
    if (dropped.length === 0) {
      return row(id, "PASS", "no closer with sales is missing from the manager rollup");
    }
    return row(
      id,
      "FAIL",
      droppedDetail(dropped),
      `${RECON} Put that closer back on the sales floor rollup.`
    );
  } catch (err) {
    return row(
      id,
      "FAIL",
      `manager rollup cannot be read: ${clip(err)}`,
      `${RECON} Read the sales floor closer list.`
    );
  }
}

/**
 * Three read-only checks. ctx: { db, orgId, now, fetchImpl, baseUrl, readText }.
 * Each row is { id, status, detail, suggestedFix } with status PASS, FAIL, or skip.
 */
export async function gapChecks(ctx = {}) {
  const db = ctx.db || null;
  const orgId = ctx.orgId || null;
  const now = ctx.now instanceof Date ? ctx.now : new Date();
  const fetchImpl = ctx.fetchImpl || null;
  const readText = typeof ctx.readText === "function" ? ctx.readText : defaultReadText;
  const hasDb = Boolean(db && orgId);
  const period = monthWindow(now);
  return [
    await checkReadApi({ fetchImpl, baseUrl: ctx.baseUrl, readText }),
    await checkTotals({ db: hasDb ? db : null, orgId, period }),
    await checkDropped({ db: hasDb ? db : null, orgId, period, now })
  ];
}
