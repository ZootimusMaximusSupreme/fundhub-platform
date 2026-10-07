// Real-Postgres integration test for the bank-account writer and the provider
// import.
//
// SKIPS unless DATABASE_URL is set, like every other .pg.test.mjs here. It does
// NOT pass quietly — reporting green with no database is the failure mode this
// repo has been bitten by, where ~24 isolation tests failed for eleven commits
// while everyone treated them as noise.
//
// WHAT THIS PROVES THAT THE STUB TEST CANNOT.
//
// accounts.test.mjs asserts which value lands in which parameter. It cannot
// assert that the CHECK constraints exist and bite, and that is where the real
// protection is:
//
//   - 096 CHECKs apr BETWEEN 0 AND 1. A percent-unit APR must be REJECTED by the
//     database, not merely converted by the writer — if the conversion is ever
//     removed, the constraint has to be the thing that stops it.
//   - 085 CHECKs amount_cents <> 0 and requires a posted date on a settled row.
//   - The partial unique index on (plaid_item_id, plaid_account_id) must let two
//     hand-entered rows coexist while collapsing two reads of one provider
//     account. NULLs do not collide in Postgres, which is exactly why that index
//     is partial and exactly the behaviour a stub cannot model.
//   - bigint columns come back as STRINGS from node-postgres. A stub returning
//     numbers passes while the screen does arithmetic on "12000".
//
// AUDIT-FINDINGS' first lesson: "a fake that models the schema you wish you had
// cannot fail when the schema moves."

import { test, before, after } from "node:test";
import assert from "node:assert";

import { db, close } from "../db.mjs";
import {
  createManualBankAccount,
  saveStatementCycle,
  replaceHoldings,
  listBankAccounts,
  listStatementCycles,
  listHoldings
} from "./accounts.mjs";
import { importAccounts } from "./import.mjs";

const HAS_DB = !!process.env.DATABASE_URL;

let orgId = null;
let clientId = null;
let otherOrgId = null;

before(async () => {
  if (!HAS_DB) return;
  orgId = (await db.query(`SELECT id FROM orgs WHERE is_default LIMIT 1`)).rows[0]?.id;
  assert.ok(orgId, "the default org must exist — run the migrations");

  // `slug` is NOT NULL and UNIQUE on orgs — a scratch org needs both columns.
  otherOrgId = (await db.query(
    `INSERT INTO orgs (slug, name) VALUES ('w1-scratch-other', 'W1 Scratch Other Org')
     ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`)).rows[0].id;

  clientId = (await db.query(
    `INSERT INTO clients (org_id, first_name, last_name)
     VALUES ($1, 'W1', 'Scratch') RETURNING id`, [orgId])).rows[0].id;
});

after(async () => {
  if (!HAS_DB) return;
  // Cascades clear bank_accounts, cycles, holdings and transactions.
  if (clientId) await db.query(`DELETE FROM clients WHERE id = $1`, [clientId]);
  if (otherOrgId) await db.query(`DELETE FROM orgs WHERE id = $1`, [otherOrgId]);
  await close();
});

/* ----------------------------------------------------------- the schema */

test("096 and 097 exist with the columns the writer names", { skip: !HAS_DB }, async () => {
  for (const [table, cols] of [
    ["account_statement_cycles", ["statement_close_day", "payment_due_day",
      "last_statement_date", "last_statement_balance_cents", "minimum_payment_cents", "apr", "source"]],
    ["investment_holdings", ["symbol", "description", "quantity",
      "cost_basis_cents", "current_value_cents", "as_of", "source"]]
  ]) {
    const found = (await db.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = $1`, [table]
    )).rows.map((r) => r.column_name);
    assert.ok(found.length, `${table} does not exist — run the migrations`);
    for (const c of cols) assert.ok(found.includes(c), `${table}.${c} is missing`);
  }
});

test("bank_accounts still has NO account or routing number column", { skip: !HAS_DB }, async () => {
  // 081's header says neither may ever be added. This is the guard on that
  // promise, and it is cheap enough to run forever.
  const cols = (await db.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'bank_accounts'`
  )).rows.map((r) => r.column_name);
  for (const forbidden of ["account_number", "routing_number", "iban", "full_account_number"]) {
    assert.equal(cols.includes(forbidden), false, `bank_accounts.${forbidden} must not exist`);
  }
  assert.ok(cols.includes("mask"), "the mask is the only fragment that may be stored");
});

