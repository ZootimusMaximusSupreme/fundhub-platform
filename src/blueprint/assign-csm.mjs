// Capital Blueprint — assign one CSM staff row per client on pay (when unset).
//
// Round-robin: active CSM with the fewest clients already assigned. If none,
// the assignment stays NULL and tasks still route by assigneeRole csm.

import { productCreatesChecklist } from "../waypoints/purchase.mjs";
import { andNotDemo } from "../demo/exclude-demo.mjs";

/**
 * Pick the next CSM for this org. Fewest assigned Blueprint clients first,
 * then oldest staff row (stable tie-break).
 *
 * Demo staff are never picked. csm@demo.fundhub.local (db/migrations/
 * 290_csm_role.sql, is_demo = true) is an active role='csm' row that cannot log
 * in, so a paying client assigned to it would sit with a CSM nobody can reach.
 * With only a demo CSM the answer is null and the caller records no_active_csm.
 */
export async function pickCsmStaffId(db, { orgId }) {
  if (!orgId) return null;
  const r = await db.query(
    `SELECT s.id
       FROM staff s
      WHERE s.org_id = $1::uuid
        AND lower(btrim(COALESCE(s.role, ''))) = 'csm'
        AND lower(btrim(COALESCE(s.status, 'active'))) = 'active'
        ${andNotDemo("s")}
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
 * Set clients.assigned_csm_staff_id when still NULL. Idempotent.
 *
 * @returns {Promise<{ assigned: boolean, staffId?: string, reason?: string }>}
 */
export async function assignCsmForBlueprintPurchase(db, {
  orgId, clientId, productCode
} = {}) {
  if (!productCreatesChecklist(productCode)) {
    return { assigned: false, reason: "not_blueprint_product" };
  }
  if (!orgId || !clientId) {
    return { assigned: false, reason: "missing_ids" };
  }

  const cur = await db.query(
    `SELECT assigned_csm_staff_id
       FROM clients
      WHERE id = $1::uuid AND org_id = $2::uuid`,
    [clientId, orgId]
  );
  const existing = cur.rows[0]?.assigned_csm_staff_id;
  if (existing) return { assigned: false, staffId: existing, reason: "already_assigned" };

  const staffId = await pickCsmStaffId(db, { orgId });
  if (!staffId) return { assigned: false, reason: "no_active_csm" };

  const upd = await db.query(
    `UPDATE clients
        SET assigned_csm_staff_id = $3::uuid,
            updated_at = now()
      WHERE id = $1::uuid
        AND org_id = $2::uuid
        AND assigned_csm_staff_id IS NULL
      RETURNING assigned_csm_staff_id`,
    [clientId, orgId, staffId]
  );
  if (!upd.rows[0]) {
    const again = (await db.query(
      `SELECT assigned_csm_staff_id FROM clients WHERE id = $1 AND org_id = $2`,
      [clientId, orgId]
    )).rows[0]?.assigned_csm_staff_id;
    return { assigned: false, staffId: again || null, reason: "race_or_missing_client" };
  }
  return { assigned: true, staffId: upd.rows[0].assigned_csm_staff_id };
}
