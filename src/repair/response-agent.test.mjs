import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseAgentJson, mediaFromBytes, processBureauResponse, onBureauResponseDocsReceived, RETAKE_TEMPLATE_KEY } from "./response-agent.mjs";
import { runParseAdvanceLoop, confirmHeldParse } from "./parse-loop.mjs";

const ORG = "11111111-1111-1111-1111-111111111111";
const CLIENT = "22222222-2222-2222-2222-222222222222";
const DOC_OK = "66666666-6666-4666-8666-666666666666";
const DOC_BLUR = "77777777-7777-4777-8777-777777777777";
const VERSION = "88888888-8888-4888-8888-888888888888";
const CASE_ID = "33333333-3333-3333-3333-333333333333";
const ITEM_ID = "44444444-4444-4444-4444-444444444444";
const CLEAR = "Experian response for account ending 4521: the item has been deleted from your file. Account 4521 deleted.";
const OPEN_ITEMS = [{ id: ITEM_ID, case_id: CASE_ID, creditor: "Midland", account_last4: "4521", round: "R1", status: "sent", bureau: "EX" }];
const accepted = (extra = {}) => ({ quality: "pass", text: CLEAR, bureau_guess: "EX", document_type: "bureau_response", recipient_name: "Alex Buyer", authenticity: "clear", ...extra });

function fakeDb() {
  const responses = [], itemUpdates = [], documents = new Map(), tasks = [];
  return {
    responses, itemUpdates, documents, tasks,
    async query(sql, params = []) {
      const s = String(sql);
      if (s.includes("FROM documents d") && s.includes("d.kind = $4")) {
        const doc = documents.get(params[0]) || { id: params[0], current_version_id: VERSION, metadata: {} };
        documents.set(params[0], doc);
        return { rows: params[4] && params[4] !== doc.current_version_id ? [] : [structuredClone(doc)] };
      }
      if (s.includes("FROM clients WHERE")) return { rows: [{ first_name: "Alex", last_name: "Buyer" }] };
      if (s.includes("SELECT id, kind, current_version_id, metadata FROM documents")) {
        const doc = documents.get(params[0]);
        return { rows: doc && doc.current_version_id === params[3] ? [structuredClone(doc)] : [] };
      }
      if (s.startsWith("UPDATE documents SET metadata")) {
        const doc = documents.get(params[0]);
        if (!doc || doc.current_version_id !== params[3]) return { rows: [] };
        doc.metadata.bureau_response_validation = JSON.parse(params[4]);
        return { rows: [{ id: doc.id }] };
      }
      if (s.includes("INSERT INTO tasks")) { tasks.push(params); return { rows: [{ id: "review-task" }] }; }
      if (s.includes("FROM dispute_items")) return { rows: OPEN_ITEMS.map((r) => ({ ...r })) };
      if (s.includes("INSERT INTO dispute_responses")) {
        const row = { id: "resp-" + (responses.length + 1), case_id: params[0], org_id: params[1], client_id: params[2], raw_text: params[3], parse_json: JSON.parse(params[4]), confidence: params[5], confirmed: params[6], confirmed_by: params[7] };
        responses.push(row); return { rows: [row] };
      }
      if (s.includes("UPDATE dispute_items")) { itemUpdates.push({ id: params[0], status: params[1], round: params[2], outcome: params[3] }); return { rows: [] }; }
      if (s.includes("INSERT INTO repair_decision_log")) return { rows: [] };
      if (s.includes("FROM dispute_responses")) return { rows: responses.filter((r) => r.id === params[0]) };
      if (s.includes("UPDATE dispute_responses")) { const row = responses.find((r) => r.id === params[0]); if (row) { row.confirmed = true; row.confirmed_by = params[1]; } return { rows: [] }; }
      return { rows: [] };
    }
  };
}

