// The writer for `bank_accounts`, `account_statement_cycles` and
// `investment_holdings`.
//
// *** NOTHING IN THIS REPOSITORY HAS EVER WRITTEN bank_accounts. ***
//
// That is not a figure of speech. 081 created the table in a migration, 082
// added columns to it, `src/finance/banking-surface.mjs` groups rows out of it
// and `api/read/banking-surface.mjs` serves them to a screen — and there has
// never been an INSERT. The Banking Surface screen has been empty since the day
// it shipped, and it was not broken; there was simply nothing to show. This file
// is the missing half.
//
//
// TENANCY IS THE CALLER'S TO ASSERT. `orgId` is a required parameter on every
// function here and is NEVER read from a payload, a query string or a provider
// response. src/banking/store.mjs states this rule for recurring bills and it is
// the same rule: the caller holds the authenticated session, so the caller is the
// authority on which org this write belongs to. A writer that could name its own
// org_id is a tenancy bypass one bad request away.
//
//
// *** MANUAL ENTRY MAY SET entity_kind. A PROVIDER MAY NOT. ***
//
// This is the one place the two paths deliberately diverge, and it is not an
// inconsistency.
//
// 082's CHECK allows entity_kind_source IN ('client_stated', 'staff_reviewed',
// 'document_verified', 'connection_metadata'). A human typing an account in IS an
// authority on whose money it is — that is 'staff_reviewed', and refusing to
// record it would throw away the only reliable signal this system ever gets.
//
// A provider is not an authority. plaid.mjs's getAccounts header spells it out:
// accounts arriving from a bank carry no ownership information this product can
// trust, and mapping a subtype onto 'personal' is exactly the inference 082
// exists to prevent. So importFromProvider() writes no entity_kind at all and
// every imported row sits at the 'unknown' default until a human classifies it.
//
//
// MONEY IN, MONEY OUT: INTEGER CENTS. Every *_cents parameter is already cents
// when it arrives here. The dollars-to-cents conversion happens once, at the HTTP
// edge, via toCents() in src/commissions/money.mjs. Doing it in both places is
// how an amount gets multiplied by a hundred twice, and this repo has already
// been bitten by exactly that with interest rates.
//
// APR IS THE EXCEPTION AND IS CONVERTED HERE, ON PURPOSE. readApr() is safe to
// call twice — it treats a value <= 1 as an already-correct fraction and only
// divides by 100 above that — so running it at the boundary of the store
// GUARANTEES a fraction reaches the column, whatever the endpoint did or forgot
// to do. A hand-rolled `/100` at the endpoint would not be safe to repeat, which
// is precisely why this is the one conversion that lives here.

import { db as sharedDb, pool } from "../db.mjs";
import { readApr } from "../tradelines/index.mjs";

/* -------------------------------------------------------------------------- *
 * Transaction helper
 *
 * THE CORRECT ONE. Copied from src/finance/soft-pulls.mjs, NOT from
 * src/banking/store.mjs next door, which carries the broken probe:
 *
 *     if (typeof db.connect !== "function") return fn(db);
 *
 * src/db.mjs exports `{ query }` and nothing else — no connect() — so that probe
 * is always true for the handle every production caller passes, and the callback
 * runs with autocommit. An account written with its statement cycle half-failing
 * would leave a card on screen with no due date and no error anywhere.
 * -------------------------------------------------------------------------- */

async function withTransaction(db, fn) {
  const acquire = typeof db?.connect === "function"
    ? () => db.connect()
    : (db === sharedDb ? () => pool().connect() : null);
  if (!acquire) return fn(db);
  const client = await acquire();
  try {
    await client.query("BEGIN");
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

/* -------------------------------------------------------------------------- *
 * Validation
 * -------------------------------------------------------------------------- */

/** A refusal the HTTP layer can map to a 400 without inspecting strings.
 *  Same shape as InquiryWriteError in src/inquiries/work.mjs. */
export class BankAccountWriteError extends Error {
  constructor(message, { status = 400, field = null } = {}) {
    super(message);
    this.name = "BankAccountWriteError";
    this.status = status;
    this.field = field;
  }
}

export const ACCOUNT_TYPES = ["depository", "credit", "loan", "investment", "other"];
export const ENTITY_KINDS = ["unknown", "personal", "business"];
/** Account types that can carry a due day and a payment (097, widened by 451). */
export const CYCLE_ACCOUNT_TYPES = ["credit", "loan"];

/**
 * A mask is the LAST FOUR DIGITS AND NOTHING ELSE.
 *
 * 081's header forbids a full account number or routing number column and says
 * neither may ever be added. That protection is worth nothing if a person can
 * type a sixteen-digit account number into the "last 4" box and have it stored
 * verbatim — the column name would be a comment, not a control.
 *
 * So this TRUNCATES rather than rejects. Rejecting would be defensible, but the
 * owner would then retype it correctly and the outcome is identical with an extra
 * step; truncating means a full number cannot land in the database even by
 * accident. Non-digits are dropped first so "**** 1234" works.
 */
export function normaliseMask(value) {
  if (value === null || value === undefined || value === "") return null;
  const digits = String(value).replace(/\D/g, "");
  if (!digits) return null;
  return digits.slice(-4);
}

/** Cents must be a whole number or absent. A float here means somebody passed
 *  dollars, and silently rounding it would turn $1,234.56 into 1235 cents. */
function readCents(value, field) {
  if (value === null || value === undefined || value === "") return null;
  if (!Number.isInteger(value)) {
    throw new BankAccountWriteError(
      `${field} must be an integer number of cents (got ${JSON.stringify(value)}) — convert dollars with toCents() before calling`,
      { field }
    );
  }
  return value;
}

/** Day of month, 1-31, or null. */
function readDayOfMonth(value, field) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 31) {
    throw new BankAccountWriteError(`${field} must be a whole number between 1 and 31`, { field });
  }
  return n;
}

