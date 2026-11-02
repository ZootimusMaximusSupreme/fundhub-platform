// Which call this closer is on right now, and which one is next.
// Staff-scoped. No client_id. Same task filter as cockpit upcomingCalls,
// except due-today overdue calls still count as current.

export async function closerNow(db, { orgId, staffId, now = new Date() } = {}) {
  if (!orgId || !staffId) throw new TypeError("closerNow: orgId and staffId required");

  const r = await db.query(
    `SELECT t.id AS task_id, t.client_id, t.due_at, t.meeting_url, t.title,
            COALESCE(NULLIF(trim(c.first_name || ' ' || c.last_name), ''), c.email, 'Client') AS name
       FROM tasks t
       LEFT JOIN clients c ON c.id = t.client_id AND c.org_id = t.org_id
      WHERE t.org_id = $1
        AND t.done IS NOT TRUE
        AND c.id IS NOT NULL
        AND c.custom_fields->>'crm_archived_at' IS NULL
        AND t.assignee_role = 'closer'
        AND (t.assignee_staff_id = $2 OR t.assignee_staff_id IS NULL)
        AND t.due_at IS NOT NULL
        AND t.due_at >= date_trunc('day', $3::timestamptz)
        AND NOT EXISTS (
          SELECT 1 FROM call_outcomes o
           WHERE o.org_id = t.org_id AND o.client_id = t.client_id
             AND (o.task_id = t.id OR
                  (NULLIF(btrim(t.body), '') IS NOT NULL AND o.booking_ref = t.body))
        )
      ORDER BY t.due_at ASC
      LIMIT 2`,
    [orgId, staffId, now.toISOString()]
  );

  return {
    current: r.rows[0] || null,
    next: r.rows[1] || null
  };
}
