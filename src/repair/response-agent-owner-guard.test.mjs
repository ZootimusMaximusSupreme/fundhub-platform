// Isolated fulfillment guard: no production document store, model, mailer or client.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  ownsBureauResponseDocument, processBureauResponse, onBureauResponseDocsReceived
} from "./response-agent.mjs";

const ORG = "11111111-1111-4111-8111-111111111111";
const FOREIGN_ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CLIENT = "22222222-2222-4222-8222-222222222222";
const FOREIGN_CLIENT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const DOC = "33333333-3333-4333-8333-333333333333";
const VERSION = "44444444-4444-4444-8444-444444444444";
const FOREIGN_VERSION = "55555555-5555-4555-8555-555555555555";
const BUREAU = "bureau_response";

function fakeDocuments({ org = ORG, client = CLIENT, kind = BUREAU,
  expired = false, version = VERSION, documentId = DOC, missing = false } = {}) {
  const queries = [];
  return {
    queries,
    async query(sql, p) {
      queries.push({ sql: String(sql), params: p });
      if (!String(sql).includes("FROM documents d")) throw new Error("Unexpected unguarded database action");
      if (missing || String(documentId) !== String(p[0]) ||
          String(org) !== String(p[1]) || String(client) !== String(p[2]) ||
          kind !== p[3] || expired || (p[4] && String(version) !== String(p[4]))) {
        return { rows: [] };
      }
      return { rows: [{ id: documentId }] };
    }
  };
}

describe("bureau-response upload owner fence", () => {
  test("owned, unexpired bureau response is admitted with the right version", async () => {
    const db = fakeDocuments();
    assert.equal(await ownsBureauResponseDocument(db, {
      orgId: ORG, clientId: CLIENT, documentId: DOC, versionId: VERSION
    }), true);
    assert.match(db.queries[0].sql, /d\.org_id = \$2::uuid/);
    assert.match(db.queries[0].sql, /d\.client_id = \$3::uuid/);
    assert.match(db.queries[0].sql, /v\.document_id = d\.id/);
    assert.match(db.queries[0].sql, /d\.kind = \$4::text/);
  });

  test("foreign org, foreign client, wrong kind, expired or missing document all refuse", async () => {
    for (const scenario of [
      { org: FOREIGN_ORG }, { client: FOREIGN_CLIENT },
      { kind: "client_upload" }, { expired: true }, { missing: true }
    ]) {
      const db = fakeDocuments(scenario);
      let modelCalls = 0, emailCalls = 0, eventCalls = 0, bytesRead = 0;
      const out = await processBureauResponse(db, {
        orgId: ORG, clientId: CLIENT, documentId: DOC, bytes: Buffer.from("secret"),
        callModelImpl: async () => { modelCalls++; throw new Error("model must not see foreign bytes"); },
        sendTemplatedImpl: async () => { emailCalls++; },
        onEvent: async () => { eventCalls++; },
        loadBytesImpl: async () => { bytesRead++; throw new Error("storage must not be read"); }
      });
      assert.deepEqual(out, { ok: false, reason: "bureau_response_document_unavailable" }, JSON.stringify(scenario));
      assert.deepEqual([modelCalls, emailCalls, eventCalls, bytesRead], [0, 0, 0, 0]);
    }
  });

  test("foreign version and malformed IDs refuse before bytes, model or mail", async () => {
    const db = fakeDocuments();
    let called = false;
    for (const args of [
      { versionId: FOREIGN_VERSION },
      { documentId: "not-a-uuid" },
      { orgId: "bad-org" },
      { clientId: "bad-client" },
      { versionId: "bad-version" }
    ]) {
      const out = await processBureauResponse(db, {
        orgId: ORG, clientId: CLIENT, documentId: DOC,
        bytes: Buffer.from("fake"),
        ...args,
        callModelImpl: async () => { called = true; },
        sendTemplatedImpl: async () => { called = true; },
        onEvent: async () => { called = true; }
      });
      assert.equal(out.reason, "bureau_response_document_unavailable", JSON.stringify(args));
    }
    assert.equal(called, false);
  });

  test("docs.received with another customer's document is refused, not parsed into this customer's repair", async () => {
    const db = fakeDocuments({ client: FOREIGN_CLIENT });
    let anySideEffect = false;
    const out = await onBureauResponseDocsReceived(db, {
      id: "synthetic-event", orgId: ORG, clientId: CLIENT,
      payload: { kind: BUREAU, document_id: DOC }
    }, {
      bytes: Buffer.from("other client's bureau letter"),
      callModelImpl: async () => { anySideEffect = true; },
      onEvent: async () => { anySideEffect = true; },
      sendTemplatedImpl: async () => { anySideEffect = true; }
    });
    assert.equal(out.reason, "bureau_response_document_unavailable");
    assert.equal(anySideEffect, false);
  });

  test("proper owned response still reaches retake notification with an injected mock model", async () => {
    const db = fakeDocuments();
    const sent = [], events = [];
    const out = await processBureauResponse(db, {
      orgId: ORG, clientId: CLIENT, documentId: DOC, versionId: VERSION,
      bytes: Buffer.from("owned image"), mimeType: "image/jpeg",
      callModelImpl: async () => ({ text: JSON.stringify({
        quality: "retake", message_to_client: "Please include every corner."
      }) }),
      sendTemplatedImpl: async (_db, p) => { sent.push(p); return { queued: true }; },
      onEvent: async (_db, p) => { events.push(p); }
    });
    assert.equal(out.ok, true);
    assert.equal(out.status, "retake");
    assert.equal(sent.length, 1);
    assert.equal(sent[0].clientId, CLIENT);
    assert.equal(events.length, 1);
  });
});
