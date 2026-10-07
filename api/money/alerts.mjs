// GET  /api/money/alerts[?client_id=<uuid>]
// POST /api/money/alerts  { action: "set_alert", kind, enabled, client_id? }
//                         { action: "set_promo", account_id, ends_on, apr_pct?, client_id? }
//                         { action: "set_statement_close_day", account_id, day, client_id? }
//
// File-protection alerts (Capital Blueprint launch, unit B2): pay a card down before
// its statement closes, a promo rate ending (60 / 30 / 7 days), the cash cushion
// (six months of minimums), and new credit. The daily job that sends them is
// src/workflows/blueprint-finance-os-alerts.mjs; the logic and the JSON shape are in
// src/finance/file-alerts/ and docs/finance/file-protection-alerts.md.
//
// GET answers the settings, every card with its next statement close and promo, the
// two cash-cushion verdicts (personal and business, never added together), and the
// alerts that already went out.
//
// POST changes three things a person owns: which kinds are on (set_alert), a card's
// promo end date and rate (set_promo — ends_on null clears it), and the day of the
// month a card's statement closes (set_statement_close_day — a hand-entered card has
// no close day, and the pay-before-close text cannot go without one).
//
// SAME TWO CALLERS AND SAME GATE AS api/money/overview.mjs:
//   * a signed-in CLIENT reads and changes their own file only. client_id comes off
//     the session; one in the query or body is never read on this branch.
//   * STAFF: requireRole(ROLE_SETS.FINANCE) + requireClientInOrg on client_id. A
//     client in another org is 404, not 403. Staff changes are stamped 'staff'.
//
// Nothing here texts anyone and nothing moves money.
import { db } from "../../src/db.mjs";
import { requirePrincipal } from "../../src/http/middleware/requirePrincipal.mjs";
import { ROLE_SETS, requireRole, isUuid, CLIENT_DATA_ERRORS } from "../../src/http/read-api.mjs";
import { requireClientInOrg } from "../../src/http/client-scope.mjs";
import { fileAlertsPayload } from "../../src/finance/file-alerts/read.mjs";
import {
  setAlertEnabled, setPromo, setStatementCloseDay, readCloseDay, FileAlertInputError
} from "../../src/finance/file-alerts/store.mjs";
import { readPromoInput, PromoInputError } from "../../src/finance/file-alerts/promo.mjs";
import { KINDS } from "../../src/finance/file-alerts/common.mjs";
import { readBody } from "../banking/sync-accounts.mjs";
import { dbDown } from "../../src/http/db-down.mjs";

export const ACTIONS = Object.freeze(["set_alert", "set_promo", "set_statement_close_day"]);

/** Who is asking, and for which file. Same block as api/money/strategy.mjs. */
async function scope(req, res, { database, gate, body }) {
  const principal = await gate(req, res, ["staff", "client"], { db: database });
  if (!principal) return null;

  if (principal.kind === "client") {
    const clientId = principal.clientId || null;
    const orgId = principal.orgId || null;
    if (!isUuid(clientId) || !orgId) {
      res.status(403).json({ ok: false, error: "forbidden", message: "Your login is not attached to a client file." });
      return null;
    }
    return { orgId, clientId, kind: "client" };
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
  return { orgId: staff.org_id, clientId, kind: "staff" };
}

function badInput(res, e, status = 400) {
  return res.status(status).json({ ok: false, error: "invalid_input", field: e.field ?? null, message: String(e.message).slice(0, 300) });
}

export default async function handler(req, res, deps = {}) {
  const database = deps.db || db;
  const gate = deps.requirePrincipal || requirePrincipal;
  const clock = deps.now || (() => new Date());
  const env = deps.env || process.env;
  const load = deps.fileAlertsPayload || fileAlertsPayload;
  const writes = {
    setAlertEnabled: deps.setAlertEnabled || setAlertEnabled,
    setPromo: deps.setPromo || setPromo,
    setStatementCloseDay: deps.setStatementCloseDay || setStatementCloseDay
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

  try {
    if (method === "GET") {
      const payload = await load(database, { orgId, clientId, now, env });
      if (!payload) return res.status(404).json({ ok: false, error: "not_found" });
      return res.status(200).json(payload);
    }

    const action = body.action;
    if (!ACTIONS.includes(action)) return res.status(400).json({ ok: false, error: "unknown_action", actions: ACTIONS });

    if (action === "set_alert") {
      const kind = typeof body.kind === "string" ? body.kind.trim() : "";
      if (!KINDS.includes(kind)) {
        return badInput(res, new FileAlertInputError("kind", `kind must be one of ${KINDS.join(", ")}`));
      }
      if (typeof body.enabled !== "boolean") {
        return badInput(res, new FileAlertInputError("enabled", "enabled must be true or false"));
      }
      await writes.setAlertEnabled(database, { orgId, clientId, kind, enabled: body.enabled, by: who.kind });
      return res.status(200).json({ ok: true, action, saved: { kind, enabled: body.enabled } });
    }

    const accountId = body.account_id;
    if (!isUuid(accountId)) {
      return badInput(res, new FileAlertInputError("account_id", "account_id is required and must be a uuid"));
    }
    const account = String(accountId).trim();

    if (action === "set_promo") {
      const read = readPromoInput(body, { today: now.toISOString().slice(0, 10) });
      const r = await writes.setPromo(database, {
        orgId, clientId, accountId: account, endsOn: read.endsOn, aprFraction: read.aprFraction, by: who.kind
      });
      return res.status(200).json({ ok: true, action, saved: { account_id: account, cleared: !!r.cleared, promo: r.promo } });
    }

    // set_statement_close_day
    const day = readCloseDay(body.day);
    const r = await writes.setStatementCloseDay(database, { orgId, clientId, accountId: account, day });
    return res.status(200).json({ ok: true, action, saved: { account_id: account, statement_close_day: r.statement_close_day } });
  } catch (e) {
    if (e instanceof FileAlertInputError) return badInput(res, e, e.status || 400);
    if (e instanceof PromoInputError) return badInput(res, e, 400);
    if (CLIENT_DATA_ERRORS.has(e && e.code)) {
      return res.status(400).json({ ok: false, error: "invalid_parameter" });
    }
    if (dbDown(res, e)) return;
    throw e;
  }
}
