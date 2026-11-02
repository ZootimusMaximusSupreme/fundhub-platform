// Keep a manual funding task transfer and the client's named advisor in one
// database statement. Every open funding task on that file follows the transfer.
export async function transferFundingAdvisorTask(db, { orgId, taskId, staffId, claim = false }) {
  const r = await db.query(
    `WITH task_ref AS (
       SELECT client_id FROM tasks WHERE id = $1::uuid AND org_id = $2::uuid
     ), locked_client AS (
       SELECT c.id, c.custom_fields FROM clients c
         JOIN task_ref t ON t.client_id = c.id
        WHERE c.org_id = $2::uuid FOR UPDATE OF c
     ), target AS (
       SELECT t.id, t.client_id FROM tasks t
         JOIN locked_client c ON c.id = t.client_id
        WHERE t.id = $1::uuid AND t.org_id = $2::uuid
          AND t.assignee_role = 'funding_advisor' AND t.done = false
          AND (NOT $4::boolean OR t.assignee_staff_id IS NULL OR t.assignee_staff_id = $3::uuid)
        FOR UPDATE OF t
     ), eligible AS (
       SELECT t.client_id FROM target t JOIN locked_client c ON c.id = t.client_id
        WHERE ($3::uuid IS NULL OR EXISTS (
          SELECT 1 FROM staff s WHERE s.id = $3::uuid AND s.org_id = $2::uuid
            AND s.role = 'funding_advisor' AND s.status = 'active'
            AND s.active = true AND s.is_demo = false
        ))
          AND (NOT $4::boolean OR
            NULLIF(c.custom_fields->>'cf_funding_advisor_user_id', '') IS NULL OR
            c.custom_fields->>'cf_funding_advisor_user_id' = $3::text)
          AND (NOT $4::boolean OR NOT EXISTS (
            SELECT 1 FROM tasks other
             WHERE other.org_id = $2::uuid AND other.client_id = t.client_id
               AND other.assignee_role = 'funding_advisor' AND other.done = false
               AND other.assignee_staff_id IS NOT NULL AND other.assignee_staff_id <> $3::uuid
          ))
     ), updated_client AS (
       UPDATE clients c SET custom_fields = COALESCE(c.custom_fields, '{}'::jsonb)
         || jsonb_build_object('cf_funding_advisor_user_id', $3::text), updated_at = now()
        FROM eligible e WHERE c.id = e.client_id AND c.org_id = $2::uuid
       RETURNING c.id
     ), updated_tasks AS (
       UPDATE tasks t SET assignee_staff_id = $3::uuid, updated_at = now()
        FROM updated_client c WHERE t.org_id = $2::uuid AND t.client_id = c.id
          AND t.assignee_role = 'funding_advisor' AND t.done = false
       RETURNING t.id, t.client_id, t.title, t.body, t.due_at, t.source_workflow,
         t.assignee_role, t.assignee_staff_id, t.done, t.created_at
     ) SELECT * FROM updated_tasks WHERE id = $1::uuid`,
    [taskId, orgId, staffId || null, claim]
  );
  return r.rows[0] || null;
}
