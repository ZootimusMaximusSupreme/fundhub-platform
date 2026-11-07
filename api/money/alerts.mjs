// GET  /api/money/alerts[?client_id=<uuid>]
// POST /api/money/alerts  { action: "set_alert", kind, enabled, client_id? }
//                         { action: "set_promo", account_id, ends_on, apr_pct?, client_id? }
//                         { action: "set_statement_close_day", account_id, day, client_id? }
//                         { action: "set_bill_important", bill_id, important, client_id? }
//                         { action: "set_phone_alerts", enabled, client_id? }
//                         { action: "add_custom", kind, name, amount_cents?, cadence, day_of_month? | start_on?,
//                           scope, entity_id?, phone_alert?, client_id? }
//                         { action: "update_custom", id, (the same fields but kind), client_id? }
//                         { action: "set_custom_phone", id, enabled, client_id? }
//                         { action: "remove_custom", id, client_id? }
//
// The four *_custom actions (unit AL2, 2026-11-07) save the client's own alerts and
// repeat bills (src/finance/file-alerts/custom.mjs, migration 583). Removing one
// sets archived_at; nothing is deleted.
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
// POST changes five things a person owns: which kinds are on (set_alert), a card's
// promo end date and rate (set_promo — ends_on null clears it), the day of the
// month a card's statement closes (set_statement_close_day — a hand-entered card has
// no close day, and the pay-before-close text cannot go without one), whether a
// repeat bill is Important (set_bill_important — an Important bill gets a phone
// alert a few days before it charges), and the one switch for every phone alert
// (set_phone_alerts). Phone alerts: src/push/finance-alerts.mjs, unit D 2026-11-06.
//
// SAME TWO CALLERS AND SAME GATE AS api/money/overview.mjs:
//   * a signed-in CLIENT reads and changes their own file only. client_id comes off
//     the session; one in the query or body is never read on this branch.
//   * STAFF: requireRole(ROLE_SETS.FINANCE_OS) + requireClientInOrg on client_id. A
//     client in another org is 404, not 403. Staff changes are stamped 'staff'.
//
// Nothing here texts anyone and nothing moves money.
import { db } from "../../src/db.mjs";
import { requirePrincipal } from "../../src/http/middleware/requirePrincipal.mjs";
import { ROLE_SETS, requireRole, isUuid, CLIENT_DATA_ERRORS } from "../../src/http/read-api.mjs";
import { requireClientInOrg } from "../../src/http/client-scope.mjs";
import { fileAlertsPayload } from "../../src/finance/file-alerts/read.mjs";
import {
  setAlertEnabled, setPromo, setStatementCloseDay, setPhoneAlerts, readCloseDay, FileAlertInputError
} from "../../src/finance/file-alerts/store.mjs";
import { setBillImportant } from "../../src/finance/file-alerts/bills.mjs";
import {
  readCustomInput, addCustomItem, updateCustomItem, removeCustomItem, setCustomPhone, customKindOf, customView
} from "../../src/finance/file-alerts/custom.mjs";
import { readPromoInput, PromoInputError } from "../../src/finance/file-alerts/promo.mjs";
import { KINDS } from "../../src/finance/file-alerts/common.mjs";
import { alertsBundlePayload, setBundleAlert } from "../../src/finance/file-alerts/bundle.mjs";
import { readBody } from "../banking/sync-accounts.mjs";
import { dbDown } from "../../src/http/db-down.mjs";

