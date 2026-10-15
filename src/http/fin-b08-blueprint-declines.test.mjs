// finish-853 batch 08: GET/POST /api/blueprint/declines. The real handler runs on the REAL decline
// store (src/blueprint/decline-defense.mjs) over the in-memory tables of decline-defense.test.db.mjs.
// Earlier handler tests stubbed the store; this one judges the saved result: what the client reads,
// who may write, the paid-Blueprint gate, and which lines only the lender-book roles may see.
// Practice test, fake data, no network, no database.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import handler from "../../api/blueprint/declines.mjs";
import { makeRes } from "../testing/handler-harness.mjs";
import { rowsWhere, bindProblem, assertSqlHas } from "../testing/s3-scoped-rows.mjs";
import { gateAs, clientPrincipal, staffPrincipal } from "../testing/s3-mem-tasks-db.mjs";
import { memoryDb, TEST_ORG, TEST_CLIENT } from "../blueprint/decline-defense.test.db.mjs";
import { STAFF_ROLES } from "../pulse/catalog/proofs/s2-route-kit.mjs";
import { BLUEPRINT_PRODUCT_CODE } from "../waypoints/purchase.mjs";
import { PAID_TRANSACTION_STATUS } from "../entitlements/entitlements.mjs";

const OTHER_ORG = "99999999-1111-4111-8111-111111111111";
const OTHER_CLIENT = "88888888-2222-4222-8222-222222222222";
const LENDER = "44444444-4444-4444-8444-444444444444";
const LETTER = `Thank you for applying for the Chase Ink Business Cash card.
Unfortunately, we are unable to approve your application. The principal reasons are:
- Too many inquiries in the last 12 months
- Requested credit line exceeds our guidelines
If you would like us to reconsider, please call 1-800-453-9719 within 30 days.`;
const RELATIONSHIP_LETTER = `Thank you for applying for the Chase Ink Business Cash card.
Unfortunately, we are unable to approve your application. The principal reason is:
- No existing banking relationship with us
If you would like us to reconsider, please call 1-800-453-9719 within 30 days.`;
const BOOK = [{
  id: LENDER, name: "Chase", lender_table: "InBranchBizCC", bureaus_pulled: "EX/EQ/TU",
  relationship_required: "yes", requires_account_opening: "yes",
  insider_tips: "Business checking account is required.; Call the reconsideration line 800-555-0142 and ask for a manual review.",
  notes: "Source: book",
}];

/**
 * The in-memory decline tables, plus the two reads the handler's own gates make:
 *   SELECT 1 FROM clients WHERE id = $1 AND org_id = $2   (the company boundary)
 *   the paid Capital Blueprint read, answered from a transactions list by org, client, product, status.
 * Every statement goes through Postgres's bind rule first, so a lost condition fails like a real database.
 */
function standIn({ buyer = true, ...opts } = {}) {
  const clients = [
    { id: TEST_CLIENT, org_id: TEST_ORG },
    { id: OTHER_CLIENT, org_id: OTHER_ORG },
  ];
  const transactions = buyer
    ? [{ org_id: TEST_ORG, client_id: TEST_CLIENT, code: BLUEPRINT_PRODUCT_CODE, status: PAID_TRANSACTION_STATUS }]
    : [{ org_id: TEST_ORG, client_id: TEST_CLIENT, code: BLUEPRINT_PRODUCT_CODE, status: "refunded" }];
  const mem = memoryDb({ lenders: BOOK, ...opts });
  const inner = mem.query.bind(mem);
  mem.calls = [];
  mem.query = async (sql, params = []) => {
    mem.calls.push({ sql, params });
    const problem = bindProblem(sql, params);
    if (problem) throw Object.assign(new Error(`bind: ${problem}`), { code: "08P01" });
    if (/^\s*SELECT 1 FROM clients\b/i.test(sql)) {
      return { rows: rowsWhere(clients, sql, params).map(() => ({ "?column?": 1 })) };
    }
    if (/FROM transactions t/.test(sql)) {
      const [org, client, code, status] = params;
      const hit = transactions.some((t) => t.org_id === org && t.client_id === client
        && t.code.toLowerCase() === String(code).toLowerCase() && String(t.status).toLowerCase() === status);
      return { rows: hit ? [{ "?column?": 1 }] : [] };
    }
    return inner(sql, params);
  };
  return mem;
}

async function call({ method = "GET", query = {}, body, principal, mem = standIn() } = {}) {
  const res = makeRes();
  await handler({ method, query, body }, res, { db: mem, requirePrincipal: gateAs(principal), now: () => new Date("2026-10-14T18:00:00Z") });
  return { res, mem };
}
const client = (clientId = TEST_CLIENT, orgId = TEST_ORG) => clientPrincipal(clientId, orgId);
const staff = (role = "owner", orgId = TEST_ORG) => staffPrincipal(role, orgId);

