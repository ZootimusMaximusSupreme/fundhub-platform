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
//   - the same red on a second morning says day 2 (since + day_count carried
//     from the previous stored morning).

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

/* One pulse check (PASS/FAIL/skip or up/down) → one contract row. */
export function toContractCheck(check) {
  const raw = String(check.status || "");
  const proof = String(check.detail || "").trim();
  let status = "not_checked";
  if (raw === "PASS" || raw === "up") status = proof ? "green" : "not_checked";
  else if (raw === "FAIL" || raw === "down") status = "red";
  const out = { id: String(check.id), group: groupOf(check), status };
  if (status === "green") out.proof = proof;
  else if (status === "not_checked") out.reason = proof || "passed with no proof — not counted";
  else {
    out.proof = proof;
    out.customer_sees = check.customerSees ||
      (check.kind === "registry" ? `${check.path} does not answer the way it should.` : "Unknown — read the proof.");
    out.fix = check.suggestedFix || "Read the proof and fix the named part. Do not auto-fix.";
  }
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
  const n = { green: 0, red: 0, not_checked: 0 };
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
   replaces it. */
export async function saveScorecard(db, orgId, card) {
  if (!orgId) throw new Error("saveScorecard: an org is required");
  const n = countChecks(card.checks);
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
    [card.date, card.ran_at, JSON.stringify(card.checks), n.green, n.red, n.not_checked, orgId]
  );
  return { saved: true, id: rows[0]?.id || null, counts: n };
}
