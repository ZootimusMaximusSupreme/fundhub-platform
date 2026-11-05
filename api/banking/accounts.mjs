// /api/banking/accounts — the manual-entry write path for bank accounts, credit
// cards, statement cycles and investment holdings, plus the read that serves
// them back.
//
//   GET  ?client_id=<uuid>
//        → { ok, provider, accounts[], cycles[], holdings[] }
//
//   POST { client_id, action: "create_account",   ...account fields }
//   POST { client_id, action: "set_cycle",        bank_account_id, ...cycle fields }
//   POST { client_id, action: "replace_holdings", bank_account_id, holdings[] }
//   POST { client_id, action: "import" }
//        → { ok, ... }
//
// ONE FILE WITH AN ACTION DISCRIMINATOR, matching api/inquiries.mjs, rather than
// four sibling routes. Four routes would be four entries in the ROUTES map, four
// role gates to keep in step and four places to forget the org scope.
//
//
// *** THE GATE IS TWO CALLS, AND READS AND WRITES GET DIFFERENT SETS. ***
//
// requireAuth's third parameter is { db, env }, passed straight to
// authenticate(), which destructures exactly those two names — a `roles` key
// there is accepted by the object literal and silently dropped.
// api/read/tradelines.mjs shipped that once and the effective rule became "any
// authenticated staff session, any role" on an endpoint serving a named client's
// balances. So the role check is its own requireRole() call, below.
//
// READS: ROLE_SETS.STAFF. api/read/banking-surface.mjs already serves this exact
// data to that set, so gating the read here more tightly would buy nothing —
// anyone refused could read the same rows next door.
//
// WRITES: ROLE_SETS.FINANCE — {owner, admin, sales_manager} — deliberately
// NARROWER than the read set. (sales_manager is in FINANCE by an owner decision
// recorded at src/http/read-api.mjs, H-6, 2026-08-01; this line said
// {owner, admin} until 2026-08-18 and was out of date. The gate never changed.)
// Creating or replacing a person's financial records is not the same act as
// reading them: a
// wrong read is a glance, a wrong write replaces a portfolio or invents a debt,
// and replace_holdings in particular deletes rows. Widen this only by naming a
// role, never by reusing STAFF because it was already imported.
//
//
// NO SHIFT GATE, ON PURPOSE. api/inquiries.mjs gates its POST branch on an open
// shift because the owner's rule is "gate writes that affect attribution or pay:
// claiming a lead, logging a call outcome, moving a pipeline stage, sending
// client messages". Typing in a bank balance is none of those. It touches no
// worked_by column and bills to no clock, and gating it would 403 the owner
// entering his own accounts outside working hours.
//
//
// ORG COMES FROM THE SESSION, NEVER THE PAYLOAD. staff.org_id is the only source
// of org_id in this file. A request cannot name its own org, so a caller cannot
// read or write another company's rows by editing a body field.

import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { ROLE_SETS, requireRole, isUuid, CLIENT_DATA_ERRORS } from "../../src/http/read-api.mjs";
import { toCents } from "../../src/commissions/money.mjs";
import {
  createManualBankAccount,
  saveStatementCycle,
  replaceHoldings,
  listBankAccounts,
  listStatementCycles,
  listHoldings,
  BankAccountWriteError
} from "../../src/banking/accounts.mjs";
import { importAccounts, BankImportError } from "../../src/banking/import.mjs";
import { bankingProviderName } from "../../src/banking/provider.mjs";
import { nextDueDate, nextStatementClose } from "../../src/banking/statement-cycles.mjs";
import { requireClientInOrg } from "../../src/http/client-scope.mjs";
import { clientAssetProfile } from "../../src/http/client-asset-profile.mjs";