function requireUuidish(value, field) {
  if (!value || typeof value !== "string") {
    throw new BankAccountWriteError(`${field} is required`, { field });
  }
  return value;
}

/* -------------------------------------------------------------------------- *
 * Manual entry
 * -------------------------------------------------------------------------- */

const INSERT_COLUMNS = [
  "org_id", "client_id", "plaid_item_id", "plaid_account_id",
  "name", "official_name", "mask", "account_type", "account_subtype",
  "currency_code", "available_balance_cents", "current_balance_cents",
  "credit_limit_cents", "balance_as_of", "raw"
];

/**
 * Create one hand-entered bank account.
 *
 * plaid_item_id and plaid_account_id are left NULL, which 081's header names as
 * the marker for a hand-entered row — "It is NOT 'we lost the link'". The partial
 * unique index `uq_bank_accounts_plaid` is partial for exactly this reason, so
 * manual rows do not collide with each other.
 *
 * NO DEDUPLICATION. Two hand-entered accounts with the same name and mask are two
 * rows. A person can genuinely hold two cards with the same last four at
 * different banks, and silently merging them would destroy one. If the owner
 * creates a duplicate by accident he can delete it; if the system merges two real
 * accounts he cannot get it back.
 */
export async function createManualBankAccount(db, input = {}, { orgId, clientId } = {}) {
  requireUuidish(orgId, "orgId");
  requireUuidish(clientId, "clientId");

  const accountType = input.account_type ?? null;
  if (accountType !== null && !ACCOUNT_TYPES.includes(accountType)) {
    throw new BankAccountWriteError(
      `account_type must be one of ${ACCOUNT_TYPES.join(", ")}`, { field: "account_type" });
  }

  const entityKind = input.entity_kind ?? null;
  if (entityKind !== null && !ENTITY_KINDS.includes(entityKind)) {
    throw new BankAccountWriteError(
      `entity_kind must be one of ${ENTITY_KINDS.join(", ")}`, { field: "entity_kind" });
  }

  const row = {
    org_id: orgId,
    client_id: clientId,
    plaid_item_id: null,
    plaid_account_id: null,
    name: input.name ?? null,
    official_name: input.official_name ?? null,
    mask: normaliseMask(input.mask),
    account_type: accountType,
    account_subtype: input.account_subtype ?? null,
    currency_code: input.currency_code ?? null,
    available_balance_cents: readCents(input.available_balance_cents, "available_balance_cents"),
    current_balance_cents: readCents(input.current_balance_cents, "current_balance_cents"),
    credit_limit_cents: readCents(input.credit_limit_cents, "credit_limit_cents"),
    // When the owner says the balance was true. NULL means he did not say, which
    // is honest — it is NOT "as of now", and defaulting it to now() would claim a
    // freshness nobody asserted.
    balance_as_of: input.balance_as_of ?? null,
    raw: JSON.stringify(input.raw ?? {})
  };

  return withTransaction(db, async (tx) => {
    const res = await tx.query(
      `INSERT INTO bank_accounts (${INSERT_COLUMNS.join(", ")})
       VALUES (${INSERT_COLUMNS.map((_, i) => `$${i + 1}`).join(", ")})
       RETURNING *`,
      INSERT_COLUMNS.map((c) => row[c])
    );
    const account = res.rows[0];

    /* A human IS an authority on whose money this is — see the file header. Set
       only when stated, so that leaving the field blank keeps the 'unknown'
       default rather than writing 'unknown' with a provenance that implies
       somebody looked. */
    if (entityKind && entityKind !== "unknown") {
      const updated = await tx.query(
        `UPDATE bank_accounts
            SET entity_kind = $2, entity_kind_source = 'staff_reviewed',
                entity_kind_set_at = now(), updated_at = now()
          WHERE id = $1
          RETURNING *`,
        [account.id, entityKind]
      );
      return updated.rows[0];
    }
    return account;
  });
}

