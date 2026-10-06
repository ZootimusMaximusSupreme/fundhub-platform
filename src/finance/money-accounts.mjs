// The Accounts page's data (/app/money-accounts.html, GET/POST /api/money/accounts).
//
// Owner direction 2026-10-06 (docs/finance/finance-os-direction-2026-10-06.md):
// each business is a container, each person is a container; "easy account
// addition — user enters information, system populates."
//
// REUSE, NOT A SECOND COPY.
//   * containers, what each holds, the billing count — src/finance/containers.mjs
//   * a business container's company facts       — src/finance/business-info.mjs
//   * the hand-entered account itself            — createManualBankAccount()
//   * a card's due day and minimum               — saveStatementCycle()
//     (both src/banking/accounts.mjs, the tested writer for these tables)
//
// ADD BY HAND, FOUR TYPES. The page offers checking, savings, credit card and
// loan. They map onto the columns the rest of Finance OS already reads:
//   checking    → account_type 'depository', subtype 'checking'
//   savings     → account_type 'depository', subtype 'savings'
//   credit_card → account_type 'credit',     subtype 'credit card'
//   loan        → account_type 'loan'
// The balance is current_balance_cents (for a card or a loan: what is owed).
// A limit is only for a card. A due day and a minimum are only for a card,
// because account_statement_cycles is card-only by its writer's rule.
//
// EVERYTHING IS CHECKED BEFORE THE FIRST WRITE. The account, its container and
// its due day are three writes through three tested functions, so every value
// and the container's ownership are proven first. A refusal names the field
// and nothing is stored.
//
// NEVER A FULL ACCOUNT NUMBER. "Last 4" takes 2-4 digits. More digits is
// refused, not trimmed, so the person knows we did not keep it.

import { toCents } from "../commissions/money.mjs";
import { listContainers, containerBilling, assignAccount } from "./containers.mjs";
import { listBusinessInfo } from "./business-info.mjs";
import { createManualBankAccount, saveStatementCycle, listStatementCycles } from "../banking/accounts.mjs";

export const HAND_TYPES = Object.freeze({
  checking: { account_type: "depository", account_subtype: "checking" },
  savings: { account_type: "depository", account_subtype: "savings" },
  credit_card: { account_type: "credit", account_subtype: "credit card" },
  loan: { account_type: "loan", account_subtype: null }
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v) => typeof v === "string" && UUID_RE.test(v.trim());
const blank = (v) => v === null || v === undefined || String(v).trim() === "";

const num = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
};

/** Dollars typed by a person ("2,000", "$2000.50") → integer cents. Blank → null (unknown). */
export function dollarsToCents(v, field) {
  if (blank(v)) return null;
  const s = typeof v === "number" ? v : String(v).trim().replace(/[$,\s]/g, "");
  if (typeof s === "string" && !/^-?\d+(\.\d{1,2})?$/.test(s)) {
    throw new TypeError(`${field} must be a dollar amount, like 2000 or 2,000.50`);
  }
  const c = toCents(s);
  return c;
}

/** "Last 4" → 2-4 digits. More digits is a refusal, never a trim. */
export function readLast4(v) {
  if (blank(v)) return null;
  const raw = String(v).trim();
  const digits = raw.replace(/[\s•*·.\-xX]/g, "");
  if (!/^\d+$/.test(digits)) throw new TypeError("last 4 must be digits only");
  if (digits.length > 4) {
    throw new TypeError("last 4 only — that looks like a full account number. We never store one. Nothing was saved");
  }
  if (digits.length < 2) throw new TypeError("last 4 must be at least 2 digits");
  return digits;
}

/**
 * readHandAccount(body) → the validated account, or throws TypeError.
 * { name, type, last4, balance, limit, due_day, minimum, container_id }
 */
export function readHandAccount(body = {}) {
  const b = body && typeof body === "object" ? body : {};
  const name = String(b.name ?? "").replace(/\s+/g, " ").trim();
  if (!name) throw new TypeError("name is required — what the account is called, like Chase Ink");
  if (name.length > 120) throw new TypeError("name must be 120 characters or fewer");

  const type = String(b.type ?? "").trim().toLowerCase();
  if (!HAND_TYPES[type]) throw new TypeError(`type must be one of ${Object.keys(HAND_TYPES).join(", ")}`);

  const mask = readLast4(b.last4 ?? b.mask);
  const balance = dollarsToCents(b.balance, "balance");
  const limit = dollarsToCents(b.limit, "limit");
  const minimum = dollarsToCents(b.minimum, "minimum");
  let dueDay = null;
  if (!blank(b.due_day)) {
    const n = Number(b.due_day);
    if (!Number.isInteger(n) || n < 1 || n > 31) throw new TypeError("due day must be a day of the month, 1 to 31");
    dueDay = n;
  }

  if (type !== "credit_card") {
    if (limit !== null) throw new TypeError("limit is only for a credit card");
    if (dueDay !== null || minimum !== null) throw new TypeError("due day and minimum are only for a credit card");
  }
  if (limit !== null && limit < 0) throw new TypeError("limit cannot be below zero");
  if (minimum !== null && minimum < 0) throw new TypeError("minimum cannot be below zero");

  let containerId = null;
  if (!blank(b.container_id)) {
    if (!isUuid(b.container_id)) throw new TypeError("container_id must be a uuid");
    containerId = String(b.container_id).trim();
  }

  return { name, type, mask, balance, limit, minimum, dueDay, containerId };
}

