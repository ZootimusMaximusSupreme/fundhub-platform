// Unit tests for the bank-account writer. No database and no DATABASE_URL — the
// `db` handle is a fake that records the SQL and parameters it was given.
//
// WHY A RECORDING FAKE RATHER THAN A PG TEST. The things most likely to go wrong
// here are not "does Postgres accept this" — they are "which value landed in
// which parameter". AUDIT-FINDINGS' most expensive entry is exactly that class:
// a migration renamed three columns, the writer was never updated, and
// createInvoice() threw on every call while unit tests stayed green against an
// in-memory fake that modelled the OLD columns. So these tests assert the
// PARAMETERS, by position, against the column list the SQL actually names — a
// fake that cannot drift from the statement because it reads the statement.
//
// The pg-backed counterpart lives in accounts.pg.test.mjs and SKIPS without
// DATABASE_URL. Both are needed: this one catches a mis-ordered parameter, that
// one catches a column that no longer exists.
//
// THE TESTS THAT MATTER MOST ASSERT AN ABSENCE:
//   - org_id is never read from the input payload;
//   - a hand-entered row's plaid_item_id stays NULL;
//   - entity_kind is NOT written when the caller did not state one;
//   - an unknown amount stays NULL and never becomes 0.

import { test } from "node:test";
import assert from "node:assert";

import {
  createManualBankAccount,
  saveStatementCycle,
  replaceHoldings,
  listBankAccounts,
  normaliseMask,
  BankAccountWriteError,
  ACCOUNT_TYPES
} from "./accounts.mjs";

const ORG = "11111111-1111-1111-1111-111111111111";
const CLIENT = "22222222-2222-2222-2222-222222222222";
const ACCOUNT = "33333333-3333-3333-3333-333333333333";

/** A db handle with no connect(), so withTransaction runs the callback inline —
 *  the documented fallback for a plain fake. Records every call. */
function fakeDb(responder = () => ({ rows: [{ id: ACCOUNT }] })) {
  const calls = [];
  return {
    calls,
    query(sql, params) {
      calls.push({ sql, params });
      return Promise.resolve(responder(sql, params, calls.length));
    }
  };
}

/** Pull the column list out of an INSERT so a test can look a parameter up by
 *  NAME rather than by counting question marks. If the SQL's column list and the
 *  values array ever disagree, this is what notices. */
function insertedRow(call) {
  const cols = /INSERT INTO \w+ \(([\s\S]*?)\)/.exec(call.sql)[1]
    .split(",").map((c) => c.trim());
  const row = {};
  cols.forEach((c, i) => { row[c] = call.params[i]; });
  return row;
}

/* ------------------------------------------------------------------- masks */

test("normaliseMask keeps only the last four digits", () => {
  assert.equal(normaliseMask("1234"), "1234");
  assert.equal(normaliseMask("**** 5678"), "5678");
  assert.equal(normaliseMask("12"), "12", "a short mask is not padded");
  assert.equal(normaliseMask(null), null);
  assert.equal(normaliseMask(""), null);
  assert.equal(normaliseMask("abcd"), null, "no digits means no mask");
});

test("a full account number typed into the mask box is TRUNCATED, not stored", () => {
  // 081's header forbids an account-number column and says none may ever be
  // added. That protection is worth nothing if a person can paste a full number
  // into the "last 4" box and have it stored verbatim.
  assert.equal(normaliseMask("4111111111111234"), "1234");
  assert.equal(normaliseMask("4111-1111-1111-1234"), "1234");
  assert.equal(normaliseMask("021000021 123456789"), "6789");
});

/* ------------------------------------------------------- create an account */

test("org_id comes from the caller, NEVER from the payload", async () => {
  const db = fakeDb();
  // A hostile body naming a different org. The writer must ignore it entirely.
  await createManualBankAccount(db, {
    name: "Checking", org_id: "99999999-9999-9999-9999-999999999999", client_id: "attacker"
  }, { orgId: ORG, clientId: CLIENT });

  const row = insertedRow(db.calls[0]);
  assert.equal(row.org_id, ORG, "the session's org, not the body's");
  assert.equal(row.client_id, CLIENT);
});

