import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AGENT_CODE,
  DOC_CHECK_TYPES,
  shouldRunDocCheck,
  onDocsReceivedDocCheck,
  parseAgentJson,
  WAITING_TASK_TITLE_PREFIX
} from "./doc-check.mjs";
import { onDocsReceivedFlipInquiryGate } from "./inquiry-docs.mjs";

const ORG = "11111111-1111-4111-8111-111111111111";
const CLIENT = "22222222-2222-4222-8222-222222222222";

function event(payload, extra = {}) {
  return {
    id: extra.id || "evt-doc-1",
    name: "docs.received",
    orgId: ORG,
    clientId: CLIENT,
    payload
  };
}

test("DOC-CHECK types are the six client-document names from the spec", () => {
  assert.deepEqual([...DOC_CHECK_TYPES], [
    "id_document",
    "proof_of_address",
    "articles_of_organization",
    "ssn_card",
    "proof_of_income",
    "bank_statement"
  ]);
});

test("shouldRunDocCheck: client_upload subtype matches, inquiry_doc does not", () => {
  assert.equal(shouldRunDocCheck({ kind: "client_upload", subtype: "id_document" }), true);
  assert.equal(shouldRunDocCheck({ kind: "id_document" }), true);
  assert.equal(shouldRunDocCheck({ kind: "inquiry_doc", subtype: "id_document" }), false);
  assert.equal(shouldRunDocCheck({ kind: "bureau_response", subtype: "bureau_letter" }), false);
  assert.equal(shouldRunDocCheck({ kind: "client_upload", subtype: "other" }), true);
  assert.equal(shouldRunDocCheck({ kind: "client_upload", subtype: "articles_of_organization" }), true);
});

/* The application document vault (Capital Blueprint B3) adds business papers this
   reader has no rules for. Reading them would text the client "documents approved,
   Round 1 shortly" or "one thing needs fixing" about a paper it cannot judge, so
   they are staff-accepted and never reach it. Everything else still does. */
test("shouldRunDocCheck: the vault's business papers are never read by the identity agent", async () => {
  const { VAULT_ONLY_SUBTYPES } = await import("../finance/document-vault-items.mjs");
  assert.deepEqual([...VAULT_ONLY_SUBTYPES].sort(), [
    "business_bank_statement", "business_license", "business_tax_return", "certificate_good_standing", "ein_letter"
  ]);
  for (const subtype of VAULT_ONLY_SUBTYPES) {
    assert.equal(shouldRunDocCheck({ kind: "client_upload", subtype }), false, subtype);
    assert.equal(shouldRunDocCheck({ subtype }), false, `${subtype} with no kind`);
  }
  // unchanged: what it read before it still reads
  for (const subtype of ["id_document", "proof_of_address", "bank_statement", "tax_return", "ssn_card", "articles_of_organization", "other"]) {
    assert.equal(shouldRunDocCheck({ kind: "client_upload", subtype }), true, subtype);
  }
});

test("onDocsReceivedDocCheck: a business bank statement is skipped before anything is looked up", async () => {
  const res = await onDocsReceivedDocCheck(null, event({
    kind: "client_upload", subtype: "business_bank_statement", document_id: "doc-1"
  }));
  assert.equal(res.done, false);
  assert.equal(res.reason, "not_doc_check_kind");
});

test("inquiry-docs handler and DOC-CHECK gate are different functions", () => {
  assert.notEqual(onDocsReceivedDocCheck, onDocsReceivedFlipInquiryGate);
  assert.equal(typeof onDocsReceivedFlipInquiryGate, "function");
});

test("onDocsReceivedDocCheck: inquiry_doc is skipped so the inquiry gate keeps that path", async () => {
  const res = await onDocsReceivedDocCheck(null, event({
    kind: "inquiry_doc", subtype: "id_document", document_id: "doc-1"
  }));
  assert.equal(res.done, false);
  assert.equal(res.reason, "not_doc_check_kind");
});

