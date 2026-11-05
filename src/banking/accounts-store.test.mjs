// bank_accounts writer — unit tests against a stubbed db. No Postgres.
//
// The rules under test are the ones that would produce a plausible wrong number
// on an owner's money screen rather than an exception anybody would notice:
// a null balance becoming zero, an ingest deciding whose money it is, and a
// re-sync appending instead of updating.

import { test, describe } from "node:test";
import assert from "node:assert";

import {
  toAccountRow,
  upsertBankAccount,
  saveAccounts,
  listBankAccounts,
  describeAccount,
  AccountStoreError,
  PROVIDERS,
  ACCOUNT_TYPES
} from "./accounts-store.mjs";

const OPTS = { orgId: "org-1", clientId: "c-1", provider: "mock" };

const acct = (o = {}) => ({
  providerAccountId: "mock-checking-1",
  name: "Everyday Checking",
  officialName: "Mock Bank Everyday Checking",
  mask: "1234",
  accountType: "depository",
  accountSubtype: "checking",
  currencyCode: "USD",
  availableBalanceCents: 41237,
  currentBalanceCents: 48612,
  creditLimitCents: null,
  balanceAsOf: "2026-07-31T00:00:00.000Z",
  ...o
});

/* A db that records what it was asked and answers with the row it was handed,
   so a test can assert on the SQL and the parameters — which is the only way to
   prove a column made it into the statement. */
function makeDb({ existing = [] } = {}) {
  const calls = [];
  return {
    calls,
    query(sql, params) {
      calls.push({ sql, params });
      if (/^\s*SELECT id, provider_account_id/.test(sql)) return Promise.resolve({ rows: existing });
      if (/^\s*SELECT/.test(sql)) return Promise.resolve({ rows: existing });
      if (/INSERT INTO bank_accounts/.test(sql)) {
        const cols = sql.slice(sql.indexOf("(") + 1, sql.indexOf(")")).split(",").map((s) => s.trim());
        const row = {};
        cols.forEach((c, i) => { row[c] = params[i]; });
        return Promise.resolve({ rows: [{ id: "new-" + row.provider_account_id, entity_kind: "unknown", ...row }] });
      }
      return Promise.resolve({ rows: [] });
    }
  };
}

