// Practice test (the real api/ handlers, a stand-in database, fake data) for the server half of the Lenders
// desk controls in batch 14: the six list filters and Apply filters (GET /api/read/lenders), Export CSV
// (the same door with format=csv) and the row Save button (POST /api/lenders, action save).
//
// The expected SQL parts, parameters and words are worked out in this file from the fake data. No database,
// no network. The stand-in database does not run the SQL: what is judged is which statement the handler
// sends and with which values, and who is let in. The browser half is fin-b14-lenders.test.mjs.

import assert from "node:assert/strict";
import test from "node:test";

import listHandler from "../../../../api/read/lenders.mjs";
import lendersHandler from "../../../../api/lenders.mjs";
import observationsHandler from "../../../../api/lender-observations.mjs";
import { fakeDb, makeRes, req, staffSession, ORG_ID, OTHER_ORG_ID, STAFF_ID } from "../../../testing/handler-harness.mjs";
import { STAFF_ROLES, rolesLetIn } from "./s1-proof-kit.mjs";

// Which batch rows this file is evidence for is written in fin-b14-rows.json ("also"), next to the browser file.
const proof = { async check(_row, run) { await run(); } };

const LENDER_ID = "bbbbbbbb-1111-4111-8111-111111111111";
const OBS_ID = "cccccccc-1111-4111-8111-111111111111";
const LENDER_ROW = {
  id: LENDER_ID, org_id: ORG_ID, lender_table: "OnlineBizCC", name: "Mesa Community Bank", bureaus_pulled: "EX",
  stated_requirements: null, priority_tier: 1, active: true, eligible_states: "AZ",
  last_updated_by: "Olive Owner", last_updated_date: "2026-10-14", is_demo: false,
};
const LENDER_PATH_ROLES = ["owner", "admin", "funding_advisor"];

async function call(handler, request, rules = [], role = "owner", over = {}) {
  const fake = fakeDb([staffSession({ role, ...over }), ...rules]);
  const res = makeRes();
  await handler(request, res, { db: fake });
  return { res, fake };
}

/** The one statement that reads the lender list. */
const listSql = (fake) => {
  const hits = fake.find(/FROM lenders\s+WHERE org_id = \$1::uuid/);
  assert.equal(hits.length, 1, "exactly one statement reads the lender list");
  return hits[0];
};

test("list filters: each one adds its own condition and its own value, and only that one", async () => {
  const cases = [
    { control: /^List filter: Product table select/, query: { lender_table: "BizLOC_Stated" }, where: /lender_table = \$2::lender_table/, params: [ORG_ID, "BizLOC_Stated", 5000, 0] },
    { control: /^List filter: Bureau pulled input/, query: { bureau: " TU " }, where: /bureaus_pulled ILIKE \$2/, params: [ORG_ID, "%TU%", 5000, 0] },
    { control: /^List filter: Priority tier select/, query: { priority_tier: "2" }, where: /priority_tier = \$2/, params: [ORG_ID, 2, 5000, 0] },
    { control: /^List filter: Status select/, query: { active: "false" }, where: /\bactive = \$2/, params: [ORG_ID, false, 5000, 0] },
    { control: /^List filter: Eligible state input/, query: { state: " AZ " }, where: /eligible_states ILIKE \$2 OR eligible_states IS NULL/, params: [ORG_ID, "%AZ%", 5000, 0] },
    { control: /^List filter: Name search input/, query: { q: " Mesa " }, where: /name ILIKE \$2 OR notes ILIKE \$2/, params: [ORG_ID, "%Mesa%", 5000, 0] },
  ];
  const allWheres = cases.map((c) => c.where);
  for (const one of cases) {
    await proof.check(one.control, async () => {
      const { res, fake } = await call(listHandler, req("GET", { query: one.query }), [[/FROM lenders\s+WHERE/, [LENDER_ROW]]]);
      assert.equal(res.statusCode, 200);
      const sent = listSql(fake);
      assert.match(sent.sql, one.where);
      for (const other of allWheres.filter((w) => w !== one.where)) assert.doesNotMatch(sent.sql, other, "no other filter is applied");
      assert.match(sent.sql, /COALESCE\(is_demo, false\) = false/, "sample lenders stay out of the list");
      assert.deepEqual(sent.params, one.params);
      assert.equal(res.body.ok, true);
      assert.equal(res.body.lenders.length, 1);
    });
  }
});

