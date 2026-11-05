// bank_accounts — the writer. This is the module src/banking/plaid.mjs names.
//
// getAccounts()'s header says the account list is "then upserted into
// bank_accounts by a separate store module". That module did not exist: the only
// `INSERT INTO bank_accounts` anywhere in this repository was inside
// src/banking/plaid.pg.test.mjs. Migration 081 shipped a table nothing could
// write to, which is why every bank-derived section of the Money Map is empty.
//
// This file is that module. It is the DATABASE half only — it takes an already
// normalised account list and writes it. It does not know what a provider is,
// does not fetch anything, and holds no clock. src/banking/accounts-sync.mjs is
// what puts a provider on one end of it.
//
//
// ═══════════════════════════════════════════════════════════════════════════
// THE THREE RULES THIS FILE EXISTS TO ENFORCE
// ═══════════════════════════════════════════════════════════════════════════
//
// 1. NULL MEANS UNKNOWN AND MUST SURVIVE THE WRITE.
//    A bank that did not report an available balance has an unknown available
//    balance. Nothing here COALESCEs a balance to 0. 081's header is explicit:
//    the difference "decides whether someone gets funded".
//
// 2. entity_kind IS NEVER SET BY AN INGEST.
//    plaid.mjs's note to whoever built this: "accounts arriving from a bank
//    carry no ownership information this product can trust. Every row written
//    must keep bank_accounts.entity_kind at its 'unknown' default until a human
//    or a document establishes otherwise. Do not map a Plaid subtype onto
//    'personal'." So `entity_kind` is NOT in the column list below, at all — not
//    set to 'unknown', not passed through, not accepted as a parameter. The
//    column default does the work and there is no code path that can override
//    it. 082's provenance CHECK is the backstop.
//
// 3. A SYNC IS A RE-READ, NOT AN APPEND.
//    Upsert on the provider's own key, so running the same sync twice leaves the
//    same number of rows. 086's store gives the same reasoning for bills: run it
//    weekly without an upsert and one subscription becomes fifty-two rows, and
//    any SUM over the table reports a client's money at fifty-two times its true
//    value.
//
//
// WHAT THIS FILE WILL NOT DO: DELETE.
// An account that stops appearing in a provider's list has not necessarily been
// closed — the connection may have partially failed, or the provider may have
// changed how it paginates. Marking `closed_at` on an absence would be a claim
// about a real person's finances derived from a missing row. So a vanished
// account is REPORTED (`vanished` in the result) and left alone. Closing one is
// a decision, and it needs a caller who has made it.

import { fromCents } from "../commissions/money.mjs";

/* Transaction helper — the same shape as src/banking/store.mjs and
   src/inquiries/work.mjs, including the fallback for a handle with no
   connect(). Matching the existing pattern rather than inventing a second one.
   The fallback matters for the same reason it does there: the transactional
   path must be exercisable by something other than a real database. */
async function withTransaction(db, fn) {
  if (typeof db.connect !== "function") return fn(db);
  const client = await db.connect();
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

export class AccountStoreError extends Error {
  constructor(message, { status = 400 } = {}) {
    super(message);
    this.name = "AccountStoreError";
    this.status = status;
  }
}

/** 091's CHECK, restated so a bad value is refused before it reaches Postgres
    and comes back as a constraint-violation stack trace. */
export const PROVIDERS = Object.freeze(["manual", "mock", "plaid", "import"]);

/** 081's CHECK. NULL is allowed and means the bank told us nothing about the
    type — which is NOT the same as 'other', and is never treated as cash. */
export const ACCOUNT_TYPES = Object.freeze(["depository", "credit", "loan", "investment", "other"]);

/* Cents in, cents out. A value that is not a whole number of cents is a bug in
   the caller, not something to round quietly: fromCents() throws on a
   non-integer and this refuses for the same reason. undefined and null both mean
   UNKNOWN and pass straight through. */
function optionalCents(value, field) {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) {
    throw new AccountStoreError(`${field} is not a number of cents: ${JSON.stringify(value)}`);
  }
  if (!Number.isInteger(n)) {
    throw new AccountStoreError(
      `${field} must be a whole number of cents, got ${JSON.stringify(value)} — ` +
      "money is integer cents in this schema (src/commissions/money.mjs)"
    );
  }
  return n;
}

