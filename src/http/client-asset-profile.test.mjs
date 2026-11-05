import { test } from "node:test";
import assert from "node:assert/strict";
import { clientAssetProfile } from "./client-asset-profile.mjs";

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const at = "2026-11-04T10:00:00.000Z";
const account = (overrides = {}) => ({
  id: id(1), name: "Checking", mask: "4321", account_type: "depository",
  account_subtype: "checking", entity_kind: "personal", entity_kind_source: "client_stated",
  currency_code: "USD", current_balance_cents: "10000", available_balance_cents: "9000",
  balance_as_of: at, closed_at: null, provider: "manual", ...overrides
});
const holding = (overrides = {}) => ({
  id: id(100), bank_account_id: id(1), symbol: "ABC", description: "Recorded position",
  current_value_cents: "25000", currency_code: "USD", as_of: at, source: "provider", ...overrides
});
const group = (profile, kind = "personal", section = "cash") => profile[section].find((g) => g.entity_kind === kind);
const bucket = (profile, kind = "personal", code = "USD", section = "cash") =>
  group(profile, kind, section).currencies.find((c) => c.currency_code === code);
const plaid = (environment = "production", overrides = {}) => account({ provider: "plaid",
  provider_item_scoped: true, provider_environment: environment,
  provider_environment_evidence: "server_transport", ...overrides });

test("empty records mean no recorded assets, never a zero or completeness claim", () => {
  const profile = clientAssetProfile();
  assert.deepEqual(profile.cash.map((g) => g.entity_kind), ["personal", "business", "unknown"]);
  assert.deepEqual(profile.investments.map((g) => g.entity_kind), ["personal", "business", "unknown"]);
  assert.ok(profile.cash.every((g) => g.currencies.length === 0));
  assert.equal(profile.scope, "recorded_rows_only");
  assert.equal(profile.as_of, null);
  for (const key of ["net_worth", "total_assets", "complete", "verified", "bank_verified"]) {
    assert.equal(key in profile, false);
  }
});

test("cash is split by ownership, currency and current versus available", () => {
  const profile = clientAssetProfile({ accounts: [
    account(),
    account({ id: id(2), entity_kind: "business", currency_code: "usd", current_balance_cents: "700", available_balance_cents: "600" }),
    account({ id: id(3), entity_kind: "joint", current_balance_cents: "500" }),
    account({ id: id(4), currency_code: "CAD", current_balance_cents: "200", available_balance_cents: null })
  ] });
  assert.equal(bucket(profile).current.value_cents, 10000);
  assert.equal(bucket(profile).available.value_cents, 9000);
  assert.equal(bucket(profile, "business").current.value_cents, 700);
  assert.equal(bucket(profile, "unknown").current.value_cents, 500);
  assert.equal(bucket(profile, "personal", "CAD").current.value_cents, 200);
  assert.equal(bucket(profile, "personal", "CAD").available.value_cents, null);
  assert.equal(bucket(profile, "personal", "CAD").available.basis.status, "unknown");
  assert.equal("total" in profile, false);
});

test("zero and overdrawn deposits survive; invalid and missing cents stay unknown", () => {
  const profile = clientAssetProfile({ accounts: [
    account({ current_balance_cents: "0", available_balance_cents: 0 }),
    account({ id: id(2), current_balance_cents: -50, available_balance_cents: null })
  ] });
  assert.equal(profile.accounts[0].current_balance_cents, 0);
  assert.equal(bucket(profile).current.value_cents, -50);
  assert.equal(bucket(profile).available.value_cents, 0);
  assert.deepEqual(bucket(profile).available.basis, {
    lines: 2, counted: 1, unknown: 1, partial: true, status: "partial", truncated: false,
    overflow: false, unresolved_accounts: 0, providers: ["manual"]
  });
  for (const v of [true, false, [], {}, "", " ", "1.2", "1e3", 1.2, Infinity, NaN, "9007199254740992"]) {
    const invalid = clientAssetProfile({ accounts: [account({ current_balance_cents: v })] });
    assert.equal(bucket(invalid).current.value_cents, null, String(v));
  }
});

test("unknown currency is never silently USD or mixed with known currency", () => {
  const profile = clientAssetProfile({ accounts: [
    account(), account({ id: id(2), currency_code: null, current_balance_cents: 400 }),
    account({ id: id(3), currency_code: "not money", current_balance_cents: 500 })
  ] });
  assert.equal(bucket(profile).current.value_cents, 10000);
  assert.equal(bucket(profile, "personal", null).current.value_cents, 900);
});

