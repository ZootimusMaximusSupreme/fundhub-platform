// Practice test (fake data, stand-in rows, the REAL handler and the REAL store SQL) for the Lenders desk row
//   "Mismatch queue row: Dismiss button".
//
// Why this is a practice test and not a live check. reviewObservation (src/lenders/store.mjs) saves ONLY
// review_status, plus created_by when it was empty: no reviewer, no time. So the saved row cannot say
// whether a Dismiss was pressed or done wrong, and any query over it judges fields set when the
// observation was LOGGED. What can be judged is what the button does when it is pressed: which row it
// changes, to what, and for which company. That is judged here by running the real api/ handler and the
// real UPDATE text from the store over stand-in rows (the SQL is run in SQLite by the batch's kit, with
// the Postgres casts dropped), and in the browser by e2e/fin-b15-lenders-dismiss.spec.mjs.
//
// Breaks made on purpose (each alone, then put back): the handler writes another status than the one
// sent; the UPDATE drops the id and changes every row of the company; the UPDATE drops the company; the
// UPDATE no longer sets the status. Each turns a test below red.

import assert from "node:assert/strict";
import test from "node:test";

import writeObservations from "../../../../api/lender-observations.mjs";
import { hit, ORG_ID, OTHER_ORG_ID } from "./s5-route-kit.mjs";
import { makeStandIn } from "./fin-b15-sql-kit.mjs";

const A = "0a000000-0000-4000-8000-0000000000a1";
const B = "0a000000-0000-4000-8000-0000000000a2";
const C = "0b000000-0000-4000-8000-0000000000c3";

function world() {
  const db = makeStandIn(["lender_bureau_observations"]);
  const base = {
    review_status: "pending", mismatch_flag: true, observed_bureau: "TU", lender_name: "First Bank",
    expected_bureaus_raw: "EX", created_by: null
  };
  db.insert("lender_bureau_observations", { id: A, org_id: ORG_ID, ...base });
  db.insert("lender_bureau_observations", { id: B, org_id: ORG_ID, ...base, lender_name: "Second Bank", created_by: "Sam Closer" });
  db.insert("lender_bureau_observations", { id: C, org_id: OTHER_ORG_ID, ...base, lender_name: "Far Bank" });
  return db;
}

const statusOf = (db) => Object.fromEntries(db.rows("lender_bureau_observations").map((r) => [r.id, r.review_status]));

async function press(db, body, role = "owner") {
  return hit(writeObservations, {
    method: "POST",
    role,
    body,
    // The one statement the review runs is answered by the stand-in table; the sign-in check is the harness's.
    rules: [[/UPDATE lender_bureau_observations/, async (sql, params) => (await db.query(sql, params)).rows]]
  });
}

test("Dismiss changes that one row to dismissed, and leaves the other pending rows and the other company's row alone", async () => {
  const db = world();
  try {
    const out = await press(db, { action: "review", id: A, review_status: "dismissed" });
    assert.equal(out.status, 200);
    assert.equal(out.body.ok, true);
    assert.equal(out.body.observation.id, A);
    assert.equal(out.body.observation.review_status, "dismissed");
    assert.deepEqual(statusOf(db), { [A]: "dismissed", [B]: "pending", [C]: "pending" });
  } finally { db.close(); }
});

test("Dismiss names who pressed it only when nobody is named already, and never touches the observation's own fields", async () => {
  const db = world();
  try {
    await press(db, { action: "review", id: A, review_status: "dismissed" });
    await press(db, { action: "review", id: B, review_status: "dismissed" });
    const rows = Object.fromEntries(db.rows("lender_bureau_observations").map((r) => [r.id, r]));
    assert.equal(rows[A].created_by, "Olive Owner", "an empty name takes the one who pressed");
    assert.equal(rows[B].created_by, "Sam Closer", "a name already there stays");
    for (const id of [A, B]) {
      assert.equal(rows[id].observed_bureau, "TU");
      assert.equal(rows[id].mismatch_flag, 1);
      assert.equal(rows[id].lender_name, id === A ? "First Bank" : "Second Bank");
    }
  } finally { db.close(); }
});

test("Dismiss on another company's row is a 404 and changes nothing", async () => {
  const db = world();
  try {
    const out = await press(db, { action: "review", id: C, review_status: "dismissed" });
    assert.equal(out.status, 404);
    assert.equal(out.body.error, "not_found");
    assert.deepEqual(statusOf(db), { [A]: "pending", [B]: "pending", [C]: "pending" });
  } finally { db.close(); }
});

test("each of the three buttons saves its own word on its own row: Confirm, Corrected, Dismiss", async () => {
  const db = world();
  try {
    await press(db, { action: "review", id: A, review_status: "confirmed" });
    await press(db, { action: "review", id: B, review_status: "corrected" });
    assert.deepEqual(statusOf(db), { [A]: "confirmed", [B]: "corrected", [C]: "pending" });
    await press(db, { action: "review", id: A, review_status: "dismissed" });
    assert.deepEqual(statusOf(db), { [A]: "dismissed", [B]: "corrected", [C]: "pending" });
  } finally { db.close(); }
});

test("a word that is not a review status, and an id that is not an id, are refused before any row is written", async () => {
  const db = world();
  try {
    const word = await press(db, { action: "review", id: A, review_status: "deleted" });
    assert.equal(word.status, 400);
    assert.equal(word.body.error, "invalid_review_status");
    const id = await press(db, { action: "review", id: "not-an-id", review_status: "dismissed" });
    assert.equal(id.status, 400);
    assert.equal(id.body.error, "id_required");
    assert.deepEqual(statusOf(db), { [A]: "pending", [B]: "pending", [C]: "pending" });
    assert.equal(word.db.find(/UPDATE lender_bureau_observations/).length, 0);
    assert.equal(id.db.find(/UPDATE lender_bureau_observations/).length, 0);
  } finally { db.close(); }
});