function optionalText(value, field, { max = 512 } = {}) {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  if (s === "") return null;
  if (s.length > max) throw new AccountStoreError(`${field} is longer than ${max} characters`);
  return s;
}

function requireText(value, field) {
  const s = optionalText(value, field);
  if (s === null) throw new AccountStoreError(`${field} is required`);
  return s;
}

/* A mask is the ONLY account-number fragment 081 permits, and it says so in the
   column comment: "There is no full account number and no routing number column,
   and neither may be added to this table". A provider handing over more than a
   few digits is handing over a payment credential, and this is where that stops
   — truncated to the last four rather than refused, because refusing the whole
   account over a too-long mask would lose a real account over a formatting
   difference. */
function readMask(value) {
  const s = optionalText(value, "mask", { max: 64 });
  if (s === null) return null;
  const digits = s.replace(/\D/g, "");
  if (digits.length === 0) return null;
  return digits.slice(-4);
}

/* An ISO instant, or null. `balance_as_of` is timestamptz: when the figures were
   TRUE, which is not when we wrote them. NULL means we do not know how stale
   they are, which 081 calls "itself a reason not to rely on them". */
function optionalInstant(value, field) {
  if (value === null || value === undefined || value === "") return null;
  const d = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(d.getTime())) {
    throw new AccountStoreError(`${field} is not a valid timestamp: ${JSON.stringify(value)}`);
  }
  return d.toISOString();
}

/**
 * toAccountRow(account, { orgId, clientId, provider, plaidItemId })
 *   → the exact column names db/migrations/081 + 091 expect.
 *
 * PURE: it builds an object, it does not write one. The mapping from a
 * provider's vocabulary to this table's lives in ONE tested place, for the
 * reason src/banking/recurring.mjs gives for toBillRow(): AUDIT-FINDINGS' most
 * expensive single finding is a migration renaming three columns with no code
 * following, found only against real Postgres. A mapping written inline at each
 * call site drifts one call site at a time.
 *
 * NOTE WHAT IS ABSENT: there is no `entity_kind` key and there is no way to pass
 * one. See rule 2 in the header.
 */
export function toAccountRow(account, { orgId, clientId, provider, plaidItemId = null } = {}) {
  if (!orgId) throw new AccountStoreError("orgId is required");
  if (!clientId) throw new AccountStoreError("clientId is required");
  if (!PROVIDERS.includes(provider)) {
    throw new AccountStoreError(
      `provider must be one of ${PROVIDERS.join(", ")}, got ${JSON.stringify(provider)}`
    );
  }

  /* 091's CHECK, enforced here too so the caller gets a sentence instead of a
     constraint name. A plaid row must hang off an Item; nothing else may. */
  if (provider === "plaid" && !plaidItemId) {
    throw new AccountStoreError("a plaid account must name the plaid_item_id it came through");
  }
  if (provider !== "plaid" && plaidItemId) {
    throw new AccountStoreError(`a '${provider}' account must not claim a plaid item`);
  }

  const providerAccountId = optionalText(account?.providerAccountId, "providerAccountId", { max: 256 });
  if (provider === "mock" && providerAccountId === null) {
    throw new AccountStoreError(
      "a mock account must carry a providerAccountId — without one a re-sync duplicates it"
    );
  }

  const accountType = optionalText(account?.accountType, "accountType", { max: 64 });
  if (accountType !== null && !ACCOUNT_TYPES.includes(accountType)) {
    throw new AccountStoreError(
      `accountType must be one of ${ACCOUNT_TYPES.join(", ")} or absent, got ${JSON.stringify(accountType)}`
    );
  }

  return {
    org_id: orgId,
    client_id: clientId,
    plaid_item_id: plaidItemId,
    plaid_account_id: provider === "plaid"
      ? optionalText(account?.providerAccountId, "providerAccountId", { max: 256 })
      : null,
    provider,
    provider_account_id: provider === "plaid" ? null : providerAccountId,
    name: optionalText(account?.name, "name", { max: 256 }),
    official_name: optionalText(account?.officialName, "officialName", { max: 256 }),
    mask: readMask(account?.mask),
    account_type: accountType,
    account_subtype: optionalText(account?.accountSubtype, "accountSubtype", { max: 64 }),
    currency_code: optionalText(account?.currencyCode, "currencyCode", { max: 8 }),
    // Every one of these three may be null, and null survives. See rule 1.
    available_balance_cents: optionalCents(account?.availableBalanceCents, "availableBalanceCents"),
    current_balance_cents: optionalCents(account?.currentBalanceCents, "currentBalanceCents"),
    credit_limit_cents: optionalCents(account?.creditLimitCents, "creditLimitCents"),
    balance_as_of: optionalInstant(account?.balanceAsOf, "balanceAsOf"),
    /* The unparsed record, kept verbatim so a disputed reading can be settled.
       081: "Never contains a credential — the access token lives encrypted on
       plaid_items and is stripped before anything lands here." */
    raw: account?.raw && typeof account.raw === "object" ? account.raw : {}
  };
}

