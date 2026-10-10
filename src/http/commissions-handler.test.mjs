// POST /api/commissions — the real handler, run with no Postgres.
//
// Approve and Mark paid on the Products & Commissions desk change what a staff
// member is owed. Until now the module was tested (src/commissions/payout*.test)
// but the door itself never ran in a test: not its sign-in gate, not its role
// gate, not which rows it asks to change. This file runs the door.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import handler from "../../api/commissions.mjs";
import { ROUTES } from "../../netlify/functions/api.mjs";
import {
  fakeDb, makeRes, req, runWithSharedDb, staffSession, ORG_ID
} from "../testing/handler-harness.mjs";

const L1 = "1c000000-0000-4000-8000-000000000001";
const L2 = "1c000000-0000-4000-8000-000000000002";

function ledgerRow(id, over = {}) {
  return {
    id, staff_id: "5a000000-0000-4000-8000-0000000000aa", client_id: null,
    amount: "150.00", currency: "USD", status: "approved",
    approved_at: "2026-10-10T12:00:00Z", approved_by: "Olive Owner", ...over
  };
}

async function call(request, rules) {
  const fake = fakeDb(rules);
  const res = makeRes();
  await runWithSharedDb(fake, () => handler(request, res));
  return { res, fake };
}

const eventInsert = [/INSERT INTO events/, () => [{ id: "e0000000-0000-4000-8000-000000000001" }]];

describe("POST /api/commissions", () => {
  test("is routed", () => {
    assert.equal(ROUTES.commissions, handler);
  });

  test("GET is refused and names POST", async () => {
    const { res, fake } = await call(req("GET"), [staffSession()]);
    assert.equal(res.statusCode, 405);
    assert.equal(res.headers.allow, "POST");
    assert.equal(fake.calls.length, 0);
  });

  test("no session: 401 and no ledger row is touched", async () => {
    const { res, fake } = await call(req("POST", { body: { action: "approve", ledger_ids: [L1] } }), []);
    assert.equal(res.statusCode, 401);
    assert.equal(fake.find(/commission_ledger/).length, 0);
  });

  test("a closer cannot approve pay (FINANCE gate)", async () => {
    const { res, fake } = await call(
      req("POST", { body: { action: "approve", ledger_ids: [L1] } }),
      [staffSession({ role: "closer" })]
    );
    assert.equal(res.statusCode, 403);
    assert.equal(fake.find(/commission_ledger/).length, 0);
  });

  test("approve: only earned rows in this company move to approved, and each one fires commission.approved", async () => {
    const { res, fake } = await call(
      req("POST", { body: { action: "approve", ledger_ids: [L1, L2, "not-a-uuid", L1] } }),
      [staffSession({ role: "sales_manager", name: "Sam Manager" }),
        [/UPDATE commission_ledger/, () => [ledgerRow(L1, { approved_by: "Sam Manager" })]],
        eventInsert]
    );
    assert.equal(res.statusCode, 200);
    assert.deepEqual(
      { ok: res.body.ok, action: res.body.action, updated: res.body.updated, requested: res.body.requested, skipped: res.body.skipped },
      { ok: true, action: "approve", updated: 1, requested: 2, skipped: 1 }
    );
    const [upd] = fake.find(/UPDATE commission_ledger/);
    assert.match(upd.sql, /SET status = 'approved'/);
    assert.match(upd.sql, /AND status = 'earned'/);
    assert.match(upd.sql, /COALESCE\(is_demo, false\) = false/);
    assert.deepEqual(upd.params, [ORG_ID, [L1, L2], "Sam Manager"]);
    const events = fake.find(/INSERT INTO events/);
    assert.equal(events.length, 1);
    assert.equal(events[0].params[1], "commission.approved");
    assert.equal(events[0].params[3], `commission.approved|${L1}`);
  });

  test("approve with no usable ids: 400, nothing changes", async () => {
    const { res, fake } = await call(
      req("POST", { body: { action: "approve", ledger_ids: ["x", 7] } }),
      [staffSession()]
    );
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, "ledger_ids_required");
    assert.equal(fake.find(/UPDATE commission_ledger/).length, 0);
  });

  test("mark_paid needs a payout reference: 400, nothing changes", async () => {
    const { res, fake } = await call(
      req("POST", { body: { action: "mark_paid", ledger_ids: [L1], payout_ref: "  " } }),
      [staffSession()]
    );
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, "payout_ref_required");
    assert.equal(fake.find(/UPDATE commission_ledger/).length, 0);
  });

  test("mark_paid: only approved rows move to paid, the reference is stored, and commission.paid fires", async () => {
    const { res, fake } = await call(
      req("POST", { body: { action: "mark_paid", ledger_ids: [L1, L2], payout_ref: " ACH-2026-10-10 " } }),
      [staffSession(),
        [/UPDATE commission_ledger/, () => [
          ledgerRow(L1, { status: "paid", paid_at: "2026-10-10T12:00:00Z", paid_by: "Olive Owner", payout_ref: "ACH-2026-10-10" }),
          ledgerRow(L2, { status: "paid", paid_at: "2026-10-10T12:00:00Z", paid_by: "Olive Owner", payout_ref: "ACH-2026-10-10" })
        ]],
        eventInsert]
    );
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.action, "mark_paid");
    assert.equal(res.body.updated, 2);
    assert.equal(res.body.payout_ref, "ACH-2026-10-10");
    const [upd] = fake.find(/UPDATE commission_ledger/);
    assert.match(upd.sql, /SET status = 'paid'/);
    assert.match(upd.sql, /AND status = 'approved'/);
    assert.deepEqual(upd.params, [ORG_ID, [L1, L2], "Olive Owner", "ACH-2026-10-10"]);
    const names = fake.find(/INSERT INTO events/).map((c) => c.params[1]);
    assert.deepEqual(names, ["commission.paid", "commission.paid"]);
  });

  test("an unknown action is refused and lists the two allowed", async () => {
    const { res, fake } = await call(req("POST", { body: { action: "void" } }), [staffSession()]);
    assert.equal(res.statusCode, 400);
    assert.deepEqual(res.body.allowed, ["approve", "mark_paid"]);
    assert.equal(fake.find(/commission_ledger/).length, 0);
  });
});
