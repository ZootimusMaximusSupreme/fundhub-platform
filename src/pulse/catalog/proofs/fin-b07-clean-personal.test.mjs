// Practice test for the "Clean personal info" row. The REAL eraseClient (src/privacy/erasure.mjs) runs
// against a stand-in that holds the real columns of every table it touches, with a person who has every
// kind of data the erasure says it removes. What it left is then read back, and judged by the EXACT live
// SQL of the display check (fin-b07-clean-personal).
//
// The live SQL reads only what an erasure that already finished left behind. It cannot see an erasure
// that never ran a statement (no row to read), or the owner/admin gate. So this test holds, directly:
//   * every field the erasure promises: both names, email, phone, the CRM contact id, the CRM field bag
//     and the tags on the client row; the identity row; the bank logins and accounts; and the merchant
//     name and raw payload on every transaction (the transactions themselves stay);
//   * what it promises to KEEP stays: the credit file, the soft-pull ledger, the access log, the invoices;
//   * the audit row is written, completed, and names what was removed and what was kept;
//   * another client of the company is not touched.
// The role half (owner and admin only) is held at the end of this file with the real handler: every other
// staff role is refused before the erasure reads or writes a thing.

import assert from "node:assert/strict";
import test from "node:test";

import erasureHandler from "../../../../api/privacy/erasure.mjs";
import { eraseClient } from "../../../privacy/erasure.mjs";
import { callShared } from "../../../testing/s3-handler-call.mjs";
import { req, staffSession } from "../../../testing/handler-harness.mjs";
import { ORG, contractSql, id } from "./fin-b07-case-runner.mjs";
import { UUID_DEFAULT, makeStandIn } from "./fin-b07-sql-kit.mjs";

const SUBJECT = id(1);
const NEIGHBOUR = id(2);
const STAFF = id(50);
const NOW = "2026-10-14 12:00:00";
const OLD = "2026-08-01 09:00:00";
const TABLES = [
  "clients", "pii_identity", "plaid_items", "bank_accounts", "bank_transactions", "erasure_requests",
  "crs_results", "tradelines", "soft_pull_requests", "pii_access_log", "transactions", "invoices", "commission_ledger",
];
const DEFAULTS = { erasure_requests: { id: UUID_DEFAULT, created_at: "(datetime('now'))" } };

function seeded() {
  const standIn = makeStandIn(TABLES, { defaults: DEFAULTS });
  const person = (n, extra = {}) => standIn.insert("clients", {
    id: id(n), org_id: ORG, first_name: "Dana", last_name: "Whitfield", email: `dana${n}@example.test`, phone: "+15555550100",
    ghl_contact_id: `ghl_${n}`, custom_fields: { cf_dob: "1980-02-01", cf_city: "Phoenix" }, tags: ["docs:missing", "vip"],
    is_demo: false, created_at: OLD, updated_at: OLD, ...extra,
  });
  person(1);
  person(2, { first_name: "Sam", last_name: "Rivera" });
  for (const n of [1, 2]) {
    standIn.insert("pii_identity", { id: id(100 + n), org_id: ORG, client_id: id(n), ssn_enc: "v1:a:b:c", updated_at: OLD });
    standIn.insert("plaid_items", { id: id(200 + n), org_id: ORG, client_id: id(n), plaid_item_id: `pi_${n}`, encrypted_access_token: "v1:a:b:c", created_at: OLD });
    standIn.insert("bank_accounts", { id: id(300 + n), org_id: ORG, client_id: id(n), plaid_item_id: id(200 + n), created_at: OLD });
    for (const t of [1, 2, 3]) {
      standIn.insert("bank_transactions", {
        id: id(400 + n * 10 + t), org_id: ORG, client_id: id(n), subject_client_id: id(n), amount_cents: 1000 * t,
        merchant_name: `Merchant ${t}`, raw: { counterparty: `x${t}` }, updated_at: OLD,
      });
    }
    standIn.insert("crs_results", { id: id(500 + n), org_id: ORG, client_id: id(n) });
    standIn.insert("tradelines", { id: id(510 + n), org_id: ORG, client_id: id(n) });
    standIn.insert("soft_pull_requests", { id: id(520 + n), org_id: ORG, client_id: id(n) });
    standIn.insert("pii_access_log", { id: id(530 + n), org_id: ORG, client_id: id(n), accessed_by: "inquiry-bureau-call", field: "ssn (call prep)" });
    standIn.insert("transactions", { id: id(540 + n), org_id: ORG, client_id: id(n) });
    standIn.insert("invoices", { id: id(550 + n), org_id: ORG, client_id: id(n) });
    standIn.insert("commission_ledger", { id: id(560 + n), org_id: ORG, client_id: id(n) });
  }
  return standIn;
}

