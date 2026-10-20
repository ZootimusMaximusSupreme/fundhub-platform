// Capital Blueprint — the CSM role on pay.
//
// OWNER DECISION (Chris, 2026-10-20): "There is no advisor; it's a CSM. There
// are AI agents and a customer service management thing." "We don't need to
// name somebody yet." So the touch-base CSM job is done by the AI coaches
// (BP-COACH, BP-COACH-VOICE) plus the team CSM queue (tasks with
// assignee_role 'csm'). A Blueprint buyer with no assigned staff person is the
// NORMAL state: no person is picked and no owner task is raised for it.
//
// The round-robin picker stays for later. It runs only when
// BLUEPRINT_CSM_AUTO_ASSIGN is true, and that flips only when Chris says a real
// CSM is hired. A saved staff link that points at a demo, disabled or
// other-company person is still a real break and still raises owner work.

import { productCreatesChecklist } from "../waypoints/purchase.mjs";
import { createTask } from "../lib/create-task.mjs";

export const CSM_ASSIGNMENT_EXCEPTION_SOURCE = "blueprint-csm-assignment";

/* Owner switch. false = the AI coaches plus the team CSM queue are the CSM.
   Turn on only when Chris names a hired CSM (owner-set 2026-10-20). */
export const BLUEPRINT_CSM_AUTO_ASSIGN = false;

async function assignmentException(db, { orgId, clientId }) {
  const task = await createTask(db, {
    orgId, clientId,
    title: "Fix the staff link on this Blueprint client (saved person is not a working CSM)",
    sourceWorkflow: CSM_ASSIGNMENT_EXCEPTION_SOURCE,
    assigneeRole: "owner",
    eventId: `blueprint-csm-assignment:${clientId}`
  });
  // A previous resolved shortage must be visible again if it recurs. This
  // touches only the same scoped owner exception, never a client message.
  if (task.id) {
    await db.query(`UPDATE tasks SET done = false
      WHERE id = $1 AND org_id = $2 AND client_id = $3
        AND source_workflow = $4 AND done = true`,
    [task.id, orgId, clientId, CSM_ASSIGNMENT_EXCEPTION_SOURCE]);
  }
  return task;
}

/**
 * Pick the next CSM for this org. Fewest assigned Blueprint clients first,
 * then oldest staff row (stable tie-break).
 */
export async function pickCsmStaffId(db, { orgId }) {
  if (!orgId) return null;
  const r = await db.query(
    `SELECT s.id
       FROM staff s
      WHERE s.org_id = $1::uuid
        AND lower(btrim(COALESCE(s.role, ''))) = 'csm'
        AND s.status = 'active'
        AND s.active = true
        AND s.is_demo = false
      ORDER BY (
        SELECT COUNT(*)::int
          FROM clients c
         WHERE c.org_id = s.org_id
           AND c.assigned_csm_staff_id = s.id
      ) ASC,
      s.created_at ASC
      LIMIT 1`,
    [orgId]
  );
  return r.rows[0]?.id || null;
}

/**
 * Set clients.assigned_csm_staff_id when still NULL and the owner switch is on.
 * Idempotent. With the switch off (the owner-set default) an unassigned buyer
 * returns reason "ai_csm": the AI coaches and the team CSM queue cover them.
 *
 * @returns {Promise<{ assigned: boolean, staffId?: string, reason?: string }>}
 */
export async function assignCsmForBlueprintPurchase(db, {
  orgId, clientId, productCode, autoAssign = BLUEPRINT_CSM_AUTO_ASSIGN
} = {}) {
  if (!productCreatesChecklist(productCode)) {
    return { assigned: false, reason: "not_blueprint_product" };
  }
  if (!orgId || !clientId) {
    return { assigned: false, reason: "missing_ids" };
  }

  const cur = await db.query(
    `SELECT c.assigned_csm_staff_id, s.id AS real_csm_staff_id
       FROM clients c
       LEFT JOIN staff s ON s.id = c.assigned_csm_staff_id AND s.org_id = c.org_id
         AND lower(btrim(COALESCE(s.role, ''))) = 'csm'
         AND s.status = 'active' AND s.active = true AND s.is_demo = false
      WHERE c.id = $1::uuid AND c.org_id = $2::uuid`,
    [clientId, orgId]
  );
  if (!cur.rows[0]) return { assigned: false, reason: "client_not_found" };
  const existing = cur.rows[0].assigned_csm_staff_id;
  if (existing) {
    if (cur.rows[0].real_csm_staff_id) return { assigned: false, staffId: existing, reason: "already_assigned" };
    return { assigned: false, staffId: existing, reason: "assignment_unavailable",
      exceptionTask: await assignmentException(db, { orgId, clientId }) };
  }

  // No person is a normal state, never an owner exception.
  if (autoAssign !== true) return { assigned: false, reason: "ai_csm" };
  const staffId = await pickCsmStaffId(db, { orgId });
  if (!staffId) return { assigned: false, reason: "ai_csm" };

  const upd = await db.query(
    `UPDATE clients
        SET assigned_csm_staff_id = $3::uuid,
            updated_at = now()
      WHERE id = $1::uuid
        AND org_id = $2::uuid
        AND assigned_csm_staff_id IS NULL
        AND EXISTS (SELECT 1 FROM staff s WHERE s.id = $3::uuid AND s.org_id = $2::uuid
          AND lower(btrim(COALESCE(s.role, ''))) = 'csm'
          AND s.status = 'active' AND s.active = true AND s.is_demo = false)
      RETURNING assigned_csm_staff_id`,
    [clientId, orgId, staffId]
  );
  if (!upd.rows[0]) {
    const again = (await db.query(
      `SELECT c.assigned_csm_staff_id, s.id AS real_csm_staff_id
         FROM clients c
         LEFT JOIN staff s ON s.id = c.assigned_csm_staff_id AND s.org_id = c.org_id
           AND lower(btrim(COALESCE(s.role, ''))) = 'csm'
           AND s.status = 'active' AND s.active = true AND s.is_demo = false
        WHERE c.id = $1 AND c.org_id = $2`,
      [clientId, orgId]
    )).rows[0];
    if (!again) return { assigned: false, reason: "client_not_found" };
    if (again.real_csm_staff_id) return { assigned: false, staffId: again.assigned_csm_staff_id, reason: "already_assigned" };
    return { assigned: false, staffId: again.assigned_csm_staff_id, reason: "advisor_unavailable",
      exceptionTask: await assignmentException(db, { orgId, clientId }) };
  }
  return { assigned: true, staffId: upd.rows[0].assigned_csm_staff_id };
}
