// Slice 1 (money routes): /api/payment-links. A payment link is a request for
// money, so these judge exactly what is minted, who may mint it, and that an
// invoice row is a draft that sends nothing. The real handler runs on a
// stand-in database; the checkout provider is never called (only the fallback
// query-link base is set).
import assert from "node:assert/strict";
import test from "node:test";

import handler from "../../../../api/payment-links.mjs";
import { ROUTES } from "../../../../netlify/functions/api.mjs";
import {
  ORG_ID, OTHER_ORG_ID, STAFF_ID, fakeDb, makeRes, req, runWithSharedDb, staffSession,
} from "../../../testing/handler-harness.mjs";
import { clause, rolesLetIn, shelf } from "./s1-proof-kit.mjs";

const CLIENT_ID = "c1000000-0000-4000-8000-000000000001";
const BASE = "https://pay.example.test/c/onboarding";
const ENV = Object.freeze({ COMMAS_CHECKOUT_BASE_URL: BASE });
const noNetwork = async (url) => { throw new Error(`refused a live request to ${url}`); };

async function run(request, rules, { env = ENV } = {}) {
  const fake = fakeDb(rules);
  const res = makeRes();
  await runWithSharedDb(fake, () => handler(request, res, { env, fetchImpl: noNetwork }));
  return { res, fake };
}

const FOREIGN_CLIENT = "c2000000-0000-4000-8000-000000000002";
// Two clients, one in each company: kept only while the SQL names both the id and the company.
const owns = [/SELECT 1 FROM clients WHERE id = \$1 AND org_id = \$2/, shelf(
  [{ id: CLIENT_ID, org_id: ORG_ID }, { id: FOREIGN_CLIENT, org_id: OTHER_ORG_ID }],
  [
    clause(/WHERE id = \$1/, (row, [id]) => row.id === id),
    clause(/AND org_id = \$2/, (row, [, org]) => row.org_id === org),
  ],
)];
const echoLink = [/INSERT INTO payment_links/, (sql, p) => [{
  id: "11000000-0000-4000-8000-000000000001", org_id: p[0], client_id: p[1], purpose: p[2], description: p[3],
  amount_cents: String(p[4]), currency: p[5], link_ref: p[6], checkout_url: p[7], status: "created", paid_amount_cents: null,
}]];

const link = (id, over) => ({ id, org_id: ORG_ID, client_id: CLIENT_ID, purpose: "deposit", amount_cents: "250000", status: "sent", paid_amount_cents: null, checkout_url: `${BASE}?ref=${id}`, ...over });
const linksRead = [/SELECT \* FROM payment_links WHERE org_id = \$1 AND client_id = \$2/, shelf([
  link("a", {}),
  link("b", { purpose: "diagnostic", amount_cents: "3200", status: "paid", paid_amount_cents: "3200" }),
  link("x", { org_id: OTHER_ORG_ID, amount_cents: "999999" }),
  link("y", { client_id: FOREIGN_CLIENT, amount_cents: "888888" }),
], [
  clause(/WHERE org_id = \$1/, (row, [org]) => row.org_id === org),
  clause(/AND client_id = \$2/, (row, p) => row.client_id === p[1]),
])];

test("payment-links GET lists this client's links for the session's company, with the amount spelled out", async () => {
  assert.equal(ROUTES["payment-links"], handler);
  const { res, fake } = await run(req("GET", { query: { client_id: CLIENT_ID } }), [
    staffSession({ role: "sales_manager" }), owns, linksRead,
  ]);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.items.map((l) => [l.id, l.amount_display, l.paid_amount_display]), [["a", "2500.00", null], ["b", "32.00", "32.00"]],
    "not another company's link, not another client's");
  assert.deepEqual(fake.find(/SELECT \* FROM payment_links/)[0].params, [ORG_ID, CLIENT_ID]);
});

