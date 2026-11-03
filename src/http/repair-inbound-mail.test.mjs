import { describe, it } from "node:test";
import assert from "node:assert/strict";
import handler from "../../api/repair/inbound-mail.mjs";
function mockRes() {
  return { statusCode: 200, body: null, headers: {}, setHeader(k,v){this.headers[k]=v;}, status(c){this.statusCode=c;return this;}, json(o){this.body=o;return this;} };
}
describe("POST /api/repair/inbound-mail", () => {
  it("rejects non-POST", async () => {
    const res = mockRes();
    await handler({ method: "GET", body: {} }, res, { requireAuth: async () => ({ org_id: "11111111-1111-1111-1111-111111111111", id: "s", role: "owner" }), db: { query: async () => ({ rows: [] }) } });
    assert.equal(res.statusCode, 405);
  });
  it("requires client_id", async () => {
    const res = mockRes();
    await handler({ method: "POST", body: { text: "hi" } }, res, { requireAuth: async () => ({ org_id: "11111111-1111-1111-1111-111111111111", id: "s", role: "owner" }), db: { query: async () => ({ rows: [] }) } });
    assert.equal(res.statusCode, 400);
  });
  it("holds pasted text for a source document and marks v1.1", async () => {
    const ORG = "11111111-1111-1111-1111-111111111111";
    const CLIENT = "22222222-2222-2222-2222-222222222222";
    let insertedBy = "unset";
    const db = { async query(sql, params = []) {
      const s = String(sql);
      if (s.includes("FROM dispute_items")) return { rows: [{ id: "44444444-4444-4444-4444-444444444444", case_id: "33333333-3333-3333-3333-333333333333", creditor: "Midland", account_last4: "4521", round: "R1", status: "sent" }] };
      if (s.includes("INSERT INTO dispute_responses")) {
        insertedBy = params[7];
        return { rows: [{ id: "r1" }] };
      }
      return { rows: [] };
    }};
    const res = mockRes();
    await handler({ method: "POST", body: { client_id: CLIENT, text: "Account ending 4521 has been deleted from your file." } }, res, { requireAuth: async () => ({ org_id: ORG, id: "s", role: "owner" }), db });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.version, "v1.1");
    assert.equal(res.body.imap, false);
    assert.equal(res.body.result.status, "held");
    assert.equal(res.body.result.parseResult.requiresDocumentValidation, true);
    assert.equal(insertedBy, null);
  });
  it("a caller cannot substitute bytes, MIME or a typed validation verdict for the stored document", async () => {
    let received;
    const res = mockRes();
    await handler({ method: "POST", body: { client_id: "22222222-2222-2222-2222-222222222222",
      document_id: "66666666-6666-4666-8666-666666666666", bytes: "ZmFrZQ==", mime_type: "image/png",
      bureau_response_validation: { status: "accepted" } } }, res, {
      requireAuth: async () => ({ org_id: "11111111-1111-1111-1111-111111111111", role: "owner" }),
      db: {}, processBureauResponse: async (_db, args) => { received = args; return { ok: false, reason: "stored_file_not_read" }; }
    });
    assert.equal(received.bytes, undefined); assert.equal(received.mimeType, undefined);
    assert.equal(received.bureau_response_validation, undefined);
    assert.equal(received.documentId, "66666666-6666-4666-8666-666666666666");
  });
});
