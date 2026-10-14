// A stand-in database that keeps `tasks` and `money_agent_log` (with their
// dedupe rules) and a real `clients` table. Enough for the real createTask,
// createBlueprintCsmPrepCallTask and logMoneyAction to run behind a real api/
// handler. Every `FROM clients` statement is answered by the id and org its SQL
// text names (see s3-scoped-rows.mjs), so a client of another company is only
// refused when the product asks for it. State is on `.state` so a test can read
// what was written.
import { rowsWhere } from "./s3-scoped-rows.mjs";

/** `clients`: [{ id, org_id, assigned_csm_staff_id?, first_name?, last_name? }]. */
export function memTasksDb({ clients = [] } = {}) {
  const state = { tasks: [], log: [] };
  let n = 0;
  return {
    state,
    async query(sql, params = []) {
      if (/FROM clients\b/.test(sql)) {
        const found = rowsWhere(clients, sql, params);
        if (/LEFT JOIN tasks t/.test(sql)) {
          return { rows: found.flatMap((c) => {
            const mine = state.tasks.filter((t) => t.client_id === c.id && t.org_id === c.org_id && t.source_workflow === params[2]
              && (t.body === params[3] || String(t.body).startsWith(`${params[3]}:r`)));
            const csm = c.assigned_csm_staff_id || null;
            return mine.length ? mine.map((t) => ({ assigned_csm_staff_id: csm, ...t })) : [{ assigned_csm_staff_id: csm, id: null }];
          }) };
        }
        return { rows: found.map((c) => ({ "?column?": 1, ...c })) };
      }
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

/** What ROLE_SETS.FINANCE_OS names today, and staff roles it must refuse. Written out, not read from the product. */
export const FINANCE_OS_ROLES = Object.freeze(["owner", "admin", "sales_manager", "closer"]);
export const NOT_FINANCE_OS_ROLES = Object.freeze(["setter", "csm", "funding_advisor", "inquiry_specialist"]);
