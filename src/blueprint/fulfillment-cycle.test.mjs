import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FULL_REPORT_SUBTYPE, LETTER_SUBTYPES, GUIDE_RULE, MAX_FULL_REPORTS, FulfillmentCycleError,
  bureauCode, mailTo, approvalView, fullReportRows, readFullReports, offerOf, fundableOf,
  readBlueprintCycle, applicationGuide, readApplicationGuide, phoneDisplay, inquiryCall,
  readLetterApprovals, letterCycle, saveLetterStep
} from "./fulfillment-cycle.mjs";
import { REPORT_SUBTYPE } from "../handlers/crs-full-report.mjs";
import { BUREAU_MAIL_ADDRESSES } from "../messaging/providers/mail-letter.mjs";
import { BOOK_CALL_URL } from "../deliverables/chrome.mjs";

const ORG = "11111111-1111-4111-8111-111111111111";
const CLIENT = "22222222-2222-4222-8222-222222222222";
const ACCOUNT = "33333333-3333-4333-8333-333333333333";
const DOC = "44444444-4444-4444-8444-444444444444";
const VERSION = "55555555-5555-4555-8555-555555555555";
const scope = { orgId: ORG, clientId: CLIENT, accountId: ACCOUNT, now: new Date("2026-11-07T18:00:00Z") };

test("the full report subtype is the one the soft-pull handler saves", () => {
  assert.equal(FULL_REPORT_SUBTYPE, REPORT_SUBTYPE);
});

test("bureau codes and mailing addresses come only from the saved bureau list", () => {
  for (const [value, code] of [["EX", "EX"], ["experian", "EX"], ["Equifax", "EQ"], ["Trans Union", "TU"], ["tu", "TU"]]) {
    assert.equal(bureauCode(value), code);
  }
  for (const value of ["", null, "XX", "Innovis", "EXP"]) assert.equal(bureauCode(value), null);
  for (const code of ["EX", "EQ", "TU"]) {
    const a = BUREAU_MAIL_ADDRESSES[code];
    const to = mailTo(code);
    assert.equal(to.bureau, code);
    assert.deepEqual(to.lines, [a.company_name, a.address_line1, `${a.address_city}, ${a.address_state} ${a.address_zip}`]);
  }
  assert.deepEqual(mailTo("Experian").lines, ["Experian", "P.O. Box 4500", "Allen, TX 75013"]);
  // A furnisher or complaint letter carries its own address: never the bureau's.
  assert.equal(mailTo("EX", "furnisher"), null);
  assert.equal(mailTo("EX", "cfpb"), null);
  assert.equal(mailTo("XX"), null);
});

test("full reports: newest first, one row per saved pull, bad rows dropped, capped", () => {
  const rows = [
    { document_id: DOC, version: 1, generated_at: "2026-10-06T12:00:00Z" },
    { document_id: DOC, version: 2, generated_at: "2026-11-06T12:00:00Z" },
    { document_id: "not-a-uuid", version: 3, generated_at: "2026-11-07T12:00:00Z" },
    { document_id: DOC, version: 0, generated_at: "2026-11-08T12:00:00Z" }
  ];
  const out = fullReportRows(rows);
  assert.deepEqual(out, [
    { documentId: DOC, version: 2, pulledAt: "2026-11-06T12:00:00.000Z", newest: true },
    { documentId: DOC, version: 1, pulledAt: "2026-10-06T12:00:00.000Z", newest: false }
  ]);
  const many = Array.from({ length: 40 }, (_, i) => ({ document_id: DOC, version: i + 1,
    generated_at: new Date(Date.UTC(2024, i, 1)).toISOString() }));
  assert.equal(fullReportRows(many).length, MAX_FULL_REPORTS);
  assert.equal(fullReportRows(many)[0].version, 40);
  assert.deepEqual(fullReportRows(null), []);
});

test("full reports read is scoped to the client and writes nothing", async () => {
  const calls = [];
  const db = { async query(sql, params) { calls.push({ sql, params }); return { rows: [{ document_id: DOC, version: 1, generated_at: "2026-11-06T12:00:00Z" }] }; } };
  const out = await readFullReports(db, { orgId: ORG, clientId: CLIENT });
  assert.equal(out.length, 1);
  assert.deepEqual(calls[0].params, [CLIENT, ORG, FULL_REPORT_SUBTYPE, MAX_FULL_REPORTS]);
  assert.match(calls[0].sql, /d\.client_id = \$1::uuid AND d\.org_id = \$2::uuid/);
  assert.match(calls[0].sql, /v\.org_id = d\.org_id/);
  assert.doesNotMatch(calls[0].sql, /INSERT|UPDATE|DELETE/);
});

