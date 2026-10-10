// POST /api/auth/logout — the real handler, run with no Postgres.
//
// Sign out must end the session in BOTH stores (staff `sessions` and the
// client / partner `account_sessions`) and clear the cookie. The handler said
// so in a comment; nothing ran it.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import handler from "../../api/auth/logout.mjs";
import { ROUTES } from "../../netlify/functions/api.mjs";
import { hashToken } from "../auth/session.mjs";
import { fakeDb, makeRes, runWithSharedDb } from "../testing/handler-harness.mjs";

async function call(request, rules = []) {
  const fake = fakeDb(rules);
  const res = makeRes();
  await runWithSharedDb(fake, () => handler(request, res));
  return { res, fake };
}

const CLEARED = /^fundhub_session=;.*Max-Age=0/;

describe("POST /api/auth/logout", () => {
  test("is routed", () => {
    assert.equal(ROUTES["auth/logout"], handler);
  });

  test("GET is refused", async () => {
    const { res, fake } = await call({ method: "GET", headers: {} });
    assert.equal(res.statusCode, 405);
    assert.equal(fake.calls.length, 0);
  });

  test("a bearer token is revoked in both session stores, by its hash, and the cookie is cleared", async () => {
    const token = "logout-test-token-1";
    const { res, fake } = await call(
      { method: "POST", headers: { authorization: `Bearer ${token}` } },
      [[/UPDATE sessions SET revoked_at/, [{ id: "s1" }]]]
    );
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { ok: true });
    assert.match(res.headers["set-cookie"], CLEARED);
    const staff = fake.find(/UPDATE sessions SET revoked_at/);
    const account = fake.find(/UPDATE account_sessions SET revoked_at/);
    assert.equal(staff.length, 1);
    assert.equal(account.length, 1);
    assert.deepEqual(staff[0].params, [hashToken(token)]);
    assert.deepEqual(account[0].params, [hashToken(token)]);
    // The raw token never goes to the database.
    assert.ok(!fake.calls.some((c) => (c.params || []).includes(token)));
  });

  test("the cookie token is revoked too (portal sign-out sends no bearer)", async () => {
    const token = "cookie-token-2";
    const { res, fake } = await call({ method: "POST", headers: { cookie: `a=1; fundhub_session=${token}` } });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(fake.find(/UPDATE account_sessions SET revoked_at/)[0].params, [hashToken(token)]);
  });

  test("a dead database still signs the person out of this browser (cookie cleared, 200)", async () => {
    const { res } = await call(
      { method: "POST", headers: { authorization: "Bearer x" } },
      [[/revoked_at/, new Error("connection terminated")]]
    );
    assert.equal(res.statusCode, 200);
    assert.match(res.headers["set-cookie"], CLEARED);
  });

  test("no token: nothing is written, the cookie is still cleared", async () => {
    const { res, fake } = await call({ method: "POST", headers: {} });
    assert.equal(res.statusCode, 200);
    assert.equal(fake.calls.length, 0);
    assert.match(res.headers["set-cookie"], CLEARED);
  });
});
