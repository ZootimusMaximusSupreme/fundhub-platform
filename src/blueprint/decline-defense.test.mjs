// Decline defense — the store, against an in-memory stand-in for the tables
// migration 470 adds (and the few it reads). No Postgres. The SQL constraints
// themselves are proven in decline-defense.pg.test.mjs (CI, scratch database).
//
// What this pins: a decline and its plan are written once; the ops task is
// created once (a second paste of the same letter adds nothing); the task body
// is short and never carries lender-book lines; staff recording sets the
// application to Denied and a client's paste never touches it; the outcome is
// tracked and an approval on reconsideration sets the application to Approved
// with the typed amount (blank stays unknown); a blank cannot be closed without
// words; a non-buyer is refused; the client view carries no sources and no book.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  recordDecline, readDeclines, recordOutcome, setStepStatus, scheduleRecon, linkLetter,
  declineNotesForNextSequence, taskBody, applicationWords, clientAnalysis, DeclineInputError,
  SOURCE_WORKFLOW, TASK_ROLE, TASK_BODY_MAX_BYTES, CLIENT_PASTES_PER_DAY, parseDay, arizonaDay
} from "./decline-defense.mjs";
import { analyzeDecline } from "./decline-analyze.mjs";
import { memoryDb, TEST_ORG, TEST_CLIENT } from "./decline-defense.test.db.mjs";

const ORG = TEST_ORG;
const CLIENT = TEST_CLIENT;
const APP = "33333333-3333-4333-8333-333333333333";
const LENDER = "44444444-4444-4444-8444-444444444444";
const DOC = "55555555-5555-4555-8555-555555555555";

const LETTER = `Thank you for applying for the Chase Ink Business Cash card.
Unfortunately, we are unable to approve your application. The principal reasons are:
- Too many inquiries in the last 12 months
- Requested credit line exceeds our guidelines
If you would like us to reconsider, please call 1-800-453-9719 within 30 days.
SSN on file: 123-45-6789`;

const BOOK = [{
  id: LENDER, name: "Chase", lender_table: "InBranchBizCC", bureaus_pulled: "EX/EQ/TU",
  relationship_required: "yes", requires_account_opening: "yes",
  insider_tips: "Business checking account is required.; Go to your local Chase Bank and meet with a Relationship Manager.; Claim $50k monthly spend (unverified)",
  notes: "Source: Notion Deep State Datapoints (Legacy Strong)"
}];

const fakeDb = (opts = {}) => memoryDb({ lenders: BOOK, ...opts });

const STAFF = { id: "s1", name: "Dana Advisor", email: "dana@example.com" };
const asStaff = { kind: "staff", staffId: "s1", name: "Dana Advisor" };
const asClient = { kind: "client" };

function spyStatus() {
  const calls = [];
  const fn = async (_db, args) => { calls.push(args); return { id: args.applicationId, status: args.status }; };
  fn.calls = calls;
  return fn;
}