/* ------------------------------------------------------------ manual entry */

test("a hand-entered account round-trips, and unknown survives as NULL", { skip: !HAS_DB }, async () => {
  const a = await createManualBankAccount(db, {
    name: "Scratch Checking",
    account_type: "depository",
    mask: "4111111111111234",          // a full number — must be truncated
    current_balance_cents: 250_000,
    currency_code: "USD"
    // available and credit_limit deliberately absent
  }, { orgId, clientId });

  assert.equal(a.mask, "1234", "a full account number must never land in the column");
  assert.equal(a.plaid_item_id, null, "081's marker for a hand-entered row");
  assert.equal(a.available_balance_cents, null, "NULL means unknown and must survive the round trip");
  assert.equal(a.credit_limit_cents, null);
  assert.equal(a.entity_kind, "unknown", "082's default — a human has not classified it");
  assert.equal(a.entity_kind_source, null);

  // BIGINT ARRIVES AS A STRING. This is the assertion a stub cannot make, and
  // the one that breaks a screen doing arithmetic on it.
  assert.equal(typeof a.current_balance_cents, "string");
  assert.equal(a.current_balance_cents, "250000");
});

test("a stated entity_kind is recorded with its provenance", { skip: !HAS_DB }, async () => {
  const a = await createManualBankAccount(db, {
    name: "Scratch Business", account_type: "depository", entity_kind: "business"
  }, { orgId, clientId });
  assert.equal(a.entity_kind, "business");
  assert.equal(a.entity_kind_source, "staff_reviewed");
  assert.ok(a.entity_kind_set_at, "082 wants to know WHEN somebody decided");
});

test("two hand-entered accounts with the same mask both survive", { skip: !HAS_DB }, async () => {
  // uq_bank_accounts_plaid is PARTIAL. Both plaid columns are NULL on a manual
  // row, and NULLs do not collide in Postgres — so manual entry is not blocked.
  // A person really can hold two cards ending 9999 at two banks.
  const one = await createManualBankAccount(db,
    { name: "Card A", account_type: "credit", mask: "9999" }, { orgId, clientId });
  const two = await createManualBankAccount(db,
    { name: "Card B", account_type: "credit", mask: "9999" }, { orgId, clientId });
  assert.notEqual(one.id, two.id, "silently merging two real accounts destroys one");
});

/* --------------------------------------------------------- the constraints */

test("097 REFUSES an APR in percent units at the database", { skip: !HAS_DB }, async () => {
  const card = await createManualBankAccount(db,
    { name: "Constraint Card", account_type: "credit" }, { orgId, clientId });

  /* Straight past the writer's readApr(), to prove the database refuses this on
     its own and not just because the conversion was polite.

     IT IS THE COLUMN TYPE THAT BITES FIRST, NOT THE CHECK. numeric(6,5) is
     precision 6 with scale 5, so the largest value it can hold is 9.99999 and
     24.99 raises 22003 (numeric_value_out_of_range) before the CHECK is ever
     evaluated. This test originally asserted 23514 and failed — which is the
     finding: the `apr <= 1` CHECK is a SECOND line of defence for the 1..9.99999
     band, not the first. Both are real; the type is simply narrower than the
     CHECK for the case that actually happens. */
  await assert.rejects(
    () => db.query(
      `INSERT INTO account_statement_cycles (org_id, client_id, bank_account_id, apr)
       VALUES ($1,$2,$3,$4)`, [orgId, clientId, card.id, 24.99]),
    (e) => e.code === "22003",
    "an APR of 24.99 must be rejected — as a fraction that is 2499%"
  );

  // And the band the CHECK owns alone: a value the TYPE accepts but the rule
  // does not. 2.5 fits numeric(6,5) comfortably and is still a 250% rate.
  await assert.rejects(
    () => db.query(
      `INSERT INTO account_statement_cycles (org_id, client_id, bank_account_id, apr)
       VALUES ($1,$2,$3,$4)`, [orgId, clientId, card.id, 2.5]),
    (e) => e.code === "23514",
    "the CHECK is what stops a rate between 1 and 9.99999"
  );
});

