// Sales manager view: team numbers, show rate, close rate, and the floor.
// Read only. Report only. Do not edit a page.
//
// slice-20-sales.mjs already names the sales jobs (s-00 through s-08).
// This file does not repeat those jobs. It does not list the morning doors.
// Another lane owns the closer desk and call recordings. This file does not
// open that desk and does not read tapes.
//
// Recon (AG-07) is the one tripwire. No second watchdog.
//
// Review notes (Claude, 2026-10-08):
//   * The first check read three source files from disk (netlify/functions/api.mjs,
//     api/read/sales-floor.mjs, api/read/my-numbers.mjs). The shipped function holds
//     none of them as files, so it read FAIL every morning ("route file could not
//     be read"). That part is gone.
//   * The same check sent a signed-out GET to the two read doors. The registry
//     already does exactly that every morning (read/sales-floor and read/my-numbers,
//     plus the two pages), and a signed-out ping answers 401 whether or not the
//     data behind the door works. A 500 behind the sign-in could never
//     show. This check now runs the data reads the two doors run once you are
//     signed in (salesFloor and closerMyNumbers), inside this process.
//   * salesFloor tries to attach loose Drive recordings to calls, which writes. That
//     write is held back here (readOnlyDb). Only a plain read runs: it must start with
//     SELECT, WITH or VALUES (after any notes), change no row, take no lock, call no
//     function that changes state, and be one statement. Every other statement is
//     dropped. Nothing is saved. A note or a WITH in front of a write does not get it past.
//   * Totals used to run a copy of the funnel SQL. A copy can pass while the real
//     page is broken. Totals now check the numbers salesFloor itself returns.
//   * A suspended closer who took sales this month is left off the floor on purpose
//     (the floor lists active closers). That used to read FAIL for the rest of the
//     month. It is not a miss now.

import { orgDemoModeEnabled } from "../../demo/exclude-demo.mjs";
import {
  belongsOnCloserBoard,
  closerMyNumbers,
  closerRoster,
  monthWindow,
  salesFloor
} from "../../sales/metrics.mjs";

export const CHECK_IDS = Object.freeze([
  "sales-manager:read-api",
  "sales-manager:totals",
  "sales-manager:dropped-closer"
]);

export const SALES_FLOOR_PATH = "/api/read/sales-floor";
export const MY_NUMBERS_PATH = "/api/read/my-numbers";

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

/** Someone to read "my numbers" for: an active closer first, any active staff after. */
export const NUMBERS_STAFF_SQL = `
  /* gap:sales-manager-numbers-staff */
  SELECT s.id::text AS staff_id
    FROM staff s
   WHERE s.org_id = $1::uuid
     AND s.status = 'active'
     AND COALESCE(s.is_demo, false) = false
   ORDER BY (lower(btrim(s.role)) = 'closer') DESC, s.created_at
   LIMIT 1
`;

const RECON =
  "Recon (AG-07) is the one tripwire. Leave that agent on the morning pulse. " +
  "Do not auto-fix. Do not add another watcher. Do not open the closer desk.";

const READ_TIMEOUT_MS = 12000;

function row(id, status, detail, suggestedFix = null) {
  return { id, status, detail, suggestedFix };
}

function clip(err) {
  return String(err?.message || err).replace(/\s+/g, " ").trim().slice(0, 180);
}

function hasSales(seller) {
  return Number(seller?.deposits || 0) > 0 || Number(seller?.cash_cents || 0) > 0;
}

function num(value) {
  return value != null && value !== "" && Number.isFinite(Number(value));
}

function rateOk(value) {
  return value == null || (num(value) && Number(value) >= 0 && Number(value) <= 1);
}