// set_bundle_alert and GET ?part=bundle: the alerts bundle (unit AL, 2026-11-07) —
// src/finance/file-alerts/bundle.mjs. add_custom, update_custom, set_custom_phone
// and remove_custom: the client's own alerts and bills (unit AL2). No new route.
export const ACTIONS = Object.freeze([
  "set_alert", "set_promo", "set_statement_close_day", "set_bill_important", "set_phone_alerts",
  "set_bundle_alert", "add_custom", "update_custom", "set_custom_phone", "remove_custom"
]);

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
  if (!requireRole(res, staff, ROLE_SETS.FINANCE_OS)) return null;
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
    setStatementCloseDay: deps.setStatementCloseDay || setStatementCloseDay,
    setBillImportant: deps.setBillImportant || setBillImportant,
    setPhoneAlerts: deps.setPhoneAlerts || setPhoneAlerts,
    addCustomItem: deps.addCustomItem || addCustomItem,
    updateCustomItem: deps.updateCustomItem || updateCustomItem,
    setCustomPhone: deps.setCustomPhone || setCustomPhone,
    removeCustomItem: deps.removeCustomItem || removeCustomItem,
    customKindOf: deps.customKindOf || customKindOf
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
      // ?part=bundle answers only the alerts bundle (the box under the Alerts section), so the
      // section's own read is not built a second time.
      if (req.query && req.query.part === "bundle") {
        const bundle = await (deps.alertsBundlePayload || alertsBundlePayload)(database, { orgId, clientId, now, env });
        if (!bundle) return res.status(404).json({ ok: false, error: "not_found" });
        return res.status(200).json({ ok: true, bundle });
      }
      const payload = await load(database, { orgId, clientId, now, env });
      if (!payload) return res.status(404).json({ ok: false, error: "not_found" });
      return res.status(200).json(payload);
    }

    const action = body.action;
    if (!ACTIONS.includes(action)) return res.status(400).json({ ok: false, error: "unknown_action", actions: ACTIONS });

    if (action === "set_bundle_alert") {
      const saved = await (deps.setBundleAlert || setBundleAlert)(database, { orgId, clientId, body, by: who.kind });
      return res.status(200).json({ ok: true, action, saved });
    }

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

    if (action === "set_phone_alerts") {
      if (typeof body.enabled !== "boolean") {
        return badInput(res, new FileAlertInputError("enabled", "enabled must be true or false"));
      }
      await writes.setPhoneAlerts(database, { orgId, clientId, enabled: body.enabled, by: who.kind });
      return res.status(200).json({ ok: true, action, saved: { phone_alerts: body.enabled } });
    }

    if (action === "set_bill_important") {
      if (!isUuid(body.bill_id)) {
        return badInput(res, new FileAlertInputError("bill_id", "bill_id is required and must be a uuid"));
      }
      if (typeof body.important !== "boolean") {
        return badInput(res, new FileAlertInputError("important", "important must be true or false"));
      }
      const r = await writes.setBillImportant(database, {
        orgId, clientId, billId: String(body.bill_id).trim(), important: body.important, by: who.kind
      });
      return res.status(200).json({ ok: true, action, saved: { bill_id: r.bill_id, important: r.important } });
    }

    /* The client's own alerts and repeat bills (unit AL2). */
    const today = now.toISOString().slice(0, 10);
    if (action === "add_custom") {
      const input = readCustomInput(body, { today });
      const row = await writes.addCustomItem(database, { orgId, clientId, input, by: who.kind });
      return res.status(200).json({ ok: true, action, saved: customView(row, { today }) });
    }
    if (action === "update_custom") {
      if (!isUuid(body.id)) return badInput(res, new FileAlertInputError("id", "id is required and must be a uuid"));
      const id = String(body.id).trim();
      const kind = await writes.customKindOf(database, { orgId, clientId, id });
      const input = readCustomInput(body, { today, kind });
      const row = await writes.updateCustomItem(database, { orgId, clientId, id, input, by: who.kind });
      return res.status(200).json({ ok: true, action, saved: customView(row, { today }) });
    }
    if (action === "set_custom_phone") {
      if (!isUuid(body.id)) return badInput(res, new FileAlertInputError("id", "id is required and must be a uuid"));
      if (typeof body.enabled !== "boolean") {
        return badInput(res, new FileAlertInputError("enabled", "enabled must be true or false"));
      }
      const r = await writes.setCustomPhone(database, { orgId, clientId, id: String(body.id).trim(), enabled: body.enabled, by: who.kind });
      return res.status(200).json({ ok: true, action, saved: r });
    }
    if (action === "remove_custom") {
      if (!isUuid(body.id)) return badInput(res, new FileAlertInputError("id", "id is required and must be a uuid"));
      const r = await writes.removeCustomItem(database, { orgId, clientId, id: String(body.id).trim(), by: who.kind });
      return res.status(200).json({ ok: true, action, saved: r });
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