test("the writer converts percent units so the constraint never fires in practice", { skip: !HAS_DB }, async () => {
  const card = await createManualBankAccount(db,
    { name: "Converting Card", account_type: "credit" }, { orgId, clientId });
  const cycle = await saveStatementCycle(db,
    { payment_due_day: 2, statement_close_day: 5, apr: "24.99", minimum_payment_cents: 3500 },
    { orgId, clientId, bankAccountId: card.id });
  assert.equal(Number(cycle.apr), 0.2499);
  assert.equal(cycle.payment_due_day, 2);
});

test("one cycle per account — a second save updates rather than duplicates", { skip: !HAS_DB }, async () => {
  const card = await createManualBankAccount(db,
    { name: "Upsert Card", account_type: "credit" }, { orgId, clientId });
  await saveStatementCycle(db, { payment_due_day: 2 }, { orgId, clientId, bankAccountId: card.id });
  await saveStatementCycle(db, { payment_due_day: 9 }, { orgId, clientId, bankAccountId: card.id });
  const rows = (await db.query(
    `SELECT * FROM account_statement_cycles WHERE bank_account_id = $1`, [card.id])).rows;
  assert.equal(rows.length, 1, "two due dates on one card would make every reader pick one");
  assert.equal(rows[0].payment_due_day, 9);
});

test("a statement cycle cannot be attached to a savings account", { skip: !HAS_DB }, async () => {
  const savings = await createManualBankAccount(db,
    { name: "Savings", account_type: "depository" }, { orgId, clientId });
  await assert.rejects(
    () => saveStatementCycle(db, { payment_due_day: 4 }, { orgId, clientId, bankAccountId: savings.id }),
    (e) => /credit account/.test(e.message));
});

test("a loan takes a due day and its monthly payment (451)", { skip: !HAS_DB }, async () => {
  const loan = await createManualBankAccount(db,
    { name: "SBA Loan", account_type: "loan", current_balance_cents: 4800000 }, { orgId, clientId });
  const cycle = await saveStatementCycle(db, { payment_due_day: 1, minimum_payment_cents: 105000 },
    { orgId, clientId, bankAccountId: loan.id });
  assert.equal(cycle.payment_due_day, 1);
  assert.equal(Number(cycle.minimum_payment_cents), 105000);
});

/* ------------------------------------------------------------- org scoping */

test("an account in another org is invisible and unwritable", { skip: !HAS_DB }, async () => {
  const mine = await createManualBankAccount(db,
    { name: "Mine", account_type: "credit" }, { orgId, clientId });

  // Reading as the other org must not find it.
  const seen = await listBankAccounts(db, { orgId: otherOrgId, clientId });
  assert.equal(seen.length, 0, "org scope is a filter, not a suggestion");

  // Writing a cycle against it as the other org must 404, not succeed.
  await assert.rejects(
    () => saveStatementCycle(db, { payment_due_day: 4 },
      { orgId: otherOrgId, clientId, bankAccountId: mine.id }),
    (e) => e.status === 404);
});

/* ---------------------------------------------------------------- holdings */

