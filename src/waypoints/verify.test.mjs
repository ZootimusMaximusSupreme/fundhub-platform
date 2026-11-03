import { describe, test } from "node:test";
import assert from "node:assert";
import {
  judgeDisputeMailReceipt,
  judgeBureauResponseUpload,
  judgePaydown,
  evaluateWaypoints
} from "./verify.mjs";

describe("document proof judges", () => {
  test("dispute mail receipt completes when the upload is on file", () => {
    const docs = [{ kind: "client_upload", subtype: "dispute_mail_receipt" }];
    assert.equal(judgeDisputeMailReceipt(docs).verdict, "complete");
    assert.equal(judgeDisputeMailReceipt([]).verdict, "open");
    assert.equal(judgeDisputeMailReceipt([{ kind: "client_upload", subtype: "other" }]).verdict, "open");
  });

  test("bureau response requires the server's accepted current-version review", () => {
    const doc = { id: "doc", kind: "bureau_response", subtype: "bureau_letter", current_version_id: "v1", metadata: {} };
    assert.equal(judgeBureauResponseUpload([doc]).verdict, "open");
    doc.metadata = { reviewed: true, verified: true, status: "accepted", quality: "pass" };
    assert.equal(judgeBureauResponseUpload([doc]).verdict, "open", "typed upload metadata is not server proof");
    doc.metadata.bureau_response_validation = { schema: 1, validator: "bureau-response-reader", document_id: "doc", version_id: "v1", status: "accepted", quality: "pass", document_type: "bureau_response", client_match: "match", recipient_name: "Alex Buyer", authenticity: "clear", bureau: "EX", reviewed_at: "2026-11-02T18:00:00Z" };
    assert.equal(judgeBureauResponseUpload([doc]).verdict, "complete");
    doc.current_version_id = "v2";
    assert.equal(judgeBureauResponseUpload([doc]).verdict, "open", "replacement bytes need their own review");
    doc.current_version_id = "v1";
    doc.metadata.bureau_response_validation.status = "hold";
    assert.equal(judgeBureauResponseUpload([doc]).verdict, "open");
    doc.metadata.bureau_response_validation.status = "request_more";
    assert.equal(judgeBureauResponseUpload([doc]).verdict, "open");
    assert.equal(judgeBureauResponseUpload([]).verdict, "open");
  });
});

test("bureau completion rechecks current evidence under the same transaction lock", async () => {
  const review = { schema: 1, validator: "bureau-response-reader", document_id: "doc", version_id: "v1", status: "accepted", quality: "pass", document_type: "bureau_response", client_match: "match", recipient_name: "Alex Buyer", authenticity: "clear", bureau: "EX", reviewed_at: "2026-11-02T18:00:00Z" };
  for (const replaced of [false, true]) {
    const calls = [];
    const doc = { id: "doc", kind: "bureau_response", current_version_id: "v1", metadata: { bureau_response_validation: review } };
    const db = { query: async (sql, params) => {
      calls.push({ sql, params });
      if (sql.includes("SELECT * FROM client_waypoints")) return { rows: [{ key: "response", state: "in_progress", verify_kind: "bureau_response_upload" }] };
      if (sql.includes("FROM documents")) return { rows: [{ ...doc, current_version_id: replaced && sql.includes("FOR SHARE") ? "v2" : "v1" }] };
      if (sql.includes("UPDATE client_waypoints")) return { rows: [{ key: "response" }] };
      throw new Error("Unexpected verification read");
    } };
    const out = await evaluateWaypoints(db, { orgId: "org", clientId: "client", crsResult: null });
    assert.equal(out.completed.length, replaced ? 0 : 1);
    assert.equal(calls.filter(c => c.sql.includes("UPDATE client_waypoints")).length, replaced ? 0 : 1);
    const locked = calls.find(c => c.sql.includes("FOR SHARE"));
    assert.deepEqual(locked.params, ["org", "client"]);
    assert.match(locked.sql, /kind = 'bureau_response'/);
  }
});

describe("judgePaydown (unchanged guard)", () => {
  test("still closes at or under target", () => {
    const wp = { params: { target_cents: 30000 } };
    const account = { balanceCents: 30000 };
    assert.equal(judgePaydown(wp, account).verdict, "complete");
  });
});
