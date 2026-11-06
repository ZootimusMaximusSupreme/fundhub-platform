import { test } from "node:test";
import assert from "node:assert/strict";
import { captureInquiryBaseline, genuineInquiryReport, inquiryRemovalDecision, inquiryResponseDecision } from "./verify-removal.mjs";
import { sensitiveBureaus } from "../lenders/match.mjs";
import { clientRequestedBureauTask } from "./bureau-call.mjs";

function report(id, at, inquiries = [], overrides = {}) {
  return { id, created_at: at, provider: "crs_softview", result: {
    environment: "production", bureauStatus: { EX: "file_returned" },
    bureaus: { EX: { inquiries } },
    inquiries: inquiries.map(item => ({ ...item, source: "EX" })), ...overrides
  } };
}
const original = report("before", "2026-11-01T12:00:00Z", [{ creditorName: "Bank One", date: "2026-10-12" }]);
const baseline = { inquiryId: "inquiry", bureau: "EX", name: "Bank One", date: "2026-10-12", sourceFound: true };

test("only the exact inquiry absent from a newer complete real bureau report verifies", () => {
  assert.equal(inquiryRemovalDecision(baseline, original, report("after", "2026-11-04T12:00:00Z")).status, "removed");
  assert.equal(inquiryRemovalDecision(baseline, original, report("after", "2026-11-04T12:00:00Z", [{ creditorName: "Bank One", date: "2026-10-12" }])).status, "present");
  for (const current of [original, report("older", "2026-10-01T12:00:00Z"),
    report("partial", "2026-11-04T12:00:00Z", [], { bureauStatus: { EX: "frozen" } }),
    report("missing", "2026-11-04T12:00:00Z", [], { bureaus: {} }),
    report("sim", "2026-11-04T12:00:00Z", [], { environment: "sandbox" }),
    report("sim", "2026-11-04T12:00:00Z", [], { simulated: true })]) {
    assert.notEqual(inquiryRemovalDecision(baseline, original, current).status, "removed");
  }
  assert.equal(inquiryRemovalDecision({ ...baseline, sourceFound: false }, original, report("after", "2026-11-04T12:00:00Z")).status, "review");
});

test("baseline identity requires one exact dated source, never a guess among same-name inquiries", () => {
  const inquiry = { id: "row", inquiry: "Bank One" };
  assert.equal(captureInquiryBaseline([inquiry], original, "EX")[0].sourceFound, true);
  const ambiguous = report("ambiguous", "2026-11-01T12:00:00Z", [
    { creditorName: "Bank One", date: "2026-10-12" }, { creditorName: "Bank One", date: "2026-10-20" }
  ]);
  assert.equal(captureInquiryBaseline([inquiry], ambiguous, "EX")[0].sourceFound, false);
  assert.equal(genuineInquiryReport({ ...original, created_at: "invalid" }, "EX"), null);
});

test("a response needs accepted current identity, printed newer date and exact deletion statement", () => {
  const validation = { status: "accepted", bureau: "EX", client_match: "match", authenticity: "clear",
    quality: "pass", document_type: "bureau_response", letter_date: "2026-11-04" };
  const proof = { validation, text: "Inquiry results\nBank One 10/12/2026 was deleted from your file." };
  const decide = value => inquiryResponseDecision(baseline, value, original.created_at, new Date("2026-11-05T12:00:00Z"));
  assert.equal(decide(proof), true);
  for (const text of ["Inquiry results\nBank One 10/12/2026 was not deleted.",
    "Inquiry results\nBank One 10/12/2026 removal requested.",
    "Inquiry results\nBank One 10/13/2026 was deleted.", "All disputed items were deleted."]) {
    assert.equal(decide({ validation, text }), false);
  }
  for (const changed of [{ bureau: "TU" }, { client_match: "mismatch" }, { letter_date: "2026-10-01" },
    { letter_date: null }, { status: "hold" }, { authenticity: "uncertain" }]) {
    assert.equal(decide({ ...proof, validation: { ...validation, ...changed } }), false);
  }
});

test("manual clear and time alone retain bureau protection; system proof releases only its inquiry", () => {
  const recent = { bureau: "EX", status: "Removed", created_at: new Date().toISOString() };
  assert.equal(sensitiveBureaus([recent]).has("EX"), true);
  const verified = { ...recent, removal_verified_at: new Date().toISOString(), removal_verified_report_id: "report" };
  assert.equal(sensitiveBureaus([verified]).has("EX"), false);
  assert.equal(sensitiveBureaus([verified, { ...recent, status: "New" }]).has("EX"), true);
  assert.equal(sensitiveBureaus([verified, { bureau: "TU", status: "New" }]).has("TU"), true);
  assert.equal(sensitiveBureaus([{ ...verified, status: "New" }]).has("EX"), true);
});

test("client-requested calls reuse navigation while stating the real caller and bounded facts", () => {
  const task = clientRequestedBureauTask("## PHASE 1: IVR\nSTEP 1: Ask for dispute\nSTEP 2: Wait\n## HUMAN\nNever mention that you are calling on behalf of someone else");
  assert.match(task, /on behalf of the client/);
  assert.match(task, /STEP 1: Ask for dispute/);
  assert.doesNotMatch(task, /Never mention that you are calling on behalf/);
  assert.match(task, /Never claim to be the client/);
});