test("onDocsReceivedDocCheck: retired DOC-CHECK does not queue SMS-DOC-02", async () => {
  const { SMS_DOC_02 } = await import("./doc-check.mjs");
  const { pgFake } = await import("../workflows/test-support.mjs");
  const db = pgFake({
    clients: [{ id: CLIENT, org_id: ORG, email: "a@b.com", custom_fields: {} }],
    templates: [
      { org_id: ORG, template_key: SMS_DOC_02, channel: "sms", body: "got your upload — one thing needs fixing", compliance_passed: true }
    ]
  });
  const origQuery = db.query.bind(db);
  db.query = async (sql, params) => {
    if (/FROM agents/.test(sql)) {
      return { rows: [{
        code: AGENT_CODE,
        status: "retired",
        prompt: "You are the Document Check agent. Return JSON.",
        output_schema: { outcome: "accept, request_more, or hold" }
      }] };
    }
    return origQuery(sql, params);
  };
  let modelCalls = 0;
  const runs = [];
  const res = await onDocsReceivedDocCheck(db, event({
    kind: "client_upload",
    subtype: "id_document",
    document_id: "doc-1"
  }), {
    loadBytesImpl: async () => ({ buffer: Buffer.from("img"), mimeType: "image/png" }),
    callModelImpl: async () => {
      modelCalls += 1;
      return { mode: "live", text: JSON.stringify({ outcome: "request_more" }), error: null };
    },
    recordRunImpl: async (_db, row) => { runs.push(row); return row; }
  });
  assert.equal(res.done, false);
  assert.equal(res.reason, "doc_check_retired");
  assert.equal(modelCalls, 0);
  assert.equal(db.messages.length, 0);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].agentCode, AGENT_CODE);
  assert.equal(runs[0].outcome, "doc_check_retired");
});

test("onDocsReceivedDocCheck: draft DOC-CHECK does not run", async () => {
  const res = await onDocsReceivedDocCheck({
    async query(sql) {
      if (/FROM agents/.test(sql)) {
        return { rows: [{
          code: AGENT_CODE,
          status: "draft",
          prompt: "You are the Document Check agent. Return JSON."
        }] };
      }
      return { rows: [] };
    }
  }, event({
    kind: "client_upload",
    subtype: "id_document",
    document_id: "doc-1"
  }), {
    loadBytesImpl: async () => ({ buffer: Buffer.from("img"), mimeType: "image/png" }),
    callModelImpl: async () => {
      throw new Error("draft must not call the model");
    }
  });
  assert.equal(res.done, false);
  assert.equal(res.reason, "doc_check_not_live");
});

