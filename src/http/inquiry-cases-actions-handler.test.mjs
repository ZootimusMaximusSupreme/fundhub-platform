// POST /api/inquiry-cases — send, mark_cleared and close, run with no Postgres.
//
// inquiry-cases.pg.test.mjs runs clear_inquiry on a real database. The three
// buttons a specialist presses most were never run in a test:
//   - Send (mail the bureau letter, or record the Experian portal upload)
//   - Mark cleared (the case is Completed, and inquiry.removed must fire so
//     funding can resume)
//   - Close (the case is Canceled, and inquiry.removed must NOT fire)
// The network is refused for the whole file; no letter can leave from here.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

import handler from "../../api/inquiry-cases.mjs";
import { ROUTES } from "../../netlify/functions/api.mjs";
import { makeRes, req, staffSession, ORG_ID, STAFF_ID } from "../testing/handler-harness.mjs";
import { strictFakeDb as fakeDb } from "../testing/s3-handler-call.mjs";
import { assertSqlHas } from "../testing/s3-scoped-rows.mjs";

const CASE = "1e000000-0000-4000-8000-000000000001";
const CLIENT = "c1000000-0000-4000-8000-000000000001";
const ROUND = "f0000000-0000-4000-8000-000000000001";
const INQ = "1a000000-0000-4000-8000-000000000001";

const netCalls = [];
const realFetch = globalThis.fetch;
before(() => { globalThis.fetch = async (u) => { netCalls.push(String(u)); throw new Error("network refused in this test"); }; });
after(() => { globalThis.fetch = realFetch; });

function emitter() {
  const events = [];
  return { events, emit: async (_db, name, payload, opts) => { events.push({ name, payload, opts }); return { id: "ev-1", deduped: false }; } };
}

async function call(body, rules, { role = "inquiry_specialist" } = {}) {
  const fake = fakeDb([staffSession({ role }), ...rules]);
  const res = makeRes();
  const em = emitter();
  await handler(req("POST", { body }), res, { db: fake, emit: em.emit, store: { put: async () => null, get: async () => null } });
  return { res, fake, events: em.events };
}

const caseRow = (over = {}) => ({
  id: CASE, case_id: "IRC-0101", org_id: ORG_ID, client_id: CLIENT, funding_round_id: ROUND,
  selected_bureaus_raw: "EX", case_status: "Queued", ...over
});
const closeAnswer = (status) => [/UPDATE inquiry_removal_cases\s+SET case_status = \$3::inquiry_case_status/, (_s, p) => (
  p[1] === CASE ? [caseRow({ case_status: status })] : []
)];
const caseLookup = (over) => [/SELECT \* FROM inquiry_removal_cases\s+WHERE id = \$1::uuid AND org_id = \$2::uuid/, [caseRow(over)]];
const fullPacket = [
  [/FROM documents\s+WHERE org_id = \$1::uuid\s+AND client_id = \$2::uuid/, [
    { id: "d1", kind: "client_upload", subtype: "id_document" },
    { id: "d2", kind: "client_upload", subtype: "proof_of_address" }
  ]],
  [/FROM client_consents/, [{ client_id: CLIENT }]]
];
const shortPacket = [
  [/FROM documents\s+WHERE org_id = \$1::uuid\s+AND client_id = \$2::uuid/, [{ id: "d1", kind: "client_upload", subtype: "id_document" }]],
  [/FROM client_consents/, []]
];
const openInquiry = [
  [/SELECT id FROM inquiry_log/, [{ id: INQ }]],
  [/SELECT id, org_id FROM inquiry_log WHERE id = \$1 AND org_id = \$2 FOR UPDATE/, [{ id: INQ, org_id: ORG_ID }]],
  [/UPDATE inquiry_log\s+SET call_attempts/, [{ id: INQ, org_id: ORG_ID }]]
];