/**
 * Create or replace the statement cycle for one account.
 *
 * The cycle is a SEPARATE call from creating the account because most accounts do
 * not have one — a chequing account has no statement close day — and because the
 * owner may learn his due date after he has already entered the card.
 *
 * REFUSES A CYCLE ON AN ACCOUNT THAT IS NOT A CARD OR A LOAN. 096 could not
 * express this as a CHECK (it is a cross-table condition), so the writer enforces
 * it. A statement cycle on a savings account would put a fake "payment due" on
 * the dashboard for money nobody owes. A loan was added by 451: its due day and
 * monthly payment live in the same two columns a card uses (minimum_payment_cents
 * is "what is due by the due date" for both). See 451's header.
 */
export async function saveStatementCycle(db, input = {}, { orgId, clientId, bankAccountId } = {}) {
  requireUuidish(orgId, "orgId");
  requireUuidish(clientId, "clientId");
  requireUuidish(bankAccountId, "bankAccountId");

  const row = {
    org_id: orgId,
    client_id: clientId,
    bank_account_id: bankAccountId,
    statement_close_day: readDayOfMonth(input.statement_close_day, "statement_close_day"),
    payment_due_day: readDayOfMonth(input.payment_due_day, "payment_due_day"),
    last_statement_date: input.last_statement_date ?? null,
    last_statement_balance_cents: readCents(input.last_statement_balance_cents, "last_statement_balance_cents"),
    minimum_payment_cents: readCents(input.minimum_payment_cents, "minimum_payment_cents"),
    // The one conversion that lives in the store. See the file header.
    apr: readApr(input.apr),
    source: input.source === "provider" ? "provider" : "manual",
    raw: JSON.stringify(input.raw ?? {})
  };

  return withTransaction(db, async (tx) => {
    const owner = await tx.query(
      `SELECT account_type FROM bank_accounts WHERE id = $1 AND org_id = $2 AND client_id = $3`,
      [bankAccountId, orgId, clientId]
    );
    if (owner.rows.length === 0) {
      // 404-shaped, not 403-shaped: a caller from another org must not be able to
      // tell "this account exists but is not yours" from "no such account".
      throw new BankAccountWriteError("no such account", { status: 404, field: "bankAccountId" });
    }
    if (!CYCLE_ACCOUNT_TYPES.includes(owner.rows[0].account_type)) {
      throw new BankAccountWriteError(
        "a statement cycle can only be set on a credit account or a loan", { field: "bankAccountId" });
    }

    const cols = Object.keys(row);
    const updates = cols
      .filter((c) => !["org_id", "client_id", "bank_account_id"].includes(c))
      .map((c) => `${c} = EXCLUDED.${c}`);

    const res = await tx.query(
      `INSERT INTO account_statement_cycles (${cols.join(", ")})
       VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")})
       ON CONFLICT (bank_account_id)
       DO UPDATE SET ${updates.join(", ")}, updated_at = now()
       RETURNING *`,
      cols.map((c) => row[c])
    );
    return res.rows[0];
  });
}

/**
 * Replace the holdings for one investment account with exactly this set.
 *
 * REPLACE, NOT MERGE — the same call src/banking/store.mjs makes for bill
 * evidence. A portfolio read is a statement of what is held right now; merging
 * would leave a position the owner sold last month sitting in his net worth
 * forever, and he would have no way to remove it.
 *
 * Symbols are uppercased HERE, in one place. 097 stores them verbatim precisely
 * so that this rule can change without a data migration.
 */