describe("toAccountRow — shaping", () => {

  test("a null balance stays null and never becomes zero", () => {
    const row = toAccountRow(
      acct({ availableBalanceCents: null, currentBalanceCents: undefined, creditLimitCents: "" }),
      OPTS
    );
    assert.equal(row.available_balance_cents, null);
    assert.equal(row.current_balance_cents, null);
    assert.equal(row.credit_limit_cents, null);
  });

  test("a negative balance survives — an overdrawn account is data", () => {
    const row = toAccountRow(acct({ currentBalanceCents: -100000 }), OPTS);
    assert.equal(row.current_balance_cents, -100000);
  });

  /* plaid.mjs's note to whoever built this: "Every row written must keep
     bank_accounts.entity_kind at its 'unknown' default until a human or a
     document establishes otherwise. Do not map a Plaid subtype onto 'personal'."
     The strongest form of that rule is that there is no way to express it. */
  test("there is NO way for an ingest to set entity_kind", () => {
    const row = toAccountRow(
      acct({ entity_kind: "personal", entityKind: "personal", accountSubtype: "checking" }),
      OPTS
    );
    assert.equal(row.entity_kind, undefined, "entity_kind reached the row shape");
    assert.equal(row.entity_kind_source, undefined);
    assert.ok(!Object.keys(row).some((k) => k.startsWith("entity_kind")));
  });

  test("a fractional amount is refused, not rounded", () => {
    assert.throws(
      () => toAccountRow(acct({ currentBalanceCents: 1234.5 }), OPTS),
      /whole number of cents/
    );
  });

  test("a non-numeric amount is refused", () => {
    assert.throws(() => toAccountRow(acct({ currentBalanceCents: "lots" }), OPTS), /not a number of cents/);
  });

  /* 081: "There is no full account number and no routing number column, and
     neither may be added to this table". A provider handing over more is handing
     over a payment credential. */
  test("a mask is cut to the last four digits", () => {
    assert.equal(toAccountRow(acct({ mask: "4444555566661234" }), OPTS).mask, "1234");
    assert.equal(toAccountRow(acct({ mask: "12" }), OPTS).mask, "12");
    assert.equal(toAccountRow(acct({ mask: null }), OPTS).mask, null);
    assert.equal(toAccountRow(acct({ mask: "abcd" }), OPTS).mask, null);
  });

  test("an unrecognised account type is refused rather than stored as 'other'", () => {
    assert.throws(() => toAccountRow(acct({ accountType: "crypto" }), OPTS), /accountType must be one of/);
    // NULL is allowed: the bank told us nothing, which is not the same as 'other'.
    assert.equal(toAccountRow(acct({ accountType: null }), OPTS).account_type, null);
    for (const t of ACCOUNT_TYPES) {
      assert.equal(toAccountRow(acct({ accountType: t }), OPTS).account_type, t);
    }
  });

  test("an unknown provider is refused", () => {
    assert.throws(
      () => toAccountRow(acct(), { ...OPTS, provider: "wishful" }),
      /provider must be one of/
    );
    for (const p of PROVIDERS) {
      const o = { ...OPTS, provider: p, plaidItemId: p === "plaid" ? "item-1" : null };
      assert.equal(toAccountRow(acct(), o).provider, p);
    }
  });

  /* 091's CHECK, both directions. The failure that matters is a mock row
     acquiring the look of a real one. */
  test("only a plaid row may name a plaid item", () => {
    assert.throws(
      () => toAccountRow(acct(), { ...OPTS, provider: "mock", plaidItemId: "item-1" }),
      /must not claim a plaid item/
    );
    assert.throws(
      () => toAccountRow(acct(), { ...OPTS, provider: "plaid", plaidItemId: null }),
      /must name the plaid_item_id/
    );
  });

  test("a mock account without a provider id is refused — a re-sync would duplicate it", () => {
    assert.throws(
      () => toAccountRow(acct({ providerAccountId: null }), OPTS),
      /must carry a providerAccountId/
    );
  });

  test("a plaid id goes in plaid_account_id, anything else in provider_account_id", () => {
    const mock = toAccountRow(acct(), OPTS);
    assert.equal(mock.provider_account_id, "mock-checking-1");
    assert.equal(mock.plaid_account_id, null);

    const plaid = toAccountRow(acct({ providerAccountId: "plaid-abc" }),
      { ...OPTS, provider: "plaid", plaidItemId: "item-1" });
    assert.equal(plaid.plaid_account_id, "plaid-abc");
    assert.equal(plaid.provider_account_id, null);
  });

  test("org and client are required and are never taken from the account payload", () => {
    assert.throws(() => toAccountRow(acct({ org_id: "sneaky" }), { provider: "mock" }), /orgId is required/);
    assert.throws(() => toAccountRow(acct(), { orgId: "org-1", provider: "mock" }), /clientId is required/);
  });

  test("a blank name stays null — an invented placeholder is worse than nothing", () => {
    const row = toAccountRow(acct({ name: "   ", officialName: null }), OPTS);
    assert.equal(row.name, null);
    assert.equal(row.official_name, null);
  });

  test("a bad balance timestamp is refused, not silently dropped", () => {
    assert.throws(() => toAccountRow(acct({ balanceAsOf: "yesterday" }), OPTS), /not a valid timestamp/);
    assert.equal(toAccountRow(acct({ balanceAsOf: null }), OPTS).balance_as_of, null);
  });
});