/**
 * Dollars from a form → integer cents, PRESERVING UNKNOWN.
 *
 * *** DO NOT REPLACE THIS WITH toCents() DIRECTLY. ***
 *
 * toCents(null), toCents(undefined) and toCents("") all return 0, and that is
 * correct for its own job — it is documented as "no payments yet is a legitimate
 * zero base" for commission maths. It is exactly wrong here. An empty credit
 * limit box means "I do not know this card's limit", and storing 0 would render
 * as $0.00 on the dashboard and, worse, would make the utilisation calculation
 * divide by zero or report a card as maxed out.
 *
 * NULL means unknown and must survive to the screen as an em dash. This function
 * is the boundary where that rule is kept.
 */
function dollarsToCentsOrNull(value, field) {
  if (value === null || value === undefined || value === "") return null;
  try {
    return toCents(value);
  } catch {
    throw new BankAccountWriteError(`${field} is not an amount of money`, { field });
  }
}

/** Today, as the calendar date on the server, for the cycle maths. The pure
 *  module takes it as a parameter precisely so that the clock is read HERE, once,
 *  at the I/O edge, and never inside the arithmetic. */
function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

async function handleGet(req, res, staff) {
  const clientId = (req.query || {}).client_id;
  if (!isUuid(clientId)) {
    return res.status(400).json({ ok: false, error: "client_id is required and must be a uuid" });
  }

  /* Belt and braces. The store already binds org_id into every WHERE, so a
     caller from another org gets empty lists rather than data — safe, but it
     answers 200 where the three read endpoints next door answer 404, and
     inconsistent security behaviour between neighbouring endpoints is how a gap
     reappears later. Same check, same answer, everywhere. */
  if (!(await requireClientInOrg(res, db, staff, String(clientId).trim()))) return;

  const scope = { orgId: staff.org_id, clientId: String(clientId).trim() };
  const [accounts, cycles, holdings] = await Promise.all([
    listBankAccounts(db, scope),
    listStatementCycles(db, scope),
    listHoldings(db, scope)
  ]);

  const today = todayIso();

  return res.status(200).json({
    ok: true,
    // The screen must be able to say where these numbers came from. A dashboard
    // that cannot tell mock data from a real bank is a trap.
    provider: bankingProviderName(process.env),
    accounts,
    /* The next due date is computed SERVER-SIDE and sent down. The screen's rule
       is "never show a number the server did not send", and a due date derived in
       the browser is a number the server did not send — it would also mean the
       month-end rule existed in two languages. `unknown_reason` rides along so
       the screen can print WHY a date is missing instead of a blank cell. */
    cycles: cycles.map((c) => ({
      ...c,
      next_due: nextDueDate(c, { today }),
      next_close: nextStatementClose(c, { today })
    })),
    holdings,
    asset_profile: clientAssetProfile({ accounts, holdings, asOf: today }),
    as_of: today
  });
}

