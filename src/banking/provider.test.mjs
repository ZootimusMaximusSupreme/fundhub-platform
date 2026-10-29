// Unit tests for the banking provider seam and the mock behind it. No database,
// no network, no DATABASE_URL — these run anywhere.
//
// WHAT THESE TESTS ARE FOR.
//
// 1. THE SEAM MUST BE A REAL SEAM. If mock.mjs and plaid.mjs ever stop exporting
//    the same shape, "flip an env var to go live" quietly becomes "rewrite the
//    call sites", which is the one thing the design promised would not happen.
//    The parity test below is the guard on that promise.
//
// 2. IT MUST FAIL CLOSED. A typo in BANKING_PROVIDER must refuse, not fall back
//    to the mock. The failure it prevents is invented balances rendered on a
//    screen that says "your accounts", with every downstream check passing.
//
// 3. THE MOCK MUST NOT DRIFT. Same seed, same numbers, forever — otherwise every
//    refresh rewrites the owner's net worth and nothing distinguishes that from
//    a real change.
//
// 4. THE MOCK MUST NOT KNOW MORE THAN A BANK DOES. It must never emit
//    entity_kind. A mock that classifies accounts trains the product against a
//    signal real Plaid cannot supply.

import { test } from "node:test";
import assert from "node:assert";

import * as plaid from "./plaid.mjs";
import * as mock from "./mock.mjs";
import {
  BANKING_PROVIDERS,
  PROVIDER_REASONS,
  bankingProviderFromEnv,
  bankingProviderName,
  isBankingEnabled,
  linkAccount,
  getAccounts
} from "./provider.mjs";

const PLAID_READY = {
  BANKING_PROVIDER: "plaid",
  PLAID_CLIENT_ID: "id",
  PLAID_SECRET: "secret",
  PLAID_TOKEN_ENC_KEY: Buffer.alloc(32, 7).toString("base64")
};

/* ------------------------------------------------------------ seam identity */

test("mock and plaid export the same call surface", () => {
  // THE LOAD-BEARING TEST. Going live is only an env change for as long as this
  // passes. Adding a function to one and not the other is how a call site starts
  // needing to know which provider it is talking to.
  for (const fn of ["linkAccount", "getAccounts"]) {
    assert.equal(typeof plaid[fn], "function", `plaid.${fn}`);
    assert.equal(typeof mock[fn], "function", `mock.${fn}`);
  }
});

test("both providers return the same keys from getAccounts", async () => {
  const fromMock = await mock.getAccounts({ itemId: "i" });
  const fromPlaid = await plaid.getAccounts({ itemId: "i", env: PLAID_READY });
  assert.deepEqual(Object.keys(fromMock).sort(), Object.keys(fromPlaid).sort());
});

test("both providers return the same keys from linkAccount", async () => {
  const fromMock = await mock.linkAccount({ clientId: "c" });
  const fromPlaid = await plaid.linkAccount({ clientId: "c", env: PLAID_READY });
  assert.deepEqual(Object.keys(fromMock).sort(), Object.keys(fromPlaid).sort());
});

/* ------------------------------------------------------------- selection */

test("unset BANKING_PROVIDER means mock", () => {
  const cfg = bankingProviderFromEnv({});
  assert.equal(cfg.name, "mock");
  assert.equal(cfg.ready, true);
  assert.deepEqual(cfg.missing, [], "the mock needs no credentials and must not claim to");
});

test("the mock is ready with no credentials at all", () => {
  assert.equal(isBankingEnabled({ BANKING_PROVIDER: "mock" }), true);
});

test("an unrecognised provider FAILS CLOSED and does not fall back to mock", () => {
  for (const bad of ["Plaid", "plad", "production", "true", " "]) {
    const cfg = bankingProviderFromEnv({ BANKING_PROVIDER: bad });
    assert.equal(cfg.name, null, `${bad} must not resolve to a provider`);
    assert.equal(cfg.ready, false);
    assert.notEqual(cfg.name, "mock", `${bad} must NOT silently become the mock`);
  }
});

test("plaid selected but unconfigured is not ready, and names only the vars", () => {
  const cfg = bankingProviderFromEnv({ BANKING_PROVIDER: "plaid" });
  assert.equal(cfg.name, "plaid");
  assert.equal(cfg.ready, false);
  assert.deepEqual(cfg.missing, ["PLAID_CLIENT_ID", "PLAID_SECRET", "PLAID_TOKEN_ENC_KEY"]);
  // Safe to log: names, never values.
  assert.equal(JSON.stringify(cfg).includes("secret"), false);
});

test("plaid fully configured reports ready", () => {
  assert.equal(isBankingEnabled(PLAID_READY), true);
  assert.equal(bankingProviderName(PLAID_READY), "plaid");
});