/* TWO ASSERTIONS IN HERE WERE CHANGED ON 2026-08-18, AND THEY WERE MADE
   STRICTER, NOT LOOSER. They used to require the conflict target to be followed
   IMMEDIATELY by "DO UPDATE" — i.e. they pinned the exact SQL that fails against
   a real database. Both unique indexes on bank_accounts are PARTIAL (081 line
   123, 103 line 162), and Postgres refuses to use a partial unique index as an
   ON CONFLICT arbiter unless the statement repeats that index's own predicate.
   The old SQL therefore died with 42P10 on the first row of every sync — proved
   against a scratch Postgres 16.14 on 2026-08-18 — and these tests passed
   throughout, because a stubbed db accepts any string.

   The assertions now demand the WHERE clause as well. A future edit that drops
   it fails here instead of only in production. */
describe("upsertBankAccount — a sync is a re-read, not an append", () => {

  test("a keyed row upserts on the provider key and never touches entity_kind", async () => {
    const db = makeDb();
    await upsertBankAccount(db, acct(), OPTS);
    const sql = db.calls[0].sql;
    assert.match(
      sql,
      /ON CONFLICT \(org_id, client_id, provider, provider_account_id\) WHERE provider_account_id IS NOT NULL DO UPDATE/,
      "uq_bank_accounts_provider_ref is partial; without its WHERE clause repeated Postgres finds no arbiter and the INSERT is a 500"
    );
    assert.ok(!/entity_kind/.test(sql.split("RETURNING")[0]),
      "entity_kind appears in the write half of the statement");
  });

  test("a plaid row upserts on 081's own index instead", async () => {
    const db = makeDb();
    await upsertBankAccount(db, acct({ providerAccountId: "plaid-abc" }),
      { ...OPTS, provider: "plaid", plaidItemId: "item-1" });
    assert.match(
      db.calls[0].sql,
      /ON CONFLICT \(plaid_item_id, plaid_account_id\) WHERE plaid_item_id IS NOT NULL AND plaid_account_id IS NOT NULL DO UPDATE/,
      "uq_bank_accounts_plaid is partial; its predicate must be repeated or the INSERT is a 500"
    );
  });

  test("Plaid refresh preserves unrelated raw evidence while the latest server stamp wins", async () => {
    const db = makeDb();
    const raw = { plaid_environment: "sandbox", plaid_environment_source: "server_transport", holder_category: "personal" };
    await upsertBankAccount(db, acct({ providerAccountId: "plaid-abc", raw }),
      { ...OPTS, provider: "plaid", plaidItemId: "item-1" });
    assert.match(db.calls[0].sql, /raw = COALESCE\(bank_accounts.raw, '\{\}'::jsonb\) \|\| EXCLUDED.raw/);
    const cols = db.calls[0].sql.match(/INSERT INTO bank_accounts \(([^)]+)\)/)[1].split(",").map((v) => v.trim());
    assert.deepEqual(db.calls[0].params[cols.indexOf("raw")], raw);
    const manual = makeDb();
    await upsertBankAccount(manual, acct({ raw }), OPTS);
    assert.doesNotMatch(manual.calls[0].sql, /COALESCE\(bank_accounts.raw/,
      "mock/import/manual evidence is not silently upgraded by the Plaid storage path");
  });

  /* Two accounts a person typed are two accounts. Deduplicating them on a name
     would silently merge a client's two chequing accounts at the same bank. */
  test("a hand-entered row with no key is inserted plainly, not deduplicated", async () => {
    const db = makeDb();
    await upsertBankAccount(db, acct({ providerAccountId: null }), { ...OPTS, provider: "manual" });
    assert.ok(!/ON CONFLICT/.test(db.calls[0].sql));
  });

  test("the update set leaves identity and classification alone", async () => {
    const db = makeDb();
    await upsertBankAccount(db, acct(), OPTS);
    const updateHalf = db.calls[0].sql.split("DO UPDATE SET")[1].split("RETURNING")[0];
    for (const forbidden of ["org_id =", "client_id =", "provider =", "entity_kind"]) {
      assert.ok(!updateHalf.includes(forbidden), `${forbidden} is in the update set`);
    }
    for (const expected of ["current_balance_cents =", "available_balance_cents =", "name ="]) {
      assert.ok(updateHalf.includes(expected), `${expected} is missing from the update set`);
    }
  });
});

