// Slice S3 proofs: Capital Blueprint staff actions (credit partner, bank
// tracker) and the money-page bank plan. Real handlers, real logic, stand-in
// database. Every write is checked for the company and client it is bound to.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import staffActions from "../../api/blueprint/staff-actions.mjs";
import banksHandler from "../../api/money/banks.mjs";
import { makeRes, fakeDb } from "../testing/handler-harness.mjs";
import { gateAs, clientPrincipal, staffPrincipal } from "../testing/s3-mem-tasks-db.mjs";

const ORG = "0a000000-0000-4000-8000-000000000001";
const CLIENT = "c1000000-0000-4000-8000-000000000001";
const PARTNER = "c2000000-0000-4000-8000-000000000002";
const STAFF = "5aff0000-0000-4000-8000-000000000001";
const TODO = "b1000000-0000-4000-8000-0000000000b1";
const NOW = () => new Date("2026-10-13T15:00:00Z");

const inOrg = [/SELECT 1 FROM clients WHERE id = \$1 AND org_id = \$2/, [{ "?column?": 1 }]];
const buyer = [/FROM transactions t\s+JOIN products p/, [{ "?column?": 1 }]];
const notBuyer = [/FROM transactions t\s+JOIN products p/, []];

async function staffAction(body, rules) {
  const database = fakeDb(rules);
  const res = makeRes();
  await staffActions({ method: "POST", body: { client_id: CLIENT, ...body } }, res, {
    db: database, requireAuth: async () => ({ id: STAFF, role: "closer", org_id: ORG }), now: NOW
  });
  return { res, database };
}

describe("POST /api/blueprint/staff-actions create_credit_partner", () => {
  const body = { action: "create_credit_partner", first_name: "Pat", last_name: "Whitfield", email: "Pat@Example.test", phone: "+15555550100" };

  test("a Blueprint buyer gets a second client file linked to them, tagged as the credit partner", async () => {
    const { res, database } = await staffAction(body, [
      inOrg, buyer,
      [/FROM credit_partner_links\s+WHERE org_id/, []],
      [/INSERT INTO clients/, [{ id: PARTNER }]]
    ]);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { ok: true, linked: true, partnerClientId: PARTNER, consentRequired: true });
    const [client] = database.find(/INSERT INTO clients/);
    assert.deepEqual(client.params, [ORG, "Pat", "Whitfield", "pat@example.test", "+15555550100", ["blueprint_credit_partner"]]);
    const [link] = database.find(/INSERT INTO credit_partner_links/);
    assert.deepEqual(link.params, [ORG, CLIENT, PARTNER, STAFF]);
  });

  test("someone who did not buy the Blueprint is a 403 and no client or link is created", async () => {
    const { res, database } = await staffAction(body, [inOrg, notBuyer]);
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.error, "not_blueprint_buyer");
    assert.equal(database.find(/INSERT INTO clients|INSERT INTO credit_partner_links/).length, 0);
  });

  test("a buyer who already has a partner is answered with that partner and no second file", async () => {
    const { res, database } = await staffAction(body, [inOrg, buyer, [/FROM credit_partner_links\s+WHERE org_id/, [{ id: "l1", partner_client_id: PARTNER }]]]);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.partnerClientId, PARTNER);
    assert.equal(res.body.skipped, "already_linked");
    assert.equal(database.find(/INSERT INTO clients/).length, 0);
  });
});

describe("POST /api/blueprint/staff-actions set_next_sequence_date", () => {
  test("a Blueprint buyer's next funding sequence date is saved on their file, as a plain date", async () => {
    const { res, database } = await staffAction({ action: "set_next_sequence_date", ready_date: "2027-01-15" }, [inOrg, buyer]);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.readyDate, "2027-01-15");
    const [write] = database.find(/UPDATE clients SET custom_fields = custom_fields \|\|/);
    assert.equal(write.params[0], CLIENT);
    assert.deepEqual(Object.values(JSON.parse(write.params[1])), ["2027-01-15"]);
  });

  test("a non-buyer is a 403 and a bad date a 400; neither writes", async () => {
    const non = await staffAction({ action: "set_next_sequence_date", ready_date: "2027-01-15" }, [inOrg, notBuyer]);
    assert.equal(non.res.statusCode, 403);
    const bad = await staffAction({ action: "set_next_sequence_date", ready_date: "next spring" }, [inOrg, buyer]);
    assert.equal(bad.res.statusCode, 400);
    for (const out of [non, bad]) assert.equal(out.database.find(/UPDATE clients/).length, 0);
  });
});

