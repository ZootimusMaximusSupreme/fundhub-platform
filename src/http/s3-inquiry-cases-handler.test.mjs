// Slice S3 proofs: the inquiry-removal case desk (/api/inquiry-cases) actions
// the older handler test does not run: create, update, generate, gate_override
// and clear_inquiry. Real handler and real case logic, stand-in database, and
// the bus is a recorder so no event leaves.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import handler from "../../api/inquiry-cases.mjs";
import { fakeDb, makeRes, req, staffSession, ORG_ID, OTHER_ORG_ID, STAFF_ID } from "../testing/handler-harness.mjs";
import { tableRules } from "../testing/s3-scoped-rows.mjs";

const CASE = "1e000000-0000-4000-8000-000000000001";
const CLIENT = "c1000000-0000-4000-8000-000000000001";
const ROUND = "f0000000-0000-4000-8000-000000000001";
const INQ = "1a000000-0000-4000-8000-000000000001";

async function call(body, rules, { role = "inquiry_specialist" } = {}) {
  const fake = fakeDb([staffSession({ role }), ...rules]);
  const res = makeRes();
  const events = [];
  const emit = async (_db, name, payload, opts) => { events.push({ name, payload, opts }); return { id: "ev-1", deduped: false }; };
  await handler(req("POST", { body }), res, { db: fake, emit });
  return { res, fake, events };
}

const caseRow = (over = {}) => ({
  id: CASE, case_id: "IRC-0101", org_id: ORG_ID, client_id: CLIENT, funding_round_id: ROUND,
  selected_bureaus_raw: "EX", case_status: "Queued", open_inquiry_count: 0, ...over
});
const ownsClient = [/SELECT 1 FROM clients WHERE id = \$1 AND org_id = \$2/, [{ "?column?": 1 }]];

describe("POST /api/inquiry-cases action=create", () => {
  test("opens a Queued case for this client and company, naming the staff member who asked", async () => {
    const { res, fake } = await call(
      { action: "create", client_id: CLIENT, selected_bureaus_raw: "EX", funding_round_id: ROUND, open_inquiry_count: 3 },
      [ownsClient, [/FROM inquiry_removal_cases\s+WHERE org_id = \$1::uuid\s+AND client_id = \$2::uuid/, []], [/INSERT INTO inquiry_removal_cases/, [caseRow({ open_inquiry_count: 3 })]]]
    );
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.case.id, CASE);
    assert.equal(res.body.case.open_inquiry_count, 3);
    const [ins] = fake.find(/INSERT INTO inquiry_removal_cases/);
    assert.equal(ins.params[0], ORG_ID);
    assert.equal(ins.params[1], CLIENT);
    assert.equal(ins.params[2], ROUND);
    assert.equal(ins.params[4], "Queued");
    assert.equal(ins.params[5], "EX");
    assert.equal(ins.params[10], "Olive Owner");
    assert.equal(ins.params[13], 3);
  });

  test("a second case for the same client and bureau adopts the open one instead of making a twin", async () => {
    const { res, fake } = await call(
      { action: "create", client_id: CLIENT, selected_bureaus_raw: "EX" },
      [ownsClient, [/FROM inquiry_removal_cases\s+WHERE org_id = \$1::uuid\s+AND client_id = \$2::uuid/, [caseRow({ funding_round_id: ROUND })]]]
    );
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.case.reused, true);
    assert.equal(res.body.case.id, CASE);
    assert.equal(fake.find(/INSERT INTO inquiry_removal_cases/).length, 0);
  });

  test("a client from another company is a 404 and no case is made", async () => {
    const { res, fake } = await call({ action: "create", client_id: CLIENT, selected_bureaus_raw: "EX" }, [[/SELECT 1 FROM clients/, []]]);
    assert.equal(res.statusCode, 404);
    assert.equal(fake.find(/INSERT INTO inquiry_removal_cases/).length, 0);
  });
});

