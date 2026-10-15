// finish-853 batch 08, repair cycle 1: POST /api/blueprint/declines, the writes the first test file left
// unjudged. The real handler runs on the REAL decline store over the in-memory decline tables, plus
// stand-in applications, application decisions, documents and clients that answer by the conditions the
// statement itself names. What is judged here:
//   - link_letter: a client's own file only, the document must be this client's in this company, the
//     decline must be this client's, the send-the-letter step closes, staff may do it too;
//   - a pasted letter is saved with its social security number, card number and birth date masked, and
//     the same letter twice is one decline and one task;
//   - staff record on an application: it becomes Denied and a decision row says so; a client's paste
//     leaves the application alone; the outcome moves it to Approved (typed amount) or Denied; a blank
//     amount stays unknown and zero is refused;
//   - a blank step cannot be marked done without its words;
//   - the call date moves the open ops task's due date and never a closed one.
// Practice test, fake data, no network, no database.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import handler from "../../api/blueprint/declines.mjs";
import { recordDecline } from "../blueprint/decline-defense.mjs";
import { letterHash, maskSensitive } from "../blueprint/decline-analyze.mjs";
import { makeRes } from "../testing/handler-harness.mjs";
import { rowsWhere, bindProblem, assertSqlHas } from "../testing/s3-scoped-rows.mjs";
import { gateAs, clientPrincipal, staffPrincipal } from "../testing/s3-mem-tasks-db.mjs";
import { memoryDb, TEST_ORG, TEST_CLIENT } from "../blueprint/decline-defense.test.db.mjs";
import { BLUEPRINT_PRODUCT_CODE } from "../waypoints/purchase.mjs";
import { PAID_TRANSACTION_STATUS } from "../entitlements/entitlements.mjs";

const OTHER_ORG = "99999999-1111-4111-8111-111111111111";
const SECOND_CLIENT = "77777777-3333-4333-8333-333333333333";
const LENDER = "44444444-4444-4444-8444-444444444444";
const APP_A = "33333333-3333-4333-8333-3333333333a1";
const APP_B = "33333333-3333-4333-8333-3333333333b2";
const DOC_OWN = "55555555-5555-4555-8555-5555555555a1";
const DOC_OTHER_CLIENT = "55555555-5555-4555-8555-5555555555b2";
const DOC_OTHER_ORG = "55555555-5555-4555-8555-5555555555c3";

const LETTER = `Thank you for applying for the Chase Ink Business Cash card.
Unfortunately, we are unable to approve your application. The principal reasons are:
- Too many inquiries in the last 12 months
- Requested credit line exceeds our guidelines
If you would like us to reconsider, please call 1-800-453-9719 within 30 days.`;
const PII_LETTER = `${LETTER}
SSN on file: 123-45-6789
Card on file 4111 1111 1111 1111
Date of birth: 01/02/1980`;
const BLANK_LETTER = LETTER.replace("Too many inquiries", "Low credit score");
const BOOK = [{
  id: LENDER, name: "Chase", lender_table: "InBranchBizCC", bureaus_pulled: "EX/EQ/TU",
  relationship_required: "yes", requires_account_opening: "yes",
  insider_tips: "Business checking account is required.", notes: "Source: book",
}];

const DANA = { id: "5aff0000-0000-4000-8000-0000000000d1", role: "owner", org_id: TEST_ORG, name: "Dana Advisor", email: "dana@example.test" };
const staff = (role = "owner", orgId = TEST_ORG) => ({
  ...staffPrincipal(role, orgId, DANA.id), name: DANA.name, email: DANA.email, staff: { ...DANA, role, org_id: orgId },
});
const client = (clientId = TEST_CLIENT, orgId = TEST_ORG) => clientPrincipal(clientId, orgId);