describe("POST /api/blueprint/staff-actions bank tracker", () => {
  test("offer_bank_tracker turns the tracker on for a buyer and refuses a non-buyer", async () => {
    const on = await staffAction({ action: "offer_bank_tracker" }, [inOrg, buyer]);
    assert.equal(on.res.statusCode, 200);
    assert.deepEqual(on.res.body, { ok: true, offered: true });
    const [write] = on.database.find(/UPDATE clients SET custom_fields = custom_fields \|\|/);
    assert.deepEqual(write.params, [CLIENT, JSON.stringify({ blueprint_bank_tracker_offered: "true" })]);
    const off = await staffAction({ action: "offer_bank_tracker" }, [inOrg, notBuyer]);
    assert.equal(off.res.statusCode, 403);
    assert.equal(off.database.find(/UPDATE clients/).length, 0);
  });

  test("add_bank_todo adds one bank to the checklist once the tracker is offered, lower-cased, for this company", async () => {
    const row = { id: TODO, bank_key: "chase", account_kind: "business", state: "open" };
    const { res, database } = await staffAction({ action: "add_bank_todo", bank_key: " Chase ", account_kind: "Business", notes: "Ink card first" }, [
      inOrg, [/SELECT custom_fields->>\$2 AS v FROM clients/, [{ v: "true" }]], [/INSERT INTO blueprint_bank_relationship_todos/, [row]]
    ]);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { ok: true, todo: row });
    assert.deepEqual(database.find(/INSERT INTO blueprint_bank_relationship_todos/)[0].params, [ORG, CLIENT, "chase", "business", "Ink card first"]);
  });

  test("add_bank_todo before the tracker is offered is a 409 and writes nothing", async () => {
    const { res, database } = await staffAction({ action: "add_bank_todo", bank_key: "chase" }, [inOrg, [/SELECT custom_fields->>\$2 AS v FROM clients/, [{ v: null }]]]);
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.error, "bank_tracker_not_offered");
    assert.equal(database.find(/INSERT INTO blueprint_bank_relationship_todos/).length, 0);
  });

  test("list_bank_todos returns this client's checklist, oldest first, bound to the company", async () => {
    const todos = [{ id: TODO, bank_key: "chase", account_kind: "personal", state: "open", notes: null }];
    const { res, database } = await staffAction({ action: "list_bank_todos" }, [inOrg, [/FROM blueprint_bank_relationship_todos/, todos]]);
    assert.deepEqual(res.body, { ok: true, todos });
    const [q] = database.find(/FROM blueprint_bank_relationship_todos/);
    assert.deepEqual(q.params, [ORG, CLIENT]);
    assert.match(q.sql, /ORDER BY created_at ASC/);
  });

  test("update_bank_todo_state moves one item in this company to done; an unknown item is a 404, a bad state a 400", async () => {
    const ok = await staffAction({ action: "update_bank_todo_state", todo_id: TODO, state: "DONE" }, [inOrg, [/UPDATE blueprint_bank_relationship_todos\s+SET state = \$3/, [{ id: TODO, state: "done" }]]]);
    assert.equal(ok.res.statusCode, 200);
    assert.deepEqual(ok.res.body, { ok: true, todo: { id: TODO, state: "done" } });
    assert.deepEqual(ok.database.find(/UPDATE blueprint_bank_relationship_todos/)[0].params, [TODO, ORG, "done"]);
    const missing = await staffAction({ action: "update_bank_todo_state", todo_id: TODO, state: "done" }, [inOrg]);
    assert.equal(missing.res.statusCode, 404);
    const bad = await staffAction({ action: "update_bank_todo_state", todo_id: TODO, state: "finished" }, [inOrg]);
    assert.equal(bad.res.statusCode, 400);
    assert.equal(bad.database.find(/UPDATE blueprint_bank_relationship_todos/).length, 0);
  });
});