describe("POST /api/inquiry-cases action=update", () => {
  test("changes only the fields sent, in this company, and ignores a status that is not real", async () => {
    const { res, fake } = await call(
      { action: "update", id: CASE, case_status: "Scheduled", assigned_remover: "Ruth", org_id: "0b000000-0000-4000-8000-000000000002" },
      [[/UPDATE inquiry_removal_cases\s+SET case_status = \$3::inquiry_case_status, assigned_remover = \$4/, [caseRow({ case_status: "Scheduled", assigned_remover: "Ruth" })]]]
    );
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.case.case_status, "Scheduled");
    assert.deepEqual(fake.find(/UPDATE inquiry_removal_cases/)[0].params, [ORG_ID, CASE, "Scheduled", "Ruth"]);

    const bogus = await call({ action: "update", id: CASE, case_status: "Vanished" }, [[/SELECT \* FROM inquiry_removal_cases WHERE org_id = \$1::uuid AND id = \$2::uuid/, [caseRow()]]]);
    assert.equal(bogus.res.statusCode, 200);
    assert.equal(bogus.fake.find(/UPDATE inquiry_removal_cases/).length, 0);
  });

  test("an id from another company is a 404", async () => {
    const { res } = await call({ action: "update", id: CASE, assigned_remover: "Ruth" }, [[/UPDATE inquiry_removal_cases/, []]]);
    assert.equal(res.statusCode, 404);
  });
});

describe("POST /api/inquiry-cases action=generate", () => {
  const caseLookup = (over) => [/SELECT \* FROM inquiry_removal_cases\s+WHERE id = \$1::uuid AND org_id = \$2::uuid/, [caseRow(over)]];
  const crs = (inquiries) => [/FROM crs_results\s+WHERE org_id = \$1::uuid AND client_id = \$2::uuid/, [{ id: "crs1", result: { inquiries }, created_at: "2026-10-01" }]];

  test("stages the latest credit file's Experian inquiries onto the case and recounts the open ones", async () => {
    const { res, fake } = await call({ action: "generate", id: CASE }, [
      caseLookup(),
      crs([{ creditorName: "Chase Bank", bureau: "EX", date: "2026-08-01" }, { creditorName: "Amex", bureau: "EX", date: "2026-09-02" }, { creditorName: "Citi", bureau: "TU", date: "2026-09-03" }]),
      [/FROM inquiry_log\s+WHERE org_id = \$1::uuid AND client_id = \$2::uuid/, []],
      [/INSERT INTO inquiry_log/, (_s, p) => [{ id: `inq-${p[6]}`, case_id: p[2] }]],
      [/UPDATE inquiry_log\s+SET case_id = NULL/, []],
      [/UPDATE inquiry_removal_cases c\s+SET open_inquiry_count/, [caseRow({ open_inquiry_count: 2 })]]
    ]);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.written, 2);
    assert.deepEqual(res.body.bureaus, ["EX"]);
    assert.equal(res.body.open_inquiry_count, 2);
    const inserts = fake.find(/INSERT INTO inquiry_log/);
    assert.deepEqual(inserts.map((i) => [i.params[0], i.params[1], i.params[2], i.params[4], i.params[5]]), [
      [ORG_ID, CLIENT, CASE, "EX", "Chase Bank"],
      [ORG_ID, CLIENT, CASE, "EX", "Amex"]
    ]);
  });

  test("no credit file, or a case that names no bureau, writes nothing and says why", async () => {
    const none = await call({ action: "generate", id: CASE }, [caseLookup(), [/FROM crs_results/, []]]);
    assert.equal(none.res.body.reason, "no_credit_file");
    assert.equal(none.fake.find(/INSERT INTO inquiry_log/).length, 0);
    const noBureau = await call({ action: "generate", id: CASE }, [caseLookup({ selected_bureaus_raw: null }), crs([{ creditorName: "Chase", bureau: "EX", date: "2026-08-01" }])]);
    assert.equal(noBureau.res.body.reason, "no_bureau_on_case");
    assert.equal(noBureau.fake.find(/INSERT INTO inquiry_log/).length, 0);
  });

  test("a case from another company is a 404", async () => {
    const { res } = await call({ action: "generate", id: CASE }, [[/SELECT \* FROM inquiry_removal_cases/, []]]);
    assert.equal(res.statusCode, 404);
    assert.equal(res.body.error, "not_found");
  });
});