export async function replaceHoldings(db, holdings = [], { orgId, clientId, bankAccountId } = {}) {
  requireUuidish(orgId, "orgId");
  requireUuidish(clientId, "clientId");
  requireUuidish(bankAccountId, "bankAccountId");

  const rows = holdings.map((h, i) => {
    const symbol = String(h?.symbol ?? "").trim().toUpperCase();
    if (!symbol) {
      throw new BankAccountWriteError(`holding ${i}: symbol is required`, { field: "symbol" });
    }
    return {
      symbol,
      description: h.description ?? null,
      // Quantity is NOT cents — it is a share count and may be fractional.
      // 097's header explains why it is numeric(20,8) and not bigint.
      quantity: h.quantity === null || h.quantity === undefined || h.quantity === "" ? null : String(h.quantity),
      cost_basis_cents: readCents(h.cost_basis_cents, "cost_basis_cents"),
      current_value_cents: readCents(h.current_value_cents, "current_value_cents"),
      currency_code: h.currency_code ?? null,
      as_of: h.as_of ?? null,
      source: h.source === "provider" ? "provider" : "manual"
    };
  });

  return withTransaction(db, async (tx) => {
    const owner = await tx.query(
      `SELECT account_type FROM bank_accounts WHERE id = $1 AND org_id = $2 AND client_id = $3`,
      [bankAccountId, orgId, clientId]
    );
    if (owner.rows.length === 0) {
      throw new BankAccountWriteError("no such account", { status: 404, field: "bankAccountId" });
    }
    if (owner.rows[0].account_type !== "investment") {
      throw new BankAccountWriteError(
        "holdings can only be set on an investment account", { field: "bankAccountId" });
    }

    await tx.query(`DELETE FROM investment_holdings WHERE bank_account_id = $1`, [bankAccountId]);

    let written = 0;
    for (const r of rows) {
      await tx.query(
        `INSERT INTO investment_holdings
           (org_id, client_id, bank_account_id, symbol, description, quantity,
            cost_basis_cents, current_value_cents, currency_code, as_of, source)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [orgId, clientId, bankAccountId, r.symbol, r.description, r.quantity,
         r.cost_basis_cents, r.current_value_cents, r.currency_code, r.as_of, r.source]
      );
      written++;
    }
    return { replaced: written };
  });
}

/* -------------------------------------------------------------------------- *
 * Reads — every one org-scoped
 * -------------------------------------------------------------------------- */

/* NEVER `SELECT *` ACROSS A JOIN TO plaid_items. That table holds
   encrypted_access_token one join away, and a read endpoint should not be one
   typo from it. api/read/banking-surface.mjs makes the same call. */
const ACCOUNT_COLUMNS = `
  id, client_id, plaid_item_id, name, official_name, mask,
  account_type, account_subtype, currency_code,
  available_balance_cents, current_balance_cents, credit_limit_cents,
  balance_as_of, entity_kind, entity_kind_source, entity_kind_set_at,
  closed_at, created_at, updated_at`;

/**
 * Every account for one client, scoped to the caller's org.
 *
 * orgId is REQUIRED and is applied as a filter, not merely checked. A missing org
 * binds NULL and `org_id = NULL` matches no row in Postgres, so the fail-closed
 * behaviour is the database's, not a branch someone can forget.
 */
export async function listBankAccounts(db, { orgId, clientId } = {}) {
  requireUuidish(orgId, "orgId");
  requireUuidish(clientId, "clientId");
  const res = await db.query(
    `SELECT ${ACCOUNT_COLUMNS} FROM bank_accounts
      WHERE org_id = $1 AND client_id = $2
      ORDER BY account_type NULLS LAST, name NULLS LAST, id`,
    [orgId, clientId]
  );
  return res.rows;
}

/** Statement cycles for one client, org-scoped. Joined to the account so a
 *  screen can name the card without a second round trip. */
export async function listStatementCycles(db, { orgId, clientId } = {}) {
  requireUuidish(orgId, "orgId");
  requireUuidish(clientId, "clientId");
  const res = await db.query(
    `SELECT c.*, a.name AS account_name, a.mask AS account_mask,
            a.credit_limit_cents, a.current_balance_cents
       FROM account_statement_cycles c
       JOIN bank_accounts a ON a.id = c.bank_account_id
      WHERE c.org_id = $1 AND c.client_id = $2
      ORDER BY c.payment_due_day NULLS LAST, a.name NULLS LAST`,
    [orgId, clientId]
  );
  return res.rows;
}

/** Holdings for one client, org-scoped, largest position first. */
export async function listHoldings(db, { orgId, clientId } = {}) {
  requireUuidish(orgId, "orgId");
  requireUuidish(clientId, "clientId");
  const res = await db.query(
    `SELECT h.*, a.name AS account_name
       FROM investment_holdings h
       JOIN bank_accounts a ON a.id = h.bank_account_id
      WHERE h.org_id = $1 AND h.client_id = $2
      ORDER BY h.current_value_cents DESC NULLS LAST, h.symbol`,
    [orgId, clientId]
  );
  return res.rows;
}

export default {
  BankAccountWriteError,
  ACCOUNT_TYPES,
  ENTITY_KINDS,
  CYCLE_ACCOUNT_TYPES,
  normaliseMask,
  createManualBankAccount,
  saveStatementCycle,
  replaceHoldings,
  listBankAccounts,
  listStatementCycles,
  listHoldings
};
