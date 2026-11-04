import assert from "node:assert/strict";
import test from "node:test";
import { hashPassword } from "../src/auth/hash.mjs";
import { inspectLiveAuthFixtures } from "./live-playwright-auth-fixtures.mjs";

const PASSWORD = "live-sweep-fixture-password";
const STAFF = ["chris@fundhub.ai", "owner@fundhub.ai", "admin@fundhub.ai"];
const ACCOUNTS = ["affiliate@fundhub.ai", "partner@fundhub.ai"];

async function fixtureDb() {
  const password_hash = await hashPassword(PASSWORD);
  const staff = STAFF.map((email) => ({ email, status: "active", removed_at: null, password_hash }));
  const accounts = ACCOUNTS.map((email) => ({ email, status: "active", password_hash }));
  return {
    staff,
    accounts,
    query: async (sql) => ({ rows: /FROM staff/.test(sql) ? staff : accounts })
  };
}

test("live sweep proceeds only when every named staff and account credential works", async () => {
  const db = await fixtureDb();
  assert.deepEqual(await inspectLiveAuthFixtures(db, PASSWORD), []);
  assert.deepEqual(await inspectLiveAuthFixtures(db, ""), ["live test password is missing"]);
  const wrong = await inspectLiveAuthFixtures(db, "wrong-live-sweep-password");
  assert.equal(wrong.length, 5);
  assert.ok(wrong.every((issue) => /does not match/.test(issue)));
});

test("removed, suspended, and missing live principals fail before browser logins", async () => {
  const db = await fixtureDb();
  db.staff[0].removed_at = new Date();
  db.staff[1].status = "suspended";
  db.accounts.pop();
  const problems = await inspectLiveAuthFixtures(db, PASSWORD);
  assert.deepEqual(problems, [
    "staff chris@fundhub.ai is not active",
    "staff owner@fundhub.ai is not active",
    "account partner@fundhub.ai is missing"
  ]);
});
