// finish-853 batch 08: the refusals that sit in front of the batch-08 customer-data doors and that
// the row tests above them never asserted (found by turning each guard off in turn and re-running the
// row tests: they stayed green). (1) A staff sign-in with no company on it. (2) A client login that is
// not attached to a client file. (3) A staff caller who names no client. (4) A method the door does not
// serve. (5) A body that is not JSON. Each real handler must refuse with its own words and must not
// read or write a single data table: with a missing company or file a lookup would run with NULL and
// read as "nothing found" instead of "you may not".
// Practice test: the real handlers and the real sign-in gate, fake sessions, no network, no database.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import bankingHandler from "../../api/banking/accounts.mjs";
import declinesHandler from "../../api/blueprint/declines.mjs";
import contractsHandler from "../../api/contracts.mjs";
import uploadHandler from "../../api/documents-upload.mjs";
import inquiriesHandler from "../../api/inquiries.mjs";
import inquiryCasesHandler from "../../api/inquiry-cases.mjs";
import inquiryHandler from "../../api/inquiry.mjs";
import banksHandler from "../../api/money/banks.mjs";
import fundabilityHandler from "../../api/money/fundability.mjs";
import strategyHandler from "../../api/money/strategy.mjs";
import tasksHandler from "../../api/money/tasks.mjs";
import progressHandler from "../../api/read/client-progress.mjs";
import lenderMatchesHandler from "../../api/read/lender-matches.mjs";
import repairGenerateHandler from "../../api/repair/generate.mjs";
import inboundMailHandler from "../../api/repair/inbound-mail.mjs";
import { req, staffSession, accountSession, ORG_ID } from "../testing/handler-harness.mjs";
import { callShared } from "../testing/s3-handler-call.mjs";

const CLIENT = "11111111-1111-4111-8111-111111111111";
const SESSION_SQL = /FROM live JOIN staff|UPDATE account_sessions|FROM accounts WHERE id/;
const dataStatements = (fake) => fake.calls.filter((c) => !SESSION_SQL.test(c.sql));

const STAFF_WITHOUT_COMPANY = [
  ["banking/accounts import", bankingHandler, req("POST", { body: { action: "import", client_id: CLIENT } }), 403, "no_org_on_session"],
  ["blueprint/declines", declinesHandler, req("GET", { query: { client_id: CLIENT } }), 403, "no_org_on_session"],
  ["contracts", contractsHandler, req("POST", { body: { action: "create_draft" } }), 400, "org_required"],
  ["documents-upload", uploadHandler, req("POST", { body: { fields: { client_id: CLIENT }, files: [{ filename: "a.pdf", content: "x" }] } }), 400, "org_id is required"],
  ["inquiries", inquiriesHandler, req("GET", { query: { inquiry_id: CLIENT } }), 403, "no_org_on_session"],
  ["inquiry-cases send", inquiryCasesHandler, req("POST", { body: { action: "send", id: CLIENT } }), 403, "forbidden"],
  ["inquiry launch", inquiryHandler, req("POST", { body: { action: "launch" } }), 403, "forbidden"],
  ["money/banks", banksHandler, req("GET", { query: { client_id: CLIENT } }), 403, "no_org_on_session"],
  ["money/fundability", fundabilityHandler, req("GET", { query: { client_id: CLIENT } }), 403, "no_org_on_session"],
  ["money/strategy", strategyHandler, req("GET", { query: { client_id: CLIENT } }), 403, "no_org_on_session"],
  ["money/tasks", tasksHandler, req("POST", { body: { action: "do_task", client_id: CLIENT } }), 403, "no_org_on_session"],
  ["read/client-progress", progressHandler, req("GET", { query: { client_id: CLIENT } }), 400, "org_required"],
  ["read/lender-matches", lenderMatchesHandler, req("GET", { query: { client_id: CLIENT } }), 403, "forbidden"],
  ["repair/generate", repairGenerateHandler, req("POST", { body: { client_id: CLIENT } }), 403, "forbidden"],
  ["repair/inbound-mail", inboundMailHandler, req("POST", { body: { client_id: CLIENT, text: "Letter from the bureau." } }), 403, "forbidden"],
];

const CLIENT_WITHOUT_FILE = [
  ["blueprint/declines", declinesHandler, req("GET", { query: { client_id: CLIENT } })],
  ["money/banks", banksHandler, req("GET", { query: { client_id: CLIENT } })],
  ["money/fundability", fundabilityHandler, req("GET", { query: { client_id: CLIENT } })],
  ["money/strategy", strategyHandler, req("GET", { query: { client_id: CLIENT } })],
  ["money/tasks", tasksHandler, req("POST", { body: { action: "do_task", client_id: CLIENT } })],
  ["read/client-progress", progressHandler, req("GET", { query: { client_id: CLIENT } })],
];