describe("saveAccounts — all or nothing, and nothing is deleted", () => {

  test("null is refused, because it means the provider was not asked", async () => {
    await assert.rejects(() => saveAccounts(makeDb(), null, OPTS), /must be an array/);
  });

  /* [] is a real finding — "this client has no bank accounts" — and it is not
     the same as null. It must be accepted. */
  test("an empty list is accepted and writes nothing", async () => {
    const out = await saveAccounts(makeDb(), [], OPTS);
    assert.equal(out.written, 0);
    assert.deepEqual(out.accounts, []);
  });

  test("a bad row fails before anything is written", async () => {
    const db = makeDb();
    await assert.rejects(
      () => saveAccounts(db, [acct(), acct({ providerAccountId: "x", currentBalanceCents: 1.5 })], OPTS),
      AccountStoreError
    );
    assert.equal(db.calls.filter((c) => /INSERT/.test(c.sql)).length, 0,
      "a row was written before validation finished");
  });

  test("an account that stopped appearing is reported and left alone", async () => {
    const db = makeDb({
      existing: [
        { id: "old-1", provider_account_id: "mock-checking-1", plaid_account_id: null, name: "Everyday Checking" },
        { id: "old-2", provider_account_id: "mock-gone-9", plaid_account_id: null, name: "Closed?" }
      ]
    });
    const out = await saveAccounts(db, [acct()], OPTS);
    assert.equal(out.vanished.length, 1);
    assert.equal(out.vanished[0].id, "old-2");
    assert.match(out.vanished[0].note, /has NOT been closed or removed/);
    // Nothing was deleted or closed.
    assert.ok(!db.calls.some((c) => /DELETE|closed_at\s*=/.test(c.sql)));
  });

  test("nothing in this module issues a DELETE", async () => {
    const db = makeDb();
    await saveAccounts(db, [acct(), acct({ providerAccountId: "mock-savings-1", name: "Savings" })], OPTS);
    for (const c of db.calls) assert.ok(!/DELETE/i.test(c.sql), "a DELETE reached the database");
  });

  test("the write runs inside one transaction when the handle supports it", async () => {
    const inner = makeDb();
    const seen = [];
    const pool = {
      connect: async () => ({
        query: (sql, params) => { seen.push(sql.trim().split(/\s+/)[0]); return inner.query(sql, params); },
        release: () => {}
      })
    };
    await saveAccounts(pool, [acct()], OPTS);
    assert.equal(seen[0], "BEGIN");
    assert.equal(seen[seen.length - 1], "COMMIT");
  });
});

describe("reads and rendering", () => {

  test("listBankAccounts is org-scoped and refuses without one", async () => {
    await assert.rejects(() => listBankAccounts(makeDb(), { clientId: "c-1" }), /orgId is required/);
    const db = makeDb();
    await listBankAccounts(db, { orgId: "org-1", clientId: "c-1" });
    assert.match(db.calls[0].sql, /org_id = \$1 AND client_id = \$2/);
    assert.deepEqual(db.calls[0].params, ["org-1", "c-1", true]);
  });

  test("describeAccount shows an unknown balance as a dash, never 0.00", () => {
    assert.match(describeAccount({ name: "X", current_balance_cents: null }), /—/);
    assert.ok(!describeAccount({ name: "X", current_balance_cents: null }).includes("0.00"));
    assert.match(describeAccount({ name: "X", current_balance_cents: 48612 }), /486\.12/);
  });

  test("describeAccount marks anything that is not a real bank read", () => {
    assert.match(describeAccount({ name: "X", provider: "mock", current_balance_cents: 100 }), /\[mock\]/);
    assert.ok(!describeAccount({ name: "X", provider: "plaid", current_balance_cents: 100 }).includes("["));
  });
});
