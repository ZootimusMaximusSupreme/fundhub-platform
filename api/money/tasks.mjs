// GET  /api/money/tasks[?client_id=<uuid>]
// POST /api/money/tasks   { action: "do_task", task_id, client_id? }
//
// "What to do next" (FinanceOS wave 5, unit W5). GET lists the client's next
// steps — payments due or late, checklist steps, the UnderwriteIQ tip, plan
// pins — each with who can do it (can_do: agent | person | self) and what
// "Do task" already did. POST do_task hands one step to the money agent or to
// a person. The logic lives in src/finance/money-tasks.mjs; this file gates and
// answers. Contract for the agent and the transfer engine:
// docs/finance/money-agent-tasks.md.
//
// MONEY NEVER MOVES HERE. A step that moves money becomes a PROPOSAL that waits
// for the client to approve that exact amount and account
// (src/finance/money-transfer-seam.mjs).
//
// SAME TWO CALLERS AS api/money/overview.mjs, same gate:
//   * a signed-in CLIENT reads and acts on their own file only. client_id comes
//     off the session; one in the query or body is never read on this branch.
//   * STAFF: requireRole(ROLE_SETS.FINANCE) + requireClientInOrg on client_id.
import { db } from "../../src/db.mjs";
import { requirePrincipal } from "../../src/http/middleware/requirePrincipal.mjs";
import { ROLE_SETS, requireRole, isUuid, CLIENT_DATA_ERRORS } from "../../src/http/read-api.mjs";
import { requireClientInOrg } from "../../src/http/client-scope.mjs";
import { moneyTasks, doTask, BUILT_IN_SOURCES } from "../../src/finance/money-tasks.mjs";
import { allPins, SOURCES as PLAN_SOURCES } from "../../src/finance/plan-sources/index.mjs";
import { readBody } from "../banking/sync-accounts.mjs";
import { dbDown } from "../../src/http/db-down.mjs";

/* PLAN PINS (W1's registry, src/finance/plan-sources/index.mjs). Only the
   sources this list does not read itself — bank strategy, funding rounds, the
   payoff plan — so no row is read twice and no step is listed twice.
   src/finance/money-tasks.mjs skips pins from its own three sources anyway. */
export const PIN_SOURCES = Object.freeze(PLAN_SOURCES.filter((s) => !BUILT_IN_SOURCES.includes(s && s.name)));
export function PINS_PROVIDER(db, args) {
  return allPins(db, { ...args, sources: PIN_SOURCES });
}

const ACTIONS = new Set(["do_task"]);

const DO_TASK_REFUSALS = {
  bad_task_id: [400, "That is not a task id."],
  task_not_found: [404, "That step is not on your list any more. Reload to see what is next."],
  self_task: [409, "Only you can do this step, so it cannot be handed over."],
  proposal_refused: [409, "We could not set up that payment. Reload and try again."],
  not_saved: [409, "That step was not saved. Reload and try again."],
  not_found: [404, null]
};

/** Who is asking, and for which file. Same block as api/money/payments.mjs. */
async function scope(req, res, { database, gate, body }) {
  const principal = await gate(req, res, ["staff", "client"], { db: database });
  if (!principal) return null;

  if (principal.kind === "client") {
    /* PINNED TO SELF. Same block as api/money/overview.mjs. */
    const clientId = principal.clientId || null;
    const orgId = principal.orgId || null;
    if (!isUuid(clientId) || !orgId) {
      res.status(403).json({ ok: false, error: "forbidden", message: "Your login is not attached to a client file." });
      return null;
    }
    return { orgId, clientId, kind: "client", staffId: null };
  }

  const staff = principal.staff || { role: principal.role, org_id: principal.orgId };
  if (!requireRole(res, staff, ROLE_SETS.FINANCE)) return null;
  const qid = body ? body.client_id : req.query && req.query.client_id;
  if (!isUuid(qid)) {
    res.status(400).json({ ok: false, error: "client_id is required and must be a uuid" });
    return null;
  }
  const clientId = String(qid).trim();
  if (!(await requireClientInOrg(res, database, staff, clientId))) return null;
  return { orgId: staff.org_id, clientId, kind: "staff", staffId: isUuid(staff.id) ? staff.id : null };
}

export default async function handler(req, res, deps = {}) {
  const database = deps.db || db;
  const gate = deps.requirePrincipal || requirePrincipal;
  const clock = deps.now || (() => new Date());
  const env = deps.env || process.env;
  const read = deps.moneyTasks || moneyTasks;
  const press = deps.doTask || doTask;
  const pins = "pins" in deps ? deps.pins : PINS_PROVIDER;

  const method = req.method || "GET";
  if (method !== "GET" && method !== "POST") {
    res.setHeader("allow", "GET, POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  let body = null;
  if (method === "POST") {
    body = readBody(req.body);
    if (body === null) return res.status(400).json({ ok: false, error: "body must be JSON" });
  }

  const who = await scope(req, res, { database, gate, body });
  if (!who) return;
  const { orgId, clientId } = who;
  const now = clock();

  try {
    if (method === "GET") {
      const payload = await read(database, { orgId, clientId, env, asOf: now, pins });
      if (!payload) return res.status(404).json({ ok: false, error: "not_found" });
      return res.status(200).json(payload);
    }

    const action = String(body.action || "");
    if (!ACTIONS.has(action)) return res.status(400).json({ ok: false, error: "unknown_action" });
    const r = await press(database, {
      orgId, clientId, taskId: typeof body.task_id === "string" ? body.task_id.trim() : "",
      actor: who.kind, staffId: who.staffId, env, asOf: now, pins
    });
    if (!r || !r.ok) {
      const [code, message] = DO_TASK_REFUSALS[r && r.error] || [409, "That step was not saved. Reload and try again."];
      return res.status(code).json({ ok: false, error: (r && r.error) || "not_saved", ...(message ? { message } : {}) });
    }
    return res.status(200).json({ ok: true, action, created: !!r.created, task: r.task });
  } catch (e) {
    if (CLIENT_DATA_ERRORS.has(e && e.code)) return res.status(400).json({ ok: false, error: "invalid_parameter" });
    if (dbDown(res, e)) return;
    throw e;
  }
}