describe("recording a decline", () => {
  test("a client's paste: one decline, its plan, one ops task on the funding advisor's queue", async () => {
    const db = fakeDb();
    const status = spyStatus();
    const out = await recordDecline(db, {
      orgId: ORG, clientId: CLIENT, by: asClient, source: "client_paste",
      input: { text: LETTER, bank: "Chase", product: "Ink Business Cash" }, deps: { setApplicationStatus: status }
    });
    assert.equal(out.ok, true);
    assert.equal(out.created, true);
    assert.equal(db.t.declines.length, 1);
    const d = db.t.declines[0];
    assert.deepEqual(d.reason_categories, ["too_many_inquiries"]);
    assert.equal(d.needs_person, true, "the line nobody can place goes to a person");
    assert.equal(d.source, "client_paste");
    assert.doesNotMatch(d.letter_text, /123-45-6789/, "the SSN is masked before it is stored");
    assert.ok(db.t.steps.length >= 8);
    assert.equal(db.t.tasks.length, 1);
    assert.equal(db.t.tasks[0].assignee_role, TASK_ROLE);
    assert.equal(db.t.tasks[0].source_workflow, SOURCE_WORKFLOW);
    assert.equal(d.task_id, db.t.tasks[0].id);
    assert.equal(status.calls.length, 0, "a client's paste never changes an application");
  });

  test("the same letter pasted again is the same decline — no second row, no second task", async () => {
    const db = fakeDb();
    const args = { orgId: ORG, clientId: CLIENT, by: asClient, source: "client_paste", input: { text: LETTER, bank: "Chase" } };
    await recordDecline(db, args);
    const again = await recordDecline(db, { ...args, input: { text: `  ${LETTER.replace(/\n/g, "\n\n")}  `, bank: "Chase" } });
    assert.equal(again.ok, true);
    assert.equal(again.created, false);
    assert.equal(again.duplicate, true);
    assert.equal(again.decline_id, db.t.declines[0].id);
    assert.equal(db.t.declines.length, 1);
    assert.equal(db.t.tasks.length, 1, "task created once");
  });

  test("staff recording on an application sets it to Denied through setApplicationStatus", async () => {
    const db = fakeDb({ applications: [{ id: APP, bank: "Chase", lender_name: "Chase", lender_id: LENDER, product_name: "Ink Business Cash", status: "Applied" }] });
    const status = spyStatus();
    const out = await recordDecline(db, {
      orgId: ORG, clientId: CLIENT, by: asStaff, staff: STAFF, source: "staff",
      input: { application_id: APP, text: LETTER, declined_on: "2026-10-02", bureaus_pulled: ["EX"], recon_on: "2026-10-09" },
      deps: { setApplicationStatus: status }
    });
    assert.equal(out.created, true);
    const d = db.t.declines[0];
    assert.equal(d.bank, "Chase", "the bank comes off the application");
    assert.equal(d.product, "Ink Business Cash");
    assert.equal(d.application_id, APP);
    assert.equal(d.lender_id, LENDER);
    assert.deepEqual(d.bureaus_pulled, ["experian"]);
    assert.equal(d.recon_on, "2026-10-09");
    assert.equal(status.calls.length, 1);
    assert.equal(status.calls[0].status, "Denied");
    assert.equal(status.calls[0].applicationId, APP);
    assert.equal(status.calls[0].staff, STAFF);
    assert.equal(db.t.tasks[0].due_at, "2026-10-09T16:00:00Z", "the task is due on the staff-set call date");
  });

  test("a retry finishes a status change that failed the first time", async () => {
    const db = fakeDb({ applications: [{ id: APP, bank: "Chase", lender_name: "Chase", status: "Applied" }] });
    const base = { orgId: ORG, clientId: CLIENT, by: asStaff, staff: STAFF, source: "staff", input: { application_id: APP, text: LETTER } };
    await assert.rejects(recordDecline(db, { ...base, deps: { setApplicationStatus: async () => { throw new Error("db blip"); } } }), /db blip/);
    assert.equal(db.t.declines.length, 1, "the decline itself was saved");
    const status = spyStatus();
    const again = await recordDecline(db, { ...base, deps: { setApplicationStatus: status } });
    assert.equal(again.duplicate, true);
    assert.equal(status.calls.length, 1);
    assert.equal(status.calls[0].status, "Denied");
    assert.equal(db.t.tasks.length, 1, "still one task");
  });

  test("one decline per application: a second record on it adds nothing", async () => {
    const db = fakeDb({ applications: [{ id: APP, bank: "Chase", lender_name: "Chase", status: "Denied" }] });
    const status = spyStatus();
    const base = { orgId: ORG, clientId: CLIENT, by: asStaff, staff: STAFF, source: "staff", deps: { setApplicationStatus: status } };
    await recordDecline(db, { ...base, input: { application_id: APP } });
    const again = await recordDecline(db, { ...base, input: { application_id: APP, text: LETTER } });
    assert.equal(again.duplicate, true);
    assert.equal(db.t.declines.length, 1);
    assert.equal(db.t.tasks.length, 1);
    assert.equal(status.calls.length, 0, "already Denied, so nothing to change");
  });

  test("staff may record with no letter yet: the plan still asks for a second look and waits for the letter", async () => {
    const db = fakeDb();
    await recordDecline(db, { orgId: ORG, clientId: CLIENT, by: asStaff, staff: STAFF, source: "staff", input: { bank: "Chase" } });
    const d = db.t.declines[0];
    assert.equal(d.letter_text, null);
    assert.equal(d.needs_person, true);
    const keys = db.t.steps.map((s) => s.step_key);
    assert.ok(keys.includes("call_recon") && keys.includes("read_unknown"));
    assert.equal(db.t.steps.find((s) => s.step_key === "get_letter").status, "open");
  });

  test("refusals: not a Blueprint buyer, no letter on a paste, no bank, an approved application, too many pastes", async () => {
    assert.deepEqual(await recordDecline(fakeDb({ buyer: false }), { orgId: ORG, clientId: CLIENT, by: asClient, source: "client_paste", input: { text: LETTER, bank: "Chase" } }),
      { ok: false, error: "not_blueprint_buyer" });
    await assert.rejects(recordDecline(fakeDb(), { orgId: ORG, clientId: CLIENT, by: asClient, source: "client_paste", input: { text: "no", bank: "Chase" } }),
      (e) => e instanceof DeclineInputError && e.code === "letter_required");
    await assert.rejects(recordDecline(fakeDb(), { orgId: ORG, clientId: CLIENT, by: asClient, source: "client_paste", input: { text: LETTER } }),
      (e) => e.code === "bank_required");
    await assert.rejects(recordDecline(fakeDb({ applications: [{ id: APP, bank: "Chase", status: "Approved" }] }),
      { orgId: ORG, clientId: CLIENT, by: asStaff, source: "staff", input: { application_id: APP } }),
    (e) => e.code === "application_approved" && e.status === 409);
    assert.deepEqual(await recordDecline(fakeDb({ pastesToday: CLIENT_PASTES_PER_DAY }), { orgId: ORG, clientId: CLIENT, by: asClient, source: "client_paste", input: { text: LETTER, bank: "Chase" } }),
      { ok: false, error: "too_many_pastes" });
    await assert.rejects(recordDecline(fakeDb(), { orgId: ORG, clientId: CLIENT, by: asClient, source: "client_paste", input: { text: "x".repeat(20001), bank: "Chase" } }),
      (e) => e.code === "letter_too_long");
    await assert.rejects(recordDecline(fakeDb(), { orgId: ORG, clientId: CLIENT, by: asStaff, source: "staff", input: { bank: "Chase", declined_on: "2026-13-40" } }),
      (e) => e.code === "invalid_declined_on");
  });

  test("a client's paste cannot set staff-only fields", async () => {
    const db = fakeDb();
    await recordDecline(db, { orgId: ORG, clientId: CLIENT, by: asClient, source: "client_paste", input: { text: LETTER, bank: "Chase", recon_on: "2026-10-09" } });
    assert.equal(db.t.declines[0].recon_on, null);
  });
});

