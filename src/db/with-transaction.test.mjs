// A checked-out client must go back to the pool NO MATTER WHAT the callback
// does — including throw. This is the one guarantee pool-leak-fix exists to
// prove: a thrown error must not leak a client.
//
// No real Postgres needed. A fake handle with connect() takes the "real Pool,
// or a test double that wants to observe BEGIN/COMMIT/ROLLBACK" branch
// (with-transaction.mjs's own header, branch 1), so this drives the exact
// acquire/release code path production runs, without a database.

import { test } from "node:test";
import assert from "node:assert";

import { withTransaction } from "./with-transaction.mjs";

function fakeClient() {
  const calls = [];
  return {
    calls,
    query: async (sql) => { calls.push(sql); },
    release: () => { calls.push("RELEASE"); }
  };
}

test("withTransaction releases the client when the callback throws", async () => {
  const client = fakeClient();
  const db = { connect: async () => client };
  const boom = new Error("boom");

  await assert.rejects(
    withTransaction(db, async () => { throw boom; }),
    (e) => e === boom
  );

  assert.deepEqual(client.calls, ["BEGIN", "ROLLBACK", "RELEASE"]);
});

test("withTransaction releases the client when ROLLBACK itself fails", async () => {
  // The pathological case: the callback throws AND the connection is already
  // broken enough that ROLLBACK also rejects. finally must still run.
  const calls = [];
  const client = {
    query: async (sql) => {
      calls.push(sql);
      if (sql === "ROLLBACK") throw new Error("connection reset");
    },
    release: () => { calls.push("RELEASE"); }
  };
  const db = { connect: async () => client };
  const boom = new Error("boom");

  await assert.rejects(
    withTransaction(db, async () => { throw boom; })
  );

  assert.deepEqual(calls, ["BEGIN", "ROLLBACK", "RELEASE"]);
});

test("withTransaction releases the client on the success path too", async () => {
  const client = fakeClient();
  const db = { connect: async () => client };

  const out = await withTransaction(db, async () => "ok");

  assert.equal(out, "ok");
  assert.deepEqual(client.calls, ["BEGIN", "COMMIT", "RELEASE"]);
});

test("withTransaction reuses a checked-out client inline without calling connect again", async () => {
  const calls = [];
  const checkedOut = {
    calls,
    query: async (sql) => { calls.push(sql); },
    release: () => { calls.push("RELEASE"); },
    connect: async () => {
      throw new Error("Client has already been connected. You cannot reuse a client.");
    }
  };

  const out = await withTransaction(checkedOut, async (tx) => {
    assert.equal(tx, checkedOut);
    await tx.query("SELECT 1");
    return "inline";
  });

  assert.equal(out, "inline");
  assert.deepEqual(calls, ["SELECT 1"]);
});
