import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import contractSign from "../../../../api/contracts/sign.mjs";
import documentDownload from "../../../../api/documents/[id].mjs";
import { db as defaultDb } from "../../../db.mjs";
import { handleWebhook } from "../../../http/router.mjs";
import { signature as contractSignature } from "../../../contracts/signed-link.mjs";
import { signature as documentSignature } from "../../../documents/signed-url.mjs";
import { makeRecipe } from "../door-recipes.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const MAP = path.join(ROOT, "ops/workflows/coverage-every-surface-2026-10-10/webhooks.json");
const UUID = "00000000-0000-4000-8000-000000000001";

function fakeDb() {
  return {
    calls: [],
    async query(sql, params = []) {
      this.calls.push({ sql: String(sql), params });
      return { rows: [], rowCount: 0 };
    },
  };
}

function responseRecorder() {
  return {
    statusCode: 200,
    body: undefined,
    headers: {},
    status(code) { this.statusCode = Number(code); return this; },
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; return this; },
    json(body) { this.body = body; return this; },
    send(body) { this.body = body; return this; },
    end(body) { this.body = body; return this; },
  };
}

test("Batch 4 webhook signatures reach their real handlers and return safe results", async () => {
  const rows = JSON.parse(fs.readFileSync(MAP, "utf8")).filter((row) =>
    makeRecipe("webhooks.json", row).proof?.evidence.includes("door-batch-webhook-final.test.mjs")
  );
  assert.equal(rows.length, 4);
  for (const row of rows) {
    const proof = makeRecipe("webhooks.json", row).proof;
    assert.match(proof.asserts, new RegExp(`^${row.control.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} — `));
  }

  const twilioDb = fakeDb();
  const twilioUrl = "https://fundhub.example.test/api/webhooks/twilio-status";
  const twilioToken = "fake-twilio-token";
  const twilioParams = { MessageSid: "SM_FAKE", MessageStatus: "queued" };
  const twilioBody = new URLSearchParams(twilioParams).toString();
  const twilioData = twilioUrl + Object.keys(twilioParams).sort()
    .map((key) => key + twilioParams[key]).join("");
  const twilioSig = crypto.createHmac("sha1", twilioToken).update(twilioData).digest("base64");
  const twilio = await handleWebhook({
    db: twilioDb,
    provider: "twilio-status",
    rawBody: twilioBody,
    headers: { "x-twilio-signature": twilioSig },
    url: twilioUrl,
    env: { TWILIO_AUTH_TOKEN: twilioToken },
  });
  assert.equal(twilio.status, 200);
  assert.equal(twilio.body.reason, "in_flight");

  const mailgunDb = fakeDb();
  const mailgunKey = "fake-mailgun-key";
  const timestamp = "1700000000";
  const token = "fake-token";
  const mailgunSig = crypto.createHmac("sha256", mailgunKey).update(timestamp + token).digest("hex");
  const mailgun = await handleWebhook({
    db: mailgunDb,
    provider: "mailgun-events",
    rawBody: JSON.stringify({
      signature: { timestamp, token, signature: mailgunSig },
      "event-data": { event: "opened", recipient: "fake@example.test" },
    }),
    headers: {},
    url: "https://fundhub.example.test/api/webhooks/mailgun-events",
    env: { MAILGUN_SIGNING_KEY: mailgunKey },
  });
  assert.equal(mailgun.status, 200);
  assert.equal(mailgun.body.reason, "not_delivery_state");

  const originalContractSecret = process.env.CONTRACT_URL_SECRET;
  const originalDocumentSecret = process.env.DOCUMENT_URL_SECRET;
  const originalQuery = defaultDb.query;
  const signedDb = fakeDb();
  const expiresAt = Math.floor(Date.now() / 1000) + 300;
  process.env.CONTRACT_URL_SECRET = "fake-contract-secret-32-bytes-long";
  process.env.DOCUMENT_URL_SECRET = "fake-document-secret-32-bytes-long";
  defaultDb.query = signedDb.query.bind(signedDb);
  try {
    const contractRes = responseRecorder();
    await contractSign({
      method: "GET",
      query: {
        id: UUID,
        exp: String(expiresAt),
        sig: contractSignature({
          contractId: UUID,
          expiresAt,
          secret: process.env.CONTRACT_URL_SECRET,
        }),
      },
      headers: {},
      socket: { remoteAddress: "127.0.0.1" },
    }, contractRes);
    assert.equal(contractRes.statusCode, 404);
    assert.equal(contractRes.body.error, "not_found");

    const documentRes = responseRecorder();
    await documentDownload({
      method: "GET",
      query: {
        id: UUID,
        exp: String(expiresAt),
        sig: documentSignature({
          documentId: UUID,
          versionId: null,
          expiresAt,
          secret: process.env.DOCUMENT_URL_SECRET,
        }),
      },
      headers: {},
    }, documentRes);
    assert.equal(documentRes.statusCode, 404);
    assert.equal(documentRes.body.error, "not_found");
  } finally {
    defaultDb.query = originalQuery;
    if (originalContractSecret === undefined) delete process.env.CONTRACT_URL_SECRET;
    else process.env.CONTRACT_URL_SECRET = originalContractSecret;
    if (originalDocumentSecret === undefined) delete process.env.DOCUMENT_URL_SECRET;
    else process.env.DOCUMENT_URL_SECRET = originalDocumentSecret;
  }
});