describe("POST /api/inquiry-cases action=gate_override", () => {
  const update = [/UPDATE inquiry_removal_cases\s+SET gate_override_by = \$3::uuid/, [caseRow({ gate_override_by: STAFF_ID })]];

  test("the owner overrides the bureau gate on this company's case, stamped with who did it", async () => {
    const { res, fake } = await call({ action: "gate_override", id: CASE }, [update], { role: "owner" });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.case.gate_override_by, STAFF_ID);
    assert.deepEqual(fake.find(/UPDATE inquiry_removal_cases/)[0].params, [CASE, ORG_ID, STAFF_ID]);
  });

  test("anyone but the owner is refused and the gate is untouched", async () => {
    const { res, fake } = await call({ action: "gate_override", id: CASE }, [update], { role: "inquiry_specialist" });
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.error, "owner_required");
    assert.equal(fake.find(/UPDATE inquiry_removal_cases/).length, 0);
  });
});

describe("POST /api/inquiry-cases action=clear_inquiry", () => {
  const inquiryRow = { id: INQ, case_id: CASE, org_id: ORG_ID, status: "Open" };
  const rules = (openLeft) => [
    [/SELECT \* FROM inquiry_log WHERE id = \$1/, [inquiryRow]],
    [/UPDATE inquiry_log SET\s+status = 'Cleared'/, [{ ...inquiryRow, status: "Cleared", is_open: false }]],
    [/UPDATE inquiry_removal_cases c\s+SET open_inquiry_count/, [caseRow({ case_status: "In Progress", open_inquiry_count: openLeft })]],
    [/UPDATE inquiry_removal_cases SET\s+case_status = 'Completed'/, [caseRow({ case_status: "Completed", open_inquiry_count: 0 })]]
  ];

  test("clearing the last open inquiry completes the case and fires inquiry.removed once, keyed to the case", async () => {
    const { res, fake, events } = await call({ action: "clear_inquiry", inquiry_id: INQ }, rules(0));
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.case_cleared, true);
    assert.equal(res.body.case.case_status, "Completed");
    assert.equal(res.body.inquiry.status, "Cleared");
    assert.deepEqual(fake.find(/UPDATE inquiry_log SET\s+status = 'Cleared'/)[0].params, [INQ, STAFF_ID]);
    assert.equal(events.length, 1);
    assert.equal(events[0].name, "inquiry.removed");
    assert.equal(events[0].payload.source, "staff_clear_inquiry");
    assert.equal(events[0].opts.idempotencyKey, `inquiry.removed:case:${CASE}`);
    assert.equal(events[0].opts.clientId, CLIENT);
  });

  test("clearing one of several leaves the case open and fires nothing", async () => {
    const { res, events, fake } = await call({ action: "clear_inquiry", inquiry_id: INQ }, rules(2));
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.case_cleared, false);
    assert.equal(events.length, 0);
    assert.equal(fake.find(/SET\s+case_status = 'Completed'/).length, 0);
  });

  test("a missing inquiry id is a 400 and nothing is changed", async () => {
    const { res, fake } = await call({ action: "clear_inquiry" }, rules(0));
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, "inquiry_id_required");
    assert.equal(fake.find(/UPDATE inquiry_log/).length, 0);
  });
});

// The case sits in company B and company A's staff name its id. The stand-in table answers
// each statement by the id and company its SQL names, so each 404 is the product's own.
describe("another company's case", () => {
  const actions = [
    { action: "update", assigned_remover: "Ruth" },
    { action: "close" },
    { action: "mark_cleared" },
    { action: "generate" },
    { action: "gate_override" }
  ];
  for (const body of actions) {
    test(`${body.action} is a 404 and the case, its inquiries and the bus are untouched`, async () => {
      const cases = [caseRow({ org_id: OTHER_ORG_ID })];
      const touched = [];
      const set = (row, _params, sql) => { touched.push(sql.trim().split(/\s+/).slice(0, 2).join(" ")); row.case_status = "changed"; };
      const { res, fake, events } = await call({ ...body, id: CASE }, tableRules("inquiry_removal_cases", cases, { set }), { role: "owner" });
      assert.equal(res.statusCode, 404);
      assert.deepEqual(touched, []);
      assert.equal(cases[0].case_status, "Queued");
      assert.deepEqual(events, []);
      assert.equal(fake.find(/INSERT INTO|DELETE FROM/).length, 0);
    });
  }
});
