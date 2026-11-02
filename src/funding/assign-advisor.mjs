// Give a paid funding client one named, active funding advisor.
// The client link is the source used by the portal's "Your Funding Advisor" card.

async function linkedAdvisor(db, { orgId, clientId }) {
  const r = await db.query(
    `SELECT c.custom_fields->>'cf_funding_advisor_user_id' AS staff_id,
            s.id AS active_staff_id
       FROM clients c
       LEFT JOIN staff s ON s.id::text = c.custom_fields->>'cf_funding_advisor_user_id'
         AND s.org_id = c.org_id AND s.role = 'funding_advisor'
         AND s.status = 'active' AND s.active = true AND s.is_demo = false
      WHERE c.org_id = $1::uuid AND c.id = $2::uuid`,
    [orgId, clientId]
  );
  return r.rows[0] || null;
}

async function attachOpenTasks(db, { orgId, clientId, staffId, formerStaffId = null }) {
  await db.query(
    `UPDATE tasks SET assignee_staff_id = $3::uuid, updated_at = now()
      WHERE org_id = $1::uuid AND client_id = $2::uuid
        AND assignee_role = 'funding_advisor'
        AND (assignee_staff_id IS NULL OR assignee_staff_id::text = $4::text)
        AND done = false`,
    [orgId, clientId, staffId, formerStaffId]
  );
}

export async function assignFundingAdvisor(db, { orgId, clientId } = {}) {
  if (!orgId || !clientId) return { assigned: false, reason: "missing_ids" };
  const current = await linkedAdvisor(db, { orgId, clientId });
  if (!current) return { assigned: false, reason: "client_not_found" };
  if (current.active_staff_id) {
    await attachOpenTasks(db, { orgId, clientId, staffId: current.active_staff_id });
    return { assigned: false, staffId: current.active_staff_id, reason: "already_assigned" };
  }
  // A departed advisor cannot keep a paid file stranded. Replace only the
  // exact stale link we read, so a concurrent owner reassignment still wins.

  // A person may have claimed the intake before this event arrived. Their
  // existing claim wins over load balancing; two different claims need review.
  const claimed = await db.query(
    `SELECT DISTINCT s.id
       FROM tasks t JOIN staff s ON s.id = t.assignee_staff_id AND s.org_id = t.org_id
      WHERE t.org_id = $1::uuid AND t.client_id = $2::uuid
        AND t.source_workflow IN ('s-06-post-call-funding-purchased', 'f-01-funding-intake')
        AND t.assignee_role = 'funding_advisor' AND t.done = false
        AND s.role = 'funding_advisor' AND s.status = 'active'
        AND s.active = true AND s.is_demo = false
      ORDER BY s.id LIMIT 2`,
    [orgId, clientId]
  );
  if (claimed.rows.length > 1) return { assigned: false, reason: "conflicting_advisor_claims" };

  const picked = claimed.rows[0] ? { rows: claimed.rows } : await db.query(
    `SELECT s.id
       FROM staff s
      WHERE s.org_id = $1::uuid AND s.role = 'funding_advisor'
        AND s.status = 'active' AND s.active = true AND s.is_demo = false
      ORDER BY (
        SELECT count(*)::int FROM clients c
         WHERE c.org_id = s.org_id
           AND c.custom_fields->>'cf_funding_advisor_user_id' = s.id::text
      ) ASC, s.created_at ASC, s.id ASC
      LIMIT 1`,
    [orgId]
  );
  const staffId = picked.rows[0]?.id;
  if (!staffId) return { assigned: false, reason: "no_active_funding_advisor" };

  const saved = await db.query(
    `UPDATE clients c
        SET custom_fields = COALESCE(c.custom_fields, '{}'::jsonb)
              || jsonb_build_object('cf_funding_advisor_user_id', $3::text),
            updated_at = now()
      WHERE c.org_id = $1::uuid AND c.id = $2::uuid
        AND NULLIF(BTRIM(COALESCE(c.custom_fields->>'cf_funding_advisor_user_id', '')), '')
              IS NOT DISTINCT FROM $4::text
        AND EXISTS (SELECT 1 FROM staff s WHERE s.id = $3::uuid AND s.org_id = $1::uuid
          AND s.role = 'funding_advisor' AND s.status = 'active'
          AND s.active = true AND s.is_demo = false)
      RETURNING c.id`,
    [orgId, clientId, staffId, current.staff_id || null]
  );
  const winner = saved.rows[0] ? staffId : (await linkedAdvisor(db, { orgId, clientId }))?.active_staff_id;
  if (!winner) return { assigned: false, reason: "assignment_race_or_unavailable" };

  // A concurrent round.started may have made the pod task first. Keep it with
  // the same person rather than leaving a second, unclaimed funding queue item.
  await attachOpenTasks(db, { orgId, clientId, staffId: winner,
    formerStaffId: saved.rows[0] ? current.staff_id : null });
  return { assigned: Boolean(saved.rows[0]), staffId: winner,
    reason: saved.rows[0] ? "assigned" : "already_assigned" };
}
