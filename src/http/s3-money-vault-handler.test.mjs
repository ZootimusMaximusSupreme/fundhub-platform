// Slice S3 proof: POST /api/money/vault. Staff rule on a client's uploaded
// papers. The real handler and the real vault logic run. The database is a
// stand-in that holds two clients' papers and lines and answers each statement
// by the id, company and client its SQL names, so a refusal is the product's own.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import vaultHandler from "../../api/money/vault.mjs";
import { makeRes, fakeDb } from "../testing/handler-harness.mjs";
import {
  gateAs, clientPrincipal, staffPrincipal, FINANCE_OS_ROLES, NOT_FINANCE_OS_ROLES
} from "../testing/s3-mem-tasks-db.mjs";
import { clientsRule, tableRules } from "../testing/s3-scoped-rows.mjs";
import {
  decideDocument, addCustomItem, retireItem, waiveItem, unwaiveItem, VaultError
} from "../finance/document-vault.mjs";

const ORG = "0a000000-0000-4000-8000-000000000001";
const OTHER_ORG = "0b000000-0000-4000-8000-000000000002";
const CLIENT = "c1000000-0000-4000-8000-000000000001";
const OTHER_CLIENT = "c2000000-0000-4000-8000-000000000002";
const STAFF = "5aff0000-0000-4000-8000-000000000001";
const DOC = "d1000000-0000-4000-8000-0000000000d1";
const OTHER_DOC = "d2000000-0000-4000-8000-0000000000d2";
const ITEM = "e1000000-0000-4000-8000-0000000000e1";
const OTHER_ITEM = "e2000000-0000-4000-8000-0000000000e2";
const NOW = () => new Date("2026-10-13T15:00:00Z");

const paper = (over = {}) => ({
  id: DOC, org_id: ORG, client_id: CLIENT, kind: "client_upload", subtype: "id_document", title: "Photo ID",
  mime_type: "image/png", generated_at: "2026-10-12T10:00:00Z", expires_at: null, current_version_id: null, metadata: {}, ...over
});
const line = (over = {}) => ({
  id: ITEM, org_id: ORG, client_id: CLIENT, kind: "custom", item_key: "custom_aaaa1111", entity_id: null,
  title: "Lease agreement", note: null, subtype: null, need: 1, created_at: "2026-10-01T00:00:00Z", retired_at: null, ...over
});

/**
 * Two clients in company A (CLIENT, OTHER_CLIENT) with a paper each, or CLIENT moved to company B.
 * `items`, `reviews` are the live tables: read them after a call to see what was written.
 */
function world({ clientOrg = ORG, items = [], papers = null } = {}) {
  const clients = [
    { id: CLIENT, org_id: clientOrg, first_name: "Dana", last_name: "Whitfield" },
    { id: OTHER_CLIENT, org_id: ORG, first_name: "Omar", last_name: "Reyes" }
  ];
  const documents = papers || [paper({ org_id: clientOrg }), paper({ id: OTHER_DOC, client_id: OTHER_CLIENT, title: "Other photo ID" })];
  const reviews = [];
  const retire = (row, params) => Object.assign(row, { retired_at: "2026-10-13T15:00:00Z", retired_by: params.at(-1) });
  const database = fakeDb([
    clientsRule(clients),
    ...tableRules("documents", documents),
    ...tableRules("document_vault_items", items, { set: retire }),
    ...tableRules("document_vault_reviews", reviews),
    [/^\s*INSERT INTO document_vault_reviews/, (sql, params) => {
      const [org, client, document, status, itemKey, , covers, periodEnd, reason, by] = params;
      reviews.push({ org_id: org, client_id: client, document_id: document, status, item_key: itemKey, covers, period_end: periodEnd, reason, by });
      return [{ id: `r${reviews.length}`, status }];
    }],
    [/^\s*INSERT INTO document_vault_items/, (sql, params) => {
      const waiver = /'waiver'/.test(sql);
      const row = waiver
        ? { id: `w${items.length + 1}`, org_id: params[0], client_id: params[1], entity_id: params[2], item_key: params[3], kind: "waiver", note: params[4], retired_at: null }
        : { id: params[0], org_id: params[1], client_id: params[2], entity_id: params[3], item_key: params[4], kind: "custom", title: params[5], note: params[6], need: params[8], retired_at: null };
      items.push(row);
      return [{ id: row.id }];
    }]
  ]);
  return { database, items, reviews, documents };
}
const writes = (database) => database.find(/^\s*(INSERT|UPDATE|DELETE)/i);

async function post(body, { role = "owner", clientId = CLIENT, w = world(), deps = {} } = {}) {
  const res = makeRes();
  await vaultHandler({ method: "POST", body: { client_id: clientId, ...body }, headers: { host: "app.example" } }, res, {
    db: w.database, requirePrincipal: gateAs(staffPrincipal(role, ORG, STAFF)), now: NOW, env: {}, ...deps
  });
  return { res, ...w };
}