test("Apply filters: every box together is one read with every condition, in order", async () => {
  await proof.check("Apply filters button", async () => {
    const query = { lender_table: "PersonalCC", bureau: "EQ", priority_tier: "3", active: "true", state: "NV", q: "Desert" };
    const { res, fake } = await call(listHandler, req("GET", { query }), [[/FROM lenders\s+WHERE/, []]]);
    assert.equal(res.statusCode, 200);
    const sent = listSql(fake);
    assert.deepEqual(sent.params, [ORG_ID, "PersonalCC", 3, true, "%EQ%", "%NV%", "%Desert%", 5000, 0]);
    const order = ["lender_table = $2::lender_table", "priority_tier = $3", "active = $4", "bureaus_pulled ILIKE $5", "eligible_states ILIKE $6", "name ILIKE $7"];
    let at = -1;
    for (const part of order) {
      const next = sent.sql.indexOf(part);
      assert.ok(next > at, `${part} is there, after the one before it`);
      at = next;
    }
    assert.equal(res.body.meta.empty, true, "an empty answer says so");
    assert.deepEqual(res.body.meta.lender_tables, ["OnlineBizCC", "InBranchBizCC", "BizLOC_Stated", "BizLOC_Documented", "PersonalCC", "PersonalLoans", "PersonalLOC"]);
  });
});

test("a product table that is not one of the seven is dropped, never put in the SQL", async () => {
  const { fake } = await call(listHandler, req("GET", { query: { lender_table: "Robbery'; DROP TABLE lenders;--" } }), [[/FROM lenders\s+WHERE/, []]]);
  const sent = listSql(fake);
  assert.doesNotMatch(sent.sql, /lender_table = /);
  assert.deepEqual(sent.params, [ORG_ID, 5000, 0]);
});

test("the lender list is for owner, admin and funding advisor only, and always the caller's own company", async () => {
  const allowed = await rolesLetIn(async (role) => (await call(listHandler, req("GET"), [], role)).res.statusCode, STAFF_ROLES);
  assert.deepEqual(allowed, [...LENDER_PATH_ROLES].sort());
  const { res } = await call(listHandler, req("GET"), [], "owner", { org_id: null });
  assert.equal(res.statusCode, 403);
  const { fake } = await call(listHandler, req("GET", { query: { q: "x" } }), [], "funding_advisor", { org_id: OTHER_ORG_ID });
  assert.equal(listSql(fake).params[0], OTHER_ORG_ID, "the company comes from the session");
});

test("Export CSV: the same filters, a csv file named lenders.csv, and no sample lenders", async () => {
  await proof.check(/^Export CSV button/, async () => {
    const { res, fake } = await call(
      listHandler,
      req("GET", { query: { format: "csv", priority_tier: "2", q: "Mesa" } }),
      [[/FROM lenders\s+WHERE/, [LENDER_ROW, { ...LENDER_ROW, id: "bbbbbbbb-2222-4222-8222-222222222222", name: 'Desert "First" Bank, N.A.', priority_tier: 2 }]]],
    );
    assert.equal(res.statusCode, 200);
    assert.match(String(res.headers["content-type"]), /^text\/csv/);
    assert.equal(res.headers["content-disposition"], 'attachment; filename="lenders.csv"');
    const lines = String(res.body).split("\n");
    assert.equal(lines[0].split(",")[0], "lender_table");
    assert.equal(lines[0].split(",")[1], "name");
    assert.match(lines[1], /^OnlineBizCC,Mesa Community Bank,/);
    assert.match(lines[2], /^OnlineBizCC,"Desert ""First"" Bank, N\.A\.",/, "a name with a comma and quotes is quoted");
    const sent = listSql(fake);
    assert.match(sent.sql, /priority_tier = \$2/);
    assert.match(sent.sql, /name ILIKE \$3 OR notes ILIKE \$3/);
    assert.deepEqual(sent.params, [ORG_ID, 2, "%Mesa%", 5000, 0]);
    assert.match(sent.sql, /COALESCE\(is_demo, false\) = false/, "an export never carries a sample lender");
    assert.equal(fake.find(/demo_mode_enabled/).length, 0, "the demo switch is not even asked for an export");
  });
});

