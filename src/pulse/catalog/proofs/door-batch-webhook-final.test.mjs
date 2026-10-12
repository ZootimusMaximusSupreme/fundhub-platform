import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import contractSign from "../../../../api/contracts/sign.mjs";
import documentDownload from "../../../../api/documents/[id].mjs";
import { db } from "../../../db.mjs";
import { signContractUrl } from "../../../contracts/signed-link.mjs";
import { signDocumentUrl } from "../../../documents/signed-url.mjs";
import { storeFromEnv } from "../../../documents/store.mjs";
import { handleWebhook } from "../../../http/router.mjs";
import { makeRecipe } from "../door-recipes.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const MAP = path.join(ROOT, "ops/workflows/coverage-every-surface-2026-10-10/webhooks.json");
const SECRET = "door-proof-secret-that-is-long-enough-2026";
const CONTRACT_ID = "00000000-0000-4000-8000-000000000101";
const SIGNER_ID = "00000000-0000-4000-8000-000000000102";
const VERSION_ID = "00000000-0000-4000-8000-000000000103";
const DOCUMENT_ID = "00000000-0000-4000-8000-000000000104";

function responseRecorder() {
  return {
    statusCode: 200,
    body: undefined,
    headers: {},
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; return this; },
    status(code) { this.statusCode = Number(code); return this; },
    json(body) { this.body = body; return this; },
    send(body) { this.body = body; return this; },
    end(body) { this.body = body; return this; },
  };
}

function twilioSignature(url, params, token) {
  const value = Object.keys(params).sort().reduce((out, key) => out + key + params[key], url);
  return crypto.createHmac("sha1", token).update(value, "utf8").digest("base64");
}

function mailgunBody(messageId, key) {
  const timestamp = "1754006400";
  const token = "0123456789abcdef0123456789abcdef01234567";
  const signature = crypto.createHmac("sha256", key).update(timestamp + token).digest("hex");
  return JSON.stringify({
    signature: { timestamp, token, signature },
    "event-data": {
      event: "delivered",
      recipient: "door-proof@example.test",
      message: { headers: { "message-id": `<${messageId}>` } },
    },
  });
}

test("the four final webhook rows use exact fake-data result proof", () => {
  const rows = JSON.parse(fs.readFileSync(MAP, "utf8")).filter((row) =>
    makeRecipe("webhooks.json", row).proof?.evidence.includes("door-batch-webhook-final.test.mjs")
  );
  assert.deepEqual(rows.map((row) => row.surface).sort(), [
    "webhook:GET /api/documents/[id]",
    "webhook:GET|POST /api/contracts/sign",
    "webhook:POST /api/webhooks/mailgun-events",
    "webhook:POST /api/webhooks/twilio-status",
  ]);
  for (const row of rows) {
    const proof = makeRecipe("webhooks.json", row).proof;
    assert.equal(proof.depth, "deep");
    assert.equal(proof.verdict, undefined);
    assert.equal(proof.asserts, row.control);
  }
});

test("Twilio and Mailgun receipts save the exact fake message result", async () => {
  const twilioToken = "fake-twilio-token-for-door-proof";
  const twilioUrl = "https://fundhub.test/api/webhooks/twilio-status";
  const twilioParams = {
    MessageSid: "SM-door-proof",
    MessageStatus: "failed",
    ErrorCode: "30007",
    ErrorMessage: "blocked for fake proof",
  };
  const sms = { status: "sent", lastError: null };
  const smsDb = {
    async query(sql, params) {
      if (/INSERT INTO webhook_captures/.test(String(sql))) return { rowCount: 1, rows: [] };
      assert.match(String(sql), /UPDATE messages/);
      assert.equal(params[0], twilioParams.MessageSid);
      sms.status = params[1];
      sms.lastError = params[2];
      return { rowCount: 1, rows: [] };
    },
  };
  const twilioRaw = new URLSearchParams(twilioParams).toString();
  const twilio = await handleWebhook({
    db: smsDb,
    provider: "twilio-status",
    rawBody: twilioRaw,
    headers: { "x-twilio-signature": twilioSignature(twilioUrl, twilioParams, twilioToken) },
    url: twilioUrl,
    env: { TWILIO_AUTH_TOKEN: twilioToken },
  });
  assert.equal(twilio.status, 200);
  assert.equal(twilio.body.updated, 1);
  assert.equal(sms.status, "failed");
  assert.match(sms.lastError, /twilio_error_30007/);

  const mailgunKey = "fake-mailgun-key-for-door-proof";
  const mailgunId = "door-proof@mg.example.test";
  const email = { status: "sent", lastError: null };
  const mailgunDb = {
    async query(sql, params) {
      const text = String(sql);
      if (/INSERT INTO webhook_captures/.test(text)) return { rowCount: 1, rows: [] };
      if (/FROM messages/.test(text)) {
        assert.equal(params[0], mailgunId);
        return { rows: [{ id: "message-1", org_id: "org-1", client_id: "client-1", template_key: "fake-template" }] };
      }
      assert.match(text, /UPDATE messages/);
      email.status = params[1];
      email.lastError = params[2];
      return { rowCount: 1, rows: [] };
    },
  };
  const mailgun = await handleWebhook({
    db: mailgunDb,
    provider: "mailgun-events",
    rawBody: mailgunBody(mailgunId, mailgunKey),
    headers: {},
    env: { MAILGUN_SIGNING_KEY: mailgunKey },
  });
  assert.equal(mailgun.status, 200);
  assert.equal(mailgun.body.updated, 1);
  assert.equal(email.status, "delivered");
});