function standIn() {
  const clients = [{ id: TEST_CLIENT, org_id: TEST_ORG }, { id: SECOND_CLIENT, org_id: TEST_ORG }];
  const paid = new Set([TEST_CLIENT, SECOND_CLIENT]);
  const applications = [
    { id: APP_A, org_id: TEST_ORG, client_id: TEST_CLIENT, bank: "Chase", lender_name: "Chase", lender_id: LENDER, product_name: "Ink Business Cash", status: "Applied", approved_amount: null },
    { id: APP_B, org_id: TEST_ORG, client_id: TEST_CLIENT, bank: "Chase", lender_name: "Chase", lender_id: LENDER, product_name: "Ink Business Unlimited", status: "Applied", approved_amount: null },
  ];
  const documents = [
    { id: DOC_OWN, org_id: TEST_ORG, client_id: TEST_CLIENT },
    { id: DOC_OTHER_CLIENT, org_id: TEST_ORG, client_id: SECOND_CLIENT },
    { id: DOC_OTHER_ORG, org_id: OTHER_ORG, client_id: TEST_CLIENT },
  ];
  const mem = memoryDb({ lenders: BOOK, applications });
  mem.t.decisions = [];
  mem.t.applications = applications;
  const inner = mem.query.bind(mem);
  mem.calls = [];
  mem.query = async (sql, params = []) => {
    mem.calls.push({ sql, params });
    const problem = bindProblem(sql, params);
    if (problem) throw Object.assign(new Error(`bind: ${problem}`), { code: "08P01" });
    const flat = String(sql).replace(/\s+/g, " ").trim();
    if (/^SELECT 1 FROM clients\b/i.test(flat)) return { rows: rowsWhere(clients, sql, params).map(() => ({ "?column?": 1 })) };
    if (/FROM transactions t/.test(flat)) {
      const [org, client_id, code, status] = params;
      const hit = org === TEST_ORG && paid.has(client_id) && String(code).toLowerCase() === BLUEPRINT_PRODUCT_CODE.toLowerCase() && status === PAID_TRANSACTION_STATUS;
      return { rows: hit ? [{ "?column?": 1 }] : [] };
    }
    if (/^SELECT id FROM documents WHERE id = \$1::uuid AND org_id = \$2::uuid AND client_id = \$3::uuid/.test(flat)) {
      return { rows: documents.filter((d) => d.id === params[0] && d.org_id === params[1] && d.client_id === params[2]).map((d) => ({ id: d.id })) };
    }
    if (/^UPDATE applications SET .* WHERE org_id = \$1::uuid AND id = \$2::uuid RETURNING \*/.test(flat)) {
      const app = applications.find((a) => a.id === params[1] && a.org_id === params[0]);
      if (!app) return { rows: [] };
      const sets = /^UPDATE applications SET (.*) WHERE/.exec(flat)[1].split(/,\s*/);
      for (const part of sets) {
        const m = /^(\w+) = \$(\d+)(?:::\w+)?$/.exec(part);
        if (m) app[m[1]] = params[Number(m[2]) - 1];
        else if (/^status_updated_date = now\(\)$/.test(part)) app.status_updated_date = "now";
      }
      return { rows: [{ ...app }] };
    }
    if (/^UPDATE applications SET bank = \$2 WHERE id = \$1/.test(flat)) return { rows: [] };
    if (/^INSERT INTO application_decisions/.test(flat)) {
      mem.t.decisions.push({ org_id: params[0], application_id: params[1], event_type: params[2], status: params[3], created_by: params[5], notes: params[6] });
      return { rows: [] };
    }
    return inner(sql, params);
  };
  return mem;
}

async function call({ method = "POST", query = {}, body, principal, mem }) {
  const res = makeRes();
  await handler({ method, query, body }, res, { db: mem, requirePrincipal: gateAs(principal), now: () => new Date("2026-10-14T18:00:00Z") });
  return res;
}
const post = (mem, principal, body) => call({ method: "POST", body, principal, mem });
async function staffDecline(mem, { text = LETTER, bank = "Chase", ...rest } = {}) {
  const res = await post(mem, staff(), { action: "record", client_id: TEST_CLIENT, text, bank, ...rest });
  assert.equal(res.statusCode, 201, JSON.stringify(res.body));
  return res.body.decline.id;
}