test("payment-links GET refuses another company's client and a bad id, and lets only owner, admin and sales manager read; no link is read", async () => {
  const refused = async (query, rules, status) => {
    const { res, fake } = await run(req("GET", { query }), rules);
    assert.equal(res.statusCode, status, JSON.stringify(query));
    assert.equal(fake.find(/FROM payment_links/).length, 0);
  };
  await refused({ client_id: FOREIGN_CLIENT }, [staffSession(), owns, linksRead], 403);
  await refused({ client_id: "nope" }, [staffSession()], 400);

  const letIn = await rolesLetIn(async (role) => {
    const { res, fake } = await run(req("GET", { query: { client_id: CLIENT_ID } }), [staffSession({ role }), owns, linksRead]);
    if (res.statusCode === 403) assert.equal(fake.find(/FROM payment_links/).length, 0, `${role} was refused but links were read`);
    return res.statusCode;
  });
  assert.deepEqual(letIn, ["admin", "owner", "sales_manager"], "a closer may create a link but may not list them");
});

test("payment-links POST create turns dollars into cents once and mints a hosted checkout link filed under the session's company", async () => {
  const { res, fake } = await run(
    req("POST", { body: { action: "create", client_id: CLIENT_ID, purpose: "deposit", price: "2500.50" } }),
    [staffSession({ role: "closer" }), owns, echoLink],
  );
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.link.amount_cents, "250050");
  assert.equal(res.body.link.amount_display, "2500.50");
  assert.ok(res.body.link.checkout_url.startsWith(BASE), "a hosted checkout address, never a card capture");
  const [insert] = fake.find(/INSERT INTO payment_links/);
  assert.equal(insert.params[0], ORG_ID);
  assert.equal(insert.params[1], CLIENT_ID);
  assert.equal(insert.params[2], "deposit");
  assert.equal(insert.params[4], 250050);
  assert.equal(insert.params[8], STAFF_ID);
});

test("payment-links POST create refuses a missing amount, a body org, another company's client and a missing checkout; nothing is minted", async () => {
  const refused = async (body, rules, status, env) => {
    const { res, fake } = await run(req("POST", { body }), rules, env ? { env } : undefined);
    assert.equal(res.statusCode, status, JSON.stringify(body));
    assert.equal(fake.find(/INSERT INTO (payment_links|invoices)/).length, 0);
    return res;
  };
  const base = { action: "create", client_id: CLIENT_ID, purpose: "deposit", price: "100" };
  const rules = [staffSession(), owns, echoLink];
  assert.match((await refused({ ...base, price: undefined }, rules, 400)).body.error, /an amount is required/);
  await refused({ ...base, org_id: ORG_ID }, rules, 400);
  await refused({ ...base, client_id: FOREIGN_CLIENT }, rules, 403);
  const closed = await refused(base, rules, 503, {});
  assert.equal(closed.body.error, "commas_not_configured");

  const letIn = await rolesLetIn(async (role) => {
    const { res, fake } = await run(req("POST", { body: base }), [staffSession({ role }), owns, echoLink]);
    if (res.statusCode === 403) assert.equal(fake.find(/INSERT INTO payment_links/).length, 0, `${role} was refused but a link was minted`);
    return res.statusCode;
  });
  assert.deepEqual(letIn, ["admin", "closer", "owner", "sales_manager"], "the closer may ask for money; a setter or an advisor may not");
});

test("payment-links POST create purpose=invoice writes a DRAFT invoice row for the amount and mints no pay link", async () => {
  const { res, fake } = await run(
    req("POST", { body: { action: "create", client_id: CLIENT_ID, purpose: "invoice", price: "100.00", description: "Invoice this client" } }),
    [staffSession({ role: "closer" }), owns,
      [/INSERT INTO invoices/, (sql, p) => [{ id: "66000000-0000-4000-8000-000000000001", org_id: p[0], client_id: p[1], source: p[3], status: "draft", amount_due: p[5], idempotency_key: p[12], notes: p[13] }]]],
  );
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.invoice.status, "draft");
  assert.equal(res.body.invoice.amount_due, 100);
  assert.equal(res.body.invoice.idempotency_key, `present-invoice:${CLIENT_ID}:10000`, "a repeat press finds the same invoice");
  assert.equal(res.body.link, undefined);
  assert.equal(fake.find(/INSERT INTO payment_links/).length, 0);
  assert.equal(fake.find(/INSERT INTO messages/).length, 0, "nothing is sent");
});