describe("/api/blueprint/declines, on the real decline store", () => {
  test("a paid client pastes a bank letter: the decline is saved on their own file, read in plain words, with no lender-book lines", async () => {
    const { res, mem } = await call({ method: "POST", body: { action: "paste", text: LETTER, bank: "Chase", product: "Ink Business Cash" }, principal: client() });
    assert.equal(res.statusCode, 201);
    assert.equal(res.body.created, true);
    assert.equal(mem.t.declines.length, 1);
    const saved = mem.t.declines[0];
    assert.equal(saved.client_id, TEST_CLIENT);
    assert.equal(saved.org_id, TEST_ORG);
    assert.equal(saved.source, "client_paste");
    assert.deepEqual(saved.reason_categories, ["too_many_inquiries"]);
    assert.equal(mem.t.tasks.length, 1, "one ops task opens for the funding advisor");
    const blob = JSON.stringify(res.body);
    assert.doesNotMatch(blob, /Relationship Manager|insider|book_phones|rows_found|lender_id/, "no lender-book line reaches a client");
    assert.ok(res.body.decline.id, "the client gets their decline back");

    const read = await call({ query: { client_id: OTHER_CLIENT }, principal: client(), mem });
    assert.equal(read.res.statusCode, 200);
    assert.equal(read.res.body.view.client.id, TEST_CLIENT, "a client_id in the address is never read for a client");
    assert.equal(read.res.body.view.declines.length, 1);
    assert.equal(read.res.body.staff, undefined);
  });

  test("a client who has not bought the Capital Blueprint cannot paste: 403 and nothing is saved", async () => {
    const mem = standIn({ buyer: false });
    const { res } = await call({ method: "POST", body: { action: "paste", text: LETTER, bank: "Chase" }, principal: client(), mem });
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.error, "not_blueprint_buyer");
    assert.equal(mem.t.declines.length, 0);
    assert.equal(mem.t.tasks.length, 0);
    const read = await call({ principal: client(), mem });
    assert.equal(read.res.body.view.eligible, false);
    assert.equal(read.res.body.view.can_paste, false);
  });

  test("the paid check names this company, this client, the Blueprint product and a paid status", async () => {
    const mem = standIn();
    await call({ method: "POST", body: { action: "paste", text: LETTER, bank: "Chase" }, principal: client(), mem });
    const sql = mem.calls.find((c) => /FROM transactions t/.test(c.sql));
    assertSqlHas(sql.sql, {
      "this company and client": "WHERE t.org_id = $1::uuid AND t.client_id = $2::uuid",
      "the Blueprint product": "AND lower(p.code) = lower($3)",
      "a paid transaction": "AND lower(btrim(COALESCE(t.status, ''))) = $4",
    });
    assert.deepEqual(sql.params, [TEST_ORG, TEST_CLIENT, BLUEPRINT_PRODUCT_CODE, PAID_TRANSACTION_STATUS]);
  });

  test("a client may only paste and link a letter; record, step, schedule and outcome are staff's and nothing is saved", async () => {
    for (const action of ["record", "step", "schedule", "outcome"]) {
      const mem = standIn();
      const { res } = await call({ method: "POST", body: { action, bank: "Chase", text: LETTER, decline_id: "x" }, principal: client(), mem });
      assert.equal(res.statusCode, 403, action);
      assert.equal(mem.t.declines.length, 0, action);
    }
    const mem = standIn();
    const unknown = await call({ method: "POST", body: { action: "wipe" }, principal: client(), mem });
    assert.equal(unknown.res.statusCode, 400);
  });

  test("staff record a decline: the saved row carries who recorded it, and the staff view holds the plan", async () => {
    const mem = standIn();
    const { res } = await call({ method: "POST", body: { action: "record", client_id: TEST_CLIENT, text: LETTER, bank: "Chase", product: "Ink Business Cash", declined_on: "2026-10-12" }, principal: staff("funding_advisor"), mem });
    assert.equal(res.statusCode, 201);
    assert.equal(res.body.decline.bank, "Chase");
    assert.equal(mem.t.declines[0].source, "staff");
    assert.match(mem.t.declines[0].recorded_by, /5aff0000|funding_advisor|Staff|staff/i);
    assert.equal(String(mem.t.declines[0].declined_on).slice(0, 10), "2026-10-12");
    assert.equal(res.body.task_created, true);
  });

  test("lender-book lines are shown to owner, admin and funding advisor only; every other staff role gets the plan with them hidden", async () => {
    const mem = standIn();
    await call({ method: "POST", body: { action: "record", client_id: TEST_CLIENT, text: RELATIONSHIP_LETTER, bank: "Chase" }, principal: staff("owner"), mem });
    const sees = [];
    for (const role of STAFF_ROLES) {
      const { res } = await call({ query: { client_id: TEST_CLIENT }, principal: staff(role), mem });
      assert.equal(res.statusCode, 200, role);
      const book = res.body.staff.declines[0].book;
      const everything = JSON.stringify(res.body.staff);
      if (book) {
        sees.push(role);
        assert.equal(res.body.staff.can_see_book, true);
        assert.ok(book.rows_found >= 1, `${role} sees the book rows`);
        assert.match(everything, /800-555-0142/, `${role} sees the book's own phone line`);
        assert.match(everything, /The lender book says Chase wants an existing account or relationship first/, `${role} sees the book step`);
      } else {
        assert.equal(res.body.staff.can_see_book, false, role);
        assert.doesNotMatch(everything, /800-555-0142/, `${role}: the lender book's phone line is hidden`);
        assert.doesNotMatch(everything, /Business checking account is required/, `${role}: no book tip`);
        assert.doesNotMatch(everything, /The lender book says|lenders 4444/, `${role}: the book step is masked`);
        assert.match(everything, /A lender-book note for this bank/, `${role}: told a book note exists`);
      }
    }
    assert.deepEqual(sees.sort(), ["admin", "funding_advisor", "owner"]);
  });

  test("staff step, schedule and outcome change the saved decline: a step done, a reconsideration date, and the outcome words", async () => {
    const mem = standIn();
    const made = await call({ method: "POST", body: { action: "record", client_id: TEST_CLIENT, text: LETTER, bank: "Chase" }, principal: staff("owner"), mem });
    const declineId = made.res.body.decline.id;
    const stepKey = mem.t.steps.find((s) => s.status === "open" && !s.is_blank).step_key;

    const step = await call({ method: "POST", body: { action: "step", client_id: TEST_CLIENT, decline_id: declineId, step_key: stepKey, status: "done" }, principal: staff("owner"), mem });
    assert.equal(step.res.statusCode, 200);
    assert.equal(mem.t.steps.find((s) => s.step_key === stepKey).status, "done");

    const schedule = await call({ method: "POST", body: { action: "schedule", client_id: TEST_CLIENT, decline_id: declineId, recon_on: "2026-10-20" }, principal: staff("owner"), mem });
    assert.equal(schedule.res.statusCode, 200);
    assert.equal(String(mem.t.declines[0].recon_on).slice(0, 10), "2026-10-20");

    const outcome = await call({ method: "POST", body: { action: "outcome", client_id: TEST_CLIENT, decline_id: declineId, outcome: "still_declined", notes: "Banker said no." }, principal: staff("owner"), mem });
    assert.equal(outcome.res.statusCode, 200);
    assert.equal(mem.t.declines[0].outcome, "still_declined");
    assert.equal(mem.t.declines[0].outcome_notes, "Banker said no.");
  });

  test("a reapply-later outcome with no date is refused and the decline stays open", async () => {
    const mem = standIn();
    const made = await call({ method: "POST", body: { action: "record", client_id: TEST_CLIENT, text: LETTER, bank: "Chase" }, principal: staff("owner"), mem });
    const refused = await call({ method: "POST", body: { action: "outcome", client_id: TEST_CLIENT, decline_id: made.res.body.decline.id, outcome: "reapply_later" }, principal: staff("owner"), mem });
    assert.notEqual(refused.res.statusCode, 200);
    assert.equal(mem.t.declines[0].outcome, "open");
  });

  test("a role outside STAFF is refused, and staff of another company see a client of this one as not found", async () => {
    const mem = standIn();
    const wrongRole = await call({ query: { client_id: TEST_CLIENT }, principal: staff("not_a_staff_role"), mem });
    assert.equal(wrongRole.res.statusCode, 403);
    const before = mem.calls.length;
    const other = await call({ method: "POST", body: { action: "record", client_id: TEST_CLIENT, text: LETTER, bank: "Chase" }, principal: staff("owner", OTHER_ORG), mem });
    assert.equal(other.res.statusCode, 404);
    assert.equal(mem.t.declines.length, 0);
    assert.equal(mem.calls.slice(before).filter((c) => /blueprint_declines/.test(c.sql)).length, 0, "no decline table was touched");
  });

  test("the sixth paste in a day is turned away with 429 and nothing more is saved", async () => {
    const mem = standIn({ pastesToday: 5 });
    const { res } = await call({ method: "POST", body: { action: "paste", text: `${LETTER}\nCase 6`, bank: "Chase" }, principal: client(), mem });
    assert.equal(res.statusCode, 429);
    assert.equal(res.body.error, "too_many_pastes");
    assert.equal(mem.t.declines.length, 0);
  });
});