// ── POST /api/lenders: Save ──────────────────────────────────────────────────────────────────────────

const SAVE_PATCH = {
  name: "Mesa Community Bank 2", lender_table: "PersonalCC", bureaus_pulled: "EX/TU", stated_requirements: null,
  priority_tier: 3, active: false, eligible_states: "AZ, NV",
};
const updateRule = [/UPDATE lenders SET/, [{ ...LENDER_ROW, ...SAVE_PATCH }]];

test("Save: updates only the seven typed fields of that one lender, stamps who and when, in the caller's company", async () => {
  await proof.check(/^Lender row Save button/, async () => {
    const { res, fake } = await call(
      lendersHandler,
      req("POST", { body: { action: "save", id: LENDER_ID, patch: { ...SAVE_PATCH, org_id: OTHER_ORG_ID, id: "cccccccc-9999-4999-8999-999999999999", created_at: "2000-01-01" } } }),
      [updateRule],
    );
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.lender.name, "Mesa Community Bank 2");
    const update = fake.find(/UPDATE lenders SET/);
    assert.equal(update.length, 1);
    const sets = /SET (.*)\n\s+WHERE/s.exec(update[0].sql)[1].split(",").map((s) => s.trim().split(" = ")[0]);
    assert.deepEqual(sets, ["name", "lender_table", "bureaus_pulled", "stated_requirements", "priority_tier", "active", "eligible_states", "last_updated_by", "last_updated_date"],
      "the seven typed fields and the two stamps; the id, org_id and created_at it was handed are not written");
    assert.match(update[0].sql, /WHERE org_id = \$1::uuid AND id = \$2::uuid/);
    assert.deepEqual(update[0].params.slice(0, 9), [ORG_ID, LENDER_ID, "Mesa Community Bank 2", "PersonalCC", "EX/TU", null, 3, false, "AZ, NV"]);
    assert.equal(update[0].params[9], "Olive Owner", "who saved it");
    assert.match(update[0].params[10], /^\d{4}-\d{2}-\d{2}$/, "and the day");
    assert.equal(update[0].params.includes(OTHER_ORG_ID), false);
  });
});

test("Save: text numbers and flags are made real, a blank name is refused in words, a missing or unchanged row says so", async () => {
  const coerced = await call(lendersHandler, req("POST", { body: { action: "save", id: LENDER_ID, patch: { priority_tier: "2", active: "true" } } }), [updateRule]);
  const update = coerced.fake.find(/UPDATE lenders SET/)[0];
  assert.deepEqual(update.params.slice(0, 4), [ORG_ID, LENDER_ID, 2, true], "the text 2 became the number 2 and the text true became true");

  const blank = await call(lendersHandler, req("POST", { body: { action: "save", id: LENDER_ID, patch: { name: "   " } } }), [updateRule]);
  assert.equal(blank.res.statusCode, 400);
  assert.equal(blank.res.body.error, "name_required");
  assert.equal(blank.res.body.message, "Name is required.");
  assert.equal(blank.fake.find(/UPDATE lenders/).length, 0);

  const noId = await call(lendersHandler, req("POST", { body: { action: "save", patch: { name: "x" } } }), []);
  assert.equal(noId.res.statusCode, 400);
  assert.equal(noId.res.body.error, "id_required");

  const gone = await call(lendersHandler, req("POST", { body: { action: "save", id: LENDER_ID, patch: { name: "x" } } }), []);
  assert.equal(gone.res.statusCode, 404);
  assert.equal(gone.res.body.error, "not_found");

  // The row is there but the update changed nothing: never ok with a null lender.
  const unchanged = await call(lendersHandler, req("POST", { body: { action: "save", id: LENDER_ID, patch: { name: "x" } } }), [[/UPDATE lenders SET/, []], [/FROM lenders WHERE org_id = \$1::uuid AND id = \$2::uuid/, [LENDER_ROW]]]);
  assert.equal(unchanged.res.statusCode, 409);
  assert.equal(unchanged.res.body.error, "save_failed");
});