const erase = (standIn, over = {}) => eraseClient(standIn.pg({ now: NOW }), {
  orgId: ORG, clientId: SUBJECT, requestedBy: { staffId: STAFF, label: "Dana Owner" }, reason: "client emailed on 2026-10-13 asking to be erased", ...over,
});

const only = (standIn, table, clientId) => standIn.rows(table).filter((r) => r.client_id === clientId);

test("every field the erasure promises is gone from the client row, and the row and its id stay", async () => {
  const standIn = seeded();
  try {
    const out = await erase(standIn);
    assert.equal(out.erased, true);
    const [row] = standIn.rows("clients").filter((r) => r.id === SUBJECT);
    assert.ok(row, "the client row is de-identified, never deleted");
    assert.equal(row.first_name, "[erased]");
    assert.equal(row.last_name, "[erased]");
    assert.equal(row.email, null);
    assert.equal(row.phone, null);
    assert.equal(row.ghl_contact_id, null);
    assert.deepEqual(row.custom_fields, {}, "the CRM field bag is emptied wholesale");
    assert.ok(["{}", "[]"].includes(typeof row.tags === "string" ? row.tags : JSON.stringify(row.tags)), `the tags are emptied, got ${JSON.stringify(row.tags)}`);
  } finally {
    standIn.close();
  }
});

test("the identity, the bank logins and the bank accounts are deleted, and the transactions stay with their merchant and raw payload scrubbed", async () => {
  const standIn = seeded();
  try {
    await erase(standIn);
    assert.equal(only(standIn, "pii_identity", SUBJECT).length, 0, "the identity row goes outright");
    assert.equal(only(standIn, "plaid_items", SUBJECT).length, 0, "the bank logins go");
    assert.equal(only(standIn, "bank_accounts", SUBJECT).length, 0, "the bank accounts go");
    const txns = standIn.rows("bank_transactions").filter((r) => r.subject_client_id === SUBJECT);
    assert.equal(txns.length, 3, "the ledger rows stay");
    assert.deepEqual(txns.map((t) => t.amount_cents).sort(), [1000, 2000, 3000], "the money stays intact");
    for (const t of txns) {
      assert.equal(t.merchant_name, null, "the merchant name is scrubbed from every row");
      assert.deepEqual(t.raw, {}, "the provider payload is scrubbed from every row");
    }
  } finally {
    standIn.close();
  }
});

test("what the erasure promises to keep stays, and another client of the company is not touched", async () => {
  const standIn = seeded();
  try {
    await erase(standIn);
    for (const table of ["crs_results", "tradelines", "soft_pull_requests", "pii_access_log", "transactions", "invoices", "commission_ledger"]) {
      assert.equal(only(standIn, table, SUBJECT).length, 1, `${table} is kept`);
    }
    const [neighbour] = standIn.rows("clients").filter((r) => r.id === NEIGHBOUR);
    assert.equal(neighbour.last_name, "Rivera");
    assert.equal(neighbour.email, "dana2@example.test");
    assert.equal(neighbour.ghl_contact_id, "ghl_2");
    assert.equal(only(standIn, "pii_identity", NEIGHBOUR).length, 1);
    assert.equal(only(standIn, "plaid_items", NEIGHBOUR).length, 1);
    assert.equal(only(standIn, "bank_accounts", NEIGHBOUR).length, 1);
    const theirs = standIn.rows("bank_transactions").filter((r) => r.subject_client_id === NEIGHBOUR);
    assert.equal(theirs.length, 3);
    assert.ok(theirs.every((t) => t.merchant_name && t.merchant_name.startsWith("Merchant")), "their merchants are not scrubbed");
  } finally {
    standIn.close();
  }
});