test("a hand-entered account has NULL plaid ids — 081's marker for manual entry", async () => {
  const db = fakeDb();
  await createManualBankAccount(db, { name: "Checking" }, { orgId: ORG, clientId: CLIENT });
  const row = insertedRow(db.calls[0]);
  assert.equal(row.plaid_item_id, null);
  assert.equal(row.plaid_account_id, null);
});

test("an unknown amount stays NULL and never becomes zero", async () => {
  const db = fakeDb();
  await createManualBankAccount(db, {
    name: "Card", account_type: "credit", current_balance_cents: 120_00
    // available and credit_limit deliberately absent
  }, { orgId: ORG, clientId: CLIENT });

  const row = insertedRow(db.calls[0]);
  assert.equal(row.current_balance_cents, 12000);
  assert.equal(row.available_balance_cents, null,
    "NULL means unknown and must survive — 0 would render as $0.00 on the dashboard");
  assert.equal(row.credit_limit_cents, null,
    "a zero credit limit would make utilisation divide by zero or read as maxed out");
});

test("dollars passed where cents are expected are REFUSED, not rounded", async () => {
  const db = fakeDb();
  await assert.rejects(
    () => createManualBankAccount(db, { current_balance_cents: 1234.56 }, { orgId: ORG, clientId: CLIENT }),
    (e) => e instanceof BankAccountWriteError && /integer number of cents/.test(e.message)
  );
  assert.equal(db.calls.length, 0, "nothing is written when the input is refused");
});

test("entity_kind is NOT written when the caller did not state one", async () => {
  const db = fakeDb();
  await createManualBankAccount(db, { name: "Checking" }, { orgId: ORG, clientId: CLIENT });
  assert.equal(db.calls.length, 1, "one INSERT and no follow-up UPDATE");
  assert.equal(/entity_kind/.test(db.calls[0].sql), false,
    "leaving the field blank must keep 082's 'unknown' default with no provenance implying somebody looked");
});

test("entity_kind stated by a human is recorded as staff_reviewed", async () => {
  const db = fakeDb();
  await createManualBankAccount(db, { name: "Ops", entity_kind: "business" },
    { orgId: ORG, clientId: CLIENT });
  assert.equal(db.calls.length, 2);
  assert.match(db.calls[1].sql, /UPDATE bank_accounts/);
  assert.match(db.calls[1].sql, /entity_kind_source = 'staff_reviewed'/);
  assert.equal(db.calls[1].params[1], "business");
});

test("an explicit 'unknown' does not fabricate a provenance", async () => {
  const db = fakeDb();
  await createManualBankAccount(db, { name: "Mystery", entity_kind: "unknown" },
    { orgId: ORG, clientId: CLIENT });
  assert.equal(db.calls.length, 1,
    "'unknown' is the default; writing it with a source would claim a review that did not happen");
});

test("a bad account_type is refused before any write", async () => {
  const db = fakeDb();
  await assert.rejects(
    () => createManualBankAccount(db, { account_type: "chequing" }, { orgId: ORG, clientId: CLIENT }),
    (e) => e instanceof BankAccountWriteError && e.field === "account_type"
  );
  assert.equal(db.calls.length, 0);
});

test("every account_type 081 allows is accepted", async () => {
  for (const t of ACCOUNT_TYPES) {
    const db = fakeDb();
    await createManualBankAccount(db, { account_type: t }, { orgId: ORG, clientId: CLIENT });
    assert.equal(insertedRow(db.calls[0]).account_type, t);
  }
});

test("orgId and clientId are required — a missing org cannot fall through", async () => {
  const db = fakeDb();
  await assert.rejects(() => createManualBankAccount(db, {}, { clientId: CLIENT }),
    (e) => e.field === "orgId");
  await assert.rejects(() => createManualBankAccount(db, {}, { orgId: ORG }),
    (e) => e.field === "clientId");
  assert.equal(db.calls.length, 0);
});

/* ----------------------------------------------------------- cycle writing */

function cycleDb(accountType) {
  let n = 0;
  return fakeDb((sql) => {
    n++;
    if (/SELECT account_type/.test(sql)) {
      return accountType === null ? { rows: [] } : { rows: [{ account_type: accountType }] };
    }
    return { rows: [{ id: "cycle-1", n }] };
  });
}

