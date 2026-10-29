// GET /api/read/invoices — the real handler, run with no Postgres.
//
// The AR table on Ops & Admin and "Invoice this client" on Present both read
// this door. ar-filter.test.mjs tested the filter and read the source text;
// nothing ran the handler. This runs it: the role gate, the company from the
// session, the "open" filter, and the refusal of a status that does not exist.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import handler from "../../api/read/invoices.mjs";
import { ROUTES } from "../../netlify/functions/api.mjs";
import {
  fakeDb, makeRes, req, runWithSharedDb, staffSession, ORG_ID
} from "../testing/handler-harness.mjs";

const CLIENT = "c1000000-0000-4000-8000-000000000001";

async function call(request, rules) {
  const fake = fakeDb(rules);
  const res = makeRes();
  await runWithSharedDb(fake, () => handler(request, res));
  return { res, fake };
}

const invoice = (id, over = {}) => ({
  id, client_id: CLIENT, client_code: "FH-000101", client_name: "Dana Whitfield",
  status: "sent", currency: "USD", amount_due: "5000.00", amount_paid: "0.00",
  balance_due: "5000.00", open_balance: "5000.00", days_overdue: 12, is_overdue: true,
  aging_bucket: "1-30", owner_name: "Morgan CSM", payment_method: "ach",
  due_at: "2026-10-20T12:00:00.000Z", sent_at: "2026-10-01T12:00:00.000Z",
  reminded_at: "2026-10-10T12:00:00.000Z", reminder_count: 1,
  escalated_at: null, last_payment_at: null, ...over
});

describe("GET /api/read/invoices", () => {
  test("is routed", () => {
    assert.equal(ROUTES["read/invoices"], handler);
  });

  test("POST is refused", async () => {
    const { res, fake } = await call(req("POST"), [staffSession()]);
    assert.equal(res.statusCode, 405);
    assert.equal(fake.find(/v_invoice_aging/).length, 0);
  });

  test("no session: 401", async () => {
    const { res, fake } = await call(req("GET"), []);
    assert.equal(res.statusCode, 401);
    assert.equal(fake.find(/v_invoice_aging/).length, 0);
  });

  test("a closer is refused (FINANCE only: owner, admin, sales manager)", async () => {
    const { res, fake } = await call(req("GET", { query: { client_id: CLIENT } }), [staffSession({ role: "closer" })]);
    assert.equal(res.statusCode, 403);
    assert.equal(fake.find(/v_invoice_aging/).length, 0);
  });

  test("?status=open asks for money still owed, oldest first, in this company only, demo invoices left out", async () => {
    const { res, fake } = await call(
      req("GET", { query: { status: "open", client_id: CLIENT, limit: "5" } }),
      [staffSession({ role: "sales_manager" }),
        [/FROM v_invoice_aging v/, [
          invoice("i1", { balance_due: "5000.00", days_overdue: 45, aging_bucket: "31-60" }),
          invoice("i2", { status: "reminded", balance_due: "1250.00", days_overdue: 12, aging_bucket: "1-30" }),
        ]]]
    );
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.count, 2);
    assert.equal(res.body.items[0].client_name, "Dana Whitfield");
    assert.equal(res.body.items[0].owner_name, "Morgan CSM");
    assert.equal(res.body.items[0].payment_method, "ach");
    assert.deepEqual(
      res.body.items.map(({ id, balance_due, days_overdue, aging_bucket }) => ({
        id, balance_due, days_overdue, aging_bucket
      })),
      [
        { id: "i1", balance_due: "5000.00", days_overdue: 45, aging_bucket: "31-60" },
        { id: "i2", balance_due: "1250.00", days_overdue: 12, aging_bucket: "1-30" },
      ]
    );
    const [q] = fake.find(/FROM v_invoice_aging v/);
    // limit + 1 (to learn hasMore), offset, client, exact status, org, open-only
    assert.deepEqual(q.params, [6, 0, CLIENT, null, ORG_ID, true]);
    assert.match(q.sql, /WHERE v\.org_id = \$5::uuid/);
    assert.match(q.sql, /COALESCE\(i\.is_demo, false\) = false/);
    assert.match(q.sql, /v\\.open_balance > 0/);
    assert.match(q.sql, /v\\.status IN \\('sent', 'reminded', 'escalated', 'partially_paid'\\)/,
      "the Open A/R queue cannot list drafts as collectible");
    assert.match(q.sql, /LEFT JOIN staff s ON s\.id = c\.assigned_csm_staff_id AND s\.org_id = c\.org_id/);
    assert.match(q.sql, /FROM invoice_payments p[\s\S]*p\.invoice_id = v\.invoice_id AND p\.org_id = v\.org_id/);
    assert.match(q.sql, /ORDER BY CASE WHEN \$6::boolean IS TRUE THEN v\.due_at END ASC NULLS LAST/);
    assert.match(q.sql, /CASE WHEN \$6::boolean IS TRUE THEN v\.created_at END ASC/);
  });

  test("an exact stored status is passed through", async () => {
    const { res, fake } = await call(
      req("GET", { query: { status: "Escalated" } }),
      [staffSession(), [/FROM v_invoice_aging v/, []]]
    );
    assert.equal(res.statusCode, 200);
    assert.deepEqual(fake.find(/FROM v_invoice_aging v/)[0].params, [51, 0, null, "escalated", ORG_ID, false]);
  });

  test("?status=draft remains available for finance review, never counted as Open", async () => {
    const { res, fake } = await call(
      req("GET", { query: { status: "draft" } }),
      [staffSession({ role: "owner" }), [/FROM v_invoice_aging v/, []]]
    );
    assert.equal(res.statusCode, 200);
    assert.deepEqual(
      fake.find(/FROM v_invoice_aging v/)[0].params,
      [51, 0, null, "draft", ORG_ID, false]
    );
  });

  test("a status that does not exist is a 400 that names the real ones, and no query runs", async () => {
    const { res, fake } = await call(req("GET", { query: { status: "unpaid" } }), [staffSession()]);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, "bad_request");
    assert.match(res.body.message, /Use "open"/);
    assert.equal(fake.find(/v_invoice_aging/).length, 0);
  });

  test("more rows than the limit sets hasMore and trims the page", async () => {
    const { res } = await call(
      req("GET", { query: { limit: "1" } }),
      [staffSession(), [/FROM v_invoice_aging v/, [invoice("i1"), invoice("i2")]]]
    );
    assert.equal(res.body.hasMore, true);
    assert.equal(res.body.items.length, 1);
  });

  test("a session with no company binds NULL, so it matches nothing (fails closed)", async () => {
    const { res, fake } = await call(
      req("GET"),
      [staffSession({ org_id: null }), [/FROM v_invoice_aging v/, []]]
    );
    assert.equal(res.statusCode, 200);
    assert.equal(fake.find(/FROM v_invoice_aging v/)[0].params[4], null);
  });
});