describe("a staff sign-in with no company is refused before any data table is touched", () => {
  for (const [name, handler, request, status, error] of STAFF_WITHOUT_COMPANY) {
    test(`${name}: ${status} ${error}`, async () => {
      const { res, fake } = await callShared(handler, request, [staffSession({ role: "owner", org_id: null })]);
      assert.equal(res.statusCode, status);
      assert.equal(res.body.error, error);
      assert.deepEqual(dataStatements(fake).map((c) => c.sql.trim().slice(0, 60)), [], "no data statement ran");
    });
  }

  test("with a company on the sign-in the same progress request does not get the no-company answer", async () => {
    // The refusals above are about the company, not the shape of the request.
    const { res } = await callShared(progressHandler, req("GET", { query: { client_id: CLIENT } }), [staffSession({ role: "owner", org_id: ORG_ID })]);
    assert.notEqual(res.body.error, "org_required");
    assert.notEqual(res.body.error, "no_org_on_session");
  });
});

describe("a client login that is not attached to a client file is refused before any data table is touched", () => {
  for (const [name, handler, request] of CLIENT_WITHOUT_FILE) {
    test(name, async () => {
      const who = accountSession({ kind: "client", clientId: null, orgId: ORG_ID });
      const { res, fake } = await callShared(handler, request, who);
      assert.equal(res.statusCode, 403);
      assert.equal(res.body.error, "forbidden");
      assert.equal(res.body.message, "Your login is not attached to a client file.");
      assert.deepEqual(dataStatements(fake).map((c) => c.sql.trim().slice(0, 60)), [], "no data statement ran");
    });
  }
});

const STAFF_NAMING_NO_CLIENT = [
  ["money/banks GET", banksHandler, req("GET", { query: {} })],
  ["money/fundability GET", fundabilityHandler, req("GET", { query: {} })],
  ["money/strategy GET", strategyHandler, req("GET", { query: {} })],
  ["money/tasks do_task", tasksHandler, req("POST", { body: { action: "do_task" } })],
  ["blueprint/declines GET", declinesHandler, req("GET", { query: {} })],
];

const WRONG_METHOD = [
  ["money/banks", banksHandler, req("PUT", { query: { client_id: CLIENT } }), "GET, POST"],
  ["money/strategy", strategyHandler, req("PUT", { query: { client_id: CLIENT } }), "GET, POST"],
  ["money/tasks", tasksHandler, req("PUT", { query: { client_id: CLIENT } }), "GET, POST"],
  ["blueprint/declines", declinesHandler, req("PUT", { query: { client_id: CLIENT } }), "GET, POST"],
  ["money/fundability", fundabilityHandler, req("POST", { body: { client_id: CLIENT } }), "GET"],
  ["read/client-progress", progressHandler, req("POST", { body: { client_id: CLIENT } }), "GET"],
  ["read/lender-matches", lenderMatchesHandler, req("POST", { body: { client_id: CLIENT } }), "GET"],
];

const NOT_JSON = [
  ["money/banks", banksHandler],
  ["money/strategy", strategyHandler],
  ["money/tasks", tasksHandler],
  ["blueprint/declines", declinesHandler],
];

describe("a staff caller with a company who names no client, or a method or body the door does not take", () => {
  const owner = [staffSession({ role: "owner", org_id: ORG_ID })];

  for (const [name, handler, request] of STAFF_NAMING_NO_CLIENT) {
    test(`${name}: no client id is 400 and nothing is read`, async () => {
      const { res, fake } = await callShared(handler, request, owner);
      assert.equal(res.statusCode, 400);
      assert.equal(res.body.error, "client_id is required and must be a uuid");
      assert.deepEqual(dataStatements(fake).map((c) => c.sql.trim().slice(0, 60)), []);
    });
  }

  for (const [name, handler, request, allow] of WRONG_METHOD) {
    test(`${name}: ${request.method} is 405 with Allow: ${allow} and nothing is read`, async () => {
      const { res, fake } = await callShared(handler, request, owner);
      assert.equal(res.statusCode, 405);
      assert.equal(res.headers.allow, allow);
      assert.deepEqual(dataStatements(fake).map((c) => c.sql.trim().slice(0, 60)), []);
    });
  }

  for (const [name, handler] of NOT_JSON) {
    test(`${name}: a body that is not JSON is 400 and nothing is read`, async () => {
      const { res, fake } = await callShared(handler, req("POST", { body: "{not json" }), owner);
      assert.equal(res.statusCode, 400);
      assert.equal(res.body.error, "body must be JSON");
      assert.deepEqual(dataStatements(fake).map((c) => c.sql.trim().slice(0, 60)), []);
    });
  }
});