describe("C1/C2 bureau-response agent shapes", () => {
  it("parseAgentJson accepts pass and retake", () => {
    assert.equal(parseAgentJson(JSON.stringify({ quality: "pass", text: CLEAR, bureau_guess: "EX", message_to_client: "" })).quality, "pass");
    assert.equal(parseAgentJson(JSON.stringify({ quality: "retake", text: "", bureau_guess: "unknown", message_to_client: "retake please" })).quality, "retake");
  });
  it("mediaFromBytes maps image and pdf", () => {
    assert.equal(mediaFromBytes("image/jpeg", Buffer.from("x"))[0].type, "image");
    assert.equal(mediaFromBytes("application/pdf", Buffer.from("%PDF"))[0].type, "document");
  });
  it("C1 clear letter auto-advances", async () => {
    const db = fakeDb();
    const result = await processBureauResponse(db, {
      orgId: ORG, clientId: CLIENT, documentId: DOC_OK, bytes: Buffer.from("clear"), mimeType: "image/jpeg", items: OPEN_ITEMS,
      callModelImpl: async () => ({ mode: "live", text: JSON.stringify(accepted()), error: null }),
      sendTemplatedImpl: async () => ({ sent: true }), onEvent: async () => ({})
    });
    assert.equal(result.status, "advanced");
    assert.equal(result.parse.outcomes[0].outcome, "deleted");
    assert.ok(result.parse.confidence >= 0.85);
    assert.equal(db.itemUpdates[0].status, "deleted");
    assert.equal(db.responses[0].confirmed_by, null);
    assert.notEqual(db.responses[0].confirmed_by, "system_high_confidence");
  });
  it("high-confidence auto-parse does not store system_high_confidence as a staff id", async () => {
    const db = fakeDb();
    const result = await runParseAdvanceLoop(db, {
      orgId: ORG, clientId: CLIENT, text: CLEAR, items: OPEN_ITEMS,
      confirmedBy: "system_high_confidence", onEvent: async () => ({})
    });
    assert.equal(result.status, "advanced");
    assert.ok(result.parseResult.confidence >= 0.85);
    assert.equal(db.responses[0].confirmed, true);
    assert.equal(db.responses[0].confirmed_by, null);
  });
  it("C1 low confidence held then confirm advances", async () => {
    const db = fakeDb();
    const held = await runParseAdvanceLoop(db, { orgId: ORG, clientId: CLIENT, text: "We received your letter about Midland.", items: OPEN_ITEMS, onEvent: async () => ({}) });
    assert.equal(held.status, "held");
    const confirmed = await confirmHeldParse(db, { orgId: ORG, responseId: held.responseId, confirmedBy: "staff-1", confirmedOutcomes: [{ itemId: ITEM_ID, outcome: "verified" }], onEvent: async () => ({}) });
    assert.equal(confirmed.status, "advanced");
    assert.equal(db.itemUpdates[0].status, "escalated");
  });
  it("C2 blurry retake no parse", async () => {
    const db = fakeDb(); const emails = [];
    const result = await processBureauResponse(db, {
      orgId: ORG, clientId: CLIENT, documentId: DOC_BLUR, bytes: Buffer.from("b"), mimeType: "image/jpeg", items: OPEN_ITEMS,
      callModelImpl: async () => ({ mode: "live", text: JSON.stringify({ quality: "retake", text: "", bureau_guess: "unknown", message_to_client: "blurry — retake" }), error: null }),
      sendTemplatedImpl: async (_d, a) => { emails.push(a); return { sent: false }; }, onEvent: async () => ({})
    });
    assert.equal(result.status, "retake");
    assert.equal(result.parse, null);
    assert.equal(db.itemUpdates.length, 0);
    assert.equal(emails[0].templateKey, RETAKE_TEMPLATE_KEY);
  });
  it("skips non-bureau docs.received", async () => {
    const r = await onBureauResponseDocsReceived(null, { orgId: ORG, clientId: CLIENT, payload: { kind: "client_upload", document_id: "x" } });
    assert.equal(r.skipped, true);
  });
});