test("holdings replace, and quantity keeps its fractional precision", { skip: !HAS_DB }, async () => {
  const brokerage = await createManualBankAccount(db,
    { name: "Brokerage", account_type: "investment" }, { orgId, clientId });

  await replaceHoldings(db, [
    { symbol: "vti", quantity: "0.08333333", cost_basis_cents: 5000, current_value_cents: 5400 },
    { symbol: "BND", quantity: "10", cost_basis_cents: 80000, current_value_cents: null }
  ], { orgId, clientId, bankAccountId: brokerage.id });

  let rows = await listHoldings(db, { orgId, clientId });
  assert.equal(rows.length, 2);
  const vti = rows.find((r) => r.symbol === "VTI");
  assert.ok(vti, "symbols are uppercased in exactly one place");
  assert.equal(vti.quantity, "0.08333333",
    "a share count is not cents — 097 stores numeric(20,8)");
  const bnd = rows.find((r) => r.symbol === "BND");
  assert.equal(bnd.current_value_cents, null, "an unpriced holding is not a worthless one");

  // Replace with one row: the other must be gone, not merged.
  await replaceHoldings(db, [{ symbol: "VTI", quantity: "1" }],
    { orgId, clientId, bankAccountId: brokerage.id });
  rows = await listHoldings(db, { orgId, clientId });
  assert.equal(rows.length, 1, "a position sold last month must not sit in net worth forever");
});

/* ------------------------------------------------------------ the import */

test("importing from the mock lands accounts, cycles, holdings and transactions",
  { skip: !HAS_DB }, async () => {
    const fresh = (await db.query(
      `INSERT INTO clients (org_id, first_name, last_name)
       VALUES ($1, 'W1', 'Import') RETURNING id`, [orgId])).rows[0].id;

    try {
      const out = await importAccounts(db,
        { orgId, clientId: fresh, env: { BANKING_PROVIDER: "mock" }, today: "2026-07-31" });

      assert.equal(out.provider, "mock");
      assert.equal(out.accounts, 7);
      assert.ok(out.statementCycles >= 2, "both credit cards should carry a cycle");
      assert.ok(out.holdings > 0);
      assert.ok(out.transactions > 0);
      assert.deepEqual(out.droppedTransactions, [],
        "the mock must not emit rows 085's CHECKs would reject");

      // Every imported account stays UNCLASSIFIED. A provider is not an
      // authority on whose money it is.
      const accounts = await listBankAccounts(db, { orgId, clientId: fresh });
      assert.equal(accounts.length, 7);
      for (const a of accounts) {
        assert.equal(a.entity_kind, "unknown", `${a.name} must not be auto-classified`);
        assert.equal(a.entity_kind_source, null);
      }

      const cycles = await listStatementCycles(db, { orgId, clientId: fresh });
      for (const c of cycles) {
        assert.ok(Number(c.apr) > 0 && Number(c.apr) <= 1, "096's CHECK accepted it, so it is a fraction");
        assert.equal(c.source, "provider");
      }

      // Money OUT is negative. If a real Plaid client is ever wired without the
      // negation 085's comment demands, this is what notices.
      const sums = (await db.query(
        `SELECT count(*) FILTER (WHERE amount_cents < 0) AS out,
                count(*) FILTER (WHERE amount_cents > 0) AS incoming
           FROM bank_transactions WHERE client_id = $1`, [fresh])).rows[0];
      assert.ok(Number(sums.out) > 0, "there must be money going out");
      assert.ok(Number(sums.incoming) > 0, "and money coming in");

      /* RE-IMPORT IS IDEMPOTENT. This is the property that makes a refresh
         button safe: without it, pressing it weekly would report the owner's
         balances at fifty-two times their true value. */
      const again = await importAccounts(db,
        { orgId, clientId: fresh, env: { BANKING_PROVIDER: "mock" }, today: "2026-07-31" });
      assert.equal(again.accounts, 7);
      const after = await listBankAccounts(db, { orgId, clientId: fresh });
      assert.equal(after.length, 7, "a second import must update, never append");
      assert.equal(
        (await db.query(`SELECT count(*) AS n FROM investment_holdings WHERE client_id = $1`, [fresh])).rows[0].n,
        String(out.holdings), "holdings replace rather than accumulate");
    } finally {
      await db.query(`DELETE FROM clients WHERE id = $1`, [fresh]);
    }
  });

test("an unknown BANKING_PROVIDER refuses the import outright", { skip: !HAS_DB }, async () => {
  await assert.rejects(
    () => importAccounts(db, { orgId, clientId, env: { BANKING_PROVIDER: "Plaid" } }),
    (e) => e.status === 503 && e.reason === "unknown_provider",
    "a typo must not silently write invented balances");
});