test("closed, credit, loan, investment and unknown accounts never become cash", () => {
  const accounts = ["credit", "loan", "investment", "other", "unknown"].map((account_type, i) =>
    account({ id: id(i + 2), account_type, credit_limit_cents: 999999 }));
  const profile = clientAssetProfile({ accounts: [
    account({ current_balance_cents: 0 }), ...accounts,
    account({ id: id(20), closed_at: at }),
    account({ id: id(21), closed_at: "invalid closed date" })
  ] });
  assert.equal(bucket(profile).current.value_cents, 0);
  assert.equal(bucket(profile).current.basis.lines, 1);
  assert.equal(profile.accounts.at(-1).account_status, "closed");
  assert.ok(profile.accounts.slice(1).every((a) => a.included_in_cash === false));
  assert.ok(profile.accounts.every((a) => !("credit_limit_cents" in a)));
});

test("holding values stand alone and use linked account ownership without adding investment balance", () => {
  const profile = clientAssetProfile({ accounts: [plaid("production", { account_type: "investment", entity_kind: "business" })],
    holdings: [holding(), holding({ id: id(101), bank_account_id: null, source: "manual", current_value_cents: 0, entity_kind: "personal" })] });
  assert.equal(group(profile).currencies.length, 0);
  assert.equal(bucket(profile, "business", "USD", "investments").value.value_cents, 25000);
  assert.equal(bucket(profile, "unknown", "USD", "investments").value.value_cents, 0);
  assert.equal(bucket(profile, "unknown", "USD", "investments").value.basis.partial, true);
  assert.equal(profile.holdings[1].account_status, "unknown");
  assert.equal(profile.holdings[1].entity_kind, "unknown");
  assert.equal(profile.holdings[0].provider, "plaid");
});

test("closed-account holdings remain visible but are excluded from recorded investment totals", () => {
  const profile = clientAssetProfile({ accounts: [account({ account_type: "investment", closed_at: at })], holdings: [holding()] });
  assert.equal(profile.holdings.length, 1);
  assert.equal(profile.holdings[0].included_in_investments, false);
  assert.equal(profile.holdings[0].exclusion_reason, "closed_account");
  assert.equal(group(profile, "personal", "investments").currencies.length, 0);
});

test("source is per row: missing, manual, mock and imported data never claim verification", () => {
  const profile = clientAssetProfile({ provider: "plaid", accounts: [
    account({ provider: undefined }), account({ id: id(2), provider: "manual", entity_kind_source: "document_verified" }),
    account({ id: id(3), provider: "mock" }), account({ id: id(4), provider: "import" })
  ], holdings: [holding({ bank_account_id: id(2), source: "provider" }), holding({ id: id(101), bank_account_id: id(3) }),
    holding({ id: id(102), bank_account_id: id(4), source: "manual" })] });
  assert.deepEqual(profile.accounts.map((a) => a.provider), ["unknown", "manual", "mock", "import"]);
  assert.deepEqual(profile.holdings.map((h) => h.provider), ["manual", "mock", "manual"]);
  assert.deepEqual(bucket(profile).current.basis.providers, ["import", "manual"]);
  assert.equal(bucket(profile).current.value_cents, 20000);
  assert.deepEqual(profile.accounts.map((a) => a.included_in_cash), [false, true, false, true]);
  assert.equal(profile.holdings[1].included_in_investments, false);
  assert.equal(JSON.stringify(profile).includes('"bank_verified"'), false);
});