test("which buyer: the funding engine on file is implementation, none is preparation", () => {
  assert.equal(offerOf({ status: "active" }), "implementation");
  assert.equal(offerOf({ status: "completed" }), "implementation");
  assert.equal(offerOf(null), "preparation");
  assert.equal(offerOf({ status: "cancelled" }), "preparation");
  assert.equal(offerOf(undefined), null);
  assert.equal(fundableOf({ fundability: { tier: "fundable" } }), true);
  assert.equal(fundableOf({ fundability: { tier: "not_fundable_yet" } }), false);
  assert.equal(fundableOf(null), null);
  assert.equal(fundableOf({ fundability: { tier: "maybe" } }), null);
});

test("the plan's cycle field: each part fails alone", async () => {
  const path = { fundability: { tier: "fundable" } };
  const ok = await readBlueprintCycle({}, scope, { path, readAccess: async () => null, readReports: async () => [] });
  assert.deepEqual(ok, { offer: "preparation", fundable: true, bookCallUrl: BOOK_CALL_URL, fullReports: [] });
  const full = await readBlueprintCycle({}, scope, { path: null, readAccess: async () => ({ status: "active" }), readReports: async () => { throw new Error("db down"); } });
  assert.deepEqual(full, { offer: "implementation", fundable: null, bookCallUrl: BOOK_CALL_URL, fullReports: null });
  const unknown = await readBlueprintCycle({}, scope, { path, readAccess: async () => { throw new Error("db down"); }, readReports: async () => [] });
  assert.equal(unknown.offer, null);
  await assert.rejects(readBlueprintCycle({}, { orgId: ORG }, {}), FulfillmentCycleError);
});

test("application guide fills only what is on file and never rounds up", () => {
  const income = { ok: true, detected_as_of: "2026-11-06",
    by_kind: { personal: { monthly_cents: 750001 }, business: { monthly_cents: 1250000 }, unknown: { monthly_cents: 99900 } } };
  const g = applicationGuide({ income, plan: { monthlyIncomeCents: 700000 }, businessCount: 1 });
  assert.equal(g.rule, GUIDE_RULE);
  assert.equal(g.asOf, "2026-11-06");
  const by = Object.fromEntries(g.rows.map((r) => [r.key, r]));
  assert.deepEqual(Object.keys(by), ["personal", "household", "business"]);
  assert.deepEqual(by.personal, { key: "personal", label: "Personal income", monthlyCents: 700000, yearlyCents: 8400000, source: "plan", estimate: false, reason: null });
  // Exactly × 12, to the cent: 7,500.01 a month is 90,000.12 a year, not 90,001.
  assert.equal(by.household.yearlyCents, 9000012);
  assert.equal(by.household.source, "bank");
  assert.equal(by.business.yearlyCents, 15000000);
  assert.equal(by.business.source, "business_bank");
  // Deposits are not income (Codex CX18): an estimate, and the client confirms their real income first.
  assert.equal(by.household.estimate, true);
  assert.equal(by.business.estimate, true);
  assert.equal(GUIDE_RULE, "Confirm your real income before you apply.");
  assert.doesNotMatch(g.rule, /exact/i, "a deposit estimate is never called exact income");
  // Unsorted money is never folded into personal, and nothing adds the kinds together.
  assert.ok(!g.rows.some((r) => r.yearlyCents === (750001 + 1250000) * 12 || r.yearlyCents === (750001 + 99900) * 12));
});