test("a statement cycle on a non-credit account is refused", async () => {
  const db = cycleDb("depository");
  await assert.rejects(
    () => saveStatementCycle(db, { payment_due_day: 4 },
      { orgId: ORG, clientId: CLIENT, bankAccountId: ACCOUNT }),
    (e) => e instanceof BankAccountWriteError && /credit account/.test(e.message)
  );
  assert.equal(db.calls.some((c) => /INSERT INTO account_statement_cycles/.test(c.sql)), false,
    "a fake 'payment due' on a savings account would put money nobody owes on the dashboard");
});

test("a loan can carry a due day and a monthly payment (451)", async () => {
  const db = cycleDb("loan");
  await saveStatementCycle(db, { payment_due_day: 1, minimum_payment_cents: 105000 },
    { orgId: ORG, clientId: CLIENT, bankAccountId: ACCOUNT });
  const row = insertedRow(db.calls.find((c) => /INSERT INTO account_statement_cycles/.test(c.sql)));
  assert.equal(row.payment_due_day, 1);
  assert.equal(row.minimum_payment_cents, 105000);
});

test("an account in another org is a 404, not a 403", async () => {
  const db = cycleDb(null);
  await assert.rejects(
    () => saveStatementCycle(db, { payment_due_day: 4 },
      { orgId: ORG, clientId: CLIENT, bankAccountId: ACCOUNT }),
    (e) => e.status === 404,
    "a caller must not be able to tell 'exists but not yours' from 'no such account'"
  );
});

test("the ownership check binds org and client, not just the account id", async () => {
  const db = cycleDb("credit");
  await saveStatementCycle(db, { payment_due_day: 4 },
    { orgId: ORG, clientId: CLIENT, bankAccountId: ACCOUNT });
  const check = db.calls.find((c) => /SELECT account_type/.test(c.sql));
  assert.deepEqual(check.params, [ACCOUNT, ORG, CLIENT]);
});

test("APR given in percent units is converted to a fraction exactly once", async () => {
  const db = cycleDb("credit");
  await saveStatementCycle(db, { payment_due_day: 4, apr: "24.99" },
    { orgId: ORG, clientId: CLIENT, bankAccountId: ACCOUNT });
  const row = insertedRow(db.calls.find((c) => /INSERT INTO account_statement_cycles/.test(c.sql)));
  assert.equal(row.apr, 0.2499, "096 CHECKs apr between 0 and 1");
});

test("APR already a fraction is left alone — the conversion is idempotent", async () => {
  // This is why readApr() runs in the store rather than at the HTTP edge: a
  // hand-rolled /100 applied twice is the bug that inflated figures 100-fold in
  // this repo once already. readApr is safe to repeat; division is not.
  const db = cycleDb("credit");
  await saveStatementCycle(db, { payment_due_day: 4, apr: 0.2499 },
    { orgId: ORG, clientId: CLIENT, bankAccountId: ACCOUNT });
  const row = insertedRow(db.calls.find((c) => /INSERT INTO account_statement_cycles/.test(c.sql)));
  assert.equal(row.apr, 0.2499);
});

test("an impossible APR becomes NULL rather than a clamped lie", async () => {
  const db = cycleDb("credit");
  await saveStatementCycle(db, { payment_due_day: 4, apr: "900" },
    { orgId: ORG, clientId: CLIENT, bankAccountId: ACCOUNT });
  const row = insertedRow(db.calls.find((c) => /INSERT INTO account_statement_cycles/.test(c.sql)));
  assert.equal(row.apr, null);
});

test("a day outside 1-31 is refused", async () => {
  for (const bad of [0, 32, -1, 1.5]) {
    const db = cycleDb("credit");
    await assert.rejects(
      () => saveStatementCycle(db, { payment_due_day: bad },
        { orgId: ORG, clientId: CLIENT, bankAccountId: ACCOUNT }),
      (e) => e.field === "payment_due_day", `day ${bad}`);
  }
});

test("a cycle with no days at all is allowed and stays NULL", async () => {
  // The owner may know his minimum payment before he knows his due date.
  const db = cycleDb("credit");
  await saveStatementCycle(db, { minimum_payment_cents: 4500 },
    { orgId: ORG, clientId: CLIENT, bankAccountId: ACCOUNT });
  const row = insertedRow(db.calls.find((c) => /INSERT INTO account_statement_cycles/.test(c.sql)));
  assert.equal(row.payment_due_day, null);
  assert.equal(row.statement_close_day, null);
  assert.equal(row.minimum_payment_cents, 4500);
});

