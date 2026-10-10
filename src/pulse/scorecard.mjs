// The morning scorecard — board contract shape, stored in the database.
// MB2, 2026-10-05. Contract: ops/workflows/morning-brief-2026-10-05.md,
// "Scorecard contract". Table: pulse_scorecards (db/migrations/430).
//
//   { date, ran_at, checks: [{ id, group, status, proof, customer_sees,
//                              since, day_count, fix }] }
//
// Rules this file enforces (spec, "Rules for the systems check"):
//   - green means it ran and passed, WITH proof. A green with no proof is
//     downgraded to not_checked — a pass with nothing behind it is not a pass.
//   - not_checked is never green and never counted as a pass.
//   - na ("nothing to judge today", the 2026-10-09 zero-unchecked build) is allowed
//     only with a code from src/pulse/na-conditions.mjs and the args that make it
//     true. A row that says na with no such object is not_checked. The self-audit
//     (src/pulse/self-audit.mjs) re-checks the code every morning.
//   - the same red on a second morning says day 2 (since + day_count carried
//     from the previous stored morning).

import { naProblem, naSay } from "./na-conditions.mjs";

export const SCORECARD_TZ = "America/Phoenix";
export const GROUPS = Object.freeze([
  "front_doors", "backend", "jobs", "messages", "money_in", "tracking", "outside", "site", "mac"
]);

export function phoenixDate(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: SCORECARD_TZ, year: "numeric", month: "2-digit", day: "2-digit"
  }).format(now);
}

function groupOf(check) {
  if (check.group && GROUPS.includes(check.group)) return check.group;
  if (check.kind === "registry") return check.path && check.path.startsWith("/api/") ? "backend" : "front_doors";
  return "backend";
}

/* A row's `also` list: the ids of the slice claims folded into it
   (src/pulse/coverage/link.mjs). Kept in the stored JSON as plain strings. */
function alsoOf(check) {
  if (!Array.isArray(check.also)) return null;
  const ids = check.also.filter((x) => typeof x === "string" && x !== "");
  return ids.length ? ids : null;
}

export const NA_NO_REASON = "Said nothing to judge but gave no reason the computer can check";

/* One pulse check (PASS/FAIL/skip/na or up/down) → one contract row.
   The stored statuses are green, red, na and not_checked. */
export function toContractCheck(check) {
  const raw = String(check.status || "");
  const proof = String(check.detail || "").trim();
  let status = "not_checked";
  if (raw === "PASS" || raw === "up") status = proof ? "green" : "not_checked";
  else if (raw === "FAIL" || raw === "down") status = "red";
  else if (raw === "na" && !naProblem(check.na)) status = "na";
  const out = { id: String(check.id), group: groupOf(check), status };
  if (status === "green") out.proof = proof;
  else if (status === "na") {
    // A JSON round trip: what is stored is exactly what the audit reads back.
    const args = JSON.parse(JSON.stringify(check.na.args));
    out.reason = proof || naSay({ code: check.na.code, args });
    out.na_code = check.na.code;
    out.na_args = args;
  } else if (status === "not_checked") {
    out.reason = raw === "na" ? NA_NO_REASON : (proof || "passed with no proof — not counted");
  } else {
    out.proof = proof;
    out.customer_sees = check.customerSees ||
      (check.kind === "registry" ? `${check.path} does not answer the way it should.` : "Unknown — read the proof.");
    out.fix = check.suggestedFix || "Read the proof and fix the named part. Do not auto-fix.";
  }
  const also = alsoOf(check);
  if (also) out.also = also;
  return out;
}

function daysBetween(fromDate, toDate) {
  const a = Date.parse(`${fromDate}T00:00:00Z`);
  const b = Date.parse(`${toDate}T00:00:00Z`);
  return Math.round((b - a) / 86400000);
}

/* applyRepeats — since / day_count on every red, from the previous morning's
   stored row. A red that was also red on the last stored morning keeps its
   `since`; day_count is calendar days from `since` to today, plus one. */
export function applyRepeats(checks, { date, previous } = {}) {
  const prev = new Map(
    (previous && Array.isArray(previous.checks) ? previous.checks : [])
      .filter((c) => c && c.status === "red")
      .map((c) => [c.id, c])
  );
  return checks.map((c) => {
    if (c.status !== "red") return c;
    const before = prev.get(c.id);
    const since = before && before.since && before.since < date ? before.since : date;
    return { ...c, since, day_count: daysBetween(since, date) + 1 };
  });
}