test("onDocsReceivedDocCheck: runs DOC-CHECK and does not send", async () => {
  const runs = [];
  const prompts = [];
  const db = {
    async query(sql) {
      if (/FROM agents/.test(sql)) {
        return { rows: [{
          code: AGENT_CODE,
          prompt: "You are the Document Check agent. Return JSON.",
          output_schema: { outcome: "accept, request_more, or hold" }
        }] };
      }
      if (/FROM clients/.test(sql) && /first_name/.test(sql)) {
        return { rows: [{
          first_name: "Chris",
          last_name: "Stanbridge",
          custom_fields: {
            address_line1: "1005 W Hudson Way",
            address_city: "Gilbert",
            address_state: "AZ",
            address_zip: "85233"
          }
        }] };
      }
      return { rows: [] };
    }
  };
  const res = await onDocsReceivedDocCheck(db, event({
    kind: "client_upload",
    subtype: "id_document",
    document_id: "doc-1",
    original_filename: "id.png"
  }), {
    loadBytesImpl: async () => ({ buffer: Buffer.from("img"), mimeType: "image/png" }),
    callModelImpl: async (args) => {
      prompts.push(args.user);
      return {
        mode: "shadow",
        text: JSON.stringify({ outcome: "accept", documents_reviewed: ["id"], issues: [] }),
        error: null
      };
    },
    recordRunImpl: async (_db, row) => { runs.push(row); return row; }
  });
  assert.equal(res.done, true);
  assert.equal(res.agent, AGENT_CODE);
  assert.equal(res.routed, true);
  assert.equal(res.json.outcome, "accept");
  assert.equal(runs.length, 1);
  assert.equal(runs[0].agentCode, AGENT_CODE);
  assert.equal(runs[0].triggerEvent, "docs.received");
  assert.equal(runs[0].outcome, "accept");
  assert.match(prompts[0], /1005 W Hudson Way/);
  assert.match(prompts[0], /Chris Stanbridge/);
  assert.match(prompts[0], /Today's date/);
});

test("clientContextLines: formats on-file address for the model", async () => {
  const { clientContextLines } = await import("./doc-check.mjs");
  const lines = clientContextLines({
    first_name: "Chris",
    last_name: "Stanbridge",
    custom_fields: {
      address_line1: "1005 W Hudson Way",
      address_city: "Gilbert",
      address_state: "AZ",
      address_zip: "85233"
    }
  });
  assert.ok(lines.some((l) => /Chris Stanbridge/.test(l)));
  assert.ok(lines.some((l) => /1005 W Hudson Way/.test(l)));
});

test("parseAgentJson reads fenced JSON", () => {
  const obj = parseAgentJson("```json\n{\"outcome\":\"request_more\"}\n```");
  assert.equal(obj.outcome, "request_more");
});

test("routeDocCheckOutcome: accept clears the document hold and sends DOC-03", async () => {
  const { routeDocCheckOutcome, EMAIL_DOC_03, SMS_DOC_03 } = await import("./doc-check.mjs");
  const { pgFake } = await import("../workflows/test-support.mjs");
  const { FUNDING_DOC_HOLD } = await import("../inquiry-ops/doc-gate.mjs");
  const db = pgFake({
    clients: [{ id: CLIENT, org_id: ORG, email: "a@b.com", custom_fields: { round_hold_reason: FUNDING_DOC_HOLD } }],
    templates: [
      { org_id: ORG, template_key: EMAIL_DOC_03, channel: "email", body: "ok", compliance_passed: true },
      { org_id: ORG, template_key: SMS_DOC_03, channel: "sms", body: "ok sms", compliance_passed: true }
    ]
  });
  const res = await routeDocCheckOutcome(db, {
    orgId: ORG, clientId: CLIENT, eventId: "e-acc", json: { outcome: "accept" }
  });
  assert.equal(res.routed, true);
  assert.equal(db.clients[0].custom_fields.round_hold_reason, null);
  assert.equal(db.clients[0].custom_fields.employee_next_action, "Optimize Profile");
  assert.deepEqual(db.messages.map((m) => m.template_key).sort(), [EMAIL_DOC_03, SMS_DOC_03].sort());
});

test("routeDocCheckOutcome: request_more keeps the gate and stores the agent note", async () => {
  const { routeDocCheckOutcome, SMS_DOC_02 } = await import("./doc-check.mjs");
  const { pgFake } = await import("../workflows/test-support.mjs");
  const { FUNDING_DOC_HOLD } = await import("../inquiry-ops/doc-gate.mjs");
  const db = pgFake({
    clients: [{ id: CLIENT, org_id: ORG, email: "a@b.com", custom_fields: { round_hold_reason: FUNDING_DOC_HOLD } }],
    templates: [
      { org_id: ORG, template_key: SMS_DOC_02, channel: "sms", body: "more", compliance_passed: true }
    ]
  });
  const res = await routeDocCheckOutcome(db, {
    orgId: ORG, clientId: CLIENT, eventId: "e-more",
    json: { outcome: "request_more", message_to_client: "Need a clearer ID photo" }
  });
  assert.equal(res.routed, true);
  assert.equal(res.gate, "closed");
  assert.equal(db.clients[0].custom_fields.round_hold_reason, FUNDING_DOC_HOLD);
  assert.equal(db.clients[0].custom_fields.doc_agent_message, "Need a clearer ID photo");
  assert.equal(db.messages.length, 1);
  assert.equal(db.messages[0].template_key, SMS_DOC_02);
});

test("routeDocCheckOutcome: an accept that read nothing records no identity", async () => {
  const { routeDocCheckOutcome, EMAIL_DOC_03, SMS_DOC_03 } = await import("./doc-check.mjs");
  const { pgFake } = await import("../workflows/test-support.mjs");
  const db = pgFake({
    clients: [{ id: CLIENT, org_id: ORG, email: "a@b.com", custom_fields: {} }],
    templates: [
      { org_id: ORG, template_key: EMAIL_DOC_03, channel: "email", body: "ok", compliance_passed: true },
      { org_id: ORG, template_key: SMS_DOC_03, channel: "sms", body: "ok sms", compliance_passed: true }
    ]
  });
  const res = await routeDocCheckOutcome(db, {
    orgId: ORG, clientId: CLIENT, eventId: "e-acc-none",
    documentId: "doc-1", versionId: "ver-1",
    json: { outcome: "accept", documents_reviewed: ["bank statement"], issues: [] }
  });
  assert.equal(res.routed, true);
  assert.equal(res.identity.written, false);
  assert.equal(res.identity.reason, "nothing_verified");
});

test("routeDocCheckOutcome: request_more never records an identity, whatever the model read", async () => {
  const { routeDocCheckOutcome, SMS_DOC_02 } = await import("./doc-check.mjs");
  const { pgFake } = await import("../workflows/test-support.mjs");
  const db = pgFake({
    clients: [{ id: CLIENT, org_id: ORG, email: "a@b.com", custom_fields: {} }],
    templates: [
      { org_id: ORG, template_key: SMS_DOC_02, channel: "sms", body: "more", compliance_passed: true }
    ]
  });
  const seen = [];
  const orig = db.query.bind(db);
  db.query = async (sql, params) => { seen.push(sql); return orig(sql, params); };
  const res = await routeDocCheckOutcome(db, {
    orgId: ORG, clientId: CLIENT, eventId: "e-more-2",
    documentId: "doc-1", versionId: "ver-1",
    json: {
      outcome: "request_more",
      message_to_client: "retake it",
      verified_legal_name: "Christopher John Stanbridge",
      verified_address: { line1: "1005 W Hudson Way" },
      verified_date_of_birth: "1985-04-02"
    }
  });
  assert.equal(res.routed, true);
  assert.equal(res.identity, undefined);
  assert.equal(seen.some((s) => /pii_identity/.test(s)), false,
    "a document the agent refused proves nothing and must not reach pii_identity");
});

/* ── THE READER WITH NO CREDIT ────────────────────────────────────────────
 *
 * Measured in production on 2026-09-17: twelve DOC-CHECK runs, every one of
 * them `openai 429 … You have no credits remaining`, every one recorded as if
 * it were the end of the story. These are the tests that say it is not. */

function readerFailureDb() {
  return {
    async query(sql) {
      if (/FROM agents/.test(sql)) {
        return { rows: [{ code: AGENT_CODE, prompt: "Read the document.", output_schema: null }] };
      }
      if (/FROM clients/.test(sql) && /first_name/.test(sql)) {
        return { rows: [{ first_name: "Chris", last_name: "Stanbridge", custom_fields: {} }] };
      }
      return { rows: [] };
    }
  };
}

const READER_PAYLOAD = {
  kind: "client_upload",
  subtype: "id_document",
  document_id: "doc-429",
  original_filename: "licence.png"
};

test("an empty AI account is queued for another read, not written off", async () => {
  const queued = [];
  const runs = [];
  const res = await onDocsReceivedDocCheck(readerFailureDb(), event(READER_PAYLOAD), {
    loadBytesImpl: async () => ({ buffer: Buffer.from("img"), mimeType: "image/png", versionId: "ver-1" }),
    callModelImpl: async () => ({
      mode: "live",
      text: null,
      status: 429,
      error: 'openai 429: {"error":{"message":"You have no credits remaining. Add credits to continue"}}'
    }),
    recordRunImpl: async (_db, row) => { runs.push(row); return row; },
    queueRetryImpl: async (_db, spec) => { queued.push(spec); return { queued: true, id: "fe-1", attempts: 1, status: "pending" }; },
    routeImpl: async () => { throw new Error("must not route a document nobody read"); }
  });

  assert.equal(res.routed, false, "a 429 is not a verdict, so nothing routes");
  assert.equal(res.json, null);
  assert.equal(res.route.reason, "reader_unavailable_queued");
  assert.equal(res.route.temporary, true);
  assert.equal(res.route.failure, "no_credit");

  assert.equal(queued.length, 1, "the document goes on the queue for a later read");
  assert.equal(queued[0].eventId, "evt-doc-1");
  assert.equal(queued[0].documentId, "doc-429");
  assert.equal(queued[0].versionId, "ver-1", "the retry reads the same version this run tried");
  assert.equal(queued[0].payload.subtype, "id_document");

  // The reason stays visible: the run says 429 out loud, it is not swallowed.
  assert.equal(runs.length, 1);
  assert.match(runs[0].outcome, /429/);
});

test("a queued document tells a person it is waiting, and does not claim nobody will read it", async () => {
  const tasks = [];
  const db = readerFailureDb();
  const origQuery = db.query.bind(db);
  db.query = async (sql, params) => {
    if (/INSERT INTO tasks/i.test(sql)) { tasks.push({ sql, params }); return { rows: [{ id: "t-1" }] }; }
    if (/FROM tasks/i.test(sql)) return { rows: [] };
    return origQuery(sql, params);
  };
  const res = await onDocsReceivedDocCheck(db, event(READER_PAYLOAD), {
    loadBytesImpl: async () => ({ buffer: Buffer.from("img"), mimeType: "image/png" }),
    callModelImpl: async () => ({
      mode: "live", text: null, status: 429,
      error: 'openai 429: {"error":{"message":"You have no credits remaining"}}'
    }),
    recordRunImpl: async () => null,
    queueRetryImpl: async () => ({ queued: true, id: "fe-1", attempts: 1, status: "pending" })
  });
  assert.equal(res.route.reason, "reader_unavailable_queued");
  // createTask's INSERT puts the title in the third parameter.
  const title = String(tasks[0]?.params?.[2] || "");
  assert.match(title, /Waiting on the document reader/,
    "a task that says 'check it by hand' would be a lie while the robot is still coming back");
  // The retry sweeper closes this task by its title once the reader answers
  // (closeAnsweredWaits). If the two drift apart the task never closes and the
  // file says "not read yet" forever — hole N4 on live, 2026-09-18.
  assert.ok(title.startsWith(WAITING_TASK_TITLE_PREFIX), title);
  // …and it finds the task by the document it names.
  const body = String(tasks[0]?.params?.[3] || "");
  assert.match(body, /Document: doc-429/);
});

test("a failure that waiting cannot fix is NOT queued — it still goes to a person", async () => {
  const queued = [];
  const res = await onDocsReceivedDocCheck(readerFailureDb(), event(READER_PAYLOAD), {
    loadBytesImpl: async () => ({ buffer: Buffer.from("img"), mimeType: "image/png" }),
    // A live answer that is simply not the JSON it was asked for. Waiting
    // changes nothing about that, so it must not sit in a retry queue.
    callModelImpl: async () => ({ mode: "live", text: "I am not sure what this is.", error: null }),
    recordRunImpl: async () => null,
    queueRetryImpl: async (_db, spec) => { queued.push(spec); return { queued: true }; }
  });
  assert.equal(queued.length, 0);
  assert.equal(res.route.reason, "no_json");
  assert.equal(res.route.temporary, false);
});

test("a 429 never writes an identity — a wrong name is worse than a late one", async () => {
  const writes = [];
  const db = readerFailureDb();
  const origQuery = db.query.bind(db);
  db.query = async (sql, params) => {
    if (/pii_identity/i.test(sql)) writes.push(sql);
    return origQuery(sql, params);
  };
  await onDocsReceivedDocCheck(db, event(READER_PAYLOAD), {
    loadBytesImpl: async () => ({ buffer: Buffer.from("img"), mimeType: "image/png" }),
    callModelImpl: async () => ({
      mode: "live", text: null, status: 429,
      error: 'openai 429: {"error":{"message":"You have no credits remaining"}}'
    }),
    recordRunImpl: async () => null,
    queueRetryImpl: async () => ({ queued: true, id: "fe-1" })
  });
  assert.deepEqual(writes, [], "nothing was read, so nothing may be recorded as verified");
});

/* ── THE BACKUP READER ────────────────────────────────────────────────────
 *
 * Measured on live 2026-09-18, hole 16: OpenAI had no credit, the Anthropic key
 * production holds worked, and the ID still sat unread with no chase text,
 * because nothing asked the second reader. */

const OPENAI_NO_CREDIT = {
  mode: "live", text: null, status: 429,
  request: { provider: "openai" },
  error: 'openai 429: {"error":{"message":"You have no credits remaining. Add credits to continue"}}'
};
const BOTH_KEYS = { OPENAI_API_KEY: "sk-test-openai", ANTHROPIC_API_KEY: "sk-ant-test" };

test("an empty OpenAI wallet is read by the backup reader, and its verdict routes", async () => {
  const calls = [];
  const routed = [];
  const queued = [];
  const runs = [];
  const res = await onDocsReceivedDocCheck(readerFailureDb(), event(READER_PAYLOAD), {
    env: BOTH_KEYS,
    loadBytesImpl: async () => ({ buffer: Buffer.from("img"), mimeType: "image/png", versionId: "ver-1" }),
    callModelImpl: async (args) => {
      calls.push(args);
      return calls.length === 1
        ? OPENAI_NO_CREDIT
        : { mode: "live", text: JSON.stringify({ outcome: "request_more", message_to_client: "Retake it" }), error: null, request: { provider: "anthropic" } };
    },
    recordRunImpl: async (_db, row) => { runs.push(row); return row; },
    queueRetryImpl: async (_db, spec) => { queued.push(spec); return { queued: true }; },
    routeImpl: async (_db, spec) => { routed.push(spec); return { routed: true, outcome: spec.json.outcome }; }
  });

  assert.equal(calls.length, 2, "the same file is read a second time");
  assert.equal(calls[0].env.OPENAI_API_KEY, "sk-test-openai");
  assert.equal(calls[1].env.OPENAI_API_KEY, undefined, "the second read goes to the other reader");
  assert.equal(calls[1].env.ANTHROPIC_API_KEY, "sk-ant-test");
  assert.equal(calls[1].media, calls[0].media, "it reads the same picture");
  assert.equal(BOTH_KEYS.OPENAI_API_KEY, "sk-test-openai", "the stored key is never removed");

  assert.equal(res.routed, true, "a verdict means the chase (or the approval) can go out");
  assert.equal(routed.length, 1);
  assert.equal(routed[0].json.outcome, "request_more");
  assert.equal(queued.length, 0, "a document that was read is not queued");
  assert.equal(runs[0].outcome, "request_more");
  assert.match(runs[0].detail, /backup reader \(anthropic\) because openai has no credit/);
});

test("a backup reader that also fails leaves the document queued exactly as before", async () => {
  const queued = [];
  let n = 0;
  const res = await onDocsReceivedDocCheck(readerFailureDb(), event(READER_PAYLOAD), {
    env: BOTH_KEYS,
    loadBytesImpl: async () => ({ buffer: Buffer.from("img"), mimeType: "image/png" }),
    callModelImpl: async () => (++n === 1
      ? OPENAI_NO_CREDIT
      : { mode: "live", text: null, status: 529, error: "anthropic 529: overloaded", request: { provider: "anthropic" } }),
    recordRunImpl: async () => null,
    queueRetryImpl: async (_db, spec) => { queued.push(spec); return { queued: true }; },
    routeImpl: async () => { throw new Error("must not route a document nobody read"); }
  });
  assert.equal(n, 2);
  assert.equal(res.route.reason, "reader_unavailable_queued");
  assert.equal(res.route.failure, "no_credit", "the first reason stands");
  assert.equal(queued.length, 1);
});

test("with no Anthropic key there is no second read — the document is queued", async () => {
  const queued = [];
  let n = 0;
  const res = await onDocsReceivedDocCheck(readerFailureDb(), event(READER_PAYLOAD), {
    env: { OPENAI_API_KEY: "sk-test-openai" },
    loadBytesImpl: async () => ({ buffer: Buffer.from("img"), mimeType: "image/png" }),
    callModelImpl: async () => { n++; return OPENAI_NO_CREDIT; },
    recordRunImpl: async () => null,
    queueRetryImpl: async (_db, spec) => { queued.push(spec); return { queued: true }; }
  });
  assert.equal(n, 1);
  assert.equal(res.route.reason, "reader_unavailable_queued");
  assert.equal(queued.length, 1);
});

test("the backup reader is only for an EMPTY wallet, not for a key OpenAI refused", async () => {
  let n = 0;
  const res = await onDocsReceivedDocCheck(readerFailureDb(), event(READER_PAYLOAD), {
    env: BOTH_KEYS,
    loadBytesImpl: async () => ({ buffer: Buffer.from("img"), mimeType: "image/png" }),
    callModelImpl: async () => {
      n++;
      return { mode: "live", text: null, status: 400, request: { provider: "openai" }, error: "openai 400: bad request" };
    },
    recordRunImpl: async () => null,
    queueRetryImpl: async () => ({ queued: true })
  });
  assert.equal(n, 1);
  assert.equal(res.route.reason, "no_json");
});

test("a retry records its own run row rather than being swallowed by the event unique index", async () => {
  const runs = [];
  await onDocsReceivedDocCheck(readerFailureDb(), { ...event(READER_PAYLOAD), isRetry: true }, {
    loadBytesImpl: async () => ({ buffer: Buffer.from("img"), mimeType: "image/png" }),
    callModelImpl: async () => ({ mode: "live", text: JSON.stringify({ outcome: "hold", hold_reason: "needs review" }), error: null }),
    recordRunImpl: async (_db, row) => { runs.push(row); return row; },
    routeImpl: async () => ({ routed: true, outcome: "hold" })
  });
  assert.equal(runs.length, 1);
  assert.equal(runs[0].eventId, null,
    "agent_runs is unique on (org, event, agent) — a retry reusing the event id would be dropped");
  assert.match(runs[0].detail, /^retry of evt-doc-1:/);
  assert.equal(runs[0].outcome, "hold");
});

test("queueReaderRetry refuses to queue without an event id, and says so", async () => {
  const { queueReaderRetry } = await import("./doc-check.mjs");
  const res = await queueReaderRetry(null, { orgId: ORG, clientId: CLIENT, eventId: null });
  assert.deepEqual(res, { queued: false, reason: "no_event_id" });
});

test("queueReaderRetry asks for twelve attempts, not the dead-letter default of seven", async () => {
  const { queueReaderRetry, RETRY_HANDLER, RETRY_MAX_ATTEMPTS } = await import("./doc-check.mjs");
  const seen = [];
  const res = await queueReaderRetry(null, {
    orgId: ORG, clientId: CLIENT, eventId: "evt-doc-1",
    payload: { subtype: "id_document" }, documentId: "doc-429", versionId: "ver-1",
    reason: "no_credit", error: "openai 429",
    recordImpl: async (_db, spec) => { seen.push(spec); return { ok: true, id: "fe-1", attempts: 1, status: "pending" }; }
  });
  assert.equal(res.queued, true);
  assert.equal(seen[0].handler, RETRY_HANDLER);
  assert.equal(seen[0].maxAttempts, RETRY_MAX_ATTEMPTS);
  assert.equal(RETRY_MAX_ATTEMPTS, 12);
  assert.equal(seen[0].payload.document_id, "doc-429");
  assert.equal(seen[0].payload.version_id, "ver-1");
});

test("a queue write that fails does not fail the upload — the person is still told", async () => {
  const { queueReaderRetry } = await import("./doc-check.mjs");
  const res = await queueReaderRetry(null, {
    orgId: ORG, clientId: CLIENT, eventId: "evt-doc-1",
    recordImpl: async () => ({ ok: false, error: "relation failed_events does not exist" })
  });
  assert.equal(res.queued, false);
  assert.equal(res.reason, "queue_write_failed");
});
