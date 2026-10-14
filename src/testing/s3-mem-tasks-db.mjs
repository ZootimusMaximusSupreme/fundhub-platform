// A stand-in database that keeps just two tables, `tasks` and `money_agent_log`,
// with their dedupe rules, plus one `clients` row. Enough for the real
// createTask, createBlueprintCsmPrepCallTask and logMoneyAction to run behind a
// real api/ handler. State is on `.state` so a test can read what was written.

export function memTasksDb({ assignedCsm = null, inOrg = true } = {}) {
  const state = { tasks: [], log: [] };
  let n = 0;
  return {
    state,
    async query(sql, params = []) {
      if (/LEFT JOIN tasks t/.test(sql)) {
        if (!inOrg) return { rows: [] };
        const mine = state.tasks.filter((t) => t.source_workflow === params[2]
          && (t.body === params[3] || String(t.body).startsWith(`${params[3]}:r`)));
        if (!mine.length) return { rows: [{ assigned_csm_staff_id: assignedCsm, id: null }] };
        return { rows: mine.map((t) => ({ assigned_csm_staff_id: assignedCsm, ...t })) };
      }
      if (/SELECT assigned_csm_staff_id\s+FROM clients/.test(sql)) return { rows: [{ assigned_csm_staff_id: assignedCsm }] };
      if (/SELECT id FROM tasks/.test(sql)) {
        const hit = state.tasks.find((t) => t.client_id === params[0] && t.source_workflow === params[1] && t.body === params[2]);
        return { rows: hit ? [{ id: hit.id }] : [] };
      }
      if (/INSERT INTO tasks/.test(sql)) {
        const [orgId, clientId, title, body, dueAt, source, role, staffId] = params;
        if (state.tasks.some((t) => t.client_id === clientId && t.source_workflow === source && t.body === body)) return { rows: [] };
        n += 1;
        const at = new Date(Date.UTC(2026, 9, 7, 12, n)).toISOString();
        const row = {
          id: `task-${n}`, org_id: orgId, client_id: clientId, title, body, due_at: dueAt, source_workflow: source,
          assignee_role: role, assignee_staff_id: staffId, done: false, created_at: at, updated_at: at
        };
        state.tasks.push(row);
        return { rows: [{ id: row.id }] };
      }
      if (/INSERT INTO money_agent_log/.test(sql)) {
        const key = params[13];
        if (state.log.some((r) => r.idempotency_key === key)) return { rows: [] };
        const row = { id: `log-${state.log.length + 1}`, org_id: params[0], client_id: params[1], item_kind: params[2], action: params[6], actor: params[7], reason: params[9], idempotency_key: key };
        state.log.push(row);
        return { rows: [{ id: row.id }] };
      }
      if (/UPDATE money_agent_log SET task_id/.test(sql)) {
        const row = state.log.find((x) => x.id === params[0]);
        if (row) row.task_id = params[1];
        return { rows: [] };
      }
      return { rows: [] };
    }
  };
}

/** A principal gate stand-in: the same shape api/money/* handlers inject. */
export const clientPrincipal = (clientId, orgId) => ({ kind: "client", accountId: "acc-1", orgId, clientId });
export const staffPrincipal = (role, orgId, staffId = "5aff0000-0000-4000-8000-000000000001") =>
  ({ kind: "staff", staffId, role, orgId, staff: { id: staffId, role, org_id: orgId } });
export const gateAs = (principal) => async (_req, res, kinds) => {
  if (!principal) { res.status(401).json({ ok: false, error: "unauthorized" }); return null; }
  if (!kinds.includes(principal.kind)) { res.status(403).json({ ok: false, error: "forbidden" }); return null; }
  return principal;
};
