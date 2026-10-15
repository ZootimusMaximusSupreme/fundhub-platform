// Practice test for the server half of the Case queue table: GET /api/read/inquiry-cases, the REAL
// handler and the REAL packet check (src/inquiry-ops/doc-gate.mjs), with the database answered by
// stand-in rows. It holds what the queue's Docs column and ordering stand on:
//
//   * the queue is read for the session's company and oldest first (the statement says so);
//   * every case carries the identity packet of ITS OWN client: complete when a photo ID, a proof of
//     address and a signed authorization are on file, otherwise "not complete" with the named papers
//     that are missing, and a signature filed as a consent counts as the authorization;
//   * a client whose papers could not be read comes back with NO answer (undefined), never "not complete"
//     and never "complete" ("we could not look" is a different sentence from "they are short");
//   * a refused role is refused before the queue is read.

import assert from "node:assert/strict";
import test from "node:test";

import handler from "../../../../api/read/inquiry-cases.mjs";
import { callShared } from "../../../testing/s3-handler-call.mjs";
import { ORG_ID, req, staffSession } from "../../../testing/handler-harness.mjs";

const A = "a1000000-0000-4000-8000-000000000001";
const B = "b2000000-0000-4000-8000-000000000002";
const C = "c3000000-0000-4000-8000-000000000003";
const caseRow = (n, client, requestedDaysAgo) => ({
  id: `d${n}000000-0000-4000-8000-00000000000${n}`, org_id: ORG_ID, client_id: client, case_id: `IRC-${n}`,
  case_status: "Queued", selected_bureaus_raw: "EX", open_inquiry_count: n, requested_at: new Date(Date.now() - requestedDaysAgo * 86400000).toISOString(),
  queue_total: "3",
});
// oldest first, the order the statement asks for: the stand-in returns them in that order
const CASES = [caseRow(1, A, 9), caseRow(2, B, 5), caseRow(3, C, 1)];

const doc = (client, kind, subtype) => ({ client_id: client, kind, subtype });
const DOCS = [
  doc(A, "client_upload", "id_document"), doc(A, "client_upload", "proof_of_address"),
  doc(B, "client_upload", "id_document"),
];

function rules({ docs = DOCS, consents = [A], documentsError = null } = {}) {
  return [
    [/FROM inquiry_removal_cases c/, () => CASES],
    [/FROM documents\b/, () => (documentsError ? new Error(documentsError) : docs)],
    [/FROM client_consents/, () => consents.map((client_id) => ({ client_id }))],
  ];
}

const ask = (over = {}, role = "inquiry_specialist") => callShared(handler, req("GET", { query: { active_only: "true" } }), [staffSession({ role }), ...rules(over)]);

test("the queue is read for the session's company, oldest first, and every case carries its own client's packet", async () => {
  const { res, fake } = await ask();
  assert.equal(res.statusCode, 200);
  const queue = fake.find(/FROM inquiry_removal_cases c/)[0];
  assert.equal(queue.params[0], ORG_ID, "the company comes from the session");
  assert.match(queue.sql, /ORDER BY c\.requested_at ASC NULLS LAST, c\.created_at ASC/, "oldest first");
  assert.deepEqual(res.body.cases.map((c) => c.case_id), ["IRC-1", "IRC-2", "IRC-3"]);
  assert.equal(res.body.total, 3);

  const [a, b, c] = res.body.cases;
  // A: photo ID + proof of address + a signed authorization filed as a consent -> complete
  assert.equal(a.docs_complete, true);
  assert.deepEqual(a.docs_missing, []);
  // B: a photo ID only
  assert.equal(b.docs_complete, false);
  assert.deepEqual(b.docs_missing, ["proof_of_address", "authorization"]);
  // C: nothing on file
  assert.equal(c.docs_complete, false);
  assert.deepEqual(c.docs_missing, ["id_document", "proof_of_address", "authorization"]);
});

test("the papers are read once for the whole queue, for these clients and this company only", async () => {
  const { fake } = await ask();
  const reads = fake.find(/FROM documents\b/);
  assert.equal(reads.length, 1, "one read for the whole page, not one per row");
  assert.equal(reads[0].params[0], ORG_ID);
  assert.deepEqual([...reads[0].params[1]].sort(), [A, B, C].sort());
  const consents = fake.find(/FROM client_consents/);
  assert.equal(consents.length, 1);
  assert.equal(consents[0].params[0], ORG_ID);
});

test("a signed authorization filed as a document counts, and a packet with no signature anywhere is not complete", async () => {
  const withAuthDocument = [...DOCS, doc(B, "authorization", "dispute_authorization"), doc(B, "client_upload", "bank_statement")];
  const { res } = await ask({ docs: withAuthDocument, consents: [] });
  const [a, b] = res.body.cases;
  assert.equal(b.docs_complete, true, "an authorization document and a bank statement complete B's packet");
  assert.equal(a.docs_complete, false, "A has ID and address but no signature anywhere");
  assert.deepEqual(a.docs_missing, ["authorization"]);
});

test("a read that failed answers with no verdict at all: not complete is a claim, and so is complete", async () => {
  const { res } = await ask({ documentsError: "the documents table could not be read" });
  assert.equal(res.statusCode, 200, "the queue still comes back");
  for (const c of res.body.cases) {
    assert.equal(c.docs_complete, undefined, `${c.case_id}: no verdict`);
    assert.equal(c.docs_missing, undefined, `${c.case_id}: no list`);
  }
});

test("a role off this desk is refused before the queue is read", async () => {
  const { res, fake } = await ask({}, "closer");
  assert.equal(res.statusCode, 403);
  assert.equal(fake.find(/FROM inquiry_removal_cases c/).length, 0);
  assert.equal(fake.find(/FROM documents\b/).length, 0);
});