describe("the ops task body", () => {
  test("short, names the sources, carries the decline id, and never a lender-book line", async () => {
    const db = fakeDb();
    await recordDecline(db, { orgId: ORG, clientId: CLIENT, by: asStaff, staff: STAFF, source: "staff", input: { text: LETTER.replace("Too many inquiries", "A business checking account is required"), bank: "Chase", product: "Business card" } });
    const body = db.t.tasks[0].body;
    assert.ok(Buffer.byteLength(body, "utf8") <= TASK_BODY_MAX_BYTES);
    assert.match(body, /ref blueprint-decline:/);
    assert.match(body, /Calling DENIED — Step 3/);
    assert.doesNotMatch(body, /Relationship Manager\.|local Chase Bank|lenders [0-9a-f-]{36}/, "book notes stay out of the task");
    assert.doesNotMatch(body, /123-45-6789/);
  });

  test("a very long plan is cut down, never over the index limit", () => {
    const analysis = analyzeDecline({ text: LETTER, bank: "Chase", declined: true });
    const steps = Array.from({ length: 60 }, (_, i) => ({ who: "ops", status: "open", is_blank: false, source_kind: "notion",
      step_text: `Step ${i} ${"word ".repeat(40)}`, source_ref: "Calling DENIED — Step 3" }));
    const body = taskBody({ decline: { id: "x", bank: "Chase", source: "staff" }, analysis, steps });
    assert.ok(Buffer.byteLength(body, "utf8") <= TASK_BODY_MAX_BYTES);
    assert.match(body, /more on the decline/);
  });
});

