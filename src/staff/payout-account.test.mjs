import { test } from "node:test";
import assert from "node:assert/strict";
import {
  staffPlaidEnv, startStaffPayoutLink, completeStaffPayoutLink,
  maskedStaffPayoutAccount, staffPayoutLinkAvailability, canLinkStaffPayout
} from "./payout-account.mjs";

const ORG = "00000000-0000-4000-8000-000000000001";
const STAFF = "00000000-0000-4000-8000-000000000002";
const env = {
  STAFF_PLAID_TRANSFER_ENABLED: "1",
  STAFF_PLAID_ENV: "production", STAFF_PLAID_CLIENT_ID: "staff-id",
  STAFF_PLAID_SECRET: "staff-secret",
  STAFF_PLAID_TOKEN_ENC_KEY: Buffer.alloc(32, 7).toString("base64"),
  PLAID_ENV: "sandbox", PLAID_CLIENT_ID: "client-id", PLAID_SECRET: "client-secret",
  PLAID_TOKEN_ENC_KEY: Buffer.alloc(32, 1).toString("base64")
};

test("staff payout Link uses separate production credentials and transfer only", async () => {
  let called;
  const result = await startStaffPayoutLink({ staffId: STAFF, env,
    http: { async createLinkToken(args, options) {
      called = { args, options };
      return { ok: true, linkToken: "link-test", expiration: "later" };
    } }
  });
  assert.equal(result.ok, true);
  assert.equal(result.environment, "production");
  assert.deepEqual(called.args, { clientUserId: `staff-payout:${STAFF}`, products: ["transfer"] });
  assert.equal(called.options.environment, "production");
  assert.equal(called.options.clientId, "staff-id");
  assert.equal(called.options.secret, "staff-secret");
  assert.equal(called.options.env.PLAID_TOKEN_ENC_KEY, env.STAFF_PLAID_TOKEN_ENC_KEY);
  assert.equal(env.PLAID_ENV, "sandbox", "client Plaid environment was not modified");
  assert.equal(staffPlaidEnv(env).PLAID_CLIENT_ID, "staff-id");
});

test("staff payout Link refuses missing or sandbox staff config before Plaid", async () => {
  for (const [bad, expected] of [
    [{}, "transfer_unavailable"],
    [{ ...env, STAFF_PLAID_ENV: "sandbox" }, "not_configured"]
  ]) {
    const result = await startStaffPayoutLink({ staffId: STAFF, env: bad,
      http: { createLinkToken() { throw new Error("Plaid must not be called"); } }
    });
    assert.equal(result.status, 503);
    assert.equal(result.error, expected);
    if (expected === "not_configured") assert.ok(result.missing.length > 0);
  }
});

test("Transfer trial without production approval keeps Link unavailable", async () => {
  const trial = { ...env, STAFF_PLAID_TRANSFER_ENABLED: "0" };
  assert.deepEqual(staffPayoutLinkAvailability(trial), {
    linking_available: false,
    linking_message: "Payout bank linking is unavailable until Plaid Transfer is enabled."
  });
  const result = await startStaffPayoutLink({ staffId: STAFF, env: trial,
    http: { createLinkToken() { throw new Error("Plaid must not be called"); } }
  });
  assert.equal(result.status, 503);
  assert.equal(result.error, "transfer_unavailable");
});

test("masked account has no Plaid item, account id, or encrypted token", () => {
  const safe = maskedStaffPayoutAccount({
    id: "row", environment: "production", institution_name: "Arizona Financial",
    account_name: "Checking", account_mask: "1234", account_subtype: "checking",
    status: "active", plaid_item_id: "item-secret", plaid_account_id: "acct-secret",
    encrypted_access_token: "ciphertext"
  });
  assert.deepEqual(Object.keys(safe), ["id", "environment", "institution", "name", "mask", "subtype", "status"]);
  assert.equal(JSON.stringify(safe).includes("secret"), false);
});

function fakeDb(role = "closer", hasPayoutRole = false) {
  const writes = [];
  return { writes, async query(sql, params) {
    if (String(sql).includes("FROM staff s WHERE")) return { rows: [{ id: STAFF, role, has_payout_role: hasPayoutRole }] };
    writes.push({ sql: String(sql), params });
    if (String(sql).includes("INSERT INTO staff_payout_accounts")) return { rows: [{
      id: "saved", environment: "production", institution_name: "Bank",
      account_name: params[7], account_mask: params[8], account_subtype: params[9], status: "active"
    }] };
    return { rows: [] };
  } };
}
const link = { ok: true, item: {
  plaidItemId: "item", encryptedAccessToken: "encrypted", environment: "production"
} };
const checking = { plaidAccountId: "checking", type: "depository", subtype: "checking", name: "Checking", mask: "1234" };
const savings = { plaidAccountId: "savings", type: "depository", subtype: "savings", name: "Savings", mask: "5678" };

test("only an active eligible staff member can store a payout bank", async () => {
  const db = fakeDb("setter");
  const result = await completeStaffPayoutLink(db, {
    orgId: ORG, staffId: STAFF, publicToken: "public", env,
    plaid: { linkAccount() { throw new Error("Plaid must not be called"); } }
  });
  assert.equal(result.error, "not_eligible");
  assert.equal(db.writes.length, 0);
});

test("secondary closer duty can link while owner/admin and external roles cannot", async () => {
  assert.equal(canLinkStaffPayout({ role: "setter", roles: ["setter", "closer"] }), true);
  assert.equal(canLinkStaffPayout({ role: "owner", roles: ["owner", "closer"] }), false);
  assert.equal(canLinkStaffPayout({ role: "partner", roles: ["partner", "closer"] }), false);
  const db = fakeDb("setter", true);
  const result = await completeStaffPayoutLink(db, { orgId: ORG, staffId: STAFF,
    publicToken: "public", env, plaid: {
      linkAccount: async () => link,
      getAccounts: async () => ({ ok: true, accounts: [checking] })
    } });
  assert.equal(result.ok, true);
});

test("multiple accounts require the employee's explicit choice", async () => {
  const db = fakeDb();
  const provider = { linkAccount: async () => link, getAccounts: async () => ({ ok: true, accounts: [checking, savings] }) };
  const pending = await completeStaffPayoutLink(db, { orgId: ORG, staffId: STAFF,
    publicToken: "public", env, plaid: provider });
  assert.equal(pending.error, "pick_one_account");
  assert.equal(pending.status, 409);
  assert.equal(pending.choices.length, 2);
  assert.equal(db.writes.length, 0);

  const chosen = await completeStaffPayoutLink(db, { orgId: ORG, staffId: STAFF,
    publicToken: "public", accountId: "savings", env, plaid: provider });
  assert.equal(chosen.ok, true);
  assert.equal(chosen.account.mask, "5678", "public mask comes from chosen account");
  const insert = db.writes.find(({ sql }) => sql.includes("INSERT INTO staff_payout_accounts"));
  assert.equal(insert.params[1], STAFF);
  assert.equal(insert.params[4], "savings");
  assert.equal(insert.params[5], "encrypted");
  assert.equal(JSON.stringify(chosen).includes("encrypted"), false);
});