/**
 * addHandAccount(db, { orgId, clientId, input, by }) →
 *   { ok: true, account_id } | { ok: false, reason }
 *
 * `input` is readHandAccount's output. `by` is { kind: 'client'|'staff', id }
 * for the provenance note in `raw`, and decides the assign source.
 */
export async function addHandAccount(db, { orgId, clientId, input, by = {} }) {
  if (!orgId) throw new TypeError("orgId is required");
  if (!isUuid(clientId)) throw new TypeError("client_id must be a uuid");
  const cid = String(clientId).trim();
  const a = input;
  const t = HAND_TYPES[a.type];

  /* Container proven BEFORE anything is written. */
  if (a.containerId) {
    const ent = (await db.query(
      `SELECT id, archived_at FROM entities WHERE id = $1 AND org_id = $2 AND client_id = $3`,
      [a.containerId, orgId, cid]
    )).rows[0];
    if (!ent) return { ok: false, reason: "container_not_found" };
    if (ent.archived_at) return { ok: false, reason: "container_archived" };
  }

  const acct = await createManualBankAccount(db, {
    name: a.name,
    mask: a.mask,
    account_type: t.account_type,
    account_subtype: t.account_subtype,
    currency_code: "USD",
    current_balance_cents: a.balance,
    credit_limit_cents: a.limit,
    raw: {
      entry: "manual",
      page: "money-accounts",
      entered_by: by.kind === "client" ? "client" : "staff",
      entered_by_id: by.id ?? null,
      entered_at: new Date().toISOString()
    }
  }, { orgId, clientId: cid });

  if (a.containerId) {
    const r = await assignAccount(db, {
      orgId, clientId: cid, accountId: String(acct.id), containerId: a.containerId,
      source: by.kind === "client" ? "client_stated" : "staff_reviewed"
    });
    if (!r.ok) return { ok: false, reason: r.reason, account_id: acct.id };
  }

  if (a.type === "credit_card" && (a.dueDay !== null || a.minimum !== null)) {
    await saveStatementCycle(db, {
      payment_due_day: a.dueDay,
      minimum_payment_cents: a.minimum,
      source: "manual"
    }, { orgId, clientId: cid, bankAccountId: String(acct.id) });
  }

  return { ok: true, account_id: acct.id };
}

/**
 * accountsView(db, { orgId, clientId, env }) → the page's whole read.
 *
 * { client_id, containers: [{ ..., business, accounts, cards, loans, bills }],
 *   unassigned, billing }
 *
 * Each business container carries `business` (its info, or null when none is
 * saved yet). Each hand-entered or bank card carries due_day and min_due_cents
 * from its statement cycle (null = not told).
 */
export async function accountsView(db, { orgId, clientId, env = {} }) {
  const [list, info, billing, cycles] = await Promise.all([
    listContainers(db, { orgId, clientId }),
    listBusinessInfo(db, { orgId, clientId }),
    containerBilling(db, { orgId, clientId, env }),
    listStatementCycles(db, { orgId, clientId })
  ]);
  const cyc = new Map(cycles.map((c) => [String(c.bank_account_id), c]));
  const withCycle = (rows) => rows.map((r) => {
    if (r.source !== "bank_account") return r;
    const c = cyc.get(String(r.id));
    return { ...r, due_day: c ? num(c.payment_due_day) : null, min_due_cents: c ? num(c.minimum_payment_cents) : null };
  });
  const fill = (h) => ({ ...h, cards: withCycle(h.cards), loans: withCycle(h.loans), accounts: withCycle(h.accounts) });

  return {
    client_id: clientId,
    containers: list.containers.map((c) => ({
      ...fill(c),
      business: c.kind === "business" ? (info.get(String(c.id)) ?? null) : null
    })),
    unassigned: fill(list.unassigned),
    billing
  };
}