test("application guide: unknown stays null, two businesses are not split by guessing", () => {
  const none = applicationGuide({});
  assert.ok(none.rows.every((r) => r.yearlyCents === null && r.monthlyCents === null && r.source === null && r.reason === "not_on_file"));
  assert.ok(none.rows.every((r) => r.estimate === false), "nothing on file is not an estimate of anything");
  const bad = applicationGuide({ income: { ok: true, by_kind: { personal: { monthly_cents: 0 }, business: { monthly_cents: -5 } } },
    plan: { monthlyIncomeCents: 12.5 }, businessCount: 1 });
  assert.ok(bad.rows.every((r) => r.yearlyCents === null));
  const failedRead = applicationGuide({ income: { ok: false, by_kind: { personal: { monthly_cents: 500000 } } } });
  assert.equal(failedRead.rows.find((r) => r.key === "household").yearlyCents, null);
  const two = applicationGuide({ income: { ok: true, by_kind: { business: { monthly_cents: 900000 } } }, businessCount: 2 });
  const business = two.rows.find((r) => r.key === "business");
  assert.equal(business.yearlyCents, null);
  assert.equal(business.reason, "split_by_business");
  // The plan's income arrives from JSON as a string of digits; it is still exact.
  assert.equal(applicationGuide({ plan: { monthlyIncomeCents: "500000" } }).rows[0].yearlyCents, 6000000);
});

test("application guide read is scoped and survives a failed bank read", async () => {
  const calls = [];
  const db = { async query(sql, params) {
    calls.push({ sql, params });
    if (/FROM clients/.test(sql)) return { rows: [{ monthly: 650000 }] };
    if (/FROM businesses/.test(sql)) return { rows: [{ n: 1 }] };
    throw new Error("unexpected");
  } };
  const g = await readApplicationGuide(db, scope, { loadIncome: async () => { throw new Error("bank down"); } });
  assert.equal(g.rows[0].yearlyCents, 7800000);
  assert.equal(g.rows[1].yearlyCents, null);
  for (const c of calls) { assert.deepEqual(c.params, [CLIENT, ORG]); assert.match(c.sql, /org_id = \$2::uuid/); }
});

test("call the bureau: short script, the saved number, never a fraud claim", () => {
  const dial = [{ code: "EX", number: "+18554146048", numberOk: true, numberFrom: "script" },
    { code: "EQ", number: "+1866", numberOk: false, numberFrom: "script" }];
  const call = inquiryCall({ bureau: "EX", name: "Alex Sample", dial,
    inquiries: [{ name: "Sample Bank", state: "open" }, { name: "Old Lender", state: "removed_verified" }, { name: "Card Co", state: "pending_verification" }],
    missing: ["Government photo ID", { label: "Proof of address" }] });
  assert.equal(call.name, "Experian");
  assert.equal(call.number, "+18554146048");
  assert.equal(call.display, "(855) 414-6048");
  assert.equal(call.script[0], "Hi, my name is Alex Sample.");
  assert.match(call.script.join(" "), /Sample Bank, Card Co/);
  assert.doesNotMatch(call.script.join(" "), /Old Lender/);
  assert.doesNotMatch(JSON.stringify(call), /fraud|unauthori[sz]ed|identity theft/i);
  assert.ok(call.script.every((line) => line.length <= 80));
  assert.deepEqual(call.uploadFirst, ["Government photo ID", "Proof of address"]);
  assert.ok(call.haveReady.includes("Photo ID"));
  // A number that does not pass the dial check is not shown.
  const eq = inquiryCall({ bureau: "EQ", dial, inquiries: [{ name: "Sample Bank", state: "open" }] });
  assert.equal(eq.number, null);
  assert.equal(eq.display, null);
  assert.equal(eq.script[0], "Hi, I'm calling about my credit report.");
  // Nothing open, or no known bureau: no call step.
  assert.equal(inquiryCall({ bureau: "EX", dial, inquiries: [{ name: "Gone", state: "removed_verified" }] }), null);
  assert.equal(inquiryCall({ bureau: "ZZ", dial, inquiries: [{ name: "x", state: "open" }] }), null);
  assert.equal(phoneDisplay("8554146048"), null);
});