/* The update set. org_id, client_id, provider and the two id columns are the
   row's IDENTITY and are never updated — changing them under a conflict would
   move an account between clients or relabel a mock as real.

   `entity_kind` is absent for the third time and it is the important absence:
   a re-sync must not reset a classification a human made last week. */
const UPDATABLE = [
  "name", "official_name", "mask",
  "account_type", "account_subtype", "currency_code",
  "available_balance_cents", "current_balance_cents", "credit_limit_cents",
  "balance_as_of", "raw"
];

const RETURNING = `
  id, org_id, client_id, plaid_item_id, plaid_account_id,
  provider, provider_account_id,
  name, official_name, mask, account_type, account_subtype, currency_code,
  available_balance_cents, current_balance_cents, credit_limit_cents,
  balance_as_of, entity_kind, entity_kind_source, entity_kind_set_at,
  closed_at, created_at, updated_at`;

/**
 * upsertBankAccount(db, account, { orgId, clientId, provider, plaidItemId })
 *
 * One account in, the stored row out. The conflict target depends on the
 * provider, because 081 and 091 give them different unique indexes and there is
 * no single one that covers both:
 *
 *   plaid → uq_bank_accounts_plaid (plaid_item_id, plaid_account_id)
 *   else  → uq_bank_accounts_provider_ref (org_id, client_id, provider, provider_account_id)
 *
 * A row with NO usable key at all — a hand-entered account with no provider id —
 * is INSERTed plainly. That is correct: two accounts a person typed are two
 * accounts, and deduplicating them on a name would silently merge a client's
 * two chequing accounts at the same bank.
 */
export async function upsertBankAccount(db, account, opts = {}) {
  const row = toAccountRow(account, opts);
  const cols = Object.keys(row);
  const values = cols.map((c) => row[c]);
  const placeholders = cols.map((_, i) => `$${i + 1}`);

  let conflict = "";
  const keyed =
    (row.provider === "plaid" && row.plaid_item_id && row.plaid_account_id) ||
    (row.provider !== "plaid" && row.provider_account_id);

  if (keyed) {
    /* THE `WHERE` IS NOT OPTIONAL AND IT IS NOT A FILTER ON THE ROWS.
       Both unique indexes are PARTIAL — 081 line 123 and 103 line 162 each end
       in a WHERE. Postgres only picks a partial index as the arbiter for
       ON CONFLICT when the statement repeats that index's own predicate; without
       it the planner finds no arbiter at all and the INSERT dies with 42P10,
       "there is no unique or exclusion constraint matching the ON CONFLICT
       specification". That is a 500 on POST /api/banking/sync-accounts on the
       very first account of every sync, which is why nothing has ever reached
       bank_accounts through this path against a real database. Measured on a
       scratch Postgres 16.14, 2026-08-18.

       The `keyed` test directly above already guarantees the predicate holds for
       this row, so adding the clause changes WHICH INDEX Postgres uses and
       nothing about which rows are matched. */
    const target =
      row.provider === "plaid"
        ? "(plaid_item_id, plaid_account_id) " +
          "WHERE plaid_item_id IS NOT NULL AND plaid_account_id IS NOT NULL"
        : "(org_id, client_id, provider, provider_account_id) " +
          "WHERE provider_account_id IS NOT NULL";
    conflict =
      ` ON CONFLICT ${target} DO UPDATE SET ` +
      UPDATABLE.map((c) => c === "raw" && row.provider === "plaid"
        ? "raw = COALESCE(bank_accounts.raw, '{}'::jsonb) || EXCLUDED.raw"
        : `${c} = EXCLUDED.${c}`).join(", ") +
      ", updated_at = now()";
  }

  const res = await db.query(
    `INSERT INTO bank_accounts (${cols.join(", ")})
     VALUES (${placeholders.join(", ")})${conflict}
     RETURNING ${RETURNING}`,
    values
  );
  return res.rows[0];
}

