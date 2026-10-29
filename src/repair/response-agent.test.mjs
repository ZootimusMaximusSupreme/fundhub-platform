import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseAgentJson, mediaFromBytes, processBureauResponse, onBureauResponseDocsReceived, RETAKE_TEMPLATE_KEY } from "./response-agent.mjs";
import { runParseAdvanceLoop, confirmHeldParse } from "./parse-loop.mjs";

const ORG = "11111111-1111-1111-1111-111111111111";
const CLIENT = "22222222-2222-2222-2222-222222222222";
const DOC_OK = "66666666-6666-4666-8666-666666666666";
const DOC_BLUR = "77777777-7777-4777-8777-777777777777";
const CASE_ID = "33333333-3333-3333-3333-333333333333";
const ITEM_ID = "44444444-4444-4444-4444-444444444444";
const CLEAR = "Experian response for account ending 4521: the item has been deleted from your file. Account 4521 deleted.";
const OPEN_ITEMS = [{ id: ITEM_ID, case_id: CASE_ID, creditor: "Midland", account_last4: "4521", round: "R1", status: "sent" }];

function fakeDb() {
  const responses = [], itemUpdates = [];
  return {
    responses, itemUpdates,
    async query(sql, params = []) {
      const s = String(sql);
      if (s.includes("FROM documents d") && s.includes("d.kind = $4")) return { rows: [{ id: params[0] }] };
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
      callModelImpl: async () => ({ mode: "live", text: JSON.stringify({ quality: "pass", text: CLEAR, bureau_guess: "EX", message_to_client: "" }), error: null }),
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