test("approvals read: keyed by version, and a missing table is an empty map", async () => {
  const db = { async query(sql, params) {
    assert.deepEqual(params, [CLIENT, ORG]);
    return { rows: [{ document_id: DOC, document_version_id: VERSION, approved_at: "2026-11-07T10:00:00Z", address_checked_at: null }] };
  } };
  const map = await readLetterApprovals(db, scope);
  assert.deepEqual(approvalView(map.get(VERSION)), { approvedAt: "2026-11-07T10:00:00.000Z", addressCheckedAt: null });
  const broken = await readLetterApprovals({ async query() { const e = new Error("relation does not exist"); e.code = "42P01"; throw e; } }, scope);
  assert.equal(broken.size, 0);
  const row = letterCycle({ bureau: "TU", versionId: VERSION, approvals: map });
  assert.deepEqual(row.to.lines.slice(1), ["P.O. Box 2000", "Chester, PA 19016"]);
  assert.equal(row.approval.approvedAt, "2026-11-07T10:00:00.000Z");
  // A different version of the same letter is not approved.
  assert.equal(letterCycle({ bureau: "TU", versionId: DOC, approvals: map }).approval.approvedAt, null);
});

function letterDb({ metadata = { bureau: "EX" }, found = true } = {}) {
  const state = { row: null, inserts: 0, updates: 0, calls: [] };
  const db = { async query(sql, params) {
    state.calls.push({ sql, params });
    if (/FROM documents d/.test(sql)) {
      assert.deepEqual(params.slice(0, 4), [DOC, ORG, CLIENT, LETTER_SUBTYPES]);
      return { rows: found ? [{ id: DOC, current_version_id: VERSION, subtype: "metro2_dispute_letter_pack", metadata }] : [] };
    }
    if (/^\s*SELECT \* FROM blueprint_letter_approvals/.test(sql)) {
      assert.deepEqual(params, [VERSION, ORG, CLIENT]);
      return { rows: state.row ? [state.row] : [] };
    }
    if (/INSERT INTO blueprint_letter_approvals/.test(sql)) {
      state.inserts++;
      state.row = { id: "row-1", approved_at: params[5], address_checked_at: null };
      return { rows: [state.row] };
    }
    if (/UPDATE blueprint_letter_approvals/.test(sql)) {
      state.updates++;
      state.row = { ...state.row, address_checked_at: params[3] };
      return { rows: [state.row] };
    }
    throw new Error("unexpected " + sql);
  } };
  return { db, state };
}

test("letter steps: approve first, then the address; replays change nothing", async () => {
  const { db, state } = letterDb();
  await assert.rejects(saveLetterStep(db, scope, { documentId: DOC, step: "address" }), (e) => e.code === "approve_first" && e.status === 409);
  assert.equal(state.updates, 0);
  const approved = await saveLetterStep(db, scope, { documentId: DOC, step: "approve" });
  assert.equal(approved.approval.approvedAt, "2026-11-07T18:00:00.000Z");
  assert.equal(approved.approval.addressCheckedAt, null);
  assert.equal(approved.versionId, VERSION);
  assert.deepEqual(approved.to.lines, ["Experian", "P.O. Box 4500", "Allen, TX 75013"]);
  await saveLetterStep(db, scope, { documentId: DOC, step: "approve" });
  assert.equal(state.inserts, 1);
  const checked = await saveLetterStep(db, scope, { documentId: DOC, step: "address" });
  assert.equal(checked.approval.addressCheckedAt, "2026-11-07T18:00:00.000Z");
  await saveLetterStep(db, scope, { documentId: DOC, step: "address" });
  assert.equal(state.updates, 1);
});

test("letter steps refuse other files, unknown bureaus and bad input", async () => {
  await assert.rejects(saveLetterStep(letterDb({ found: false }).db, scope, { documentId: DOC, step: "approve" }), (e) => e.status === 404);
  await assert.rejects(saveLetterStep(letterDb({ metadata: {} }).db, scope, { documentId: DOC, step: "approve" }), (e) => e.code === "letter_bureau_unknown");
  await assert.rejects(saveLetterStep(letterDb().db, scope, { documentId: DOC, step: "mail" }), (e) => e.status === 400);
  await assert.rejects(saveLetterStep(letterDb().db, scope, { documentId: "x", step: "approve" }), (e) => e.status === 400);
  await assert.rejects(saveLetterStep(letterDb().db, { ...scope, accountId: null }, { documentId: DOC, step: "approve" }), (e) => e.status === 403);
  // A complaint letter is approved like any other, but shows no bureau address.
  const complaint = await saveLetterStep(letterDb({ metadata: { bureau: "EQ", target: "cfpb" } }).db, scope, { documentId: DOC, step: "approve" });
  assert.equal(complaint.to, null);
});
