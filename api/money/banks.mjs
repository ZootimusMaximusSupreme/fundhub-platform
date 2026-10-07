// GET  /api/money/banks[?client_id=<uuid>]
// POST /api/money/banks  { action, client_id, ... }
//
// FinanceOS bank strategy (wave 5, unit W2): banks near you to open an account
// at, the card stacking order, the next funding sequence, and the bank
// relationship tracker. The rules and their sources live in
// src/finance/bank-strategy.mjs; this file gates, reads and writes.
//
// RESPONSE: the next funding sequence is `next_sequence`. It was `next_round`.
// The old name is still sent, the same object, as an alias kept for ONE RELEASE
// so the current screen keeps working. New readers use `next_sequence`.
//
// SAME TWO CALLERS AS api/money/overview.mjs, same gate:
//   * a signed-in CLIENT reads their own file only. client_id comes off the
//     session; one in the query or body is never read on this branch. A client
//     cannot POST — every action here is staff's.
//   * STAFF: requireRole(ROLE_SETS.FINANCE) (owner / admin / sales_manager) +
//     requireClientInOrg on client_id. The role check is its own call;
//     requireAuth drops a `roles` key (CLAUDE.md §12).
//
// POST actions (staff only):
//   plan_bank            { bank | lender_id, account_kind?, container_id?,
//                          planned_open_on?, planned_deposit_cents?, notes? }
//   open_account         { relationship_id | bank + account_kind, opened_on, container_id? }
//   record_deposit       { relationship_id, amount_cents, deposited_on, note? }
//   set_state            { relationship_id, state: skipped | open }
//   set_next_sequence_date  { ready_date }  — the next funding sequence date, Blueprint buyers only
//   set_next_round_date     { ready_date }  — the old name for the same action, kept for one release
//
// Nothing here moves money. "Record a deposit" writes down one staff saw land.
import { db } from "../../src/db.mjs";
import { requirePrincipal } from "../../src/http/middleware/requirePrincipal.mjs";
import { ROLE_SETS, requireRole, isUuid, CLIENT_DATA_ERRORS } from "../../src/http/read-api.mjs";
import { requireClientInOrg } from "../../src/http/client-scope.mjs";
import {
  bankStrategy, planBank, openAccount, recordDeposit, setRelationshipState, setNextSequenceDate,
  BankStrategyInputError
} from "../../src/finance/bank-strategy.mjs";
import { readBody } from "../banking/sync-accounts.mjs";
import { dbDown } from "../../src/http/db-down.mjs";

/* set_next_round_date is the old name of set_next_sequence_date, kept for one release. */
const ACTIONS = new Set(["plan_bank", "open_account", "record_deposit", "set_state", "set_next_sequence_date", "set_next_round_date"]);

/** Who is asking, and for which file. Returns { orgId, clientId, kind, staffId }
 *  or writes the refusal and returns null. */
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

const NOT_FOUND_WORDS = "That bank is not on this client's plan. Reload and try again.";

export default async function handler(req, res, deps = {}) {
  const database = deps.db || db;
  const gate = deps.requirePrincipal || requirePrincipal;
  const clock = deps.now || (() => new Date());
  const store = {
    read: deps.bankStrategy || bankStrategy,
    plan: deps.planBank || planBank,
    open: deps.openAccount || openAccount,
    deposit: deps.recordDeposit || recordDeposit,
    state: deps.setRelationshipState || setRelationshipState,
    nextDate: deps.setNextSequenceDate || deps.setNextRoundDate || setNextSequenceDate
  };

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
  const today = now.toISOString().slice(0, 10);

  try {
    if (method === "GET") {
      const payload = await store.read(database, { orgId, clientId, asOf: now });
      if (!payload) return res.status(404).json({ ok: false, error: "not_found" });
      return res.status(200).json(payload);
    }

    if (who.kind !== "staff") {
      return res.status(403).json({ ok: false, error: "forbidden", message: "Only Fundhub staff can change the bank plan." });
    }
    const action = String(body.action || "");
    if (!ACTIONS.has(action)) return res.status(400).json({ ok: false, error: "unknown_action" });

    let out;
    if (action === "plan_bank") out = await store.plan(database, { orgId, clientId, input: body });
    else if (action === "open_account") out = await store.open(database, { orgId, clientId, input: body, today });
    else if (action === "record_deposit") out = await store.deposit(database, { orgId, clientId, input: body, staffId: who.staffId, today });
    else if (action === "set_state") out = await store.state(database, { orgId, clientId, input: body });
    else out = await store.nextDate(database, { orgId, clientId, input: body });

    if (!out || out.ok !== true) {
      const error = (out && out.error) || "not_saved";
      if (error === "not_found") return res.status(404).json({ ok: false, error, message: NOT_FOUND_WORDS });
      if (error === "not_blueprint_buyer") {
        return res.status(403).json({ ok: false, error,
          message: "The next funding sequence date is part of the Capital Blueprint. This client has not bought it." });
      }
      if (error === "invalid_ready_date") {
        return res.status(400).json({ ok: false, error, message: "The next funding sequence date must be a date like 2026-12-01." });
      }
      return res.status(400).json({ ok: false, error });
    }
    return res.status(action === "record_deposit" ? 201 : 200).json({ ok: true, action, ...out });
  } catch (e) {
    if (e instanceof BankStrategyInputError) return res.status(400).json({ ok: false, error: e.code, message: e.message });
    if (CLIENT_DATA_ERRORS.has(e && e.code)) return res.status(400).json({ ok: false, error: "invalid_parameter" });
    if (dbDown(res, e)) return;
    throw e;
  }
}
