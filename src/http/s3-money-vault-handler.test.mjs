// Slice S3 proof: POST /api/money/vault. Staff rule on a client's uploaded
// papers. The real handler and the real vault logic run; only the database is
// a stand-in that answers each statement by its text.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import vaultHandler from "../../api/money/vault.mjs";
import { makeRes, fakeDb } from "../testing/handler-harness.mjs";
import { gateAs, clientPrincipal, staffPrincipal } from "../testing/s3-mem-tasks-db.mjs";

const ORG = "0a000000-0000-4000-8000-000000000001";
const CLIENT = "c1000000-0000-4000-8000-000000000001";
const STAFF = "5aff0000-0000-4000-8000-000000000001";
const DOC = "d1000000-0000-4000-8000-0000000000d1";
const ITEM = "e1000000-0000-4000-8000-0000000000e1";
const NOW = () => new Date("2026-10-13T15:00:00Z");

const upload = { id: DOC, kind: "client_upload", subtype: "id_document", title: "Photo ID", mime_type: "image/png", generated_at: "2026-10-12T10:00:00Z", expires_at: null, current_version_id: null, metadata: {} };

function vaultDb({ documents = [upload], extra = [] } = {}) {
  return fakeDb([
    ...extra,
    [/SELECT 1 FROM clients WHERE id = \$1 AND org_id = \$2/, [{ "?column?": 1 }]],
    [/SELECT id, first_name, last_name FROM clients/, [{ id: CLIENT, first_name: "Dana", last_name: "Whitfield" }]],
    [/FROM documents\s+WHERE org_id = \$1 AND client_id = \$2/, documents]
  ]);
}

async function post(body, { role = "owner", database = vaultDb() } = {}) {
  const res = makeRes();
  await vaultHandler({ method: "POST", body: { client_id: CLIENT, ...body }, headers: { host: "app.example" } }, res, {
    db: database, requirePrincipal: gateAs(staffPrincipal(role, ORG, STAFF)), now: NOW, env: {}
  });
  return { res, database };
}

describe("POST /api/money/vault", () => {
  test("accept files the paper under its line with the units and date a person typed, stamped with the staff id", async () => {
    const database = vaultDb({ extra: [[/INSERT INTO document_vault_reviews/, [{ id: "r1", status: "accepted" }]]] });
    const { res } = await post({ action: "accept", document_id: DOC, covers: 1, period_end: "2026-10-01" }, { database });
    assert.equal(res.statusCode, 200);
    assert.deepEqual([res.body.ok, res.body.action], [true, "accept"]);
    assert.deepEqual(res.body.result, { id: "r1", status: "accepted", lines: ["id_document:client"] });
    const [write] = database.find(/INSERT INTO document_vault_reviews/);
    assert.deepEqual(write.params, [ORG, CLIENT, DOC, "accepted", null, null, 1, "2026-10-01", null, STAFF]);
  });

  test("reject needs a reason, and the reason is what the client reads as what to fix", async () => {
    const database = vaultDb({ extra: [[/INSERT INTO document_vault_reviews/, [{ id: "r2", status: "rejected" }]]] });
    const { res } = await post({ action: "reject", document_id: DOC, reason: "  Photo is   cut off " }, { database });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.result.status, "rejected");
    const [write] = database.find(/INSERT INTO document_vault_reviews/);
    assert.equal(write.params[3], "rejected");
    assert.equal(write.params[8], "Photo is cut off");
    const bare = vaultDb({ extra: [[/INSERT INTO document_vault_reviews/, [{ id: "r3", status: "rejected" }]]] });
    const refused = await post({ action: "reject", document_id: DOC }, { database: bare });
    assert.equal(refused.res.statusCode, 400);
    assert.equal(bare.find(/INSERT INTO document_vault_reviews/).length, 0);
  });

  test("waive says a standard line does not apply (reason required); unwaive puts it back", async () => {
    const database = vaultDb({ extra: [[/INSERT INTO document_vault_items/, [{ id: "w1" }]]] });
    const { res } = await post({ action: "waive", item_key: "tax_returns_personal", reason: "Filed as a dependent" }, { database });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.result, { id: "w1", created: true });
    assert.deepEqual(database.find(/INSERT INTO document_vault_items/)[0].params, [ORG, CLIENT, null, "tax_returns_personal", "Filed as a dependent", STAFF]);
    assert.match(database.find(/INSERT INTO document_vault_items/)[0].sql, /'waiver'/);

    const noReason = await post({ action: "waive", item_key: "tax_returns_personal" });
    assert.equal(noReason.res.statusCode, 400);

    const back = vaultDb({ extra: [[/UPDATE document_vault_items\s+SET retired_at = now\(\)/, [{ id: "w1" }]]] });
    const unwaived = await post({ action: "unwaive", item_key: "tax_returns_personal" }, { database: back });
    assert.equal(unwaived.res.statusCode, 200);
    assert.deepEqual(back.find(/UPDATE document_vault_items/)[0].params, [ORG, CLIENT, "tax_returns_personal", null, STAFF]);
  });

  test("add_item adds a custom line to this client; retire_item takes it off but keeps the row", async () => {
    const database = vaultDb({ extra: [[/INSERT INTO document_vault_items/, []]] });
    const added = await post({ action: "add_item", title: "Lease agreement", note: "Last page signed", need: 1 }, { database });
    assert.equal(added.res.statusCode, 200);
    assert.match(added.res.body.result.item_key, /^custom_[0-9a-f]{8}$/);
    const [ins] = database.find(/INSERT INTO document_vault_items/);
    assert.equal(ins.params[1], ORG);
    assert.equal(ins.params[2], CLIENT);
    assert.equal(ins.params[5], "Lease agreement");
    assert.equal(ins.params[6], "Last page signed");
    assert.match(ins.sql, /'custom'/);

    const retire = vaultDb({ extra: [[/UPDATE document_vault_items\s+SET retired_at = now\(\),\s+retired_by_staff_id/, [{ id: ITEM }]]] });
    const retired = await post({ action: "retire_item", item_id: ITEM }, { database: retire });
    assert.equal(retired.res.statusCode, 200);
    assert.deepEqual(retired.res.body.result, { id: ITEM });
    assert.deepEqual(retire.find(/UPDATE document_vault_items/)[0].params, [ITEM, ORG, CLIENT, STAFF]);
    assert.equal(retire.find(/DELETE FROM document_vault_items/).length, 0);
  });

  test("a client cannot rule on their own papers, and an unknown action is a 400", async () => {
    const res = makeRes();
    const database = vaultDb();
    await vaultHandler({ method: "POST", body: { action: "accept", document_id: DOC }, headers: {} }, res, {
      db: database, requirePrincipal: gateAs(clientPrincipal(CLIENT, ORG)), now: NOW, env: {}
    });
    assert.equal(res.statusCode, 403);
    assert.equal(database.find(/INSERT INTO document_vault_reviews/).length, 0);
    const odd = await post({ action: "delete_everything" });
    assert.equal(odd.res.statusCode, 400);
    assert.equal(odd.res.body.error, "unknown_action");
  });
});
