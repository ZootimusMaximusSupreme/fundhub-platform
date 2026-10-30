// AI COO: turn an established Sales Floor coaching signal into dated manager work.
// A task asks the manager to review the evidence and decide what happens next.

import { createTask as defaultCreateTask } from "../lib/create-task.mjs";
import { assigneeFor as defaultAssigneeFor } from "../hiring/owner.mjs";
import { monthWindow } from "../pulse/beats/lib/sales-totals-truth.mjs";
import { isBlockedCloserIdentity } from "../sales/metrics.mjs";

export const SOURCE_WORKFLOW = "ops-manager-kpi-review";
export const CLOSE_RATE_MIN_CALLS = 10;
export const CLOSE_RATE_BAR = 0.25;

export function closerReviewSignal({ held, deposits } = {}) {
  const calls = Number(held);
  const wins = Number(deposits);
  if (!Number.isInteger(calls) || !Number.isInteger(wins) || calls < CLOSE_RATE_MIN_CALLS
    || wins < 0 || wins > calls) return null;
  const closeRate = wins / calls;
  if (closeRate >= CLOSE_RATE_BAR) return null;
  return { metric: "close_rate", held: calls, deposits: wins, close_rate: closeRate, bar: CLOSE_RATE_BAR };
}

/** Next Arizona weekday at 10:00 a.m. (17:00 UTC year-round). */
export function nextManagerDueAt(now = new Date()) {
  const arizona = new Date(now.getTime() - 7 * 60 * 60 * 1000);
  const due = new Date(Date.UTC(arizona.getUTCFullYear(), arizona.getUTCMonth(), arizona.getUTCDate() + 1, 17));
  while (due.getUTCDay() === 0 || due.getUTCDay() === 6) due.setUTCDate(due.getUTCDate() + 1);
  return due;
}

async function resolveManager(db, { orgId, roleKey, assigneeFor }) {
  let route;
  try {
    route = await assigneeFor(db, { orgId, roleKey });
  } catch (err) {
    if (err?.code !== "NOT_FOUND") throw err;
    route = { assigneeRole: "sales_manager", assigneeStaffId: null };
  }
  if (route.assigneeStaffId) {
    const named = await db.query(
      `SELECT id FROM staff WHERE id = $1 AND org_id = $2 AND status = 'active'
         AND COALESCE(is_demo, false) = false`,
      [route.assigneeStaffId, orgId]
    );
    if (named.rows[0]) return route;
    route = { assigneeRole: "sales_manager", assigneeStaffId: null };
  }
  const candidates = await db.query(
    `SELECT id FROM staff WHERE org_id = $1 AND role = $2 AND status = 'active'
       AND COALESCE(is_demo, false) = false ORDER BY id LIMIT 2`,
    [orgId, route.assigneeRole]
  );
  if (candidates.rows.length > 0) {
    return { ...route, assigneeStaffId: candidates.rows.length === 1 ? candidates.rows[0].id : null };
  }
  if (route.assigneeRole === "owner") throw new Error("No active owner for manager review");
  const owners = await db.query(
    `SELECT id FROM staff WHERE org_id = $1 AND role = 'owner' AND status = 'active'
       AND COALESCE(is_demo, false) = false ORDER BY id LIMIT 2`,
    [orgId]
  );
  if (!owners.rows.length) throw new Error("No active manager or owner for review");
  return { assigneeRole: "owner", assigneeStaffId: owners.rows.length === 1 ? owners.rows[0].id : null };
}

export async function runManagerKpiReview(db, {
  now = new Date(),
  orgId = null,
  createTask = defaultCreateTask,
  assigneeFor = defaultAssigneeFor
} = {}) {
  const window = monthWindow(now);
  const { rows } = await db.query(
    `SELECT s.org_id, s.id AS staff_id, s.name, s.email, s.role, s.is_demo,
            count(o.id) FILTER (WHERE o.outcome <> 'no_show')::int AS held,
            count(o.id) FILTER (WHERE o.outcome = 'deposit'
              AND o.transaction_id IS NOT NULL AND o.cash_collected_cents > 0)::int AS deposits
       FROM staff s
       LEFT JOIN call_outcomes o ON o.org_id = s.org_id AND o.staff_id = s.id
         AND o.logged_at >= $2 AND o.logged_at < $3
         AND COALESCE(o.is_demo, false) = false
         AND EXISTS (SELECT 1 FROM clients c WHERE c.id = o.client_id
           AND c.org_id = o.org_id AND COALESCE(c.is_demo, false) = false)
      WHERE s.status = 'active' AND s.role = 'closer'
        AND COALESCE(s.is_demo, false) = false
        AND ($1::uuid IS NULL OR s.org_id = $1)
      GROUP BY s.org_id, s.id, s.name, s.email, s.role, s.is_demo`,
    [orgId, window.start.toISOString(), window.end.toISOString()]
  );

  const tally = { checked: 0, flagged: 0, created: 0, routed: 0, failures: [] };
  const dueAt = nextManagerDueAt(now);
  const period = window.start.toISOString().slice(0, 7);
  for (const row of rows) {
    if (isBlockedCloserIdentity(row)) continue;
    tally.checked += 1;
    const signal = closerReviewSignal(row);
    if (!signal) continue;
    tally.flagged += 1;
    try {
      const manager = await resolveManager(db, {
        orgId: row.org_id, roleKey: "closer", assigneeFor
      });
      const body = `${row.org_id}:closer:${row.staff_id}:close-rate:${period}`;
      const existing = await db.query(
        `SELECT id FROM tasks WHERE org_id = $1 AND client_id IS NULL
           AND source_workflow = $2 AND body = $3 LIMIT 1`,
        [row.org_id, SOURCE_WORKFLOW, body]
      );
      if (existing.rows[0]) { tally.routed += 1; continue; }
      const result = await createTask(db, {
        orgId: row.org_id,
        clientId: null,
        sourceWorkflow: SOURCE_WORKFLOW,
        assigneeRole: manager.assigneeRole,
        assigneeStaffId: manager.assigneeStaffId,
        title: `Review closer KPI: ${row.name}`,
        body,
        eventId: body,
        dueAt,
        detail: `${row.name}: ${signal.deposits} deposits from ${signal.held} held calls `
          + `this month (${Math.round(signal.close_rate * 100)}% close rate; Sales Floor coaching bar ${Math.round(signal.bar * 100)}% after ${CLOSE_RATE_MIN_CALLS} held calls). `
          + "Review calls, lead quality and coaching history; decide whether coaching or a PIP is needed."
      });
      tally.routed += 1;
      if (result.created) tally.created += 1;
    } catch (err) {
      tally.failures.push({ staff_id: row.staff_id, error: String(err?.message || err).slice(0, 200) });
    }
  }
  return { ...tally, ok: tally.failures.length === 0, due_at: dueAt.toISOString() };
}

export default runManagerKpiReview;