test("the contract link proves GET, POST, changed-word refusal, and missing-secret refusal", async () => {
  const oldSecret = process.env.CONTRACT_URL_SECRET;
  process.env.CONTRACT_URL_SECRET = SECRET;
  const rendered = "Funding fee: 10%";
  const checksum = `sha256:${crypto.createHash("sha256").update(rendered).digest("hex")}`;
  const contract = {
    id: CONTRACT_ID,
    title: "Door proof contract",
    kind: "funding",
    subtype: null,
    status: "sent",
    source_kind: "text",
    rendered_body: rendered,
    signature_required: true,
    signature_statement: "I agree",
    sent_at: new Date().toISOString(),
    signed_at: null,
    signer_name: null,
    completed_at: null,
    fields: [],
    signing_order: "sequential",
    document_version_id: VERSION_ID,
    body_sha: checksum,
    view_count: 0,
  };
  const signer = {
    id: SIGNER_ID,
    contract_id: CONTRACT_ID,
    signer_index: 0,
    role_label: "Client",
    name: "Fake Client",
    email: "fake@example.test",
    status: "sent",
    signed_at: null,
    signer_name: null,
    field_values: {},
    view_count: 0,
  };
  const secondSigner = {
    ...signer,
    id: "00000000-0000-4000-8000-000000000107",
    signer_index: 1,
    role_label: "Fundhub",
    name: "Fake Countersigner",
    email: "counter@example.test",
  };
  contract.signing_order = "parallel";
  const signers = [signer, secondSigner];
  let signatureWrites = 0;
  let queryCalls = 0;
  const originalQuery = db.query;
  db.query = async (sql, params = []) => {
    queryCalls += 1;
    const text = String(sql);
    if (/FROM contracts WHERE/.test(text)) return { rows: [contract] };
    if (/SELECT checksum FROM document_versions/.test(text)) return { rows: [{ checksum }] };
    if (/FROM contract_signers\s+WHERE contract_id/.test(text)) return { rows: signers };
    if (/SET status = 'signed'/.test(text)) {
      signatureWrites += 1;
      assert.equal(params[0], SIGNER_ID);
      Object.assign(signer, {
        status: "signed",
        signed_at: params[1],
        signer_name: params[2],
        signer_ip: params[3],
        signer_user_agent: params[4],
        field_values: JSON.parse(params[5]),
      });
      return { rows: [signer] };
    }
    if (/UPDATE contracts/.test(text)) {
      contract.status = "viewed";
      contract.view_count += 1;
      return { rows: [contract] };
    }
    if (/UPDATE contract_signers/.test(text)) {
      signer.status = "viewed";
      signer.view_count += 1;
      return { rows: [signer] };
    }
    throw new Error(`unexpected contract proof query: ${text.slice(0, 80)}`);
  };
  try {
    const signed = signContractUrl({ contractId: CONTRACT_ID, signerId: SIGNER_ID, secret: SECRET });
    const query = Object.fromEntries(new URL(signed.path, "https://fundhub.test").searchParams);
    const response = responseRecorder();
    await contractSign({ method: "GET", query, headers: {} }, response);
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.contract.body, rendered);
    assert.equal(response.body.contract.can_sign, true);
    assert.equal(contract.view_count, 1);
    assert.equal(signer.view_count, 1);

    const signedResponse = responseRecorder();
    await contractSign({
      method: "POST",
      query,
      headers: { "user-agent": "door-proof-browser", "x-forwarded-for": "192.0.2.10" },
      body: { signer_name: "Fake Client", agreed: true },
    }, signedResponse);
    assert.equal(signedResponse.statusCode, 200);
    assert.equal(signedResponse.body.ok, true);
    assert.equal(signedResponse.body.complete, false);
    assert.equal(signatureWrites, 1);
    assert.equal(signer.status, "signed");
    assert.equal(signer.signer_name, "Fake Client");
    assert.equal(signer.signer_ip, "192.0.2.10");
    assert.equal(signer.signer_user_agent, "door-proof-browser");

    Object.assign(signer, {
      status: "viewed", signed_at: null, signer_name: null,
      signer_ip: null, signer_user_agent: null, field_values: {},
    });
    contract.rendered_body = "Funding fee: 99%";
    const changedResponse = responseRecorder();
    await contractSign({
      method: "POST",
      query,
      headers: {},
      body: { signer_name: "Fake Client", agreed: true },
    }, changedResponse);
    assert.equal(changedResponse.statusCode, 409);
    assert.equal(changedResponse.body.error, "content_changed");
    assert.equal(signatureWrites, 1, "changed words must not write a signature");

    const beforeMissingSecret = queryCalls;
    delete process.env.CONTRACT_URL_SECRET;
    const missingSecretResponse = responseRecorder();
    await contractSign({ method: "GET", query, headers: {} }, missingSecretResponse);
    assert.equal(missingSecretResponse.statusCode, 503);
    assert.equal(missingSecretResponse.body.error, "not_configured");
    assert.equal(queryCalls, beforeMissingSecret, "missing secret must refuse before database access");
  } finally {
    db.query = originalQuery;
    if (oldSecret === undefined) delete process.env.CONTRACT_URL_SECRET;
    else process.env.CONTRACT_URL_SECRET = oldSecret;
  }
});