/* -------------------------------------------------------------- holdings */

function holdingsDb(accountType = "investment") {
  return fakeDb((sql) => {
    if (/SELECT account_type/.test(sql)) return { rows: [{ account_type: accountType }] };
    return { rows: [] };
  });
}

test("holdings REPLACE rather than merge", async () => {
  const db = holdingsDb();
  await replaceHoldings(db, [{ symbol: "VTI", current_value_cents: 100 }],
    { orgId: ORG, clientId: CLIENT, bankAccountId: ACCOUNT });
  const deletes = db.calls.filter((c) => /DELETE FROM investment_holdings/.test(c.sql));
  assert.equal(deletes.length, 1,
    "a position the owner sold last month must not sit in his net worth forever");
  assert.equal(deletes[0].params[0], ACCOUNT);
});

test("symbols are uppercased in exactly one place", async () => {
  const db = holdingsDb();
  await replaceHoldings(db, [{ symbol: " vti " }],
    { orgId: ORG, clientId: CLIENT, bankAccountId: ACCOUNT });
  const insert = db.calls.find((c) => /INSERT INTO investment_holdings/.test(c.sql));
  assert.equal(insert.params[3], "VTI");
});

test("a holding with no symbol is refused before anything is deleted", async () => {
  const db = holdingsDb();
  await assert.rejects(
    () => replaceHoldings(db, [{ symbol: "" }], { orgId: ORG, clientId: CLIENT, bankAccountId: ACCOUNT }),
    (e) => e.field === "symbol");
  assert.equal(db.calls.length, 0,
    "validation runs before the DELETE, or a bad row would wipe the portfolio and write nothing back");
});

test("holdings on a non-investment account are refused", async () => {
  const db = holdingsDb("depository");
  await assert.rejects(
    () => replaceHoldings(db, [{ symbol: "VTI" }], { orgId: ORG, clientId: CLIENT, bankAccountId: ACCOUNT }),
    (e) => /investment account/.test(e.message));
});

test("an empty holdings list clears the account and is not a no-op", async () => {
  // Selling everything is a real state and must be recordable.
  const db = holdingsDb();
  const out = await replaceHoldings(db, [], { orgId: ORG, clientId: CLIENT, bankAccountId: ACCOUNT });
  assert.deepEqual(out, { replaced: 0 });
  assert.equal(db.calls.some((c) => /DELETE FROM investment_holdings/.test(c.sql)), true);
});

test("quantity is passed as a string, not coerced to cents", async () => {
  const db = holdingsDb();
  await replaceHoldings(db, [{ symbol: "AAPL", quantity: 0.08333333 }],
    { orgId: ORG, clientId: CLIENT, bankAccountId: ACCOUNT });
  const insert = db.calls.find((c) => /INSERT INTO investment_holdings/.test(c.sql));
  assert.equal(insert.params[5], "0.08333333",
    "a share count is not a currency amount — 097 stores numeric(20,8)");
});

/* ------------------------------------------------------------------ reads */

test("listBankAccounts filters on org_id, so a missing org matches nothing", async () => {
  const db = fakeDb(() => ({ rows: [] }));
  await listBankAccounts(db, { orgId: ORG, clientId: CLIENT });
  assert.match(db.calls[0].sql, /WHERE org_id = \$1 AND client_id = \$2/);
  assert.deepEqual(db.calls[0].params, [ORG, CLIENT]);
});

test("listBankAccounts refuses without an org rather than reading everything", async () => {
  const db = fakeDb(() => ({ rows: [] }));
  await assert.rejects(() => listBankAccounts(db, { clientId: CLIENT }), (e) => e.field === "orgId");
  assert.equal(db.calls.length, 0);
});

test("the account read never selects the encrypted access token", async () => {
  // plaid_items.encrypted_access_token is one join away and a read should not be
  // one typo from it. api/read/banking-surface.mjs makes the same call.
  const db = fakeDb(() => ({ rows: [] }));
  await listBankAccounts(db, { orgId: ORG, clientId: CLIENT });
  assert.equal(/SELECT \*/.test(db.calls[0].sql), false);
  assert.equal(/encrypted/.test(db.calls[0].sql), false);
});