test("mixed production, test and legacy records keep evidence but exclude test and unknown sources from totals", () => {
  const profile = clientAssetProfile({ accounts: [
    plaid("production", { id: id(1), current_balance_cents: 12000, available_balance_cents: 9000 }),
    plaid("sandbox", { id: id(2), current_balance_cents: 900000, entity_kind: "business" }),
    plaid("development", { id: id(3), current_balance_cents: 800000, currency_code: "CAD" }),
    plaid(null, { id: id(4), provider_environment_evidence: null, current_balance_cents: 700000 }),
    account({ id: id(5), current_balance_cents: 3000, available_balance_cents: null }),
    account({ id: id(6), provider: "import", currency_code: "CAD", current_balance_cents: 4000 }),
    account({ id: id(7), provider: "mock", current_balance_cents: 600000 }),
    plaid("sandbox", { id: id(8), provider_environment_evidence: "legacy_sandbox_label", current_balance_cents: 500000 })
  ], holdings: Array.from({ length: 8 }, (_, i) => holding({ id: id(100 + i), bank_account_id: id(i + 1),
    current_value_cents: 1000 * (i + 1), currency_code: i === 5 ? "CAD" : "USD" })) });
  assert.equal(profile.accounts.length, 8);
  assert.equal(profile.holdings.length, 8);
  assert.equal(bucket(profile).current.value_cents, 15000);
  assert.equal(bucket(profile).available.value_cents, 9000);
  assert.equal(bucket(profile).available.basis.partial, true);
  assert.equal(bucket(profile, "personal", "CAD").current.value_cents, 4000);
  assert.equal(group(profile, "business").currencies.length, 0);
  assert.equal(bucket(profile, "personal", "USD", "investments").value.value_cents, 6000);
  assert.equal(bucket(profile, "personal", "CAD", "investments").value.value_cents, 6000);
  assert.deepEqual(profile.accounts.map((a) => a.included_in_cash), [true, false, false, false, true, true, false, false]);
  assert.deepEqual(profile.holdings.map((h) => h.included_in_investments), [true, false, false, false, true, true, false, false]);
  assert.deepEqual(profile.source_summary, { test_accounts: 4, unknown_plaid_environment_accounts: 1,
    excluded_cash_accounts: 5, excluded_holdings: 5 });
  assert.equal(profile.accounts[1].current_balance_cents, 900000, "excluded evidence is not erased");
  assert.equal(profile.accounts[7].provider_environment_evidence, "legacy_sandbox_label");
  assert.equal(profile.accounts[0].balance_as_of, at);
  assert.equal(profile.accounts[0].entity_kind_source, "client_stated");
});

test("unlinked/import/raw provenance flags cannot promote a record to a trusted production connection", () => {
  const forged = { plaid_environment: "production", plaid_environment_source: "server_transport" };
  const profile = clientAssetProfile({ accounts: [
    plaid("production", { provider_item_scoped: false, raw: forged }),
    plaid("production", { id: id(2), provider_item_scoped: undefined, raw: forged }),
    plaid("production", { id: id(3), provider_environment_evidence: "legacy_sandbox_label" }),
    plaid("production", { id: id(4), provider_environment_evidence: "browser" }),
    account({ id: id(5), provider: "import", provider_item_scoped: true, provider_environment: "production",
      provider_environment_evidence: "server_transport", raw: forged }),
    account({ id: id(6), provider: "manual", raw: forged }),
    account({ id: id(7), provider: undefined, raw: forged })
  ], holdings: [holding(), holding({ id: id(101), bank_account_id: id(200) })] });
  assert.ok(profile.accounts.every((a) => a.provider_environment === null));
  assert.ok(profile.accounts.every((a) => a.provider_environment_evidence === "unknown"));
  assert.deepEqual(profile.accounts.map((a) => a.included_in_cash), [false, false, false, false, true, true, false]);
  assert.equal(bucket(profile).current.value_cents, 20000, "manual/import entries remain recorded, never connected");
  assert.ok(profile.holdings.every((h) => !h.included_in_investments));
  assert.ok(profile.accounts.every((a) => !("raw" in a)));
});

test("snapshot time does not become a measured balance date; mixed dates stay explicit", () => {
  const earlier = "2026-11-01T09:00:00.000Z";
  const profile = clientAssetProfile({ asOf: new Date(at), accounts: [
    account({ balance_as_of: new Date(earlier) }), account({ id: id(2), balance_as_of: null }),
    account({ id: id(3), balance_as_of: at })
  ] });
  assert.equal(profile.as_of, at);
  assert.equal(bucket(profile).current.as_of, null);
  assert.deepEqual(bucket(profile).current.date_range, { oldest: earlier, newest: at, unknown: 1 });
  assert.equal(clientAssetProfile({ accounts: [account()] }).cash[0].currencies[0].current.as_of, at);
  assert.equal(clientAssetProfile({ asOf: "invalid", accounts: [account({ balance_as_of: "invalid" })] }).as_of, null);
});