describe("current file validation before progress or another round", () => {
  const run = (db, answer = accepted(), extra = {}) => processBureauResponse(db, {
    orgId: ORG, clientId: CLIENT, documentId: DOC_OK, versionId: VERSION,
    bytes: Buffer.from("synthetic document bytes"), mimeType: "image/jpeg", items: OPEN_ITEMS,
    callModelImpl: async args => {
      assert.doesNotMatch(args.user, /Alex Buyer/, "saved client identity is compared locally, not added to the provider payload");
      return { text: JSON.stringify(answer) };
    }, sendTemplatedImpl: async () => ({ queued: true }), onEvent: async () => ({}), ...extra
  });
  it("wrong client cannot pass even when the model claims client_match=match", async () => {
    const db = fakeDb();
    const out = await run(db, accepted({ recipient_name: "Someone Else", client_match: "match" }));
    assert.equal(out.status, "held");
    assert.equal(out.validation.client_match, "mismatch");
    assert.equal(out.validation.status, "hold");
    assert.equal(db.itemUpdates.length, 0);
    assert.equal(db.responses.length, 0);
    assert.equal(db.tasks.length, 1);
  });
  for (const [label, fields, status] of [
    ["sample", { document_type: "sample" }, "request_more"],
    ["wrong document type", { document_type: "other" }, "request_more"],
    ["uncertain quality", { quality: "maybe" }, "hold"],
    ["suspected alteration", { authenticity: "suspected_altered" }, "hold"],
    ["uncertain authenticity", { authenticity: "uncertain" }, "hold"],
    ["missing recipient", { recipient_name: "" }, "hold"],
    ["unknown bureau", { bureau_guess: "unknown" }, "hold"]
  ]) it(`${label} cannot advance or become accepted evidence`, async () => {
    const db = fakeDb(); const out = await run(db, accepted(fields));
    assert.equal(out.validation.status, status);
    assert.equal(db.itemUpdates.length, 0); assert.equal(db.responses.length, 0);
  });
  it("an old version refuses before calling the model", async () => {
    const db = fakeDb(); let calls = 0;
    const out = await run(db, accepted(), { versionId: CASE_ID, callModelImpl: async () => { calls++; } });
    assert.equal(out.reason, "bureau_response_document_unavailable"); assert.equal(calls, 0);
  });
  it("a version replaced while bytes load refuses before the provider call", async () => {
    const db = fakeDb(); let calls = 0;
    const out = await run(db, accepted(), { bytes: null, loadBytesImpl: async () => {
      db.documents.get(DOC_OK).current_version_id = CASE_ID;
      return { buffer: Buffer.from("old bytes"), mimeType: "image/jpeg" };
    }, callModelImpl: async () => { calls++; } });
    assert.equal(out.reason, "bureau_response_version_changed"); assert.equal(calls, 0); assert.equal(db.itemUpdates.length, 0);
  });
  it("a replacement during the model read cannot save acceptance or advance", async () => {
    const db = fakeDb();
    const out = await run(db, accepted(), { callModelImpl: async () => {
      db.documents.get(DOC_OK).current_version_id = CASE_ID;
      return { text: JSON.stringify(accepted()) };
    } });
    assert.equal(out.reason, "bureau_response_version_changed"); assert.equal(db.itemUpdates.length, 0);
    assert.equal(db.documents.get(DOC_OK).metadata.bureau_response_validation, undefined);
  });
  it("same-version replay reuses the saved verdict without another model read or item update", async () => {
    const db = fakeDb(); let calls = 0;
    const extra = { callModelImpl: async () => { calls++; return { text: JSON.stringify(accepted()) }; } };
    await run(db, accepted(), extra); const again = await run(db, accepted(), extra);
    assert.equal(again.cached, true); assert.equal(calls, 1);
    assert.equal(db.responses.length, 1); assert.equal(db.itemUpdates.length, 1);
    const saved = db.documents.get(DOC_OK).metadata.bureau_response_validation;
    assert.equal(saved.version_id, VERSION); assert.equal(saved.document_id, DOC_OK);
    assert.equal(saved.status, "accepted"); assert.equal(db.responses[0].parse_json.document_validation.version_id, VERSION);
  });
  it("a failed current-version conditional write cannot advance or notify", async () => {
    const db = fakeDb(), query = db.query.bind(db); let messages = 0;
    db.query = async (sql, params) => sql.startsWith("UPDATE documents SET metadata") ? { rows: [] } : query(sql, params);
    const out = await run(db, accepted(), { sendTemplatedImpl: async () => { messages++; } });
    assert.equal(out.reason, "bureau_response_version_changed");
    assert.equal(db.itemUpdates.length, 0); assert.equal(db.responses.length, 0); assert.equal(messages, 0);
  });
  it("an unavailable reader fails for retry without claiming a verdict or advancing", async () => {
    const db = fakeDb();
    await assert.rejects(run(db, accepted(), { callModelImpl: async () => ({ text: null, error: "temporary provider failure" }) }), /bureau_response_reader_unavailable/);
    assert.equal(db.itemUpdates.length, 0); assert.equal(db.responses.length, 0);
    assert.equal(db.documents.get(DOC_OK).metadata.bureau_response_validation, undefined);
  });
  it("human confirmation rechecks the exact accepted source version", async () => {
    const db = fakeDb();
    const held = await run(db, accepted({ text: "Experian acknowledges receiving your letter." }));
    assert.equal(held.status, "held");
    db.documents.get(DOC_OK).current_version_id = CASE_ID;
    const out = await confirmHeldParse(db, { orgId: ORG, responseId: held.responseId, confirmedBy: CASE_ID,
      confirmedOutcomes: [{ itemId: ITEM_ID, outcome: "deleted" }] });
    assert.equal(out.reason, "source_document_not_validated"); assert.equal(db.itemUpdates.length, 0);
  });
  it("a paid Blueprint file with no matching repair case receives a team task without creating or advancing a round", async () => {
    const db = fakeDb(); let events = 0;
    const out = await run(db, accepted(), { items: [], onEvent: async () => { events++; } });
    assert.equal(out.status, "reviewed"); assert.equal(out.validation.status, "accepted");
    assert.equal(out.reason, "team_review_required"); assert.equal(db.tasks.length, 1);
    assert.equal(db.itemUpdates.length, 0); assert.equal(db.responses.length, 0); assert.equal(events, 0);
  });
  it("a different bureau or unmatched account is sent for review rather than applied to unrelated items", async () => {
    const db = fakeDb(); const out = await run(db, accepted({ bureau_guess: "TU", text: "A different account was deleted." }));
    assert.equal(out.status, "reviewed"); assert.equal(db.itemUpdates.length, 0); assert.equal(db.responses.length, 0);
  });
  it("generic deletion words without this account are held visibly even when the text parser is confident", async () => {
    const db = fakeDb(); const out = await run(db, accepted({ text: "An unrelated account has been deleted." }));
    assert.equal(out.status, "held"); assert.equal(out.validation.status, "accepted");
    assert.ok(out.parse.confidence >= 0.85, "exercise the misleading high-confidence heuristic");
    assert.equal(db.responses[0].parse_json.requiresHumanReview, true); assert.equal(db.responses[0].confirmed, false);
    assert.equal(db.itemUpdates.length, 0);
  });
  it("pasted text stays held and a confirm click cannot replace source-document validation", async () => {
    const db = fakeDb();
    const held = await runParseAdvanceLoop(db, { orgId: ORG, clientId: CLIENT, text: CLEAR, items: OPEN_ITEMS,
      requireDocumentValidation: true, onEvent: async () => ({}) });
    assert.equal(held.status, "held"); assert.equal(held.parseResult.requiresDocumentValidation, true);
    assert.equal(db.responses[0].confirmed, false); assert.equal(db.itemUpdates.length, 0);
    const out = await confirmHeldParse(db, { orgId: ORG, responseId: held.responseId, confirmedBy: CASE_ID });
    assert.equal(out.reason, "source_document_required"); assert.equal(db.itemUpdates.length, 0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// A MACHINE MAY NOT CARRY A CLIENT INTO R4
//
// COMPLIANCE REVIEW REQUIRED — dispute logic.
//
// "C1 clear letter auto-advances" above is intended behaviour and stays. But it
// runs on an R1 item. The same confident read on an R3 item would cross into R4,
// where the CFPB and state attorney general complaints — signed by the consumer
// under penalty of perjury — are released into their pack.
//
// Owner-set 2026-08-28: that crossing needs a person.
// ═══════════════════════════════════════════════════════════════════════════════

const R3_ITEMS = [{
  id: ITEM_ID, case_id: CASE_ID, creditor: "Midland",
  account_last4: "4521", round: "R3", status: "sent"
}];
const VERIFIED_TEXT = "Experian response for account ending 4521: the item was verified as accurate. Account 4521 verified.";
const STAFF_ID = "55555555-5555-5555-5555-555555555555";

function r3Db() {
  const db = fakeDb();
  const inner = db.query.bind(db);
  db.query = async (sql, params = []) => {
    if (String(sql).includes("FROM dispute_items")) return { rows: R3_ITEMS.map((r) => ({ ...r })) };
    return inner(sql, params);
  };
  return db;
}

describe("crossing into R4 needs a person, end to end", () => {
  it("A CONFIDENT MACHINE READ OF AN R3 ANSWER DOES NOT REACH R4", async () => {
    const db = r3Db();
    const out = await runParseAdvanceLoop(db, {
      orgId: ORG, clientId: CLIENT, text: VERIFIED_TEXT, items: R3_ITEMS, onEvent: async () => ({})
    });
    assert.ok(out.parseResult.confidence >= 0.85,
      "this fixture must be a CONFIDENT read — otherwise it proves nothing new");
    assert.equal(out.status, "held", "a confident R3 verify auto-advanced into R4");
    assert.equal(out.heldForEscalation, true);
    assert.equal(db.itemUpdates.length, 0, "no item may be written on the way to R4");
  });

  it("the held parse lands where a person will see it", async () => {
    const db = r3Db();
    const out = await runParseAdvanceLoop(db, {
      orgId: ORG, clientId: CLIENT, text: VERIFIED_TEXT, items: R3_ITEMS, onEvent: async () => ({})
    });
    const row = db.responses.find((r) => r.id === out.responseId);
    assert.equal(row.confirmed, false, "an unconfirmed crossing must not be stored as confirmed");
    assert.equal(row.confirmed_by, null);
    // The exceptions queue lists parses under 0.85 OR stamped heldForEscalation.
    // This one is above the threshold, so the stamp is the only thing that shows
    // it to anybody. api/repair/exceptions.mjs reads exactly this key.
    assert.equal(row.parse_json.heldForEscalation, true,
      "without this stamp the held parse is invisible on the exceptions screen");
  });

  it("A PERSON CONFIRMING IT DOES REACH R4", async () => {
    const db = r3Db();
    const held = await runParseAdvanceLoop(db, {
      orgId: ORG, clientId: CLIENT, text: VERIFIED_TEXT, items: R3_ITEMS, onEvent: async () => ({})
    });
    const confirmed = await confirmHeldParse(db, {
      orgId: ORG, responseId: held.responseId, confirmedBy: STAFF_ID,
      confirmedOutcomes: [{ itemId: ITEM_ID, outcome: "verified" }], onEvent: async () => ({})
    });
    assert.equal(confirmed.status, "advanced");
    assert.equal(db.itemUpdates[0].status, "escalated");
    assert.equal(db.itemUpdates[0].round, "R4", "a confirmed R3 answer must reach R4");
  });

  it("A SYSTEM SENTINEL IS NOT A PERSON, EVEN THROUGH THE CONFIRM PATH", async () => {
    const db = r3Db();
    const held = await runParseAdvanceLoop(db, {
      orgId: ORG, clientId: CLIENT, text: VERIFIED_TEXT, items: R3_ITEMS, onEvent: async () => ({})
    });
    const out = await confirmHeldParse(db, {
      orgId: ORG, responseId: held.responseId, confirmedBy: "system_high_confidence",
      confirmedOutcomes: [{ itemId: ITEM_ID, outcome: "verified" }], onEvent: async () => ({})
    });
    assert.equal(out.ok, false, "a sentinel bought an escalation");
    assert.equal(out.reason, "escalation_needs_human");
    assert.equal(db.itemUpdates.length, 0);
  });

  it("R1 STILL AUTO-ADVANCES THROUGH THE SAME PATH — nothing was broken", async () => {
    // The regression guard. If this ever goes red, the gate leaked down the ladder.
    const db = fakeDb();
    const out = await runParseAdvanceLoop(db, {
      orgId: ORG, clientId: CLIENT,
      text: "Experian response for account ending 4521: the item was verified as accurate. Account 4521 verified.",
      items: OPEN_ITEMS, onEvent: async () => ({})
    });
    assert.equal(out.status, "advanced", "an R1 item stopped advancing on its own");
    assert.equal(db.itemUpdates[0].round, "R2");
    assert.equal(db.responses[0].confirmed_by, null, "R1 still needs no person");
  });
});