test("KNOWN BREAK (the reason the row Save button is left out, fin-b14-not-attachable.mjs): the page's emptied Name is null, and null passes the blank-name check", async () => {
  // The page builds its patch with `patch[k] = v === "" ? null : v`, so a cleared Name box arrives as null. The
  // handler refuses a blank name with String(patch.name).trim() === "", and String(null) is "null".
  const { res, fake } = await call(lendersHandler, req("POST", { body: { action: "save", id: LENDER_ID, patch: { name: null } } }), [updateRule]);
  assert.equal(res.statusCode, 200, "BREAK: it is not refused with Name is required.");
  const update = fake.find(/UPDATE lenders SET/)[0];
  assert.equal(update.params[2], null, "BREAK: the statement goes to the database with a null name, which the NOT NULL column refuses");
});

test("Save, Add blank row and Import now are for owner, admin and funding advisor only", async () => {
  const bodies = [
    { action: "save", id: LENDER_ID, patch: { name: "x" } },
    { action: "create", lender_table: "OnlineBizCC", name: "x" },
    { action: "import", csv: "lender_table,name\nOnlineBizCC,x" },
  ];
  for (const body of bodies) {
    const allowed = await rolesLetIn(async (role) => (await call(lendersHandler, req("POST", { body }), [updateRule], role)).res.statusCode, STAFF_ROLES);
    assert.deepEqual(allowed, [...LENDER_PATH_ROLES].sort(), `${body.action}: who gets in`);
  }
  const closer = await call(lendersHandler, req("POST", { body: bodies[0] }), [updateRule], "closer");
  assert.equal(closer.fake.find(/UPDATE lenders|INSERT INTO lenders/).length, 0, "a refused role never reaches the table");
  const signedOut = makeRes();
  await lendersHandler({ method: "POST", body: bodies[0], query: {}, headers: {} }, signedOut, { db: fakeDb([]) });
  assert.equal(signedOut.statusCode, 401);
});