describe("/api/blueprint/declines link_letter", () => {
  test("a client links their own uploaded letter: the decline carries it and the send-the-letter step closes, done by the client", async () => {
    const mem = standIn();
    const id = await staffDecline(mem, { text: null });
    const decline = () => mem.t.declines.find((d) => d.id === id);
    const step = () => mem.t.steps.find((s) => s.decline_id === id && s.step_key === "get_letter");
    assert.equal(step().status, "open", "no letter yet, so the step is open");
    assert.equal(decline().letter_document_id, null);
    const res = await post(mem, client(), { action: "link_letter", decline_id: id, document_id: DOC_OWN });
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    assert.equal(res.body.ok, true);
    assert.equal(res.body.letter_document_id, DOC_OWN);
    assert.equal(decline().letter_document_id, DOC_OWN);
    assert.equal(step().status, "done");
    assert.equal(step().done_by, "client");
  });

  test("staff may link a letter too, and the step says which staff member did it", async () => {
    const mem = standIn();
    const id = await staffDecline(mem, { text: null });
    const res = await post(mem, staff(), { action: "link_letter", client_id: TEST_CLIENT, decline_id: id, document_id: DOC_OWN });
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    assert.equal(mem.t.declines.find((d) => d.id === id).letter_document_id, DOC_OWN);
    assert.equal(mem.t.steps.find((s) => s.decline_id === id && s.step_key === "get_letter").done_by, DANA.name);
  });

  test("another client's file and another company's file are refused 404 and nothing is linked; a malformed id is 400", async () => {
    const mem = standIn();
    const id = await staffDecline(mem, { text: null });
    const untouched = () => {
      assert.equal(mem.t.declines.find((d) => d.id === id).letter_document_id, null);
      assert.equal(mem.t.steps.find((s) => s.decline_id === id && s.step_key === "get_letter").status, "open");
    };
    for (const [who, documentId] of [["a document of another client", DOC_OTHER_CLIENT], ["a document of another company", DOC_OTHER_ORG]]) {
      const res = await post(mem, client(), { action: "link_letter", decline_id: id, document_id: documentId });
      assert.equal(res.statusCode, 404, who);
      assert.equal(res.body.error, "document_not_found", who);
      untouched();
    }
    const bad = await post(mem, client(), { action: "link_letter", decline_id: id, document_id: "not-an-id" });
    assert.equal(bad.statusCode, 400);
    assert.equal(bad.body.error, "invalid_document_id");
    untouched();
  });

  test("a decline that is not on this client's file is 404 whoever asks, and its row is left alone", async () => {
    const mem = standIn();
    const otherId = (await recordDecline(mem, {
      orgId: TEST_ORG, clientId: SECOND_CLIENT, by: { kind: "staff", name: DANA.name }, source: "staff",
      input: { bank: "Chase" }, now: new Date("2026-10-14T18:00:00Z"),
    })).decline_id;
    assert.ok(otherId);
    const asClient = await post(mem, client(), { action: "link_letter", decline_id: otherId, document_id: DOC_OWN });
    assert.equal(asClient.statusCode, 404);
    assert.equal(asClient.body.error, "not_found");
    const asStaff = await post(mem, staff(), { action: "link_letter", client_id: TEST_CLIENT, decline_id: otherId, document_id: DOC_OWN });
    assert.equal(asStaff.statusCode, 404);
    assert.equal(mem.t.declines.find((d) => d.id === otherId).letter_document_id, null);
    const noId = await post(mem, client(), { action: "link_letter", document_id: DOC_OWN });
    assert.equal(noId.statusCode, 400);
    assert.equal(noId.body.error, "decline_id_required");
  });
});

