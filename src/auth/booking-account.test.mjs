import { test } from "node:test";
import assert from "node:assert/strict";
import { ensurePendingClientAccount } from "./account-session.mjs";
import { pgFake } from "../workflows/test-support.mjs";

test("booking creates one invited client account and a replay reuses it", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "Buyer@Example.com", first_name: "Buyer" }] });
  const first = await ensurePendingClientAccount(db, { orgId: "org-1", clientId: "cl-1" });
  const second = await ensurePendingClientAccount(db, { orgId: "org-1", clientId: "cl-1" });
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(db.accounts.length, 1);
  assert.equal(db.accounts[0].status, "invited");
  assert.equal(db.accounts[0].client_id, "cl-1");
});

test("booking never attaches an email owned by a different account", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "buyer@example.com" }],
    accounts: [{ id: "acct-other", org_id: "org-1", email: "buyer@example.com", kind: "client", client_id: "cl-other", status: "active" }]
  });
  const result = await ensurePendingClientAccount(db, { orgId: "org-1", clientId: "cl-1" });
  assert.deepEqual(result, { ok: false, reason: "email_belongs_to_another_account" });
  assert.equal(db.accounts.length, 1);
});

test("booking with no email leaves no unusable account row", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: null }] });
  assert.deepEqual(await ensurePendingClientAccount(db, { orgId: "org-1", clientId: "cl-1" }),
    { ok: false, reason: "no_email" });
  assert.equal(db.accounts.length, 0);
});