async function handlePost(req, res, staff) {
  const body = req.body || {};
  const clientId = body.client_id;
  if (!isUuid(clientId)) {
    return res.status(400).json({ ok: false, error: "client_id is required and must be a uuid" });
  }

  // Same boundary on the write path. A write against another org's client must
  // refuse for the same reason and with the same answer as a read.
  if (!(await requireClientInOrg(res, db, staff, String(clientId).trim()))) return;

  const scope = { orgId: staff.org_id, clientId: String(clientId).trim() };

  switch (body.action) {
    case "create_account": {
      const account = await createManualBankAccount(db, {
        name: body.name,
        official_name: body.official_name,
        mask: body.mask,
        account_type: body.account_type,
        account_subtype: body.account_subtype,
        currency_code: body.currency_code || "USD",
        entity_kind: body.entity_kind,
        available_balance_cents: dollarsToCentsOrNull(body.available_balance, "available_balance"),
        current_balance_cents: dollarsToCentsOrNull(body.current_balance, "current_balance"),
        credit_limit_cents: dollarsToCentsOrNull(body.credit_limit, "credit_limit"),
        balance_as_of: body.balance_as_of ?? null
      }, scope);
      return res.status(201).json({ ok: true, account });
    }

    case "set_cycle": {
      if (!isUuid(body.bank_account_id)) {
        return res.status(400).json({ ok: false, error: "bank_account_id must be a uuid" });
      }
      const cycle = await saveStatementCycle(db, {
        statement_close_day: body.statement_close_day,
        payment_due_day: body.payment_due_day,
        last_statement_date: body.last_statement_date ?? null,
        last_statement_balance_cents: dollarsToCentsOrNull(body.last_statement_balance, "last_statement_balance"),
        minimum_payment_cents: dollarsToCentsOrNull(body.minimum_payment, "minimum_payment"),
        /* Passed through RAW. readApr() in the store converts "24.99" to 0.2499
           and leaves 0.2499 alone, so it is safe wherever it runs — but it must
           run in exactly one place. Converting here as well would be the second
           normaliser that inflates a figure a hundredfold, which this repo has
           already been bitten by once. */
        apr: body.apr,
        source: "manual"
      }, { ...scope, bankAccountId: body.bank_account_id });
      return res.status(200).json({ ok: true, cycle });
    }

    case "replace_holdings": {
      if (!isUuid(body.bank_account_id)) {
        return res.status(400).json({ ok: false, error: "bank_account_id must be a uuid" });
      }
      if (!Array.isArray(body.holdings)) {
        return res.status(400).json({ ok: false, error: "holdings must be an array" });
      }
      const out = await replaceHoldings(db, body.holdings.map((h) => ({
        symbol: h.symbol,
        description: h.description,
        quantity: h.quantity,
        cost_basis_cents: dollarsToCentsOrNull(h.cost_basis, "cost_basis"),
        current_value_cents: dollarsToCentsOrNull(h.current_value, "current_value"),
        currency_code: h.currency_code || "USD",
        as_of: h.as_of ?? null,
        source: "manual"
      })), { ...scope, bankAccountId: body.bank_account_id });
      return res.status(200).json({ ok: true, ...out });
    }

    case "import": {
      const out = await importAccounts(db, { ...scope, env: process.env, today: todayIso() });
      return res.status(200).json({ ok: true, ...out });
    }

    default:
      return res.status(400).json({
        ok: false,
        error: "unknown action",
        allowed: ["create_account", "set_cycle", "replace_holdings", "import"]
      });
  }
}

export default async function handler(req, res) {
  const method = req.method || "GET";
  if (!["GET", "POST"].includes(method)) {
    res.setHeader("allow", "GET, POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const staff = await requireAuth(req, res, { db });
  if (!staff) return;

  // Reads are STAFF, writes are FINANCE. See the header for why they differ.
  const gate = method === "GET" ? ROLE_SETS.STAFF : ROLE_SETS.FINANCE;
  if (!requireRole(res, staff, gate)) return;

  /* NO ORG ON THE SESSION MEANS NO ACCESS. The store binds org_id into every
     WHERE and every INSERT, and `org_id = NULL` matches no row in Postgres — so
     a session without an org already fails closed at the database. Refusing here
     as well makes it a stated rule rather than an emergent one, and gives a
     clearer answer than an empty list that looks like "this client has nothing". */
  if (!staff.org_id) {
    return res.status(403).json({ ok: false, error: "no_org_on_session" });
  }

  try {
    return method === "GET"
      ? await handleGet(req, res, staff)
      : await handlePost(req, res, staff);
  } catch (e) {
    if (e instanceof BankAccountWriteError || e instanceof BankImportError) {
      return res.status(e.status || 400).json({
        ok: false, error: e.message, field: e.field ?? undefined, reason: e.reason ?? undefined
      });
    }
    if (CLIENT_DATA_ERRORS.has(e.code)) {
      return res.status(400).json({ ok: false, error: "bad request parameter" });
    }
    throw e;
  }
}