describe("working the plan", () => {
  async function seeded(opts) {
    const db = fakeDb(opts);
    await recordDecline(db, { orgId: ORG, clientId: CLIENT, by: asStaff, staff: STAFF, source: "staff",
      input: { application_id: opts && opts.applications ? APP : null, bank: "Chase", text: LETTER.replace("Too many inquiries", "Low credit score") },
      deps: { setApplicationStatus: spyStatus() } });
    return { db, id: db.t.declines[0].id };
  }

  test("a blank cannot be marked done without words; with words it closes and keeps them", async () => {
    const { db, id } = await seeded();
    const blank = db.t.steps.find((s) => s.is_blank);
    assert.ok(blank, "a reason no source covers leaves a blank");
    await assert.rejects(setStepStatus(db, { orgId: ORG, clientId: CLIENT, declineId: id, stepKey: blank.step_key, status: "done", by: asStaff }),
      (e) => e.code === "blank_needs_words");
    const out = await setStepStatus(db, { orgId: ORG, clientId: CLIENT, declineId: id, stepKey: blank.step_key, status: "done", filledText: "Explain the score dip came from one late payment that is now disputed.", by: asStaff });
    assert.equal(out.step.status, "done");
    assert.match(out.step.filled_text, /late payment/);
    assert.equal(out.step.done_by, "Dana Advisor");
  });

  test("a step on another client's decline is not found", async () => {
    const { db, id } = await seeded();
    await assert.rejects(setStepStatus(db, { orgId: ORG, clientId: "77777777-7777-4777-8777-777777777777", declineId: id, stepKey: "call_recon", status: "done", by: asStaff }),
      (e) => e.code === "not_found" && e.status === 404);
  });

  test("the call date is staff-set and moves the open task's due date", async () => {
    const { db, id } = await seeded();
    const out = await scheduleRecon(db, { orgId: ORG, clientId: CLIENT, declineId: id, reconOn: "2026-10-12" });
    assert.equal(out.recon_on, "2026-10-12");
    assert.equal(db.t.tasks[0].due_at, "2026-10-12T16:00:00Z");
    await assert.rejects(scheduleRecon(db, { orgId: ORG, clientId: CLIENT, declineId: id, reconOn: "soon" }), (e) => e.code === "invalid_recon_on");
  });

  test("a letter file links only if it is this client's document, and closes the send-the-letter step", async () => {
    const { db, id } = await seeded({ documents: [{ id: DOC }] });
    db.t.steps.find((s) => s.step_key === "get_letter").status = "open";
    await linkLetter(db, { orgId: ORG, clientId: CLIENT, declineId: id, documentId: DOC, by: asStaff });
    assert.equal(db.t.declines[0].letter_document_id, DOC);
    assert.equal(db.t.steps.find((s) => s.step_key === "get_letter").status, "done");
    await assert.rejects(linkLetter(db, { orgId: ORG, clientId: CLIENT, declineId: id, documentId: "66666666-6666-4666-8666-666666666666", by: asStaff }),
      (e) => e.code === "document_not_found");
  });
});

describe("the outcome", () => {
  async function withApp(status = "Denied") {
    const db = fakeDb({ applications: [{ id: APP, bank: "Chase", lender_name: "Chase", status }] });
    await recordDecline(db, { orgId: ORG, clientId: CLIENT, by: asStaff, staff: STAFF, source: "staff", input: { application_id: APP, text: LETTER }, deps: { setApplicationStatus: spyStatus() } });
    return { db, id: db.t.declines[0].id };
  }

  test("approved on reconsideration: the application becomes Approved with the typed amount", async () => {
    const { db, id } = await withApp();
    const status = spyStatus();
    const out = await recordOutcome(db, { orgId: ORG, clientId: CLIENT, declineId: id, outcome: "approved_on_recon", approvedAmount: "$15,000", staff: STAFF, by: asStaff, deps: { setApplicationStatus: status } });
    assert.equal(out.outcome, "approved_on_recon");
    assert.equal(out.approved_amount, "15000.00");
    assert.equal(status.calls[0].status, "Approved");
    assert.deepEqual(status.calls[0].patch, { approved_amount: "15000.00" });
  });

  test("approved with no amount typed: unknown stays unknown, never 0", async () => {
    const { db, id } = await withApp();
    const status = spyStatus();
    const out = await recordOutcome(db, { orgId: ORG, clientId: CLIENT, declineId: id, outcome: "approved_on_recon", approvedAmount: "", staff: STAFF, by: asStaff, deps: { setApplicationStatus: status } });
    assert.equal(out.approved_amount, null);
    assert.equal(status.calls[0].patch, null);
    await assert.rejects(recordOutcome(db, { orgId: ORG, clientId: CLIENT, declineId: id, outcome: "approved_on_recon", approvedAmount: "0", by: asStaff }),
      (e) => e.code === "invalid_approved_amount");
  });

  test("re-apply later needs a date, and becomes a note for the next funding sequence", async () => {
    const { db, id } = await withApp();
    await assert.rejects(recordOutcome(db, { orgId: ORG, clientId: CLIENT, declineId: id, outcome: "reapply_later", by: asStaff }),
      (e) => e.code === "reapply_on_required");
    const out = await recordOutcome(db, { orgId: ORG, clientId: CLIENT, declineId: id, outcome: "reapply_later", reapplyOn: "2027-01-15", by: asStaff, deps: { setApplicationStatus: spyStatus() } });
    assert.equal(out.reapply_on, "2027-01-15");
    assert.match(out.next_sequence_note, /re-apply on or after Jan 15, 2027/);
    const notes = await declineNotesForNextSequence(db, { orgId: ORG, clientId: CLIENT });
    assert.equal(notes.length, 1);
    assert.equal(notes[0].reapply_on, "2027-01-15");
  });

  test("still declined leaves a Denied application alone; an unknown outcome is refused", async () => {
    const { db, id } = await withApp("Denied");
    const status = spyStatus();
    await recordOutcome(db, { orgId: ORG, clientId: CLIENT, declineId: id, outcome: "still_declined", by: asStaff, deps: { setApplicationStatus: status } });
    assert.equal(status.calls.length, 0);
    await assert.rejects(recordOutcome(db, { orgId: ORG, clientId: CLIENT, declineId: id, outcome: "maybe", by: asStaff }), (e) => e.code === "invalid_outcome");
  });
});