describe("/api/blueprint/declines: what a pasted letter saves", () => {
  test("a social security number, a card number and a birth date never reach the saved letter, the plan or the answer", async () => {
    const mem = standIn();
    const res = await post(mem, client(), { action: "paste", text: PII_LETTER, bank: "Chase", product: "Ink Business Cash" });
    assert.equal(res.statusCode, 201);
    const saved = mem.t.declines[0];
    assert.doesNotMatch(saved.letter_text, /123-45-6789|4111 1111 1111 1111|01\/02\/1980/);
    assert.match(saved.letter_text, /Unfortunately, we are unable to approve/, "the rest of the letter is kept");
    assert.ok(maskSensitive(PII_LETTER).masked >= 3, "the fixture really has three things to mask");
    assert.equal(saved.letter_hash, letterHash(maskSensitive(PII_LETTER).text), "the same-letter check reads the masked letter");
    assert.doesNotMatch(JSON.stringify({ saved, steps: mem.t.steps, tasks: mem.t.tasks, answer: res.body }), /123-45-6789|4111 1111 1111 1111|01\/02\/1980/);
  });

  test("the same letter pasted again, even re-spaced and in another case, is the same decline: one row, one task, answered as a duplicate", async () => {
    const mem = standIn();
    const first = await post(mem, client(), { action: "paste", text: LETTER, bank: "Chase" });
    assert.equal(first.statusCode, 201);
    const again = await post(mem, client(), { action: "paste", text: LETTER.toUpperCase().replace(/\n/g, "\n\n  "), bank: "Chase" });
    assert.equal(again.statusCode, 200);
    assert.equal(again.body.created, false);
    assert.equal(again.body.duplicate, true);
    assert.equal(again.body.decline.id, first.body.decline.id, "the answer points at the decline that is already there");
    assert.equal(mem.t.declines.length, 1);
    assert.equal(mem.t.tasks.length, 1);
    const insert = mem.calls.find((c) => /^\s*INSERT INTO blueprint_declines/.test(c.sql));
    assertSqlHas(insert.sql, {
      "a repeat is a no-op, not an error": "ON CONFLICT DO NOTHING",
      "the saved row comes back": "RETURNING *",
    });
    const dup = mem.calls.find((c) => /FROM blueprint_declines\s+WHERE org_id = \$1::uuid AND client_id = \$2::uuid\s+AND \(\(\$3::uuid IS NOT NULL/.test(c.sql));
    assert.ok(dup, "the duplicate is found on this client's own declines by application or letter");
  });
});

describe("/api/blueprint/declines: the application the bank answered", () => {
  test("a client's paste on an application leaves it alone; staff recording the decline turns it Denied and a decision row says why", async () => {
    const mem = standIn();
    const pasted = await post(mem, client(), { action: "paste", text: LETTER, bank: "Chase", application_id: APP_A });
    assert.equal(pasted.statusCode, 201, JSON.stringify(pasted.body));
    assert.equal(mem.t.applications.find((a) => a.id === APP_A).status, "Applied", "a person confirms first");
    assert.equal(mem.t.decisions.length, 0);

    const recorded = await post(mem, staff(), { action: "record", client_id: TEST_CLIENT, text: BLANK_LETTER, application_id: APP_B });
    assert.equal(recorded.statusCode, 201, JSON.stringify(recorded.body));
    const app = mem.t.applications.find((a) => a.id === APP_B);
    assert.equal(app.status, "Denied");
    assert.equal(app.status_updated_date, "now");
    assert.equal(mem.t.decisions.length, 1);
    assert.deepEqual(
      { application_id: mem.t.decisions[0].application_id, event_type: mem.t.decisions[0].event_type, status: mem.t.decisions[0].status, created_by: mem.t.decisions[0].created_by, org_id: mem.t.decisions[0].org_id },
      { application_id: APP_B, event_type: "decline_recorded", status: "Denied", created_by: DANA.name, org_id: TEST_ORG },
    );
    assert.match(mem.t.decisions[0].notes, new RegExp(recorded.body.decline.id));
  });

  test("approved on reconsideration: the decline keeps the typed amount, the application becomes Approved with it, and the answer says so", async () => {
    const mem = standIn();
    const id = await staffDecline(mem, { application_id: APP_A });
    const res = await post(mem, staff(), { action: "outcome", client_id: TEST_CLIENT, decline_id: id, outcome: "approved_on_recon", approved_amount: "$45,000.50", notes: "  Banker said yes.  " });
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    assert.equal(res.body.outcome, "approved_on_recon");
    assert.equal(res.body.approved_amount, "45000.50");
    assert.equal(res.body.application_status, "Approved");
    const d = mem.t.declines.find((x) => x.id === id);
    assert.equal(d.outcome, "approved_on_recon");
    assert.equal(d.outcome_approved_amount, "45000.50");
    assert.equal(d.outcome_notes, "Banker said yes.");
    assert.equal(d.outcome_by, DANA.name);
    assert.ok(d.outcome_at);
    const app = mem.t.applications.find((a) => a.id === APP_A);
    assert.equal(app.status, "Approved");
    assert.equal(app.approved_amount, "45000.50", "the application carries the same amount");
    assert.deepEqual(mem.t.decisions.map((x) => [x.event_type, x.status]), [["decline_recorded", "Denied"], ["reconsideration", "Approved"]]);
  });

  test("approved with no amount typed leaves the amount unknown (not 0) on the decline and on the application; zero is refused", async () => {
    const mem = standIn();
    const id = await staffDecline(mem, { application_id: APP_A });
    const zero = await post(mem, staff(), { action: "outcome", client_id: TEST_CLIENT, decline_id: id, outcome: "approved_on_recon", approved_amount: "0" });
    assert.equal(zero.statusCode, 400);
    assert.equal(zero.body.error, "invalid_approved_amount");
    assert.equal(mem.t.declines.find((x) => x.id === id).outcome, "open", "a refused amount saves nothing");
    assert.equal(mem.t.applications.find((a) => a.id === APP_A).status, "Denied");

    const res = await post(mem, staff(), { action: "outcome", client_id: TEST_CLIENT, decline_id: id, outcome: "approved_on_recon", approved_amount: "" });
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    assert.equal(res.body.approved_amount, null);
    assert.equal(mem.t.declines.find((x) => x.id === id).outcome_approved_amount, null);
    const app = mem.t.applications.find((a) => a.id === APP_A);
    assert.equal(app.status, "Approved");
    assert.equal(app.approved_amount, null, "no amount was typed, so none is written: never 0");
  });

  test("still declined and re-apply later turn an application Denied, re-apply later keeps its day, and an open outcome touches nothing", async () => {
    const mem = standIn();
    const id = await staffDecline(mem, { application_id: APP_A });
    const app = mem.t.applications.find((a) => a.id === APP_A);
    app.status = "Applied"; // as if the bank's yes arrived first
    const before = mem.t.decisions.length;
    const open = await post(mem, staff(), { action: "outcome", client_id: TEST_CLIENT, decline_id: id, outcome: "open" });
    assert.equal(open.statusCode, 200);
    assert.equal(app.status, "Applied");
    assert.equal(mem.t.decisions.length, before);
    assert.equal(mem.t.declines.find((x) => x.id === id).outcome_at, null);

    const later = await post(mem, staff(), { action: "outcome", client_id: TEST_CLIENT, decline_id: id, outcome: "reapply_later", reapply_on: "2027-01-15" });
    assert.equal(later.statusCode, 200, JSON.stringify(later.body));
    assert.equal(later.body.reapply_on, "2027-01-15");
    assert.match(later.body.next_sequence_note, /Jan 15, 2027/);
    assert.equal(app.status, "Denied");
    assert.equal(mem.t.decisions.at(-1).event_type, "reconsideration");
    assert.equal(mem.t.decisions.at(-1).status, "Denied");
    assert.equal(mem.t.declines.find((x) => x.id === id).outcome_approved_amount, null, "an amount only goes with an approval");

    // Already Denied: no second decision row.
    const count = mem.t.decisions.length;
    const still = await post(mem, staff(), { action: "outcome", client_id: TEST_CLIENT, decline_id: id, outcome: "still_declined" });
    assert.equal(still.statusCode, 200);
    assert.equal(mem.t.decisions.length, count);
    assert.equal(mem.t.declines.find((x) => x.id === id).reapply_on, null, "a re-apply day is cleared when the outcome is not re-apply-later");
  });
});

describe("/api/blueprint/declines: blanks and the call date", () => {
  test("a blank step cannot be marked done without its words; with words it closes, keeps them and names who", async () => {
    const mem = standIn();
    const id = await staffDecline(mem, { text: BLANK_LETTER });
    const blank = mem.t.steps.find((s) => s.decline_id === id && s.is_blank);
    assert.ok(blank, "a reason no source covers leaves a blank");
    const refused = await post(mem, staff(), { action: "step", client_id: TEST_CLIENT, decline_id: id, step_key: blank.step_key, status: "done" });
    assert.equal(refused.statusCode, 400);
    assert.equal(refused.body.error, "blank_needs_words");
    assert.equal(blank.status, "open");
    assert.equal(blank.filled_text ?? null, null);
    const filled = await post(mem, staff(), { action: "step", client_id: TEST_CLIENT, decline_id: id, step_key: blank.step_key, status: "done", filled_text: "  The score dip came from one late payment that is now disputed.  " });
    assert.equal(filled.statusCode, 200, JSON.stringify(filled.body));
    assert.equal(filled.body.step.status, "done");
    assert.equal(blank.filled_text, "The score dip came from one late payment that is now disputed.");
    assert.equal(blank.done_by, DANA.name);
    const reopened = await post(mem, staff(), { action: "step", client_id: TEST_CLIENT, decline_id: id, step_key: blank.step_key, status: "open" });
    assert.equal(reopened.statusCode, 200);
    assert.equal(blank.status, "open");
    assert.equal(blank.done_at, null);
    assert.equal(blank.done_by, null);
    assert.match(blank.filled_text, /late payment/, "reopening keeps the words");
    const badStatus = await post(mem, staff(), { action: "step", client_id: TEST_CLIENT, decline_id: id, step_key: blank.step_key, status: "finished" });
    assert.equal(badStatus.statusCode, 400);
    assert.equal(badStatus.body.error, "invalid_status");
  });

  test("setting the call date moves the open ops task's due date; clearing it clears the date; a closed task is never moved", async () => {
    const mem = standIn();
    const id = await staffDecline(mem);
    const task = mem.t.tasks[0];
    assert.equal(task.due_at ?? null, null, "no call date yet");
    const set = await post(mem, staff(), { action: "schedule", client_id: TEST_CLIENT, decline_id: id, recon_on: "2026-10-20" });
    assert.equal(set.statusCode, 200);
    assert.equal(set.body.recon_on, "2026-10-20");
    assert.equal(task.due_at, "2026-10-20T16:00:00Z");
    assert.equal(String(mem.t.declines[0].recon_on).slice(0, 10), "2026-10-20");
    const sql = mem.calls.find((c) => /^\s*UPDATE tasks SET due_at/.test(c.sql));
    assertSqlHas(sql.sql, { "a closed task is left alone": "WHERE id = $1::uuid AND done = false" });

    const refused = await post(mem, staff(), { action: "schedule", client_id: TEST_CLIENT, decline_id: id, recon_on: "soon" });
    assert.equal(refused.statusCode, 400);
    assert.equal(refused.body.error, "invalid_recon_on");
    assert.equal(task.due_at, "2026-10-20T16:00:00Z");

    const cleared = await post(mem, staff(), { action: "schedule", client_id: TEST_CLIENT, decline_id: id, recon_on: null });
    assert.equal(cleared.statusCode, 200);
    assert.equal(cleared.body.recon_on, null);
    assert.equal(task.due_at, null);

    task.done = true;
    task.due_at = "2026-10-01T16:00:00Z";
    const closed = await post(mem, staff(), { action: "schedule", client_id: TEST_CLIENT, decline_id: id, recon_on: "2026-11-02" });
    assert.equal(closed.statusCode, 200);
    assert.equal(task.due_at, "2026-10-01T16:00:00Z", "a task a person closed keeps the date it had");
    assert.equal(String(mem.t.declines[0].recon_on).slice(0, 10), "2026-11-02", "the decline's own call date still moves");
  });

  test("a staff record with a call date opens its task due on that date at 4 p.m. UTC", async () => {
    const mem = standIn();
    await staffDecline(mem, { recon_on: "2026-10-22" });
    assert.equal(mem.t.tasks[0].due_at, "2026-10-22T16:00:00Z");
    assert.equal(mem.t.tasks[0].assignee_role, "funding_advisor");
  });
});