test("a malformed encryption key is not ready", () => {
  const cfg = bankingProviderFromEnv({ ...PLAID_READY, PLAID_TOKEN_ENC_KEY: Buffer.alloc(12).toString("base64") });
  assert.equal(cfg.ready, false);
  assert.equal(cfg.problems.length > 0, true);
});

/* -------------------------------------------------------------- dispatch */

test("the seam dispatches to the mock and gets real accounts", async () => {
  const out = await getAccounts({ itemId: "item-1", env: {} });
  assert.equal(out.ok, true);
  assert.equal(Array.isArray(out.accounts), true);
  assert.equal(out.accounts.length > 0, true);
});

/* Was: "the seam dispatches to plaid, which still refuses on purpose", asserting
   NOT_IMPLEMENTED. The exchange was implemented 2026-09-09 (owner-set), so that
   assertion pinned a product decision that no longer holds. What it was really
   protecting is kept and widened below: the seam reaches plaid, plaid refuses
   when it cannot proceed, and a refusal is never an empty account list. */
test("the seam dispatches to plaid, which refuses without a stored token", async () => {
  const out = await getAccounts({ itemId: "item-1", env: PLAID_READY });
  assert.equal(out.ok, false);
  assert.equal(out.reason, plaid.SEAM_REASONS.BAD_REQUEST,
    "no encryptedAccessToken was supplied, so nothing could be asked");
  assert.equal(out.accounts, null, "null, not [] — see provider.mjs");
});

test("an unknown provider refuses with accounts null, never an empty array", async () => {
  const out = await getAccounts({ itemId: "i", env: { BANKING_PROVIDER: "nope" } });
  assert.equal(out.ok, false);
  assert.equal(out.reason, PROVIDER_REASONS.UNKNOWN_PROVIDER);
  assert.equal(out.accounts, null,
    "[] would mean 'this client has no bank accounts', which is a finding a funding decision would act on");
});

test("an unknown provider refuses linkAccount with item null", async () => {
  const out = await linkAccount({ clientId: "c", env: { BANKING_PROVIDER: "nope" } });
  assert.equal(out.ok, false);
  assert.equal(out.item, null, "null, never an empty object");
});

test("BANKING_PROVIDERS is the whitelist the error message quotes", () => {
  assert.deepEqual(BANKING_PROVIDERS, ["mock", "plaid"]);
});

/* -------------------------------------------------------- mock determinism */

test("the same item id yields byte-identical accounts", async () => {
  const a = await getAccounts({ itemId: "item-A", env: {}, today: "2026-07-31" });
  const b = await getAccounts({ itemId: "item-A", env: {}, today: "2026-07-31" });
  assert.deepEqual(a.accounts, b.accounts);
});

test("a different item id yields different numbers", async () => {
  const a = await mock.getAccounts({ itemId: "item-A", today: "2026-07-31" });
  const b = await mock.getAccounts({ itemId: "item-B", today: "2026-07-31" });
  assert.notDeepEqual(
    a.accounts.map((x) => x.current_balance_cents),
    b.accounts.map((x) => x.current_balance_cents),
    "two clients must not look identical"
  );
});

test("mock monthly transaction IDs stay unique across 28th–31st, year-end and leap-day boundaries", async () => {
  // In particular, 2026-10-29 used to map two 30-day hops into July.
  // The duplicate provider ID caused the bank import to count an inserted row
  // twice, overwrite one payroll amount, and fail the saved-row audit.
  const dates = [
    "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31",
    "2026-11-01", "2026-03-01", "2026-01-01", "2024-02-29",
  ];
  for (const today of dates) {
    const { accounts } = await mock.getAccounts({ itemId: "monthly-regression", today });
    for (const account of accounts) {
      const transactions = account.transactions || [];
      const keys = transactions.map((t) => t.provider_transaction_id);
      assert.equal(new Set(keys).size, keys.length, `${today} / ${account.name}: each provider transaction id must identify one transaction`);
      assert.ok(transactions.every((t) => t.posted_on <= today), `${today}: no future-dated provider transaction`);
      const payroll = transactions.filter((t) => t.merchant_name === "PAYROLL");
      assert.equal(new Set(payroll.map((t) => t.posted_on)).size, payroll.length,
        `${today}: a single payday is not generated twice with different amounts`);
    }
  }
});

test("the mock source contains no call to Math.random", async () => {
  // The determinism tests above would catch drift eventually; this catches the
  // moment somebody introduces it, with a message that says why.
  //
  // COMMENTS ARE STRIPPED FIRST. mock.mjs's own header warns against
  // Math.random() by name, and a naive substring search flags that warning —
  // a test that fails on the documentation telling you not to do the thing.
  const src = await import("node:fs").then((fs) =>
    fs.readFileSync(new URL("./mock.mjs", import.meta.url), "utf8"));
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.equal(/Math\s*\.\s*random/.test(code), false,
    "a mock that is not deterministic is a random number generator wearing a costume");
});

