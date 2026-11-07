import { test } from "node:test";
import assert from "node:assert/strict";
import { currentClientRepairRound, generateClientRepairLetters, readClientRepair, recordClientRepairSubmission } from "./client-repair.mjs";
import handler from "../../api/blueprint/repair.mjs";

const id = "11111111-1111-4111-8111-111111111111";
const scope = { orgId: id, clientId: id, accountId: id, engagement: { id, status: "active", executionOwner: "client" } };
function response() { return { statusCode: 200, setHeader() {}, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } }; }

test("repair round follows item outcomes and never advances on a client completion claim", () => {
  assert.equal(currentClientRepairRound([], []), "R1");
  assert.equal(currentClientRepairRound([], [{ round: "R1", status: "open" }]), "R1");
  assert.equal(currentClientRepairRound([{ round: "R1", status: "sent" }], [{ id }]), null);
  assert.equal(currentClientRepairRound([{ round: "R1", status: "sent" }, { round: "R2", status: "escalated" }], [{ id }]), "R2");
  assert.equal(currentClientRepairRound([{ round: "R3", status: "verified" }], [{ id }]), null);
  assert.equal(currentClientRepairRound([{ round: "R6", status: "deleted" }], [{ id }]), null);
});

test("full package starts existing full repair machinery with included zero allocation and no staff identity", async () => {
  let enrolled = null, generated = null;
  const db = { async query() { return { rows: [] }; } };
  const deps = { readActiveServices: async () => [], hasDisputeAuthorization: async () => true,
    evaluateDocGate: async () => ({ complete: true, missing: [] }), loadVerifiedIdentity: async () => ({ legalName: "Fixture Buyer", address: "1 Fixture St" }),
    documentStore: {}, enrollRepairProgram: async (_db, args) => { enrolled = args; return { ok: true }; },
    analyzeAndGenerate: async (_db, args) => { generated = args; return { ok: true, letters: [], documents: null }; } };
  const result = await generateClientRepairLetters(db, scope, {}, deps);
  assert.equal(result.status, "prepared"); assert.equal(enrolled.program, "full");
  assert.equal(enrolled.priceTotal, 0); assert.equal(enrolled.amountPaid, 0); assert.equal(enrolled.staffId, undefined);
  assert.equal(generated.round, "R1"); assert.equal(generated.staffId, undefined);
});

test("repair gateway rejects arbitrary rounds, staff flags, client clear and foreign identity fields", async () => {
  let calls = 0;
  const deps = { requireBlueprintFulfillmentScope: async () => scope,
    services: { generate: async () => { calls++; return { ok: true }; } } };
  for (const body of [{ action: "generate", round: "R6" }, { action: "generate", staffId: id },
    { action: "mark_complete" }, { action: "generate", clientId: id },
    { action: "generate", portalUrl: "https://example.test" },
    { action: "generate", documentUploadUrl: "https://example.test" }]) {
    const res = response(); await handler({ method: "POST", body }, res, deps); assert.equal(res.statusCode, 400);
  }
  const res = response(); await handler({ method: "POST", body: { action: "generate", idempotencyKey: "prepare-1" } }, res, deps);
  assert.equal(calls, 1); assert.equal(res.statusCode, 200);
});

test("repair API permits managed funding without granting ownership of repair services", async () => {
  const managed = { ...scope, engagement: { ...scope.engagement, executionOwner: "fundhub" } };
  const deps = { requireBlueprintFulfillmentScope: async (_req, _res, options) => {
    assert.equal(options.allowManagedWrites, true); return managed;
  }, services: { generate: async (_db, received) => { assert.equal(received, managed); return { ok: true }; } } };
  const res = response(); await handler({ method: "POST", body: { action: "generate" } }, res, deps);
  assert.equal(res.statusCode, 200);
});