/**
 * saveAccounts(db, accounts, { orgId, clientId, provider, plaidItemId })
 *
 * A provider's whole account list, written in ONE transaction. All or nothing:
 * a partial write would leave a client with three of their five accounts and a
 * screen totalling them as though that were the lot.
 *
 * @returns {{ written: number, accounts: Array, vanished: Array }}
 *
 * `vanished` is every account already stored for this client under this provider
 * that the incoming list did NOT mention. It is REPORTED AND LEFT ALONE — see
 * the header. An absence from one read is not evidence an account was closed.
 */
export async function saveAccounts(db, accounts, opts = {}) {
  const list = Array.isArray(accounts) ? accounts : null;
  if (list === null) {
    /* Not [] — the caller handing over null means "we did not ask", and
       plaid.mjs is emphatic about the difference: "[] means this client has no
       bank accounts, which is a finding a funding decision would act on. null
       means we did not ask." Writing nothing for either would collapse them. */
    throw new AccountStoreError(
      "saveAccounts: accounts must be an array — null means the provider was not asked, " +
      "and that is not something this function can record"
    );
  }
  const { orgId, clientId, provider } = opts;
  if (!orgId) throw new AccountStoreError("orgId is required");
  if (!clientId) throw new AccountStoreError("clientId is required");

  // Shape and validate EVERY row before opening a transaction, so a bad row
  // fails before anything is written rather than half way through.
  const rows = list.map((a) => toAccountRow(a, opts));

  return withTransaction(db, async (tx) => {
    const before = await tx.query(
      `SELECT id, provider_account_id, plaid_account_id, name
         FROM bank_accounts
        WHERE org_id = $1 AND client_id = $2 AND provider = $3`,
      [orgId, clientId, provider]
    );

    const written = [];
    for (const a of list) written.push(await upsertBankAccount(tx, a, opts));

    const seen = new Set(
      written.map((r) => r.provider_account_id ?? r.plaid_account_id).filter((v) => v !== null)
    );
    const vanished = before.rows
      .filter((r) => {
        const key = r.provider_account_id ?? r.plaid_account_id;
        return key !== null && !seen.has(key);
      })
      .map((r) => ({
        id: r.id,
        name: r.name,
        note:
          "this account was stored before and did not appear in the latest read. " +
          "It has NOT been closed or removed — an absence from one read is not evidence an account is gone."
      }));

    return { written: rows.length, accounts: written, vanished };
  });
}

/**
 * listBankAccounts(db, { orgId, clientId, includeClosed })
 *
 * The read side, org-scoped. api/read/money-map.mjs has its own SELECT with its
 * own column list and does not use this — a read endpoint naming its columns in
 * the open is a deliberate choice there, so that `SELECT *` never creeps in next
 * to plaid_items.encrypted_access_token. This exists for callers inside the
 * server that want the rows without writing SQL.
 */
export async function listBankAccounts(db, { orgId, clientId, includeClosed = true } = {}) {
  if (!orgId) throw new AccountStoreError("orgId is required");
  if (!clientId) throw new AccountStoreError("clientId is required");
  const res = await db.query(
    `SELECT ${RETURNING} FROM bank_accounts
      WHERE org_id = $1 AND client_id = $2
        AND ($3::boolean OR closed_at IS NULL)
      ORDER BY entity_kind, name NULLS LAST, id`,
    [orgId, clientId, includeClosed]
  );
  return res.rows;
}

/**
 * describeAccount(row) — a one-line summary for a log or a confirmation
 * message. Money is rendered through fromCents(), which returns a STRING; this
 * function does no arithmetic on it.
 */
export function describeAccount(row) {
  const bits = [row?.name || "Unnamed account"];
  if (row?.mask) bits.push(`••${row.mask}`);
  if (row?.account_type) bits.push(row.account_type);
  const c = row?.current_balance_cents;
  const n = c === null || c === undefined || c === "" ? null : Number(c);
  // An unknown balance is an em dash. Never "0.00".
  bits.push(Number.isInteger(n) ? fromCents(n) : "—");
  if (row?.provider && row.provider !== "plaid") bits.push(`[${row.provider}]`);
  return bits.join(" · ");
}

export default { toAccountRow, upsertBankAccount, saveAccounts, listBankAccounts, describeAccount };