/* --------------------------------------------------------- mock honesty */

test("the mock NEVER emits entity_kind", async () => {
  const { accounts } = await mock.getAccounts({ itemId: "item-A", today: "2026-07-31" });
  for (const a of accounts) {
    assert.equal("entity_kind" in a, false,
      "a provider is not an authority on whose money an account holds — see 082");
  }
});

test("the mock produces business, personal, credit and investment accounts together", async () => {
  const { accounts } = await mock.getAccounts({ itemId: "item-A", today: "2026-07-31" });
  const types = new Set(accounts.map((a) => a.account_type));
  assert.equal(types.has("depository"), true);
  assert.equal(types.has("credit"), true);
  assert.equal(types.has("investment"), true);
  assert.equal(accounts.filter((a) => a.account_type === "depository").length >= 2, true,
    "multiple accounts must coexist, not one of each");
  assert.equal(accounts.filter((a) => a.account_type === "credit").length >= 2, true);
});

test("credit accounts carry a statement cycle and deposit accounts do not", async () => {
  const { accounts } = await mock.getAccounts({ itemId: "item-A", today: "2026-07-31" });
  for (const a of accounts) {
    if (a.account_type === "credit") {
      assert.notEqual(a.statement_cycle, null, `${a.name} should have a cycle`);
      const c = a.statement_cycle;
      assert.equal(Number.isInteger(c.statement_close_day), true);
      assert.equal(c.payment_due_day >= 1 && c.payment_due_day <= 31, true);
      // APR IS A FRACTION. A value above 1 here means somebody stored percent
      // units, and 096's CHECK would reject it at the database — but only if a
      // real database is present, which it is not in this test.
      assert.equal(c.apr > 0 && c.apr <= 1, true, `apr must be a fraction 0..1, got ${c.apr}`);
    } else {
      assert.equal(a.statement_cycle, null, `${a.name} must not have a statement cycle`);
    }
  }
});

test("the investment account carries holdings and leaves available balance unknown", async () => {
  const { accounts } = await mock.getAccounts({ itemId: "item-A", today: "2026-07-31" });
  const inv = accounts.find((a) => a.account_type === "investment");
  assert.equal(Array.isArray(inv.holdings), true);
  assert.equal(inv.holdings.length > 0, true);
  assert.equal(inv.available_balance_cents, null,
    "settled cash is not position value — NULL means unknown and must survive");
  for (const h of inv.holdings) {
    assert.equal(typeof h.symbol, "string");
    assert.equal(Number.isInteger(h.cost_basis_cents), true, "money is integer cents");
    assert.equal(Number.isInteger(h.current_value_cents), true);
  }
});

test("transactions follow 085's sign convention — negative is money OUT", async () => {
  const { accounts } = await mock.getAccounts({ itemId: "item-A", today: "2026-07-31" });
  const dep = accounts.find((a) => a.account_type === "depository");
  const bills = dep.transactions.filter((t) => t.merchant_name === "ACME FIBER INTERNET");
  assert.equal(bills.length >= 3, true, "a recurring bill must recur often enough to detect");
  for (const b of bills) {
    assert.equal(b.amount_cents < 0, true, "a bill payment is money leaving the account");
  }
  const payroll = dep.transactions.filter((t) => t.merchant_name === "PAYROLL");
  assert.equal(payroll.length > 0, true);
  for (const p of payroll) assert.equal(p.amount_cents > 0, true, "income is money entering");
});

test("no transaction has a zero amount — 085 CHECKs against it", async () => {
  const { accounts } = await mock.getAccounts({ itemId: "item-A", today: "2026-07-31" });
  for (const a of accounts) {
    for (const t of a.transactions ?? []) {
      assert.notEqual(t.amount_cents, 0);
      assert.equal(Number.isInteger(t.amount_cents), true);
    }
  }
});

test("every credit account's headroom is limit minus balance", async () => {
  // banking-surface.mjs's rule is that a credit line's "available" is headroom,
  // not cash. The mock must produce data that makes that distinction checkable
  // rather than data where the two happen to coincide.
  const { accounts } = await mock.getAccounts({ itemId: "item-A", today: "2026-07-31" });
  for (const a of accounts.filter((x) => x.account_type === "credit")) {
    assert.equal(a.available_balance_cents, a.credit_limit_cents - a.current_balance_cents);
  }
});

test("the mock refuses without an item id rather than inventing one", async () => {
  const out = await mock.getAccounts({});
  assert.equal(out.ok, false);
  assert.equal(out.accounts, null);
});

test("linkAccount mints no fake access token", async () => {
  const out = await mock.linkAccount({ clientId: "client-1" });
  assert.equal(out.ok, true);
  assert.equal(out.item.access_token, null,
    "there is nothing real to protect, and a string shaped like a bank token has no business in the database");
});