test("the audit row is written complete, names who asked and why, and lists what was removed and what was kept", async () => {
  const standIn = seeded();
  try {
    await erase(standIn);
    const audits = standIn.rows("erasure_requests");
    assert.equal(audits.length, 1);
    const [audit] = audits;
    assert.equal(audit.kind, "client_erasure");
    assert.equal(audit.status, "completed");
    assert.equal(audit.subject_client_id, SUBJECT);
    assert.equal(audit.org_id, ORG);
    assert.equal(audit.requested_by_label, "Dana Owner");
    assert.match(audit.reason, /asking to be erased/);
    assert.ok(audit.completed_at, "a completed erasure carries the time it finished");
    assert.ok(audit.removed.some((r) => r.table === "clients"));
    assert.ok(audit.removed.some((r) => r.table === "bank_transactions"));
    assert.ok(audit.kept.some((k) => k.table === "crs_results" && k.rows === 1));
  } finally {
    standIn.close();
  }
});

test("the live SQL check reads the erased client clean, and reads each thing an erasure could leave as wrong", async () => {
  const standIn = seeded();
  try {
    await erase(standIn);
    assert.deepEqual(standIn.run(contractSql("fin-b07-clean-personal"), ORG), { sample_count: 1, bad_count: 0 });

    // Put back, one at a time, what the erasure took; each must read wrong.
    const afterwards = (sql, params = []) => standIn.db.prepare(sql).run(...params);
    const judged = () => standIn.run(contractSql("fin-b07-clean-personal"), ORG);
    const [audit] = standIn.rows("erasure_requests");
    const rewind = (table, set, where) => afterwards(`UPDATE ${table} SET ${set} WHERE ${where}`);

    rewind("clients", "last_name = 'Whitfield'", `id = '${SUBJECT}'`);
    assert.equal(judged().bad_count, 1, "a surname left behind");
    rewind("clients", "last_name = '[erased]'", `id = '${SUBJECT}'`);

    rewind("clients", "ghl_contact_id = 'ghl_1'", `id = '${SUBJECT}'`);
    assert.equal(judged().bad_count, 1, "a CRM contact id left behind");
    rewind("clients", "ghl_contact_id = NULL", `id = '${SUBJECT}'`);

    rewind("clients", `custom_fields = '{"cf_dob":"1980-02-01"}'`, `id = '${SUBJECT}'`);
    assert.equal(judged().bad_count, 1, "the CRM field bag left behind");
    rewind("clients", "custom_fields = '{}'", `id = '${SUBJECT}'`);

    rewind("bank_transactions", "merchant_name = 'Mesa Dental'", `subject_client_id = '${SUBJECT}' AND amount_cents = 1000`);
    assert.equal(judged().bad_count, 1, "a merchant name left behind");
    assert.equal(audit.status, "completed");
  } finally {
    standIn.close();
  }
});

test("a refused request (a reason that says nothing) removes nothing and writes no audit row", async () => {
  const standIn = seeded();
  try {
    await assert.rejects(() => erase(standIn, { reason: "nope" }), /reason is required/);
    assert.equal(standIn.rows("erasure_requests").length, 0);
    const [row] = standIn.rows("clients").filter((r) => r.id === SUBJECT);
    assert.equal(row.last_name, "Whitfield");
    assert.equal(only(standIn, "pii_identity", SUBJECT).length, 1);
  } finally {
    standIn.close();
  }
});

// ── The door: owner and admin only ───────────────────────────────────────────────────────────────────

const LOGIN_ONLY = /live JOIN staff|account_sessions|FROM accounts WHERE id/;
const WHO_MAY = ["owner", "admin"];
const WHO_MAY_NOT = ["closer", "setter", "csm", "sales_manager", "funding_advisor", "inquiry_specialist"];
const ASK = (clientId) => req("POST", { body: { client_id: clientId, confirm_client_id: clientId, reason: "written request from the client, received by email" } });
const THE_CLIENT = "c1000000-0000-4000-8000-000000000001";

test("only an owner or an admin is let in to erase a client; every other staff role is refused before anything is read", async () => {
  for (const role of WHO_MAY) {
    const { res } = await callShared(erasureHandler, ASK(THE_CLIENT), [staffSession({ role })]);
    assert.notEqual(res.statusCode, 403, `${role} must not be refused`);
    assert.notEqual(res.statusCode, 401, role);
  }
  for (const role of WHO_MAY_NOT) {
    const { res, fake } = await callShared(erasureHandler, ASK(THE_CLIENT), [staffSession({ role })]);
    assert.equal(res.statusCode, 403, `${role} must be refused`);
    const looked = fake.calls.filter((c) => !LOGIN_ONLY.test(c.sql)).map((c) => c.sql.trim().slice(0, 60));
    assert.deepEqual(looked, [], `${role} was refused only after a read: ${looked.join(" | ")}`);
  }
});