export function countChecks(checks) {
  const n = { green: 0, red: 0, na: 0, not_checked: 0 };
  for (const c of checks) n[c.status] = (n[c.status] || 0) + 1;
  return n;
}

export function buildScorecard({ checks = [], now = new Date(), previous = null } = {}) {
  const date = phoenixDate(now);
  const rows = applyRepeats(checks.map(toContractCheck), { date, previous });
  return { date, ran_at: now.toISOString(), checks: rows };
}

export async function loadPreviousScorecard(db, orgId, date) {
  if (!db || !orgId) return null;
  const { rows } = await db.query(
    `SELECT to_char(scorecard_date, 'YYYY-MM-DD') AS date, checks
       FROM pulse_scorecards
      WHERE org_id = $1::uuid AND scorecard_date < $2::date
      ORDER BY scorecard_date DESC
      LIMIT 1`,
    [orgId, date]
  );
  return rows[0] || null;
}

/* saveScorecard — one row per company per morning; a re-run the same morning
   replaces it.

   Migration 477 adds na_count and widens the counts-match check to four
   statuses. Until it is applied, the new insert fails: Postgres 42703 (no such
   column) or 23514 (the old check refuses an "na" row). The morning report must
   never be lost because of that, so the save runs ONCE MORE in the old shape:
   every "na" row written as "not_checked", and no na_count. One warning line
   says so. Any other error is thrown as it was. */
const LEGACY_SAVE_CODES = new Set(["42703", "23514"]);

function legacyChecks(checks) {
  return checks.map((c) => {
    if (!c || c.status !== "na") return c;
    const row = { ...c, status: "not_checked" };
    delete row.na_code;
    delete row.na_args;
    return row;
  });
}

export async function saveScorecard(db, orgId, card) {
  if (!orgId) throw new Error("saveScorecard: an org is required");
  const n = countChecks(card.checks);
  try {
    const { rows } = await db.query(
      `INSERT INTO pulse_scorecards
         (org_id, scorecard_date, ran_at, checks, green_count, red_count, not_checked_count, na_count)
       VALUES ($7::uuid, $1::date, $2, $3::jsonb, $4, $5, $6, $8)
       ON CONFLICT (org_id, scorecard_date) DO UPDATE
          SET ran_at = EXCLUDED.ran_at,
              checks = EXCLUDED.checks,
              green_count = EXCLUDED.green_count,
              red_count = EXCLUDED.red_count,
              not_checked_count = EXCLUDED.not_checked_count,
              na_count = EXCLUDED.na_count,
              updated_at = now()
       RETURNING id`,
      [card.date, card.ran_at, JSON.stringify(card.checks), n.green, n.red, n.not_checked, orgId, n.na]
    );
    return { saved: true, id: rows[0]?.id || null, counts: n };
  } catch (err) {
    if (!err || !LEGACY_SAVE_CODES.has(err.code)) throw err;
    const old = legacyChecks(card.checks);
    const ln = countChecks(old);
    console.warn(
      `saveScorecard: the database is behind (${err.code}, migration 477 not applied). ` +
      `Saved the old shape: ${n.na} "na" rows written as "not_checked", no na_count.`
    );
    try {
      const { rows } = await db.query(
        `INSERT INTO pulse_scorecards
           (org_id, scorecard_date, ran_at, checks, green_count, red_count, not_checked_count)
         VALUES ($7::uuid, $1::date, $2, $3::jsonb, $4, $5, $6)
         ON CONFLICT (org_id, scorecard_date) DO UPDATE
            SET ran_at = EXCLUDED.ran_at,
                checks = EXCLUDED.checks,
                green_count = EXCLUDED.green_count,
                red_count = EXCLUDED.red_count,
                not_checked_count = EXCLUDED.not_checked_count,
                updated_at = now()
         RETURNING id`,
        [card.date, card.ran_at, JSON.stringify(old), ln.green, ln.red, ln.not_checked, orgId]
      );
      return { saved: true, id: rows[0]?.id || null, counts: ln, legacy: true, na_downgraded: n.na };
    } catch (second) {
      if (second && typeof second === "object" && second.cause === undefined) second.cause = err;
      throw second;
    }
  }
}