describe("reading", () => {
  test("the client view: plain words and the letter's own words — no sources, no lender book, no scripts", async () => {
    const db = fakeDb({ applications: [{ id: APP, bank: "Chase", lender_name: "Chase", product_name: "Ink Business Cash", status: "Denied" }] });
    await recordDecline(db, { orgId: ORG, clientId: CLIENT, by: asClient, source: "client_paste", input: { application_id: APP, text: LETTER } });
    const out = await readDeclines(db, { orgId: ORG, clientId: CLIENT, viewer: { kind: "client" } });
    assert.equal(out.staff, undefined);
    const v = out.view;
    assert.equal(v.eligible, true);
    assert.equal(v.applications[0].decline_words, "Fundhub is working on it");
    const d = v.declines[0];
    assert.equal(d.reasons[0].quote, "Too many inquiries in the last 12 months");
    assert.ok(d.your_steps.length && d.fundhub_steps.length);
    const blob = JSON.stringify(v);
    assert.doesNotMatch(blob, /Calling DENIED|SUGGESTION_CATALOGUE|lenders |Relationship Manager|source_ref|insider|bankers-rms/);
  });

  test("the staff view: sources on every line; lender-book lines only for LENDERS roles", async () => {
    const db = fakeDb({ inbox: [{ id: "e1", subject: "Your application", body_preview: "Unfortunately we cannot approve", created_at: new Date() }] });
    await recordDecline(db, { orgId: ORG, clientId: CLIENT, by: asStaff, staff: STAFF, source: "staff",
      input: { bank: "Chase", product: "Business card", text: LETTER.replace("Too many inquiries", "A business checking account is required") } });
    const advisor = await readDeclines(db, { orgId: ORG, clientId: CLIENT, viewer: { kind: "staff", canSeeBook: true } });
    const closer = await readDeclines(db, { orgId: ORG, clientId: CLIENT, viewer: { kind: "staff", canSeeBook: false } });
    const a = advisor.staff.declines[0];
    const c = closer.staff.declines[0];
    assert.ok(a.book && a.book.notes.some((n) => /checking/i.test(n.text)));
    assert.ok(!a.book.notes.some((n) => /spend|Source:/.test(n.text)));
    assert.equal(c.book, null);
    const bookStepA = a.steps.find((s) => s.source_kind === "book");
    const bookStepC = c.steps.find((s) => s.source_kind === "book");
    assert.match(bookStepA.text, /lender book says Chase/);
    assert.doesNotMatch(bookStepC.text, /requires_account_opening|relationship_required/);
    for (const s of a.steps.filter((x) => !x.blank)) assert.ok(s.source_ref, s.key);
    assert.equal(advisor.staff.bank_emails.length, 1);
  });

  test("a client in another org reads as nothing", async () => {
    const out = await readDeclines(fakeDb(), { orgId: "88888888-8888-4888-8888-888888888888", clientId: CLIENT });
    assert.equal(out, null);
  });

  test("words for an application's status and the client-safe paste answer", () => {
    assert.equal(applicationWords("Denied"), "Declined");
    assert.equal(applicationWords("Missing Docs"), "The bank needs papers");
    assert.equal(applicationWords(null), "Status not set");
    const safe = clientAnalysis(analyzeDecline({ text: LETTER, bank: "Chase", declined: true }));
    assert.doesNotMatch(JSON.stringify(safe), /Calling DENIED|sources|SUGGESTION_CATALOGUE/);
    assert.ok(safe.reasons.length && safe.fundhub_steps.length);
  });

  test("the day a letter reached us is the Arizona calendar day, not tomorrow in UTC", () => {
    assert.equal(arizonaDay("2026-10-07T03:30:00Z"), "2026-10-06");
    assert.equal(arizonaDay(null), null);
  });

  test("dates: a real calendar day or nothing", () => {
    assert.equal(parseDay("2026-02-28", "recon_on"), "2026-02-28");
    assert.equal(parseDay("", "recon_on"), null);
    assert.throws(() => parseDay("2026-02-30", "recon_on"), (e) => e.code === "invalid_recon_on");
  });
});