describe("POST /api/money/vault", () => {
  test("accept files the paper under its line with the units and date a person typed, stamped with the staff id", async () => {
    const { res, database, reviews } = await post({ action: "accept", document_id: DOC, covers: 1, period_end: "2026-10-01" });
    assert.equal(res.statusCode, 200);
    assert.deepEqual([res.body.ok, res.body.action], [true, "accept"]);
    assert.deepEqual(res.body.result, { id: "r1", status: "accepted", lines: ["id_document:client"] });
    assert.ok(!JSON.stringify(res.body.vault).includes("Other photo ID"), "the fresh read shows this client's papers only");
    const [write] = database.find(/INSERT INTO document_vault_reviews/);
    assert.deepEqual(write.params, [ORG, CLIENT, DOC, "accepted", null, null, 1, "2026-10-01", null, STAFF]);
    assert.equal(reviews.length, 1);
  });

  test("reject needs a reason, and the reason is what the client reads as what to fix", async () => {
    const { res, database } = await post({ action: "reject", document_id: DOC, reason: "  Photo is   cut off " });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.result.status, "rejected");
    const [write] = database.find(/INSERT INTO document_vault_reviews/);
    assert.equal(write.params[3], "rejected");
    assert.equal(write.params[8], "Photo is cut off");
    const refused = await post({ action: "reject", document_id: DOC });
    assert.equal(refused.res.statusCode, 400);
    assert.equal(writes(refused.database).length, 0);
  });

  test("waive says a standard line does not apply (reason required); unwaive puts it back", async () => {
    const { res, database, items } = await post({ action: "waive", item_key: "tax_returns_personal", reason: "Filed as a dependent" });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.result, { id: "w1", created: true });
    assert.deepEqual(database.find(/INSERT INTO document_vault_items/)[0].params, [ORG, CLIENT, null, "tax_returns_personal", "Filed as a dependent", STAFF]);
    assert.match(database.find(/INSERT INTO document_vault_items/)[0].sql, /'waiver'/);

    const noReason = await post({ action: "waive", item_key: "tax_returns_personal" });
    assert.equal(noReason.res.statusCode, 400);
    assert.equal(writes(noReason.database).length, 0);

    const back = await post({ action: "unwaive", item_key: "tax_returns_personal" }, { w: world({ items }) });
    assert.equal(back.res.statusCode, 200);
    assert.deepEqual(back.res.body.result, { id: "w1" });
    assert.deepEqual(back.database.find(/UPDATE document_vault_items/)[0].params, [ORG, CLIENT, "tax_returns_personal", null, STAFF]);
    assert.equal(items[0].retired_by, STAFF);
  });

  test("add_item adds a custom line to this client; retire_item takes it off but keeps the row", async () => {
    const added = await post({ action: "add_item", title: "Lease agreement", note: "Last page signed", need: 1 });
    assert.equal(added.res.statusCode, 200);
    assert.match(added.res.body.result.item_key, /^custom_[0-9a-f]{8}$/);
    const [ins] = added.database.find(/INSERT INTO document_vault_items/);
    assert.equal(ins.params[1], ORG);
    assert.equal(ins.params[2], CLIENT);
    assert.equal(ins.params[5], "Lease agreement");
    assert.equal(ins.params[6], "Last page signed");
    assert.match(ins.sql, /'custom'/);

    const items = [line(), line({ id: OTHER_ITEM, client_id: OTHER_CLIENT, item_key: "custom_bbbb2222", title: "Other client lease" })];
    const retired = await post({ action: "retire_item", item_id: ITEM }, { w: world({ items }) });
    assert.equal(retired.res.statusCode, 200);
    assert.deepEqual(retired.res.body.result, { id: ITEM });
    assert.deepEqual(retired.database.find(/UPDATE document_vault_items/)[0].params, [ITEM, ORG, CLIENT, STAFF]);
    assert.equal(items[0].retired_by, STAFF, "the row stays and is marked retired");
    assert.equal(items[1].retired_at, null, "the other client's line is untouched");
    assert.ok(!JSON.stringify(retired.res.body.vault).includes("Other client lease"), "the fresh read shows this client's lines only");
    assert.equal(retired.database.find(/DELETE FROM document_vault_items/).length, 0);
  });

  test("a paper, a line or a waiver that is another client's is a 404 and nothing is written", async () => {
    const items = [line({ id: OTHER_ITEM, client_id: OTHER_CLIENT, item_key: "custom_bbbb2222" })];
    const paperOfOther = await post({ action: "accept", document_id: OTHER_DOC, item_key: "id_document" });
    assert.equal(paperOfOther.res.statusCode, 404);
    assert.equal(paperOfOther.res.body.error, "document_not_found");
    const lineOfOther = await post({ action: "retire_item", item_id: OTHER_ITEM }, { w: world({ items }) });
    assert.equal(lineOfOther.res.statusCode, 404);
    assert.equal(lineOfOther.res.body.error, "item_not_found");
    assert.equal(items[0].retired_at, null, "the other client's line is untouched");
    const waivers = [line({ id: "e3000000-0000-4000-8000-0000000000e3", kind: "waiver", item_key: "tax_returns_personal", client_id: OTHER_CLIENT })];
    const waiverOfOther = await post({ action: "unwaive", item_key: "tax_returns_personal" }, { w: world({ items: waivers }) });
    assert.equal(waiverOfOther.res.statusCode, 404);
    assert.equal(waiverOfOther.res.body.error, "item_not_found");
    assert.equal(waivers[0].retired_at, null, "the other client's waiver stays on");
    assert.equal(writes(paperOfOther.database).length, 0);
    assert.equal(paperOfOther.reviews.length, 0);
  });

  test("a client cannot rule on their own papers, and an unknown action is a 400", async () => {
    const w = world();
    const res = makeRes();
    await vaultHandler({ method: "POST", body: { action: "accept", document_id: DOC }, headers: {} }, res, {
      db: w.database, requirePrincipal: gateAs(clientPrincipal(CLIENT, ORG)), now: NOW, env: {}
    });
    assert.equal(res.statusCode, 403);
    assert.equal(writes(w.database).length, 0);
    const odd = await post({ action: "delete_everything" });
    assert.equal(odd.res.statusCode, 400);
    assert.equal(odd.res.body.error, "unknown_action");
  });

  test("only owner, admin, sales manager and closer may rule; any other staff role is a 403 before any lookup", async () => {
    const body = { action: "waive", item_key: "tax_returns_personal", reason: "Filed as a dependent" };
    for (const role of FINANCE_OS_ROLES) {
      const out = await post(body, { role });
      assert.equal(out.res.statusCode, 200, role);
      assert.deepEqual(out.items.map((i) => [i.org_id, i.client_id, i.item_key, i.kind]), [[ORG, CLIENT, "tax_returns_personal", "waiver"]], role);
    }
    for (const role of NOT_FINANCE_OS_ROLES) {
      const out = await post(body, { role });
      assert.equal(out.res.statusCode, 403, role);
      assert.equal(out.res.body.error, "forbidden", role);
      assert.match(out.res.body.message, /limited to/, role);
      assert.equal(out.database.calls.length, 0, `${role} is refused before the database is asked anything`);
      assert.equal(out.items.length, 0, role);
    }
  });

  // The client is in company B. Staff of company A name its id.
  test("staff of another company get a 404 on every action and nothing is written, at the door and in the vault logic alone", async () => {
    const actions = [
      { action: "accept", document_id: DOC, item_key: "id_document" },
      { action: "reject", document_id: DOC, reason: "Photo is cut off" },
      { action: "add_item", title: "Lease agreement" },
      { action: "retire_item", item_id: ITEM },
      { action: "waive", item_key: "tax_returns_personal", reason: "Filed as a dependent" },
      { action: "unwaive", item_key: "tax_returns_personal" }
    ];
    for (const body of actions) {
      const w = world({ clientOrg: OTHER_ORG, items: [line({ org_id: OTHER_ORG })] });
      const out = await post(body, { w });
      assert.equal(out.res.statusCode, 404, body.action);
      assert.equal(out.res.body.error, "not_found", body.action);
      assert.equal(writes(out.database).length, 0, body.action);
      assert.equal(out.database.find(/FROM documents|FROM document_vault/).length, 0, `${body.action} stopped before the vault tables were read`);

      const reached = [];
      const spy = async (...args) => { reached.push(args); return {}; };
      const doorOnly = await post(body, { w: world({ clientOrg: OTHER_ORG }), deps: {
        decideDocument: spy, addCustomItem: spy, retireItem: spy, waiveItem: spy, unwaiveItem: spy
      } });
      assert.equal(doorOnly.res.statusCode, 404, body.action);
      assert.equal(reached.length, 0, `${body.action}: the handler's own check stops it before the logic runs`);
    }

    const logic = {
      accept: (db) => decideDocument(db, { orgId: ORG, clientId: CLIENT, documentId: DOC, status: "accepted", itemKey: "id_document", staffId: STAFF }),
      reject: (db) => decideDocument(db, { orgId: ORG, clientId: CLIENT, documentId: DOC, status: "rejected", reason: "Cut off", staffId: STAFF }),
      add_item: (db) => addCustomItem(db, { orgId: ORG, clientId: CLIENT, title: "Lease agreement", staffId: STAFF }),
      retire_item: (db) => retireItem(db, { orgId: ORG, clientId: CLIENT, itemId: ITEM, staffId: STAFF }),
      waive: (db) => waiveItem(db, { orgId: ORG, clientId: CLIENT, itemKey: "tax_returns_personal", reason: "Filed as a dependent", staffId: STAFF }),
      unwaive: (db) => unwaiveItem(db, { orgId: ORG, clientId: CLIENT, itemKey: "tax_returns_personal", staffId: STAFF })
    };
    for (const [name, run] of Object.entries(logic)) {
      const w = world({ clientOrg: OTHER_ORG, items: [line({ org_id: OTHER_ORG })] });
      await assert.rejects(() => run(w.database), (e) => e instanceof VaultError && e.status === 404 && e.code === "not_found", name);
      assert.equal(writes(w.database).length, 0, name);
    }
  });
});