test("Add blank row and Import now: one stamped insert per lender, tips and bad rows skipped with the reason", async () => {
  const created = await call(
    lendersHandler,
    req("POST", { body: { action: "create", lender_table: "OnlineBizCC", name: "  Mesa Community Bank  ", active: true } }),
    [[/INSERT INTO lenders/, [LENDER_ROW]]],
  );
  assert.equal(created.res.statusCode, 200);
  const insert = created.fake.find(/INSERT INTO lenders/)[0];
  assert.match(insert.sql, /INSERT INTO lenders \(org_id, lender_table, name, last_updated_by, last_updated_date, active\)/);
  assert.deepEqual([insert.params[0], insert.params[1], insert.params[2], insert.params[3], insert.params[5]], [ORG_ID, "OnlineBizCC", "Mesa Community Bank", "Olive Owner", true]);

  const noTable = await call(lendersHandler, req("POST", { body: { action: "create", lender_table: "Nope", name: "x" } }), []);
  assert.equal(noTable.res.statusCode, 400);
  assert.equal(noTable.res.body.error, "invalid_lender_table");
  const noName = await call(lendersHandler, req("POST", { body: { action: "create", lender_table: "OnlineBizCC", name: "  " } }), []);
  assert.equal(noName.res.statusCode, 400);
  assert.equal(noName.res.body.error, "name_required");

  const csv = [
    "lender_table,name,priority_tier,external_row_id",
    "OnlineBizCC,Mesa Community Bank,2,rec-1",
    "PersonalCC,Desert First Bank,3,rec-2",
    "PersonalCC,Apply in branch for the best offer,1,rec-3",
    "Nowhere,Ghost Bank,1,rec-4",
  ].join("\n");
  const imported = await call(lendersHandler, req("POST", { body: { action: "import", csv } }), [
    [/SELECT id FROM lenders\s+WHERE org_id = \$1::uuid AND external_row_id = \$2/, (sql, params) => (params[1] === "rec-2" ? [{ id: LENDER_ID }] : [])],
    [/UPDATE lenders SET/, [LENDER_ROW]],
    [/INSERT INTO lenders/, [LENDER_ROW]],
  ]);
  assert.equal(imported.res.statusCode, 200);
  assert.equal(imported.res.body.imported, 1, "Mesa is new");
  assert.equal(imported.res.body.updated, 1, "Desert First is matched by its row id and updated");
  assert.equal(imported.res.body.skipped_tips, 1);
  assert.equal(imported.res.body.parsed, 3, "three rows were read: two banks and the tip; the bad table was dropped on read");
  assert.ok(imported.res.body.errors.some((e) => /invalid lender_table "Nowhere"/.test(e)));
  assert.equal(imported.fake.find(/INSERT INTO lenders/).length, 1);
  assert.equal(imported.fake.find(/INSERT INTO lenders/)[0].params[2], "Mesa Community Bank");

  const empty = await call(lendersHandler, req("POST", { body: { action: "import", csv: "   " } }), []);
  assert.equal(empty.res.statusCode, 400);
  assert.equal(empty.res.body.error, "csv_required");
});

test("Mismatch Confirm, Corrected and Dismiss: only a real review word is written, to the caller's own company's row", async () => {
  const row = { id: OBS_ID, org_id: ORG_ID, review_status: "confirmed", mismatch_flag: true };
  for (const status of ["confirmed", "corrected", "dismissed"]) {
    const { res, fake } = await call(observationsHandler, req("POST", { body: { action: "review", id: OBS_ID, review_status: status } }), [[/UPDATE lender_bureau_observations/, [{ ...row, review_status: status }]]]);
    assert.equal(res.statusCode, 200);
    const update = fake.find(/UPDATE lender_bureau_observations/)[0];
    assert.match(update.sql, /WHERE org_id = \$1::uuid AND id = \$2::uuid/);
    assert.deepEqual(update.params.slice(0, 3), [ORG_ID, OBS_ID, status]);
    assert.equal(update.params[3], "Olive Owner", "the reviewer's name goes on when nobody's was there");
    assert.match(update.sql, /created_by = COALESCE\(created_by, \$4\)/);
    assert.match(update.sql, /SET review_status = \$3::lender_observation_review_status/, "the word that was sent is the word that is written");
    assert.equal(res.body.observation.review_status, status);
  }
  const bad = await call(observationsHandler, req("POST", { body: { action: "review", id: OBS_ID, review_status: "approved" } }), []);
  assert.equal(bad.res.statusCode, 400);
  assert.equal(bad.res.body.error, "invalid_review_status");
  assert.equal(bad.fake.find(/UPDATE lender_bureau_observations/).length, 0);
  const missing = await call(observationsHandler, req("POST", { body: { action: "review", id: OBS_ID, review_status: "confirmed" } }), []);
  assert.equal(missing.res.statusCode, 404);
  const allowed = await rolesLetIn(async (role) => (await call(observationsHandler, req("POST", { body: { action: "review", id: OBS_ID, review_status: "confirmed" } }), [], role)).res.statusCode, STAFF_ROLES);
  assert.deepEqual(allowed, [...LENDER_PATH_ROLES].sort());
  assert.ok(STAFF_ID);
});

