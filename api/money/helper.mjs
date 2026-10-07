// GET  /api/money/helper[?client_id=<uuid>]
// POST /api/money/helper  { action: "send", message, client_id? }
//
// The FinanceOS Money Helper's chat (FinanceOS.sections.helper, /app/money-helper.html):
// the thread — every message, every answer, what the helper did, and which
// brain answered (the AI through the shared model client, or the rules) — and
// sending a message. "Do task" is pressed on W5's list (POST /api/money/tasks);
// a row the helper works there shows up in this thread as a 'task' turn
// (src/finance/money-agent-tasks.mjs, docs/finance/money-agent-tasks.md §4).
//
// The work lives in src/finance/money-helper.mjs (routing, the queue, the
// writes) and src/finance/money-agent-ai.mjs (the brain and its checks). This
// file gates and fetches.
//
// SAME TWO CALLERS AS api/money/overview.mjs, same gate:
//   * a signed-in CLIENT reads and writes their own thread only. client_id
//     comes off the session; one in the query or body is never read on this branch.
//   * STAFF: requireRole(ROLE_SETS.FINANCE_OS) + requireClientInOrg on client_id.
//     Staff may write on a client's thread too (role-play on a test file); the
//     turn records actor 'staff'.
//   A client in another org is 404, not 403.
//
// The helper is SHADOW (agents FOS-01): it answers here and NEVER texts. Nothing
// here moves money — a transfer is only ever a proposal that needs the
// client's own approval.
import { db } from "../../src/db.mjs";
import { requirePrincipal } from "../../src/http/middleware/requirePrincipal.mjs";
import { ROLE_SETS, requireRole, isUuid, CLIENT_DATA_ERRORS } from "../../src/http/read-api.mjs";
import { requireClientInOrg } from "../../src/http/client-scope.mjs";
import { readBody } from "../banking/sync-accounts.mjs";
import { dbDown } from "../../src/http/db-down.mjs";
import {
  loadAgent, helperIsOn, threadState, readThread, viewTurn, bridgeStatus, answerOrphans, submitMessage
} from "../../src/finance/money-helper.mjs";
import { runnerMode } from "../../src/finance/money-agent-ai.mjs";

const ACTIONS = new Set(["send"]);

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
  if (!requireRole(res, staff, ROLE_SETS.FINANCE_OS)) return null;
  const qid = body ? body.client_id : req.query && req.query.client_id;
  if (!isUuid(qid)) {
    res.status(400).json({ ok: false, error: "client_id is required and must be a uuid" });
    return null;
  }
  const clientId = String(qid).trim();
  if (!(await requireClientInOrg(res, database, staff, clientId))) return null;
  return { orgId: staff.org_id, clientId, kind: "staff", staffId: isUuid(staff.id) ? staff.id : null };
}

/** GET payload — exported for tests and the fixture server. */
export async function helperPayload(database, { orgId, clientId, staff = false, env = process.env, now = new Date(), deps = {} }) {
  const c = await database.query(`SELECT id, first_name, last_name FROM clients WHERE id = $1 AND org_id = $2`, [clientId, orgId]);
  const client = c.rows[0];
  if (!client) return null;
  await answerOrphans(database, { orgId, clientId, env, now, deps });
  const [agent, state, rows, bridge] = await Promise.all([
    loadAgent(database, { orgId }),
    threadState(database, { orgId, clientId }),
    readThread(database, { orgId, clientId, limit: 60 }),
    bridgeStatus(database, { now })
  ]);
  const turns = rows.map((r) => viewTurn(r, { staff }));
  const name = [client.first_name, client.last_name].filter((x) => x && String(x).trim()).join(" ") || null;
  return {
    ok: true,
    client: { id: String(client.id), name },
    viewer: staff ? "staff" : "client",
    today: new Date(now).toISOString().slice(0, 10),
    helper: {
      code: agent.code,
      name: agent.name,
      status: agent.status,
      on: helperIsOn(agent),
      // Shadow answers here only; nothing is texted. Live texting is not built.
      sends_texts: false,
      brain: runnerMode(env),
      bridge_on: bridge.on,
      halted: !!state.halted_at,
      halt_reason: state.halt_reason
    },
    turns,
    pending: turns.filter((t) => t.status === "queued" || t.status === "running").length
  };
}

const ERROR_STATUS = {
  message_required: 400, message_too_long: 400,
  helper_off: 409, helper_stopped: 409, too_many: 429
};

export default async function handler(req, res, deps = {}) {
  const database = deps.db || db;
  const gate = deps.requirePrincipal || requirePrincipal;
  const clock = deps.now || (() => new Date());
  const env = deps.env || process.env;
  const build = deps.helperPayload || helperPayload;
  const send = deps.submitMessage || submitMessage;

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
  const staff = who.kind === "staff";

  try {
    if (method === "GET") {
      const payload = await build(database, { orgId, clientId, staff, env, now, deps: deps.helperDeps || {} });
      if (!payload) return res.status(404).json({ ok: false, error: "not_found" });
      return res.status(200).json(payload);
    }

    const action = String(body.action || "");
    if (!ACTIONS.has(action)) return res.status(400).json({ ok: false, error: "unknown_action" });

    const r = await send(database, {
      orgId, clientId, input: body.message, actor: who.kind, staffId: who.staffId, env, now, deps: deps.helperDeps || {}
    });
    if (!r || !r.ok) {
      const error = (r && r.error) || "not_done";
      return res.status(ERROR_STATUS[error] || 409).json({ ok: false, error, message: (r && r.message) || null });
    }
    const turn = r.turn ? viewTurn(r.turn, { staff }) : null;
    return res.status(r.queued ? 202 : 200).json({ ok: true, action, queued: !!r.queued, turn });
  } catch (e) {
    if (CLIENT_DATA_ERRORS.has(e && e.code)) return res.status(400).json({ ok: false, error: "invalid_parameter" });
    if (dbDown(res, e)) return;
    throw e;
  }
}