describe("POST /api/money/banks (staff plan the bank relationships)", () => {
  async function bankPost(body, rules, principal = staffPrincipal("owner", ORG, STAFF)) {
    const database = fakeDb([inOrg, ...rules]);
    const res = makeRes();
    await banksHandler({ method: "POST", body: { client_id: CLIENT, ...body } }, res, {
      db: database, requirePrincipal: gateAs(principal), now: NOW
    });
    return { res, database };
  }

  test("plan_bank writes one planned relationship for this client and company, with the day and deposit staff set", async () => {
    const { res, database } = await bankPost(
      { action: "plan_bank", bank: "Chase", account_kind: "business", planned_open_on: "2026-11-01", planned_deposit_cents: 250000 },
      [[/INSERT INTO blueprint_bank_relationship_todos AS t/, [{ id: TODO, state: "open" }]]]
    );
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { ok: true, action: "plan_bank", id: TODO, state: "open" });
    const [w] = database.find(/INSERT INTO blueprint_bank_relationship_todos AS t/);
    assert.deepEqual(w.params.slice(0, 10), [ORG, CLIENT, "chase", "business", "Chase", null, null, "2026-11-01", 250000, null]);
  });

  test("open_account marks the planned bank done on the day it really opened, in this client's own relationship only", async () => {
    const own = [/FROM blueprint_bank_relationship_todos\s+WHERE id = \$1::uuid AND org_id = \$2::uuid AND client_id = \$3::uuid/, [{ id: TODO, state: "open", opened_on: null, bank_key: "chase", bank_name: "Chase" }]];
    const { res, database } = await bankPost({ action: "open_account", relationship_id: TODO, opened_on: "2026-10-10" }, [own]);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { ok: true, action: "open_account", id: TODO });
    assert.deepEqual(database.find(/SET opened_on = \$4::date, state = 'done'/)[0].params, [TODO, ORG, CLIENT, "2026-10-10"]);
    const other = await bankPost({ action: "open_account", relationship_id: TODO, opened_on: "2026-10-10" }, []);
    assert.equal(other.res.statusCode, 404);
    assert.equal(other.database.find(/SET opened_on/).length, 0);
  });

  test("record_deposit saves one deposit staff saw land, 201, and refuses one dated before the account opened", async () => {
    const opened = [/FROM blueprint_bank_relationship_todos\s+WHERE id = \$1::uuid/, [{ id: TODO, state: "done", opened_on: "2026-10-10", bank_key: "chase", bank_name: "Chase" }]];
    const { res, database } = await bankPost(
      { action: "record_deposit", relationship_id: TODO, amount_cents: 100000, deposited_on: "2026-10-12", note: "wire" },
      [opened, [/INSERT INTO bank_relationship_deposits/, [{ id: "dep1" }]]]
    );
    assert.equal(res.statusCode, 201);
    assert.deepEqual(res.body, { ok: true, action: "record_deposit", id: "dep1" });
    assert.deepEqual(database.find(/INSERT INTO bank_relationship_deposits/)[0].params, [ORG, CLIENT, TODO, 100000, "2026-10-12", "wire", STAFF]);
    const early = await bankPost({ action: "record_deposit", relationship_id: TODO, amount_cents: 100000, deposited_on: "2026-10-01" }, [opened]);
    assert.equal(early.res.statusCode, 400);
    assert.equal(early.res.body.error, "deposit_before_open");
    assert.equal(early.database.find(/INSERT INTO bank_relationship_deposits/).length, 0);
  });

  test("set_next_sequence_date saves the date for a buyer; a non-buyer is a 403 with the sequence words", async () => {
    const ok = await bankPost({ action: "set_next_sequence_date", ready_date: "2027-02-01" }, [buyer]);
    assert.equal(ok.res.statusCode, 200);
    assert.equal(ok.res.body.readyDate, "2027-02-01");
    assert.equal(ok.database.find(/UPDATE clients SET custom_fields/)[0].params[0], CLIENT);
    const non = await bankPost({ action: "set_next_sequence_date", ready_date: "2027-02-01" }, [notBuyer]);
    assert.equal(non.res.statusCode, 403);
    assert.match(non.res.body.message, /next funding sequence date is part of the Capital Blueprint/);
    assert.equal(non.database.find(/UPDATE clients/).length, 0);
  });

  test("set_state skips a bank or puts it back, and a client can never change the plan", async () => {
    const own = [/FROM blueprint_bank_relationship_todos\s+WHERE id = \$1::uuid/, [{ id: TODO, state: "open", opened_on: null, bank_key: "chase", bank_name: "Chase" }]];
    const { res, database } = await bankPost({ action: "set_state", relationship_id: TODO, state: "skipped" }, [
      own, [/UPDATE blueprint_bank_relationship_todos\s+SET state = \$3/, [{ id: TODO, state: "skipped" }]]
    ]);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(database.find(/UPDATE blueprint_bank_relationship_todos\s+SET state = \$3/)[0].params, [TODO, ORG, "skipped"]);
    const asClient = await bankPost({ action: "set_state", relationship_id: TODO, state: "skipped" }, [own], clientPrincipal(CLIENT, ORG));
    assert.equal(asClient.res.statusCode, 403);
    assert.equal(asClient.database.find(/UPDATE blueprint_bank_relationship_todos/).length, 0);
  });
});