test("a signed document link returns the saved fake bytes", async () => {
  const oldSecret = process.env.DOCUMENT_URL_SECRET;
  const oldProvider = process.env.DOCUMENT_STORE_PROVIDER;
  process.env.DOCUMENT_URL_SECRET = SECRET;
  process.env.DOCUMENT_STORE_PROVIDER = "memory";
  const bytes = Buffer.from("fake document bytes");
  const store = storeFromEnv();
  const stored = await store.put({
    orgId: "00000000-0000-4000-8000-000000000105",
    clientId: "00000000-0000-4000-8000-000000000106",
    kind: "door-proof",
    body: bytes,
    mimeType: "text/plain",
    filename: "fake.txt",
  });
  const storageKey = stored.storageKey;
  const originalQuery = db.query;
  let documentQueries = 0;
  db.query = async (sql, params) => {
    documentQueries += 1;
    assert.match(String(sql), /FROM documents d/);
    assert.equal(params[0], DOCUMENT_ID);
    return { rows: [{
      version_id: VERSION_ID,
      document_id: DOCUMENT_ID,
      storage_key: storageKey,
      mime_type: "text/plain",
      checksum: null,
      expires_at: null,
    }] };
  };
  try {
    const signed = signDocumentUrl({ documentId: DOCUMENT_ID, secret: SECRET });
    const parsed = new URL(signed.path, "https://fundhub.test");
    const response = responseRecorder();
    await documentDownload({
      method: "GET",
      query: { id: DOCUMENT_ID, ...Object.fromEntries(parsed.searchParams) },
      headers: {},
    }, response);
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body, bytes);
    assert.equal(response.headers["content-type"], "text/plain");

    const beforeMissingSecret = documentQueries;
    delete process.env.DOCUMENT_URL_SECRET;
    const refused = responseRecorder();
    await documentDownload({
      method: "GET",
      query: { id: DOCUMENT_ID, ...Object.fromEntries(parsed.searchParams) },
      headers: {},
    }, refused);
    assert.equal(refused.statusCode, 503);
    assert.equal(refused.body.error, "not_configured");
    assert.equal(documentQueries, beforeMissingSecret, "missing secret must refuse before database access");
  } finally {
    db.query = originalQuery;
    if (oldSecret === undefined) delete process.env.DOCUMENT_URL_SECRET;
    else process.env.DOCUMENT_URL_SECRET = oldSecret;
    if (oldProvider === undefined) delete process.env.DOCUMENT_STORE_PROVIDER;
    else process.env.DOCUMENT_STORE_PROVIDER = oldProvider;
  }
});