test("repair GET shares the official dispute and supporting-document links without writing", async () => {
  const cases = ["EX", "EQ", "TU", "unknown"].map(bureau => ({ id, bureau, round: "R1", status: "open" }));
  const queries = [];
  const deps = { requireBlueprintFulfillmentScope: async () => scope,
    db: { query: async sql => { queries.push(sql); return { rows: /FROM dispute_cases WHERE/.test(sql) ? cases : [] }; } },
    readActiveServices: async () => [], hasDisputeAuthorization: async () => false, hasRepairAgreement: async () => false,
    evaluateDocGate: async () => ({ complete: false, missing: [] }), loadVerifiedIdentity: async () => null, readRepairStage: async () => null };
  const res = response(); await handler({ method: "GET" }, res, deps);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.cases.map(row => [row.bureau, row.portalUrl, row.documentUploadUrl]), [
    ["EX", "https://www.experian.com/help/dispute-credit/", "https://www.experian.com/consumer/upload/"],
    ["EQ", "https://www.equifax.com/personal/credit-report-services/credit-dispute/", null],
    ["TU", "https://www.transunion.com/credit-disputes/dispute-your-credit", null],
    ["unknown", null, null]
  ]);
  assert.equal(queries.every(sql => /^SELECT\b/i.test(sql.trim())), true);
  assert.equal(res.body.actions.canGenerate, false, "navigation links do not bypass repair authorization");
});

// Unit MAIL: a letter the client paid Fundhub $97 to mail is Fundhub's to mail.
const LETTER = "44444444-4444-4444-8444-444444444444", CASE = "55555555-5555-4555-8555-555555555555";
const signedDeps = { readActiveServices: async () => [], hasDisputeAuthorization: async () => true, evaluateDocGate: async () => ({ complete: true, missing: [] }),
  loadVerifiedIdentity: async () => ({ legalName: "Fixture Buyer", address: "1 Fixture St" }), readRepairStage: async () => "ready_to_send", readLetterApprovals: async () => new Map() };

test("a paid $97 mailing closes the client's own submission on that letter, and only that letter", async () => {
  for (const paid of [true, false]) {
    const queries = [];
    const db = { query: async sql => { queries.push(sql);
      if (/FROM dispute_cases WHERE/.test(sql)) return { rows: [{ id: CASE, bureau: "EX", round: "R1", status: "open", response_due_at: null }] };
      if (/FROM dispute_items i JOIN/.test(sql)) return { rows: [{ id, case_id: CASE, round: "R1", status: "open", bureau: "EX" }] };
      if (/FROM dispute_letters l LEFT JOIN LATERAL/.test(sql)) return { rows: [{ id: LETTER, case_id: CASE, bureau: "EX", round: "R1", target: "bureau", status: "generated",
        created_at: "2026-11-06", document_id: id, document_version_id: id, submitted_at: null, fundhub_mailing: paid }] };
      return { rows: [] }; } };
    const read = await readClientRepair(db, scope, signedDeps);
    assert.equal(read.cases[0].letters[0].canRecordSubmission, !paid);
    const letters = queries.find(sql => /FROM dispute_letters l LEFT JOIN LATERAL/.test(sql));
    assert.match(letters, /blueprint_letter_mailing_envelopes e/); assert.match(letters, /o\.payment_state='paid'/);
  }
});

test("the server refuses the client's own submission while a paid Fundhub mailing holds the letter", async () => {
  for (const paid of [true, false]) {
    const db = { query: async sql => {
      if (/SELECT \* FROM dispute_letters WHERE id=\$1::uuid/.test(sql)) return { rows: [{ id: LETTER, case_id: CASE, round: "R1", status: "generated", send_claimed_at: null, mailed_at: null }] };
      if (/FROM blueprint_letter_mailing_envelopes e/.test(sql)) return { rows: paid ? [{ "?column?": 1 }] : [] };
      return { rows: [] }; } };
    const input = { letterId: LETTER, receiptDocumentId: id, reference: "fixture-reference", channel: "mail" };
    await assert.rejects(recordClientRepairSubmission(db, scope, input, signedDeps),
      { code: paid ? "fundhub_mailing_this_letter" : "repair_receipt_unavailable" });
  }
});