test("PII, tokens, raw provider data and full account numbers cannot cross the projection", () => {
  const extras = { ssn: "123-45-6789", account_number: "1234567890123456", access_token: "secret-token", raw: { private: true },
    provider_account_id: "provider-secret", plaid_item_id: "item-secret", client_id: id(700), dob: "1970-01-01" };
  const profile = clientAssetProfile({ accounts: [account({ ...extras, name: "Account 1234567890123456 SSN 123-45-6789", mask: "1234567890123456" })],
    holdings: [holding({ ...extras, description: "Account 1234 5678 9012" })] });
  const serialized = JSON.stringify(profile);
  for (const value of ["1234567890123456", "123-45-6789", "1234 5678 9012", "secret-token", "provider-secret", "item-secret", "1970-01-01"]) {
    assert.equal(serialized.includes(value), false, value);
  }
  for (const key of Object.keys(extras)) {
    assert.equal(key in profile.accounts[0], false, key);
    assert.equal(key in profile.holdings[0], false, key);
  }
  assert.equal(profile.accounts[0].mask, null);
  assert.equal(clientAssetProfile({ accounts: [account({ mask: "****4321" })] }).accounts[0].mask, "4321");
});

test("overflow never emits an unsafe total and bounded output declares partial totals", () => {
  const overflow = clientAssetProfile({ accounts: [account({ current_balance_cents: Number.MAX_SAFE_INTEGER }), account({ id: id(2) })] });
  assert.equal(bucket(overflow).current.value_cents, null);
  assert.equal(bucket(overflow).current.basis.overflow, true);
  assert.equal(bucket(overflow).current.basis.partial, true);
  const profile = clientAssetProfile({ accounts: Array.from({ length: 201 }, (_, i) => account({ id: id(i + 1), current_balance_cents: 1 })),
    holdings: Array.from({ length: 501 }, (_, i) => holding({ id: id(i + 1000), current_value_cents: 1 })) });
  assert.equal(profile.accounts.length, 200);
  assert.equal(profile.holdings.length, 500);
  assert.deepEqual(profile.truncated, { accounts: true, holdings: true });
  assert.equal(bucket(profile).current.value_cents, 200);
  assert.equal(bucket(profile).current.basis.truncated, true);
  assert.equal(bucket(profile, "personal", "USD", "investments").value.value_cents, 500);
  assert.equal(bucket(profile, "personal", "USD", "investments").value.basis.partial, true);
});

for (const [name, makeAccount, visibleExclusion] of [
  ["sandbox", (n) => plaid("sandbox", { id: id(n) }), "test_data"],
  ["mock", (n) => account({ id: id(n), provider: "mock" }), "test_data"],
  ["unknown Plaid", (n) => plaid(null, { id: id(n), provider_environment_evidence: null }), "plaid_environment_unknown"],
  ["production", (n) => plaid("production", { id: id(n) }), null]
]) {
  test(`${name} parents beyond the account cap cannot become standalone manual investment evidence`, () => {
    const profile = clientAssetProfile({ accounts: Array.from({ length: 201 }, (_, i) => makeAccount(i + 1)), holdings: [
      holding({ id: id(1000), bank_account_id: id(200), source: "manual", current_value_cents: 900000 }),
      holding({ id: id(1001), bank_account_id: id(201), source: "manual", current_value_cents: 900000 }),
      holding({ id: id(1002), bank_account_id: id(999), source: "manual", current_value_cents: 900000 }),
      holding({ id: id(1003), bank_account_id: null, source: "manual", current_value_cents: 1234 })
    ] });
    assert.equal(profile.accounts.length, 200);
    assert.equal(profile.truncated.accounts, true);
    assert.equal(profile.holdings.length, 4, "all recorded holding evidence remains visible");
    assert.equal(profile.holdings[0].exclusion_reason, visibleExclusion);
    assert.equal(profile.holdings[0].included_in_investments, visibleExclusion === null);
    for (const row of profile.holdings.slice(1, 3)) {
      assert.equal(row.included_in_investments, false);
      assert.equal(row.exclusion_reason, "account_unavailable");
      assert.equal(row.current_value_cents, 900000);
      assert.equal(row.provider_environment, null);
    }
    assert.equal(profile.holdings[3].included_in_investments, true, "genuinely unlinked manual evidence stays recorded");
    assert.equal(bucket(profile, "unknown", "USD", "investments").value.value_cents, 1234);
    if (visibleExclusion === null) {
      assert.equal(bucket(profile, "personal", "USD", "investments").value.value_cents, 900000);
    } else {
      assert.equal(group(profile, "personal", "investments").currencies.length, 0);
    }
  });
}

test("invalid collection inputs and primitive rows do not create records", () => {
  for (const value of [null, {}, "input", 1, [null, 1, "bad", []]]) {
    const profile = clientAssetProfile({ accounts: value, holdings: value });
    assert.deepEqual(profile.accounts, []);
    assert.deepEqual(profile.holdings, []);
  }
});