describe("POST /api/inquiry-cases — mark_cleared and close", () => {
  test("is routed", () => {
    assert.equal(ROUTES["inquiry-cases"], handler);
  });

  test("a client-facing role outside staff cannot touch a case (no session: 401)", async () => {
    const fake = fakeDb([]);
    const res = makeRes();
    await handler(req("POST", { body: { action: "mark_cleared", id: CASE } }), res, { db: fake, emit: emitter().emit });
    assert.equal(res.statusCode, 401);
    assert.equal(fake.find(/inquiry_removal_cases/).length, 0);
  });

  test("an unknown action is refused before anything is read", async () => {
    const { res, fake } = await call({ action: "delete", id: CASE }, []);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, "unknown_action");
    assert.equal(fake.find(/inquiry_removal_cases/).length, 0);
  });

  test("Mark cleared: the case is Completed in this company, and inquiry.removed fires once, keyed to the case", async () => {
    const { res, fake, events } = await call(
      { action: "mark_cleared", id: CASE, case_status: "Canceled", notes: "EX removed it" },
      [closeAnswer("Completed")]
    );
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.case.case_status, "Completed");
    const [upd] = fake.find(/UPDATE inquiry_removal_cases/);
    // mark_cleared always means Completed, whatever case_status the body sent
    assert.deepEqual(upd.params.slice(0, 3), [ORG_ID, CASE, "Completed"]);
    assert.equal(upd.params[3], "EX removed it");
    assertSqlHas(upd.sql, {
      "closed once, whatever the status": "closed_at = COALESCE(closed_at, now())",
      "the completed stamp only when it is Completed": "completed_at = CASE WHEN $3::text = 'Completed' THEN COALESCE(completed_at, now()) ELSE completed_at END"
    });
    assert.equal(events.length, 1);
    assert.equal(events[0].name, "inquiry.removed");
    assert.equal(events[0].payload.fundingRoundId, ROUND);
    assert.equal(events[0].opts.orgId, ORG_ID);
    assert.equal(events[0].opts.clientId, CLIENT);
    assert.equal(events[0].opts.idempotencyKey, `inquiry.removed:case:${CASE}`);
  });

  test("Close: the case is Canceled and inquiry.removed does NOT fire (funding must not resume on a cancel)", async () => {
    const { res, fake, events } = await call(
      { action: "close", id: CASE, case_status: "Canceled" },
      [closeAnswer("Canceled")]
    );
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.event, null);
    assert.equal(fake.find(/UPDATE inquiry_removal_cases/)[0].params[2], "Canceled");
    assert.equal(events.length, 0);
  });

  test("Close with a made-up status: 400, nothing changes", async () => {
    const { res, fake, events } = await call({ action: "close", id: CASE, case_status: "Vanished" }, [closeAnswer("Completed")]);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, "invalid_case_status");
    assert.equal(fake.find(/UPDATE inquiry_removal_cases/).length, 0);
    assert.equal(events.length, 0);
  });

  test("a case from another company (or no such case): 404 and no event", async () => {
    const { res, events } = await call({ action: "mark_cleared", id: "1e000000-0000-4000-8000-0000000000ff" }, [closeAnswer("Completed")]);
    assert.equal(res.statusCode, 404);
    assert.equal(events.length, 0);
  });

  test("a bad case id: 400 before anything is written", async () => {
    const { res, fake } = await call({ action: "mark_cleared", id: "IRC-0101" }, []);
    assert.equal(res.statusCode, 400);
    assert.equal(fake.find(/UPDATE inquiry_removal_cases/).length, 0);
  });
});

describe("POST /api/inquiry-cases — send", () => {
  test("no delivery picked: 400 no_channel, nothing read", async () => {
    const { res, fake } = await call({ action: "send", id: CASE }, []);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, "no_channel");
    assert.equal(fake.find(/inquiry_removal_cases/).length, 0);
  });

  test("no such case in this company: 404", async () => {
    const { res } = await call({ action: "send", id: CASE, portal: true, portal_confirmation: "EXP-1" }, []);
    assert.equal(res.statusCode, 404);
    assert.equal(res.body.error, "not_found");
  });

  test("the portal is Experian only: a TransUnion case is refused", async () => {
    const { res, fake } = await call(
      { action: "send", id: CASE, portal: true, portal_confirmation: "EXP-1" },
      [caseLookup({ selected_bureaus_raw: "TU" })]
    );
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, "portal_ex_only");
    assert.equal(fake.find(/INSERT INTO inquiry_attempts/).length, 0);
  });

  test("a portal upload needs the Experian reference number", async () => {
    const { res } = await call({ action: "send", id: CASE, portal: true, portal_confirmation: " " }, [caseLookup()]);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, "portal_confirmation_required");
  });

  test("papers missing: 409 docs_blocked names what is missing, the case is marked Blocked, nothing is sent", async () => {
    const { res, fake } = await call(
      { action: "send", id: CASE, mail: true },
      [caseLookup(), ...shortPacket]
    );
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.error, "docs_blocked");
    assert.deepEqual(res.body.missing, ["proof_of_address", "authorization"]);
    assert.equal(fake.find(/SET case_status = 'Blocked'/).length, 1);
    assert.equal(fake.find(/INSERT INTO inquiry_attempts/).length, 0);
    assert.equal(netCalls.length, 0);
  });

  test("portal upload on a full packet: one attempt per inquiry, the reference is stored, the case moves to In Progress", async () => {
    const { res, fake } = await call(
      { action: "send", id: CASE, portal: true, portal_confirmation: " EXP-778899 " },
      [caseLookup(), ...fullPacket, ...openInquiry]
    );
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    const [attempt] = fake.find(/INSERT INTO inquiry_attempts/);
    assert.deepEqual(attempt.params, [ORG_ID, INQ, STAFF_ID, "portal", "uploaded", "experian_ref:EXP-778899"]);
    const [stored] = fake.find(/SET portal_confirmation = \$2/);
    assert.deepEqual(stored.params, [CASE, "EXP-778899"]);
  });

  test("mail with no return address on file: the attempt says mail_failed, no provider id is saved, nothing leaves", async () => {
    netCalls.length = 0;
    const { res, fake } = await call(
      { action: "send", id: CASE, mail: true },
      [caseLookup(), ...fullPacket, ...openInquiry]
    );
    assert.equal(res.statusCode, 200);
    const [attempt] = fake.find(/INSERT INTO inquiry_attempts/);
    assert.equal(attempt.params[3], "letter");
    assert.equal(attempt.params[4], "mail_failed:return_address_required");
    assert.equal(fake.find(/SET letter_provider_id/).length, 0);
    assert.equal(netCalls.length, 0);
  });
});