// Comments and quoted text are blanked first. A word like "update" inside a note or a
// string is then not read as a command, and a command cannot hide behind a note.
// Block comments are not nested here on purpose: when this guard and Postgres disagree
// about where a note ends, the guard sees more code, never less.
function bareSql(sql) {
  const src = String(sql == null ? "" : sql);
  let out = "";
  let i = 0;
  while (i < src.length) {
    const two = src.slice(i, i + 2);
    if (two === "--") {
      const end = src.indexOf("\n", i);
      out += " ";
      i = end === -1 ? src.length : end;
      continue;
    }
    if (two === "/*") {
      const end = src.indexOf("*/", i + 2);
      out += " ";
      i = end === -1 ? src.length : end + 2;
      continue;
    }
    const ch = src[i];
    if (ch === "'" || ch === '"') {
      let j = i + 1;
      while (j < src.length) {
        if (src[j] === ch) {
          if (src[j + 1] === ch) { j += 2; continue; }
          break;
        }
        j += 1;
      }
      out += ch + ch;
      i = j + 1;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

// A plain read starts with SELECT, WITH or VALUES. It may not change a row, take a lock,
// write a table (SELECT INTO), or run a second statement.
const STARTS_AS_READ = /^\(*\s*(?:select|with|values)\b/i;
const CHANGES_DATA = /\b(?:insert|update|delete|merge|into|truncate)\b|\bfor\s+(?:key\s+)?share\b/i;
// Functions that change state even inside a SELECT. The reads this lane runs call none
// of them; they use only built-in read functions (checked 2026-10-08).
const SIDE_EFFECT_FN = /\b(?:pg_advisory\w*|set_config|nextval|setval|pg_notify|pg_terminate_backend|pg_cancel_backend|pg_reload_conf|lo_\w+|dblink\w*)\s*\(/i;

/**
 * True when this statement is a plain read. Anything else is dropped by readOnlyDb.
 * A SELECT that calls an app function that itself writes cannot be seen from the text;
 * none of the reads here call one.
 */
export function isPlainRead(sql) {
  const text = bareSql(sql).trim();
  if (!STARTS_AS_READ.test(text)) return false;
  if (/;\s*\S/.test(text)) return false;
  if (/\$[A-Za-z_]*\$/.test(text)) return false;
  if (CHANGES_DATA.test(text)) return false;
  if (SIDE_EFFECT_FN.test(text)) return false;
  return true;
}

/**
 * A database that runs plain reads and drops everything else. salesFloor attaches loose
 * recordings to calls as it reads, and that is a write. Here it gets an empty answer
 * and nothing is saved. `held` lists the statements that were dropped.
 */
export function readOnlyDb(db) {
  const held = [];
  return {
    held,
    async query(sql, params) {
      const text = typeof sql === "string" ? sql : sql && sql.text;
      if (!isPlainRead(text)) {
        held.push(String(text == null ? "" : text).replace(/\s+/g, " ").trim().slice(0, 60));
        return { rows: [], rowCount: 0 };
      }
      return db.query(sql, params);
    }
  };
}

function withTimeout(promise, ms, label) {
  let timer;
  const stop = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} took longer than ${Math.round(ms / 1000)} seconds`)), ms);
  });
  return Promise.race([promise, stop]).finally(() => clearTimeout(timer));
}

/** What the sales floor page needs to find in the answer, or why it cannot paint. */
export function floorShapeProblem(floor) {
  if (!floor || typeof floor !== "object") return "came back empty";
  if (!floor.hero || typeof floor.hero !== "object") return "came back with no team numbers";
  if (!floor.funnel || typeof floor.funnel !== "object") return "came back with no funnel numbers";
  if (!Array.isArray(floor.closers)) return "came back with no closer list";
  return null;
}

/** What the my numbers page needs to find in the answer, or why it cannot paint. */
export function mineShapeProblem(mine) {
  if (!mine || typeof mine !== "object") return "came back empty";
  if (!mine.pace || typeof mine.pace !== "object") return "came back with no pace numbers";
  if (!mine.month || typeof mine.month !== "object") return "came back with no month numbers";
  if (!Array.isArray(mine.team)) return "came back with no team list";
  return null;
}

/** Why the team numbers on the floor cannot be trusted, in plain words. Empty means fine. */
export function totalsProblems(floor) {
  const hero = floor && floor.hero;
  const funnel = floor && floor.funnel;
  if (!hero || !funnel) return ["the team numbers block is missing"];
  const out = [];
  if (!num(hero.cash_cents) || Number(hero.cash_cents) < 0) out.push("team cash is not a number");
  for (const [key, label] of [["booked", "booked calls"], ["held", "held calls"], ["deposits", "deposits"]]) {
    if (!num(funnel[key]) || Number(funnel[key]) < 0) out.push(`${label} is not a number`);
  }
  if (!rateOk(funnel.show_rate)) out.push("show rate is not between 0 and 1");
  if (!rateOk(funnel.close_rate)) out.push("close rate is not between 0 and 1");
  if (!rateOk(hero.deposit_to_funded)) out.push("deposit to funded rate is not between 0 and 1");
  return out;
}

async function readFloor({ ro, orgId, now, reads, timeoutMs }) {
  try {
    // env is empty on purpose: the floor then does not look for the Drive keys.
    const floor = await withTimeout(reads.salesFloor(ro, { orgId, now, env: {} }), timeoutMs, "the sales floor read");
    // The page gets this as JSON. A value that cannot be printed is a 500 as well.
    JSON.stringify(floor);
    return { ok: true, floor };
  } catch (err) {
    return { ok: false, error: clip(err) };
  }
}

async function readMine({ ro, orgId, now, reads, timeoutMs }) {
  let staffId = null;
  try {
    const found = await ro.query(NUMBERS_STAFF_SQL, [orgId]);
    staffId = found?.rows?.[0]?.staff_id || null;
  } catch (err) {
    return { ok: false, error: `could not pick a closer to read (${clip(err)})` };
  }
  if (!staffId) return { ok: true, skipped: true };
  try {
    const mine = await withTimeout(reads.closerMyNumbers(ro, { orgId, staffId, now }), timeoutMs, "the my numbers read");
    JSON.stringify(mine);
    return { ok: true, mine };
  } catch (err) {
    return { ok: false, error: clip(err) };
  }
}

function checkReadApi({ floorRead, mineRead }) {
  const id = "sales-manager:read-api";
  if (!floorRead || !mineRead) {
    return row(id, "skip", "no database in this run — sales floor and my numbers reads not run");
  }
  const parts = [];
  if (!floorRead.ok) {
    parts.push(`the sales floor read failed (${floorRead.error})`);
  } else {
    const bad = floorShapeProblem(floorRead.floor);
    if (bad) parts.push(`the sales floor read ${bad}`);
  }
  if (!mineRead.ok) {
    parts.push(`the my numbers read failed (${mineRead.error})`);
  } else if (!mineRead.skipped) {
    const bad = mineShapeProblem(mineRead.mine);
    if (bad) parts.push(`the my numbers read ${bad}`);
  }
  if (parts.length > 0) {
    return row(
      id,
      "FAIL",
      `sales floor or my numbers read API would answer 500: ${parts.join("; ")}.`,
      `${RECON} Restore the reads behind GET ${SALES_FLOOR_PATH} and GET ${MY_NUMBERS_PATH}.`
    );
  }
  const tail = mineRead.skipped ? " (no staff row to read my numbers for)" : "";
  return row(id, "PASS", `sales floor and my numbers reads worked for a signed-in manager${tail}`);
}

function checkTotals({ floorRead }) {
  const id = "sales-manager:totals";
  if (!floorRead) {
    return row(id, "skip", "no database in this run — manager totals not read");
  }
  if (!floorRead.ok) {
    return row(
      id,
      "FAIL",
      `manager totals cannot be read: ${floorRead.error}`,
      `${RECON} Read team cash, show rate, and close rate on the sales floor.`
    );
  }
  const bad = totalsProblems(floorRead.floor);
  if (bad.length > 0) {
    return row(
      id,
      "FAIL",
      `manager totals cannot be read (${bad.join("; ")}).`,
      `${RECON} Read team cash, show rate, and close rate on the sales floor.`
    );
  }
  const f = floorRead.floor.funnel;
  return row(
    id,
    "PASS",
    `manager totals can be read (team cash, show rate, and close rate): ${Number(f.booked)} booked, ${Number(f.held)} held, ${Number(f.deposits)} deposits this month.`
  );
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
 * A suspended person is off the floor on purpose, so that is not a miss either.
 */
export function closersMissingFromRollup(sellers, roster, demoMode = false) {
  const ids = new Set((roster || []).map((c) => String(c.staff_id)));
  const dropped = [];
  for (const seller of sellers || []) {
    if (!hasSales(seller)) continue;
    if (String(seller.status ?? "active").trim().toLowerCase() !== "active") continue;
    if (!belongsOnCloserBoard(seller, { demoMode })) continue;
    if (ids.has(String(seller.staff_id))) continue;
    dropped.push(seller);
  }
  return dropped;
}

async function checkDropped({ ro, orgId, period, now }) {
  const id = "sales-manager:dropped-closer";
  if (!ro) {
    return row(id, "skip", "no database in this run — manager rollup not read");
  }
  try {
    const demoMode = await orgDemoModeEnabled(ro, orgId);
    const [sellersResult, roster] = await Promise.all([
      ro.query(SELLERS_SQL, [orgId, period.start.toISOString(), period.end.toISOString()]),
      closerRoster(ro, { orgId, start: period.start, end: period.end, now })
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
 * Three read-only checks. ctx: { db, orgId, now }. reads and timeoutMs are for tests.
 * Each row is { id, status, detail, suggestedFix } with status PASS, FAIL, or skip.
 * The signed-out ping of the two read doors is the registry's job, not this file's.
 */
export async function gapChecks(ctx = {}) {
  const db = ctx.db || null;
  const orgId = ctx.orgId || null;
  const now = ctx.now instanceof Date ? ctx.now : new Date();
  const reads = { salesFloor, closerMyNumbers, ...(ctx.reads || {}) };
  const timeoutMs = Number.isFinite(ctx.timeoutMs) && ctx.timeoutMs > 0 ? ctx.timeoutMs : READ_TIMEOUT_MS;
  const ro = db && typeof db.query === "function" && orgId ? readOnlyDb(db) : null;
  const period = monthWindow(now);
  if (!ro) {
    return [
      checkReadApi({ floorRead: null, mineRead: null }),
      checkTotals({ floorRead: null }),
      await checkDropped({ ro: null, orgId, period, now })
    ];
  }
  const [floorRead, mineRead, dropped] = await Promise.all([
    readFloor({ ro, orgId, now, reads, timeoutMs }),
    readMine({ ro, orgId, now, reads, timeoutMs }),
    checkDropped({ ro, orgId, period, now })
  ]);
  return [
    checkReadApi({ floorRead, mineRead }),
    checkTotals({ floorRead }),
    dropped
  ];
}
