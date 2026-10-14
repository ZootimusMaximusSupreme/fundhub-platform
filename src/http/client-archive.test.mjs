// POST /api/dashboard/client-archive — soft-archive (owner-set delete).
//
// Behavioural: stubs db.query so the real handler, session gate, role gate,
// and org scope all run. Lives under src/http/ so npm test collects it.
import { test, describe, before, after } from "node:test";
import assert from "node:assert";
import { db } from "../db.mjs";
import archiveHandler from "../../api/dashboard/client-archive.mjs";
import { assertBind } from "../testing/s3-scoped-rows.mjs";

const TOKEN = "test-session-token";
const CLIENT_ID = "11111111-2222-3333-4444-555555555555";
const OTHER_CLIENT = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const ORG = "org-1";
const OTHER_ORG = "org-2";

const res = () => {
  const r = { code: null, body: null, headers: {} };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.setHeader = (k, v) => { r.headers[String(k).toLowerCase()] = v; return r; };
  return r;
};

const post = (body = {}) => ({
  method: "POST",
  headers: { authorization: `Bearer ${TOKEN}` },
  body
});

let realQuery;
let currentRole = "closer";
let currentOrg = ORG;
/** client_id values that belong to currentOrg */
let ownedIds = new Set([CLIENT_ID]);
let deletedCards = [];
let archived = [];

async function stubQuery(sql, params = []) {
  assertBind(sql, params);
  const text = String(sql).replace(/\s+/g, " ").trim();

  if (/FROM live JOIN staff/.test(text)) {
    return {
      rows: [{
        session_id: "session-1",
        expires_at: new Date(Date.now() + 3600_000),
        staff_id: "staff-1",
        org_id: currentOrg,
        role: currentRole,
        email: "staff@example.com",
        name: "Test Staff",
        status: "active",
        active_flag: null
      }]
    };
  }

  // requireClientInOrg
  if (/SELECT 1 FROM clients WHERE id = \$1 AND org_id = \$2/.test(text)) {
    const [id, org] = params;
    if (org === currentOrg && ownedIds.has(id)) return { rows: [{}] };
    return { rows: [] };
  }

  if (text === "BEGIN" || text === "COMMIT" || text === "ROLLBACK") {
    return { rows: [] };
  }

  if (/DELETE FROM cards WHERE client_id/.test(text)) {
    deletedCards.push({ client_id: params[0], org_id: params[1] });
    return { rows: [], rowCount: 2 };
  }

  if (/UPDATE clients/.test(text) && /custom_fields/.test(text)) {
    const [id, org, payload] = params;
    if (org !== currentOrg || !ownedIds.has(id)) return { rows: [] };
    const parsed = typeof payload === "string" ? JSON.parse(payload) : payload;
    archived.push({ client_id: id, org_id: org, stamp: parsed });
    return { rows: [{ id }] };
  }

  return { rows: [] };
}

describe("POST /api/dashboard/client-archive", () => {
  before(() => {
    realQuery = db.query;
    db.query = stubQuery;
  });
  after(() => {
    db.query = realQuery;
  });

  test("refuses confirm that is not exactly DELETE", async () => {
    currentRole = "closer";
    currentOrg = ORG;
    ownedIds = new Set([CLIENT_ID]);
    deletedCards = [];
    archived = [];

    for (const confirm of [true, "delete", "Delete", "REMOVE", "", null, undefined]) {
      const r = res();
      await archiveHandler(post({ client_id: CLIENT_ID, confirm }), r);
      assert.equal(r.code, 400, `confirm=${JSON.stringify(confirm)} should 400, got ${r.code}`);
      assert.equal(r.body.error, "confirm_required");
    }
    assert.equal(deletedCards.length, 0, "wrong confirm must not delete cards");
    assert.equal(archived.length, 0, "wrong confirm must not stamp archive");
  });

  test("scopes by org — other company's client is 404, no writes", async () => {
    currentRole = "closer";
    currentOrg = ORG;
    ownedIds = new Set([CLIENT_ID]); // OTHER_CLIENT not owned
    deletedCards = [];
    archived = [];

    const r = res();
    await archiveHandler(post({ client_id: OTHER_CLIENT, confirm: "DELETE" }), r);
    assert.equal(r.code, 404);
    assert.equal(r.body.error, "not_found");
    assert.equal(deletedCards.length, 0);
    assert.equal(archived.length, 0);
  });

  test("archives: removes cards and stamps crm_archived_at for own org", async () => {
    currentRole = "closer";
    currentOrg = ORG;
    ownedIds = new Set([CLIENT_ID]);
    deletedCards = [];
    archived = [];

    const r = res();
    await archiveHandler(post({ client_id: CLIENT_ID, confirm: "DELETE" }), r);
    assert.equal(r.code, 200, JSON.stringify(r.body));
    assert.equal(r.body.ok, true);
    assert.equal(r.body.archived, true);
    assert.equal(r.body.client_id, CLIENT_ID);
    assert.equal(r.body.cards_removed, 2);
    assert.ok(r.body.crm_archived_at, "response should echo crm_archived_at");

    assert.equal(deletedCards.length, 1);
    assert.equal(deletedCards[0].client_id, CLIENT_ID);
    assert.equal(deletedCards[0].org_id, ORG);

    assert.equal(archived.length, 1);
    assert.equal(archived[0].client_id, CLIENT_ID);
    assert.equal(archived[0].org_id, ORG);
    assert.ok(archived[0].stamp.crm_archived_at);
  });

  test("partner role is refused", async () => {
    currentRole = "partner";
    currentOrg = ORG;
    deletedCards = [];
    archived = [];

    const r = res();
    await archiveHandler(post({ client_id: CLIENT_ID, confirm: "DELETE" }), r);
    assert.equal(r.code, 403);
    assert.equal(r.body.error, "forbidden");
    assert.equal(deletedCards.length, 0);
    assert.equal(archived.length, 0);
  });

  test("session with a different org cannot archive via stolen id", async () => {
    currentRole = "closer";
    currentOrg = OTHER_ORG;
    ownedIds = new Set(); // nothing in OTHER_ORG
    deletedCards = [];
    archived = [];

    const r = res();
    await archiveHandler(post({ client_id: CLIENT_ID, confirm: "DELETE" }), r);
    assert.equal(r.code, 404);
    assert.equal(deletedCards.length, 0);
    assert.equal(archived.length, 0);
  });
});
